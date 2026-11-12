-- ============================================================
-- 0225 · O acórdão e o que pode vir depois dele: a reclamação à Seção Cível.
--
-- From the review of 2026-11-11 against the CPC and the TJGO's rules. ONE
-- read a judgment and offered what may follow it (0185), but no acórdão: a
-- turma recursal's decision of an appeal had no fact of its own, no terms
-- and no options, and its words could even be read as a second judgment.
-- In the small-claims court an acórdão takes the embargos de declaração
-- (Lei 9.099/1995, art. 48), the recurso extraordinário (CF, art. 102, III;
-- Súmula 640 do STF), never the recurso especial (Súmula 203 do STJ), and,
-- when it goes against the STJ's consolidated jurisprudence (a súmula, a
-- repetitive appeal, an incident of assumption of competence or of
-- repetitive demands), the reclamação to the court of justice of its state
-- (Resolução STJ nº 3/2016, art. 1º; in the TJGO, its Seções Cíveis:
-- Regimento Interno, art. 16, V), with the CPC's procedure (arts. 988 to
-- 993) and only before the acórdão becomes final (art. 988, § 5º, I): no
-- term of its own. In the civil court an acórdão takes the recurso especial
-- and the extraordinário (`caminhos-v2` of `@flyee/rules/paths`).
--
-- An acórdão is now a fact of its lawsuit (`lawsuit_facts.kind` `acordao`),
-- read by rule from its publication (`acordao-v1` of `@flyee/rules/outcome`:
-- granted, in part, denied or not heard, kept in `appeal_result`) and said
-- for the client by who appealed (`lawsuit_appellant`, `acordao_for_client`):
-- the client's appeal granted, or the airline's denied, is in the client's
-- favour; an acórdão against the client, or one the rule cannot tell for
-- whom, asks the lawyers' awareness. Each acórdão has its options
-- (`judgment_paths.stage`, `judgment_path_options` by kind and stage) and a
-- lawyer decides, as after a judgment (`decide_judgment_path` redefined from
-- 0216); accepting it takes back the terms ONE proposed of it. ONE proposes,
-- where the firm lets it, the embargos (5 days) and the recurso
-- extraordinário (15 days), and in the civil court the recurso especial (15
-- days), from the acórdão's publication (`one_propose_acordao_deadlines`).
-- The client's link keeps asking only about appealing a judgment
-- (`client_link_judgment_paths` redefined from 0185).
-- ============================================================

-- ---------- The acórdão, a fact of its lawsuit ----------

alter table public.lawsuit_facts add column appeal_result text;
alter table public.lawsuit_facts drop constraint lawsuit_facts_kind_check;
alter table public.lawsuit_facts add constraint lawsuit_facts_kind_check check (kind in (
  'sentenca', 'acordao', 'acordo', 'transito', 'recurso', 'deposito', 'alvara', 'arquivamento'
));
alter table public.lawsuit_facts drop constraint lawsuit_facts_result_check;
alter table public.lawsuit_facts add constraint lawsuit_facts_result_check check (
  (case kind when 'sentenca' then result is not null when 'acordao' then true else result is null end)
  and (result is null or result in ('procedente', 'parcial', 'improcedente'))
);
alter table public.lawsuit_facts add constraint lawsuit_facts_appeal_result_check check (
  appeal_result is null or (kind = 'acordao' and appeal_result in ('provido', 'parcial', 'desprovido', 'nao_conhecido'))
);
grant select (appeal_result) on table public.lawsuit_facts to authenticated;

/**
 * Who appealed the judgment of a lawsuit (0225): the client, when the firm decided its appeal, filed a recurso or a
 * movement said the claimant appealed; the airline, when a movement said so; null when both did or nothing says.
 * Internal.
 */
create or replace function public.lawsuit_appellant(target_proceeding uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with said as (
    select
      exists (
        select 1 from public.judgment_paths jp
        join public.lawsuit_facts f on f.id = jp.fact_id and f.corrected_at is null
        where jp.proceeding_id = target_proceeding and jp.decision in ('recurso_inominado', 'apelacao')
      )
      or exists (
        select 1 from public.case_drafts d
        where d.proceeding_id = target_proceeding and d.piece_kind = 'recurso' and d.filed_at is not null
      )
      or exists (
        select 1 from public.lawsuit_facts f
        where f.proceeding_id = target_proceeding and f.kind = 'recurso' and f.appeal_by = 'autor' and f.corrected_at is null
      ) as client,
      exists (
        select 1 from public.lawsuit_facts f
        where f.proceeding_id = target_proceeding and f.kind = 'recurso' and f.appeal_by = 're' and f.corrected_at is null
      ) as airline
  )
  select case when client and not airline then 'autor' when airline and not client then 're' end from said;
$$;

revoke all on function public.lawsuit_appellant(uuid) from public, anon, authenticated;

/** What an acórdão is to the client by who appealed (`acordao-v1`, as `acordaoForClient` reads it). Internal. */
create or replace function public.acordao_for_client(target_result text, target_appellant text)
returns text
language sql
immutable
as $$
  select case
    when target_appellant is null or target_result is null then null
    when target_result = 'parcial' then 'parcial'
    when target_appellant = 'autor' then case when target_result = 'provido' then 'procedente' else 'improcedente' end
    when target_appellant = 're' then case when target_result = 'provido' then 'improcedente' else 'procedente' end
  end;
$$;

revoke all on function public.acordao_for_client(text, text) from public, anon, authenticated;

/**
 * A fact of a lawsuit, written by ONE's rule or by a person (0130, 0193, redefined): an acórdão too (0225), one per
 * publication of it, said for the client by who appealed.
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
  appeal_value text := case when target_fact ->> 'kind' = 'acordao'
                              and target_fact ->> 'appeal_result' in ('provido', 'parcial', 'desprovido', 'nao_conhecido')
                            then target_fact ->> 'appeal_result' end;
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
  -- An acórdão (0225): what it is to the client, by who appealed, when a person did not say it; one fact per
  -- publication of it.
  if kind_value = 'acordao' then
    if target_publication is not null then
      select * into existing from public.lawsuit_facts f
      where f.proceeding_id = lawsuit.id and f.kind = 'acordao' and f.publication_id = target_publication
        and f.corrected_at is null
      limit 1;
      if found then
        return existing.id;
      end if;
    end if;
    if result_value is null and appeal_value is not null then
      result_value := public.acordao_for_client(appeal_value, public.lawsuit_appellant(lawsuit.id));
    end if;
    if result_value is not null and result_value not in ('procedente', 'parcial', 'improcedente') then
      result_value := null;
    end if;
  end if;
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
    confirmed_at, created_by, ack_owed, claims, claims_read_at, appeal_result)
  values (lawsuit.org_id, lawsuit.case_id, lawsuit.id, kind_value,
    case when kind_value in ('sentenca', 'acordao') then result_value end,
    case when kind_value = 'recurso' then nullif(target_fact ->> 'appeal_by', '') end,
    case when kind_value = 'alvara' then coalesce(nullif(target_fact ->> 'release_kind', ''), 'alvara') end,
    cents_value, coalesce((target_fact ->> 'per_claimant')::boolean, false), day_value, words_value,
    target_movement, target_publication,
    case when by_one then 'rule' else 'person' end,
    case when by_one then case when kind_value = 'acordao' then 'acordao-v1' else 'resultado-v1' end end,
    by_one,
    not by_one or mode <> 'approval',
    case when not by_one then target_by end,
    case when not by_one then now() end,
    target_by,
    kind_value in ('transito', 'arquivamento') or (kind_value = 'sentenca' and result_value = 'improcedente')
      -- An acórdão against the client, or one a rule could not tell for whom, is the lawyers' to be aware of.
      or (kind_value = 'acordao' and coalesce(result_value, 'improcedente') = 'improcedente'),
    claims_value,
    case when claims_said then now() end,
    appeal_value)
  returning id into saved;
  perform public.record_case_event(lawsuit.org_id, lawsuit.case_id, 'outcome_recorded',
    case when by_one then 'system' else 'person' end,
    jsonb_build_object('proceeding', lawsuit.id, 'fact', saved, 'kind', kind_value));
  return saved;
end;
$$;

revoke all on function public.lawsuit_fact_write(uuid, jsonb, uuid, uuid, uuid) from public, anon, authenticated;

/** A person records a fact of a lawsuit by hand (0130, redefined): an acórdão too, with what it is to the client (0225). */
create or replace function public.save_lawsuit_fact(target_proceeding uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  refusal text;
  kind_value text := nullif(btrim(coalesce(fields ->> 'kind', '')), '');
  fact uuid;
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  refusal := public.lawsuit_fact_refusal(lawsuit.org_id);
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if lawsuit.status <> 'filed' then
    return jsonb_build_object('ok', false, 'code', 'not_filed');
  end if;
  if kind_value is null
     or kind_value not in ('sentenca', 'acordao', 'acordo', 'transito', 'recurso', 'deposito', 'alvara', 'arquivamento')
     or (kind_value in ('sentenca', 'acordao') and coalesce(fields ->> 'result', '') not in ('procedente', 'parcial', 'improcedente'))
     or (kind_value = 'recurso' and coalesce(fields ->> 'appeal_by', '') not in ('autor', 're')) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'kind');
  end if;
  if coalesce(fields ->> 'happened_on', '') !~ '^\d{4}-\d{2}-\d{2}$'
     or (fields ->> 'happened_on')::date > (now() at time zone 'America/Sao_Paulo')::date then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'happened_on');
  end if;
  if coalesce(fields ->> 'cents', '') <> '' and coalesce(fields ->> 'cents', '') !~ '^[0-9]{1,13}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'cents');
  end if;
  if kind_value in ('sentenca', 'acordo', 'transito', 'arquivamento') and exists (
    select 1 from public.lawsuit_facts f where f.proceeding_id = lawsuit.id and f.kind = kind_value and f.corrected_at is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'fact_exists');
  end if;
  fact := public.lawsuit_fact_write(lawsuit.id, fields, null, null, auth.uid());
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (lawsuit.org_id, auth.uid(), 'outcome.fact_written', 'lawsuit_fact', fact::text, jsonb_build_object('kind', kind_value));
  return jsonb_build_object('ok', true, 'fact_id', fact);
end;
$$;

revoke all on function public.save_lawsuit_fact(uuid, jsonb) from public, anon;
grant execute on function public.save_lawsuit_fact(uuid, jsonb) to authenticated;

-- ---------- What may follow an acórdão ----------

alter table public.judgment_paths add column stage text not null default 'sentenca';
alter table public.judgment_paths add constraint judgment_paths_stage_check check (stage in ('sentenca', 'acordao'));
alter table public.judgment_paths drop constraint judgment_paths_decision_check;
alter table public.judgment_paths add constraint judgment_paths_decision_check check (decision is null or decision in (
  'aceitar', 'embargos_declaracao', 'recurso_inominado', 'apelacao', 'recurso_extraordinario', 'recurso_especial',
  'reclamacao'
));
grant select (stage) on table public.judgment_paths to authenticated;

/** Each judgment and each acórdão in force of a lawsuit has its paths (0185, redefined): its stage beside it (0225). */
create or replace function public.lawsuit_facts_judgment_path()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind in ('sentenca', 'acordao') and new.corrected_at is null then
    insert into public.judgment_paths (org_id, case_id, proceeding_id, fact_id, stage)
    values (new.org_id, new.case_id, new.proceeding_id, new.id, new.kind)
    on conflict (fact_id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.lawsuit_facts_judgment_path() from public, anon, authenticated;

/** The options a lawsuit's kind gives after a judgment or an acórdão (`caminhos-v2`). Internal. */
create or replace function public.judgment_path_options(target_kind text, target_stage text)
returns text[]
language sql
immutable
as $$
  select case
    when target_stage = 'acordao' and target_kind = 'juizado'
      then array['aceitar', 'embargos_declaracao', 'recurso_extraordinario', 'reclamacao']
    when target_stage = 'acordao' then array['aceitar', 'embargos_declaracao', 'recurso_especial', 'recurso_extraordinario']
    else public.judgment_path_options(target_kind)
  end;
$$;

revoke all on function public.judgment_path_options(text, text) from public, anon, authenticated;

/** The acts of what may follow a judgment or an acórdão (0141, redefined): the special appeals too (0225). */
create or replace function public.judgment_deadline_acts()
returns text[]
language sql
immutable
as $$
  select array['embargos_declaracao', 'recurso_inominado', 'apelacao', 'recurso_extraordinario', 'recurso_especial']::text[];
$$;

revoke all on function public.judgment_deadline_acts() from public, anon, authenticated;

/**
 * A partner or a lawyer decides what follows a judgment or an acórdão (0185, 0216, redefined): the options of its
 * stage (0225); accepting either takes back what ONE proposed of it and nobody confirmed.
 */
create or replace function public.decide_judgment_path(target_path uuid, target_decision text, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  path public.judgment_paths%rowtype;
  fact public.lawsuit_facts%rowtype;
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  reason text := nullif(btrim(regexp_replace(coalesce(target_reason, ''), '\s+', ' ', 'g')), '');
  taken record;
begin
  select * into path from public.judgment_paths where id = target_path;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(path.case_id);
  if not public.has_firm_function(current_case.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  select * into lawsuit from public.proceedings where id = path.proceeding_id;
  if target_decision is null or not (target_decision = any (public.judgment_path_options(lawsuit.kind, path.stage))) then
    return jsonb_build_object('ok', false, 'code', 'invalid_decision');
  end if;
  if reason is not null and char_length(reason) not between 8 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason');
  end if;
  select * into fact from public.lawsuit_facts where id = path.fact_id;
  update public.judgment_paths
  set decision = target_decision, decision_reason = reason, decided_by = auth.uid(), decided_at = now()
  where id = path.id;
  if target_decision = 'aceitar' then
    for taken in
      select d.id from public.deadlines d
      where d.proceeding_id = path.proceeding_id and d.act = any (public.judgment_deadline_acts())
        and d.proposed_auto and d.created_by is null
        and (d.status = 'proposed' or (d.status = 'confirmed' and d.confirmed_auto))
        and (
          -- Of the judgment's own publication.
          (fact.publication_id is not null and d.publication_id = fact.publication_id)
          -- Of the judgment given at a hearing, counted from its day (0213).
          or (d.publication_id is null and d.trigger = 'day'
              and d.trigger_on between fact.happened_on - 30 and fact.happened_on + 30)
          -- Of the decision of its embargos, which started the appeal's term again (0213).
          or (d.publication_id is not null and d.act <> 'embargos_declaracao' and exists (
                select 1 from public.publications p
                where p.id = d.publication_id and p.available_on >= fact.happened_on
                  and public.reading_decides_embargos(p.body)))
        )
      for update
    loop
      update public.deadlines
      set status = 'dismissed',
          dismiss_reason = case path.stage when 'acordao' then 'O escritório decidiu aceitar o acórdão.'
                                else 'O escritório decidiu aceitar a sentença.' end,
          dismissed_by = auth.uid(),
          dismissed_at = now()
      where id = taken.id;
      perform public.record_case_event(current_case.org_id, current_case.id, 'deadline_dismissed', 'person',
        jsonb_build_object('deadline', taken.id));
    end loop;
  end if;
  perform public.record_case_event(current_case.org_id, current_case.id, 'judgment_path_decided', 'person',
    jsonb_build_object('proceeding', path.proceeding_id, 'decision', target_decision));
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'judgment_path.decided', 'judgment_path', path.id::text,
          jsonb_build_object('decision', target_decision));
  return jsonb_build_object('ok', true, 'code', 'decided');
end;
$$;

revoke all on function public.decide_judgment_path(uuid, text, text) from public, anon;
grant execute on function public.decide_judgment_path(uuid, text, text) to authenticated;

-- ---------- The terms after an acórdão ----------

/**
 * ONE proposes the terms that follow an acórdão read from its publication (0225), where the firm lets ONE propose the
 * deadlines of its publications: the embargos de declaração (5 days) and the recurso extraordinário (15 days), and in
 * the civil court the recurso especial (15 days), each once per publication. The reclamação has no term of its own:
 * it goes before the acórdão becomes final. Internal: how many.
 */
create or replace function public.one_propose_acordao_deadlines(target_fact uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  fact public.lawsuit_facts%rowtype;
  lawsuit public.proceedings%rowtype;
  act text;
  made integer := 0;
begin
  select * into fact from public.lawsuit_facts where id = target_fact;
  if not found or fact.kind <> 'acordao' or fact.publication_id is null or fact.corrected_at is not null then
    return 0;
  end if;
  if public.firm_autonomy_mode(fact.org_id, 'publication_deadline') is distinct from 'auto' then
    return 0;
  end if;
  select * into lawsuit from public.proceedings where id = fact.proceeding_id;
  foreach act in array case when lawsuit.kind = 'comum'
                            then array['embargos_declaracao', 'recurso_especial', 'recurso_extraordinario']
                            else array['embargos_declaracao', 'recurso_extraordinario'] end loop
    if public.one_propose_term(lawsuit.id, fact.publication_id, act, null, 'acordao') is not null then
      made := made + 1;
    end if;
  end loop;
  return made;
end;
$$;

revoke all on function public.one_propose_acordao_deadlines(uuid) from public, anon, authenticated;

create or replace function public.lawsuit_facts_acordao_deadlines()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.one_propose_acordao_deadlines(new.id);
  return null;
end;
$$;

revoke all on function public.lawsuit_facts_acordao_deadlines() from public, anon, authenticated;

create trigger lawsuit_facts_acordao_deadlines after insert on public.lawsuit_facts
  for each row when (new.kind = 'acordao' and new.publication_id is not null)
  execute function public.lawsuit_facts_acordao_deadlines();

-- ---------- The client's link ----------

/** What the client's link shows of each judgment of their lawsuits (0185, redefined): never an acórdão (0225). */
create or replace function public.client_link_judgment_paths(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  return jsonb_build_object('ok', true, 'items', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', jp.id, 'kind', p.kind, 'result', f.result, 'cents', f.cents, 'on', f.happened_on,
      'free_justice', exists (
        select 1 from public.proceeding_parties pp
        where pp.proceeding_id = p.id and coalesce((public.free_justice_answer_in_force(pp.party_id)).asks, false)
      ),
      'agrees', jp.client_agrees, 'answered_at', jp.client_answered_at, 'decision', jp.decision
    ) order by f.happened_on desc)
    from public.judgment_paths jp
    join public.lawsuit_facts f on f.id = jp.fact_id and f.corrected_at is null
    join public.proceedings p on p.id = jp.proceeding_id
    -- The client is asked about the costs of appealing a judgment; what follows an acórdão is the lawyers' (0225).
    where jp.case_id = link.case_id and jp.stage = 'sentenca'
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.client_link_judgment_paths(text) from public, anon, authenticated;
grant execute on function public.client_link_judgment_paths(text) to anon, authenticated, service_role;
