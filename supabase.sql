create table if not exists public.dj_wavy_jobs (
  id uuid primary key,
  status text not null check (status in ('queued', 'processing', 'succeeded', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  battle_id text not null,

  track_a_title text not null,
  track_a_artist_handle text not null,
  track_a_duration_seconds integer,
  track_a_mime_type text not null,
  track_a_r2_object_key text,

  track_b_title text not null,
  track_b_artist_handle text not null,
  track_b_duration_seconds integer,
  track_b_mime_type text not null,
  track_b_r2_object_key text,

  result_id uuid,
  error text
);

create index if not exists dj_wavy_jobs_status_created_at_idx on public.dj_wavy_jobs (status, created_at);
create index if not exists dj_wavy_jobs_battle_id_idx on public.dj_wavy_jobs (battle_id);

create table if not exists public.dj_wavy_transcripts (
  id uuid primary key,
  job_id uuid not null references public.dj_wavy_jobs(id) on delete cascade,
  track_slot text not null check (track_slot in ('A', 'B')),
  window_start_seconds integer not null,
  window_duration_seconds integer not null,
  model text not null,
  prompt_version text not null,
  transcript text not null,
  created_at timestamptz not null default now(),

  unique(job_id, track_slot, window_start_seconds, window_duration_seconds, model, prompt_version)
);

create index if not exists dj_wavy_transcripts_job_track_window_idx on public.dj_wavy_transcripts (job_id, track_slot, window_start_seconds);

create table if not exists public.dj_wavy_audio_analysis (
  id uuid primary key,
  job_id uuid not null references public.dj_wavy_jobs(id) on delete cascade,
  track_slot text not null check (track_slot in ('A', 'B')),
  window_start_seconds integer not null,
  window_duration_seconds integer not null,
  analyzer_version text not null,
  analysis jsonb not null,
  created_at timestamptz not null default now(),

  unique(job_id, track_slot, window_start_seconds, window_duration_seconds, analyzer_version)
);

create index if not exists dj_wavy_audio_analysis_job_track_window_idx on public.dj_wavy_audio_analysis (job_id, track_slot, window_start_seconds);

create table if not exists public.dj_wavy_judgements (
  id uuid primary key,
  job_id uuid not null unique references public.dj_wavy_jobs(id) on delete cascade,
  model text not null,
  prompt_version text not null,
  schema_version text not null,
  judgement jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists dj_wavy_judgements_created_at_idx on public.dj_wavy_judgements (created_at);

create or replace function public.dj_wavy_touch_job_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists dj_wavy_jobs_touch_updated_at on public.dj_wavy_jobs;
create trigger dj_wavy_jobs_touch_updated_at
before update on public.dj_wavy_jobs
for each row execute function public.dj_wavy_touch_job_updated_at();

create table if not exists public.dj_wavy_job_locks (
  job_id uuid primary key references public.dj_wavy_jobs(id) on delete cascade,
  locked_until timestamptz not null,
  locked_by text not null,
  created_at timestamptz not null default now()
);

create index if not exists dj_wavy_job_locks_locked_until_idx on public.dj_wavy_job_locks (locked_until);

create or replace function public.acquire_dj_wavy_job_lock(p_job_id uuid, p_locked_by text, p_ttl_seconds integer)
returns boolean
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_until timestamptz := now() + make_interval(secs => p_ttl_seconds);
begin
  insert into public.dj_wavy_job_locks(job_id, locked_until, locked_by)
  values (p_job_id, v_until, p_locked_by)
  on conflict (job_id) do update
    set locked_until = excluded.locked_until,
        locked_by = excluded.locked_by
    where public.dj_wavy_job_locks.locked_until < v_now;

  return exists(
    select 1
    from public.dj_wavy_job_locks
    where job_id = p_job_id
      and locked_until = v_until
      and locked_by = p_locked_by
  );
end;
$$;

create or replace function public.release_dj_wavy_job_lock(p_job_id uuid, p_locked_by text)
returns void
language sql
as $$
  delete from public.dj_wavy_job_locks where job_id = p_job_id and locked_by = p_locked_by;
$$;
