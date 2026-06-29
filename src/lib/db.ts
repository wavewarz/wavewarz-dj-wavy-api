import { randomUUID } from 'node:crypto'
import type { DjWavyJudgement, JobRecord, JobStatus, ResultRecord } from './types'
import { supabaseAdmin } from './supabase-admin'

type TrackSlot = 'A' | 'B'

const mapJobRowToRecord = (row: any): JobRecord => {
  const input = {
    battleId: row.battle_id,
    trackA: {
      title: row.track_a_title,
      artistHandle: row.track_a_artist_handle,
      durationSeconds: row.track_a_duration_seconds,
      mimeType: row.track_a_mime_type,
      r2ObjectKey: row.track_a_r2_object_key,
    },
    trackB: {
      title: row.track_b_title,
      artistHandle: row.track_b_artist_handle,
      durationSeconds: row.track_b_duration_seconds,
      mimeType: row.track_b_mime_type,
      r2ObjectKey: row.track_b_r2_object_key,
    },
  }

  return {
    id: row.id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    input,
    resultId: row.result_id,
    error: row.error,
  }
}

export const db = {
  async createJob(input: JobRecord['input']): Promise<JobRecord> {
    const id = randomUUID()

    const { data, error } = await supabaseAdmin()
      .from('dj_wavy_jobs')
      .insert({
        id,
        status: 'queued',
        battle_id: input.battleId,

        track_a_title: input.trackA.title,
        track_a_artist_handle: input.trackA.artistHandle,
        track_a_duration_seconds: input.trackA.durationSeconds,
        track_a_mime_type: input.trackA.mimeType,
        track_a_r2_object_key: input.trackA.r2ObjectKey,

        track_b_title: input.trackB.title,
        track_b_artist_handle: input.trackB.artistHandle,
        track_b_duration_seconds: input.trackB.durationSeconds,
        track_b_mime_type: input.trackB.mimeType,
        track_b_r2_object_key: input.trackB.r2ObjectKey,

        result_id: null,
        error: null,
      })
      .select('*')
      .single()

    if (error) throw new Error(`db_createJob_failed: ${error.message}`)
    return mapJobRowToRecord(data)
  },

  async getJob(id: string): Promise<JobRecord | null> {
    const { data, error } = await supabaseAdmin().from('dj_wavy_jobs').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(`db_getJob_failed: ${error.message}`)
    if (!data) return null
    return mapJobRowToRecord(data)
  },

  async setJobStatus(input: { id: string; status: JobStatus; resultId?: string | null; error?: string | null }): Promise<void> {
    const patch: any = {
      status: input.status,
    }

    if (input.resultId !== undefined) patch.result_id = input.resultId
    if (input.error !== undefined) patch.error = input.error

    const { error } = await supabaseAdmin().from('dj_wavy_jobs').update(patch).eq('id', input.id)
    if (error) throw new Error(`db_setJobStatus_failed: ${error.message}`)
  },

  async createResult(input: { jobId: string; judgement: DjWavyJudgement; model: string; promptVersion: string; schemaVersion: string }): Promise<ResultRecord> {
    const id = randomUUID()

    const { error: jErr } = await supabaseAdmin()
      .from('dj_wavy_judgements')
      .insert({
        id,
        job_id: input.jobId,
        model: input.model,
        prompt_version: input.promptVersion,
        schema_version: input.schemaVersion,
        judgement: input.judgement,
      })

    if (jErr) throw new Error(`db_createJudgement_failed: ${jErr.message}`)

    const { error: jobErr } = await supabaseAdmin().from('dj_wavy_jobs').update({ result_id: id }).eq('id', input.jobId)
    if (jobErr) throw new Error(`db_setJobResultId_failed: ${jobErr.message}`)

    return { id, jobId: input.jobId, createdAt: new Date().toISOString(), judgement: input.judgement }
  },

  async getResult(id: string): Promise<ResultRecord | null> {
    const { data, error } = await supabaseAdmin().from('dj_wavy_judgements').select('*').eq('id', id).maybeSingle()
    if (error) throw new Error(`db_getResult_failed: ${error.message}`)
    if (!data) return null

    return {
      id: data.id,
      jobId: data.job_id,
      createdAt: data.created_at,
      judgement: data.judgement,
    }
  },

  async getResultByJobId(jobId: string): Promise<ResultRecord | null> {
    const { data, error } = await supabaseAdmin().from('dj_wavy_judgements').select('*').eq('job_id', jobId).maybeSingle()
    if (error) throw new Error(`db_getResultByJobId_failed: ${error.message}`)
    if (!data) return null

    return {
      id: data.id,
      jobId: data.job_id,
      createdAt: data.created_at,
      judgement: data.judgement,
    }
  },

  async acquireJobLock(input: { jobId: string; lockedBy: string; ttlSeconds: number }): Promise<boolean> {
    const { data, error } = await supabaseAdmin().rpc('acquire_dj_wavy_job_lock', {
      p_job_id: input.jobId,
      p_locked_by: input.lockedBy,
      p_ttl_seconds: input.ttlSeconds,
    })

    if (error) throw new Error(`db_acquireJobLock_failed: ${error.message}`)
    return Boolean(data)
  },

  async releaseJobLock(input: { jobId: string; lockedBy: string }): Promise<void> {
    const { error } = await supabaseAdmin().rpc('release_dj_wavy_job_lock', {
      p_job_id: input.jobId,
      p_locked_by: input.lockedBy,
    })

    if (error) throw new Error(`db_releaseJobLock_failed: ${error.message}`)
  },

  async getTranscript(input: {
    jobId: string
    trackSlot: TrackSlot
    windowStartSeconds: number
    windowDurationSeconds: number
    model: string
    promptVersion: string
  }): Promise<string | null> {
    const { data, error } = await supabaseAdmin()
      .from('dj_wavy_transcripts')
      .select('transcript')
      .eq('job_id', input.jobId)
      .eq('track_slot', input.trackSlot)
      .eq('window_start_seconds', input.windowStartSeconds)
      .eq('window_duration_seconds', input.windowDurationSeconds)
      .eq('model', input.model)
      .eq('prompt_version', input.promptVersion)
      .maybeSingle()

    if (error) throw new Error(`db_getTranscript_failed: ${error.message}`)
    return data?.transcript ?? null
  },

  async saveTranscript(input: {
    jobId: string
    trackSlot: TrackSlot
    windowStartSeconds: number
    windowDurationSeconds: number
    model: string
    promptVersion: string
    transcript: string
  }): Promise<void> {
    const { error } = await supabaseAdmin().from('dj_wavy_transcripts').upsert(
      {
        id: randomUUID(),
        job_id: input.jobId,
        track_slot: input.trackSlot,
        window_start_seconds: input.windowStartSeconds,
        window_duration_seconds: input.windowDurationSeconds,
        model: input.model,
        prompt_version: input.promptVersion,
        transcript: input.transcript,
      },
      {
        onConflict: 'job_id,track_slot,window_start_seconds,window_duration_seconds,model,prompt_version',
      }
    )

    if (error) throw new Error(`db_saveTranscript_failed: ${error.message}`)
  },

  async getAudioAnalysis(input: {
    jobId: string
    trackSlot: TrackSlot
    windowStartSeconds: number
    windowDurationSeconds: number
    analyzerVersion: string
  }): Promise<any | null> {
    const { data, error } = await supabaseAdmin()
      .from('dj_wavy_audio_analysis')
      .select('analysis')
      .eq('job_id', input.jobId)
      .eq('track_slot', input.trackSlot)
      .eq('window_start_seconds', input.windowStartSeconds)
      .eq('window_duration_seconds', input.windowDurationSeconds)
      .eq('analyzer_version', input.analyzerVersion)
      .maybeSingle()

    if (error) throw new Error(`db_getAudioAnalysis_failed: ${error.message}`)
    return data?.analysis ?? null
  },

  async saveAudioAnalysis(input: {
    jobId: string
    trackSlot: TrackSlot
    windowStartSeconds: number
    windowDurationSeconds: number
    analyzerVersion: string
    analysis: any
  }): Promise<void> {
    const { error } = await supabaseAdmin().from('dj_wavy_audio_analysis').upsert(
      {
        id: randomUUID(),
        job_id: input.jobId,
        track_slot: input.trackSlot,
        window_start_seconds: input.windowStartSeconds,
        window_duration_seconds: input.windowDurationSeconds,
        analyzer_version: input.analyzerVersion,
        analysis: input.analysis,
      },
      {
        onConflict: 'job_id,track_slot,window_start_seconds,window_duration_seconds,analyzer_version',
      }
    )

    if (error) throw new Error(`db_saveAudioAnalysis_failed: ${error.message}`)
  },
}
