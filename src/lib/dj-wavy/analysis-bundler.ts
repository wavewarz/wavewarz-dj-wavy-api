import type { AudioChunkWindow } from '../chunking'
import { db } from '../db'
import { callGeminiAnalyzeWindow, type DjWavyAudioAnalysis } from './analyze'

export const buildChunkedAudioAnalysis = async (input: {
  jobId: string
  audioBytes: ArrayBuffer
  mimeType: string
  trackLabel: 'A' | 'B'
  battleId: string
  windows: AudioChunkWindow[]
}): Promise<{ model: string; analyzerVersion: 'fft_features_v1'; analysis: DjWavyAudioAnalysis[] }> => {
  const analyzerVersion = 'fft_features_v1' as const
  const pieces: DjWavyAudioAnalysis[] = []
  let usedModel = 'unknown'

  for (const w of input.windows) {
    const cached = await db.getAudioAnalysis({
      jobId: input.jobId,
      trackSlot: input.trackLabel,
      windowStartSeconds: w.startSeconds,
      windowDurationSeconds: w.durationSeconds,
      analyzerVersion,
    })

    if (cached) {
      pieces.push(cached as DjWavyAudioAnalysis)
      continue
    }

    const { model, analysis } = await callGeminiAnalyzeWindow({
      audioBytes: input.audioBytes,
      mimeType: input.mimeType,
      trackLabel: input.trackLabel,
      battleId: input.battleId,
      window: w,
      analyzerVersion,
    })

    usedModel = model

    await db.saveAudioAnalysis({
      jobId: input.jobId,
      trackSlot: input.trackLabel,
      windowStartSeconds: w.startSeconds,
      windowDurationSeconds: w.durationSeconds,
      analyzerVersion,
      analysis,
    })

    pieces.push(analysis)
  }

  return { model: usedModel, analyzerVersion, analysis: pieces }
}
