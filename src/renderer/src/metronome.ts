/**
 * 节拍器:用 Web Audio OfflineAudioContext 按 BPM/拍号/音色合成一段节拍器音频。
 * 返回 WAV 的 dataURL,可直接作为"当前音频"导入,复用对点/播放/导出的完整流程。
 */

export type MetronomeSound = 'wood' | 'beep' | 'digital'

/** 节拍器音频开头静音缓冲(秒):避免第一拍 click 被视频转码的编码器启动延迟吞掉 */
export const METRONOME_LEAD_IN = 0.06

export interface MetronomeOptions {
  bpm: number
  beatsPerMeasure: number
  /** 正文小节数 */
  measures: number
  /** 预备小节数(音频开头预卷,默认 1) */
  prepMeasures?: number
  sound: MetronomeSound
}

/** 音色参数:强拍/弱拍的频率与波形 */
function soundParams(sound: MetronomeSound): { accent: number; weak: number; type: OscillatorType } {
  switch (sound) {
    case 'beep':
      return { accent: 1500, weak: 900, type: 'square' }
    case 'digital':
      return { accent: 2200, weak: 1500, type: 'sine' }
    case 'wood':
    default:
      return { accent: 1800, weak: 1100, type: 'sine' }
  }
}

function scheduleClick(ctx: OfflineAudioContext, t: number, accent: boolean, sound: MetronomeSound): void {
  const { accent: fa, weak: fw, type } = soundParams(sound)
  const freq = accent ? fa : fw
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.type = type
  osc.frequency.value = freq
  const dur = accent ? 0.055 : 0.032
  gain.gain.setValueAtTime(0.9, t)
  gain.gain.exponentialRampToValueAtTime(0.001, t + dur)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(t)
  osc.stop(t + dur + 0.01)
}

/** AudioBuffer → WAV dataURL */
function bufferToWavDataUrl(buffer: AudioBuffer): Promise<string> {
  const numCh = buffer.numberOfChannels
  const sampleRate = buffer.sampleRate
  const len = buffer.length * numCh * 2
  const arr = new ArrayBuffer(44 + len)
  const view = new DataView(arr)
  const ws = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  ws(0, 'RIFF')
  view.setUint32(4, 36 + len, true)
  ws(8, 'WAVE')
  ws(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, numCh, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * numCh * 2, true)
  view.setUint16(32, numCh * 2, true)
  view.setUint16(34, 16, true)
  ws(36, 'data')
  view.setUint32(40, len, true)
  let offset = 44
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < numCh; ch++) {
      const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]))
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true)
      offset += 2
    }
  }
  const blob = new Blob([arr], { type: 'audio/wav' })
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = reject
    fr.readAsDataURL(blob)
  })
}

/** 生成节拍器音频(含预备小节预卷 + 开头静音缓冲,总时长 = leadIn + (prep + measures) 小节) */
export async function generateMetronomeAudio(opts: MetronomeOptions): Promise<string> {
  const beatDur = 60 / opts.bpm
  const prep = opts.prepMeasures ?? 1
  const totalBeats = Math.max(1, Math.round((prep + opts.measures) * opts.beatsPerMeasure))
  const duration = METRONOME_LEAD_IN + totalBeats * beatDur + 0.3
  const sampleRate = 44100
  const Ctx =
    window.OfflineAudioContext ??
    (window as unknown as { webkitOfflineAudioContext: typeof OfflineAudioContext }).webkitOfflineAudioContext
  const ctx = new Ctx(2, Math.ceil(duration * sampleRate), sampleRate)
  for (let i = 0; i < totalBeats; i++) {
    const accent = i % opts.beatsPerMeasure === 0
    scheduleClick(ctx, METRONOME_LEAD_IN + i * beatDur, accent, opts.sound)
  }
  const rendered = await ctx.startRendering()
  return await bufferToWavDataUrl(rendered)
}
