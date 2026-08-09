import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FileUp, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { useStore } from '../store'
import { nearestHLine, nearestVLine, rowAt, rowBounds, rowCount, sortedLines, annotScale } from '../geometry'
import { loadPdfDoc, renderPdfPageDoc } from '../pdf'
import { mergePages, type PageImage } from '../merge'
import { getAudio } from '../audioPlayer'
import type { ScoreSource } from '../types'

type DragState =
  | { kind: 'moveH'; sortedIdx: number; sy: number; origY: number }
  | { kind: 'moveV'; id: string; sx: number; origX: number }
  | null

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi)

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

export default function ScoreCanvas(): React.JSX.Element {
  const score = useStore((s) => s.score)
  const hLines = useStore((s) => s.hLines)
  const vLines = useStore((s) => s.vLines)
  const tool = useStore((s) => s.tool)
  const lineWidth = useStore((s) => s.lineWidth)
  const selected = useStore((s) => s.selected)
  const scale = useStore((s) => s.scale)
  const currentMeasure = useStore((s) => s.currentMeasure)
  const measureTimes = useStore((s) => s.measureTimes)

  const setScore = useStore((s) => s.setScore)
  const addHLine = useStore((s) => s.addHLine)
  const addVLine = useStore((s) => s.addVLine)
  const updateHLine = useStore((s) => s.updateHLine)
  const updateVLine = useStore((s) => s.updateVLine)
  const removeLine = useStore((s) => s.removeLine)
  const setSelected = useStore((s) => s.setSelected)
  const setScale = useStore((s) => s.setScale)
  const selectMeasure = useStore((s) => s.selectMeasure)
  const setMeasureTime = useStore((s) => s.setMeasureTime)
  const setMeasureBase = useStore((s) => s.setMeasureBase)
  const setMarkingTarget = useStore((s) => s.setMarkingTarget)
  const measureBaseTimes = useStore((s) => s.measureBaseTimes)
  const marking = useStore((s) => s.marking)
  const markingTarget = useStore((s) => s.markingTarget)

  const scrollRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState<DragState>(null)
  const [dragOver, setDragOver] = useState(false)
  /** 鼠标悬停位置(图片坐标),用于虚拟预览线 */
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null)

  // ---------- 导入(多文件合并) ----------
  const loadScoreFiles = useCallback(
    async (files: File[]) => {
      const pages: PageImage[] = []
      let kind: ScoreSource['kind'] = 'image'
      let firstName = ''
      for (const f of files) {
        const ext = (f.name.split('.').pop() ?? '').toLowerCase()
        if (['jpg', 'jpeg', 'png', 'webp', 'bmp'].includes(ext)) {
          const dataUrl = await readAsDataURL(f)
          const img = await loadImageEl(dataUrl)
          pages.push({ dataUrl, width: img.naturalWidth, height: img.naturalHeight })
          if (!firstName) firstName = f.name
        } else if (ext === 'pdf') {
          kind = 'pdf'
          const doc = await loadPdfDoc(new Uint8Array(await f.arrayBuffer()))
          for (let p = 1; p <= doc.numPages; p++) {
            const r = await renderPdfPageDoc(doc, p)
            pages.push({ dataUrl: r.dataUrl, width: r.width, height: r.height })
          }
          void doc.destroy()
          if (!firstName) firstName = f.name
        }
      }
      if (pages.length === 0) return
      const merged = await mergePages(pages)
      setScore({
        kind,
        name: files.length > 1 ? `${firstName} 等 ${files.length} 个文件` : firstName,
        dataUrl: merged.dataUrl,
        width: merged.width,
        height: merged.height
      })
    },
    [setScore]
  )

  const pickFile = useCallback(() => {
    if (window.api?.isElectron) {
      window.api.openScoreFile().then(async (r) => {
        if (!r) return
        if (r.ext === 'pdf') {
          const doc = await loadPdfDoc(base64ToUint8(r.dataBase64))
          const pages: PageImage[] = []
          for (let p = 1; p <= doc.numPages; p++) {
            const pr = await renderPdfPageDoc(doc, p)
            pages.push({ dataUrl: pr.dataUrl, width: pr.width, height: pr.height })
          }
          void doc.destroy()
          const merged = await mergePages(pages)
          setScore({ kind: 'pdf', name: r.name, path: r.path, dataUrl: merged.dataUrl, width: merged.width, height: merged.height })
        } else {
          const mime = r.ext === 'jpg' ? 'jpeg' : r.ext === 'svg' ? 'svg+xml' : r.ext
          const dataUrl = `data:image/${mime};base64,${r.dataBase64}`
          const img = await loadImageEl(dataUrl)
          setScore({ kind: 'image', name: r.name, path: r.path, dataUrl, width: img.naturalWidth, height: img.naturalHeight })
        }
      })
    } else {
      fileInputRef.current?.click()
    }
  }, [setScore])

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

  const onMouseDown = (e: React.MouseEvent): void => {
    if (e.button !== 0 || !score) return
    const { x, y } = toImage(e)
    if (tool === 'hline') {
      addHLine(Math.round(y))
      return
    }
    if (tool === 'vline') {
      // 无横线时自动画贯穿线(左右边框);有横线时默认画行内小节线,Shift 强制贯穿
      const kind: 'full' | 'measure' = hLines.length === 0 || e.shiftKey ? 'full' : 'measure'
      const row = kind === 'full' ? 0 : rowAt(hLines, y, score.height)
      addVLine(Math.round(x), row, kind)
      return
    }
    if (tool === 'select') {
      const tol = 12 / scale
      const hv = nearestHLine(hLines, y, tol)
      const vv = nearestVLine(vLines, hLines, x, y, score.height, tol)
      if (vv && (hv === null || Math.abs(vv.x - x) <= Math.abs(sortedLines(hLines)[hv] - y))) {
        setSelected({ type: 'v', id: vv.id })
        setDrag({ kind: 'moveV', id: vv.id, sx: e.clientX, origX: vv.x })
      } else if (hv !== null) {
        setSelected({ type: 'h', id: String(hv) })
        setDrag({ kind: 'moveH', sortedIdx: hv, sy: e.clientY, origY: sortedLines(hLines)[hv] })
      } else {
        // 空白处:对点模式下 = 打点;否则选中小节(若已对点则跳转音频)
        setSelected(null)
        const n = measureNumberAt(x, y)
        if (n !== null) {
          selectMeasure(n)
          const st = useStore.getState()
          if (st.marking) {
            // 对点:把当前播放时间记到该小节,同时记为打点基准;目标小节前进
            const now = getAudio().currentTime
            setMeasureTime(n, now)
            setMeasureBase(n, now)
            setMarkingTarget(n + 1)
          } else {
            const t = st.measureTimes[n]
            if (t !== undefined) {
              const a = getAudio()
              a.currentTime = t
            }
          }
        }
      }
      return
    }
  }

  const onMouseMove = (e: React.MouseEvent): void => {
    if (drag) {
      if (drag.kind === 'moveH') {
        updateHLine(drag.sortedIdx, drag.origY + (e.clientY - drag.sy) / scale)
      } else if (drag.kind === 'moveV') {
        updateVLine(drag.id, drag.origX + (e.clientX - drag.sx) / scale)
      }
      return
    }
    // 非拖动:更新虚拟预览线位置
    if (score) setHover(toImage(e))
  }

  const endDrag = (): void => {
    setDrag(null)
  }

  // ---------- 虚拟预览线(带吸附) ----------
  const snapTol = 12 / scale
  const previewY = (() => {
    if (!hover) return null
    const hv = nearestHLine(hLines, hover.y, snapTol)
    return hv !== null ? sortedLines(hLines)[hv] : hover.y
  })()
  const previewX = (() => {
    if (!hover) return null
    // 找最近的任意竖线(x 方向)
    let best: number | null = null
    let bestDist = Infinity
    for (const v of vLines) {
      const d = Math.abs(v.x - hover.x)
      if (d < bestDist) {
        bestDist = d
        best = v.x
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
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,.bmp,.pdf"
          multiple
          style={{ display: 'none' }}
          onChange={(e) => {
            const files = Array.from(e.target.files ?? [])
            if (files.length) void loadScoreFiles(files)
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
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const files = Array.from(e.dataTransfer.files ?? [])
          if (files.length) void loadScoreFiles(files)
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
                {/* 当前小节高亮 */}
                {currentMeasure !== null &&
                  measures
                    .filter((m) => m.n === currentMeasure)
                    .map((m) => (
                      <rect
                        key={`cur${m.n}`}
                        x={m.x0}
                        y={m.top}
                        width={m.x1 - m.x0}
                        height={m.bottom - m.top}
                        fill="rgba(55,138,221,0.18)"
                        stroke="rgba(55,138,221,0.7)"
                        strokeWidth={1.5 * k}
                        rx={2 * k}
                      />
                    ))}
                {/* 对点目标小节(回车打点的目标,橙色虚线框) */}
                {marking &&
                  markingTarget !== null &&
                  measures
                    .filter((m) => m.n === markingTarget)
                    .map((m) => (
                      <rect
                        key={`tgt${m.n}`}
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
                {/* 横线(截断在左右边框之间,无边框则全宽) */}
                {sortedLines(hLines).map((y, i) => (
                  <line
                    key={`h${i}`}
                    x1={leftBorder}
                    y1={y}
                    x2={rightBorder}
                    y2={y}
                    stroke={selected?.type === 'h' && selHIdx === i ? '#E24B4A' : '#378ADD'}
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
                      stroke={isSel ? '#E24B4A' : v.kind === 'full' ? '#185FA5' : '#378ADD'}
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
                    stroke="rgba(55,138,221,0.45)"
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
                        stroke="rgba(55,138,221,0.45)"
                        strokeWidth={lw + 1}
                        strokeDasharray={`${10 * k} ${7 * k}`}
                      />
                    )
                  })()
                )}
                {/* 小节编号(选框内左上角) + 对点时间(选框内居中) */}
                {measures.map((m) => {
                  const t = measureTimes[m.n]
                  const base = measureBaseTimes[m.n]
                  const delta = base !== undefined ? Math.round((t - base) * 100) / 100 : 0
                  const offsetStr =
                    base !== undefined && Math.abs(delta) >= 0.005
                      ? ` (${delta > 0 ? '+' : ''}${delta.toFixed(2)}s)`
                      : ''
                  const midX = (m.x0 + m.x1) / 2
                  return (
                    <g key={`m${m.n}`}>
                      <rect
                        x={m.x0 + 3 * k}
                        y={m.top + 3 * k}
                        width={22 * k}
                        height={17 * k}
                        rx={3 * k}
                        fill="rgba(55,138,221,0.14)"
                        stroke="rgba(55,138,221,0.55)"
                        strokeWidth={0.8 * k}
                      />
                      <text
                        x={m.x0 + 14 * k}
                        y={m.top + 17 * k}
                        textAnchor="middle"
                        fontSize={13 * k}
                        fontWeight={500}
                        fill="#0C447C"
                      >
                        {m.n}
                      </text>
                      {t !== undefined && (
                        <text
                          x={midX}
                          y={m.bottom - 3 * k}
                          textAnchor="middle"
                          fontSize={11 * k}
                          fill="#854F0B"
                        >
                          {formatTimeShort(t)}
                          {offsetStr}
                        </text>
                      )}
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
    </div>
  )
}

function formatTimeShort(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}
