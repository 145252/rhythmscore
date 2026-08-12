/**
 * ffmpeg 封装:webm(含音画)→ mp4 转码、按小节切分片段。
 * 使用 @ffmpeg-installer/ffmpeg 提供的静态二进制(无需系统安装)。
 */
import { spawn } from 'child_process'
import { writeFile, mkdir, mkdtemp } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg') as { path: string }

export function getFfmpegPath(): string {
  return ffmpegInstaller.path
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(getFfmpegPath(), args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d: Buffer) => {
      err += d.toString()
    })
    p.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg 退出码 ${code ?? '?'}: ${err.slice(-600)}`))
    })
    p.on('error', (e) => reject(new Error(`无法启动 ffmpeg: ${e.message}`)))
  })
}

export interface SegmentSpec {
  index: number
  start: number
  end: number
}

export interface ExportOpts {
  /** 免费版:降低清晰度(转码时缩到 720p 高度),刺激付费 */
  lowQuality?: boolean
}

export interface ExportResult {
  mainPath: string
  segments: string[]
}

/**
 * 导出:webm → mp4(含原音轨),可选按小节切分片段。
 * @param webmData webm 文件内容
 * @param destPath 整片保存路径(仅整片模式)
 * @param destDir 片段保存目录(切片模式)
 * @param segments 小节切片表(可选)
 * @param opts 导出选项(免费版降清晰度)
 */
export async function exportVideo(
  webmData: Uint8Array,
  destPath: string,
  destDir: string | null,
  segments: SegmentSpec[],
  opts: ExportOpts = {}
): Promise<ExportResult> {
  const tmp = await mkdtemp(join(tmpdir(), 'dscore-'))
  const webmPath = join(tmp, 'raw.webm')
  const mp4Path = join(tmp, 'full.mp4')
  await writeFile(webmPath, webmData)

  // 转码:webm(vp9/vp8+opus) → mp4(h264+aac);免费版缩到 720p 降清晰度
  // preset faster(提速)+ crf 17(无损级别,不降画质)
  const vf = opts.lowQuality ? ['-vf', 'scale=-2:720'] : []
  await runFfmpeg([
    '-y',
    '-i', webmPath,
    '-c:v', 'libx264',
    '-preset', 'faster',
    '-crf', '17',
    '-pix_fmt', 'yuv420p',
    ...vf,
    '-c:a', 'aac',
    '-b:a', '192k',
    '-shortest',
    mp4Path
  ])

  const result: ExportResult = { mainPath: '', segments: [] }

  if (destDir) {
    // 切片模式:整片也输出到目录,同时切出各小节片段
    result.mainPath = join(destDir, '全曲.mp4')
    await runFfmpeg(['-y', '-i', mp4Path, '-c', 'copy', result.mainPath])
    for (const seg of segments) {
      const dur = Math.max(seg.end - seg.start, 0.1)
      const out = join(destDir, `小节${String(seg.index).padStart(2, '0')}.mp4`)
      await runFfmpeg([
        '-y',
        '-i', mp4Path,
        '-ss', seg.start.toFixed(3),
        '-t', dur.toFixed(3),
        '-c', 'copy',
        out
      ])
      result.segments.push(out)
    }
  } else {
    result.mainPath = destPath
    await runFfmpeg(['-y', '-i', mp4Path, '-c', 'copy', result.mainPath])
  }

  // 清理临时文件(异步,不阻塞返回)
  void (async () => {
    try {
      const { rm } = await import('fs/promises')
      await rm(tmp, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  })()

  return result
}

/**
 * 透明通道导出:帧序列 PNG → VP9 alpha WebM(剪辑软件可叠加)。
 * 帧文件命名 frame-00001.png ...;透明需要 yuva420p 像素格式。
 */
export async function encodeAlphaWebm(
  framesDir: string,
  fps: number,
  destPath: string,
  lowQuality?: boolean
): Promise<void> {
  const args = [
    '-y',
    '-framerate', String(fps),
    '-i', join(framesDir, 'frame-%05d.png'),
    '-c:v', 'libvpx-vp9',
    '-pix_fmt', 'yuva420p',
    '-b:v', '0',
    '-crf', lowQuality ? '34' : '22',
    '-row-mt', '1',
    destPath
  ]
  await runFfmpeg(args)
}
