import { NextResponse } from 'next/server'
import { processJob } from '../../../../../lib/worker'
import { db } from '../../../../../lib/db'
import { qstash } from '../../../../../lib/qstash'

const json = (status: number, body: unknown) => NextResponse.json(body, { status })

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  try {
    const job = await db.getJob(id)
    if (!job) return json(404, { error: 'job_not_found' })

    // Basic guard: only queue if we have both object keys (they're set at create time)
    if (!job.input.trackA.r2ObjectKey || !job.input.trackB.r2ObjectKey) {
      return json(400, { error: 'missing_r2_object_keys' })
    }

    const publicBaseUrl = process.env.PUBLIC_BASE_URL
    if (!publicBaseUrl) {
      return json(500, { error: 'missing_env_PUBLIC_BASE_URL' })
    }

    const webhookUrl = `${publicBaseUrl.replace(/\/$/, '')}/api/qstash/dj-wavy`

    // If you want to test without QStash, you can call with ?direct=1
    const direct = new URL(req.url).searchParams.get('direct')
    if (direct === '1') {
      await processJob({ jobId: job.id })
      return json(200, { ok: true, dispatched: 'direct' })
    }

    await qstash.publishJson({ url: webhookUrl, body: { jobId: job.id } })

    return json(200, { ok: true, dispatched: 'qstash' })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'unknown_error'
    return json(500, { error: 'uploads_complete_failed', message })
  }
}
