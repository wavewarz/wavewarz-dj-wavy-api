import { DJ_WAVY_CHUNK_WINDOWS } from '../chunking'
import { callGeminiTranscribeWindow } from './transcribe'

export const buildChunkedTranscript = async (input: {
  audioBytes: ArrayBuffer
  mimeType: string
  trackLabel: string
  battleId: string
}): Promise<{ model: string; transcriptText: string }> => {
  const pieces: string[] = []
  let usedModel = 'unknown'

  for (const w of DJ_WAVY_CHUNK_WINDOWS) {
    const { model, transcript } = await callGeminiTranscribeWindow({
      audioBytes: input.audioBytes,
      mimeType: input.mimeType,
      trackLabel: input.trackLabel,
      battleId: input.battleId,
      window: w,
    })
    usedModel = model
    pieces.push(
      `--- chunk ${w.startSeconds}-${w.startSeconds + w.durationSeconds}s ---\n${transcript}`
    )
  }

  return { model: usedModel, transcriptText: pieces.join('\n\n') }
}
