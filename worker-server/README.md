# DJ Wavy Worker — Google Cloud Run

Standalone Node.js HTTP server that processes DJ Wavy jobs.  
Runs FFmpeg natively (no timeout limits), scales to zero when idle.

## Architecture

```
Client
  → Vercel (fast API: /api/jobs, /api/results)
       ↓ QStash publish
  QStash
       ↓ POST /process
  Cloud Run (this service — FFmpeg + Gemini, no timeout)
       ↓ read/write
  Supabase + R2 (unchanged)
```

## Environment Variables

Set all of these in Cloud Run (and also in Vercel):

| Variable | Where | Description |
|---|---|---|
| `WORKER_PROCESS_URL` | **Vercel + Cloud Run** | Full URL of this service's `/process` endpoint, e.g. `https://dj-wavy-worker-xxx-uc.a.run.app/process` |
| `R2_ACCESS_KEY_ID` | Cloud Run | Cloudflare R2 access key |
| `R2_SECRET_ACCESS_KEY` | Cloud Run | Cloudflare R2 secret key |
| `R2_BUCKET` | Cloud Run | R2 bucket name |
| `R2_ENDPOINT` | Cloud Run | R2 endpoint URL |
| `SUPABASE_URL` | Cloud Run | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Cloud Run | Supabase service role key |
| `GEMINI_API_KEY` | Cloud Run | Google Gemini API key |
| `DJ_WAVY_PROVIDER` | Cloud Run | Set to `gemini` |
| `QSTASH_CURRENT_SIGNING_KEY` | Cloud Run | (optional) QStash signing key for webhook verification |
| `QSTASH_NEXT_SIGNING_KEY` | Cloud Run | (optional) QStash next signing key |
| `QSTASH_TOKEN` | Cloud Run | Upstash QStash token (for retry re-enqueue) |
| `WORKER_SOFT_TIMEOUT_MS` | Cloud Run | Set to `240000` (4 min); default is 55000ms |

## One-time Setup

### 1. Create a GCP project and enable APIs
```bash
gcloud auth login
gcloud projects create YOUR_PROJECT_ID --name="DJ Wavy Worker"
gcloud config set project YOUR_PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com
```

### 2. Create an Artifact Registry repository
```bash
gcloud artifacts repositories create dj-wavy \
  --repository-format=docker \
  --location=us-central1
```

### 3. Authenticate Docker
```bash
gcloud auth configure-docker us-central1-docker.pkg.dev
```

## Deploy

**Run all commands from the repo root** (not from worker-server/).

### Build and push the image
```bash
docker build \
  -f worker-server/Dockerfile \
  -t us-central1-docker.pkg.dev/YOUR_PROJECT_ID/dj-wavy/worker:latest \
  .

docker push us-central1-docker.pkg.dev/YOUR_PROJECT_ID/dj-wavy/worker:latest
```

### Deploy to Cloud Run
```bash
gcloud run deploy dj-wavy-worker \
  --image us-central1-docker.pkg.dev/YOUR_PROJECT_ID/dj-wavy/worker:latest \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --timeout 3600 \
  --max-instances 10 \
  --set-env-vars "DJ_WAVY_PROVIDER=gemini,WORKER_SOFT_TIMEOUT_MS=240000,FFMPEG_PATH=ffmpeg,\
R2_ACCESS_KEY_ID=YOUR_VAL,\
R2_SECRET_ACCESS_KEY=YOUR_VAL,\
R2_BUCKET=YOUR_VAL,\
R2_ENDPOINT=YOUR_VAL,\
SUPABASE_URL=YOUR_VAL,\
SUPABASE_SERVICE_ROLE_KEY=YOUR_VAL,\
GEMINI_API_KEY=YOUR_VAL,\
QSTASH_TOKEN=YOUR_VAL,\
QSTASH_CURRENT_SIGNING_KEY=YOUR_VAL,\
QSTASH_NEXT_SIGNING_KEY=YOUR_VAL"
```

### Get the service URL
```bash
gcloud run services describe dj-wavy-worker \
  --region us-central1 \
  --format "value(status.url)"
```

The URL will look like: `https://dj-wavy-worker-xxxxxxxxxx-uc.a.run.app`

### Set WORKER_PROCESS_URL everywhere
```bash
# In Vercel (via dashboard or CLI):
# WORKER_PROCESS_URL = https://dj-wavy-worker-xxxxxxxxxx-uc.a.run.app/process

# In Cloud Run (so retries re-enqueue to itself):
gcloud run services update dj-wavy-worker \
  --region us-central1 \
  --update-env-vars "WORKER_PROCESS_URL=https://dj-wavy-worker-xxxxxxxxxx-uc.a.run.app/process"
```

## Test the worker directly
```bash
WORKER_URL="https://dj-wavy-worker-xxxxxxxxxx-uc.a.run.app"

# Health check
curl "$WORKER_URL/health"

# Process a job (bypassing QStash signature check — only works if signing keys not set)
curl -X POST "$WORKER_URL/process" \
  -H "Content-Type: application/json" \
  -d '{"jobId":"YOUR_JOB_ID"}'
```

## Re-deploy after code changes
```bash
docker build -f worker-server/Dockerfile -t us-central1-docker.pkg.dev/YOUR_PROJECT_ID/dj-wavy/worker:latest .
docker push us-central1-docker.pkg.dev/YOUR_PROJECT_ID/dj-wavy/worker:latest
gcloud run deploy dj-wavy-worker --image us-central1-docker.pkg.dev/YOUR_PROJECT_ID/dj-wavy/worker:latest --region us-central1
```
