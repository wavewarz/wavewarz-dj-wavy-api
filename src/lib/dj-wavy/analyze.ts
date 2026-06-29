import type { AudioChunkWindow } from '../chunking'
import { decodeAudioWindowToMonoFloat32 } from '../audio/decode'
import { analyzePcmWindow, mapFeaturesToScores } from '../audio/fft-analysis'

export type DjWavyAudioAnalysis = {
  window: { startSeconds: number; endSeconds: number }
  loudness: number
  brightness: number
  dynamicRange: number
  vocalPresence: number
  mixClarity: number
  energy: number
  notes: string
}

export const callGeminiAnalyzeWindow = async (input: {
  audioBytes: ArrayBuffer
  mimeType: string
  trackLabel: 'A' | 'B'
  battleId: string
  window: AudioChunkWindow
  analyzerVersion: 'fft_features_v1'
}): Promise<{ model: string; analysis: DjWavyAudioAnalysis; raw: string }> => {
  const sampleRateHz = 16_000
  const start = input.window.startSeconds
  const end = input.window.startSeconds + input.window.durationSeconds
  const samples = await decodeAudioWindowToMonoFloat32({
    audioBytes: input.audioBytes,
    window: { startSeconds: start, durationSeconds: input.window.durationSeconds },
    sampleRateHz,
  })

  const features = analyzePcmWindow({ samples, sampleRateHz })
  const scored = mapFeaturesToScores(features)

  const analysis: DjWavyAudioAnalysis = {
    window: { startSeconds: start, endSeconds: end },
    loudness: scored.loudness,
    brightness: scored.brightness,
    dynamicRange: scored.dynamicRange,
    vocalPresence: scored.vocalPresence,
    mixClarity: scored.mixClarity,
    energy: scored.energy,
    notes: scored.notes,
  }

  // raw kept for parity with previous API; now it's a compact feature dump.
  const raw = JSON.stringify({
    sampleRateHz,
    window: analysis.window,
    features,
  })

  return { model: 'local_fft', analysis, raw }
}
