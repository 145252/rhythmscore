/**
 * 去白底抠图:把接近白色的背景像素置为透明,保留五线谱/音符等深色内容。
 * 算法:像素到白色的距离,小于阈值完全透明,阈值间渐变(羽化抗锯齿)。
 */

/** 完全透明阈值(到白色的欧氏距离) */
const T0 = 50
/** 完全不透明阈值(羽化带收窄,减少半透明浅色边缘像素,避免叠加时发白边) */
const T1 = 66

/**
 * 对图片执行去白底,返回透明 PNG dataURL。
 * @param invert 是否反色(保留内容黑→白,适合叠加到深色背景)
 * 大图逐像素处理,用平方距离避免大部分 sqrt,保证速度。
 */
export async function removeWhiteBackground(img: HTMLImageElement, invert = false): Promise<string> {
  const w = img.naturalWidth
  const h = img.naturalHeight
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('无法创建画布')
  ctx.drawImage(img, 0, 0)
  const id = ctx.getImageData(0, 0, w, h)
  const d = id.data
  const t02 = T0 * T0
  const t12 = T1 * T1
  const span = T1 - T0
  for (let i = 0, o = 0; i < d.length; i += 4, o = i) {
    const r = d[o]
    const g = d[o + 1]
    const b = d[o + 2]
    const dr = 255 - r
    const dg = 255 - g
    const db = 255 - b
    const d2 = dr * dr + dg * dg + db * db
    if (d2 <= t02) {
      d[o + 3] = 0
    } else if (d2 < t12) {
      const dist = Math.sqrt(d2)
      const a = ((dist - T0) / span) * 255
      d[o + 3] = Math.round(a)
    }
    // 距离 ≥ T1:保持原 alpha(完全不透明)
    // 反色:保留内容(alpha>0)反色,背景(透明)保持
    if (invert && d[o + 3] > 0) {
      d[o] = 255 - r
      d[o + 1] = 255 - g
      d[o + 2] = 255 - b
    }
  }

  // 反色后处理:消除黑边(半透明边缘实心白 + 内容外扩 1px 白色)
  if (invert) {
    const a0 = new Uint8ClampedArray(d) // 原始 alpha 快照(膨胀判定用)
    // 1) 半透明边缘像素 → 纯白实心(盖掉暗色羽化边)
    for (let i = 0; i < d.length; i += 4) {
      const a = d[i + 3]
      if (a > 0 && a < 255) {
        d[i] = 255
        d[i + 1] = 255
        d[i + 2] = 255
        d[i + 3] = 255
      }
    }
    // 2) 1px 8邻域膨胀:透明像素的邻域有内容 → 填纯白(向外扩一圈,覆盖黑边)
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4
        if (d[i + 3] === 0) {
          const up = ((y - 1) * w + x) * 4
          const dn = ((y + 1) * w + x) * 4
          const lf = (y * w + x - 1) * 4
          const rt = (y * w + x + 1) * 4
          const ul = ((y - 1) * w + x - 1) * 4
          const ur = ((y - 1) * w + x + 1) * 4
          const dl = ((y + 1) * w + x - 1) * 4
          const dr = ((y + 1) * w + x + 1) * 4
          if (
            a0[up + 3] > 0 ||
            a0[dn + 3] > 0 ||
            a0[lf + 3] > 0 ||
            a0[rt + 3] > 0 ||
            a0[ul + 3] > 0 ||
            a0[ur + 3] > 0 ||
            a0[dl + 3] > 0 ||
            a0[dr + 3] > 0
          ) {
            d[i] = 255
            d[i + 1] = 255
            d[i + 2] = 255
            d[i + 3] = 255
          }
        }
      }
    }
  }

  ctx.putImageData(id, 0, 0)
  return c.toDataURL('image/png')
}
