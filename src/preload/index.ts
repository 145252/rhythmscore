import { contextBridge, ipcRenderer } from 'electron'

export interface SegmentSpec {
  index: number
  start: number
  end: number
}

const api = {
  isElectron: true,
  /** 打开文件对话框选择曲谱文件(可多选),返回文件列表 */
  openScoreFile: (): Promise<{
    files: {
      path: string
      name: string
      ext: string
      dataBase64: string
    }[]
  } | null> => ipcRenderer.invoke('dialog:openScore'),
  /** 保存项目 JSON,返回保存路径或 null */
  saveProject: (defaultName: string, content: string): Promise<string | null> =>
    ipcRenderer.invoke('project:save', defaultName, content),
  /** 打开项目 JSON,返回 { path, content } 或 null */
  openProject: (): Promise<{ path: string; content: string } | null> =>
    ipcRenderer.invoke('project:open'),
  /** 导出视频:webm → mp4(+按小节切片),返回结果或 null */
  exportVideo: (payload: {
    webmBase64: string
    defaultName: string
    splitMeasures?: SegmentSpec[]
  }): Promise<{
    canceled: boolean
    error?: string
    mainPath?: string
    segments?: string[]
  }> => ipcRenderer.invoke('video:export', payload),
  /** 监听应用菜单动作(打开项目/保存项目) */
  onMenuAction: (cb: (action: 'open-project' | 'save-project') => void) => {
    ipcRenderer.on('menu:open-project', () => cb('open-project'))
    ipcRenderer.on('menu:save-project', () => cb('save-project'))
  }
}

contextBridge.exposeInMainWorld('api', api)

export type WorkbuddyApi = typeof api
