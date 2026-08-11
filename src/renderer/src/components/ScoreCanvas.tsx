import React, { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, FileUp, Layers, Maximize2, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { useStore } from '../store'
import { nearestHLine, nearestVLine, rowAt, rowBounds, rowCount, sortedLines, annotScale } from '../geometry'
import { loadPdfDoc, renderPdfPageDoc } from '../pdf'
import { mergePages, type PageImage } from '../merge'
import { getAudio } from '../audioPlayer'
import { ballPos, beatCursorRatio, beatRatiosFor, buildMeasures, eventAtTime, measureAtTime, trailRegions } from '../videoExport'
import { detectMeasureLines } from '../scoreDetect'
import type { ScoreSource } from '../types'

type DragState =
  | { kind: 'moveH'; sortedIdx: number; sy: number; origY: number }
  | { kind: 'moveV'; id: string; sx: number; origX: number }
  | { kind: 'moveBeat'; measureN: number; index: number; sx: number; origRatio: number; m: { x0: number; x1: number } }
  | null

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

/** hex 颜色 → rgba(带透明度),供 SVG 高亮使用 */
function rgba(hex: string, a: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

function readAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = reject
    fr.readAsDataURL(file)
  })
}

function loadImageEl(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// ---------- 导入:文件 → 页面 ----------
const SUPPORTED_EXTS = ['jpg', 'jpeg', 'png', 'pdf']

interface RawScoreFile {
  name: string
  ext: string
  dataUrl?: string
  pdfData?: ArrayBuffer
}

/** 把原始文件转换为页面(图片=1页,PDF=每页一图);不支持的格式被跳过 */
async function filesToPages(files: RawScoreFile[]): Promise<{ pages: PageImage[]; skipped: string[] }> {
  const pages: PageImage[] = []
  const skipped: string[] = []
  for (const f of files) {
    if (!SUPPORTED_EXTS.includes(f.ext)) {
      skipped.push(f.name)
      continue
    }
    if (f.ext === 'pdf' && f.pdfData) {
      const doc = await loadPdfDoc(new Uint8Array(f.pdfData))
      for (let p = 1; p <= doc.numPages; p++) {
        const r = await renderPdfPageDoc(doc, p)
        pages.push({ name: `${f.name} · 第${p}页`, dataUrl: r.dataUrl, width: r.width, height: r.height })
      }
      void doc.destroy()
    } else if (f.dataUrl) {
      const img = await loadImageEl(f.dataUrl)
      pages.push({ name: f.name, dataUrl: f.dataUrl, width: img.naturalWidth, height: img.naturalHeight })
    }
  }
  return { pages, skipped }
}

/** File(浏览器) → RawScoreFile */
async function fileToRaw(file: File): Promise<RawScoreFile> {
  const ext = (file.name.split('.').pop() ?? '').toLowerCase()
  if (ext === 'pdf') {
    return { name: file.name, ext, pdfData: await file.arrayBuffer() }
  }
  const dataUrl = await readAsDataURL(file)
  return { name: file.name, ext, dataUrl }
}

export default function ScoreCanvas(): React.JSX.Element {
  const score = useStore((s) => s.score)
  const hLines = useStore((s) => s.hLines)
  const vLines = useStore((s) => s.vLines)
  const tool = useStore((s) => s.tool)
  const lineWidth = useStore((s) => s.lineWidth)
  const selected = useStore((s) => s.selected)
  const scale = useStore((s) => s.scale)
  const currentMeasure = useStore((s) => s.currentMeasure)
  const markEvents = useStore((s) => s.markEvents)

  const setScore = useStore((s) => s.setScore)
  const addHLine = useStore((s) => s.addHLine)
  const addVLine = useStore((s) => s.addVLine)
  const updateHLine = useStore((s) => s.updateHLine)
  const updateVLine = useStore((s) => s.updateVLine)
  const removeLine = useStore((s) => s.removeLine)
  const setSelected = useStore((s) => s.setSelected)
  const setScale = useStore((s) => s.setScale)
  const selectMeasure = useStore((s) => s.selectMeasure)
  const addMarkEvent = useStore((s) => s.addMarkEvent)
  const marking = useStore((s) => s.marking)
  const markingNext = useStore((s) => s.markingNext)
  const cursorColor = useStore((s) => s.cursorColor)
  const cursorOpacity = useStore((s) => s.cursorOpacity)
  const cursorTrail = useStore((s) => s.cursorTrail)
  const cursorTrailOpacity = useStore((s) => s.cursorTrailOpacity)
  const beatSubdivision = useStore((s) => s.beatSubdivision)
  const beatsPerMeasure = useStore((s) => s.beatsPerMeasure)
  const beatRatiosByMeasure = useStore((s) => s.beatRatiosByMeasure)
  const setBeatRatio = useStore((s) => s.setBeatRatio)
  const addBeatLine = useStore((s) => s.addBeatLine)
  const removeBeatLine = useStore((s) => s.removeBeatLine)
  const markLineColor = useStore((s) => s.markLineColor)
  const videoMode = useStore((s) => s.videoMode)
  const jumpColor = useStore((s) => s.jumpColor)
  const jumpOpacity = useStore((s) => s.jumpOpacity)
  const nextColor = useStore((s) => s.nextColor)
  const nextOpacity = useStore((s) => s.nextOpacity)
  const snapEnabled = useStore((s) => s.snapEnabled)
  const measureLabel = useStore((s) => s.measureLabel)
  const scorePages = useStore((s) => s.scorePages)
  const reorderScorePage = useStore((s) => s.reorderScorePage)
  const removeScorePage = useStore((s) => s.removeScorePage)

  const scrollRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const cursorLineRef = useRef<SVGLineElement>(null)
  const cursorGlowRef = useRef<SVGLineElement>(null)
  const cursorBallRef = useRef<SVGCircleElement>(null)
  const trailRectsRef = useRef<(SVGRectElement | null)[]>([])
  /** 颜色进度遮罩最多支持的行数(整谱模式每行一个矩形,一般不会超过) */
  const MAX_TRAIL_RECTS = 24
  const [drag, setDrag] = useState<DragState>(null)
  const [erasing, setErasing] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  /** 鼠标悬停位置(图片坐标),用于虚拟预览线 */
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)
  /** 识别出的五线谱小节线位置(每行一个列表),吸附用 */
  const [detectLines, setDetectLines] = useState<number[][] | null>(null)
  /** 正在修改编号的小节 */
  const [editEvents, setEditEvents] = useState<Measure | null>(null)
  /** 页面顺序弹窗 */
  const [pageOrderOpen, setPageOrderOpen] = useState(false)
  const adjustMarkEventByIndex = useStore((s) => s.adjustMarkEventByIndex)
  const setMarkEventNumber = useStore((s) => s.setMarkEventNumber)
  const setMarkEventTime = useStore((s) => s.setMarkEventTime)
  const removeMarkEvent = useStore((s) => s.removeMarkEvent)

  // ---------- 导入(多文件/追加/替换) ----------
  const [askPdf, setAskPdf] = useState<PageImage[] | null>(null)

  const applyImport = useCallback(async (pages: PageImage[], hasPdf: boolean): Promise<void> => {
    const st = useStore.getState()
    if (!st.score) {
      // 首次导入:直接显示
      await st.setScorePages(pages)
      return
    }
    if (hasPdf) {
      // 已有曲谱 + PDF:弹窗选择"替换 / 追加到下方"
      setAskPdf(pages)
      return
    }
    // 已有曲谱 + 图片:追加到下方(不顶替)
    await st.setScorePages([...st.scorePages, ...pages])
  }, [])

  const handleImport = useCallback(
    async (rawFiles: RawScoreFile[]): Promise<void> => {
      if (rawFiles.length === 0) return
      const { pages, skipped } = await filesToPages(rawFiles)
      if (skipped.length) {
        window.alert(`以下文件不是支持的格式(仅 jpg/png/pdf),已跳过:\n${skipped.join('\n')}`)
      }
      if (pages.length === 0) return
      const hasPdf = rawFiles.some((f) => f.ext === 'pdf')
      await applyImport(pages, hasPdf)
    },
    [applyImport]
  )

  /** 浏览器 File 导入(文件选择/拖拽) */
  const importBrowserFiles = useCallback(
    async (files: File[]): Promise<void> => {
      const raws: RawScoreFile[] = []
      for (const f of files) raws.push(await fileToRaw(f))
      await handleImport(raws)
    },
    [handleImport]
  )

  const pickFile = useCallback(() => {
    if (window.api?.isElectron) {
      window.api.openScoreFile().then(async (r) => {
        if (!r || !r.files.length) return
        const raws: RawScoreFile[] = []
        for (const f of r.files) {
          if (f.ext === 'pdf') {
            raws.push({ name: f.name, ext: f.ext, pdfData: base64ToUint8(f.dataBase64).buffer as ArrayBuffer })
          } else {
            const mime = f.ext === 'jpg' ? 'jpeg' : 'png'
            raws.push({ name: f.name, ext: f.ext, dataUrl: `data:image/${mime};base64,${f.dataBase64}` })
          }
        }
        await handleImport(raws)
      })
    } else {
      fileInputRef.current?.click()
    }
  }, [handleImport])

  // ---------- 视口:铺满宽度 + 垂直滚动 ----------
  const fitWidth = useCallback(() => {
    const el = scrollRef.current
    const st = useStore.getState()
    if (!el || !st.score) return
    const s = clamp((el.clientWidth - 24) / st.score.width, 0.05, 4)
    st.setScale(s)
  }, [])

  useEffect(() => {
    if (score) fitWidth()
  }, [score?.dataUrl, fitWidth])

  const zoomBy = useCallback((factor: number) => {
    const st = useStore.getState()
    st.setScale(clamp(st.scale * factor, 0.05, 6))
  }, [])

  // 删除键
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault()
        removeLine(selected)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, removeLine])

  // 播放预览光标线:对点完成后,软件内实时显示辉光光标(光晕+渐变线+菱形指针;按事件序列=反复自动跳回)
  useEffect(() => {
    if (!score || markEvents.length === 0) return
    const measuresList = buildMeasures(hLines, vLines, score.width, score.height)
    let raf = 0
    const hideAll = (): void => {
      for (const x of [cursorGlowRef.current, cursorLineRef.current, cursorBallRef.current]) {
        if (x) x.setAttribute('visibility', 'hidden')
      }
      for (const r of trailRectsRef.current) {
        if (r) r.setAttribute('visibility', 'hidden')
      }
    }
    const loop = (): void => {
      const st = useStore.getState()
      // 跳框模式:无光标线(连续模式下对点完成后始终显示,便于预览)
      if (st.videoMode === 'jump') {
        hideAll()
        raf = requestAnimationFrame(loop)
        return
      }
      const t = getAudio().currentTime
      const ev = eventAtTime(t, st.markEvents)
      const cur = ev !== null ? ev.n : null
      const m = cur !== null ? measuresList.find((mm) => mm.n === cur) : undefined
      const glow = cursorGlowRef.current
      const el = cursorLineRef.current
      if (glow && el && m && ev && st.score) {
        // 按"当前事件"计算小节内进度(反复段落第二遍从该小节起点重新走)
        const idx = st.markEvents.indexOf(ev)
        const start = ev.time
        const end = st.markEvents[idx + 1]?.time ?? st.audioDuration
        const prog = clamp((t - start) / Math.max(end - start, 0.01), 0, 1)
        // 拍号细分开启时,光标按每拍实际拍距走(该小节独立拍线,拍数=拍线数+1)
        const curRatios = st.beatSubdivision ? beatRatiosFor(st.beatRatiosByMeasure, m.n, st.beatsPerMeasure) : []
        const ratioInMeasure =
          st.beatSubdivision && curRatios.length >= 1
            ? beatCursorRatio(prog, curRatios.length + 1, curRatios)
            : prog
        const cx = m.x0 + (m.x1 - m.x0) * ratioInMeasure
        const cw = clamp((st.cursorWidth * st.score.width) / 1920, 1, 40)
        // 轻光晕
        glow.setAttribute('x1', String(cx))
        glow.setAttribute('x2', String(cx))
        glow.setAttribute('y1', String(m.top))
        glow.setAttribute('y2', String(m.bottom))
        glow.setAttribute('stroke-width', String(cw * 2.2))
        glow.setAttribute('visibility', 'visible')
        // 主渐变线(浓度由渐变定义控制)
        el.setAttribute('x1', String(cx))
        el.setAttribute('x2', String(cx))
        el.setAttribute('y1', String(m.top))
        el.setAttribute('y2', String(m.bottom))
        el.setAttribute('stroke-width', String(cw))
        el.setAttribute('visibility', 'visible')
        // 拍点小球:拍段内弧线飞行(起点起跳→终点落下);无分拍=整小节,有分拍=每个拍线段
        const ball = cursorBallRef.current
        if (ball) {
          if (st.cursorBall) {
            const n = curRatios.length + 1
            let segStart = m.x0
            let segEnd = m.x1
            let local = prog
            if (st.beatSubdivision && curRatios.length >= 1) {
              const sorted = [0, ...curRatios, 1].slice().sort((a, b) => a - b)
              const beat = Math.min(Math.floor(prog * n), n - 1)
              segStart = m.x0 + (m.x1 - m.x0) * sorted[beat]
              segEnd = m.x0 + (m.x1 - m.x0) * sorted[beat + 1]
              local = prog * n - beat
            }
            const arcH = Math.max(24, cw * 5)
            const pos = ballPos(segStart, segEnd, local, m.top, arcH)
            const rad = Math.max(10, cw * 2.2)
            ball.setAttribute('cx', String(pos.x))
            ball.setAttribute('cy', String(pos.y - rad * 0.6))
            ball.setAttribute('r', String(rad))
            ball.setAttribute('fill', st.cursorColor)
            ball.setAttribute('visibility', 'visible')
          } else {
            ball.setAttribute('visibility', 'hidden')
          }
        }
        // 颜色进度:光标走过区域覆盖同色遮罩(范围:当前小节/整行/整谱已播放部分)
        const fullXs = st.vLines.filter((v) => v.kind === 'full').map((v) => v.x)
        const leftB = fullXs.length ? Math.min(...fullXs) : 0
        const rightB = fullXs.length ? Math.max(...fullXs) : st.score.width
        const regions = st.cursorTrail
          ? trailRegions(m, cx, st.cursorTrailRange, leftB, rightB, measuresList)
          : []
        for (let i = 0; i < MAX_TRAIL_RECTS; i++) {
          const rect = trailRectsRef.current[i]
          if (!rect) continue
          const reg = regions[i]
          if (reg) {
            rect.setAttribute('x', String(reg.x))
            rect.setAttribute('y', String(reg.y))
            rect.setAttribute('width', String(reg.w))
            rect.setAttribute('height', String(reg.h))
            rect.setAttribute('fill', st.cursorColor)
            rect.setAttribute('fill-opacity', String(clamp(st.cursorTrailOpacity, 0.02, 0.6)))
            rect.setAttribute('visibility', 'visible')
          } else {
            rect.setAttribute('visibility', 'hidden')
          }
        }
      } else {
        hideAll()
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score, hLines, vLines, markEvents])

  // ---------- 识别五线谱小节线(吸附目标;导入曲谱/画横线时重检测) ----------
  useEffect(() => {
    if (!score) {
      setDetectLines(null)
      return
    }
    let cancel = false
    void (async () => {
      const img = await loadImageEl(score.dataUrl).catch(() => null)
      if (cancel || !img) return
      const rows: { top: number; bottom: number }[] = []
      const cnt = rowCount(hLines)
      for (let r = 0; r < cnt; r++) {
        const [t, b] = rowBounds(hLines, r, score.height)
        rows.push({ top: t, bottom: b })
      }
      if (rows.length === 0) {
        setDetectLines([])
        return
      }
      const fullXs = vLines.filter((v) => v.kind === 'full').map((v) => v.x)
      const left = fullXs.length ? Math.min(...fullXs) : 0
      const right = fullXs.length ? Math.max(...fullXs) : score.width
      const res = await detectMeasureLines(img, rows, left, right)
      if (!cancel) setDetectLines(res)
    })()
    return () => {
      cancel = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score?.dataUrl, hLines])

  // ---------- 坐标与命中 ----------
  const toImage = (e: React.MouseEvent): { x: number; y: number } => {
    const rect = imgRef.current!.getBoundingClientRect()
    return {
      x: (e.clientX - rect.left) / scale,
      y: (e.clientY - rect.top) / scale
    }
  }

  /** 全局小节编号:根据 (x, y) 找到所在小节。行内边界 = 左右边框(full 线) + 行内小节线 */
  const measureNumberAt = useCallback(
    (x: number, y: number): number | null => {
      const st = useStore.getState()
      if (!st.score) return null
      const row = rowAt(st.hLines, y, st.score.height)
      const rows = rowCount(st.hLines)
      const fullXs = st.vLines.filter((v) => v.kind === 'full').map((v) => v.x)
      const leftBorder = fullXs.length ? Math.min(...fullXs) : 0
      const rightBorder = fullXs.length ? Math.max(...fullXs) : st.score.width
      let base = 0
      for (let r = 0; r < rows; r++) {
        const set = new Set<number>([leftBorder, rightBorder])
        st.vLines
          .filter((v) => v.kind === 'measure' && v.row === r)
          .forEach((v) => set.add(v.x))
        const xs = [...set].sort((a, b) => a - b)
        if (r === row) {
          for (let i = 0; i < xs.length - 1; i++) {
            if (x >= xs[i] && x <= xs[i + 1]) return base + i + 1
          }
          return null
        }
        base += Math.max(xs.length - 1, 0)
      }
      return null
    },
    []
  )

  /** 某行的吸附目标:识别的印刷小节线 + 该行已画的竖线(绝不跨行) */
  const snapTargetsForRow = (row: number): number[] => {
    const detected = detectLines?.[row] ?? []
    const own = vLines.filter((v) => v.kind === 'measure' && v.row === row).map((v) => v.x)
    return [...detected, ...own]
  }

  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0 || !score) return
    const { x, y } = toImage(e)
    if (tool === 'eraser') {
      // 橡皮擦:擦除命中的拍线/竖线/横线(可按住拖动连续擦)
      eraseAt(x, y)
      setErasing(true)
      return
    }
    if (tool === 'hline') {
      // 画线落点应用吸附(实时读取开关状态,避免闭包过期)
      const snapNow = useStore.getState().snapEnabled
      let yy = y
      if (snapNow) {
        const hv = nearestHLine(hLines, y, 24 / scale)
        if (hv !== null) yy = sortedLines(hLines)[hv]
      }
      addHLine(Math.round(yy))
      return
    }
    if (tool === 'vline') {
      // 拍号细分开启时:默认画"该小节内拍分线"(画哪放哪);Shift 仍画小节线
      if (beatSubdivision && !e.shiftKey) {
        const measuresList = buildMeasures(hLines, vLines, score.width, score.height)
        const m = measuresList.find((mm) => y >= mm.top && y <= mm.bottom && x >= mm.x0 && x <= mm.x1)
        if (m) {
          addBeatLine(m.n, (x - m.x0) / (m.x1 - m.x0))
          return
        }
      }
      // 无横线时自动画贯穿线(左右边框);有横线时默认画行内小节线,Shift 强制贯穿
      const kind: 'full' | 'measure' = hLines.length === 0 || e.shiftKey ? 'full' : 'measure'
      const row = kind === 'full' ? 0 : rowAt(hLines, y, score.height)
      const snapNow = useStore.getState().snapEnabled
      let xx = x
      if (snapNow) {
        const tol = 24 / scale
        const targets = kind === 'full' ? vLines.filter((v) => v.kind === 'full').map((v) => v.x) : snapTargetsForRow(row)
        let best: number | null = null
        let bestDist = Infinity
        for (const tx of targets) {
          const d = Math.abs(tx - x)
          if (d < bestDist) {
            bestDist = d
            best = tx
          }
        }
        if (best !== null && bestDist <= tol) xx = best
      }
      addVLine(Math.round(xx), row, kind)
      return
    }
    if (tool === 'select') {
      const tol = 12 / scale
      // 拍线命中(拍号细分开启时,优先于小节边界线;按小节独立)
      if (beatSubdivision) {
        const measuresList = buildMeasures(hLines, vLines, score.width, score.height)
        let bestIdx = -1
        let bestN = -1
        let bestM: { x0: number; x1: number } | null = null
        let bestD = Infinity
        for (const m of measuresList) {
          if (y < m.top || y > m.bottom) continue
          const ratios = beatRatiosFor(beatRatiosByMeasure, m.n, beatsPerMeasure)
          if (ratios.length === 0) continue
          for (let i = 0; i < ratios.length; i++) {
            const lx = m.x0 + (m.x1 - m.x0) * ratios[i]
            const d = Math.abs(lx - x)
            if (d < bestD) {
              bestD = d
              bestIdx = i
              bestN = m.n
              bestM = { x0: m.x0, x1: m.x1 }
            }
          }
        }
        if (bestIdx >= 0 && bestM && bestD <= tol) {
          setSelected(null)
          setDrag({
            kind: 'moveBeat',
            measureN: bestN,
            index: bestIdx,
            sx: e.clientX,
            origRatio: beatRatiosFor(beatRatiosByMeasure, bestN, beatsPerMeasure)[bestIdx],
            m: bestM
          })
          return
        }
      }
      const hv = nearestHLine(hLines, y, tol)
      const vv = nearestVLine(vLines, hLines, x, y, score.height, tol)
      if (vv && (hv === null || Math.abs(vv.x - x) <= Math.abs(sortedLines(hLines)[hv] - y))) {
        setSelected({ type: 'v', id: vv.id })
        setDrag({ kind: 'moveV', id: vv.id, sx: e.clientX, origX: vv.x })
      } else if (hv !== null) {
        setSelected({ type: 'h', id: String(hv) })
        setDrag({ kind: 'moveH', sortedIdx: hv, sy: e.clientY, origY: sortedLines(hLines)[hv] })
      } else {
        // 空白处:对点模式下 = 打点(可重复=反复);否则选中小节(已对点则跳转音频)
        setSelected(null)
        const n = measureNumberAt(x, y)
        if (n !== null) {
          selectMeasure(n)
          const st = useStore.getState()
          if (st.marking) {
            // 对点:把当前播放时间追加为该小节的一个事件(同一小节可多点几次=反复段落)
            const now = getAudio().currentTime
            addMarkEvent(n, now)
          } else {
            // 跳转到该小节最近一次演奏的时间
            const evs = st.markEvents.filter((e) => e.n === n)
            if (evs.length) {
              const a = getAudio()
              a.currentTime = evs[evs.length - 1].time
            }
          }
        }
      }
      return
    }
  }

  const onMouseMove = (e: React.MouseEvent): void => {
    if (erasing) {
      if (score) eraseAt(toImage(e).x, toImage(e).y)
      return
    }
    if (drag) {
      if (drag.kind === 'moveH') {
        updateHLine(drag.sortedIdx, drag.origY + (e.clientY - drag.sy) / scale)
      } else if (drag.kind === 'moveV') {
        updateVLine(drag.id, drag.origX + (e.clientX - drag.sx) / scale)
      } else if (drag.kind === 'moveBeat') {
        // 拍线拖动:只更新该小节第 index 条拍线(钳制在相邻拍线之间,保持有序)
        const m = drag.m
        const curRatios = beatRatiosFor(beatRatiosByMeasure, drag.measureN, beatsPerMeasure)
        const newX = m.x0 + (m.x1 - m.x0) * drag.origRatio + (e.clientX - drag.sx) / scale
        let r = (newX - m.x0) / (m.x1 - m.x0)
        const prev = drag.index > 0 ? curRatios[drag.index - 1] : 0
        const next = drag.index < curRatios.length - 1 ? curRatios[drag.index + 1] : 1
        r = clamp(r, prev + 0.005, next - 0.005)
        setBeatRatio(drag.measureN, drag.index, r)
      }
      return
    }
    // 非拖动:更新虚拟预览线位置
    if (score) setHover(toImage(e))
  }

  const endDrag = (): void => {
    setDrag(null)
    setErasing(false)
  }

  /** 橡皮擦:按优先级擦除拍线(细分)/竖线/横线 */
  const eraseAt = (x: number, y: number): void => {
    if (!score) return
    const tol = 20 / scale
    // 1) 拍线(拍号细分开启时)
    if (beatSubdivision) {
      const measuresList = buildMeasures(hLines, vLines, score.width, score.height)
      let best: { n: number; i: number; d: number } | null = null
      for (const m of measuresList) {
        if (y < m.top || y > m.bottom) continue
        const ratios = beatRatiosFor(beatRatiosByMeasure, m.n, beatsPerMeasure)
        for (let i = 0; i < ratios.length; i++) {
          const lx = m.x0 + (m.x1 - m.x0) * ratios[i]
          const d = Math.abs(lx - x)
          if (d < tol && (best === null || d < best.d)) best = { n: m.n, i, d }
        }
      }
      if (best) {
        removeBeatLine(best.n, best.i)
        return
      }
    }
    // 2) 竖线 / 横线
    const hv = nearestHLine(hLines, y, tol)
    const vv = nearestVLine(vLines, hLines, x, y, score.height, tol)
    if (vv && (hv === null || Math.abs(vv.x - x) <= Math.abs(sortedLines(hLines)[hv] - y))) {
      removeLine({ type: 'v', id: vv.id })
    } else if (hv !== null) {
      removeLine({ type: 'h', id: String(hv) })
    }
  }

  // ---------- 虚拟预览线(自动吸附可开关) ----------
  // 容差 24 屏幕像素(转换为图片坐标),比之前 12px 更灵敏
  const snapTol = 24 / scale
  const previewY = (() => {
    if (!hover) return null
    if (!snapEnabled) return hover.y
    const hv = nearestHLine(hLines, hover.y, snapTol)
    return hv !== null ? sortedLines(hLines)[hv] : hover.y
  })()
  const previewX = (() => {
    if (!hover) return null
    if (!snapEnabled || !score) return hover.x
    // 吸附到当前行的识别小节线 + 已画竖线(不跨行)
    const row = rowAt(hLines, hover.y, score.height)
    const targets = snapTargetsForRow(row)
    let best: number | null = null
    let bestDist = Infinity
    for (const tx of targets) {
      const d = Math.abs(tx - hover.x)
      if (d < bestDist) {
        bestDist = d
        best = tx
      }
    }
    return best !== null && bestDist <= snapTol ? best : hover.x
  })()
  const previewVKind: 'full' | 'measure' = hLines.length === 0 ? 'full' : 'measure'

  // ---------- 小节区间计算(渲染用) ----------
  interface Measure {
    n: number
    x0: number
    x1: number
    top: number
    bottom: number
  }
  const fullXs = vLines.filter((v) => v.kind === 'full').map((v) => v.x)
  const leftBorder = fullXs.length ? Math.min(...fullXs) : 0
  const rightBorder = fullXs.length ? Math.max(...fullXs) : score?.width ?? 0

  const measures: Measure[] = []
  if (score) {
    const rows = rowCount(hLines)
    let counter = 0
    for (let r = 0; r < rows; r++) {
      const [top, bottom] = rowBounds(hLines, r, score.height)
      const set = new Set<number>([leftBorder, rightBorder])
      vLines
        .filter((v) => v.kind === 'measure' && v.row === r)
        .forEach((v) => set.add(v.x))
      const xs = [...set].sort((a, b) => a - b)
      for (let i = 0; i < xs.length - 1; i++) {
        counter += 1
        measures.push({ n: counter, x0: xs[i], x1: xs[i + 1], top, bottom })
      }
    }
  }

  const cursor = tool === 'select' ? 'default' : tool === 'hline' ? 'row-resize' : tool === 'vline' ? 'col-resize' : 'default'

  /** 确认修改编号:输入新编号,该小节及之后重新连续编号(仅显示标签,不影响对点数据) */

  /** 标注缩放系数:线宽/字号/标记尺寸随曲谱宽度同步放大 */
  const k = score ? annotScale(score.width) : 1
  const lw = lineWidth * k

  const selV = selected?.type === 'v' ? vLines.find((v) => v.id === selected.id) : undefined
  const selHIdx = selected?.type === 'h' ? Number(selected.id) : undefined
  const selHY = selHIdx !== undefined && selHIdx < sortedLines(hLines).length ? sortedLines(hLines)[selHIdx] : undefined

  return (
    <div className="canvas-wrap">
      <div className="canvas-toolbar">
        <button className="btn primary" onClick={pickFile}>
          <FileUp size={14} /> 导入曲谱
        </button>
        {scorePages.length > 1 && (
          <button className="btn" onClick={() => setPageOrderOpen(true)} title="调整页面顺序">
            <Layers size={14} /> 页面顺序
          </button>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length) void importBrowserFiles(files)
            e.target.value = ''
          }}
        />
        {score && (
          <span className="canvas-zoom">
            <button className="btn icon" onClick={() => zoomBy(1 / 1.2)}>
              <ZoomOut size={14} />
            </button>
            <span className="zoom-value">{Math.round(scale * 100)}%</span>
            <button className="btn icon" onClick={() => zoomBy(1.2)}>
              <ZoomIn size={14} />
            </button>
            <button className="btn icon" onClick={fitWidth} title="铺满宽度">
              <Maximize2 size={14} />
            </button>
          </span>
        )}
      </div>

      <div
        ref={scrollRef}
        className={`canvas-scroll ${dragOver ? 'drag-over' : ''}`}
        style={{ cursor }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={endDrag}
        onMouseLeave={() => {
          endDrag()
          setHover(null)
        }}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onContextMenu={(e) => {
          e.preventDefault()
          if (!score) return
          const { x, y } = toImage(e)
          const n = measureNumberAt(x, y)
          const m = n !== null ? measures.find((mm) => mm.n === n) : undefined
          if (m) setEditEvents(m)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const files = Array.from(e.dataTransfer.files ?? [])
          if (files.length) void importBrowserFiles(files)
        }}
      >
        {score ? (
          <div style={{ width: Math.round(score.width * scale), margin: '0 auto', padding: '12px 0 40px' }}>
            <div style={{ position: 'relative', width: '100%' }}>
              <img
                ref={imgRef}
                src={score.dataUrl}
                draggable={false}
                style={{ display: 'block', width: '100%', pointerEvents: 'none' }}
                alt="曲谱"
              />
              <svg
                width={score.width * scale}
                height={score.height * scale}
                viewBox={`0 0 ${score.width} ${score.height}`}
                style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }}
              >
                {/* 渐变定义(发光玻璃框 + 辉光光标线) */}
                <defs>
                  <linearGradient id="jumpGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={rgba(jumpColor, Math.min(clamp(jumpOpacity, 0.02, 0.9) * 1.4, 0.75))} />
                    <stop offset="100%" stopColor={rgba(jumpColor, clamp(jumpOpacity, 0.02, 0.9) * 0.5)} />
                  </linearGradient>
                  <linearGradient id="contGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={rgba(markLineColor, 0.26)} />
                    <stop offset="100%" stopColor={rgba(markLineColor, 0.1)} />
                  </linearGradient>
                </defs>
                {/* 拍号细分:每小节内拍线(虚线,按小节独立;可拖动微调;拖动命中逻辑在 onMouseDown) */}
                {beatSubdivision && (
                  <g className="beat-lines" pointerEvents="none">
                    {measures.map((m) =>
                      beatRatiosFor(beatRatiosByMeasure, m.n, beatsPerMeasure).map((r, i) => {
                        const lx = m.x0 + (m.x1 - m.x0) * r
                        return (
                          <line
                            key={`${m.n}-${i}`}
                            x1={lx}
                            y1={m.top}
                            x2={lx}
                            y2={m.bottom}
                            stroke={rgba(markLineColor, 0.35)}
                            strokeWidth={1.2 * k}
                            strokeDasharray={`${3 * k} ${3 * k}`}
                          />
                        )
                      })
                    )}
                  </g>
                )}
                {/* 当前小节高亮(连续模式:发光玻璃框,跟随标线颜色) */}
                {videoMode === 'continuous' &&
                  currentMeasure !== null &&
                  measures
                    .filter((m) => m.n === currentMeasure)
                    .map((m) => (
                      <g key={`cur${m.n}`}>
                        <rect
                          x={m.x0}
                          y={m.top}
                          width={m.x1 - m.x0}
                          height={m.bottom - m.top}
                          fill="none"
                          stroke={rgba(markLineColor, 0.22)}
                          strokeWidth={6 * k}
                          rx={6 * k}
                        />
                        <rect
                          x={m.x0}
                          y={m.top}
                          width={m.x1 - m.x0}
                          height={m.bottom - m.top}
                          fill="url(#contGrad)"
                          stroke={rgba(markLineColor, 0.8)}
                          strokeWidth={1.2 * k}
                          rx={6 * k}
                        />
                      </g>
                    ))}
                {/* 跳框模式:发光玻璃框(渐变填充+外发光+顶部高光) + 下一小节虚线预备 */}
                {videoMode === 'jump' &&
                  currentMeasure !== null &&
                  measures
                    .filter((m) => m.n === currentMeasure)
                    .map((m) => (
                      <g key={`jcur${m.n}`}>
                        <rect
                          x={m.x0}
                          y={m.top}
                          width={m.x1 - m.x0}
                          height={m.bottom - m.top}
                          fill="none"
                          stroke={rgba(jumpColor, 0.22)}
                          strokeWidth={7 * k}
                          rx={6 * k}
                        />
                        <rect
                          x={m.x0}
                          y={m.top}
                          width={m.x1 - m.x0}
                          height={m.bottom - m.top}
                          fill="url(#jumpGrad)"
                          stroke={rgba(jumpColor, 0.9)}
                          strokeWidth={1.6 * k}
                          rx={6 * k}
                        />
                        <line
                          x1={m.x0 + 8 * k}
                          y1={m.top + 4 * k}
                          x2={m.x1 - 8 * k}
                          y2={m.top + 4 * k}
                          stroke={rgba(jumpColor, 0.4)}
                          strokeWidth={1.2 * k}
                          strokeLinecap="round"
                        />
                      </g>
                    ))}
                {videoMode === 'jump' &&
                  currentMeasure !== null &&
                  measures
                    .filter((m) => m.n === currentMeasure + 1)
                    .map((m) => (
                      <rect
                        key={`jnext${m.n}`}
                        x={m.x0}
                        y={m.top}
                        width={m.x1 - m.x0}
                        height={m.bottom - m.top}
                        fill={rgba(nextColor, clamp(nextOpacity, 0.02, 0.9))}
                        stroke={rgba(nextColor, 0.55)}
                        strokeWidth={1.5 * k}
                        strokeDasharray={`${10 * k} ${7 * k}`}
                        rx={3 * k}
                      />
                    ))}
                {/* 对点预选框:下一个待打点的小节(橙色虚线) */}
                {marking &&
                  markingNext !== null &&
                  measures
                    .filter((m) => m.n === markingNext)
                    .map((m) => (
                      <rect
                        key={`next${m.n}`}
                        x={m.x0}
                        y={m.top}
                        width={m.x1 - m.x0}
                        height={m.bottom - m.top}
                        fill="rgba(186,117,23,0.08)"
                        stroke="rgba(186,117,23,0.85)"
                        strokeWidth={1.5 * k}
                        strokeDasharray={`${8 * k} ${6 * k}`}
                        rx={2 * k}
                      />
                    ))}
                {/* 识别出的印刷小节线(淡绿虚线,吸附开启时显示吸附目标) */}
                {snapEnabled &&
                  detectLines?.map((xs, r) => {
                    const [dt, db] = rowBounds(hLines, r, score.height)
                    return xs.map((lx, i) => (
                      <line
                        key={`det${r}-${i}`}
                        x1={lx}
                        y1={dt}
                        x2={lx}
                        y2={db}
                        stroke="rgba(70,200,120,0.5)"
                        strokeWidth={1.5 * k}
                        strokeDasharray={`${4 * k} ${3 * k}`}
                        pointerEvents="none"
                      />
                    ))
                  })}
                {/* 横线(截断在左右边框之间,无边框则全宽) */}
                {sortedLines(hLines).map((y, i) => (
                  <line
                    key={`h${i}`}
                    x1={leftBorder}
                    y1={y}
                    x2={rightBorder}
                    y2={y}
                    stroke={selected?.type === 'h' && selHIdx === i ? '#E24B4A' : markLineColor}
                    strokeWidth={lw}
                  />
                ))}
                {/* 竖线:full 贯穿整图(边框),measure 行内裁剪 */}
                {vLines.map((v) => {
                  const [top, bottom] = v.kind === 'full' ? [0, score.height] : rowBounds(hLines, v.row, score.height)
                  const isSel = selected?.type === 'v' && selected.id === v.id
                  return (
                    <line
                      key={v.id}
                      x1={v.x}
                      y1={top}
                      x2={v.x}
                      y2={bottom}
                      stroke={isSel ? '#E24B4A' : markLineColor}
                      strokeWidth={isSel ? lw + 1 : v.kind === 'full' ? lw + 1 : lw}
                    />
                  )
                })}
                {/* 虚拟预览线(跟随鼠标,虚线,自动吸附) */}
                {tool === 'hline' && previewY !== null && (
                  <line
                    x1={leftBorder}
                    y1={previewY}
                    x2={rightBorder}
                    y2={previewY}
                    stroke={rgba(markLineColor, 0.45)}
                    strokeWidth={lw + 1}
                    strokeDasharray={`${10 * k} ${7 * k}`}
                  />
                )}
                {tool === 'vline' && previewX !== null && hover && score && (
                  (() => {
                    const [pt, pb] =
                      previewVKind === 'full'
                        ? [0, score.height]
                        : rowBounds(hLines, rowAt(hLines, hover.y, score.height), score.height)
                    return (
                      <line
                        x1={previewX}
                        y1={pt}
                        x2={previewX}
                        y2={pb}
                        stroke={rgba(markLineColor, 0.45)}
                        strokeWidth={lw + 1}
                        strokeDasharray={`${10 * k} ${7 * k}`}
                      />
                    )
                  })()
                )}
                {/* 对点编号框 + 时间戳:每个对点事件一个编号框,编号=演奏序号(反复的小节出现多个框) */}
                {markEvents.map((e, idx) => {
                  const m = measures.find((mm) => mm.n === e.n)
                  if (!m) return null
                  // 编号 = 演奏序号(第几个演奏的事件;可自定义 label 覆盖)
                  const label = e.label ?? idx + 1
                  const inRow = markEvents.filter((x, j) => x.n === e.n && j <= idx).length - 1
                  const total = markEvents.filter((x) => x.n === e.n).length
                  const slot = m.x1 - m.x0
                  const cx = m.x0 + ((inRow + 0.5) / total) * slot
                  const delta = Math.round((e.time - e.base) * 100) / 100
                  const offsetStr =
                    Math.abs(delta) >= 0.005
                      ? ` (${delta > 0 ? '+' : ''}${delta.toFixed(2)}s)`
                      : ''
                  return (
                    <g key={`ev${idx}`}>
                      <rect
                        x={cx - 11 * k}
                        y={m.top + 3 * k}
                        width={22 * k}
                        height={17 * k}
                        rx={3 * k}
                        fill={rgba(markLineColor, 0.14)}
                        stroke={rgba(markLineColor, 0.55)}
                        strokeWidth={0.8 * k}
                      />
                      <text
                        x={cx}
                        y={m.top + 17 * k}
                        textAnchor="middle"
                        fontSize={13 * k}
                        fontWeight={500}
                        fill={markLineColor}
                        cursor="pointer"
                        onMouseDown={(ev2) => ev2.stopPropagation()}
                        onClick={(ev2) => {
                          ev2.stopPropagation()
                          setEditEvents(m)
                        }}
                      >
                        {label}
                      </text>
                      <text
                        x={cx}
                        y={m.bottom - 3 * k}
                        textAnchor="middle"
                        fontSize={11 * k}
                        fill="#854F0B"
                      >
                        {formatTimeShort(e.time)}
                        {offsetStr}
                      </text>
                    </g>
                  )
                })}
                {selHY !== undefined && <circle cx={rightBorder + 6 * k} cy={selHY} r={6 * k} fill="#E24B4A" />}
                {selV && (
                  <g>
                    <circle
                      cx={selV.x}
                      cy={selV.kind === 'full' ? 0 : rowBounds(hLines, selV.row, score.height)[0]}
                      r={6 * k}
                      fill="#E24B4A"
                    />
                    <circle
                      cx={selV.x}
                      cy={selV.kind === 'full' ? score.height : rowBounds(hLines, selV.row, score.height)[1]}
                      r={6 * k}
                      fill="#E24B4A"
                    />
                  </g>
                )}
                {/* 颜色进度遮罩(光标走过区域,同色覆盖;多矩形支持整行/整谱模式) */}
                {Array.from({ length: MAX_TRAIL_RECTS }).map((_, i) => (
                  <rect
                    key={i}
                    ref={(el) => {
                      trailRectsRef.current[i] = el
                    }}
                    x="0"
                    y="0"
                    width="0"
                    height="0"
                    fill={cursorColor}
                    fillOpacity={cursorTrailOpacity}
                    visibility="hidden"
                    pointerEvents="none"
                  />
                ))}
                {/* 拍点小球(光标上方,跟随每拍起点跳动) */}
                <circle
                  ref={cursorBallRef}
                  cx="0"
                  cy="0"
                  r="6"
                  fill={cursorColor}
                  stroke="rgba(255,255,255,0.92)"
                  strokeWidth={1.6}
                  visibility="hidden"
                  pointerEvents="none"
                />
                {/* 播放预览光标线(rAF 实时更新:轻光晕 + 纯色主线,浓度由 opacity 控制) */}
                <line
                  ref={cursorGlowRef}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="0"
                  stroke={cursorColor}
                  strokeWidth={11}
                  strokeLinecap="round"
                  opacity={0.07 * cursorOpacity}
                  visibility="hidden"
                  pointerEvents="none"
                />
                <line
                  ref={cursorLineRef}
                  x1="0"
                  y1="0"
                  x2="0"
                  y2="0"
                  stroke={cursorColor}
                  strokeWidth={5}
                  strokeLinecap="round"
                  opacity={cursorOpacity}
                  visibility="hidden"
                  pointerEvents="none"
                />
              </svg>
            </div>
          </div>
        ) : (
          <div className="canvas-empty">
            <div className="empty-title">拖入 PDF / JPG / PNG 曲谱文件(可多选,自动合并)</div>
            <div className="empty-sub">或点击上方「导入曲谱」按钮 · 多张图片 / 多页 PDF 会拼成一张长图</div>
          </div>
        )}
      </div>

      {/* PDF 追加/替换弹窗 */}
      {askPdf && (
        <div className="modal-mask" onClick={() => setAskPdf(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h4>PDF 导入</h4>
            <p>
              当前已有曲谱。新增的 PDF（{askPdf.length} 页）如何处理？
            </p>
            <div className="modal-actions">
              <button
                className="btn"
                onClick={async () => {
                  const st = useStore.getState()
                  await st.setScorePages([...st.scorePages, ...askPdf])
                  setAskPdf(null)
                }}
              >
                追加到下方
              </button>
              <button
                className="btn primary"
                onClick={async () => {
                  await useStore.getState().setScorePages(askPdf)
                  setAskPdf(null)
                }}
              >
                替换当前曲谱
              </button>
              <button className="btn" onClick={() => setAskPdf(null)}>
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 对点事件面板(右键小节/点击编号):每个演奏事件可直接编辑编号与时间 */}
      {editEvents && (
        <div className="modal-mask" onClick={() => setEditEvents(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h4>小节 {measureLabel[editEvents.n] ?? editEvents.n} · 演奏事件</h4>
            <p>编号与时间可直接编辑(回车/失焦生效)。反复段落会列出多个事件。</p>
            <div className="event-list">
              {markEvents.map((e, i) =>
                e.n === editEvents.n ? (
                  <div className="event-row" key={`ev${i}`}>
                    <button
                      className="btn icon event-del"
                      title="删除该演奏事件(误打点修正)"
                      onClick={() => removeMarkEvent(markEvents.indexOf(e))}
                    >
                      <Trash2 size={12} />
                    </button>
                    <input
                      key={`num-${i}-${e.label ?? i + 1}`}
                      className="event-input num"
                      type="number"
                      min={1}
                      defaultValue={e.label ?? i + 1}
                      title="演奏序号(修改后该事件及之后顺延)"
                      onBlur={(ev2) => {
                        const v = parseInt(ev2.target.value, 10)
                        if (Number.isFinite(v) && v >= 1) {
                          setMarkEventNumber(markEvents.indexOf(e), v)
                        }
                      }}
                      onKeyDown={(ev2) => {
                        if (ev2.key === 'Enter') ev2.currentTarget.blur()
                      }}
                    />
                    <input
                      key={`time-${i}-${e.time.toFixed(3)}`}
                      className="event-input time"
                      type="text"
                      defaultValue={formatTimeShort(e.time)}
                      title="时间(可输入 秒 或 分:秒)"
                      onBlur={(ev2) => {
                        const v = parseTimeStr(ev2.target.value)
                        if (v !== null) {
                          setMarkEventTime(markEvents.indexOf(e), v)
                        }
                      }}
                      onKeyDown={(ev2) => {
                        if (ev2.key === 'Enter') ev2.currentTarget.blur()
                      }}
                    />
                    <button
                      className="btn icon"
                      title="减少 0.05 秒"
                      onClick={() => adjustMarkEventByIndex(markEvents.indexOf(e), -0.05)}
                    >
                      −
                    </button>
                    <button
                      className="btn icon"
                      title="增加 0.05 秒"
                      onClick={() => adjustMarkEventByIndex(markEvents.indexOf(e), 0.05)}
                    >
                      +
                    </button>
                  </div>
                ) : null
              )}
            </div>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setEditEvents(null)}>
                完成
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 页面顺序弹窗 */}
      {pageOrderOpen && (
        <div className="modal-mask" onClick={() => setPageOrderOpen(false)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <h4>页面顺序</h4>
            <p>上移/下移调整顺序,或删除页面。调整后会重新合并长图,需重新分割乐谱。</p>
            <div className="page-list modal-page-list">
              {scorePages.map((pg, i) => (
                <div className="page-row" key={`${pg.name ?? i}-${i}`}>
                  <span className="page-idx">{i + 1}</span>
                  <span className="page-name" title={pg.name}>
                    {pg.name ?? `第 ${i + 1} 页`}
                  </span>
                  <button
                    className="btn icon"
                    disabled={i === 0}
                    title="上移"
                    onClick={() => void reorderScorePage(i, i - 1)}
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    className="btn icon"
                    disabled={i === scorePages.length - 1}
                    title="下移"
                    onClick={() => void reorderScorePage(i, i + 1)}
                  >
                    <ChevronDown size={13} />
                  </button>
                  <button
                    className="btn icon"
                    title="删除此页"
                    onClick={() => {
                      if (window.confirm(`删除页面「${pg.name ?? `第 ${i + 1} 页`}」?`)) {
                        void removeScorePage(i)
                      }
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn primary" onClick={() => setPageOrderOpen(false)}>
                完成
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatTimeShort(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

/** 解析时间输入:支持「秒」(20.5) 或「分:秒」(1:05.5) */
function parseTimeStr(s: string): number | null {
  const str = s.trim()
  if (!str) return null
  const parts = str.split(':')
  let sec: number
  if (parts.length === 1) {
    sec = parseFloat(parts[0])
  } else if (parts.length === 2) {
    const m = parseInt(parts[0], 10)
    const ss = parseFloat(parts[1])
    if (!Number.isFinite(m) || !Number.isFinite(ss)) return null
    sec = m * 60 + ss
  } else {
    return null
  }
  return Number.isFinite(sec) ? sec : null
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
