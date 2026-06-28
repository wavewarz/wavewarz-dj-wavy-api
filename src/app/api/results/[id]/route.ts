import { NextResponse } from 'next/server'
import { store } from '@/lib/store'

const json = (status: number, body: unknown) => NextResponse.json(body, { status })

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params

  const result = store.getResult(id)
  if (!result) return json(404, { error: 'result_not_found' })

  return json(200, { result })
}
