import { mockJudge } from './dj-wavy/mock-judge'
import { runRealDjWavyJudging } from './dj-wavy/real-pipeline'
import { db } from './db'

const nowIso = () => new Date().toISOString()

export const processJob = async (input: { jobId: string }): Promise<void> => {
  const lockedBy = `worker:${process.env.VERCEL_REGION ?? 'local'}:${process.pid}`

  const job = await db.getJob(input.jobId)
  if (!job) return

  if (job.status === 'processing' || job.status === 'succeeded') return

  const lockOk = await db.acquireJobLock({ jobId: job.id, lockedBy, ttlSeconds: 10 * 60 })
  if (!lockOk) return

  await db.setJobStatus({ id: job.id, status: 'processing', error: null })

  try {
    const provider = (process.env.DJ_WAVY_PROVIDER ?? 'mock').toLowerCase()

    const judged = await (provider === 'gemini'
      ? runRealDjWavyJudging({ jobId: job.id, job: job.input })
      : mockJudge({ battleId: job.input.battleId }))

    const result = await db.createResult({
      jobId: job.id,
      judgement: judged.judgement,
      model: judged.judgement.model,
      promptVersion: judged.judgement.promptVersion,
      schemaVersion: judged.judgement.schemaVersion,
    })

    await db.setJobStatus({ id: job.id, status: 'succeeded', resultId: result.id, error: null })
  } catch (e) {
    const err = e instanceof Error ? e.message : 'unknown_error'
    await db.setJobStatus({ id: job.id, status: 'failed', error: err })
  } finally {
    await db.releaseJobLock({ jobId: job.id, lockedBy })
  }
}
