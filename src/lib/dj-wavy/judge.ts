import { getGeminiClient } from './gemini-client'
import type { DjWavyJudgement } from '../types'
import { parseDjWavyJudgementJson } from './validate'

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

export const callGeminiJudge = async (input: {
  battleId: string
  prompt: string
}): Promise<{ model: string; judgement: DjWavyJudgement; raw: string }> => {
  const primaryModelName = process.env.DJ_WAVY_GEMINI_MODEL || 'gemini-2.5-pro'
  const fallbackModelName = process.env.DJ_WAVY_GEMINI_MODEL_FALLBACK

  const genAI = getGeminiClient()

  const tryOnce = async (modelName: string): Promise<{ model: string; judgement: DjWavyJudgement; raw: string }> => {
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    })

    const res = await model.generateContent([{ text: input.prompt }])

    const content = res.response.text()
    if (!content || typeof content !== 'string') throw new Error('gemini_empty_response')

    let judgement: DjWavyJudgement
    try {
      judgement = parseDjWavyJudgementJson({
        battleId: input.battleId,
        model: modelName,
        content: content.trim(),
      })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'judge_parse_failed'
      const snippet = content.trim().slice(0, 2000)
      throw new Error(`${msg} | raw_snippet=${JSON.stringify(snippet)}`)
    }

    return { model: modelName, judgement, raw: content }
  }

  try {
    return await tryOnce(primaryModelName)
  } catch (e) {
    if (fallbackModelName && fallbackModelName !== primaryModelName && isRetryableGeminiError(e)) {
      return await tryOnce(fallbackModelName)
    }
    throw e
  }
}
