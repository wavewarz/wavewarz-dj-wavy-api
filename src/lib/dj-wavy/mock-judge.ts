import type { DjWavyJudgement } from '../types'

export const mockJudge = async (input: { battleId: string }): Promise<{ model: string; judgement: DjWavyJudgement }> => {
  const judgement: DjWavyJudgement = {
    battleId: input.battleId,
    winner: 'A',
    confidence: 0.62,
    comparison:
      'Mocked judgement (Repo B not fully wired). Track A edges Track B on mix clarity and arrangement, but both have potential.',
    metrics: {
      sonic_landscape: { A: 8, B: 7, notes: 'A has slightly cleaner low-end; B has a bit of masking in mids.' },
      vocal_performance: { A: 7, B: 7, notes: 'Both deliver; A feels a touch more confident in phrasing.' },
      production_arrangement: { A: 8, B: 7, notes: 'A develops sections more; B repeats hooks without new layers.' },
      lyricism_storytelling: { A: 7, B: 6, notes: 'A is more direct and quotable; B needs tighter concepts.' },
      web3_market_readiness: { A: 8, B: 7, notes: 'A is more playlist-ready; B needs polish for competitive release.' },
    },
    model: 'mock',
    createdAt: new Date().toISOString(),
    promptVersion: 'oracle_v1',
    schemaVersion: 'scorecard_v1',
  }

  return { model: 'mock', judgement }
}
