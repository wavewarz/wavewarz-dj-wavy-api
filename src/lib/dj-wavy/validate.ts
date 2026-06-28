import type { DjWavyJudgement, DjWavyMetricKey } from '../types'

const METRICS: DjWavyMetricKey[] = [
  'sonic_landscape',
  'vocal_performance',
  'production_arrangement',
  'lyricism_storytelling',
  'web3_market_readiness',
]

const extractFirstJsonObject = (content: string): string | null => {
  const trimmed = content.trim()

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  if (fenceMatch?.[1]) return fenceMatch[1].trim()

  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null

  return trimmed.slice(start, end + 1).trim()
}

const clampScore = (v: unknown): number => {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) throw new Error('invalid_metric_score')
  if (n < 0 || n > 10) throw new Error('metric_score_out_of_range')
  return Math.round(n * 10) / 10
}

const asMetric = (v: unknown): { A: unknown; B: unknown; notes?: unknown } => {
  if (!v || typeof v !== 'object') throw new Error('invalid_metric_object')
  return v as { A: unknown; B: unknown; notes?: unknown }
}

export const parseDjWavyJudgementJson = (input: {
  battleId: string
  model: string
  content: string
}): DjWavyJudgement => {
  let obj: unknown
  try {
    obj = JSON.parse(input.content) as unknown
  } catch {
    const extracted = extractFirstJsonObject(input.content)
    if (!extracted) throw new Error('judge_json_parse_failed')
    try {
      obj = JSON.parse(extracted) as unknown
    } catch {
      throw new Error('judge_json_parse_failed')
    }
  }

  const root = obj as {
    winner?: unknown
    confidence?: unknown
    comparison?: unknown
    metrics?: unknown
  }

  const winner = root?.winner
  if (winner !== 'A' && winner !== 'B') throw new Error('invalid_winner')

  const confidence = typeof root?.confidence === 'number' ? root.confidence : Number(root?.confidence)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) throw new Error('invalid_confidence')

  const comparison = typeof root?.comparison === 'string' ? root.comparison : ''
  if (!comparison) throw new Error('missing_comparison')

  const metricsObj = root?.metrics
  if (!metricsObj || typeof metricsObj !== 'object') throw new Error('missing_metrics')

  const metrics = {} as DjWavyJudgement['metrics']
  for (const k of METRICS) {
    const m = asMetric((metricsObj as Record<string, unknown>)[k])
    metrics[k] = {
      A: clampScore(m.A),
      B: clampScore(m.B),
      ...(typeof m.notes === 'string' && m.notes ? { notes: m.notes } : null),
    }
  }

  return {
    battleId: input.battleId,
    winner,
    confidence,
    comparison,
    metrics,
    model: input.model,
    createdAt: new Date().toISOString(),
    promptVersion: 'oracle_v1',
    schemaVersion: 'scorecard_v1',
  }
}
