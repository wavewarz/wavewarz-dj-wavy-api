import { NextResponse } from 'next/server'
import { db } from '../../../../lib/db'

const json = (status: number, body: unknown) => NextResponse.json(body, { status })

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const job = await db.getJob(id)
  if (!job) return json(404, { error: 'job_not_found' })

  return json(200, { job })
}
