export interface ScoreSource {
  kind: 'image' | 'pdf'
  name: string
  path?: string
  /** 合并后的长图 dataURL(多页/多文件垂直拼接) */
  dataUrl: string
  /** 抠图后的透明背景 dataURL(去除白色背景;未处理时为空) */
  transparentDataUrl?: string
  /** transparentDataUrl 是否为反色版(黑→白) */
  transparentInverted?: boolean
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

export type Tool = 'eraser' | 'hline' | 'vline' | 'select'

export interface Selected {
  type: 'h' | 'v'
  id: string
}

/** 对点事件:一个小节在某时刻被演奏(同一小节可多次出现 = 反复段落) */
export interface MarkEvent {
  /** 小节编号 */
  n: number
  /** 音频时间(秒) */
  time: number
  /** 打点基准时间(秒),用于显示微调偏移 */
  base: number
  /** 自定义编号(缺省 = 演奏序号) */
  label?: number
}

/** 项目文件结构(可序列化,保存时整体 AES 加密) */
export interface ProjectFile {
  version: 1
  name: string
  score: ScoreSource | null
  /** 多页曲谱(顺序即显示顺序) */
  scorePages?: { name?: string; dataUrl: string; width: number; height: number }[]
  hLines: number[]
  vLines: VLine[]
  /** 对点事件序列(按时间排序;同一小节可多次出现=反复) */
  markEvents?: MarkEvent[]
  /** 兼容旧格式:小节编号 → 音频时间 */
  measureTimes?: Record<number, number>
  /** 小节自定义编号(原始编号 → 显示编号) */
  measureLabel?: Record<number, number>
  /** 拍号细分:每小节内拍线(比例 0-1,按小节独立;缺失=等分);null=未启用 */
  beatSubdivision?: boolean
  beatsPerMeasure?: number
  beatRatiosByMeasure?: Record<number, number[]>
  /** 抠图(去除白色背景) */
  removeBackground?: boolean
  /** 反色(黑音符→白音符,需配合抠图) */
  invertColors?: boolean
  /** 玻璃背板:曲谱内容下方垫半透明玻璃板(衬托曲谱) */
  glassBackdrop?: boolean
  /** 玻璃背板浓度(0-100) */
  glassOpacity?: number
  /** 导出背景:original/white/black/transparent */
  videoBackground?: 'original' | 'white' | 'black' | 'transparent'
  /** 音频内容(随项目保存,打开后自动恢复,无需重新导入) */
  audio?: { name: string; dataUrl: string } | null
}
