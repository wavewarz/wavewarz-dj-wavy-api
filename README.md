# DJ Wavy API — Frontend Integration Guide

Backend for the DJ Wavy audio battle judging pipeline.  
**Base URL (production):** `https://wavewarz-dj-wavy-api.vercel.app`

---

## How It Works

```
Mobile App
  1. POST /api/jobs                       → create job, receive presigned R2 upload URLs
  2. PUT <uploadUrl>                      → upload audio files directly to R2 (from device)
  3. POST /api/jobs/:id/uploads-complete  → kick off processing
  4. GET  /api/jobs/:id                   → poll until status = "succeeded" | "failed"
  5. GET  /api/results/:id                → fetch the full judgement
```

---

## API Reference

### 1. Create Job

**`POST /api/jobs`**

Creates a job and returns pre-signed R2 URLs to upload the two audio files directly from the client.

**Request body:**
```json
{
  "battleId": "string",
  "trackA": {
    "title": "string",
    "artistHandle": "string",
    "mimeType": "audio/mpeg",
    "durationSeconds": null
  },
  "trackB": {
    "title": "string",
    "artistHandle": "string",
    "mimeType": "audio/mpeg",
    "durationSeconds": null
  }
}
```

> `battleId` must be unique per battle. Use the battle's ID from your database.  
> `mimeType` should match the actual file (e.g. `audio/mpeg` for MP3, `audio/mp4` for M4A).  
> `durationSeconds` can be `null` if unknown.

**Response `200`:**
```json
{
  "job": {
    "id": "uuid",
    "status": "queued",
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601"
  },
  "uploads": {
    "trackA": {
      "objectKey": "jobs/battle-123/A/uuid",
      "uploadUrl": "https://...r2.cloudflarestorage.com/...?X-Amz-...",
      "expiresInSeconds": 900,
      "requiredContentType": "audio/mpeg"
    },
    "trackB": {
      "objectKey": "jobs/battle-123/B/uuid",
      "uploadUrl": "https://...r2.cloudflarestorage.com/...?X-Amz-...",
      "expiresInSeconds": 900,
      "requiredContentType": "audio/mpeg"
    }
  }
}
```

> ⚠️ **Upload URLs expire in 15 minutes.** Start uploading immediately after receiving them.

---

### 2. Upload Audio Files to R2

Upload each file directly from the device using the presigned URL. **Do NOT proxy through your server.**

```
PUT <uploadUrl>
Content-Type: audio/mpeg   ← must match requiredContentType exactly
Body: <raw audio file bytes>
```

Expected response: `HTTP 200` with empty body.

**React Native example:**
```typescript
async function uploadTrack(uploadUrl: string, fileUri: string, mimeType: string) {
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': mimeType },
    body: await fetch(fileUri).then(r => r.blob()),
  })
  if (!response.ok) throw new Error(`Upload failed: ${response.status}`)
}
```

---

### 3. Signal Uploads Complete

**`POST /api/jobs/:id/uploads-complete`**

Call this after **both** files have uploaded successfully. This dispatches the job to the Cloud Run worker via QStash.

**Request body:** `{}` (empty)

**Response `200`:**
```json
{ "ok": true, "dispatched": "qstash" }
```

---

### 4. Poll Job Status

**`GET /api/jobs/:id`**

Poll this endpoint until `status` is `"succeeded"` or `"failed"`.

**Response `200`:**
```json
{
  "job": {
    "id": "uuid",
    "status": "queued | processing | succeeded | failed",
    "createdAt": "ISO8601",
    "updatedAt": "ISO8601",
    "input": {
      "battleId": "string",
      "trackA": { "title": "...", "artistHandle": "...", "mimeType": "...", "durationSeconds": null, "r2ObjectKey": "..." },
      "trackB": { "title": "...", "artistHandle": "...", "mimeType": "...", "durationSeconds": null, "r2ObjectKey": "..." }
    },
    "resultId": "uuid | null",
    "error": "string | null"
  }
}
```

**Status lifecycle:**

| Status | Meaning |
|---|---|
| `queued` | Job created, waiting for worker |
| `processing` | Worker is actively judging |
| `succeeded` | Done — `resultId` is set, fetch the result |
| `failed` | Error — `error` field has details |

**Recommended polling interval:** every 10–15 seconds. Jobs typically complete in 60–120 seconds.

```typescript
async function pollJob(jobId: string): Promise<Job> {
  while (true) {
    const res = await fetch(`${BASE_URL}/api/jobs/${jobId}`)
    const { job } = await res.json()
    if (job.status === 'succeeded' || job.status === 'failed') return job
    await new Promise(r => setTimeout(r, 10_000))
  }
}
```

---

### 5. Fetch Result

**`GET /api/results/:resultId`**

Fetch the full AI judgement once the job has `status: "succeeded"`.  
Use `job.resultId` from the poll response.

**Response `200`:**
```json
{
  "result": {
    "id": "uuid",
    "jobId": "uuid",
    "createdAt": "ISO8601",
    "judgement": {
      "battleId": "string",
      "winner": "A | B",
      "confidence": 0.65,
      "comparison": "Human-readable verdict from DJ Wavy...",
      "metrics": {
        "sonic_landscape":        { "A": 7.5, "B": 7.0, "notes": "..." },
        "vocal_performance":      { "A": 7.0, "B": 6.5, "notes": "..." },
        "lyricism_storytelling":  { "A": 5.5, "B": 5.0, "notes": "..." },
        "web3_market_readiness":  { "A": 8.0, "B": 7.5, "notes": "..." },
        "production_arrangement": { "A": 7.0, "B": 7.0, "notes": "..." }
      },
      "model": "gemini-2.5-pro",
      "promptVersion": "oracle_v1",
      "schemaVersion": "scorecard_v1"
    }
  }
}
```

**`winner`** is `"A"` or `"B"` — corresponds to `trackA` / `trackB` from the job creation request.  
**`confidence`** is 0–1.  
**`comparison`** is DJ Wavy's written verdict to display to users.  
**`metrics`** has per-category scores (0–10) for each track with notes.

---

## Complete Integration Flow (TypeScript)

```typescript
const BASE_URL = 'https://wavewarz-dj-wavy-api.vercel.app'

async function runBattle(battleId: string, trackAUri: string, trackBUri: string) {
  // 1. Create job
  const createRes = await fetch(`${BASE_URL}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      battleId,
      trackA: { title: 'Track A', artistHandle: 'artist_a', mimeType: 'audio/mpeg', durationSeconds: null },
      trackB: { title: 'Track B', artistHandle: 'artist_b', mimeType: 'audio/mpeg', durationSeconds: null },
    }),
  })
  const { job, uploads } = await createRes.json()

  // 2. Upload both tracks directly to R2 (in parallel)
  await Promise.all([
    fetch(uploads.trackA.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/mpeg' },
      body: await fetch(trackAUri).then(r => r.blob()),
    }),
    fetch(uploads.trackB.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'audio/mpeg' },
      body: await fetch(trackBUri).then(r => r.blob()),
    }),
  ])

  // 3. Trigger processing
  await fetch(`${BASE_URL}/api/jobs/${job.id}/uploads-complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })

  // 4. Poll until done (typically 60–120s)
  let finalJob = job
  while (finalJob.status !== 'succeeded' && finalJob.status !== 'failed') {
    await new Promise(r => setTimeout(r, 10_000))
    const pollRes = await fetch(`${BASE_URL}/api/jobs/${job.id}`)
    finalJob = (await pollRes.json()).job
  }

  if (finalJob.status === 'failed') throw new Error(`Job failed: ${finalJob.error}`)

  // 5. Fetch result
  const resultRes = await fetch(`${BASE_URL}/api/results/${finalJob.resultId}`)
  const { result } = await resultRes.json()
  return result.judgement
}
```

---

## Error Responses

All errors return JSON with an `error` field:

```json
{ "error": "job_not_found" }
```

| HTTP | Error | Meaning |
|---|---|---|
| 400 | `missing_battleId` | battleId not provided |
| 400 | `missing_trackA` / `missing_trackB` | track info missing |
| 404 | `job_not_found` | job ID doesn't exist |
| 404 | `result_not_found` | result ID doesn't exist |
| 500 | `internal_error` | server error (check `detail` field) |

---

## Local Development

```bash
npm install
cp .env.example .env.local   # fill in all env vars
npm run dev                   # starts on http://localhost:3000
```

Required env vars — get values from the team:
- `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`
- `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_BUCKET` + `R2_ENDPOINT`
- `GEMINI_API_KEY`
- `QSTASH_TOKEN` + `QSTASH_CURRENT_SIGNING_KEY` + `QSTASH_NEXT_SIGNING_KEY`
- `PUBLIC_BASE_URL=http://localhost:3000`
- `WORKER_PROCESS_URL` — Cloud Run endpoint (omit to fall back to local `/api/qstash/dj-wavy`)
