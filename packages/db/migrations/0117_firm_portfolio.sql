-- ============================================================
-- 0117 · Levar a carteira inteira
--
-- Phase 1 of the plan of the controladoria, and the answer to whoever asks how
-- to leave ONE: who decides for the firm takes everything of it in one Excel
-- workbook, written in their browser: the clients with their CPF, telephone,
-- e-mail and address, the cases, the lawsuits, the deadlines and the index of
-- the documents (what each is, never the file).
--
-- It holds every client's personal data, so it asks more than an export of the
-- list: who decides for the firm (`decides_for_firm`) with the second factor of
-- this session, never a support visit, and the setting's few times a day. It
-- is begun on the record (`portfolio.exported` in the audit trail, with how many
-- rows each sheet holds and nothing of anybody), and only a portfolio begun
-- within the setting's hour reads its pages.
--
-- The firm's test cases follow the controladoria (0114): left out once the firm
-- has real ones, with the people who are only in them.
-- ============================================================

update public.platform_settings
set value = value || '{"portfolio_daily": 3, "portfolio_rows": 300000}'::jsonb
where key = 'controladoria' and not (value ? 'portfolio_daily');

/** Why this person may not take the firm's portfolio now; null when they may. */
create or replace function public.portfolio_refusal(target_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.is_impersonated() then 'support_visit'
    when not public.decides_for_firm(target_org) then 'not_allowed'
    when not public.is_aal2() then 'second_factor'
  end;
$$;
revoke all on function public.portfolio_refusal(uuid) from public, anon, authenticated;

/** The firm's clients a portfolio holds: everybody but who is only in test cases, when those are left out. */
create or replace function public.portfolio_people(target_org uuid, target_tests boolean)
returns setof public.people
language sql
stable
security definer
set search_path = public
as $$
  select p.* from public.people p
  where p.org_id = target_org
    and (
      coalesce(target_tests, true)
      or not exists (select 1 from public.case_parties cp where cp.person_id = p.id)
      or exists (
        select 1 from public.case_parties cp
        join public.cases c on c.id = cp.case_id
        where cp.person_id = p.id and not c.is_test
      )
    );
$$;
revoke all on function public.portfolio_people(uuid, boolean) from public, anon, authenticated;

/** How many rows each sheet of the firm's portfolio holds. */
create or replace function public.portfolio_counts(target_org uuid, target_tests boolean)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'clientes', (select count(*) from public.portfolio_people(target_org, target_tests)),
    'casos', (
      select count(*) from public.cases c
      where c.org_id = target_org and (coalesce(target_tests, true) or not c.is_test)
    ),
    'acoes', (
      select count(*) from public.proceedings pr
      join public.cases c on c.id = pr.case_id
      where pr.org_id = target_org and (coalesce(target_tests, true) or not c.is_test)
    ),
    'prazos', (
      select count(*) from public.deadlines d
      left join public.cases c on c.id = d.case_id
      where d.org_id = target_org and (coalesce(target_tests, true) or c.id is null or not c.is_test)
    ),
    'documentos', (
      select count(*) from public.case_documents d
      join public.cases c on c.id = d.case_id
      where d.org_id = target_org and d.status <> 'uploading' and (coalesce(target_tests, true) or not c.is_test)
    )
  );
$$;
revoke all on function public.portfolio_counts(uuid, boolean) from public, anon, authenticated;

/**
 * Begins taking the firm's portfolio, on the record: who decides for the firm, with the second factor, never a support
 * visit, within the setting's times a day per person (in the days of Brasília) and the setting's rows per sheet. The
 * audit trail keeps how many rows each sheet holds and whether the test cases went, nothing of anybody. Answers those
 * counts, the size of the pages to read and how many times are left today.
 */
create or replace function public.begin_portfolio_export(target_org uuid, target_tests boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  daily integer := public.controladoria_setting('portfolio_daily', 3);
  most integer := public.controladoria_setting('portfolio_rows', 300000);
  page integer := greatest(public.controladoria_setting('export_page', 2000), 100);
  day_from timestamptz := ((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
  refusal text;
  counts jsonb;
  biggest record;
  used integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  refusal := public.portfolio_refusal(target_org);
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  counts := public.portfolio_counts(target_org, target_tests);
  select e.key, e.value::integer as rows into biggest
  from jsonb_each_text(counts) e order by e.value::integer desc limit 1;
  if biggest.rows < 1 then
    return jsonb_build_object('ok', false, 'code', 'empty');
  end if;
  if biggest.rows > most then
    return jsonb_build_object('ok', false, 'code', 'too_many', 'limit', most, 'sheet', biggest.key);
  end if;
  select count(*)::integer into used from public.audit_events e
  where e.org_id = target_org and e.actor_id = auth.uid() and e.action = 'portfolio.exported' and e.created_at >= day_from;
  if used >= daily then
    return jsonb_build_object('ok', false, 'code', 'daily_limit', 'limit', daily);
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'portfolio.exported', 'firm', target_org::text,
          jsonb_build_object('sheets', counts, 'tests', coalesce(target_tests, true)));
  return jsonb_build_object('ok', true, 'page', page, 'counts', counts, 'left', daily - used - 1);
end;
$$;
revoke all on function public.begin_portfolio_export(uuid, boolean) from public, anon;
grant execute on function public.begin_portfolio_export(uuid, boolean) to authenticated;

/**
 * A page of one sheet of a portfolio somebody began: what `begin_portfolio_export` counted, in a fixed order, so the
 * pages add up to the sheet. A moment comes on the clock of Brasília ("YYYY-MM-DD HH:MM"), as the sheet shows it.
 */
create or replace function public.firm_portfolio_page(
  target_org uuid,
  target_sheet text,
  target_offset integer default 0,
  target_tests boolean default true
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  minutes integer := greatest(public.controladoria_setting('export_minutes', 60), 1);
  page integer := greatest(public.controladoria_setting('export_page', 2000), 100);
  skip integer := greatest(coalesce(target_offset, 0), 0);
  tests boolean := coalesce(target_tests, true);
  answer jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) or public.portfolio_refusal(target_org) is not null then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.audit_events e
    where e.org_id = target_org and e.actor_id = auth.uid() and e.action = 'portfolio.exported'
      and e.created_at > now() - make_interval(mins => minutes)
  ) then
    raise exception 'portfolio_not_begun' using errcode = '42501';
  end if;
  case target_sheet
    when 'clientes' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', r.full_name, 'cpf', r.cpf, 'birth_date', r.birth_date, 'nationality', r.nationality,
        'marital_status', r.marital_status, 'profession', r.profession, 'email', r.email, 'phone', r.phone,
        'postal_code', r.postal_code, 'street', r.street, 'address_number', r.address_number,
        'complement', r.complement, 'district', r.district, 'city', r.city, 'uf', r.uf,
        'cases', (
          select coalesce(jsonb_agg(c.seq order by c.seq), '[]'::jsonb) from public.case_parties cp
          join public.cases c on c.id = cp.case_id
          where cp.person_id = r.id and (tests or not c.is_test)
        ),
        'created_at', to_char(r.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI')
      ) order by r.created_at, r.id), '[]'::jsonb) into answer
      from (
        select p.* from public.portfolio_people(target_org, tests) p
        order by p.created_at, p.id limit page offset skip
      ) r;
    when 'casos' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'seq', r.seq,
        -- Named as the list names it: its first adult claimant; with only minors, who answers for them.
        'client', (
          select p.full_name from public.case_parties cp
          join public.people p on p.id = cp.person_id
          where cp.case_id = r.id
          order by (cp.role = 'claimant' and cp.guardian_id is null) desc, (cp.role = 'guardian') desc,
                   cp.created_at, cp.id
          limit 1
        ),
        -- By its name, also when the firm no longer has the module: a firm leaving reads what it had.
        'module', r.module,
        'module_name', (select m.name from public.product_modules m where m.key = r.module),
        'incident', r.incident, 'status', r.status,
        'airline', (select a.name from public.airlines a where a.iata = r.airline_iata),
        'flight_date', r.flight_date,
        'agency', (
          select pa.name from public.partner_links l
          join public.partners pa on pa.id = l.partner_id
          where l.id = r.partnership_id and l.org_id = target_org
        ),
        'is_test', r.is_test,
        'created_at', to_char(r.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI'),
        'closed_at', to_char(r.closed_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI')
      ) order by r.seq), '[]'::jsonb) into answer
      from (
        select c.* from public.cases c
        where c.org_id = target_org and (tests or not c.is_test)
        order by c.seq limit page offset skip
      ) r;
    when 'acoes' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'seq', r.seq, 'kind', r.kind, 'court', r.court, 'comarca', r.comarca, 'unit', r.unit, 'system', r.system,
        'cnj', r.cnj, 'status', r.status, 'filed_at', r.filed_at, 'forum_city', r.forum_city,
        'claimants', (
          select string_agg(p.full_name, ', ' order by cp.created_at, cp.id) from public.proceeding_parties pp
          join public.case_parties cp on cp.id = pp.party_id
          join public.people p on p.id = cp.person_id
          where pp.proceeding_id = r.id
        ),
        'claim_cents', (
          select sum(cp.claim_cents) from public.proceeding_parties pp
          join public.case_parties cp on cp.id = pp.party_id
          where pp.proceeding_id = r.id
        ),
        -- Each lawyer of the lawsuit with their registration at the bar: the one of the court's state, else the first.
        'lawyers', (
          select string_agg(
            coalesce(pf.display_name, '') || coalesce(' (OAB/' || o.uf || ' ' || o.number || ')', ''),
            ', ' order by pf.display_name
          )
          from public.proceeding_lawyers pl
          join public.profiles pf on pf.id = pl.user_id
          left join lateral (
            select x.uf, x.number from public.oab_registrations x
            where x.user_id = pl.user_id
            order by (x.uf = (select ct.uf from public.courts ct where ct.acronym = r.court)) desc nulls last,
                     (x.kind = 'principal') desc, x.uf
            limit 1
          ) o on true
          where pl.proceeding_id = r.id
        )
      ) order by r.seq, r.created_at, r.id), '[]'::jsonb) into answer
      from (
        select pr.*, c.seq from public.proceedings pr
        join public.cases c on c.id = pr.case_id
        where pr.org_id = target_org and (tests or not c.is_test)
        order by c.seq, pr.created_at, pr.id limit page offset skip
      ) r;
    when 'prazos' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'seq', r.seq, 'cnj', r.cnj, 'court', r.court, 'title', r.title, 'trigger_on', r.trigger_on, 'days', r.days,
        'counting', r.counting, 'due_on', r.due_on, 'status', r.status, 'confirmed_auto', r.confirmed_auto,
        'confirmed_at', to_char(r.confirmed_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI'),
        'done_at', to_char(r.done_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI'),
        'dismiss_reason', r.dismiss_reason
      ) order by r.created_at, r.id), '[]'::jsonb) into answer
      from (
        select d.*, c.seq from public.deadlines d
        left join public.cases c on c.id = d.case_id
        where d.org_id = target_org and (tests or c.id is null or not c.is_test)
        order by d.created_at, d.id limit page offset skip
      ) r;
    when 'documentos' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'seq', r.seq, 'person', r.person, 'kind', r.kind, 'status', r.status, 'source', r.source, 'name', r.name,
        'mime', r.detected_mime, 'bytes', r.bytes, 'pages', r.pages, 'sha256', r.sha256,
        'rejected_reason', r.rejected_reason,
        'sent_at', to_char(r.created_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI'),
        'decided_at', to_char(r.decided_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI')
      ) order by r.seq, r.created_at, r.id), '[]'::jsonb) into answer
      from (
        select d.id, d.kind, d.status, d.source, d.rejected_reason, d.created_at, d.decided_at, c.seq,
               f.name, f.detected_mime, f.bytes, f.pages, f.sha256, p.full_name as person
        from public.case_documents d
        join public.cases c on c.id = d.case_id
        join public.files f on f.id = d.file_id
        left join public.case_parties cp on cp.id = d.party_id
        left join public.people p on p.id = cp.person_id
        where d.org_id = target_org and d.status <> 'uploading' and (tests or not c.is_test)
        order by c.seq, d.created_at, d.id limit page offset skip
      ) r;
    else
      raise exception 'invalid_sheet' using errcode = '22023';
  end case;
  return jsonb_build_object('rows', answer);
end;
$$;
revoke all on function public.firm_portfolio_page(uuid, text, integer, boolean) from public, anon;
grant execute on function public.firm_portfolio_page(uuid, text, integer, boolean) to authenticated;
