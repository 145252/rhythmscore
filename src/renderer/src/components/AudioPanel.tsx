import React, { useEffect, useRef } from 'react'
import { AudioLines, ChevronLeft, ChevronRight, Pause, Play, Square, Upload } from 'lucide-react'
import { useStore } from '../store'
import { decodeWaveform, formatTime, getAudio } from '../audioPlayer'
import { getMeasureCount } from '../geometry'
import { readAsDataURL } from '../base64'

const WAVE_H = 64

export default function AudioPanel(): React.JSX.Element {
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
  const adjustMarkEvent = useStore((s) => s.adjustMarkEvent)
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

  // 播放中:rAF 循环实时跟随(60fps,比 timeupdate 的 250ms 精确得多)
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

  // 对点模式:回车 = 给当前选中的小节追加一个时间点,并自动跳到下一小节(连续对点)
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
      const n = st.currentMeasure ?? 1
      const now = getAudio().currentTime
      st.addMarkEvent(Math.min(Math.max(n, 1), total), now)
      // 打点后自动选中下一小节(高亮跟随),方便连续回车对点
      const next = Math.min(n + 1, total)
      st.selectMeasure(next)
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
    void decodeWaveform(audioDataUrl, 900).then((peaks) => setWaveform(peaks))
  }, [audioDataUrl, audio, setAudioDuration, setCurrentTime, setPlaying, setWaveform])

  // 绑定播放器事件
  useEffect(() => {
    const onPlay = (): void => setPlaying(true)
    const onPause = (): void => setPlaying(false)
    const onEnded = (): void => setPlaying(false)
    const onTime = (): void => {
      setCurrentTime(audio.currentTime)
      // 跟随由 rAF 循环负责(更实时),这里仅更新时间显示
    }
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

  // 波形绘制
  useEffect(() => {
    const canvas = waveRef.current
    if (!canvas || !waveformPeaks || !audioDuration) return
    const W = canvas.clientWidth
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(W * dpr))
    canvas.height = WAVE_H * dpr
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, W, WAVE_H)

    const n = waveformPeaks.length
    const bw = W / n
    ctx.fillStyle = '#9aa3ad'
    for (let i = 0; i < n; i++) {
      const h = Math.max(2, waveformPeaks[i] * WAVE_H * 0.92)
      ctx.fillRect(i * bw, (WAVE_H - h) / 2, Math.max(1, bw - 0.5), h)
    }

    // 对点标记(每个事件一个;反复段落同编号多次出现)
    ctx.font = '10px sans-serif'
    for (const ev of markEvents) {
      const x = (ev.time / audioDuration) * W
      ctx.fillStyle = '#BA7517'
      ctx.fillRect(x - 1, 0, 2, WAVE_H)
      ctx.fillStyle = '#633806'
      ctx.fillText(String(ev.n), Math.min(Math.max(x + 3, 0), W - 16), 11)
    }
    // 播放游标
    const cx = (currentTime / audioDuration) * W
    ctx.fillStyle = '#E24B4A'
    ctx.fillRect(cx - 0.75, 0, 1.5, WAVE_H)
  }, [waveformPeaks, currentTime, markEvents, audioDuration])

  const onWaveClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const canvas = waveRef.current
    if (!canvas || !audioDuration) return
    const rect = canvas.getBoundingClientRect()
    seek(((e.clientX - rect.left) / rect.width) * audioDuration)
  }

  const markedCount = markEvents.length

  return (
    <div className="card">
      <h3 className="card-title">
        <span className="num">2</span> 音频导入
      </h3>

      {!audioDataUrl ? (
        <>
          <div
            className="audio-drop"
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const f = e.dataTransfer.files?.[0]
              if (f) void loadAudio(f)
            }}
          >
            <Upload size={18} />
            <span>拖入 MP3 / WAV 音频</span>
            <span style={{ fontSize: 11 }}>或点击选择文件</span>
          </div>
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
        </>
      ) : (
        <>
          <div className="audio-name">
            <AudioLines size={13} />
            <span title={audioName ?? ''}>{audioName}</span>
          </div>

          <div className="wave-wrap">
            <canvas ref={waveRef} className="wave-canvas" onClick={onWaveClick} style={{ height: WAVE_H }} />
            <div className="wave-time">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(audioDuration)}</span>
            </div>
          </div>

          <div className="audio-controls">
            <button className="btn icon" title="后退(跳到上一个对点小节)" onClick={() => jumpMarked(-1)}>
              <ChevronLeft size={15} />
            </button>
            <button className="btn icon play" title="播放 / 暂停" onClick={togglePlay}>
              {isPlaying ? <Pause size={15} /> : <Play size={15} />}
            </button>
            <button className="btn icon stop" title="停止(回到开头)" onClick={stop}>
              <Square size={13} />
            </button>
            <button className="btn icon" title="前进(跳到下一个对点小节)" onClick={() => jumpMarked(1)}>
              <ChevronRight size={15} />
            </button>
          </div>

          {/* 对点模式:文字 + 开关(独立一行) */}
          <label className="marking-toggle">
            <span>对点模式</span>
            <input type="checkbox" checked={marking} onChange={toggleMarking} />
            <span className="toggle-track">
              <span className="toggle-thumb" />
            </span>
          </label>

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
                <span className="marking-hint">对点中 · 点击曲谱小节</span>
              ) : (
                (() => {
                  // 该小节最近一次演奏的事件(反复段落显示最后一次)
                  const evs = currentMeasure !== null ? markEvents.filter((e) => e.n === currentMeasure) : []
                  const t = evs.length ? evs[evs.length - 1].time : undefined
                  const base = evs.length ? evs[evs.length - 1].base : undefined
                  const delta = t !== undefined && base !== undefined ? Math.round((t - base) * 100) / 100 : 0
                  const offsetStr =
                    t !== undefined && base !== undefined && Math.abs(delta) >= 0.005
                      ? ` (${delta > 0 ? '+' : ''}${delta.toFixed(2)}s)`
                      : ''
                  return (
                    <>
                      小节 {currentMeasure ?? '—'}
                      {t !== undefined && <em> {formatTime(t)}{offsetStr}</em>}
                    </>
                  )
                })()
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

          <div className="audio-actions">
            <button className="btn subtle" onClick={clearAudio}>
              移除音频
            </button>
            {markedCount > 0 && (
              <button
                className="btn danger-text"
                title="删除所有对点时间点"
                onClick={() => {
                  if (window.confirm(`确定清除全部 ${markedCount} 个对点时间点吗?`)) {
                    clearMarkEvents()
                  }
                }}
              >
                清除对点
              </button>
            )}
            <span className="marked-count">{markedCount} 个时间点</span>
          </div>

          <p className="hint">
            {marking
              ? '对点模式已开启:播放音频,听到哪个小节就「鼠标点击曲谱对应小节」(或按回车打点当前小节)。反复段落(同一小节演奏多遍)就再点一次该小节,会记上多个时间点。'
              : '对点流程:打开「对点」开关 → 自动播放 → 听到哪个小节就点击曲谱对应小节打点(同一小节可重复打点=反复)。已对点事件在波形上显示橙色标记;选中小节后可按 ←/→ 微调 ±0.05s(Shift ±0.01s)。'}
          </p>
        </>
      )}
    </div>
  )
}
