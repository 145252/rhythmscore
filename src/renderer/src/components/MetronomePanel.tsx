import React, { useState } from 'react'
import { useStore } from '../store'
import { generateMetronomeAudio, type MetronomeSound } from '../metronome'
import { getMeasureCount } from '../geometry'
import CollapseCard from './CollapseCard'

const SOUNDS: { id: MetronomeSound; label: string }[] = [
  { id: 'wood', label: '木质' },
  { id: 'beep', label: '电子' },
  { id: 'digital', label: '数字' }
]

/** 节拍器板块:设置 BPM/音色,合成节拍器音频并导入为当前音频(复用对点/播放/导出) */
export default function MetronomePanel(): React.JSX.Element {
  const score = useStore((s) => s.score)
  const hLines = useStore((s) => s.hLines)
  const vLines = useStore((s) => s.vLines)
  const beatsPerMeasure = useStore((s) => s.beatsPerMeasure)
  const setAudio = useStore((s) => s.setAudio)
  const audioDataUrl = useStore((s) => s.audioDataUrl)
  const clearAudio = useStore((s) => s.clearAudio)

  const [bpm, setBpm] = useState(100)
  const [sound, setSound] = useState<MetronomeSound>('wood')
  const [busy, setBusy] = useState(false)

  const measures = score ? getMeasureCount(hLines, vLines, score.width) : 0

  const generate = async (): Promise<void> => {
    if (!score || measures <= 0 || busy) return
    setBusy(true)
    try {
      const url = await generateMetronomeAudio({ bpm, beatsPerMeasure, measures, sound })
      setAudio(`节拍器 ${bpm}BPM`, url)
    } catch {
      /* 忽略 */
    } finally {
      setBusy(false)
    }
  }

  return (
    <CollapseCard title="节拍器">
      <div className="line-width-row">
        <span>速度</span>
        <input
          type="range"
          min={40}
          max={240}
          value={bpm}
          onChange={(e) => setBpm(Number(e.target.value))}
        />
        <span className="lv">{bpm} BPM</span>
      </div>

      <p className="label">音色</p>
      <div className="ratio-grid">
        {SOUNDS.map((s) => (
          <span
            key={s.id}
            className={`chip ${sound === s.id ? 'active' : ''}`}
            onClick={() => setSound(s.id)}
          >
            {s.label}
          </span>
        ))}
      </div>

      <p className="hint">
        {measures > 0
          ? `当前 ${measures} 小节 × ${beatsPerMeasure} 拍,生成约 ${measures * beatsPerMeasure} 拍节拍器音频。`
          : '请先划分小节(画横线/竖线),再生成节拍器音频。'}
      </p>

      <button className="btn primary" onClick={() => void generate()} disabled={measures <= 0 || busy}>
        {busy ? '生成中…' : '生成节拍器音频'}
      </button>
      {audioDataUrl && (
        <button className="btn subtle" style={{ marginTop: 8 }} onClick={clearAudio}>
          移除当前音频
        </button>
      )}
    </CollapseCard>
  )
}
