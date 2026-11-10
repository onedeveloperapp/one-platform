-- ============================================================
-- 0164 · Os livros do escritório em "Levar a carteira inteira"
--
-- Phase 12 of the plan of the controladoria and the finance, its second cut: the whole portfolio a firm takes when it
-- leaves ONE (0117, 0118) carries its books too. Two sheets join it: `lancamentos` (every entry of the books, the
-- cancelled ones with when and why, by its day, its month of competence, its account, its kind, its category, its cost
-- centre, its value, who it was of, what it was, its case and whether ONE wrote it) and `contas` (every bill to pay and
-- to receive, with where it stands, what was paid of it, its due day and its month). Counted and on the record with
-- the rest (`portfolio_counts`, `firm_portfolio_page` redefined from 0118); the books are the firm's own money, so the
-- test cases' cut leaves none of them out. Who takes the portfolio decides for the firm, who reads the books whole.
-- ============================================================

/** How many rows each sheet of the firm's portfolio holds (0118), the books' two included (0164). */
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
    'audiencias', (
      select count(*) from public.hearings h
      join public.cases c on c.id = h.case_id
      where h.org_id = target_org and (coalesce(target_tests, true) or not c.is_test)
    ),
    'documentos', (
      select count(*) from public.case_documents d
      join public.cases c on c.id = d.case_id
      where d.org_id = target_org and d.status <> 'uploading' and (coalesce(target_tests, true) or not c.is_test)
    ),
    -- The firm's books (0164): every entry and every bill, the cancelled ones too, whatever case they name.
    'lancamentos', (select count(*) from public.finance_entries e where e.org_id = target_org),
    'contas', (select count(*) from public.finance_bills b where b.org_id = target_org)
  );
$$;
revoke all on function public.portfolio_counts(uuid, boolean) from public, anon, authenticated;

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
    when 'audiencias' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'seq', r.seq, 'cnj', r.cnj, 'court', r.court, 'kind', r.kind,
        -- On the clock of the zone the hearing is said in, as its card shows it; the zone comes beside it.
        'starts_at', to_char(r.starts_at at time zone r.time_zone, 'YYYY-MM-DD HH24:MI'),
        'time_zone', r.time_zone, 'mode', r.mode, 'place', r.place, 'link', r.link,
        -- Somebody of the firm by their name, else the name of who goes from outside it.
        'attendee', coalesce(r.attendee_display, r.attendee_name),
        'status', r.status, 'outcome', r.outcome, 'outcome_note', r.outcome_note, 'notes', r.notes,
        'created_auto', r.created_auto
      ) order by r.seq, r.starts_at, r.id), '[]'::jsonb) into answer
      from (
        select h.id, h.kind, h.starts_at, h.time_zone, h.mode, h.place, h.link, h.attendee_name, h.status, h.outcome,
               h.outcome_note, h.notes, h.created_auto, c.seq, pr.cnj, pr.court, pf.display_name as attendee_display
        from public.hearings h
        join public.cases c on c.id = h.case_id
        join public.proceedings pr on pr.id = h.proceeding_id
        left join public.profiles pf on pf.id = h.attendee_user_id
        where h.org_id = target_org and (tests or not c.is_test)
        order by c.seq, h.starts_at, h.id limit page offset skip
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
    when 'lancamentos' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'occurred_on', r.occurred_on, 'competence_on', r.competence_on, 'account', r.account, 'kind', r.kind,
        'category', r.category, 'center', r.center, 'cents', r.cents, 'counterparty', r.counterparty,
        'description', r.description, 'seq', r.seq, 'by_one', r.by_one,
        'cancelled_at', to_char(r.cancelled_at at time zone 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI'),
        'cancelled_reason', r.cancelled_reason
      ) order by r.occurred_on, r.created_at, r.id), '[]'::jsonb) into answer
      from (
        select e.id, e.occurred_on, e.competence_on, a.name as account, e.kind, cat.name as category, cc.name as center,
               e.cents, e.counterparty, e.description, c.seq, e.by_one, e.cancelled_at, e.cancelled_reason, e.created_at
        from public.finance_entries e
        join public.finance_accounts a on a.id = e.account_id
        left join public.finance_categories cat on cat.id = e.category_id
        left join public.finance_cost_centers cc on cc.id = e.cost_center_id
        left join public.cases c on c.id = e.case_id
        where e.org_id = target_org
        order by e.occurred_on, e.created_at, e.id limit page offset skip
      ) r;
    when 'contas' then
      select coalesce(jsonb_agg(jsonb_build_object(
        'direction', r.direction, 'status', r.status, 'counterparty', r.counterparty, 'description', r.description,
        'category', r.category, 'seq', r.seq, 'cents', r.cents, 'paid_cents', r.paid_cents, 'due_on', r.due_on,
        'competence_on', r.competence_on, 'closed_reason', r.closed_reason, 'by_one', r.by_one
      ) order by r.due_on, r.created_at, r.id), '[]'::jsonb) into answer
      from (
        select b.id, b.direction, b.status, b.counterparty, b.description, cat.name as category, c.seq, b.cents,
               b.paid_cents, b.due_on, b.competence_on, b.closed_reason, b.by_one, b.created_at
        from public.finance_bills b
        left join public.finance_categories cat on cat.id = b.category_id
        left join public.cases c on c.id = b.case_id
        where b.org_id = target_org
        order by b.due_on, b.created_at, b.id limit page offset skip
      ) r;
    else
      raise exception 'invalid_sheet' using errcode = '22023';
  end case;
  return jsonb_build_object('rows', answer);
end;
$$;
revoke all on function public.firm_portfolio_page(uuid, text, integer, boolean) from public, anon;
grant execute on function public.firm_portfolio_page(uuid, text, integer, boolean) to authenticated;
