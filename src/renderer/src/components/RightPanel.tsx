import React, { useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, Clapperboard, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import {
  buildMeasures,
  blobToBase64,
  RATIO_SIZES,
  recordVideo,
  type FollowMode,
  type VideoRatio
} from '../videoExport'

const RATIOS = Object.keys(RATIO_SIZES) as VideoRatio[]

type ExportState = 'idle' | 'recording' | 'converting' | 'done' | 'error'

export default function RightPanel(): React.JSX.Element {
  const score = useStore((s) => s.score)
  const audioDataUrl = useStore((s) => s.audioDataUrl)
  const audioDuration = useStore((s) => s.audioDuration)
  const measureTimes = useStore((s) => s.measureTimes)
  const hLines = useStore((s) => s.hLines)
  const vLines = useStore((s) => s.vLines)
  const lineWidth = useStore((s) => s.lineWidth)
  const projectName = useStore((s) => s.projectName)

  const [mode, setMode] = useState<FollowMode>('continuous')
  const [ratio, setRatio] = useState<VideoRatio>('16:9')
  const [split, setSplit] = useState(true)
  const [state, setState] = useState<ExportState>('idle')
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const lastPctRef = useRef(-1)

  const markedCount = Object.keys(measureTimes).length
  const ready = !!score && !!audioDataUrl && markedCount > 0
  const busy = state === 'recording' || state === 'converting'

  const startExport = async (): Promise<void> => {
    const st = useStore.getState()
    if (!st.score || !st.audioDataUrl || !window.api) return
    if (!window.api.isElectron) {
      setMessage('视频导出需要桌面版(浏览器预览不支持),请用 npm run dev 打开桌面版')
      setState('error')
      return
    }

    const img = new Image()
    img.src = st.score.dataUrl
    await img.decode().catch(() => undefined)

    const measures = buildMeasures(st.hLines, st.vLines, st.score.width, st.score.height)
    const fullXs = st.vLines.filter((v) => v.kind === 'full').map((v) => v.x)
    const leftBorder = fullXs.length ? Math.min(...fullXs) : 0
    const rightBorder = fullXs.length ? Math.max(...fullXs) : st.score.width

    setState('recording')
    setProgress(0)
    setMessage('')
    try {
      const { blob } = await recordVideo(
        {
          img,
          scoreW: st.score.width,
          scoreH: st.score.height,
          hLines: st.hLines,
          vLines: st.vLines,
          lineWidth: st.lineWidth,
          leftBorder,
          rightBorder,
          measures,
          measureTimes: st.measureTimes,
          totalDuration: st.audioDuration,
          mode,
          ratio,
          showAnnotations: false // 导出视频保持纯净画面:不要标线/编号选框
        },
        (r) => {
          // 进度按整百分比节流,避免高频 setState 拖累录制
          const pct = Math.floor(r * 100)
          if (pct !== lastPctRef.current) {
            lastPctRef.current = pct
            setProgress(pct / 100)
          }
        }
      )
      setState('converting')
      const webmBase64 = await blobToBase64(blob)

      // 跳框模式 + 开启切片:按对点时间生成小节片段表
      let splitMeasures: { index: number; start: number; end: number }[] | undefined
      if (mode === 'jump' && split) {
        const times = Object.entries(st.measureTimes)
          .map(([n, time]) => ({ n: Number(n), time }))
          .sort((a, b) => a.time - b.time)
        splitMeasures = times.map((item, i) => ({
          index: item.n,
          start: item.time,
          end: i + 1 < times.length ? times[i + 1].time : st.audioDuration
        }))
      }

      const res = await window.api.exportVideo({
        webmBase64,
        defaultName: projectName || '曲谱视频',
        splitMeasures
      })
      if (!res || res.canceled) {
        setState('idle')
        return
      }
      if (res.error) {
        setMessage(res.error)
        setState('error')
        return
      }
      const segCount = res.segments?.length ?? 0
      setMessage(
        `已导出:${res.mainPath ?? ''}${segCount > 0 ? `\n另有 ${segCount} 个小节片段` : ''}`
      )
      setState('done')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
      setState('error')
    }
  }

  return (
    <aside className="side-panel right">
      <div className="card">
        <h3 className="card-title">
          <span className="num">3</span> 生成视频
        </h3>

        <p className="label">跟随模式</p>
        <div className="mode-row">
          <button className={`btn mode ${mode === 'continuous' ? 'active' : ''}`} onClick={() => setMode('continuous')} disabled={busy}>
            连续
          </button>
          <button className={`btn mode ${mode === 'jump' ? 'active' : ''}`} onClick={() => setMode('jump')} disabled={busy}>
            跳框
          </button>
        </div>
        <p className="hint">
          {mode === 'continuous'
            ? '光标在小节内随播放匀速移动,持续跟随'
            : '整小节高亮切换,重点展示当前小节'}
        </p>

        <p className="label">画面比例</p>
        <div className="ratio-grid">
          {RATIOS.map((r) => (
            <span key={r} className={`chip ${ratio === r ? 'active' : ''}`} onClick={() => !busy && setRatio(r)}>
              {r}
            </span>
          ))}
        </div>
        <p className="hint">
          {RATIO_SIZES[ratio].w} × {RATIO_SIZES[ratio].h} · 单行=只显示当前行 · 连滚=整谱滚动
        </p>

        <label className="split-opt">
          <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} disabled={busy || mode !== 'jump'} />
          同时导出每小节独立片段(跳框模式)
        </label>

        <button className="btn primary gen-btn" disabled={!ready || busy} onClick={() => void startExport()}>
          {busy ? <Loader2 size={15} className="spin" /> : <Clapperboard size={15} />}
          {busy ? (state === 'recording' ? '录制中…' : '转码中…') : '生成视频'}
        </button>

        {state === 'recording' && (
          <div className="export-progress">
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <span className="progress-text">{Math.round(progress * 100)}% · 实时录制中,请勿操作(可听到音频)</span>
          </div>
        )}
        {state === 'converting' && (
          <div className="export-progress">
            <div className="progress-bar indeterminate" />
            <span className="progress-text">正在转码 MP4 并混入音频…</span>
          </div>
        )}
        {state === 'done' && (
          <div className="export-result ok">
            <CheckCircle2 size={14} />
            <span>{message}</span>
          </div>
        )}
        {state === 'error' && (
          <div className="export-result err">
            <AlertTriangle size={14} />
            <span>{message}</span>
          </div>
        )}

        <p className="hint">
          {ready
            ? `已对点 ${markedCount} 个小节。导出时按音频时间轴渲染,时长 = 音频时长。`
            : '需要:导入曲谱 + 导入音频 + 至少对点 1 个小节'}
        </p>
      </div>
    </aside>
  )
}
