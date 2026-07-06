import type { AudioChunkWindow } from '../chunking'
import { callGeminiTranscribeWindow } from './transcribe'
import { db } from '../db'

export const buildChunkedTranscript = async (input: {
  jobId: string
  audioBytes: ArrayBuffer
  mimeType: string
  trackLabel: 'A' | 'B'
  battleId: string
  windows: AudioChunkWindow[]
}): Promise<{ model: string; transcriptText: string }> => {
  const pieces: string[] = []
  let usedModel = 'unknown'

  const promptVersion = 'transcribe_v1'

  for (const w of input.windows) {
    const modelName = process.env.DJ_WAVY_GEMINI_TRANSCRIBE_MODEL || 'gemini-2.5-pro'
    const cached = await db.getTranscript({
      jobId: input.jobId,
      trackSlot: input.trackLabel,
      windowStartSeconds: w.startSeconds,
      windowDurationSeconds: w.durationSeconds,
      model: modelName,
      promptVersion,
    })

    if (cached) {
      usedModel = modelName
      pieces.push(`--- chunk ${w.startSeconds}-${w.startSeconds + w.durationSeconds}s ---\n${cached}`)
      continue
    }

    const { model, transcript } = await callGeminiTranscribeWindow({
      audioBytes: input.audioBytes,
      mimeType: input.mimeType,
      trackLabel: input.trackLabel,
      battleId: input.battleId,
      window: w,
    })
    usedModel = model

    await db.saveTranscript({
      jobId: input.jobId,
      trackSlot: input.trackLabel,
      windowStartSeconds: w.startSeconds,
      windowDurationSeconds: w.durationSeconds,
      model,
      promptVersion,
      transcript,
    })

    pieces.push(
      `--- chunk ${w.startSeconds}-${w.startSeconds + w.durationSeconds}s ---\n${transcript}`
    )
  }

  return { model: usedModel, transcriptText: pieces.join('\n\n') }
}
