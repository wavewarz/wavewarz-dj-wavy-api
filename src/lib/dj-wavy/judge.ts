import { getGeminiClient } from './gemini-client'
import type { DjWavyJudgement } from '../types'
import { parseDjWavyJudgementJson } from './validate'

export const callGeminiJudge = async (input: {
  battleId: string
  prompt: string
  audioABytes: ArrayBuffer
  audioBBytes: ArrayBuffer
  mimeTypeA: string
  mimeTypeB: string
}): Promise<{ model: string; judgement: DjWavyJudgement; raw: string }> => {
  const modelName = process.env.DJ_WAVY_GEMINI_MODEL || 'gemini-2.5-pro'

  const genAI = getGeminiClient()
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  })

  const aBase64 = Buffer.from(input.audioABytes).toString('base64')
  const bBase64 = Buffer.from(input.audioBBytes).toString('base64')

  const res = await model.generateContent([
    { text: input.prompt },
    { inlineData: { mimeType: input.mimeTypeA, data: aBase64 } },
    { inlineData: { mimeType: input.mimeTypeB, data: bBase64 } },
  ])

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
