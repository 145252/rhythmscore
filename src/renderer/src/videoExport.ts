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
export type VideoRatio = '单行' | '9:16' | '16:9'
/** 颜色进度遮罩范围 */
export type TrailRange = 'measure' | 'row' | 'score'

export const RATIO_SIZES: Record<VideoRatio, { w: number; h: number }> = {
  单行: { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '16:9': { w: 1920, h: 1080 }
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
  /** 标线颜色(横线/竖线/编号框统一跟随) */
  markLineColor: string
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
  /** 光标线浓度(0.2~1,颜色深浅) */
  cursorOpacity: number
  /** 颜色进度:光标走过区域覆盖同色遮罩 */
  cursorTrail: boolean
  /** 颜色进度遮罩浓度 */
  cursorTrailOpacity: number
  /** 颜色进度覆盖范围:measure=当前小节 / row=整行 / score=整个曲谱(已播放部分) */
  cursorTrailRange: TrailRange
  /** 拍号细分:开启后光标按每拍实际拍距走 */
  beatSubdivision: boolean
  beatsPerMeasure: number
  beatRatiosByMeasure: Record<number, number[]>
  /** 拍点小球:光标线上方跟随每拍起点跳动 */
  cursorBall: boolean
  /** 免费版:导出时叠加动态移动水印(专业版 false) */
  watermark: boolean
  /** 视频背景:original=原样 / white / black / transparent=透明通道(WebM) */
  background: 'original' | 'white' | 'black' | 'transparent'
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

/** 等分拍线比例(拍数 N → N-1 条) */
export function defaultBeatRatios(count: number): number[] {
  const ratios: number[] = []
  for (let i = 1; i < count; i++) ratios.push(i / count)
  return ratios
}

/** 取某小节的拍线比例(缺失=无拍线) */
export function beatRatiosFor(byMeasure: Record<number, number[]>, n: number, _beatsPerMeasure: number): number[] {
  return byMeasure[n] ?? []
}

/** 当前拍起点比例(分拍时返回该拍起点位置,无分拍返回 null) */
export function currentBeatStart(prog: number, beatsPerMeasure: number, beatRatios: number[]): number | null {
  const n = beatsPerMeasure
  if (n < 2 || beatRatios.length !== n - 1) return null
  const sorted = [0, ...beatRatios, 1].slice().sort((a, b) => a - b)
  const p = clamp(prog, 0, 0.999999)
  const beat = Math.min(Math.floor(p * n), n - 1)
  return sorted[beat]
}

/**
 * 拍点小球:在一个拍段内做抛物线飞行——从拍段起点起跳,弧线飞到拍段终点落下。
 * segStart/segEnd = 拍段起止 x(无分拍=小节左右边界;有分拍=相邻拍线/小节边界);
 * local = 拍内进度(0→1);arcH = 弧线高度;u=0 起点贴线、u=1 终点贴线。
 */
export function ballPos(
  segStart: number,
  segEnd: number,
  local: number,
  baseY: number,
  arcH: number
): { x: number; y: number } {
  const u = clamp(local, 0, 1)
  return { x: segStart + (segEnd - segStart) * u, y: baseY - arcH * 4 * u * (1 - u) }
}

/**
 * 按拍号细分计算光标在小节内的位置比例:
 * 拍线默认等分,可手动微调;光标在每拍区间内匀速,但各拍宽度不同 → 光标按实际拍距走。
 */
export function beatCursorRatio(prog: number, beatsPerMeasure: number, beatRatios: number[]): number {
  const n = beatsPerMeasure
  if (n < 2 || beatRatios.length !== n - 1) return prog
  // 拍边界比例(拖动态可能轻微乱序,排序兜底)
  const sorted = [0, ...beatRatios, 1].slice().sort((a, b) => a - b)
  const p = clamp(prog, 0, 0.999999)
  const beat = Math.min(Math.floor(p * n), n - 1)
  const r0 = sorted[beat]
  const r1 = sorted[beat + 1]
  const local = p * n - beat
  return r0 + (r1 - r0) * local
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

// 平滑滚动状态(录制会话级)
let smoothX = 0
let smoothY = 0
let smoothInit = false
// 跳框淡入淡出状态(切换小节时从 0 淡入)
let jumpFade = 0
let jumpLastN = -1
export function resetSmooth(): void {
  smoothInit = false
  jumpFade = 0
  jumpLastN = -1
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
  } else {
    // 整谱跟随:铺满宽度,视口跟随当前小节垂直居中滚动(16:9 / 9:16)
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

  // ---- 背景(透明通道:清空画布防残影堆叠;其他:填充背景色) ----
  if (data.background === 'transparent') {
    ctx.clearRect(0, 0, W, H)
  } else {
    ctx.fillStyle =
      data.background === 'black'
        ? '#000'
        : data.background === 'white'
          ? '#fff'
            : '#f4f4f1'
    ctx.fillRect(0, 0, W, H)
  }

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
    ctx.strokeStyle = data.markLineColor
    ctx.lineWidth = data.lineWidth * k
    ctx.beginPath()
    for (const y of sortedLines(data.hLines)) {
      ctx.moveTo(tx(data.leftBorder), ty(y))
      ctx.lineTo(tx(data.rightBorder), ty(y))
    }
    ctx.stroke()

    for (const v of data.vLines) {
      const [top, bottom] = v.kind === 'full' ? [0, data.scoreH] : rowBounds(data.hLines, v.row, data.scoreH)
      ctx.strokeStyle = data.markLineColor
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
      ctx.fillStyle = hexToRgba(data.markLineColor, 0.14)
      ctx.strokeStyle = hexToRgba(data.markLineColor, 0.55)
      ctx.lineWidth = 1
      roundRect(ctx, bx, by, 22 * k, 17 * k, 3 * k)
      ctx.fill()
      ctx.stroke()
      ctx.fillStyle = data.markLineColor
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
      // 跳框:发光玻璃框(外发光+上浅下深渐变填充+顶部高光),切换小节平滑淡入
      if (jumpLastN !== curM.n) {
        jumpLastN = curM.n
        jumpFade = 0
      }
      jumpFade = Math.min(1, jumpFade + 0.07)
      const fade = 1 - (1 - jumpFade) * (1 - jumpFade)
      const op = clamp(data.jumpOpacity, 0.02, 0.9) * fade

      // 外发光(细)
      ctx.lineCap = 'round'
      ctx.strokeStyle = hexToRgba(data.jumpColor, 0.2 * fade)
      ctx.lineWidth = 7
      roundRect(ctx, bx, by, bw, bh, 6)
      ctx.stroke()

      // 渐变填充 + 主描边(细)
      const g = ctx.createLinearGradient(0, by, 0, by + bh)
      g.addColorStop(0, hexToRgba(data.jumpColor, Math.min(op * 1.4, 0.75)))
      g.addColorStop(1, hexToRgba(data.jumpColor, op * 0.5))
      ctx.fillStyle = g
      ctx.strokeStyle = hexToRgba(data.jumpColor, 0.9 * fade)
      ctx.lineWidth = 1.6
      roundRect(ctx, bx, by, bw, bh, 6)
      ctx.fill()
      ctx.stroke()

      // 顶部高光
      if (bw > 20) {
        ctx.strokeStyle = hexToRgba(data.jumpColor, 0.4 * fade)
        ctx.lineWidth = 1.2
        ctx.beginPath()
        ctx.moveTo(bx + 8, by + 4)
        ctx.lineTo(bx + bw - 8, by + 4)
        ctx.stroke()
      }

      // 下一小节(预备):淡色虚线描边(跟随淡入)
      const next = data.measures.find((m) => m.n === curM.n + 1)
      if (next) {
        const nx = tx(next.x0)
        const ny = ty(next.top)
        const nw = (next.x1 - next.x0) * scale
        const nh = (next.bottom - next.top) * scale
        ctx.fillStyle = hexToRgba(data.nextColor, clamp(data.nextOpacity, 0.02, 0.9) * fade * 0.55)
        ctx.strokeStyle = hexToRgba(data.nextColor, 0.5 * fade)
        ctx.lineWidth = 2
        ctx.setLineDash([12, 9])
        roundRect(ctx, nx, ny, nw, nh, 6)
        ctx.fill()
        ctx.stroke()
        ctx.setLineDash([])
      }
      ctx.lineCap = 'butt'
    } else {
      // 连续:辉光光标线(轻光晕+纵向渐隐);按"当前事件"推进(反复段落第二遍重新走)
      const ev = eventAtTime(t, data.events)
      let prog = 0
      if (ev) {
        const idx = data.events.indexOf(ev)
        const start = ev.time
        const end = data.events[idx + 1]?.time ?? data.totalDuration
        prog = clamp((t - start) / Math.max(end - start, 0.01), 0, 1)
      }
      // 光标在小节内的位置比例(拍号细分开启时按每拍实际拍距走;拍数=拍线数+1)
      const curRatios = data.beatSubdivision ? beatRatiosFor(data.beatRatiosByMeasure, curM.n, data.beatsPerMeasure) : []
      const ratioInMeasure =
        data.beatSubdivision && curRatios.length >= 1
          ? beatCursorRatio(prog, curRatios.length + 1, curRatios)
          : prog
      const cursorX = bx + bw * ratioInMeasure
      const op = clamp(data.cursorOpacity, 0.2, 1)
      // 颜色进度:光标走过区域覆盖同色遮罩(范围:当前小节/整行/整谱已播放部分)
      if (data.cursorTrail) {
        const cursorScoreX = curM.x0 + (curM.x1 - curM.x0) * ratioInMeasure
        const regions = trailRegions(
          curM,
          cursorScoreX,
          data.cursorTrailRange,
          data.leftBorder,
          data.rightBorder,
          data.measures
        )
        if (regions.length > 0) {
          ctx.fillStyle = hexToRgba(data.cursorColor, clamp(data.cursorTrailOpacity, 0.02, 0.6))
          for (const r of regions) ctx.fillRect(tx(r.x), ty(r.y), r.w * scale, r.h * scale)
        }
      }
      ctx.lineCap = 'round'
      // 拍点小球:拍段内弧线飞行(起点起跳→终点落下);无分拍=整小节一个拍段,有分拍=每个拍线段
      if (data.cursorBall) {
        const n = curRatios.length + 1
        let segStart = bx
        let segEnd = bx + bw
        let local = prog
        if (data.beatSubdivision && curRatios.length >= 1) {
          const sorted = [0, ...curRatios, 1].slice().sort((a, b) => a - b)
          const beat = Math.min(Math.floor(prog * n), n - 1)
          segStart = bx + bw * sorted[beat]
          segEnd = bx + bw * sorted[beat + 1]
          local = prog * n - beat
        }
        const arcH = Math.max(30, bh * 0.3)
        const pos = ballPos(segStart, segEnd, local, by, arcH)
        const rad = Math.max(11, data.cursorWidth * 2.2)
        const ballY = pos.y - rad * 0.6
        ctx.beginPath()
        ctx.arc(pos.x, ballY, rad, 0, Math.PI * 2)
        ctx.fillStyle = hexToRgba(data.cursorColor, 0.95)
        ctx.fill()
        ctx.lineWidth = Math.max(2, rad * 0.22)
        ctx.strokeStyle = 'rgba(255,255,255,0.92)'
        ctx.stroke()
      }
      // 轻光晕(弱化)
      ctx.strokeStyle = hexToRgba(data.cursorColor, 0.07 * op)
      ctx.lineWidth = data.cursorWidth * 2.2
      ctx.beginPath()
      ctx.moveTo(cursorX, by)
      ctx.lineTo(cursorX, by + bh)
      ctx.stroke()
      // 主纯色线(无渐变;浓度=不透明度,100% 实色)
      ctx.strokeStyle = hexToRgba(data.cursorColor, op)
      ctx.lineWidth = data.cursorWidth
      ctx.beginPath()
      ctx.moveTo(cursorX, by)
      ctx.lineTo(cursorX, by + bh)
      ctx.stroke()
      ctx.lineCap = 'butt'
    }
  }

  ctx.textAlign = 'start'
  ctx.textBaseline = 'alphabetic'

  // ---- 免费版水印:小尺寸低透明 + 画面中带小范围缓慢游走(尽量不遮挡谱面) ----
  if (data.watermark) {
    const f = Math.max(W, H)
    ctx.save()
    ctx.font = `600 ${Math.round(f * 0.023)}px -apple-system, "PingFang SC", sans-serif`
    const tw = ctx.measureText('RhythmScore').width
    const th = f * 0.028
    // 只在画面中带的小区域(横 30%→70%,竖 30%→70%)内缓慢移动
    const rangeX = Math.max((W - tw) * 0.4, 1)
    const rangeY = Math.max((H - th) * 0.4, 1)
    const px = W * 0.3 + ((t * 0.03 * rangeX) % rangeX)
    const py = H * 0.3 + ((t * 0.024 * rangeY) % rangeY)
    ctx.translate(px, py)
    ctx.rotate(-0.08)
    ctx.lineJoin = 'round'
    ctx.strokeStyle = 'rgba(15,25,45,0.22)'
    ctx.lineWidth = Math.max(1.8, f * 0.0025)
    ctx.strokeText('RhythmScore', 0, 0)
    ctx.fillStyle = 'rgba(255,255,255,0.34)'
    ctx.fillText('RhythmScore', 0, 0)
    ctx.restore()
  }
}

/** 行边界分段(整谱纵向按横线划成若干行):返回 [{top,bottom}] */
export function rowSpans(hLines: number[], scoreH: number): { top: number; bottom: number }[] {
  const ys = [...hLines].sort((a, b) => a - b)
  const bounds = [0, ...ys, scoreH]
  const spans: { top: number; bottom: number }[] = []
  for (let i = 0; i < bounds.length - 1; i++) {
    if (bounds[i + 1] - bounds[i] > 1) spans.push({ top: bounds[i], bottom: bounds[i + 1] })
  }
  return spans
}

/** 颜色进度遮罩区域(画布坐标矩形列表;按覆盖范围:小节/整行/整谱已播放部分) */
export function trailRegions(
  m: { x0: number; x1: number; top: number; bottom: number; n: number },
  cursorX: number,
  range: TrailRange,
  leftBorder: number,
  rightBorder: number,
  measures: { n: number; x0: number; x1: number; top: number; bottom: number }[]
): { x: number; y: number; w: number; h: number }[] {
  if (cursorX <= m.x0) return []
  if (range === 'measure') {
    return [{ x: m.x0, y: m.top, w: cursorX - m.x0, h: m.bottom - m.top }]
  }
  if (range === 'row') {
    // 当前小节所在整行:行首(左边框)到光标线
    return [{ x: leftBorder, y: m.top, w: cursorX - leftBorder, h: m.bottom - m.top }]
  }
  // score:已完整演奏的小节逐个填满自身矩形(空拍/空白跳过)+ 当前小节填到光标
  const regions: { x: number; y: number; w: number; h: number }[] = []
  for (const mm of measures) {
    if (mm.n >= m.n) break
    regions.push({ x: mm.x0, y: mm.top, w: mm.x1 - mm.x0, h: mm.bottom - mm.top })
  }
  regions.push({ x: m.x0, y: m.top, w: cursorX - m.x0, h: m.bottom - m.top })
  return regions
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
      if (data.background !== 'transparent') {
        pctx.fillStyle = '#ffffff'
        pctx.fillRect(0, 0, W, preH)
      }
      pctx.drawImage(data.img, 0, 0, data.scoreW, data.scoreH, 0, 0, W, preH)
      data.pre = pre
    }
  }

  resetSmooth()

  const audio = getAudio()
  audio.currentTime = 0

  // 30fps 捕获:高清全量绘制下比 60fps 稳定得多,光标不掉帧(视频标准帧率,视觉依然平滑)
  const videoStream = canvas.captureStream(30)
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
  // 码率保证清晰度(1080p 30fps 静态画面)
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
      if (ts - last >= 33) {
        // 30fps 渲染(与录制帧率一致,稳定不掉帧)
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
export async function blobToBase64(blob: Blob): Promise<string> {  const buf = new Uint8Array(await blob.arrayBuffer())
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** 透明通道录制:逐帧渲染 → PNG → 写盘(串行),返回帧目录 id;由主进程编码 VP9 alpha WebM */
export async function recordVideoAlpha(
  data: RenderData,
  onProgress: (ratio: number) => void
): Promise<{ dirId: string; duration: number }> {
  const { w: W, h: H } = RATIO_SIZES[data.ratio]
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  // 非单行:预渲染整图(透明时不含白色背景)
  if (data.ratio !== '单行') {
    const scale = W / data.scoreW
    const preH = Math.max(1, Math.round(data.scoreH * scale))
    const pre = document.createElement('canvas')
    pre.width = W
    pre.height = preH
    const pctx = pre.getContext('2d')
    if (pctx) {
      if (data.background !== 'transparent') {
        pctx.fillStyle = '#ffffff'
        pctx.fillRect(0, 0, W, preH)
      }
      pctx.drawImage(data.img, 0, 0, data.scoreW, data.scoreH, 0, 0, W, preH)
      data.pre = pre
    }
  }

  resetSmooth()
  const audio = getAudio()
  audio.currentTime = 0

  const dirId = await window.api!.beginAlphaFrames()
  const FPS = 24
  const duration = data.totalDuration
  if (duration <= 0) throw new Error('音频时长无效')

  await audio.play()

  await new Promise<void>((resolve) => {
    let frame = 0
    let last = 0
    let pending = 0
    let done = false
    const finish = (): void => {
      if (done && pending === 0) resolve()
    }
    const loop = (ts: number): void => {
      const t = audio.currentTime
      if (ts - last >= 1000 / FPS) {
        last = ts
        const idx = frame
        frame++
        pending++
        renderFrame(ctx, W, H, t, data)
        canvas.toBlob((blob) => {
          void (async () => {
            try {
              if (blob) {
                const buf = await blob.arrayBuffer()
                await window.api!.writeAlphaFrame(dirId, idx, buf)
              }
            } catch {
              /* 单帧失败跳过 */
            } finally {
              pending--
              finish()
            }
          })()
        }, 'image/png')
        onProgress(Math.min(t / duration, 1))
      }
      if (audio.ended || t >= duration - 0.05) {
        done = true
        finish()
        return
      }
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
    // 兜底:最后一帧写盘超时强制结束
    setTimeout(() => resolve(), Math.ceil(duration * 1000) + 30000)
  })

  audio.pause()
  return { dirId, duration }
}
