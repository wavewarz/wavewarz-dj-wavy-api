import { createServer, IncomingMessage, ServerResponse } from 'node:http'
import { Receiver } from '@upstash/qstash'
import { processJob } from '../../src/lib/worker'

const PORT = Number(process.env.PORT ?? 8080)

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk: Buffer) => (data += chunk.toString()))
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })

const respond = (res: ServerResponse, status: number, body: unknown): void => {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  })
  res.end(payload)
}

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  try {
    if (req.method === 'GET' && req.url === '/health') {
      respond(res, 200, { ok: true })
      return
    }

    if (req.method === 'POST' && req.url === '/process') {
      const rawBody = await readBody(req)

      // Verify QStash signature when signing keys are configured
      const currentSigningKey = process.env.QSTASH_CURRENT_SIGNING_KEY
      const nextSigningKey = process.env.QSTASH_NEXT_SIGNING_KEY
      if (currentSigningKey && nextSigningKey) {
        const signature = req.headers['upstash-signature'] as string | undefined
        if (!signature) {
          respond(res, 401, { error: 'missing_qstash_signature' })
          return
        }
        // Use WORKER_PROCESS_URL as the canonical URL QStash signed against
        const fullUrl = process.env.WORKER_PROCESS_URL ?? (() => {
          const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ?? 'https'
          const host = (req.headers['x-forwarded-host'] as string | undefined) ?? req.headers['host'] ?? 'localhost'
          return `${proto}://${host}/process`
        })()
        const receiver = new Receiver({ currentSigningKey, nextSigningKey })
        const ok = await receiver.verify({ signature, body: rawBody, url: fullUrl })
        if (!ok) {
          respond(res, 401, { error: 'invalid_qstash_signature' })
          return
        }
      }

      let body: { jobId?: string }
      try {
        body = JSON.parse(rawBody) as { jobId?: string }
      } catch {
        respond(res, 400, { error: 'invalid_json' })
        return
      }

      if (!body?.jobId) {
        respond(res, 400, { error: 'missing_jobId' })
        return
      }

      await processJob({ jobId: body.jobId })
      respond(res, 200, { ok: true })
      return
    }

    respond(res, 404, { error: 'not_found' })
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'unknown_error'
    console.error('[dj-wavy-worker] error:', msg)
    // Return 500 so QStash retries the job
    respond(res, 500, { error: msg })
  }
})

server.listen(PORT, () => {
  console.log(`[dj-wavy-worker] listening on port ${PORT}`)
})
