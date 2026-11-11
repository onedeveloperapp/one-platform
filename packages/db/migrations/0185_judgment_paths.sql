-- ============================================================
-- The judgment: its options, the appeal and its costs (0185), item 4.5 of
-- the case journey plan. After a judgment of a lawsuit, ONE says what may
-- follow (`caminhos-v1` of `@flyee/rules/paths`: accept it, the embargos de
-- declaração, the recurso inominado in the small-claims court or the
-- apelação in the civil court) and what an appeal costs the client (the
-- preparo, the other side's fees if it loses; free justice exempts the one
-- and suspends the other), recommends one by comparing what was asked with
-- what was granted, and asks the client, on their link, to say they know the
-- costs and agree. The lawyer decides with the recommendation
-- (`decide_judgment_path`: a partner or a lawyer, with the second factor,
-- never a support visit, on the record), and the deadlines ONE proposed from
-- the judgment follow the decision: accepting it takes back what ONE proposed
-- and nobody confirmed (0141).
-- ============================================================

create table public.judgment_paths (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  proceeding_id uuid not null references public.proceedings (id) on delete cascade,
  fact_id uuid not null unique references public.lawsuit_facts (id) on delete cascade,
  rule text not null default 'caminhos-v1',
  -- The client said they know what an appeal costs and agree with it, or not; on their link or through the firm.
  client_agrees boolean,
  client_answered_at timestamptz,
  client_via text,
  decision text,
  decision_reason text,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  constraint judgment_paths_decision_check check (decision is null or decision in (
    'aceitar', 'embargos_declaracao', 'recurso_inominado', 'apelacao'
  )),
  constraint judgment_paths_via_check check (client_via is null or client_via in ('link', 'telefone', 'whatsapp', 'presencial', 'email')),
  constraint judgment_paths_reason_check check (decision_reason is null or char_length(decision_reason) between 8 and 500)
);

create index judgment_paths_case_idx on public.judgment_paths (case_id);

alter table public.judgment_paths enable row level security;
create policy "judgment_paths_select_member" on public.judgment_paths
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.judgment_paths to authenticated;
create trigger guard_impersonation_judgment_paths after insert or update or delete on public.judgment_paths
  for each statement execute function public.guard_impersonation_readonly();

/** Each judgment in force of a lawsuit has its paths (0185): made with the fact, kept as the fact is corrected. */
create or replace function public.lawsuit_facts_judgment_path()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'sentenca' and new.corrected_at is null then
    insert into public.judgment_paths (org_id, case_id, proceeding_id, fact_id)
    values (new.org_id, new.case_id, new.proceeding_id, new.id)
    on conflict (fact_id) do nothing;
  end if;
  return null;
end;
$$;

revoke all on function public.lawsuit_facts_judgment_path() from public, anon, authenticated;

create trigger lawsuit_facts_judgment_path after insert on public.lawsuit_facts
  for each row execute function public.lawsuit_facts_judgment_path();

insert into public.judgment_paths (org_id, case_id, proceeding_id, fact_id)
select f.org_id, f.case_id, f.proceeding_id, f.id from public.lawsuit_facts f
where f.kind = 'sentenca' and f.corrected_at is null
on conflict (fact_id) do nothing;

/** The options a lawsuit's kind gives after its judgment (`caminhos-v1`). Internal. */
create or replace function public.judgment_path_options(target_kind text)
returns text[]
language sql
immutable
as $$
  select case target_kind
    when 'juizado' then array['aceitar', 'embargos_declaracao', 'recurso_inominado']
    else array['aceitar', 'embargos_declaracao', 'apelacao']
  end;
$$;

revoke all on function public.judgment_path_options(text) from public, anon, authenticated;

/**
 * A partner or a lawyer decides what follows a judgment, with the second factor (0185): accepting it takes back the
 * deadlines of the embargos and of the appeal ONE proposed from it and nobody confirmed; an appeal keeps them. Never a
 * support visit; on the record and in the case's timeline.
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
  if target_decision is null or not (target_decision = any (public.judgment_path_options(lawsuit.kind))) then
    return jsonb_build_object('ok', false, 'code', 'invalid_decision');
  end if;
  if reason is not null and char_length(reason) not between 8 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason');
  end if;
  select * into fact from public.lawsuit_facts where id = path.fact_id;
  update public.judgment_paths
  set decision = target_decision, decision_reason = reason, decided_by = auth.uid(), decided_at = now()
  where id = path.id;
  if target_decision = 'aceitar' and fact.publication_id is not null then
    for taken in
      select d.id from public.deadlines d
      where d.publication_id = fact.publication_id and d.act = any (public.judgment_deadline_acts())
        and d.proposed_auto and d.created_by is null
        and (d.status = 'proposed' or (d.status = 'confirmed' and d.confirmed_auto))
      for update
    loop
      update public.deadlines
      set status = 'dismissed', dismiss_reason = 'O escritório decidiu aceitar a sentença.', dismissed_by = auth.uid(),
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

/** A person of the firm records the client's word on what an appeal costs, as the client told it. Never a support visit. */
create or replace function public.record_judgment_path_answer(target_path uuid, target_agrees boolean, target_how text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  path public.judgment_paths%rowtype;
  current_case public.cases%rowtype;
begin
  select * into path from public.judgment_paths where id = target_path;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(path.case_id);
  if target_how is null or target_how not in ('telefone', 'whatsapp', 'presencial', 'email') then
    return jsonb_build_object('ok', false, 'code', 'invalid_how');
  end if;
  update public.judgment_paths
  set client_agrees = coalesce(target_agrees, false), client_answered_at = now(), client_via = target_how
  where id = path.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'judgment_path_answered', 'person',
    jsonb_build_object('proceeding', path.proceeding_id, 'agrees', coalesce(target_agrees, false)));
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.record_judgment_path_answer(uuid, boolean, text) from public, anon;
grant execute on function public.record_judgment_path_answer(uuid, boolean, text) to authenticated;

/**
 * What the client's link shows of each judgment of their lawsuits (0185): the result, the value, the kind of
 * lawsuit, whether they have free justice, their word and the lawyer's decision. Backend's read, by the link.
 */
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
    where jp.case_id = link.case_id
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.client_link_judgment_paths(text) from public, anon, authenticated;
grant execute on function public.client_link_judgment_paths(text) to anon, authenticated, service_role;

/** The client says on their link that they know what an appeal costs and agree with it, or not. Backend, by the link. */
create or replace function public.client_link_answer_judgment_path(target_token text, target_path uuid, target_agrees boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  path public.judgment_paths%rowtype;
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_found');
  end if;
  select * into path from public.judgment_paths where id = target_path and case_id = link.case_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if path.decision is not null then
    return jsonb_build_object('ok', false, 'code', 'decided');
  end if;
  update public.judgment_paths
  set client_agrees = coalesce(target_agrees, false), client_answered_at = now(), client_via = 'link'
  where id = path.id;
  perform public.record_case_event(link.org_id, link.case_id, 'judgment_path_answered', 'client',
    jsonb_build_object('proceeding', path.proceeding_id, 'agrees', coalesce(target_agrees, false)));
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.client_link_answer_judgment_path(text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.client_link_answer_judgment_path(text, uuid, boolean) to service_role;
