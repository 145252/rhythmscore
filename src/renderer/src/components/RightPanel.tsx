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

import ColorSwatches from './ColorSwatches'

type ExportState = 'idle' | 'recording' | 'converting' | 'done' | 'error'

export default function RightPanel(): React.JSX.Element {
  const score = useStore((s) => s.score)
  const audioDataUrl = useStore((s) => s.audioDataUrl)
  const audioDuration = useStore((s) => s.audioDuration)
  const measureTimes = useStore((s) => s.markEvents)
  const hLines = useStore((s) => s.hLines)
  const vLines = useStore((s) => s.vLines)
  const lineWidth = useStore((s) => s.lineWidth)
  const projectName = useStore((s) => s.projectName)
  const cursorColor = useStore((s) => s.cursorColor)
  const cursorWidth = useStore((s) => s.cursorWidth)
  const cursorOpacity = useStore((s) => s.cursorOpacity)
  const cursorTrail = useStore((s) => s.cursorTrail)
  const cursorTrailOpacity = useStore((s) => s.cursorTrailOpacity)
  const cursorTrailRange = useStore((s) => s.cursorTrailRange)
  const cursorBall = useStore((s) => s.cursorBall)
  const setCursorBall = useStore((s) => s.setCursorBall)
  const setCursorColor = useStore((s) => s.setCursorColor)
  const setCursorWidth = useStore((s) => s.setCursorWidth)
  const setCursorOpacity = useStore((s) => s.setCursorOpacity)
  const setCursorTrail = useStore((s) => s.setCursorTrail)
  const setCursorTrailOpacity = useStore((s) => s.setCursorTrailOpacity)
  const setCursorTrailRange = useStore((s) => s.setCursorTrailRange)
  const videoMode = useStore((s) => s.videoMode)
  const jumpColor = useStore((s) => s.jumpColor)
  const jumpOpacity = useStore((s) => s.jumpOpacity)
  const nextColor = useStore((s) => s.nextColor)
  const nextOpacity = useStore((s) => s.nextOpacity)
  const setVideoMode = useStore((s) => s.setVideoMode)
  const setJumpColor = useStore((s) => s.setJumpColor)
  const setJumpOpacity = useStore((s) => s.setJumpOpacity)
  const setNextColor = useStore((s) => s.setNextColor)
  const setNextOpacity = useStore((s) => s.setNextOpacity)

  const [ratio, setRatio] = useState<VideoRatio>('16:9')
  const [split, setSplit] = useState(false) // 默认不导出小节切片,避免生成一堆"小节N.mp4"
  const [state, setState] = useState<ExportState>('idle')
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState('')
  const lastPctRef = useRef(-1)

  const mode = videoMode
  const setMode = setVideoMode

  const markedCount = measureTimes.length
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
          markLineColor: st.markLineColor,
          leftBorder,
          rightBorder,
          measures,
          events: st.markEvents,
          totalDuration: st.audioDuration,
          mode,
          ratio,
          showAnnotations: false, // 导出视频保持纯净画面:不要标线/编号选框
          cursorColor,
          cursorWidth,
          cursorOpacity,
          cursorTrail,
          cursorTrailOpacity,
          cursorTrailRange,
          cursorBall: st.cursorBall,
          beatSubdivision: st.beatSubdivision,
          beatsPerMeasure: st.beatsPerMeasure,
          beatRatiosByMeasure: st.beatRatiosByMeasure,
          jumpColor,
          jumpOpacity,
          nextColor,
          nextOpacity,
          watermark: !st.licensed // 未激活:导出叠加动态水印
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

      // 跳框模式 + 开启切片:按事件序列生成小节片段表(反复段落同编号多次切片)
      let splitMeasures: { index: number; start: number; end: number }[] | undefined
      if (mode === 'jump' && split) {
        const evs = st.markEvents
        splitMeasures = evs.map((e, i) => ({
          index: e.n,
          start: e.time,
          end: i + 1 < evs.length ? evs[i + 1].time : st.audioDuration
        }))
      }

      const res = await window.api.exportVideo({
        webmBase64,
        defaultName: projectName || '曲谱视频',
        splitMeasures,
        lowQuality: !st.licensed // 未激活:导出降 720p 清晰度
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
          <span className="num">3</span> 高亮设置
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

        {mode === 'continuous' && (
          <>
            <p className="label">光标线</p>
            <div className="cursor-width-row">
              <span>粗细</span>
              <input
                type="range"
                min={1}
                max={20}
                step={0.5}
                value={cursorWidth}
                onChange={(e) => setCursorWidth(Number(e.target.value))}
                disabled={busy}
              />
              <span className="lv">{cursorWidth % 1 === 0 ? cursorWidth : cursorWidth.toFixed(1)}px</span>
            </div>
            <div className="cursor-width-row">
              <span>浓度</span>
              <input
                type="range"
                min={20}
                max={100}
                value={Math.round(cursorOpacity * 100)}
                onChange={(e) => setCursorOpacity(Number(e.target.value) / 100)}
                disabled={busy}
              />
              <span className="lv">{Math.round(cursorOpacity * 100)}%</span>
            </div>
            <label className="split-opt">
              <input
                type="checkbox"
                checked={cursorTrail}
                onChange={(e) => setCursorTrail(e.target.checked)}
                disabled={busy}
              />
              颜色进度(光标走过区域覆盖同色)
            </label>
            <label className="split-opt">
              <input
                type="checkbox"
                checked={cursorBall}
                onChange={(e) => setCursorBall(e.target.checked)}
                disabled={busy}
              />
              拍点小球(光标上方跟随每拍起点跳动)
            </label>
            {cursorTrail && (
              <>
                <div className="cursor-width-row">
                  <span>进度浓度</span>
                  <input
                    type="range"
                    min={5}
                    max={60}
                    value={Math.round(cursorTrailOpacity * 100)}
                    onChange={(e) => setCursorTrailOpacity(Number(e.target.value) / 100)}
                    disabled={busy}
                  />
                  <span className="lv">{Math.round(cursorTrailOpacity * 100)}%</span>
                </div>
                <div className="trail-range-row">
                  {(
                    [
                      ['measure', '当前小节'],
                      ['row', '整行'],
                      ['score', '整谱']
                    ] as const
                  ).map(([v, label]) => (
                    <button
                      key={v}
                      className={`btn mode ${cursorTrailRange === v ? 'active' : ''}`}
                      onClick={() => setCursorTrailRange(v)}
                      disabled={busy}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
            <ColorSwatches value={cursorColor} onChange={setCursorColor} disabled={busy} />
          </>
        )}

        {mode === 'jump' && (
          <>
            <p className="label">跳框高亮</p>

            <p className="sub-label">当前小节</p>
            <div className="cursor-width-row">
              <span>浓度</span>
              <input
                type="range"
                min={5}
                max={60}
                value={Math.round(jumpOpacity * 100)}
                onChange={(e) => setJumpOpacity(Number(e.target.value) / 100)}
                disabled={busy}
              />
              <span className="lv">{Math.round(jumpOpacity * 100)}%</span>
            </div>
            <ColorSwatches value={jumpColor} onChange={setJumpColor} disabled={busy} />

            <p className="sub-label">下一小节(预备)</p>
            <div className="cursor-width-row">
              <span>浓度</span>
              <input
                type="range"
                min={2}
                max={40}
                value={Math.round(nextOpacity * 100)}
                onChange={(e) => setNextOpacity(Number(e.target.value) / 100)}
                disabled={busy}
              />
              <span className="lv">{Math.round(nextOpacity * 100)}%</span>
            </div>
            <ColorSwatches value={nextColor} onChange={setNextColor} disabled={busy} />
          </>
        )}

      </div>

      <div className="section-gap" />

      <div className="card">
        <h3 className="card-title">
          <span className="num">4</span> 生成视频
        </h3>

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
