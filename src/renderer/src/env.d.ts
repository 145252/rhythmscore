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
  }) => Promise<ExportVideoResult>
}

interface Window {
  api?: WorkbuddyApi
}
