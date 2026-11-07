-- ============================================================
-- 0108_case_list_bar: the list of cases in the screen pattern of phase 0
-- (the plan of the controladoria, the outcome of the cases and the firm's
-- finance, agreed by the owner on 2026-11-07; the drawings of the canvas
-- "ONE · Padrão de tela", approved the same day).
--
-- `firm_cases` (0033, 0075, 0078) is redefined:
--
-- - It takes the order of the list (`target_sort`: the latest change
--   first, as before; the oldest change first; the newest case first; the
--   oldest case first) and the list's own filters, the kind of problem
--   (`target_incident`) and the airline (`target_airline`), which narrow
--   every count as the module does, so a view's count is what its list
--   shows under them.
-- - Three more views count what happened in the month, in the days of
--   Brasília: the cases opened (`novos-mes`), the cases with a lawsuit
--   filed (`ajuizados-mes`) and the cases ended (`encerrados-mes`).
-- - Its answer carries `numbers`: the four numbers of the cards above the
--   list, each with what it was in the same days of the month before. The
--   cases still going are compared with the ones going at the end of the
--   same day of the month before; the ones opened, filed and ended from the
--   first of this month to today with the ones from the first of the month
--   before to the same day of it (its last day when it is shorter), so a
--   card never compares a few days with a whole month.
--
-- The function takes three more arguments, so the one of 0078 is dropped
-- first: a call that names fewer reads as before.
-- ============================================================

drop function if exists public.firm_cases(uuid, text, text, integer, integer, text);

create or replace function public.firm_cases(
  target_org uuid,
  target_filter text default null,
  target_search text default null,
  target_limit integer default 25,
  target_offset integer default 0,
  target_module text default null,
  target_sort text default null,
  target_incident text default null,
  target_airline text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  -- The month so far, and the same days of the month before (its last day when it is shorter).
  month_start date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  prev_start date := (date_trunc('month', (now() at time zone 'America/Sao_Paulo')) - interval '1 month')::date;
  prev_until date;
  month_from timestamptz;
  prev_from timestamptz;
  prev_moment timestamptz;
  wanted text := nullif(btrim(coalesce(target_filter, '')), '');
  sort_by text := coalesce(nullif(btrim(coalesce(target_sort, '')), ''), 'recent');
  kind_wanted text := nullif(btrim(coalesce(target_incident, '')), '');
  airline_wanted text := nullif(upper(btrim(coalesce(target_airline, ''))), '');
  typed text := left(btrim(coalesce(target_search, '')), 120);
  digits text := regexp_replace(typed, '\D', '', 'g');
  -- What was typed with a letter in it is a name: its words as `slugify` writes them (no accent, no case).
  name_words text[] := case when typed ~ '[[:alpha:]]' then
    array(select w from regexp_split_to_table(public.slugify(typed), '-') as w where w <> '') end;
  -- What was typed with no letter is a number: a case's own, a CPF, or how a lawsuit's number starts.
  seq_wanted integer := case when name_words is null and digits ~ '^[0-9]{1,6}$' then digits::integer end;
  cpf_wanted text := case when name_words is null and char_length(digits) = 11 then digits end;
  cnj_start text := case when name_words is null and char_length(digits) between 5 and 20 then digits end;
  searching boolean;
  page_size integer := least(greatest(coalesce(target_limit, 25), 1), 100);
  skip integer := greatest(coalesce(target_offset, 0), 0);
  answer jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if wanted is not null and wanted not in (
    'open', 'preparing', 'filed', 'ended',
    'documentos', 'cliente-terminou', 'cronologia', 'reclamacao', 'pecas', 'andamento', 'vara-civel', 'agencia',
    'novos-mes', 'ajuizados-mes', 'encerrados-mes'
  ) then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if sort_by not in ('recent', 'oldest', 'newest', 'first') then
    raise exception 'invalid_sort' using errcode = '22023';
  end if;
  if (kind_wanted is not null and kind_wanted !~ '^[a-z][a-z0-9_-]{1,40}$')
    or (airline_wanted is not null and airline_wanted !~ '^[A-Z0-9]{2,3}$') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  searching := name_words is not null or digits <> '';
  prev_until := least(prev_start + (today - month_start), month_start - 1);
  month_from := month_start::timestamp at time zone 'America/Sao_Paulo';
  prev_from := prev_start::timestamp at time zone 'America/Sao_Paulo';
  -- The end of the same day of the month before.
  prev_moment := (prev_until + 1)::timestamp at time zone 'America/Sao_Paulo';

  with found as (
    -- The cases a search names, a set at a time: a client's name, a CPF, a case's own number, how a lawsuit's
    -- number starts. Each set is the firm's.
    select cp.case_id as id from public.people p
    join public.case_parties cp on cp.person_id = p.id
    where name_words is not null and p.org_id = target_org
      and not exists (
        select 1 from unnest(name_words) as word where position(word in public.slugify(p.full_name)) = 0
      )
    union
    select cp.case_id from public.people p
    join public.case_parties cp on cp.person_id = p.id
    where cpf_wanted is not null and p.org_id = target_org and p.cpf = cpf_wanted
    union
    select c.id from public.cases c
    where seq_wanted is not null and c.org_id = target_org and c.seq = seq_wanted
    union
    select pr.case_id from public.proceedings pr
    where cnj_start is not null and pr.org_id = target_org and left(pr.cnj, char_length(cnj_start)) = cnj_start
  ), review as (
    select d.case_id, count(*)::integer as waiting
    from public.case_documents d
    where d.org_id = target_org and d.status = 'received'
    group by d.case_id
  ), finished as (
    select distinct l.case_id from public.client_links l
    where l.org_id = target_org and l.finished_at is not null and l.revoked_at is null
  ), contested as (
    select distinct s.case_id from public.case_statements s
    where s.org_id = target_org and s.chronology_status = 'contested'
  ), overdue as (
    select distinct a.case_id from public.admin_complaints a
    where a.org_id = target_org and a.outcome = 'pending' and a.answer_due_on < today
  ), pieces as (
    select distinct d.case_id from public.case_drafts d
    join public.proceedings p on p.id = d.proceeding_id
    where d.org_id = target_org and p.status = 'planned'
      and (
        (d.status = 'proposed' and d.work is distinct from 'revise' and not exists (
          select 1 from public.approvals a where a.run_id = d.run_id and a.status = 'pending'
        ))
        or d.status = 'failed'
        or (d.status = 'approved' and d.work is null)
      )
  ), moved as (
    select distinct t.case_id from public.proceeding_tracking t
    where t.org_id = target_org and ((t.status <> 'off' and t.unseen_count > 0) or t.status = 'failed')
  ), refused as (
    -- A claimant said no to the civil court for a lawsuit planned there (0025).
    select distinct a.case_id from public.civil_court_answers a
    where a.org_id = target_org and a.replaced_at is null and not a.accepted
      and a.person_id is not distinct from public.civil_court_answerer(a.party_id)
      and exists (
        select 1 from public.proceeding_parties pp
        join public.proceedings p on p.id = pp.proceeding_id
        where pp.party_id = a.party_id and p.status = 'planned' and p.kind = 'comum'
      )
  ), filed_now as (
    -- A lawsuit of the case filed this month, and in the same days of the month before.
    select distinct pr.case_id from public.proceedings pr
    where pr.org_id = target_org and pr.status in ('filed', 'closed')
      and pr.filed_at between month_start and today
  ), filed_prev as (
    select distinct pr.case_id from public.proceedings pr
    where pr.org_id = target_org and pr.status in ('filed', 'closed')
      and pr.filed_at between prev_start and prev_until
  ), flagged as (
    select c.id, c.seq, c.module, c.incident, c.airline_iata, c.flight_date, c.status, c.updated_at, c.partnership_id,
           c.created_at, c.closed_at,
           coalesce(r.waiting, 0) as to_review,
           -- What waits in a case counts while the case is where it can still be done (as the home counts it).
           (f.case_id is not null and c.status in ('intake', 'documents', 'signature')) as client_finished,
           (ct.case_id is not null and c.status not in ('closed', 'declined')) as chronology_contested,
           (o.case_id is not null and c.status not in ('closed', 'declined')) as complaint_overdue,
           (pc.case_id is not null and c.status not in ('closed', 'declined')) as piece_waiting,
           (m.case_id is not null and c.status not in ('closed', 'declined')) as court_moved,
           (rf.case_id is not null and c.status not in ('closed', 'declined')) as civil_refused,
           -- A case an agency's passenger opened with their yes (0071), while it goes on.
           (c.partnership_id is not null and c.status not in ('closed', 'declined')) as from_agency,
           -- What happened in the month, in the days of Brasília.
           (c.created_at >= month_from) as new_month,
           (fn.case_id is not null) as filed_month,
           (c.status in ('closed', 'declined') and c.closed_at >= month_from) as ended_month,
           (fp.case_id is not null) as filed_before
    from public.cases c
    left join review r on r.case_id = c.id
    left join finished f on f.case_id = c.id
    left join contested ct on ct.case_id = c.id
    left join overdue o on o.case_id = c.id
    left join pieces pc on pc.case_id = c.id
    left join moved m on m.case_id = c.id
    left join refused rf on rf.case_id = c.id
    left join filed_now fn on fn.case_id = c.id
    left join filed_prev fp on fp.case_id = c.id
    where c.org_id = target_org
      and (target_module is null or c.module = target_module)
      and (kind_wanted is null or c.incident = kind_wanted)
      and (airline_wanted is null or c.airline_iata = airline_wanted)
  ), matched as (
    select fl.* from flagged fl
    where (
      case
        when wanted is null then searching or fl.status not in ('closed', 'declined')
        when wanted = 'open' then fl.status in ('intake', 'documents', 'signature')
        when wanted = 'preparing' then fl.status in ('drafting', 'ready')
        when wanted = 'filed' then fl.status = 'filed'
        when wanted = 'ended' then fl.status in ('closed', 'declined')
        when wanted = 'documentos' then fl.to_review > 0
        when wanted = 'cliente-terminou' then fl.client_finished
        when wanted = 'cronologia' then fl.chronology_contested
        when wanted = 'reclamacao' then fl.complaint_overdue
        when wanted = 'pecas' then fl.piece_waiting
        when wanted = 'vara-civel' then fl.civil_refused
        when wanted = 'agencia' then fl.from_agency
        when wanted = 'novos-mes' then fl.new_month
        when wanted = 'ajuizados-mes' then fl.filed_month
        when wanted = 'encerrados-mes' then fl.ended_month
        else fl.court_moved
      end
    ) and (not searching or fl.id in (select f.id from found f))
  ), ordered as (
    -- The order the person chose; within it, the latest change first, then the newest case.
    select mt.*, row_number() over (
      order by
        case when sort_by = 'oldest' then mt.updated_at end asc nulls last,
        case when sort_by = 'newest' then mt.seq end desc nulls last,
        case when sort_by = 'first' then mt.seq end asc nulls last,
        mt.updated_at desc, mt.seq desc
    ) as pos
    from matched mt
  ), page as (
    select * from ordered order by pos limit page_size offset skip
  )
  select jsonb_build_object(
    'counts', (
      select jsonb_build_object(
        'all', count(*),
        'going', count(*) filter (where status not in ('closed', 'declined')),
        'open', count(*) filter (where status in ('intake', 'documents', 'signature')),
        'preparing', count(*) filter (where status in ('drafting', 'ready')),
        'filed', count(*) filter (where status = 'filed'),
        'ended', count(*) filter (where status in ('closed', 'declined')),
        'documentos', count(*) filter (where to_review > 0),
        'cliente-terminou', count(*) filter (where client_finished),
        'cronologia', count(*) filter (where chronology_contested),
        'reclamacao', count(*) filter (where complaint_overdue),
        'pecas', count(*) filter (where piece_waiting),
        'andamento', count(*) filter (where court_moved),
        'vara-civel', count(*) filter (where civil_refused),
        'agencia', count(*) filter (where from_agency),
        'novos-mes', count(*) filter (where new_month),
        'ajuizados-mes', count(*) filter (where filed_month),
        'encerrados-mes', count(*) filter (where ended_month))
      from flagged
    ),
    -- The numbers of the cards, each beside what it was in the same days of the month before.
    'numbers', (
      select jsonb_build_object(
        'going', count(*) filter (where status not in ('closed', 'declined')),
        'going_before', count(*) filter (
          where created_at < prev_moment and (closed_at is null or closed_at >= prev_moment)
        ),
        'new', count(*) filter (where new_month),
        'new_before', count(*) filter (where created_at >= prev_from and created_at < prev_moment),
        'filed', count(*) filter (where filed_month),
        'filed_before', count(*) filter (where filed_before),
        'ended', count(*) filter (where ended_month),
        'ended_before', count(*) filter (
          where status in ('closed', 'declined') and closed_at >= prev_from and closed_at < prev_moment
        ),
        'since', month_start,
        'until', today,
        'before_since', prev_start,
        'before_until', prev_until)
      from flagged
    ),
    'total', (select count(*) from matched),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pg.id,
        'seq', pg.seq,
        -- The case is named by its first adult claimant; with only minors, by who answers for them.
        'client', coalesce((
          select p.full_name from public.case_parties cp
          join public.people p on p.id = cp.person_id
          where cp.case_id = pg.id
          order by (cp.role = 'claimant' and cp.guardian_id is null) desc, (cp.role = 'guardian') desc,
                   cp.created_at, cp.id
          limit 1
        ), ''),
        -- The module the case is of (0068), which a list of every module names on each row.
        'module', pg.module,
        'incident', pg.incident,
        'airline_iata', pg.airline_iata,
        'flight_date', pg.flight_date,
        'status', pg.status,
        'updated_at', pg.updated_at,
        'created_at', pg.created_at,
        'to_review', pg.to_review,
        'client_finished', pg.client_finished,
        'chronology_contested', pg.chronology_contested,
        'complaint_overdue', pg.complaint_overdue,
        'piece_waiting', pg.piece_waiting,
        'court_moved', pg.court_moved,
        'civil_refused', pg.civil_refused,
        -- The agency the case came from, by the name the firm reads in its partnerships (0069).
        'agency', (
          select pa.name from public.partner_links l
          join public.partners pa on pa.id = l.partner_id
          where l.id = pg.partnership_id and l.org_id = target_org
        )
      ) order by pg.pos)
      from page pg
    ), '[]'::jsonb)
  ) into answer;
  return answer;
end;
$$;

revoke all on function public.firm_cases(uuid, text, text, integer, integer, text, text, text, text) from public, anon;
grant execute on function public.firm_cases(uuid, text, text, integer, integer, text, text, text, text) to authenticated;
