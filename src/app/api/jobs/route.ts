import { NextResponse } from 'next/server'
import { r2 } from '../../../lib/r2'
import type { CreateJobApiRequest, CreateJobRequest } from '../../../lib/types'
import { db } from '../../../lib/db'
import { processJob } from '../../../lib/worker'

const json = (status: number, body: unknown) => NextResponse.json(body, { status })

export async function POST(req: Request) {
  let body: CreateJobApiRequest
  try {
    body = (await req.json()) as CreateJobApiRequest
  } catch {
    return json(400, { error: 'invalid_json' })
  }

  if (!body?.battleId) return json(400, { error: 'missing_battleId' })
  if (!body?.trackA?.title) return json(400, { error: 'missing_trackA' })
  if (!body?.trackB?.title) return json(400, { error: 'missing_trackB' })

  const aUpload = await r2.createSignedUpload({ prefix: `jobs/${body.battleId}/A`, contentType: body.trackA.mimeType })
  const bUpload = await r2.createSignedUpload({ prefix: `jobs/${body.battleId}/B`, contentType: body.trackB.mimeType })

  const internal: CreateJobRequest = {
    battleId: body.battleId,
    trackA: { ...body.trackA, r2ObjectKey: aUpload.objectKey },
    trackB: { ...body.trackB, r2ObjectKey: bUpload.objectKey },
  }

  const job = await db.createJob(internal)

  if (body.processNow) {
    void processJob({ jobId: job.id })
  }

  return json(200, {
    job: {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
    uploads: {
      trackA: {
        objectKey: aUpload.objectKey,
        uploadUrl: aUpload.uploadUrl,
        expiresInSeconds: aUpload.expiresInSeconds,
        requiredContentType: body.trackA.mimeType,
      },
      trackB: {
        objectKey: bUpload.objectKey,
        uploadUrl: bUpload.uploadUrl,
        expiresInSeconds: bUpload.expiresInSeconds,
        requiredContentType: body.trackB.mimeType,
      },
    },
  })
}
