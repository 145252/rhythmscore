/**
 * 将多个图像页面垂直拼接为一张长图(统一缩放到最大宽度)。
 * 坐标系统:合并图原始像素坐标,行/竖线/小节编号均基于此。
 */

export interface PageImage {
  dataUrl: string
  width: number
  height: number
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

const MAX_WIDTH = 4200 // 防止超大图导致 canvas 内存爆炸
const MAX_AREA = 32000000 // 合并图总面积上限(~32MP),防止长图拼接内存溢出

export async function mergePages(pages: PageImage[]): Promise<PageImage> {
  if (pages.length === 0) throw new Error('没有可合并的页面')
  if (pages.length === 1) return pages[0]

  const baseW = Math.max(...pages.map((p) => p.width))
  const scale = Math.min(1, MAX_WIDTH / baseW)
  const W0 = Math.round(baseW * scale)
  const estH = pages.reduce((acc, p) => acc + (p.height * W0) / p.width, 0)
  // 总面积保护:超出上限则整体等比缩小
  const areaScale = Math.min(1, Math.sqrt(MAX_AREA / (W0 * estH)))
  const W = Math.max(1, Math.round(W0 * areaScale))

  const scaled: { img: HTMLImageElement; h: number }[] = []
  let H = 0
  for (const p of pages) {
    const img = await loadImage(p.dataUrl)
    const h = Math.max(1, Math.round((p.height * W) / p.width))
    scaled.push({ img, h })
    H += h
  }

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 不可用')

  let y = 0
  for (const s of scaled) {
    const x = Math.round((W - s.img.naturalWidth * (s.h / s.img.naturalHeight)) / 2)
    ctx.drawImage(s.img, x, y, s.img.naturalWidth * (s.h / s.img.naturalHeight), s.h)
    y += s.h
  }

  return { dataUrl: canvas.toDataURL('image/png'), width: W, height: H }
}
