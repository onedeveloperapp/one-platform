-- ============================================================
-- 0138 · As ferramentas de simulação do plano do financeiro
--
-- The owner asked (2026-11-10) that the test tools carry a test from the
-- passenger to the books, end to end. Three pieces of the database:
--
-- - the test court hands what a bank would show of the firm's test cases
--   (`test_court_statement`: each release, each client's part passed on,
--   each bill open), for the app to write a statement the firm imports;
-- - the screen Pessoas and the segments count the test cases while the
--   firm has no real case, and say so, as the controladoria does
--   (`firm_has_real_case`; `people_facts` and `firm_people_numbers`
--   redefined);
-- - a paper of a test case is signed in one click (`test_signature_to_simulate`
--   gates it; the backend keeps a copy of the paper as its signed document,
--   through the very function a provider's signature goes through).
-- ============================================================

/** Whether a firm has a real case (internal): one that is not a test. */
create or replace function public.firm_has_real_case(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.cases c where c.org_id = target_org and not c.is_test);
$$;

revoke all on function public.firm_has_real_case(uuid) from public, anon, authenticated;

-- ---------- The test statement ----------
/**
 * What a bank would show of a firm's test cases, by its test chat link (the backend's): each release of a test lawsuit
 * (the court's money in), each client's part passed on or owed (the firm's Pix out, with the client's name and CPF),
 * and the firm's bills open (a boleto paid, a fee received). The app writes it as a statement; nothing leaves ONE.
 */
create or replace function public.test_court_statement(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  org := public.test_court_org(target_token);
  if org is null then
    return null;
  end if;
  return jsonb_build_object(
    'firm', (select o.name from public.organizations o where o.id = org),
    'releases', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'cents', coalesce(f.received_cents, f.cents),
        'on', coalesce(f.received_on, f.happened_on + 1), 'cnj', p.cnj, 'court', p.court) order by f.happened_on, f.id)
      from public.lawsuit_facts f
      join public.cases c on c.id = f.case_id
      join public.proceedings p on p.id = f.proceeding_id
      where f.org_id = org and c.is_test and f.kind = 'alvara' and f.corrected_at is null
        and coalesce(f.received_cents, f.cents, 0) > 0
    ), '[]'::jsonb),
    'transfers', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'cents', s.payable_cents, 'on', s.paid_on, 'status', s.status,
        'name', pe.full_name, 'cpf', pe.cpf) order by s.due_on, s.id)
      from public.money_shares s
      join public.cases c on c.id = s.case_id
      left join public.people pe on pe.id = s.person_id
      where s.org_id = org and c.is_test and s.status in ('owed', 'paid') and s.payable_cents > 0
    ), '[]'::jsonb),
    'bills', coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'direction', b.direction, 'cents', b.cents - b.paid_cents,
        'due_on', b.due_on, 'counterparty', b.counterparty) order by b.due_on, b.id)
      from (select * from public.finance_bills b
            where b.org_id = org and b.status = 'open' and b.cents > b.paid_cents
              and b.due_on <= (now() at time zone 'America/Sao_Paulo')::date + 3
            order by b.due_on limit 30) b
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.test_court_statement(text) from public, anon, authenticated;
grant execute on function public.test_court_statement(text) to service_role;

-- ---------- The simulated signature ----------
/**
 * A paper of a test case waiting to be signed, signed in one click (anybody who writes on the case, never a support
 * visit): this gate answers the paper's file for the backend to copy as the signed document, which it records through
 * `record_signature_signed`, as a provider's signature is. Only a test case: a real one is signed by the client.
 */
create or replace function public.test_signature_to_simulate(target_envelope uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  envelope public.signature_envelopes%rowtype;
  current_case public.cases%rowtype;
  path text;
begin
  select * into envelope from public.signature_envelopes where id = target_envelope;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(envelope.case_id);
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not current_case.is_test then
    return jsonb_build_object('ok', false, 'code', 'not_test');
  end if;
  if envelope.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'not_pending');
  end if;
  select f.storage_path into path from public.case_documents d join public.files f on f.id = d.file_id
  where d.id = envelope.document_id and f.status = 'stored';
  if path is null then
    return jsonb_build_object('ok', false, 'code', 'document_not_found');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'signature.simulated', 'signature_envelope', envelope.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'org_id', current_case.org_id, 'storage_path', path, 'case_id', current_case.id);
end;
$$;

revoke all on function public.test_signature_to_simulate(uuid) from public, anon;
grant execute on function public.test_signature_to_simulate(uuid) to authenticated;

-- ---------- The test cases in Pessoas ----------
create or replace function public.people_facts(target_org uuid)
returns table (
  person_id uuid, full_name text, email text, phone text, age integer, adult boolean, active boolean, has_case boolean,
  origins text[], airlines text[], incidents text[], outcomes text[], profession text, city text, uf text,
  marketing_off boolean, erased boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with cases_of as (
    select cp.person_id, c.id as case_id, c.status, c.origin, c.airline_iata, c.incident
    from public.case_parties cp join public.cases c on c.id = cp.case_id
    -- The test cases count while the firm has no real case (0138), as the controladoria counts them.
    where c.org_id = target_org and (not c.is_test or not public.firm_has_real_case(target_org))
  ),
  outcomes_of as (
    select co.person_id, array_agg(distinct coalesce(f.result, f.kind)) as list
    from cases_of co join public.lawsuit_facts f on f.case_id = co.case_id
    where f.kind in ('sentenca', 'acordo') and f.corrected_at is null
    group by co.person_id
  )
  select p.id, p.full_name, p.email, p.phone,
    case when p.birth_date is not null
      then extract(year from age((now() at time zone 'America/Sao_Paulo')::date, p.birth_date))::integer end,
    not public.person_minor(p.id),
    coalesce(bool_or(co.status not in ('closed', 'declined')), false),
    count(co.case_id) > 0,
    coalesce(array_agg(distinct co.origin) filter (where co.origin is not null), '{}'),
    coalesce(array_agg(distinct co.airline_iata) filter (where co.airline_iata is not null), '{}'),
    coalesce(array_agg(distinct co.incident) filter (where co.incident is not null), '{}'),
    coalesce((select o.list from outcomes_of o where o.person_id = p.id), '{}'),
    nullif(btrim(coalesce(p.profession, '')), ''), nullif(btrim(coalesce(p.city, '')), ''), p.uf,
    p.marketing_off_at is not null, p.erased_at is not null
  from public.people p
  left join cases_of co on co.person_id = p.id
  where p.org_id = target_org
  group by p.id;
$$;

revoke all on function public.people_facts(uuid) from public, anon, authenticated;

create or replace function public.firm_people_numbers(target_org uuid)
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
  return (
    with f as (select * from public.people_facts(target_org) where not erased),
    tally as (
      select key, count(*)::integer as n from f, unnest(origins) as key group by key
    )
    select jsonb_build_object(
      'registered', (select count(*) from f),
      'tests_counted', not public.firm_has_real_case(target_org)
        and exists (select 1 from public.cases c where c.org_id = target_org and c.is_test),
      'active', (select count(*) from f where active),
      'inactive', (select count(*) from f where not active),
      'marketing_off', (select count(*) from f where marketing_off),
      'origins', coalesce((select jsonb_object_agg(key, n) from tally), '{}'::jsonb),
      'ages', (select jsonb_build_object(
        'minor', count(*) filter (where not adult),
        '18_29', count(*) filter (where adult and age between 18 and 29),
        '30_39', count(*) filter (where adult and age between 30 and 39),
        '40_49', count(*) filter (where adult and age between 40 and 49),
        '50_59', count(*) filter (where adult and age between 50 and 59),
        '60', count(*) filter (where adult and age >= 60),
        'unknown', count(*) filter (where adult and age is null)) from f),
      'professions', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k)
        from (select profession as k, count(*)::integer as n from f where profession is not null
              group by profession order by count(*) desc, profession limit 10) x), '[]'::jsonb),
      'cities', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k)
        from (select concat_ws('/', city, uf) as k, count(*)::integer as n from f where city is not null
              group by concat_ws('/', city, uf) order by count(*) desc, concat_ws('/', city, uf) limit 10) x), '[]'::jsonb),
      'airlines', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k)
        from (select key as k, count(*)::integer as n from f, unnest(airlines) as key group by key order by count(*) desc, key limit 10) x), '[]'::jsonb),
      'incidents', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k)
        from (select key as k, count(*)::integer as n from f, unnest(incidents) as key group by key) x), '[]'::jsonb),
      'outcomes', coalesce((select jsonb_agg(jsonb_build_object('key', k, 'count', n) order by n desc, k)
        from (select key as k, count(*)::integer as n from f, unnest(outcomes) as key group by key) x), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.firm_people_numbers(uuid) from public, anon;
grant execute on function public.firm_people_numbers(uuid) to authenticated;
