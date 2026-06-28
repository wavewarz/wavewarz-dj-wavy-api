import { randomUUID } from 'node:crypto'
import type { CreateJobRequest, JobRecord, ResultRecord } from './types'

type StoreState = {
  jobs: Map<string, JobRecord>
  results: Map<string, ResultRecord>
}

const state: StoreState = {
  jobs: new Map(),
  results: new Map(),
}

const nowIso = () => new Date().toISOString()

export const store = {
  createJob(input: CreateJobRequest): JobRecord {
    const id = randomUUID()
    const ts = nowIso()
    const rec: JobRecord = {
      id,
      status: 'queued',
      createdAt: ts,
      updatedAt: ts,
      input,
      resultId: null,
      error: null,
    }
    state.jobs.set(id, rec)
    return rec
  },

  getJob(id: string): JobRecord | null {
    return state.jobs.get(id) ?? null
  },

  setJob(job: JobRecord): void {
    state.jobs.set(job.id, { ...job, updatedAt: nowIso() })
  },

  createResult(input: Omit<ResultRecord, 'id' | 'createdAt'>): ResultRecord {
    const id = randomUUID()
    const rec: ResultRecord = { id, createdAt: nowIso(), ...input }
    state.results.set(id, rec)
    return rec
  },

  getResult(id: string): ResultRecord | null {
    return state.results.get(id) ?? null
  },

  getResultByJobId(jobId: string): ResultRecord | null {
    for (const r of state.results.values()) {
      if (r.jobId === jobId) return r
    }
    return null
  },
}
