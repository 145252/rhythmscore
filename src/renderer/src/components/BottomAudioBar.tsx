import React, { useEffect, useRef } from 'react'
import { AudioLines, ChevronLeft, ChevronRight, Pause, Play, Square, Upload } from 'lucide-react'
import { useStore } from '../store'
import { decodeWaveform, formatTime, getAudio } from '../audioPlayer'
import { getMeasureCount } from '../geometry'
import { readAsDataURL } from '../base64'

const WAVE_H = 32

/** 底部音频播放条:横贯窗口底部,波形 + 播放控制 + 对点(音乐播放器风格) */
export default function BottomAudioBar(): React.JSX.Element {
  const audioName = useStore((s) => s.audioName)
  const audioDataUrl = useStore((s) => s.audioDataUrl)
  const audioDuration = useStore((s) => s.audioDuration)
  const isPlaying = useStore((s) => s.isPlaying)
  const currentTime = useStore((s) => s.currentTime)
  const waveformPeaks = useStore((s) => s.waveformPeaks)
  const currentMeasure = useStore((s) => s.currentMeasure)
  const markEvents = useStore((s) => s.markEvents)
  const marking = useStore((s) => s.marking)

  const setAudio = useStore((s) => s.setAudio)
  const clearAudio = useStore((s) => s.clearAudio)
  const setPlaying = useStore((s) => s.setPlaying)
  const setCurrentTime = useStore((s) => s.setCurrentTime)
  const setAudioDuration = useStore((s) => s.setAudioDuration)
  const setWaveform = useStore((s) => s.setWaveform)
  const selectMeasure = useStore((s) => s.selectMeasure)
  const addMarkEvent = useStore((s) => s.addMarkEvent)
  const clearMarkEvents = useStore((s) => s.clearMarkEvents)
  const setMarking = useStore((s) => s.setMarking)
  const setMarkingNext = useStore((s) => s.setMarkingNext)
  const setTool = useStore((s) => s.setTool)

  const waveRef = useRef<HTMLCanvasElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const audio = getAudio()

  // 导入新音频
  const loadAudio = async (file: File): Promise<void> => {
    const dataUrl = await readAsDataURL(file)
    setAudio(file.name, dataUrl)
  }

  /** 播放跟随:按事件序列(反复段落自动跳回),高亮当前演奏的小节 */
  const followMeasure = (t: number): void => {
    const st = useStore.getState()
    if (st.markEvents.length === 0) return
    let cur = st.markEvents[0].n
    for (const e of st.markEvents) {
      if (t >= e.time) cur = e.n
      else break
    }
    if (cur !== st.currentMeasure) st.selectMeasure(cur)
  }

  // 播放中:rAF 循环实时跟随
  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    const loop = (): void => {
      followMeasure(getAudio().currentTime)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying])

  // 对点模式:回车 = 给预选框指向的小节追加时间点
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Enter') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const st = useStore.getState()
      if (!st.marking || !st.audioDataUrl || !st.score) return
      e.preventDefault()
      const total = getMeasureCount(st.hLines, st.vLines, st.score.width)
      if (total <= 0) return
      const n = Math.min(Math.max(st.markingNext ?? st.currentMeasure ?? 1, 1), total)
      const now = getAudio().currentTime
      st.addMarkEvent(n, now)
      st.selectMeasure(n)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 音频源变化 → 重置播放器 + 解码波形
  useEffect(() => {
    if (!audioDataUrl) return
    audio.pause()
    audio.src = audioDataUrl
    audio.load()
    setAudioDuration(0)
    setCurrentTime(0)
    setPlaying(false)
    void decodeWaveform(audioDataUrl, 2600).then((peaks) => setWaveform(peaks))
  }, [audioDataUrl, audio, setAudioDuration, setCurrentTime, setPlaying, setWaveform])

  // 绑定播放器事件
  useEffect(() => {
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    const onEnded = (): void => setPlaying(false)
    const onTime = (): void => setCurrentTime(audio.currentTime)
    const onMeta = (): void => {
      if (isFinite(audio.duration)) setAudioDuration(audio.duration)
    }
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('timeupdate', onTime)
    audio.addEventListener('loadedmetadata', onMeta)
    audio.addEventListener('durationchange', onMeta)
    return () => {
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('timeupdate', onTime)
      audio.removeEventListener('loadedmetadata', onMeta)
      audio.removeEventListener('durationchange', onMeta)
    }
  }, [audio, setPlaying, setCurrentTime, setAudioDuration])

  const togglePlay = (): void => {
    if (!audioDataUrl) return
    if (audio.paused) void audio.play().catch(() => undefined)
    else audio.pause()
  }

  const seek = (t: number): void => {
    if (!audioDataUrl) return
    audio.currentTime = Math.min(Math.max(t, 0), audioDuration)
    setCurrentTime(audio.currentTime)
  }

  /** 跳到上一个/下一个已对点的小节起点 */
  const jumpMarked = (dir: 1 | -1): void => {
    if (!audioDataUrl) return
    const times = markEvents.map((e) => e.time).sort((a, b) => a - b)
    if (times.length === 0) {
      seek(currentTime + dir * 5)
      return
    }
    const cur = audio.currentTime
    if (dir === 1) {
      const next = times.find((t) => t > cur + 0.05)
      seek(next ?? times[times.length - 1])
    } else {
      const prev = [...times].reverse().find((t) => t < cur - 0.05)
      seek(prev ?? times[0])
    }
  }

  /** 停止:暂停并回到开头 */
  const stop = (): void => {
    if (!audioDataUrl) return
    audio.pause()
    audio.currentTime = 0
    setCurrentTime(0)
    setPlaying(false)
  }

  /** 对点开关:开启后点击曲谱小节/按回车即打点;自动切到选择工具并开始播放 */
  const toggleMarking = (): void => {
    const next = !marking
    setMarking(next)
    setMarkingNext(next ? 1 : null)
    if (next) {
      setTool('select')
      if (audioDataUrl && audio.paused) void audio.play().catch(() => undefined)
    }
  }

  // 波形绘制(导入后:真实波形 + 对点标记 + 播放游标;未导入:装饰假波形)
  useEffect(() => {
    const canvas = waveRef.current
    if (!canvas) return
    const W = canvas.clientWidth
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(W * dpr))
    canvas.height = WAVE_H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, WAVE_H)

    if (!audioDataUrl || !waveformPeaks || !audioDuration) {
      // 装饰假波形:极密细条,多频正弦叠加产生自然高低错落
      const fake = 520
      ctx.fillStyle = 'rgba(120,140,180,0.24)'
      const bw2 = W / fake
      for (let i = 0; i < fake; i++) {
        const v =
          0.5 +
          0.28 * Math.sin(i * 0.85) +
          0.18 * Math.sin(i * 2.15 + 1.2) +
          0.12 * Math.sin(i * 4.9 + 2.4) +
          0.06 * Math.sin(i * 9.3 + 0.7)
        const h = 3 + Math.max(0, v) * WAVE_H * 0.82
        ctx.fillRect(i * bw2, (WAVE_H - h) / 2, Math.max(0.5, bw2 - 0.35), h)
      }
      return
    }

    const n = waveformPeaks.length
    const bw = W / n
    ctx.fillStyle = '#a8b2c0'
    for (let i = 0; i < n; i++) {
      const h = Math.max(2, waveformPeaks[i] * WAVE_H * 0.92)
      ctx.fillRect(i * bw, (WAVE_H - h) / 2, Math.max(1, bw - 0.5), h)
    }

    // 对点标记:只画橙色竖线(数字容易重叠看不清,只保留定位线)
    for (const ev of markEvents) {
      const x = (ev.time / audioDuration) * W
      ctx.fillStyle = '#BA7517'
      ctx.fillRect(x - 1, 0, 2, WAVE_H)
    }
    // 播放游标
    const cx = (currentTime / audioDuration) * W
    ctx.fillStyle = '#E24B4A'
    ctx.fillRect(cx - 0.75, 0, 1.5, WAVE_H)
  }, [waveformPeaks, currentTime, markEvents, audioDuration, audioDataUrl])

  const onWaveClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = waveRef.current
    if (!canvas || !audioDuration) return
    const rect = canvas.getBoundingClientRect()
    seek(((e.clientX - rect.left) / rect.width) * audioDuration)
  }

  const markedCount = markEvents.length

  return (
    <div className={`bottom-bar ${audioDataUrl ? 'has-audio' : ''}`}>
      {!audioDataUrl ? (
        <div
          className="bar-empty"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const f = e.dataTransfer.files?.[0]
            if (f) void loadAudio(f)
          }}
        >
          <div className="bar-empty-wave">
            <canvas ref={waveRef} className="wave-canvas" style={{ height: WAVE_H }} />
          </div>
          <div className="bar-empty-hint">
            <Upload size={16} />
            <span>拖入 MP3 / WAV 音频</span>
            <span style={{ fontSize: 11, opacity: 0.7 }}>或点击选择文件</span>
          </div>
        </div>
      ) : (
        <>
          <div className="bar-info">
            <div className="wave-wrap" title={audioName ?? ''}>
              <canvas ref={waveRef} className="wave-canvas" onClick={onWaveClick} style={{ height: WAVE_H }} />
              <div className="wave-time">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(audioDuration)}</span>
              </div>
            </div>
          </div>

          <div className="bar-controls">
            <button className="btn icon" title="后退(跳到上一个对点小节)" onClick={() => jumpMarked(-1)}>
              <ChevronLeft size={16} />
            </button>
            <button className="btn icon play" title="播放 / 暂停" onClick={togglePlay}>
              {isPlaying ? <Pause size={16} /> : <Play size={16} />}
            </button>
            <button className="btn icon stop" title="停止(回到开头)" onClick={stop}>
              <Square size={14} />
            </button>
            <button className="btn icon" title="前进(跳到下一个对点小节)" onClick={() => jumpMarked(1)}>
              <ChevronRight size={16} />
            </button>

            <div className="bar-divider" />

            {/* 对点模式开关 */}
            <label className="marking-toggle">
              <span>对点</span>
              <input type="checkbox" checked={marking} onChange={toggleMarking} />
              <span className="toggle-track">
                <span className="toggle-thumb" />
              </span>
            </label>

            {/* 小节导航 */}
            <div className="measure-nav">
              <button
                className="btn icon"
                title="上一小节"
                disabled={currentMeasure === null || currentMeasure <= 1}
                onClick={() => {
                  if (currentMeasure !== null) selectMeasure(currentMeasure - 1)
                }}
              >
                <ChevronLeft size={14} />
              </button>
              <span className="cur-measure">
                {marking ? (
                  <span className="marking-hint">对点中</span>
                ) : (
                  <>{currentMeasure !== null ? `小节 ${currentMeasure}` : '—'}</>
                )}
              </span>
              <button
                className="btn icon"
                title="下一小节"
                disabled={currentMeasure === null}
                onClick={() => {
                  if (currentMeasure !== null) selectMeasure(currentMeasure + 1)
                }}
              >
                <ChevronRight size={14} />
              </button>
            </div>

            <div className="bar-divider" />

            {markedCount > 0 && (
              <button className="btn danger-text" title="删除所有对点时间点" onClick={() => {
                if (window.confirm(`确定清除全部 ${markedCount} 个对点时间点吗?`)) {
                  clearMarkEvents()
                }
              }}>
                清除对点
              </button>
            )}
            <button className="btn subtle" onClick={clearAudio}>
              移除音频
            </button>
          </div>
        </>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*,.mp3,.wav,.m4a,.flac,.ogg"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void loadAudio(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}
