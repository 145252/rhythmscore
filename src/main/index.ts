import { app, BrowserWindow, ipcMain, dialog, shell, Menu, type MenuItemConstructorOptions } from 'electron'
import { join, basename, extname } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'
import { exportVideo, encodeAlphaMov, type SegmentSpec } from './ffmpeg'
import { machineCode, verifyLicense, verifyIntegrity } from './license'

const isDev = !!process.env.ELECTRON_RENDERER_URL

// 在受限/容器化环境中 Chromium 沙箱无法初始化(Operation not permitted),
// 本地开发与打包版均需禁用沙箱,否则 GPU/网络服务进程连环崩溃
app.commandLine.appendSwitch('no-sandbox')

let mainWin: BrowserWindow | null = null

/** 中文应用菜单:文件/编辑/视图/窗口/帮助 */
function buildMenu(): void {
  const send = (channel: string): void => {
    mainWin?.webContents.send(channel)
  }
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'RhythmScore',
      submenu: [
        { role: 'about', label: '关于 RhythmScore' },
        { type: 'separator' },
        { role: 'hide', label: '隐藏 RhythmScore' },
        { role: 'hideOthers', label: '隐藏其他' },
        { role: 'unhide', label: '全部显示' },
        { type: 'separator' },
        { role: 'quit', label: '退出 RhythmScore' }
      ]
    },
    {
      label: '文件',
      submenu: [
        { label: '打开项目', accelerator: 'CmdOrCtrl+O', click: () => send('menu:open-project') },
        { label: '保存项目', accelerator: 'CmdOrCtrl+S', click: () => send('menu:save-project') },
        { type: 'separator' },
        { role: 'close', label: '关闭窗口' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { role: 'undo', label: '撤销' },
        { role: 'redo', label: '重做' },
        { type: 'separator' },
        { role: 'cut', label: '剪切' },
        { role: 'copy', label: '复制' },
        { role: 'paste', label: '粘贴' },
        { role: 'selectAll', label: '全选' }
      ]
    },
    {
      label: '视图',
      submenu: [
        { role: 'reload', label: '重新加载' },
        { role: 'forceReload', label: '强制重新加载' },
        // 生产版不提供开发者工具入口(渲染层明文,防调试逆向)
        ...(isDev
          ? ([{ role: 'toggleDevTools', label: '开发者工具' }, { type: 'separator' }] as MenuItemConstructorOptions[])
          : []),
        { role: 'resetZoom', label: '实际大小' },
        { role: 'zoomIn', label: '放大' },
        { role: 'zoomOut', label: '缩小' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: '切换全屏' }
      ]
    },
    {
      label: '窗口',
      submenu: [
        { role: 'minimize', label: '最小化' },
        { role: 'zoom', label: '缩放' },
        { role: 'close', label: '关闭窗口' }
      ]
    },
    {
      label: '帮助',
      submenu: [{ role: 'about', label: '关于 RhythmScore' }]
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: 'RhythmScore',
    // 隐藏原生标题栏:窗口控制按钮(红黄绿)浮在内容上,融入液态玻璃界面
    titleBarStyle: 'hiddenInset',
    // 调整控制按钮位置:靠左,垂直方向在拖拽条内居中
    trafficLightPosition: { x: 22, y: 19 },
    backgroundColor: '#f5f5f2',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })
  mainWin = win
  win.on('closed', () => {
    mainWin = null
  })

  // 生产版拦截开发者工具快捷键(F12 / Cmd+Option+I / Ctrl+Shift+I)
  if (!isDev) {
    win.webContents.on('before-input-event', (_e, input) => {
      const k = input.key.toLowerCase()
      const devShortcut =
        input.key === 'F12' ||
        ((input.meta || input.control) && input.alt && k === 'i') ||
        (input.control && input.shift && k === 'i')
      if (devShortcut) _e.preventDefault()
    })
  }

  // 新窗口(外链)用系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (isDev) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL as string)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // 打包版:启动前做完整性自检,被篡改/损坏则拒绝运行(dev 模式跳过)
  if (!isDev) {
    const ok = await verifyIntegrity(join(__dirname, '..'))
    if (!ok) {
      dialog.showErrorBox(
        'RhythmScore 完整性校验失败',
        '程序文件已被修改或损坏,为确保安全已拒绝启动。\n请从官方渠道重新下载最新版本。'
      )
      app.quit()
      return
    }
  }
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

// ---------- 崩溃诊断日志(便于定位闪退原因) ----------
app.on('render-process-gone', (_e, _wc, details) => {
  console.error('[crash] renderer gone:', details.reason, JSON.stringify(details))
})
app.on('child-process-gone', (_e, details) => {
  console.error('[crash] child gone:', details.type, details.reason)
})

// ---------- IPC: 导入曲谱文件(支持多选) ----------
ipcMain.handle('dialog:openScore', async () => {
  const r = await dialog.showOpenDialog({
    title: '导入曲谱(可多选 jpg/png/pdf)',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '曲谱文件', extensions: ['pdf', 'jpg', 'jpeg', 'png'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  })
  if (r.canceled || !r.filePaths.length) return null
  const files: { path: string; name: string; ext: string; dataBase64: string }[] = []
  for (const p of r.filePaths) {
    const buf = await readFile(p)
    files.push({
      path: p,
      name: basename(p),
      ext: extname(p).toLowerCase().replace('.', ''),
      dataBase64: buf.toString('base64')
    })
  }
  return { files }
})

// ---------- 项目文件 AES 加密(保存时加密,打开时解密) ----------

const PROJECT_KEY = createHash('sha256').update('dynamic-score-project-lvren-2026').digest()

function encryptProject(content: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', PROJECT_KEY, iv)
  const enc = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

function decryptProject(data: string): string | null {
  try {
    const buf = Buffer.from(data, 'base64')
    if (buf.length < 28) return null
    const iv = buf.subarray(0, 12)
    const tag = buf.subarray(12, 28)
    const enc = buf.subarray(28)
    const decipher = createDecipheriv('aes-256-gcm', PROJECT_KEY, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}

// ---------- IPC: 项目保存 / 打开 ----------
/** 记住最近一次保存/打开的路径:同名再保存时直接覆盖,不弹"是否覆盖"对话框 */
let lastSavePath: string | null = null

ipcMain.handle('project:save', async (_e, defaultName: string, content: string) => {
  const target = defaultName.endsWith('.dscore') ? defaultName : `${defaultName}.dscore`
  // 上次保存/打开的路径文件名与当前项目名一致 → 直接覆盖保存
  if (lastSavePath && basename(lastSavePath).replace(/\.dscore(\.json)?$/i, '') === defaultName) {
    await writeFile(lastSavePath, encryptProject(content), 'utf-8')
    return lastSavePath
  }
  const r = await dialog.showSaveDialog({
    title: '保存项目',
    defaultPath: target,
    filters: [{ name: '动态曲谱项目', extensions: ['dscore'] }]
  })
  if (r.canceled || !r.filePath) return null
  await writeFile(r.filePath, encryptProject(content), 'utf-8')
  lastSavePath = r.filePath
  return r.filePath
})

ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog({
    title: '打开项目',
    properties: ['openFile'],
    filters: [
      { name: '动态曲谱项目', extensions: ['dscore', 'dscore.json'] }
    ]
  })
  if (r.canceled || !r.filePaths[0]) return null
  const raw = await readFile(r.filePaths[0], 'utf-8')
  // 优先解密(新格式);解密失败则按旧明文 JSON 兼容
  const plain = decryptProject(raw)
  // 记住打开路径:之后直接点保存 = 覆盖保存到原文件
  lastSavePath = r.filePaths[0]
  return { path: r.filePaths[0], content: plain !== null ? plain : raw }
})

// ---------- IPC: 授权(机器码 / 激活码验证) ----------
ipcMain.handle('license:get-machine', () => machineCode())

ipcMain.handle('license:activate', (_e, key: string) => {
  const machine = machineCode()
  const ok = verifyLicense(String(key ?? ''), machine)
  return { ok, machine }
})

// ---------- IPC: 视频导出(webm → mp4 + 小节切片) ----------
ipcMain.handle(
  'video:export',
  async (
    _e,
    payload: {
      webmBase64: string
      defaultName: string
      splitMeasures?: SegmentSpec[]
      lowQuality?: boolean
    }
  ) => {
    try {
      const buf = Buffer.from(payload.webmBase64, 'base64')
      const segments = payload.splitMeasures ?? []
      const opts = { lowQuality: payload.lowQuality === true }
      if (segments.length > 0) {
        // 切片模式:选择输出目录
        const r = await dialog.showOpenDialog({
          title: '选择导出目录(整曲 + 每小节片段)',
          properties: ['openDirectory', 'createDirectory']
        })
        if (r.canceled || !r.filePaths[0]) return { canceled: true }
        const res = await exportVideo(buf, '', r.filePaths[0], segments, opts)
        return { canceled: false, ...res }
      }
      // 整片模式:选择保存文件
      const r = await dialog.showSaveDialog({
        title: '保存视频',
        defaultPath: `${payload.defaultName}.mp4`,
        filters: [{ name: 'MP4 视频', extensions: ['mp4'] }]
      })
      if (r.canceled || !r.filePath) return { canceled: true }
      const res = await exportVideo(buf, r.filePath, null, [], opts)
      return { canceled: false, ...res }
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)

// ---------- IPC: 透明导出(帧序列 → VP9 alpha WebM) ----------
ipcMain.handle('video:begin-frames', async () => {
  const { mkdtemp } = await import('fs/promises')
  const { join } = await import('path')
  const { tmpdir } = await import('os')
  return mkdtemp(join(tmpdir(), 'rs-alpha-'))
})

ipcMain.handle('video:write-frame', async (_e, dirId: string, index: number, buffer: ArrayBuffer) => {
  const { writeFile } = await import('fs/promises')
  const { join } = await import('path')
  await writeFile(join(dirId, `frame-${String(index).padStart(5, '0')}.png`), Buffer.from(buffer))
})

ipcMain.handle(
  'video:finish-alpha',
  async (
    _e,
    dirId: string,
    opts: { fps: number; defaultName: string; lowQuality: boolean }
  ): Promise<{ canceled: boolean; savedPath?: string; error?: string }> => {
    try {
      const r = await dialog.showSaveDialog({
        title: '保存透明视频(MOV, 可叠加)',
        defaultPath: `${opts.defaultName}-透明.mov`,
        filters: [{ name: 'MOV 视频(透明通道)', extensions: ['mov'] }]
      })
      if (r.canceled || !r.filePath) return { canceled: true }
      await encodeAlphaMov(dirId, opts.fps, r.filePath, opts.lowQuality === true)
      // 清理帧临时目录(异步)
      void (async () => {
        try {
          const { rm } = await import('fs/promises')
          await rm(dirId, { recursive: true, force: true })
        } catch {
          /* ignore */
        }
      })()
      return { canceled: false, savedPath: r.filePath }
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)
