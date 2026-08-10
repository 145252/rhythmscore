/**
 * 视频导出模块:按音频时间轴把曲谱画面渲染到离屏 canvas,
 * 通过 canvas.captureStream + MediaRecorder 实时录制 webm(含音频),
 * 交给主进程 ffmpeg 转成 MP4。
 *
 * 导出画面(纯净模式):只显示曲谱原图 + 跟随指示
 * - 连续:红色光标线(小节内匀速)
 * - 跳框:当前小节半透明高亮
 * 滚动采用平滑插值(lerp),避免换行跳变卡顿。
 */
import { annotScale, rowBounds, rowCount, sortedLines } from './geometry'
import type { MarkEvent, VLine } from './types'
import { getAudio } from './audioPlayer'

export type FollowMode = 'continuous' | 'jump'
export type VideoRatio = '单行' | '连滚' | '3:4' | '4:3' | '9:16' | '16:9' | '18:9'

export const RATIO_SIZES: Record<VideoRatio, { w: number; h: number }> = {
  单行: { w: 1920, h: 1080 },
  连滚: { w: 1920, h: 1080 },
  '3:4': { w: 1080, h: 1440 },
  '4:3': { w: 1440, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 },
  '18:9': { w: 1920, h: 960 }
}

interface Measure {
  n: number
  x0: number
  x1: number
  top: number
  bottom: number
}

export interface RenderData {
  img: HTMLImageElement
  /** 预渲染整图(宽度=输出宽,非单行模式),用于高性能滚动绘制 */
  pre?: HTMLCanvasElement
  scoreW: number
  scoreH: number
  hLines: number[]
  vLines: VLine[]
  lineWidth: number
  leftBorder: number
  rightBorder: number
  measures: Measure[]
  /** 对点事件序列(按时间排序;同一小节可多次出现=反复) */
  events: MarkEvent[]
  totalDuration: number
  mode: FollowMode
  ratio: VideoRatio
  /** 是否显示标线/编号(软件内用 true,导出视频默认 false) */
  showAnnotations: boolean
  /** 连续模式光标线颜色与粗细(画布像素) */
  cursorColor: string
  cursorWidth: number
  /** 跳框模式高亮颜色 */
  jumpColor: string
  /** 跳框模式当前小节填充浓度(0~1) */
  jumpOpacity: number
  /** 跳框模式下一小节(预备)颜色与浓度 */
  nextColor: string
  nextOpacity: number
}

export function buildMeasures(
  hLines: number[],
  vLines: VLine[],
  scoreW: number,
  scoreH: number
): Measure[] {
  const fullXs = vLines.filter((v) => v.kind === 'full').map((v) => v.x)
  const left = fullXs.length ? Math.min(...fullXs) : 0
  const right = fullXs.length ? Math.max(...fullXs) : scoreW
  const out: Measure[] = []
  const rows = rowCount(hLines)
  let counter = 0
  for (let r = 0; r < rows; r++) {
    const [top, bottom] = rowBounds(hLines, r, scoreH)
    const set = new Set<number>([left, right])
    vLines.filter((v) => v.kind === 'measure' && v.row === r).forEach((v) => set.add(v.x))
    const xs = [...set].sort((a, b) => a - b)
    for (let i = 0; i < xs.length - 1; i++) {
      counter += 1
      out.push({ n: counter, x0: xs[i], x1: xs[i + 1], top, bottom })
    }
  }
  return out
}

/** 事件序列:返回 t 时刻正在演奏的事件(最近一个 time ≤ t);无事件返回 null */
export function eventAtTime(t: number, events: MarkEvent[]): MarkEvent | null {
  if (events.length === 0) return null
  let cur: MarkEvent = events[0]
  for (const e of events) {
    if (t >= e.time) cur = e
    else break
  }
  return cur
}

/** 兼容入口:事件 → 当前小节编号 */
export function measureAtTime(t: number, events: MarkEvent[]): number | null {
  const ev = eventAtTime(t, events)
  return ev !== null ? ev.n : null
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

// 平滑滚动状态(录制会话级)
let smoothX = 0
let smoothY = 0
let smoothInit = false
export function resetSmooth(): void {
  smoothInit = false
}

/** 渲染一帧到画布(画布尺寸 W×H)。offset 通过 lerp 平滑逼近目标,滚动连贯 */
export function renderFrame(ctx: CanvasRenderingContext2D, W: number, H: number, t: number, data: RenderData): void {
  const cur = measureAtTime(t, data.events)
  const curM = cur !== null ? data.measures.find((m) => m.n === cur) : undefined

  // ---- 目标 viewport 计算 ----
  let scale: number
  let targetX = 0
  let targetY = 0
  let dispW = W
  let dispH: number
  if (data.ratio === '单行' && curM) {
    const rowH = curM.bottom - curM.top
    scale = H / rowH
    const rowW = data.rightBorder - data.leftBorder
    dispW = rowW * scale
    if (dispW <= W) targetX = (W - dispW) / 2
    else targetX = clamp(((curM.x0 + curM.x1) / 2 - data.leftBorder) * scale - W / 2, 0, dispW - W)
    targetY = 0
    dispH = H
  } else if (data.ratio === '连滚') {
    scale = W / data.scoreW
    dispH = data.scoreH * scale
    if (dispH <= H) targetY = (H - dispH) / 2
    else targetY = (dispH - H) * (t / Math.max(data.totalDuration, 0.001))
    targetX = 0
  } else {
    scale = W / data.scoreW
    dispH = data.scoreH * scale
    if (dispH <= H) {
      targetY = (H - dispH) / 2
    } else {
      const cy = curM ? ((curM.top + curM.bottom) / 2) * scale : dispH / 2
      targetY = clamp(cy - H / 2, 0, dispH - H)
    }
    targetX = 0
  }

  // ---- 平滑插值 ----
  if (!smoothInit) {
    smoothX = targetX
    smoothY = targetY
    smoothInit = true
  } else {
    const k = 0.16
    smoothX += (targetX - smoothX) * k
    smoothY += (targetY - smoothY) * k
    if (Math.abs(targetX - smoothX) < 0.5) smoothX = targetX
    if (Math.abs(targetY - smoothY) < 0.5) smoothY = targetY
  }
  const offsetX = smoothX
  const offsetY = smoothY

  // ---- 背景 ----
  ctx.fillStyle = '#f4f4f1'
  ctx.fillRect(0, 0, W, H)

  // ---- 曲谱 ----
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  if (data.pre) {
    // 预渲染整图:与画布同尺度,直接裁剪绘制
    ctx.drawImage(data.pre, offsetX, offsetY, W, H, 0, 0, W, H)
  } else {
    const sx = offsetX / scale
    const sy = offsetY / scale
    ctx.drawImage(data.img, sx, sy, W / scale, H / scale, 0, 0, W, H)
  }

  const tx = (ix: number): number => ix * scale - offsetX
  const ty = (iy: number): number => iy * scale - offsetY

  // ---- 标线与编号(仅软件内显示,尺寸随分辨率缩放) ----
  if (data.showAnnotations) {
    const k = annotScale(data.scoreW)
    ctx.strokeStyle = '#378ADD'
    ctx.lineWidth = data.lineWidth * k
    ctx.beginPath()
    for (const y of sortedLines(data.hLines)) {
      ctx.moveTo(tx(data.leftBorder), ty(y))
      ctx.lineTo(tx(data.rightBorder), ty(y))
    }
    ctx.stroke()

    for (const v of data.vLines) {
      const [top, bottom] = v.kind === 'full' ? [0, data.scoreH] : rowBounds(data.hLines, v.row, data.scoreH)
      ctx.strokeStyle = v.kind === 'full' ? '#185FA5' : '#378ADD'
      ctx.lineWidth = (v.kind === 'full' ? data.lineWidth + 1 : data.lineWidth) * k
      ctx.beginPath()
      ctx.moveTo(tx(v.x), ty(top))
      ctx.lineTo(tx(v.x), ty(bottom))
      ctx.stroke()
    }

    ctx.font = `500 ${13 * k}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (const m of data.measures) {
      const bx = tx(m.x0 + 3 * k)
      const by = ty(m.top + 3 * k)
      if (bx < -40 || bx > W + 40 || by < -40 || by > H + 40) continue
      ctx.fillStyle = 'rgba(55,138,221,0.14)'
      ctx.strokeStyle = 'rgba(55,138,221,0.55)'
      ctx.lineWidth = 1
      roundRect(ctx, bx, by, 22 * k, 17 * k, 3 * k)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = '#0C447C'
      ctx.fillText(String(m.n), tx(m.x0 + 14 * k), ty(m.top + 12 * k))
    }
  }

  // ---- 跟随指示(视频中也显示) ----
  if (curM) {
    const bx = tx(curM.x0)
    const by = ty(curM.top)
    const bw = (curM.x1 - curM.x0) * scale
    const bh = (curM.bottom - curM.top) * scale
    if (data.mode === 'jump') {
      // 跳框:当前小节主色高亮 + 下一小节淡色预备提示(浓度可调)
      const op = clamp(data.jumpOpacity, 0.02, 0.9)
      ctx.fillStyle = hexToRgba(data.jumpColor, op)
      ctx.strokeStyle = hexToRgba(data.jumpColor, 0.95)
      ctx.lineWidth = 4
      roundRect(ctx, bx, by, bw, bh, 4)
      ctx.fill()
      ctx.stroke()
      // 下一小节(预备):独立颜色与浓度 + 虚线边框
      const next = data.measures.find((m) => m.n === curM.n + 1)
      if (next) {
        const nx = tx(next.x0)
        const ny = ty(next.top)
        const nw = (next.x1 - next.x0) * scale
        const nh = (next.bottom - next.top) * scale
        ctx.fillStyle = hexToRgba(data.nextColor, clamp(data.nextOpacity, 0.02, 0.9))
        ctx.strokeStyle = hexToRgba(data.nextColor, 0.55)
        ctx.lineWidth = 2
        ctx.setLineDash([12, 9])
        roundRect(ctx, nx, ny, nw, nh, 4)
        ctx.fill()
        ctx.stroke()
        ctx.setLineDash([])
      }
    } else {
      // 连续:小节内匀速光标线(颜色/粗细可自定义);按"当前事件"推进(反复段落第二遍重新走)
      const ev = eventAtTime(t, data.events)
      let prog = 0
      if (ev) {
        const idx = data.events.indexOf(ev)
        const start = ev.time
        const end = data.events[idx + 1]?.time ?? data.totalDuration
        prog = clamp((t - start) / Math.max(end - start, 0.01), 0, 1)
      }
      const cursorX = bx + bw * prog
      ctx.strokeStyle = data.cursorColor
      ctx.lineWidth = data.cursorWidth
      ctx.beginPath()
      ctx.moveTo(cursorX, by)
      ctx.lineTo(cursorX, by + bh)
      ctx.stroke()
    }
  }

  ctx.textAlign = 'start'
  ctx.textBaseline = 'alphabetic'
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** hex 颜色 → rgba 字符串(带透明度) */
function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

/** 录制:播放音频并逐帧渲染(30fps 节流),返回含音画的 webm blob */
export async function recordVideo(
  data: RenderData,
  onProgress: (ratio: number) => void
): Promise<{ blob: Blob; duration: number }> {
  const { w: W, h: H } = RATIO_SIZES[data.ratio]
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  // 非单行模式:预渲染整图(宽度=输出宽),滚动时 1:1 采样,性能更好
  if (data.ratio !== '单行') {
    const scale = W / data.scoreW
    const preH = Math.max(1, Math.round(data.scoreH * scale))
    const pre = document.createElement('canvas')
    pre.width = W
    pre.height = preH
    const pctx = pre.getContext('2d')
    if (pctx) {
      pctx.fillStyle = '#ffffff'
      pctx.fillRect(0, 0, W, preH)
      pctx.drawImage(data.img, 0, 0, data.scoreW, data.scoreH, 0, 0, W, preH)
      data.pre = pre
    }
  }

  resetSmooth()

  const audio = getAudio()
  audio.currentTime = 0

  // 60fps 捕获,提高光标跟随流畅度
  const videoStream = canvas.captureStream(60)
  const withCapture = audio as HTMLAudioElement & { captureStream?: () => MediaStream }
  const audioStream = typeof withCapture.captureStream === 'function' ? withCapture.captureStream() : null
  const stream = new MediaStream([
    ...videoStream.getVideoTracks(),
    ...(audioStream ? audioStream.getAudioTracks() : [])
  ])

  const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) =>
    MediaRecorder.isTypeSupported(m)
  )
  if (!mime) throw new Error('当前环境不支持 webm 录制')
  // 高码率保证清晰度(1080p 60fps 静态画面)
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
  const chunks: Blob[] = []
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const duration = data.totalDuration
  if (duration <= 0) throw new Error('音频时长无效')

  await audio.play()
  rec.start(500)

  await new Promise<void>((resolve) => {
    let last = 0
    const loop = (ts: number): void => {
      const t = audio.currentTime
      if (ts - last >= 16) {
        // 60fps 渲染
        last = ts
        renderFrame(ctx, W, H, t, data)
      }
      onProgress(Math.min(t / duration, 1))
      if (audio.ended || t >= duration - 0.05) {
        resolve()
        return
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  })

  await new Promise<void>((resolve) => {
    rec.onstop = () => resolve()
    rec.stop()
  })
  audio.pause()

  const blob = new Blob(chunks, { type: 'video/webm' })
  return { blob, duration }
}

/** Blob → base64 */
export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
