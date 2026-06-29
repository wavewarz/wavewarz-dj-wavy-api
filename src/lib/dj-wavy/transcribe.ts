import { getGeminiClient } from './gemini-client'
import type { AudioChunkWindow } from '../chunking'

const isRetryableGeminiError = (e: unknown): boolean => {
  const msg = e instanceof Error ? e.message : String(e)
  const m = msg.toLowerCase()
  return (
    m.includes('[503') ||
    m.includes('503 service unavailable') ||
    m.includes('high demand') ||
    m.includes('[429') ||
    m.includes('rate limit') ||
    m.includes('timeout')
  )
}

export const callGeminiTranscribeWindow = async (input: {
  audioBytes: ArrayBuffer
  mimeType: string
  trackLabel: string
  battleId: string
  window: AudioChunkWindow
}): Promise<{ model: string; transcript: string }> => {
  const primaryModelName = process.env.DJ_WAVY_GEMINI_TRANSCRIBE_MODEL || 'gemini-2.5-pro'
  const fallbackModelName = process.env.DJ_WAVY_GEMINI_TRANSCRIBE_MODEL_FALLBACK

  const genAI = getGeminiClient()
  const buildModel = (modelName: string) => genAI.getGenerativeModel({ model: modelName })

  const base64 = Buffer.from(input.audioBytes).toString('base64')

  const start = input.window.startSeconds
  const end = input.window.startSeconds + input.window.durationSeconds

  const prompt =
    `Transcribe the VOCALS/LYRICS of this song segment only.\n\n` +
    `Rules:\n` +
    `- Focus on what is sung/rapped between ${start}s and ${end}s.\n` +
    `- If words are unclear, write [inaudible].\n` +
    `- Preserve line breaks.\n` +
    `- Do NOT add commentary, analysis, or extra text. Output transcript text ONLY.`

  const tryOnce = async (modelName: string): Promise<{ model: string; transcript: string }> => {
    const model = buildModel(modelName)
    const res = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType: input.mimeType, data: base64 } },
    ])

    const text = res.response.text()
    const transcript = typeof text === 'string' ? text.trim() : ''
    if (!transcript) throw new Error('gemini_transcript_empty')

    return { model: modelName, transcript }
  }

  try {
    return await tryOnce(primaryModelName)
  } catch (e) {
    if (fallbackModelName && fallbackModelName !== primaryModelName && isRetryableGeminiError(e)) {
      const primaryMsg = e instanceof Error ? e.message : String(e)
      try {
        return await tryOnce(fallbackModelName)
      } catch (e2) {
        const fallbackMsg = e2 instanceof Error ? e2.message : String(e2)
        throw new Error(
          `primary_model_failed: ${primaryModelName} ${primaryMsg}; fallback_model_failed: ${fallbackModelName} ${fallbackMsg}`
        )
      }
    }
    throw e
  }
}
