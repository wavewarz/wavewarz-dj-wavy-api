import { mockJudge } from './dj-wavy/mock-judge'
import { runRealDjWavyJudging } from './dj-wavy/real-pipeline'
import { db } from './db'
import { qstash } from './qstash'

const nowIso = () => new Date().toISOString()

const RETRY_WINDOW_MS = 5 * 60 * 1000
const RETRY_DELAY_SECONDS = 30
const WORKER_SOFT_TIMEOUT_MS = Number(process.env.WORKER_SOFT_TIMEOUT_MS ?? 55_000)

const retryMetaFromError = (error: string | null | undefined): { retryUntilIso: string | null; attempts: number } => {
  if (!error) return { retryUntilIso: null, attempts: 0 }

  const until = error.match(/retry_until=([^;\s]+)/i)?.[1] ?? null
  const attemptsRaw = error.match(/attempts=(\d+)/i)?.[1]
  const attempts = attemptsRaw ? Number(attemptsRaw) : 0
  return { retryUntilIso: until, attempts: Number.isFinite(attempts) ? attempts : 0 }
}

const isRetryableUpstreamError = (msg: string): boolean => {
  const m = msg.toLowerCase()
  return (
    m.includes('[503') ||
    m.includes('503 service unavailable') ||
    m.includes('high demand') ||
    m.includes('[429') ||
    m.includes('429') ||
    m.includes('rate limit') ||
    m.includes('timeout') ||
    m.includes('socket hang up')
  )
}

export const processJob = async (input: { jobId: string }): Promise<void> => {
  const lockedBy = `worker:${process.env.VERCEL_REGION ?? 'local'}:${process.pid}`

  const job = await db.getJob(input.jobId)
  if (!job) return

  if (job.status === 'succeeded') return

  const lockOk = await db.acquireJobLock({ jobId: job.id, lockedBy, ttlSeconds: 3 * 60 })
  if (!lockOk) return

  await db.setJobStatus({ id: job.id, status: 'processing', error: null })

  let softTimeoutHandle: ReturnType<typeof setTimeout> | undefined
  const softTimeoutPromise = new Promise<never>((_, reject) => {
    softTimeoutHandle = setTimeout(
      () => reject(new Error(`worker_soft_timeout: exceeded ${WORKER_SOFT_TIMEOUT_MS}ms`)),
      WORKER_SOFT_TIMEOUT_MS,
    )
  })

  try {
    const provider = (process.env.DJ_WAVY_PROVIDER ?? 'mock').toLowerCase()

    const judged = await Promise.race([
      provider === 'gemini'
        ? runRealDjWavyJudging({ jobId: job.id, job: job.input })
        : mockJudge({ battleId: job.input.battleId }),
      softTimeoutPromise,
    ])

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

    if (isRetryableUpstreamError(err)) {
      const meta = retryMetaFromError(job.error)
      const now = Date.now()
      const retryUntil = meta.retryUntilIso ? Date.parse(meta.retryUntilIso) : now + RETRY_WINDOW_MS

      if (!Number.isFinite(retryUntil) || now > retryUntil) {
        await db.setJobStatus({ id: job.id, status: 'failed', error: `retry_budget_exhausted: ${err}` })
        return
      }

      const attempts = meta.attempts + 1

      await db.setJobStatus({
        id: job.id,
        status: 'queued',
        error: `retryable_upstream_error: ${err}; retry_until=${new Date(retryUntil).toISOString()}; attempts=${attempts}`,
      })

      const publicBaseUrl = process.env.PUBLIC_BASE_URL
      if (!publicBaseUrl) {
        throw new Error('missing_env_PUBLIC_BASE_URL')
      }

      const webhookUrl = `${publicBaseUrl.replace(/\/$/, '')}/api/qstash/dj-wavy`
      await qstash.publishJson({ url: webhookUrl, body: { jobId: job.id }, delaySeconds: RETRY_DELAY_SECONDS })

      return
    }

    await db.setJobStatus({ id: job.id, status: 'failed', error: err })
  } finally {
    clearTimeout(softTimeoutHandle)
    await db.releaseJobLock({ jobId: job.id, lockedBy })
  }
}
