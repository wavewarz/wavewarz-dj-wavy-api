import type { CreateJobRequest, DjWavyJudgement } from '../types'
import { r2Bytes } from '../r2-bytes'
import { buildChunkedTranscript } from './transcript-bundler'
import { buildDjWavyPrompt, jobToPromptTracks } from './prompt'
import { callGeminiJudge } from './judge'
import { buildChunkedAudioAnalysis } from './analysis-bundler'
import { getChunkWindows, type AudioChunkWindow } from '../chunking'

const CLIP_PADDING_SECONDS = 8
const MAX_PREFIX_BYTES = 100 * 1024 * 1024 // 100 MB hard cap

const bytesPerSecForMime = (mimeType: string): number => {
  const m = mimeType.toLowerCase()
  // 800k covers 96kHz/24-bit stereo (576k bytes/sec) with headroom for edge cases
  if (m.includes('wav') || m.includes('wave')) return 800_000
  // M4A commonly uses AAC (lossy) but can also be ALAC (lossless). Use a conservative
  // estimate to avoid under-fetching prefix bytes for ALAC-in-M4A uploads.
  if (m.includes('m4a') || m.includes('mp4')) return 800_000
  // 300k covers 96kHz/24-bit FLAC (typically 200-250k bytes/sec compressed)
  if (m.includes('flac')) return 300_000
  return 56_000
}

const prefixBytesForTrack = (
  mimeType: string,
  durationSec: number | null,
  windows: AudioChunkWindow[],
): number => {
  const bps = bytesPerSecForMime(mimeType)
  const lastWindow = windows[windows.length - 1]
  const maxEndSec = lastWindow.startSeconds + lastWindow.durationSeconds + CLIP_PADDING_SECONDS
  const endSec = durationSec != null ? Math.min(durationSec + CLIP_PADDING_SECONDS, maxEndSec) : maxEndSec
  return Math.min(Math.ceil(endSec * bps), MAX_PREFIX_BYTES)
}

export const runRealDjWavyJudging = async (input: {
  jobId: string
  job: CreateJobRequest
}): Promise<{ model: string; judgement: DjWavyJudgement }> => {
  const job = input.job

  const aWindows = getChunkWindows(job.trackA.durationSeconds)
  const bWindows = getChunkWindows(job.trackB.durationSeconds)

  const [audioABytes, audioBBytes] = await Promise.all([
    r2Bytes.downloadObjectBytesPrefix({
      objectKey: job.trackA.r2ObjectKey,
      byteLength: prefixBytesForTrack(job.trackA.mimeType, job.trackA.durationSeconds, aWindows),
    }),
    r2Bytes.downloadObjectBytesPrefix({
      objectKey: job.trackB.r2ObjectKey,
      byteLength: prefixBytesForTrack(job.trackB.mimeType, job.trackB.durationSeconds, bWindows),
    }),
  ])

  const [aTranscript, bTranscript] = await Promise.all([
    buildChunkedTranscript({
      jobId: input.jobId,
      audioBytes: audioABytes,
      mimeType: job.trackA.mimeType,
      trackLabel: 'A',
      battleId: job.battleId,
      windows: aWindows,
    }),
    buildChunkedTranscript({
      jobId: input.jobId,
      audioBytes: audioBBytes,
      mimeType: job.trackB.mimeType,
      trackLabel: 'B',
      battleId: job.battleId,
      windows: bWindows,
    }),
  ])

  const [aAnalysis, bAnalysis] = await Promise.all([
    buildChunkedAudioAnalysis({
      jobId: input.jobId,
      audioBytes: audioABytes,
      mimeType: job.trackA.mimeType,
      trackLabel: 'A',
      battleId: job.battleId,
      windows: aWindows,
    }),
    buildChunkedAudioAnalysis({
      jobId: input.jobId,
      audioBytes: audioBBytes,
      mimeType: job.trackB.mimeType,
      trackLabel: 'B',
      battleId: job.battleId,
      windows: bWindows,
    }),
  ])

  const { trackA, trackB } = jobToPromptTracks(job, {
    transcripts: { A: aTranscript.transcriptText, B: bTranscript.transcriptText },
    audioAnalysis: { A: aAnalysis.analysis, B: bAnalysis.analysis },
  })

  const prompt = buildDjWavyPrompt({
    battleId: job.battleId,
    trackA,
    trackB,
    promptVersion: 'oracle_v1',
    schemaVersion: 'scorecard_v1',
  })

  const judged = await callGeminiJudge({
    battleId: job.battleId,
    prompt,
  })

  return { model: judged.model, judgement: judged.judgement }
}
