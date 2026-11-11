-- ============================================================
-- The result of each claim of a lawsuit.
--
-- A judgment was read as a whole (0130, `resultado-v1`): granted, in part or
-- denied, and the value beside the condemnation. Now it also keeps what its
-- operative part decided of each claim it names (`lawsuit_facts.claims`, the
-- rule `pedidos-v1`): moral damages, material damages, lost profits and the
-- refund of the ticket, each granted with the value set beside it (each
-- claimant's when the words say so) or denied. The app's rule reads it from
-- the judgment's publication and hands it with the reading; the database keeps
-- only what has the shape of a claim (`lawsuit_claims_clean`), and the words
-- of the judgment's own publication take the place of what was read before. A
-- person records it with a judgment (`save_lawsuit_fact` passes it through).
-- The judgments read before are read again from the words kept on them, once
-- (`claims_read_at`, `record_fact_claims`, the backend's). The firm's numbers
-- carry each judgment's claims (`firm_lawsuit_numbers`, redefined from 0168).
-- ============================================================

alter table public.lawsuit_facts add column claims jsonb;
alter table public.lawsuit_facts add column claims_read_at timestamptz;
alter table public.lawsuit_facts add constraint lawsuit_facts_claims_check check (
  claims is null or (kind = 'sentenca' and jsonb_typeof(claims) = 'array')
);

create index lawsuit_facts_claims_due_idx on public.lawsuit_facts (created_at)
  where kind = 'sentenca' and claims_read_at is null and corrected_at is null;

/**
 * The claims of a judgment as the database keeps them (internal): each of the known kinds once, in the order given,
 * granted (with its value, each claimant's or not) or denied; null when nothing has that shape.
 */
create or replace function public.lawsuit_claims_clean(target jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select case when jsonb_typeof(target) = 'array' then (
    select jsonb_agg(x.item order by x.ord)
    from (
      select distinct on (e.value ->> 'claim') e.ordinality as ord,
        jsonb_build_object(
          'claim', e.value ->> 'claim',
          'result', e.value ->> 'result',
          'cents', case when e.value ->> 'result' = 'concedido' and coalesce(e.value ->> 'cents', '') ~ '^[0-9]{1,13}$'
                         and (e.value ->> 'cents')::bigint > 0 then (e.value ->> 'cents')::bigint end,
          'per_claimant', e.value ->> 'result' = 'concedido' and coalesce(e.value ->> 'cents', '') ~ '^[0-9]{1,13}$'
                          and (e.value ->> 'per_claimant') = 'true'
        ) as item
      from jsonb_array_elements(target) with ordinality e
      where jsonb_typeof(e.value) = 'object'
        and e.value ->> 'claim' in ('danos_morais', 'danos_materiais', 'lucros_cessantes', 'restituicao')
        and e.value ->> 'result' in ('concedido', 'negado')
      order by e.value ->> 'claim', e.ordinality
    ) x
  ) end;
$$;

revoke all on function public.lawsuit_claims_clean(jsonb) from public, anon, authenticated;

/**
 * Records a fact of a lawsuit (internal, 0130): from ONE's reading, marked as ONE's and waiting for a person's
 * confirmation where the firm keeps the result to a person; or from a person. A judgment, a settlement, its becoming
 * final and the archiving are one in force per lawsuit: a second reading of one completes the first (its words, its
 * value, the result of each claim) and records nothing new. A judgment keeps what it decided of each claim (0193). The
 * lawyers are asked to be aware of what changes the course. The timeline says the kind only.
 */
create or replace function public.lawsuit_fact_write(
  target_proceeding uuid,
  target_fact jsonb,
  target_movement uuid,
  target_publication uuid,
  target_by uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  kind_value text := target_fact ->> 'kind';
  result_value text := nullif(target_fact ->> 'result', '');
  cents_value bigint;
  day_value date;
  words_value text := nullif(left(btrim(regexp_replace(coalesce(target_fact ->> 'words', ''), '\s+', ' ', 'g')), 600), '');
  claims_value jsonb := case when target_fact ->> 'kind' = 'sentenca' then public.lawsuit_claims_clean(target_fact -> 'claims') end;
  claims_said boolean := target_fact ->> 'kind' = 'sentenca' and (target_fact ? 'claims' or target_by is not null);
  existing public.lawsuit_facts%rowtype;
  by_one boolean := target_by is null;
  mode text;
  saved uuid;
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return null;
  end if;
  if coalesce(target_fact ->> 'cents', '') ~ '^[0-9]{1,13}$' and (target_fact ->> 'cents')::bigint > 0 then
    cents_value := (target_fact ->> 'cents')::bigint;
  end if;
  begin
    day_value := coalesce(nullif(target_fact ->> 'happened_on', '')::date, (now() at time zone 'America/Sao_Paulo')::date);
  exception when others then
    day_value := (now() at time zone 'America/Sao_Paulo')::date;
  end;
  if kind_value in ('sentenca', 'acordo', 'transito', 'arquivamento') then
    select * into existing from public.lawsuit_facts f
    where f.proceeding_id = lawsuit.id and f.kind = kind_value and f.corrected_at is null
    order by f.created_at limit 1
    for update;
    if found then
      update public.lawsuit_facts
      -- The words of a publication (the judgment itself) take the place of a movement's title.
      set words = case when target_publication is not null then coalesce(words_value, existing.words)
                       else coalesce(existing.words, words_value) end,
          cents = coalesce(existing.cents, cents_value),
          per_claimant = existing.per_claimant or coalesce((target_fact ->> 'per_claimant')::boolean, false),
          publication_id = coalesce(existing.publication_id, target_publication),
          claims = case when target_publication is not null and claims_value is not null then claims_value
                        else coalesce(existing.claims, claims_value) end,
          claims_read_at = case when claims_said and existing.claims_read_at is null then now()
                                else existing.claims_read_at end
      where id = existing.id;
      return existing.id;
    end if;
  end if;
  mode := public.firm_autonomy_mode(lawsuit.org_id, 'record_outcome');
  insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, result, appeal_by, release_kind, cents,
    per_claimant, happened_on, words, movement_id, publication_id, source, rule, by_one, confirmed, confirmed_by,
    confirmed_at, created_by, ack_owed, claims, claims_read_at)
  values (lawsuit.org_id, lawsuit.case_id, lawsuit.id, kind_value,
    case when kind_value = 'sentenca' then result_value end,
    case when kind_value = 'recurso' then nullif(target_fact ->> 'appeal_by', '') end,
    case when kind_value = 'alvara' then coalesce(nullif(target_fact ->> 'release_kind', ''), 'alvara') end,
    cents_value, coalesce((target_fact ->> 'per_claimant')::boolean, false), day_value, words_value,
    target_movement, target_publication,
    case when by_one then 'rule' else 'person' end,
    case when by_one then 'resultado-v1' end,
    by_one,
    not by_one or mode <> 'approval',
    case when not by_one then target_by end,
    case when not by_one then now() end,
    target_by,
    kind_value in ('transito', 'arquivamento') or (kind_value = 'sentenca' and result_value = 'improcedente'),
    claims_value,
    case when claims_said then now() end)
  returning id into saved;
  perform public.record_case_event(lawsuit.org_id, lawsuit.case_id, 'outcome_recorded',
    case when by_one then 'system' else 'person' end,
    jsonb_build_object('proceeding', lawsuit.id, 'fact', saved, 'kind', kind_value));
  return saved;
end;
$$;

revoke all on function public.lawsuit_fact_write(uuid, jsonb, uuid, uuid, uuid) from public, anon, authenticated;

/**
 * What the rule read of the claims of a judgment read before (the backend's, once per fact): from the words kept on
 * it; a judgment whose words name no claim is marked read all the same.
 */
create or replace function public.record_fact_claims(target_fact uuid, target_claims jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  update public.lawsuit_facts
  set claims = coalesce(claims, public.lawsuit_claims_clean(target_claims)), claims_read_at = now()
  where id = target_fact and kind = 'sentenca' and claims_read_at is null;
  return jsonb_build_object('ok', true, 'code', case when found then 'recorded' else 'read_before' end);
end;
$$;

revoke all on function public.record_fact_claims(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_fact_claims(uuid, jsonb) to service_role;

-- ---------- The firm's numbers carry each judgment's claims ----------
/** One set behind every number of the firm (0136): each lawsuit the firm filed, with its unit (0168) and its claims (0193). */
create or replace function public.firm_lawsuit_numbers(target_org uuid, target_tests boolean default false, target_module text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.reads_firm_numbers(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  return jsonb_build_object('ok', true, 'rows', coalesce((
    select jsonb_agg(row_data order by row_data ->> 'filed_on' desc, row_data ->> 'id')
    from (
      select jsonb_build_object(
        'id', p.id, 'case_id', c.id, 'case_seq', c.seq, 'cnj', p.cnj, 'airline', c.airline_iata, 'incident', c.incident,
        'court', p.court, 'comarca', nullif(btrim(coalesce(p.comarca, '')), ''),
        'unit', nullif(btrim(coalesce(p.unit, '')), ''), 'kind', p.kind, 'module', c.module,
        'is_test', c.is_test,
        'filed_on', p.filed_at, 'opened_on', (c.created_at at time zone 'America/Sao_Paulo')::date,
        'result', j.result, 'judged_on', j.happened_on, 'judged_checked', j.checked, 'value_cents', j.per_claimant_cents,
        'claims', j.claims,
        'settled', s.id is not null, 'settled_cents', s.cents,
        'final', exists (select 1 from public.lawsuit_facts f where f.proceeding_id = p.id and f.kind = 'transito' and f.corrected_at is null),
        'paid_on', (select min(f.received_on) from public.lawsuit_facts f
                    where f.proceeding_id = p.id and f.kind = 'alvara' and f.received_on is not null and f.corrected_at is null),
        'closed', c.status in ('closed', 'declined'),
        'claimants', (select count(*) from public.proceeding_parties pp where pp.proceeding_id = p.id),
        'unchecked', (select count(*) from public.lawsuit_facts f where f.proceeding_id = p.id and f.corrected_at is null
                      and f.by_one and f.confirmed_by is null and f.source <> 'person')
      ) as row_data
      from public.proceedings p
      join public.cases c on c.id = p.case_id
      left join lateral (
        select f.result, f.happened_on, (f.source = 'person' or f.confirmed_by is not null) as checked, f.claims,
          case when f.cents is null then null
               when f.per_claimant then f.cents
               else f.cents / greatest((select count(*) from public.proceeding_parties pp where pp.proceeding_id = p.id), 1) end
            as per_claimant_cents
        from public.lawsuit_facts f
        where f.proceeding_id = p.id and f.kind = 'sentenca' and f.corrected_at is null
        order by f.happened_on desc, f.created_at desc limit 1
      ) j on true
      left join lateral (
        select f.id, f.cents from public.lawsuit_facts f
        where f.proceeding_id = p.id and f.kind = 'acordo' and f.corrected_at is null
        order by f.happened_on desc limit 1
      ) s on true
      where p.org_id = target_org and p.filed_at is not null and p.status in ('filed', 'closed')
        and (coalesce(target_tests, false) or not c.is_test)
        and (target_module is null or c.module = target_module)
      order by p.filed_at desc
      limit 5000
    ) rows
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.firm_lawsuit_numbers(uuid, boolean, text) from public, anon;
grant execute on function public.firm_lawsuit_numbers(uuid, boolean, text) to authenticated;
