import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { getEnv } from './env'

const getClient = () => {
  const env = getEnv()
  const client = new S3Client({
    region: 'auto',
    endpoint: env.R2_ENDPOINT,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    },
  })

  return { env, client }
}

const toArrayBuffer = async (body: unknown): Promise<ArrayBuffer> => {
  if (!body) throw new Error('r2_empty_body')

  const b = body as { transformToByteArray?: () => Promise<Uint8Array>; arrayBuffer?: () => Promise<ArrayBufferLike> }

  if (typeof b.transformToByteArray === 'function') {
    const bytes: Uint8Array = await b.transformToByteArray()
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  }

  if (typeof b.arrayBuffer === 'function') {
    const ab = (await b.arrayBuffer()) as ArrayBufferLike
    return ab.slice(0) as ArrayBuffer
  }

  const chunks: Buffer[] = []
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  const buf = Buffer.concat(chunks)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
}

export const r2Bytes = {
  async downloadObjectBytes(input: { objectKey: string }): Promise<ArrayBuffer> {
    const { env, client } = getClient()

    const cmd = new GetObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: input.objectKey,
    })

    const res = await client.send(cmd)
    return await toArrayBuffer(res.Body)
  },

  async downloadObjectBytesPrefix(input: { objectKey: string; byteLength: number }): Promise<ArrayBuffer> {
    const { env, client } = getClient()
    const len = Math.max(0, Math.floor(input.byteLength))
    if (len <= 0) return new ArrayBuffer(0)

    const cmd = new GetObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: input.objectKey,
      Range: `bytes=0-${len - 1}`,
    })

    const res = await client.send(cmd)
    return await toArrayBuffer(res.Body)
  },

  async createSignedDownloadUrl(input: { objectKey: string; expiresInSeconds?: number }): Promise<string> {
    const { env, client } = getClient()
    const expiresIn = input.expiresInSeconds ?? 15 * 60

    const cmd = new GetObjectCommand({ Bucket: env.R2_BUCKET, Key: input.objectKey })
    return await getSignedUrl(client, cmd, { expiresIn })
  },
}
