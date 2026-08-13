/// <reference types="vite/client" />

interface ScoreFile {
  path: string
  name: string
  ext: string
  dataBase64: string
}

interface ExportSegmentSpec {
  index: number
  start: number
  end: number
}

interface ExportVideoResult {
  canceled: boolean
  error?: string
  mainPath?: string
  segments?: string[]
}

interface WorkbuddyApi {
  isElectron: boolean
  openScoreFile: () => Promise<{ files: ScoreFile[] } | null>
  saveProject: (defaultName: string, content: string) => Promise<string | null>
  openProject: () => Promise<{ path: string; content: string } | null>
  exportVideo: (payload: {
    webmBase64: string
    defaultName: string
    splitMeasures?: ExportSegmentSpec[]
    lowQuality?: boolean
  }) => Promise<ExportVideoResult>
  onMenuAction: (cb: (action: 'open-project' | 'save-project') => void) => void
  getMachineCode: () => Promise<string>
  activateLicense: (key: string) => Promise<{ ok: boolean; machine: string }>
  isTestUnlocked: () => Promise<boolean>
  /** 透明导出:开始帧序列会话(返回临时目录 id) */
  beginAlphaFrames: () => Promise<string>
  writeAlphaFrame: (dirId: string, index: number, buffer: ArrayBuffer) => Promise<void>
  finishAlphaVideo: (
    dirId: string,
    opts: { fps: number; defaultName: string; lowQuality: boolean; audioDataUrl?: string | null; times?: number[] }
  ) => Promise<{ canceled: boolean; savedPath?: string; error?: string }>
}

interface Window {
  api?: WorkbuddyApi
}
