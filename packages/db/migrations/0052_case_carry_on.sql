-- 0052_case_carry_on: two things a case of the test of 2026-10-26 stopped on, which ONE now carries on by itself
-- where the firm said how.
--
-- What each claimant asks (0025) is the firm's to say. A firm now says it once per kind of problem
-- (`firm_claim_defaults`): when a claimant of a case has no claim, ONE writes the firm's default for the case's
-- kind of problem as that claimant's claim (`advance_claim_defaults`, as ONE, `claim_defaulted` in the timeline),
-- and stops on `claims_missing` only where the firm has none. A claim somebody wrote is never changed. Set by a
-- partner with the second factor, never in a support visit, on the record; a default set wakes the firm's cases
-- that waited for a claim.
--
-- Who signs what ONE prepares (0039) was a signer registered at the bar in the lawsuit's state. A lawyer may also
-- act in a state where they hold no registration, as long as it is not habitual there: more than five causes a
-- year is habitual (Lei 8.906/1994, art. 10, § 2º), which asks for a supplementary registration. So where none of
-- the firm's signers is registered in the state, ONE names the first of them who may still take one more cause
-- there this year (`firm_signers_in`), counting the lawsuits the firm has of that lawyer in that state as
-- `firm_causes_by_state` counts them and what the same plan already gave them, and tells the timeline it named
-- somebody of another state (`signer_occasional`). The causes of other firms are not seen.

-- ---------- What each claimant asks, by default ----------

/** The claim a firm asks, by default, for each claimant of a case of a kind of problem. */
create table public.firm_claim_defaults (
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The kinds of `cases.incident` (0022).
  incident text not null,
  -- As `case_parties.claim_cents` (0025).
  cents bigint not null,
  changed_by uuid references public.profiles (id) on delete set null,
  changed_at timestamptz not null default now(),
  primary key (org_id, incident),
  constraint firm_claim_defaults_incident_check check (incident in (
    'delay', 'cancellation', 'overbooking', 'missed_connection', 'downgrade',
    'baggage_lost', 'baggage_damaged', 'baggage_delayed', 'other'
  )),
  constraint firm_claim_defaults_cents_check check (cents between 1 and 100000000000)
);

alter table public.firm_claim_defaults enable row level security;
create policy "firm_claim_defaults_select_member" on public.firm_claim_defaults
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.firm_claim_defaults to authenticated;
create trigger guard_impersonation_firm_claim_defaults after insert or update or delete on public.firm_claim_defaults
  for each statement execute function public.guard_impersonation_readonly();

/**
 * A partner says the claim the firm asks, by default, for a kind of problem,
 * or takes it off (a null amount). With the second factor, never a support
 * visit, on the record.
 */
create or replace function public.set_firm_claim_default(target_org uuid, target_incident text, target_cents bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  before bigint;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.has_firm_function(target_org, array['socio']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_a_partner');
  end if;
  if target_incident is null or target_incident not in (
    'delay', 'cancellation', 'overbooking', 'missed_connection', 'downgrade',
    'baggage_lost', 'baggage_damaged', 'baggage_delayed', 'other'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_incident');
  end if;
  if target_cents is not null and target_cents not between 1 and 100000000000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_amount');
  end if;
  perform public.require_aal2();
  select d.cents into before from public.firm_claim_defaults d
  where d.org_id = target_org and d.incident = target_incident;
  if before is not distinct from target_cents then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if target_cents is null then
    delete from public.firm_claim_defaults where org_id = target_org and incident = target_incident;
  else
    insert into public.firm_claim_defaults as d (org_id, incident, cents, changed_by)
    values (target_org, target_incident, target_cents, auth.uid())
    on conflict (org_id, incident) do update set
      cents = excluded.cents, changed_by = excluded.changed_by, changed_at = now();
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'firm.claim_default_set', 'claim_default', target_incident,
    jsonb_strip_nulls(jsonb_build_object('from', before, 'to', target_cents)));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_firm_claim_default(uuid, text, bigint) from public, anon;
grant execute on function public.set_firm_claim_default(uuid, text, bigint) to authenticated;

/** A default set may be what the firm's cases that wait for a claim waited for. */
create or replace function public.firm_claim_defaults_wake_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.case_advances a
  set after = null, woken_at = clock_timestamp()
  where a.case_id in (
    select b.case_id from public.case_advances b
    where b.org_id = new.org_id and b.waiting = 'claims_missing' and b.after is distinct from 'infinity'::timestamptz
    order by b.case_id
    for update
  );
  return null;
end;
$$;

revoke all on function public.firm_claim_defaults_wake_advance() from public, anon, authenticated;

create trigger firm_claim_defaults_wake_advance after insert or update on public.firm_claim_defaults
  for each row execute function public.firm_claim_defaults_wake_advance();

/**
 * ONE writes the firm's default claim for the case's kind of problem as the
 * claim of each claimant of the case nobody set a claim for, under the
 * case's own lock and as ONE (`claim_defaulted` in the timeline). A claim
 * somebody wrote is never changed, and nothing is written where the firm has
 * no default for that kind. For the worker that holds the claim; service role
 * only.
 */
create or replace function public.advance_claim_defaults(target_case uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  amount bigint;
  filled uuid[];
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform set_config('one.system_case', target_case::text, true);
  current_case := public.case_for_writer(target_case);
  if not public.case_advance_held(target_case, target_claim) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select d.cents into amount from public.firm_claim_defaults d
  where d.org_id = current_case.org_id and d.incident = current_case.incident;
  if amount is null then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', true, 'code', 'no_default', 'applied', 0);
  end if;
  with written as (
    update public.case_parties cp set claim_cents = amount
    where cp.case_id = target_case and cp.role = 'claimant' and cp.claim_cents is null
    returning cp.id
  )
  select coalesce(array_agg(w.id order by w.id), '{}'::uuid[]) into filled from written w;
  if cardinality(filled) > 0 then
    perform public.record_case_event(current_case.org_id, target_case, 'claim_defaulted', 'system',
      jsonb_build_object('parties', to_jsonb(filled), 'count', cardinality(filled), 'incident', current_case.incident));
  end if;
  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', true, 'code', 'applied', 'applied', cardinality(filled), 'cents', amount);
end;
$$;

revoke all on function public.advance_claim_defaults(uuid, integer) from public, anon, authenticated;

-- ---------- Who signs, in a state where nobody of the firm is registered ----------

/**
 * How many causes a year a lawyer may take in a state where they hold no
 * registration at the bar: more than five is habitual practice there (Lei
 * 8.906/1994, art. 10, § 2º), which asks for a supplementary registration.
 * The same number as `OCCASIONAL_CAUSES_PER_YEAR` of
 * `@flyee/rules/state-count`, kept together by a test.
 */
create or replace function public.occasional_causes_per_year()
returns integer
language sql
immutable
set search_path = public
as $$
  select 5;
$$;

revoke all on function public.occasional_causes_per_year() from public, anon;
grant execute on function public.occasional_causes_per_year() to authenticated;

/**
 * The causes a lawyer has for the firm in a state in a year, as
 * `firm_causes_by_state` (0025) counts them: the lawsuits filed that year (by
 * the day they were filed or, with none written, the year in their number)
 * and the ones planned in a case that still goes ahead, which will be. The
 * causes the lawyer has in other firms are not seen. Service role.
 */
create or replace function public.lawyer_state_causes(target_org uuid, target_user uuid, target_uf text, target_year integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.proceedings p
  join public.cases k on k.id = p.case_id
  join public.proceeding_lawyers pl on pl.proceeding_id = p.id and pl.user_id = target_user
  join public.courts c on c.acronym = p.court
  where p.org_id = target_org and c.uf = target_uf
    and (
      (p.status in ('filed', 'closed')
        and coalesce(extract(year from p.filed_at)::integer, substr(p.cnj, 10, 4)::integer) = target_year)
      or (p.status = 'planned' and k.status not in ('closed', 'declined'))
    );
$$;

revoke all on function public.lawyer_state_causes(uuid, uuid, text, integer) from public, anon, authenticated;

/**
 * Who ONE names to sign a lawsuit in a state: the firm's signers who are
 * still its partners or lawyers and hold a registration at the bar there
 * (principal or supplementary), in the order they were named; where none
 * does, the first of the firm's other signers who may still take one more
 * cause there this year without a supplementary registration, counting the
 * causes the firm has of them there (`lawyer_state_causes`) and what the same
 * run already gave them there (`target_taken`, a count by user id). The year
 * is Brasília's. Service role.
 */
create or replace function public.firm_signers_in(target_org uuid, target_uf text, target_taken jsonb default '{}'::jsonb)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  registered uuid[];
  year integer := extract(year from (now() at time zone 'America/Sao_Paulo'))::integer;
  candidate uuid;
begin
  select coalesce(array_agg(s.user_id order by s.added_at, s.user_id), '{}'::uuid[]) into registered
  from public.firm_signers s
  join public.memberships m on m.org_id = s.org_id and m.user_id = s.user_id
  where s.org_id = target_org and m.firm_function in ('socio', 'advogado')
    and exists (select 1 from public.oab_registrations r where r.user_id = s.user_id and r.uf = target_uf);
  if cardinality(registered) > 0 then
    return registered;
  end if;
  for candidate in
    select s.user_id
    from public.firm_signers s
    join public.memberships m on m.org_id = s.org_id and m.user_id = s.user_id
    where s.org_id = target_org and m.firm_function in ('socio', 'advogado')
      -- At the bar somewhere: a lawyer with no registration on record signs nowhere.
      and exists (select 1 from public.oab_registrations r where r.user_id = s.user_id)
    order by s.added_at, s.user_id
  loop
    if public.lawyer_state_causes(target_org, candidate, target_uf, year)
       + coalesce((coalesce(target_taken, '{}'::jsonb) ->> candidate::text)::integer, 0) + 1
       <= public.occasional_causes_per_year() then
      return array[candidate];
    end if;
  end loop;
  return '{}'::uuid[];
end;
$$;

revoke all on function public.firm_signers_in(uuid, text, jsonb) from public, anon, authenticated;

/** Who ONE names to sign a lawsuit in a state, with nothing given in the same run (`firm_signers_in`). Service role. */
create or replace function public.firm_signers_for(target_org uuid, target_uf text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select public.firm_signers_in(target_org, target_uf, '{}'::jsonb);
$$;

revoke all on function public.firm_signers_for(uuid, text) from public, anon, authenticated;

/**
 * ONE creates the lawsuits of a case (decision `create_lawsuits`) as the
 * rules plan them, as in 0039, each signed by the firm's signers registered
 * in its court's state or, where none is, by one who may still take one more
 * cause there this year (`firm_signers_in`, each lawsuit of the plan counted
 * as one more cause of who signs it); the timeline says when somebody of
 * another state was named (`signer_occasional`). For the worker that holds
 * the claim; service role only.
 */
create or replace function public.advance_create_lawsuits(target_case uuid, target_claim integer, target_plan jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  advance public.case_advances%rowtype;
  planned jsonb;
  signed jsonb := '[]'::jsonb;
  court_uf text;
  signers uuid[];
  signer uuid;
  unsigned integer := 0;
  answer jsonb;
  stage text;
  -- What this plan already gave each signer of another state, by state: {uf: {user id: count}}.
  taken jsonb := '{}'::jsonb;
  occasional jsonb := '[]'::jsonb;
  year integer := extract(year from (now() at time zone 'America/Sao_Paulo'))::integer;
  given integer;
  occasion jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if jsonb_typeof(target_plan) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  perform set_config('one.system_case', target_case::text, true);
  -- The case's lock first: a person's write waits for ONE, or ONE for it, and every check below is made under it.
  current_case := public.case_for_writer(target_case);
  -- Read, never held: a change that lands after this is said by its wake, and the case is looked at again.
  select * into advance from public.case_advances a where a.case_id = target_case;
  if not found or advance.claimed_at is null or advance.claims is distinct from target_claim then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  -- Something the plan was made from changed after the claim: it is made again at the next look.
  if advance.woken_at is not null and advance.woken_at >= advance.claimed_at then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'changed');
  end if;
  if public.firm_autonomy_mode(current_case.org_id, 'create_lawsuits') is distinct from 'auto' then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_auto');
  end if;
  if not public.case_advance_lawsuits_due(target_case) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_due');
  end if;
  -- Every claimant of the case in one lawsuit, once.
  if exists (select 1 from jsonb_array_elements(target_plan) item where jsonb_typeof(item) is distinct from 'object'
             or jsonb_typeof(item -> 'parties') is distinct from 'array')
     or (select coalesce(array_agg(party order by party), '{}') from (
           select jsonb_array_elements_text(item -> 'parties') as party from jsonb_array_elements(target_plan) item
         ) given_parties)
        is distinct from
        (select coalesce(array_agg(cp.id::text order by cp.id::text), '{}') from public.case_parties cp
         where cp.case_id = target_case and cp.role = 'claimant') then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'plan_incomplete');
  end if;
  for planned in select value from jsonb_array_elements(target_plan) loop
    court_uf := (select c.uf from public.courts c where c.acronym = upper(coalesce(planned #>> '{fields,court}', '')));
    signers := case
      when court_uf is null then '{}'::uuid[]
      else public.firm_signers_in(current_case.org_id, court_uf, coalesce(taken -> court_uf, '{}'::jsonb))
    end;
    if cardinality(signers) = 0 then
      unsigned := unsigned + 1;
    end if;
    -- A signer of another state takes one of their causes there with each lawsuit of the plan.
    foreach signer in array signers loop
      if not exists (select 1 from public.oab_registrations r where r.user_id = signer and r.uf = court_uf) then
        given := coalesce((taken #>> array[court_uf, signer::text])::integer, 0) + 1;
        taken := jsonb_set(
          case when taken ? court_uf then taken else taken || jsonb_build_object(court_uf, '{}'::jsonb) end,
          array[court_uf, signer::text], to_jsonb(given));
        occasional := occasional || jsonb_build_array(jsonb_build_object(
          'uf', court_uf,
          'causes', public.lawyer_state_causes(current_case.org_id, signer, court_uf, year) + given,
          'limit', public.occasional_causes_per_year()));
      end if;
    end loop;
    signed := signed || jsonb_build_array(planned || jsonb_build_object('lawyers', to_jsonb(signers)));
  end loop;

  answer := public.create_planned_proceedings(target_case, signed);
  if coalesce((answer ->> 'ok')::boolean, false) then
    select k.status into stage from public.cases k where k.id = target_case;
    if stage in ('intake', 'documents') then
      update public.cases set status = 'drafting', status_changed_at = now() where id = target_case;
      perform public.record_case_event(current_case.org_id, target_case, 'status_changed', 'system',
        jsonb_build_object('from', stage, 'to', 'drafting'));
    end if;
    -- Each lawsuit signed by somebody of another state, with the cause it is of theirs there this year (counted
    -- before the plan was created, so the number is that lawsuit's own).
    for occasion in select value from jsonb_array_elements(occasional) loop
      perform public.record_case_event(current_case.org_id, target_case, 'signer_occasional', 'system', occasion);
    end loop;
  end if;
  perform set_config('one.system_case', '', true);
  return answer || jsonb_build_object('unsigned', unsigned);
end;
$$;

revoke all on function public.advance_create_lawsuits(uuid, integer, jsonb) from public, anon, authenticated;
