import type { CreateJobRequest, DjWavyJudgement } from '../types'
import { r2Bytes } from '../r2-bytes'
import { buildChunkedTranscript } from './transcript-bundler'
import { buildDjWavyPrompt, jobToPromptTracks } from './prompt'
import { callGeminiJudge } from './judge'

export const runRealDjWavyJudging = async (job: CreateJobRequest): Promise<{ model: string; judgement: DjWavyJudgement }> => {
  const [audioABytes, audioBBytes] = await Promise.all([
    r2Bytes.downloadObjectBytes({ objectKey: job.trackA.r2ObjectKey }),
    r2Bytes.downloadObjectBytes({ objectKey: job.trackB.r2ObjectKey }),
  ])

  const [aTranscript, bTranscript] = await Promise.all([
    buildChunkedTranscript({
      audioBytes: audioABytes,
      mimeType: job.trackA.mimeType,
      trackLabel: 'A',
      battleId: job.battleId,
    }),
    buildChunkedTranscript({
      audioBytes: audioBBytes,
      mimeType: job.trackB.mimeType,
      trackLabel: 'B',
      battleId: job.battleId,
    }),
  ])

  const { trackA, trackB } = jobToPromptTracks(job, { A: aTranscript.transcriptText, B: bTranscript.transcriptText })

  const prompt = buildDjWavyPrompt({
    battleId: job.battleId,
    trackA,
    trackB,
    promptVersion: 'oracle_v1',
    schemaVersion: 'scorecard_v1',
  })

  const judged = await callGeminiJudge({
    battleId: job.battleId,
    prompt,
    audioABytes,
    audioBBytes,
    mimeTypeA: job.trackA.mimeType,
    mimeTypeB: job.trackB.mimeType,
  })

  return { model: judged.model, judgement: judged.judgement }
}
