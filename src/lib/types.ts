export type JobStatus = 'queued' | 'processing' | 'succeeded' | 'failed'

export type DjWavyMetricKey =
  | 'sonic_landscape'
  | 'vocal_performance'
  | 'production_arrangement'
  | 'lyricism_storytelling'
  | 'web3_market_readiness'

export type DjWavyJudgement = {
  battleId: string
  winner: 'A' | 'B'
  confidence: number
  comparison: string
  metrics: Record<DjWavyMetricKey, { A: number; B: number; notes?: string }>
  model: string
  createdAt: string
  promptVersion: 'oracle_v1'
  schemaVersion: 'scorecard_v1'
}

export type JobTrackApiInput = {
  title: string
  artistHandle: string
  durationSeconds: number | null
  mimeType: string
}

export type CreateJobApiRequest = {
  battleId: string
  trackA: JobTrackApiInput
  trackB: JobTrackApiInput
  processNow?: boolean
}

export type JobTrackInput = JobTrackApiInput & {
  r2ObjectKey: string
}

export type CreateJobRequest = {
  battleId: string
  trackA: JobTrackInput
  trackB: JobTrackInput
}

export type JobRecord = {
  id: string
  status: JobStatus
  createdAt: string
  updatedAt: string
  input: CreateJobRequest
  resultId: string | null
  error: string | null
}

export type ResultRecord = {
  id: string
  jobId: string
  createdAt: string
  judgement: DjWavyJudgement
}
