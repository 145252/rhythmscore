/**
 * 曲谱小节线检测:在每一行区域内扫描图像的竖直暗线条(印刷的小节线),
 * 返回每行检测到的小节线 x 坐标列表(原始图片坐标)。
 * 用于画竖线时吸附到"五线谱本身的小节线",而非用户自己画的线。
 */

export interface RowRegion {
  top: number
  bottom: number
}

/**
 * 检测每一行的小节线位置。
 * @param img 曲谱原图
 * @param rows 各行区域(原图坐标)
 * @param left / right 检测范围(左右边框,原图坐标)
 */
export async function detectMeasureLines(
  img: HTMLImageElement,
  rows: RowRegion[],
  left: number,
  right: number
): Promise<number[][]> {
  // 缩小采样宽度(限制计算量),仍保持足够精度
  const SAMPLE_W = 2400
  const scale = Math.min(1, SAMPLE_W / img.naturalWidth)
  const W = Math.max(1, Math.round(img.naturalWidth * scale))
  const H = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return rows.map(() => [])
  ctx.drawImage(img, 0, 0, W, H)
  const data = ctx.getImageData(0, 0, W, H).data

  const results: number[][] = []
  for (const r of rows) {
    const t = Math.max(0, Math.round(r.top * scale))
    const b = Math.min(H, Math.round(r.bottom * scale))
    const l = Math.max(0, Math.round(left * scale))
    const rr = Math.min(W, Math.round(right * scale))
    const h = Math.max(1, b - t)
    if (h < 4 || rr - l < 4) {
      results.push([])
      continue
    }
    // 垂直采样点数
    const V_STEPS = Math.min(48, Math.max(12, Math.round(h / 4)))
    const yStep = h / V_STEPS
    const candidates: number[] = []
    for (let x = l; x <= rr; x += 1) {
      let totalDark = 0
      let maxRun = 0
      let run = 0
      for (let s = 0; s < V_STEPS; s++) {
        const y = Math.min(b - 1, t + Math.round(s * yStep))
        const idx = (y * W + x) * 4
        const rv = data[idx]
        const gv = data[idx + 1]
        const bv = data[idx + 2]
        const dark = rv < 130 && gv < 130 && bv < 130
        if (dark) {
          totalDark++
          run++
        } else {
          if (run > maxRun) maxRun = run
          run = 0
        }
      }
      if (run > maxRun) maxRun = run
      // 行内含符杆延伸空间,小节线贯穿五线谱的暗段占比可能不足 50%,
      // 用宽松的"暗比例 + 存在一定连续暗段"识别;误判会以绿线标记显示,便于人工校验
      const darkRatio = totalDark / V_STEPS
      const runRatio = maxRun / V_STEPS
      if (darkRatio > 0.4 && runRatio > 0.3) candidates.push(x / scale)
    }
    // 聚类相邻候选列(间距 < 6 原图像素),取质心
    const groups: number[][] = []
    for (const x of candidates) {
      const g = groups.find((gr) => Math.abs(gr[0] - x) < 6)
      if (g) g.push(x)
      else groups.push([x])
    }
    results.push(groups.map((g) => g.reduce((a, b) => a + b, 0) / g.length))
  }
  return results
}
