import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Prefer FFMPEG_PATH env var (e.g. system ffmpeg on Docker/Cloud Run).
// Falls back to ffmpeg-static when running on Vercel.
let ffmpegPath: string | null = process.env.FFMPEG_PATH ?? null
if (!ffmpegPath) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    ffmpegPath = require('ffmpeg-static') as string | null
  } catch {
    ffmpegPath = null
  }
}

type DecodeWindow = { startSeconds: number; durationSeconds: number }

const collectStdout = async (child: ReturnType<typeof spawn>): Promise<Buffer> => {
  if (!child.stdout) throw new Error('ffmpeg_no_stdout')
  const chunks: Buffer[] = []
  for await (const c of child.stdout) chunks.push(Buffer.from(c))
  return Buffer.concat(chunks)
}

const collectStderr = async (child: ReturnType<typeof spawn>): Promise<string> => {
  if (!child.stderr) throw new Error('ffmpeg_no_stderr')
  const chunks: Buffer[] = []
  for await (const c of child.stderr) chunks.push(Buffer.from(c))
  return Buffer.concat(chunks).toString('utf8')
}

export const decodeAudioWindowToMonoFloat32 = async (input: {
  audioBytes: ArrayBuffer
  window: DecodeWindow
  sampleRateHz: number
}): Promise<Float32Array> => {
  if (!ffmpegPath) throw new Error('ffmpeg_not_found: set FFMPEG_PATH env var or install ffmpeg-static')

  const dir = await mkdtemp(path.join(tmpdir(), 'dj-wavy-'))
  const inPath = path.join(dir, 'in')

  try {
    await writeFile(inPath, Buffer.from(input.audioBytes))

    const start = Math.max(0, input.window.startSeconds)
    const dur = Math.max(0.1, input.window.durationSeconds)

    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      // reduce probe time on partial/truncated inputs
      '-probesize',
      '32k',
      '-analyzeduration',
      '1M',
      // seek + duration
      '-ss',
      String(start),
      '-t',
      String(dur),
      '-i',
      inPath,
      // mono + downsample
      '-ac',
      '1',
      '-ar',
      String(input.sampleRateHz),
      // raw float32 little-endian
      '-f',
      'f32le',
      'pipe:1',
    ]

    const child = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })

    const timeoutMs = 20_000
    const timeout = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        // ignore
      }
    }, timeoutMs)

    const [out, err] = await Promise.all([collectStdout(child), collectStderr(child)]).finally(() => {
      clearTimeout(timeout)
    })

    const code: number = await new Promise((resolve) => child.on('close', resolve))
    if (code !== 0) {
      const timedOut = child.killed
      if (timedOut) throw new Error(`ffmpeg_decode_timeout: ${timeoutMs}ms stderr=${err.slice(0, 2000)}`)
      throw new Error(`ffmpeg_decode_failed: code=${code} stderr=${err.slice(0, 2000)}`)
    }

    if (out.byteLength < 4) throw new Error('ffmpeg_decode_empty')

    // Buffer -> Float32Array (copy)
    const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
    return new Float32Array(ab)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
