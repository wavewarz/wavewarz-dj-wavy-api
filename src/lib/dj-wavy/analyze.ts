import { getGeminiClient } from './gemini-client'
import type { AudioChunkWindow } from '../chunking'

const extractFirstJsonObject = (content: string): string | null => {
  const trimmed = content.trim()

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenceMatch?.[1]) return fenceMatch[1].trim()

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  return trimmed.slice(start, end + 1).trim()
}

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
  analyzerVersion: 'gemini_features_v1'
}): Promise<{ model: string; analysis: DjWavyAudioAnalysis; raw: string }> => {
  const primaryModelName = process.env.DJ_WAVY_GEMINI_ANALYZE_MODEL || 'gemini-2.5-pro'
  const fallbackModelName = process.env.DJ_WAVY_GEMINI_ANALYZE_MODEL_FALLBACK

  const genAI = getGeminiClient()
  const buildModel = (modelName: string) =>
    genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    })

  const base64 = Buffer.from(input.audioBytes).toString('base64')

  const start = input.window.startSeconds
  const end = input.window.startSeconds + input.window.durationSeconds

  const prompt =
    `Analyze ONLY the audio segment between ${start}s and ${end}s.\n` +
    `Return STRICT JSON only (no markdown, no extra keys) with this schema:\n` +
    `{\n` +
    `  "window": { "startSeconds": number, "endSeconds": number },\n` +
    `  "loudness": number,\n` +
    `  "brightness": number,\n` +
    `  "dynamicRange": number,\n` +
    `  "vocalPresence": number,\n` +
    `  "mixClarity": number,\n` +
    `  "energy": number,\n` +
    `  "notes": string\n` +
    `}\n\n` +
    `Scales:\n` +
    `- loudness: 0-10\n` +
    `- brightness: 0-10\n` +
    `- dynamicRange: 0-10 (higher = more dynamic, less squashed)\n` +
    `- vocalPresence: 0-10\n` +
    `- mixClarity: 0-10\n` +
    `- energy: 0-10\n\n` +
    `Context: battle=${input.battleId}, track=${input.trackLabel}, analyzerVersion=${input.analyzerVersion}.`

  const tryOnce = async (modelName: string): Promise<{ model: string; analysis: DjWavyAudioAnalysis; raw: string }> => {
    const model = buildModel(modelName)

    const res = await model.generateContent([
      { text: prompt },
      { inlineData: { mimeType: input.mimeType, data: base64 } },
    ])

    const content = res.response.text()
    if (!content || typeof content !== 'string') throw new Error('gemini_empty_response')

    const raw = content.trim()
    const candidate = extractFirstJsonObject(raw) ?? raw

    let obj: unknown
    try {
      obj = JSON.parse(candidate) as unknown
    } catch {
      throw new Error('audio_analysis_json_parse_failed')
    }

    const a = obj as Partial<DjWavyAudioAnalysis>

    const analysis: DjWavyAudioAnalysis = {
      window: {
        startSeconds: typeof a.window?.startSeconds === 'number' ? a.window.startSeconds : start,
        endSeconds: typeof a.window?.endSeconds === 'number' ? a.window.endSeconds : end,
      },
      loudness: typeof a.loudness === 'number' ? a.loudness : Number(a.loudness),
      brightness: typeof a.brightness === 'number' ? a.brightness : Number(a.brightness),
      dynamicRange: typeof a.dynamicRange === 'number' ? a.dynamicRange : Number(a.dynamicRange),
      vocalPresence: typeof a.vocalPresence === 'number' ? a.vocalPresence : Number(a.vocalPresence),
      mixClarity: typeof a.mixClarity === 'number' ? a.mixClarity : Number(a.mixClarity),
      energy: typeof a.energy === 'number' ? a.energy : Number(a.energy),
      notes: typeof a.notes === 'string' ? a.notes : '',
    }

    for (const k of ['loudness', 'brightness', 'dynamicRange', 'vocalPresence', 'mixClarity', 'energy'] as const) {
      const v = analysis[k]
      if (!Number.isFinite(v)) throw new Error('invalid_audio_analysis_score')
    }
    if (!analysis.notes) throw new Error('missing_audio_analysis_notes')

    return { model: modelName, analysis, raw }
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
