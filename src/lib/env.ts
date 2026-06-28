export type Env = {
  R2_ACCESS_KEY_ID: string
  R2_SECRET_ACCESS_KEY: string
  R2_BUCKET: string
  R2_ENDPOINT: string
  RESULTS_TTL_DAYS: number
}

const must = (key: Exclude<keyof Env, 'RESULTS_TTL_DAYS'>) => {
  const v = process.env[key]
  if (!v) throw new Error(`missing_env_${key}`)
  return v
}

export const getEnv = (): Env => {
  return {
    R2_ACCESS_KEY_ID: must('R2_ACCESS_KEY_ID'),
    R2_SECRET_ACCESS_KEY: must('R2_SECRET_ACCESS_KEY'),
    R2_BUCKET: must('R2_BUCKET'),
    R2_ENDPOINT: must('R2_ENDPOINT'),
    RESULTS_TTL_DAYS: Number(process.env.RESULTS_TTL_DAYS ?? 7),
  }
}
