create extension if not exists pgcrypto;
create extension if not exists vector with schema extensions;

create table if not exists public.scam_pattern_memory (
    id uuid primary key default gen_random_uuid(),
    canonical_key text not null unique,
    summary text not null,
    normalized_text text not null,
    search_text text not null,
    scam_type text not null,
    tactics jsonb not null default '[]'::jsonb,
    phrases jsonb not null default '[]'::jsonb,
    impersonated_orgs jsonb not null default '[]'::jsonb,
    risk_indicators jsonb not null default '[]'::jsonb,
    verification_status text not null default 'candidate'
        check (verification_status in ('candidate', 'verified', 'rejected')),
    confidence real not null default 0.0
        check (confidence >= 0.0 and confidence <= 1.0),
    corroboration_count integer not null default 0
        check (corroboration_count >= 0),
    source_urls jsonb not null default '[]'::jsonb,
    source_domains text[] not null default '{}'::text[],
    evidence_refs jsonb not null default '[]'::jsonb,
    embedding extensions.vector(384),
    embedding_model text not null default 'unconfigured',
    active boolean not null default true,
    occurrence_count integer not null default 1 check (occurrence_count >= 1),
    first_seen_at timestamptz not null default now(),
    last_seen_at timestamptz not null default now(),
    last_verified_at timestamptz,
    expires_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    search_tsv tsvector generated always as (
        to_tsvector('simple', coalesce(search_text, ''))
    ) stored
);

create index if not exists idx_scam_pattern_memory_status_fresh
    on public.scam_pattern_memory (verification_status, active, last_verified_at desc);

create index if not exists idx_scam_pattern_memory_type
    on public.scam_pattern_memory (scam_type);

create index if not exists idx_scam_pattern_memory_search_tsv
    on public.scam_pattern_memory using gin (search_tsv);

create index if not exists idx_scam_pattern_memory_embedding_hnsw
    on public.scam_pattern_memory using hnsw (embedding extensions.vector_cosine_ops)
    where embedding is not null;

create or replace function public.touch_scam_pattern_memory_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = now();
    if tg_op = 'UPDATE' then
        if new.last_seen_at > old.last_seen_at then
            new.occurrence_count = old.occurrence_count + 1;
            new.first_seen_at = least(new.first_seen_at, old.first_seen_at);
        else
            new.occurrence_count = old.occurrence_count;
            new.first_seen_at = old.first_seen_at;
        end if;
    end if;
    return new;
end;
$$;

drop trigger if exists trg_touch_scam_pattern_memory_updated_at
    on public.scam_pattern_memory;

create trigger trg_touch_scam_pattern_memory_updated_at
before update on public.scam_pattern_memory
for each row
execute function public.touch_scam_pattern_memory_updated_at();

create or replace function public.match_scam_pattern_memory(
    query_embedding extensions.vector(384),
    match_threshold double precision default 0.72,
    match_count integer default 5,
    query_embedding_model text default null
)
returns table (
    id uuid,
    canonical_key text,
    summary text,
    normalized_text text,
    scam_type text,
    tactics jsonb,
    phrases jsonb,
    impersonated_orgs jsonb,
    risk_indicators jsonb,
    confidence real,
    corroboration_count integer,
    source_urls jsonb,
    source_domains text[],
    evidence_refs jsonb,
    verification_status text,
    active boolean,
    last_verified_at timestamptz,
    expires_at timestamptz,
    similarity double precision
)
language sql
stable
set search_path = public, extensions
as $$
    select
        m.id,
        m.canonical_key,
        m.summary,
        m.normalized_text,
        m.scam_type,
        m.tactics,
        m.phrases,
        m.impersonated_orgs,
        m.risk_indicators,
        m.confidence,
        m.corroboration_count,
        m.source_urls,
        m.source_domains,
        m.evidence_refs,
        m.verification_status,
        m.active,
        m.last_verified_at,
        m.expires_at,
        (1 - (m.embedding <=> query_embedding))::double precision as similarity
    from public.scam_pattern_memory m
    where m.active = true
      and m.verification_status = 'verified'
      and m.embedding is not null
      and (query_embedding_model is null or m.embedding_model = query_embedding_model)
      and (m.expires_at is null or m.expires_at > now())
      and m.last_verified_at is not null
      and m.last_verified_at > now() - interval '180 days'
      and (1 - (m.embedding <=> query_embedding)) >= match_threshold
    order by m.embedding <=> query_embedding asc
    limit least(greatest(coalesce(match_count, 5), 1), 10);
$$;

create or replace function public.search_scam_pattern_memory_keyword(
    search_query text,
    match_count integer default 5
)
returns table (
    id uuid,
    canonical_key text,
    summary text,
    normalized_text text,
    scam_type text,
    tactics jsonb,
    phrases jsonb,
    impersonated_orgs jsonb,
    risk_indicators jsonb,
    confidence real,
    corroboration_count integer,
    source_urls jsonb,
    source_domains text[],
    evidence_refs jsonb,
    verification_status text,
    active boolean,
    last_verified_at timestamptz,
    expires_at timestamptz,
    keyword_rank real
)
language sql
stable
set search_path = public, extensions
as $$
    with q as (
        select websearch_to_tsquery('simple', left(coalesce(search_query, ''), 500)) as tsq
    )
    select
        m.id,
        m.canonical_key,
        m.summary,
        m.normalized_text,
        m.scam_type,
        m.tactics,
        m.phrases,
        m.impersonated_orgs,
        m.risk_indicators,
        m.confidence,
        m.corroboration_count,
        m.source_urls,
        m.source_domains,
        m.evidence_refs,
        m.verification_status,
        m.active,
        m.last_verified_at,
        m.expires_at,
        ts_rank_cd(m.search_tsv, q.tsq)::real as keyword_rank
    from public.scam_pattern_memory m
    cross join q
    where m.active = true
      and m.verification_status = 'verified'
      and (m.expires_at is null or m.expires_at > now())
      and m.last_verified_at is not null
      and m.last_verified_at > now() - interval '180 days'
      and length(trim(coalesce(search_query, ''))) > 0
      and m.search_tsv @@ q.tsq
    order by ts_rank_cd(m.search_tsv, q.tsq) desc
    limit least(greatest(coalesce(match_count, 5), 1), 10);
$$;

alter table public.scam_pattern_memory enable row level security;
revoke all on table public.scam_pattern_memory from public, anon, authenticated;
grant select, insert, update on table public.scam_pattern_memory to service_role;

revoke all on function public.match_scam_pattern_memory(
    extensions.vector, double precision, integer, text
) from public, anon, authenticated;
grant execute on function public.match_scam_pattern_memory(
    extensions.vector, double precision, integer, text
) to service_role;

revoke all on function public.search_scam_pattern_memory_keyword(text, integer)
    from public, anon, authenticated;
grant execute on function public.search_scam_pattern_memory_keyword(text, integer)
    to service_role;

revoke all on function public.touch_scam_pattern_memory_updated_at()
    from public, anon, authenticated;
