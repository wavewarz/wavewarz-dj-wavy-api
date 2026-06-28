import { Client } from '@upstash/qstash'

export const qstash = {
  publishJson: async (input: { url: string; body: unknown; delaySeconds?: number }): Promise<void> => {
    const token = process.env.QSTASH_TOKEN
    if (!token) throw new Error('missing_env_QSTASH_TOKEN')

    const baseUrl = process.env.QSTASH_URL

    const client = new Client({ token, baseUrl })

    await client.publishJSON({
      url: input.url,
      body: input.body,
      delay: input.delaySeconds,
    })
  },
}
