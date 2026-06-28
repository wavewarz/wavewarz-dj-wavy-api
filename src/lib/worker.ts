import { mockJudge } from './dj-wavy/mock-judge'
import { runRealDjWavyJudging } from './dj-wavy/real-pipeline'
import { store } from './store'

const nowIso = () => new Date().toISOString()

export const processJob = async (input: { jobId: string }): Promise<void> => {
  const job = store.getJob(input.jobId)
  if (!job) return

  if (job.status === 'processing' || job.status === 'succeeded') return

  store.setJob({ ...job, status: 'processing', updatedAt: nowIso(), error: null })

  try {
    const provider = (process.env.DJ_WAVY_PROVIDER ?? 'mock').toLowerCase()

    const judged = await (provider === 'gemini'
      ? runRealDjWavyJudging(job.input)
      : mockJudge({ battleId: job.input.battleId }))

    const result = store.createResult({
      jobId: job.id,
      judgement: judged.judgement,
    })

    store.setJob({ ...store.getJob(job.id)!, status: 'succeeded', resultId: result.id, error: null, updatedAt: nowIso() })
  } catch (e) {
    const err = e instanceof Error ? e.message : 'unknown_error'
    store.setJob({ ...store.getJob(job.id)!, status: 'failed', error: err, updatedAt: nowIso() })
  }
}
