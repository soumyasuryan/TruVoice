# TruVoice

[![Python](https://img.shields.io/badge/Python-3.12-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![FastAPI](https://img.shields.io/badge/API-FastAPI-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com/)
[![Expo](https://img.shields.io/badge/Expo-SDK%2054-000020?logo=expo&logoColor=white)](https://docs.expo.dev/versions/v54.0.0/)
[![React Native](https://img.shields.io/badge/React%20Native-0.81-61DAFB?logo=react&logoColor=black)](https://reactnative.dev/)
[![Database](https://img.shields.io/badge/Database-Supabase%20%7C%20pgvector-3FCF8E?logo=supabase&logoColor=white)](https://supabase.com/)
[![Web verification](https://img.shields.io/badge/Web%20verification-TinyFish-343A40)](https://tinyfish.ai/)

TruVoice is a real-time voice-call safety application. It combines local audio
analysis, speech transcription, scam-intent signals, live risk updates, and
evidence-based web verification. A backend-only scam-memory system supports
both on-call verification and scheduled ingestion of public scam advisories.

The main branch contains the in-call memory workflow. The autonomous scheduled
scanner described below is implemented on the `autonomous` branch; its scanner
module, configuration, and third database migration must be taken from that
branch before enabling it.

## Contents

- [Product capabilities](#product-capabilities)
- [System architecture](#system-architecture)
- [Scam memory and TinyFish](#scam-memory-and-tinyfish)
- [Technology stack](#technology-stack)
- [Requirements](#requirements)
- [Setup](#setup)
- [Database setup](#database-setup)
- [Configuration](#configuration)
- [Run the application](#run-the-application)
- [Tests](#tests)
- [Operational notes and limitations](#operational-notes-and-limitations)
- [Repository layout](#repository-layout)

## Product capabilities

- Live audio-call analysis with chunked audio processing and partial/final
  transcript updates.
- Speech-to-text using the configured local faster-whisper model.
- Voice authenticity and scam-intent scoring combined into a unified risk
  signal.
- Live call status and risk delivery over the existing WebSocket and Socket.IO
  integrations.
- Call history, call details, caller/contact flows, and Agora-backed calling.
- Guardian settings and email contacts, with severe alerts gated on consecutive
  severe analysis windows.
- Elderly mode with larger call-screen presentation and spoken severe-risk
  warnings.
- TinyFish-assisted web search and source fetching for uncertain scam claims.
- Verified scam-pattern memory with semantic retrieval when a local embedding
  model is configured, plus lexical fallback.
- A scheduled autonomous memory scanner that searches for new public advisories
  without running on the live call-scoring path.

## System architecture

```text
Expo / React Native application
  ├─ Agora voice calls and local audio chunking
  ├─ REST calls for auth, call lifecycle, and audio analysis
  └─ WebSocket / Socket.IO events for transcript and risk updates
                 │
                 ▼
FastAPI backend
  ├─ Local audio / transcription / scam-intent pipeline
  ├─ Auth, call, community, and guardian APIs
  ├─ In-call memory routing (background side path)
  └─ Autonomous advisory scanner (background scheduled task)
        ├─ TinyFish Search and Fetch
        ├─ Groq structured evidence extraction/judgment
        └─ Sanitized writes to Supabase scam-pattern memory
                 │
                 ▼
Supabase PostgreSQL + pgvector
  ├─ Canonical scam patterns, evidence references, and embeddings
  └─ Scan lease and last-run statistics
```

The ordinary first-score response is produced before the in-call memory side
path is scheduled. The autonomous scanner runs on a dedicated background worker
and is not awaited by audio analysis requests.

## Scam memory and TinyFish

TruVoice has two ingestion paths that write to the same canonical
`scam_pattern_memory` table.

### In-call verification

1. The live analysis route completes its normal scoring and emits the normal
   analysis update.
2. A background workflow examines sanitized transcript text for a bounded set
   of configured claim types, including OTP requests, remote-access app
   instructions, suspicious fee demands, credential requests, bank
   impersonation, and digital-arrest/legal threats.
3. The workflow retrieves a small set of fresh, verified patterns. Strong
   matches are reused; new, weak, stale, or conflicting claims may require
   verification. Repeated claims in the same call are deduplicated.
4. For eligible uncertain claims, TinyFish Search finds candidate pages and
   TinyFish Fetch extracts context from a small number of results. The existing
   structured verdict step judges the evidence.
5. Only a validated `CONTRADICTED` result with sufficient confidence and valid
   HTTPS evidence is persisted. Writes happen asynchronously.

### Autonomous public-advisory ingestion

When enabled, the FastAPI lifespan starts a scanner that runs once at startup
and then at a configurable interval (six hours by default). Each pass:

1. Runs a small, fixed set of public-safety queries through TinyFish Search.
2. Selects HTTPS results whose hostnames match the configured official-domain
   allowlist.
3. Fetches at most three pages using TinyFish Fetch.
4. Uses the configured Groq model to propose structured scam-pattern
   candidates from those pages.
5. Requires each accepted candidate to use a supported scam category, meet the
   confidence threshold, and cite a scam-related quote that appears in the
   fetched page.
6. Passes only the compact pattern and evidence reference to the memory
   service, which scrubs the data and upserts it by canonical key.

The scanner is a bounded advisory ingester, not a general-purpose agent. It
does not crawl arbitrary websites, invent seed records, or watch the entire web.
It requires a continuously running backend process; serverless environments
that suspend FastAPI between requests need an external scheduled invocation.

### Storage, retrieval, and privacy

- Canonical keys deduplicate patterns. Repeated observations update
  `occurrence_count` and `last_seen_at`.
- Patterns include a summary, normalized/search text, scam category, tactics,
  phrases, organizations, risk indicators, confidence, sources, evidence
  references, and verification/freshness metadata.
- Source URLs are stored without query strings or fragments; page contents are
  not persisted as evidence.
- Raw audio, raw call transcripts, OTPs, phone numbers, account numbers, and
  national identity values are not accepted as memory fields. Inputs are
  scrubbed before pattern storage and embedding.
- Embeddings are generated locally only. No external embedding API is used.
- When `MEMORY_EMBEDDING_MODEL_PATH` points to a local 384-dimensional
  Transformers model, retrieval uses pgvector semantic search and lexical
  fallback. Without it, patterns can still be stored and lexical retrieval is
  used.
- Retrieval defaults to verified, active, non-expired patterns with recent
  verification.
- Memory can raise the call risk but does not lower it.

TinyFish integration uses:

- Search: `GET https://api.search.tinyfish.ai?query=...`
- Fetch: `POST https://api.fetch.tinyfish.ai` with a JSON request containing
  URLs and `format: "markdown"`

Both are authenticated using the backend `TINYFISH_API_KEY`. In-call checks
also obey `TINYFISH_ENABLED`, `CLAIM_MAX_PER_CALL`, `CLAIM_MIN_GAP_S`, and
`WEB_EVIDENCE_TIMEOUT_S`.

The autonomous branch includes `Backend/AUTONOMOUS_MEMORY.md` with additional
scanner setup details and SQL inspection queries.

## Technology stack

| Area | Technology |
| --- | --- |
| Mobile application | React Native, Expo SDK 54, JavaScript |
| Navigation and state | React Navigation, Zustand |
| Voice calling | Agora React Native SDK |
| API | FastAPI, Uvicorn, Pydantic |
| Realtime | WebSocket, Socket.IO |
| Database | Supabase PostgreSQL |
| Vector retrieval | pgvector; optional local Transformers embeddings |
| Audio and speech | Local voice model, faster-whisper, librosa |
| Web evidence | TinyFish Search and Fetch |
| Structured evidence judgment | Groq |

## Requirements

- Python 3.12 is the recommended backend runtime.
- Node.js and npm compatible with the installed Expo SDK 54 dependencies.
- A Supabase project and backend service-role key.
- TinyFish API key for live web verification and autonomous scans.
- Groq API key for structured evidence judgment and autonomous extraction.
- Agora project credentials for real Agora calling.
- The configured voice-model checkpoint and sufficient resources for local
  audio inference.
- The spaCy English model `en_core_web_sm` for the memory privacy scrubber.
- Optional: a local Transformers model that returns 384-dimensional
  embeddings for semantic memory retrieval.

## Setup

### Backend

From the repository root, create and activate a virtual environment:

```powershell
cd Backend
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

Copy `Backend/.env.example` to `Backend/.env` and configure the required values
described in [Configuration](#configuration). Keep the service-role key and
provider credentials out of source control.

### Frontend

```powershell
cd Frontend\TruVoice
npm install
```

Copy `Frontend/TruVoice/.env.example` to `Frontend/TruVoice/.env.local` and
set the API/WebSocket URLs and Expo Agora app ID. Because the app uses native
Agora modules, use a compatible development build rather than assuming Expo Go
supports every calling feature.

## Database setup

Run the migrations against the Supabase project configured in the backend,
in this order:

1. `Backend/migrations/001_scam_pattern_memory.sql` — canonical memory table,
   vector/lexical indexes, search functions, and service-role access.
2. `Backend/migrations/002_monotonic_call_risk.sql` — atomic monotonic risk
   persistence for memory-driven risk updates.
3. `Backend/migrations/003_autonomous_memory_scan.sql` from the `autonomous`
   branch — autonomous scan lease and latest-run status/statistics. This
   migration and scanner are not present on `main`.

Creating these tables and functions does not itself populate scam memory. Rows
are added only after an ingestion path finds evidence that passes validation.
The scan-state query is available only on the `autonomous` branch after
migration 003; the pattern query is available after migration 001:

```sql
select last_started_at, last_finished_at, last_status,
       last_queries_completed, last_pages_fetched, last_candidates_found,
       last_candidates_rejected, last_patterns_stored, last_error, next_scan_at
from public.autonomous_memory_scan_state
where id = 1;

select scam_type, verification_status, active, confidence,
       occurrence_count, source_domains, embedding_model, created_at
from public.scam_pattern_memory
order by created_at desc
limit 25;
```

## Configuration

The backend loads `Backend/.env`; the mobile app loads
`Frontend/TruVoice/.env.local`. They are separate environments.

| Variable | Purpose |
| --- | --- |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_KEY` | Backend service-role key; never expose it to the app |
| `SECRET_KEY` | Backend JWT signing secret |
| `GROQ_API_KEY` | Structured web-evidence judgment and autonomous extraction |
| `TINYFISH_API_KEY` | TinyFish Search and Fetch authentication |
| `TINYFISH_ENABLED` | Enables or disables TinyFish verification |
| `OFFICIAL_DOMAINS` | Comma-separated source host allowlist |
| `MEMORY_EMBEDDING_MODEL_PATH` | Optional local 384-dimensional embedding model |
| `AUTONOMOUS_MEMORY_ENABLED` | Enables the scanner; defined on the `autonomous` branch |
| `AUTONOMOUS_MEMORY_INTERVAL_SECONDS` | Scanner interval; `21600` seconds by default on `autonomous` |
| `AUTONOMOUS_MEMORY_TIMEOUT_S` | Extraction timeout; defined on `autonomous` |
| `CLAIM_MAX_PER_CALL` | Maximum in-call checks per call |
| `CLAIM_MIN_GAP_S` | Minimum spacing between in-call checks |
| `WEB_EVIDENCE_TIMEOUT_S` | TinyFish Search/Fetch timeout |
| `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` | Backend Agora token configuration |
| `EXPO_PUBLIC_API_URL` | Backend HTTP base URL for the app |
| `EXPO_PUBLIC_WS_URL` | Backend WebSocket base URL for the app |
| `EXPO_PUBLIC_AGORA_APP_ID` | Agora app ID used by the app |

See [Backend/.env.example](./Backend/.env.example) and
[Frontend/TruVoice/.env.example](./Frontend/TruVoice/.env.example) for the full
configuration templates.

## Run the application

Start the backend from `Backend`:

```powershell
.\.venv\Scripts\Activate.ps1
uvicorn app.main:sio_app --host 0.0.0.0 --port 8000 --reload
```

The API root is `http://localhost:8000/`; interactive API documentation is
available at `http://localhost:8000/docs`.

Start the Expo development server from `Frontend/TruVoice`:

```powershell
npm start
```

Use the relevant Expo development build for Android or iOS when testing Agora
calling. On a physical device, configure the backend URLs to an address
reachable from that device rather than `localhost`.

## Tests

Run frontend tests:

```powershell
cd Frontend\TruVoice
npm test
```

Run backend tests from `Backend`:

```powershell
.\.venv\Scripts\Activate.ps1
python -m unittest discover -s tests -p "test_*.py" -v
```

Focused in-call memory checks:

```powershell
python -m unittest discover -s tests -p "test_scam_memory.py" -v
python -m unittest discover -s tests -p "test_memory_routing_workflow.py" -v
```

The autonomous scanner test is available on the `autonomous` branch:

```powershell
python -m unittest discover -s tests -p "test_autonomous_memory_scanner.py" -v
```

## Operational notes and limitations

- The autonomous scanner is not included on `main`; its settings, migration,
  and worker are on the `autonomous` branch. When using that branch, the
  scanner requires a long-running FastAPI process. The project also includes a
  Mangum handler; serverless deployments should use an external scheduler
  rather than relying on a lifespan task.
- A scan can finish successfully with zero patterns stored. Search results may
  have no allowlisted pages, pages may contain no supported scam categories, or
  candidates may fail quote/confidence checks.
- The system does not guarantee that the first scheduled scan will populate
  memory; check `autonomous_memory_scan_state.last_error` and backend logs.
- Semantic retrieval requires a local model with exactly 384 output
  dimensions. No model is downloaded automatically.
- Scam claim detection and memory category mapping are bounded by the
  categories implemented in the backend.
- Memory-storage privacy constraints do not change any separate,
  pre-existing call-history storage behavior.
- Live TinyFish, Supabase, Agora, and model performance depend on valid
  credentials, deployed migrations, network access, and local hardware.

## Repository layout

```text
Backend/
  app/
    routers/          FastAPI routes for analysis, calls, auth, and guardians
    services/         Audio, web verification, and scam-memory services
  migrations/         Supabase SQL migrations
  tests/              Backend unit and integration tests
Frontend/TruVoice/
  src/                Screens, hooks, state, and services
  tests/              Frontend Node.js tests
```