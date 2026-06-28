import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'
import { processJob } from '../../../../lib/worker'

type Payload = { jobId: string }

async function handler(req: Request) {
  const body = (await req.json()) as Partial<Payload>

  if (!body?.jobId) {
    return new Response(JSON.stringify({ error: 'missing_jobId' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  await processJob({ jobId: body.jobId })

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

export const POST = verifySignatureAppRouter(handler)
