# Autonomous scam-memory ingestion

The app lifespan starts a bounded backend scanner when
`AUTONOMOUS_MEMORY_ENABLED=true`. It makes an initial scan and then repeats at
`AUTONOMOUS_MEMORY_INTERVAL_SECONDS` (default: six hours). The scanner runs in
its own background task and dedicated worker thread, not the live call scoring
request or its default executor.

Each scan uses TinyFish Search on a small set of fixed public-safety queries,
keeps results only when their HTTPS hostname is within `OFFICIAL_DOMAINS`, and
fetches at most three pages. It then asks the configured Groq judge to extract
structured patterns from those pages. Candidates must use a supported scam
category, include a verbatim evidence quote found in the fetched page, have
confidence of at least 0.80, and cite an allowlisted official page. The scanner
passes only the compact pattern and source reference to the existing memory
service. That service scrubs text and upserts by canonical key into
`scam_pattern_memory`; repeated patterns increment their occurrence count.
No call transcript is used by this scanner.

Apply migrations `001_scam_pattern_memory.sql`, `002_monotonic_call_risk.sql`,
and `003_autonomous_memory_scan.sql` to the Supabase project configured for the
backend. The backend environment needs its Supabase service-role credentials,
`TINYFISH_ENABLED=true`, `TINYFISH_API_KEY`, `GROQ_API_KEY`, and optionally a
local 384-dimensional model in `MEMORY_EMBEDDING_MODEL_PATH`. Without the local
embedding model, patterns are still stored and can be searched lexically. The
local Presidio/spaCy model (`en_core_web_sm`) is required by memory scrubbing
before any pattern write.

The scan lease in migration 003 prevents multiple backend workers connected to
the same database from launching duplicate scheduled scans. The scanner reads
official domains from `OFFICIAL_DOMAINS` and does not ingest arbitrary search
results. If there is no qualifying public evidence or a required service is
unavailable, a scan can complete with zero new rows; it never inserts synthetic
seed data just to make the table non-empty.

Check the latest scan outcome:

```sql
select last_started_at, last_finished_at, last_status,
       last_queries_completed, last_pages_fetched, last_candidates_found,
       last_candidates_rejected, last_patterns_stored, last_error, next_scan_at
from public.autonomous_memory_scan_state
where id = 1;
```

Check stored patterns:

```sql
select scam_type, verification_status, active, confidence,
       occurrence_count, source_domains, embedding_model, created_at
from public.scam_pattern_memory
order by created_at desc
limit 25;
```

This scheduler requires a continuously running FastAPI process. Serverless
deployments that suspend the process after each request should schedule an
external invocation of the same scanner entry point instead of relying on the
lifespan task.
