import { Receiver } from '@upstash/qstash'
import { processJob } from '../../../../lib/worker'

export const maxDuration = 300

type Payload = { jobId: string }

export async function POST(req: Request) {
  const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
  const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY
  if (!currentSigningKey || !nextSigningKey) {
    return new Response(JSON.stringify({ error: 'missing_qstash_signing_keys' }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  const signature = req.headers.get('upstash-signature')
  if (!signature) {
    return new Response(JSON.stringify({ error: 'missing_qstash_signature' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const rawBody = await req.text()

  const receiver = new Receiver({ currentSigningKey, nextSigningKey })
  const ok = await receiver.verify({
    signature,
    body: rawBody,
    url: req.url,
  })

  if (!ok) {
    return new Response(JSON.stringify({ error: 'invalid_qstash_signature' }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    })
  }

  const body = JSON.parse(rawBody) as Partial<Payload>

  if (!body?.jobId) {
    return new Response(JSON.stringify({ error: 'missing_jobId' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    })
  }

  try {
    await processJob({ jobId: body.jobId })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown_error'
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}
