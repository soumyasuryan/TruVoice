create table if not exists public.autonomous_memory_scan_state (
    id smallint primary key check (id = 1),
    next_scan_at timestamptz not null default '-infinity'::timestamptz,
    last_started_at timestamptz,
    last_finished_at timestamptz,
    last_status text,
    last_queries_completed integer not null default 0,
    last_pages_fetched integer not null default 0,
    last_candidates_found integer not null default 0,
    last_candidates_rejected integer not null default 0,
    last_patterns_stored integer not null default 0,
    last_error text
);

insert into public.autonomous_memory_scan_state (id)
values (1)
on conflict (id) do nothing;

alter table public.autonomous_memory_scan_state enable row level security;
revoke all on table public.autonomous_memory_scan_state from public, anon, authenticated;
grant select, insert, update on table public.autonomous_memory_scan_state to service_role;

create or replace function public.claim_autonomous_memory_scan(p_interval_seconds integer)
returns boolean
language sql
security definer
set search_path = public
as $$
    with claimed as (
        update public.autonomous_memory_scan_state
        set next_scan_at = now() + make_interval(secs => greatest(p_interval_seconds, 60)),
            last_started_at = now(),
            last_status = 'running',
            last_queries_completed = 0,
            last_pages_fetched = 0,
            last_candidates_found = 0,
            last_candidates_rejected = 0,
            last_patterns_stored = 0,
            last_error = null
        where id = 1 and next_scan_at <= now()
        returning id
    )
    select exists(select 1 from claimed);
$$;

create or replace function public.record_autonomous_memory_scan(
    p_status text,
    p_queries_completed integer,
    p_pages_fetched integer,
    p_candidates_found integer,
    p_candidates_rejected integer,
    p_patterns_stored integer,
    p_error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
    update public.autonomous_memory_scan_state
    set last_finished_at = now(),
        last_status = left(coalesce(p_status, 'unknown'), 32),
        last_queries_completed = greatest(coalesce(p_queries_completed, 0), 0),
        last_pages_fetched = greatest(coalesce(p_pages_fetched, 0), 0),
        last_candidates_found = greatest(coalesce(p_candidates_found, 0), 0),
        last_candidates_rejected = greatest(coalesce(p_candidates_rejected, 0), 0),
        last_patterns_stored = greatest(coalesce(p_patterns_stored, 0), 0),
        last_error = left(p_error, 500)
    where id = 1;
$$;

revoke all on function public.claim_autonomous_memory_scan(integer)
    from public, anon, authenticated;
grant execute on function public.claim_autonomous_memory_scan(integer)
    to service_role;

revoke all on function public.record_autonomous_memory_scan(
    text, integer, integer, integer, integer, integer, text
)
    from public, anon, authenticated;
grant execute on function public.record_autonomous_memory_scan(
    text, integer, integer, integer, integer, integer, text
)
    to service_role;
