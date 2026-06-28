import { NextResponse } from 'next/server'
import { store } from '../../../../lib/store'
import { processJob } from '../../../../lib/worker'

const json = (status: number, body: unknown) => NextResponse.json(body, { status })

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const job = store.getJob(id)
  if (!job) return json(404, { error: 'job_not_found' })

  if (job.status === 'queued') {
    void processJob({ jobId: job.id })
  }

  return json(200, { job })
}
