create or replace function public.raise_voice_call_risk(
    p_call_id uuid,
    p_risk_level text,
    p_risk_score numeric
)
returns void
language sql
security definer
set search_path = public
as $$
    update public.voice_calls
    set trust_score = least(
            coalesce(trust_score, 100.0),
            greatest(0.0, 100.0 - least(greatest(coalesce(p_risk_score, 0.0), 0.0), 100.0))
        ),
        risk_level = case
            when risk_level is null then upper(p_risk_level)
            when case upper(p_risk_level)
                when 'SAFE' then 0
                when 'MODERATE' then 1
                when 'SEVERE' then 2
                else 0
            end >= case upper(risk_level)
                when 'SAFE' then 0
                when 'MODERATE' then 1
                when 'SEVERE' then 2
                else 3
            end then upper(p_risk_level)
            else risk_level
        end
    where id = p_call_id;
$$;

revoke all on function public.raise_voice_call_risk(uuid, text, numeric)
    from public, anon, authenticated;
grant execute on function public.raise_voice_call_risk(uuid, text, numeric)
    to service_role;
