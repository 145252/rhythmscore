import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join, basename, extname } from 'path'
import { readFile, writeFile } from 'fs/promises'
import { exportVideo, type SegmentSpec } from './ffmpeg'

const isDev = !!process.env.ELECTRON_RENDERER_URL

// 在受限/容器化环境中 Chromium 沙箱无法初始化(Operation not permitted),
// 本地开发与打包版均需禁用沙箱,否则 GPU/网络服务进程连环崩溃
app.commandLine.appendSwitch('no-sandbox')

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: '动态曲谱工作台',
    backgroundColor: '#f5f5f2',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

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

app.whenReady().then(() => {
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

// ---------- IPC: 导入曲谱文件 ----------
ipcMain.handle('dialog:openScore', async () => {
  const r = await dialog.showOpenDialog({
    title: '导入曲谱',
    properties: ['openFile'],
    filters: [
      { name: '曲谱文件', extensions: ['pdf', 'jpg', 'jpeg', 'png', 'webp', 'bmp'] },
      { name: '图片', extensions: ['jpg', 'jpeg', 'png', 'webp', 'bmp'] },
      { name: 'PDF', extensions: ['pdf'] }
    ]
  })
  if (r.canceled || !r.filePaths[0]) return null
  const p = r.filePaths[0]
  const buf = await readFile(p)
  return {
    path: p,
    name: basename(p),
    ext: extname(p).toLowerCase().replace('.', ''),
    dataBase64: buf.toString('base64')
  }
})

// ---------- IPC: 项目保存 / 打开 ----------
ipcMain.handle('project:save', async (_e, defaultName: string, content: string) => {
  const r = await dialog.showSaveDialog({
    title: '保存项目',
    defaultPath: defaultName.endsWith('.dscore.json') ? defaultName : `${defaultName}.dscore.json`,
    filters: [
      { name: '动态曲谱项目', extensions: ['dscore.json'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  })
  if (r.canceled || !r.filePath) return null
  await writeFile(r.filePath, content, 'utf-8')
  return r.filePath
})

ipcMain.handle('project:open', async () => {
  const r = await dialog.showOpenDialog({
    title: '打开项目',
    properties: ['openFile'],
    filters: [
      { name: '动态曲谱项目', extensions: ['dscore.json'] },
      { name: 'JSON', extensions: ['json'] }
    ]
  })
  if (r.canceled || !r.filePaths[0]) return null
  const content = await readFile(r.filePaths[0], 'utf-8')
  return { path: r.filePaths[0], content }
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
    }
  ) => {
    try {
      const buf = Buffer.from(payload.webmBase64, 'base64')
      const segments = payload.splitMeasures ?? []
      if (segments.length > 0) {
        // 切片模式:选择输出目录
        const r = await dialog.showOpenDialog({
          title: '选择导出目录(整曲 + 每小节片段)',
          properties: ['openDirectory', 'createDirectory']
        })
        if (r.canceled || !r.filePaths[0]) return { canceled: true }
        const res = await exportVideo(buf, '', r.filePaths[0], segments)
        return { canceled: false, ...res }
      }
      // 整片模式:选择保存文件
      const r = await dialog.showSaveDialog({
        title: '保存视频',
        defaultPath: `${payload.defaultName}.mp4`,
        filters: [{ name: 'MP4 视频', extensions: ['mp4'] }]
      })
      if (r.canceled || !r.filePath) return { canceled: true }
      const res = await exportVideo(buf, r.filePath, null, [])
      return { canceled: false, ...res }
    } catch (err) {
      return { canceled: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
)
