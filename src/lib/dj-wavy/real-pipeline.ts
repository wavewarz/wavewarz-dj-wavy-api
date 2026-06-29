import type { CreateJobRequest, DjWavyJudgement } from '../types'
import { r2Bytes } from '../r2-bytes'
import { buildChunkedTranscript } from './transcript-bundler'
import { buildDjWavyPrompt, jobToPromptTracks } from './prompt'
import { callGeminiJudge } from './judge'
import { buildChunkedAudioAnalysis } from './analysis-bundler'
import { DJ_WAVY_CHUNK_WINDOWS } from '../chunking'

const CLIP_AUDIO_EST_BYTES_PER_SECOND = 28_000
const CLIP_PADDING_SECONDS = 8

export const runRealDjWavyJudging = async (input: {
  jobId: string
  job: CreateJobRequest
}): Promise<{ model: string; judgement: DjWavyJudgement }> => {
  const job = input.job
  const lastWindow = DJ_WAVY_CHUNK_WINDOWS[DJ_WAVY_CHUNK_WINDOWS.length - 1]
  const maxEndSec = lastWindow.startSeconds + lastWindow.durationSeconds + CLIP_PADDING_SECONDS
  const prefixBytes = Math.ceil(maxEndSec * CLIP_AUDIO_EST_BYTES_PER_SECOND)

  const [audioABytes, audioBBytes] = await Promise.all([
    r2Bytes.downloadObjectBytesPrefix({ objectKey: job.trackA.r2ObjectKey, byteLength: prefixBytes }),
    r2Bytes.downloadObjectBytesPrefix({ objectKey: job.trackB.r2ObjectKey, byteLength: prefixBytes }),
  ])

  const [aTranscript, bTranscript] = await Promise.all([
    buildChunkedTranscript({
      jobId: input.jobId,
      audioBytes: audioABytes,
      mimeType: job.trackA.mimeType,
      trackLabel: 'A',
      battleId: job.battleId,
    }),
    buildChunkedTranscript({
      jobId: input.jobId,
      audioBytes: audioBBytes,
      mimeType: job.trackB.mimeType,
      trackLabel: 'B',
      battleId: job.battleId,
    }),
  ])

  const [aAnalysis, bAnalysis] = await Promise.all([
    buildChunkedAudioAnalysis({
      jobId: input.jobId,
      audioBytes: audioABytes,
      mimeType: job.trackA.mimeType,
      trackLabel: 'A',
      battleId: job.battleId,
    }),
    buildChunkedAudioAnalysis({
      jobId: input.jobId,
      audioBytes: audioBBytes,
      mimeType: job.trackB.mimeType,
      trackLabel: 'B',
      battleId: job.battleId,
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
