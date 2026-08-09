/**
 * 曲谱行区间几何计算。
 * 横线(行边界)将曲谱划分为若干行;竖线(小节线)只在所属行的上下边界之间显示。
 */

export function sortedLines(h: number[]): number[] {
  return [...h].sort((a, b) => a - b)
}

/** 行数:横线 >= 2 时为 n-1 行,否则整张图视为 1 行 */
export function rowCount(h: number[]): number {
  const s = sortedLines(h)
  return s.length >= 2 ? s.length - 1 : 1
}

/** 第 row 行的上下边界 [top, bottom] */
export function rowBounds(h: number[], row: number, imageH: number): [number, number] {
  const s = sortedLines(h)
  if (s.length === 0) return [0, imageH]
  if (s.length === 1) {
    return s[0] < imageH / 2 ? [s[0], imageH] : [0, s[0]]
  }
  const r = Math.min(Math.max(row, 0), s.length - 2)
  return [s[r], s[r + 1]]
}

/** 根据图像坐标 y 确定所在行索引 */
export function rowAt(h: number[], y: number, imageH: number): number {
  const s = sortedLines(h)
  if (s.length === 0) return 0
  if (s.length === 1) return 0
  if (y <= s[0]) return 0
  if (y >= s[s.length - 1]) return s.length - 2
  for (let i = 0; i < s.length - 1; i++) {
    if (y >= s[i] && y <= s[i + 1]) return i
  }
  return 0
}

/** 找到离 y 最近的横线(距离 < tol 时命中),返回横线在排序数组中的索引 */
export function nearestHLine(h: number[], y: number, tol: number): number | null {
  const s = sortedLines(h)
  let best: number | null = null
  let bestDist = Infinity
  s.forEach((v, i) => {
    const d = Math.abs(v - y)
    if (d < bestDist) {
      bestDist = d
      best = i
    }
  })
  if (best !== null && bestDist <= tol) return best
  return null
}

/** 找到离点 (x, y) 最近的竖线(距离 < tol 时命中)。full 线贯穿整图,measure 线只在行内 */
export function nearestVLine(
  vLines: { id: string; x: number; row: number; kind: 'full' | 'measure' }[],
  h: number[],
  x: number,
  y: number,
  imageH: number,
  tol: number
): { id: string; x: number; row: number; kind: 'full' | 'measure' } | null {
  let best: { id: string; x: number; row: number; kind: 'full' | 'measure' } | null = null
  let bestDist = Infinity
  for (const v of vLines) {
    const [top, bottom] = v.kind === 'full' ? [0, imageH] : rowBounds(h, v.row, imageH)
    if (y < top - tol || y > bottom + tol) continue
    const d = Math.abs(v.x - x)
    if (d < bestDist) {
      bestDist = d
      best = v
    }
  }
  return best !== null && bestDist <= tol ? best : null
}

/** 全局小节总数:每行 = 左右边框 + 该行小节线 形成的相邻区间数 */
export function getMeasureCount(
  h: number[],
  vLines: { id: string; x: number; row: number; kind: 'full' | 'measure' }[],
  imageW: number
): number {
  const rows = rowCount(h)
  const fullXs = vLines.filter((v) => v.kind === 'full').map((v) => v.x)
  const left = fullXs.length ? Math.min(...fullXs) : 0
  const right = fullXs.length ? Math.max(...fullXs) : imageW
  let count = 0
  for (let r = 0; r < rows; r++) {
    const set = new Set<number>([left, right])
    vLines.filter((v) => v.kind === 'measure' && v.row === r).forEach((v) => set.add(v.x))
    count += Math.max(set.size - 1, 0)
  }
  return count
}

/** 标注元素缩放系数:基于曲谱宽度,基准 1000px(线宽/字号/标记尺寸随分辨率同步放大) */
export function annotScale(scoreW: number): number {
  return Math.min(Math.max(scoreW / 1000, 0.6), 3)
}
