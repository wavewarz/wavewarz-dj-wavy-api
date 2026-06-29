import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegPath: string = require('ffmpeg-static')

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
  if (!ffmpegPath) throw new Error('ffmpeg_static_not_found')

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

    const [out, err] = await Promise.all([collectStdout(child), collectStderr(child)])

    const code: number = await new Promise((resolve) => child.on('close', resolve))
    if (code !== 0) throw new Error(`ffmpeg_decode_failed: code=${code} stderr=${err.slice(0, 2000)}`)

    if (out.byteLength < 4) throw new Error('ffmpeg_decode_empty')

    // Buffer -> Float32Array (copy)
    const ab = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
    return new Float32Array(ab)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}
