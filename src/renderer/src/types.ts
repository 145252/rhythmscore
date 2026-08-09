export interface ScoreSource {
  kind: 'image' | 'pdf'
  name: string
  path?: string
  /** 合并后的长图 dataURL(多页/多文件垂直拼接) */
  dataUrl: string
  /** 合并图原始像素宽高(坐标基准) */
  width: number
  height: number
}

export interface VLine {
  id: string
  /** 图像原始坐标 */
  x: number
  /** 所属行索引(仅 measure 线使用),渲染时解析为该行的上下边界 */
  row: number
  /** full = 贯穿整张图(左右边框);measure = 行内小节线 */
  kind: 'full' | 'measure'
}

export type Tool = 'pan' | 'hline' | 'vline' | 'select'

export interface Selected {
  type: 'h' | 'v'
  id: string
}

/** 项目文件结构(可序列化) */
export interface ProjectFile {
  version: 1
  name: string
  score: ScoreSource | null
  hLines: number[]
  vLines: VLine[]
  /** 音频对点:小节编号 → 音频时间(秒) */
  measureTimes?: Record<number, number>
}
