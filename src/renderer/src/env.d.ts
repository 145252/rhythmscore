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
}

interface Window {
  api?: WorkbuddyApi
}
