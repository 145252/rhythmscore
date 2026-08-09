/**
 * 全局音频播放器单例(渲染层)。
 * AudioPanel 与 ScoreCanvas 通过 getAudio() 操作同一个 <audio> 实例。
 */

let audio: HTMLAudioElement | null = null

export function getAudio(): HTMLAudioElement {
  if (!audio) {
    audio = new Audio()
  }
  return audio
}

/**
 * 解码音频并提取波形峰值(归一化 -1..1)。
 * 返回的峰值数组长度 = buckets,可直接映射到波形图宽度。
 */
export async function decodeWaveform(dataUrl: string, buckets = 1000): Promise<number[] | null> {
  try {
    const buf = await (await fetch(dataUrl)).arrayBuffer()
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const audioBuf = await ctx.decodeAudioData(buf)
    const channel = audioBuf.getChannelData(0)
    const block = Math.floor(channel.length / buckets)
    if (block < 1) return null
    const peaks: number[] = []
    for (let i = 0; i < buckets; i++) {
      let max = 0
      const start = i * block
      for (let j = 0; j < block; j++) {
        const v = Math.abs(channel[start + j])
        if (v > max) max = v
      }
      peaks.push(max)
    }
    void ctx.close()
    return peaks
  } catch {
    return null
  }
}

export function formatTime(t: number): string {
  if (!isFinite(t) || t < 0) t = 0
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  const ms = Math.floor((t % 1) * 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${ms}`
}
