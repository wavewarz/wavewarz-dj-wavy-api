import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { randomUUID } from 'node:crypto'
import { getEnv } from './env'

type SignedUpload = {
  objectKey: string
  uploadUrl: string
  expiresInSeconds: number
}

type SignedDownload = {
  downloadUrl: string
  expiresInSeconds: number
}

const getClient = () => {
  const env = getEnv()
  return {
    env,
    client: new S3Client({
      region: 'auto',
      endpoint: env.R2_ENDPOINT,
      forcePathStyle: true,
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
    }),
  }
}

export const r2 = {
  async createSignedUpload(input: { prefix: string; contentType: string; expiresInSeconds?: number }): Promise<SignedUpload> {
    const { env, client } = getClient()
    const expiresInSeconds = input.expiresInSeconds ?? 15 * 60

    const objectKey = `${input.prefix}/${randomUUID()}`

    const cmd = new PutObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: objectKey,
      ContentType: input.contentType,
    })

    const uploadUrl = await getSignedUrl(client, cmd, { expiresIn: expiresInSeconds })

    return { objectKey, uploadUrl, expiresInSeconds }
  },

  async createSignedDownload(input: { objectKey: string; expiresInSeconds?: number }): Promise<SignedDownload> {
    const { env, client } = getClient()
    const expiresInSeconds = input.expiresInSeconds ?? 15 * 60

    const cmd = new GetObjectCommand({
      Bucket: env.R2_BUCKET,
      Key: input.objectKey,
    })

    const downloadUrl = await getSignedUrl(client, cmd, { expiresIn: expiresInSeconds })

    return { downloadUrl, expiresInSeconds }
  },
}
