-- ============================================================
-- 0110_controladoria: the first cut of the controladoria (phase 1 of the
-- plan of the controladoria, the outcome of the cases and the firm's
-- finance, agreed by the owner on 2026-11-07): the court in the list of
-- cases, and the list taken to a spreadsheet.
--
-- `firm_cases` (0033, 0075, 0078, 0108) is redefined:
--
-- - Seven views of the court, each counted: the cases whose lawsuits moved
--   today, in the last 7 and in the last 30 days (`mov-hoje`, `mov-7`,
--   `mov-30`: a movement of a lawsuit in court, by the day of Brasília it
--   happened on); the cases in court quiet for more than 30, 45 and 90 days
--   (`parado-30`, `parado-45`, `parado-90`: the most recent thing a lawsuit
--   ONE read did, its last movement or else its filing; a lawsuit no
--   source read says nothing of it); and the cases in court with a lawsuit
--   no source ever read (`nunca-capturados`).
-- - The cases archived in the month (`arquivados-mes`: a case that went to
--   court and ended), with the same days of the month before in `numbers`
--   (`archived`, `archived_before`), the word the market uses beside the
--   ones filed.
-- - Each row says when a lawsuit of the case last moved (`moved_at`) and
--   the numbers of its lawsuits in court (`cnjs`), which the spreadsheet
--   carries.
-- - A page holds 100 rows, as before, unless an export the person began
--   asks for larger ones (`firm_cases_export`, below).
--
-- The spreadsheet is written in the person's browser (the project's own
-- writer, no paid component). Who takes the firm's cases out is a partner,
-- the controladoria or who manages the firm account, never a support visit
-- (`may_export_cases`), the setting's 20 times a day each, up to the
-- setting's 100,000 cases (`platform_settings` `controladoria`). Each export
-- is begun on the record (`begin_case_export`: `case.exported` in the audit
-- trail, with the view, the module, whether a search narrowed it and how
-- many cases, never the words searched), and only an export begun within
-- the setting's hour reads the pages of the list, a few thousand at a time
-- (`firm_cases_export`).
-- ============================================================

insert into public.platform_settings (key, value) values
  ('controladoria', '{"export_daily": 20, "export_rows": 100000, "export_page": 2000, "export_minutes": 60}'::jsonb)
on conflict (key) do nothing;

/** A whole number of the setting `controladoria`, or the fallback. Internal. */
create or replace function public.controladoria_setting(setting text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when jsonb_typeof(s.value -> setting) = 'number'
                 then least(greatest(floor((s.value ->> setting)::numeric), 0), 2147483647)::integer end
     from public.platform_settings s where s.key = 'controladoria'),
    fallback
  );
$$;

revoke all on function public.controladoria_setting(text, integer) from public, anon, authenticated;

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
  -- The court's days, in Brasília: today, the last 7 and the last 30, and the start of each quiet mark.
  day_from timestamptz := today::timestamp at time zone 'America/Sao_Paulo';
  week_from timestamptz := (today - 6)::timestamp at time zone 'America/Sao_Paulo';
  thirty_from timestamptz := (today - 29)::timestamp at time zone 'America/Sao_Paulo';
  quiet_30_from timestamptz := (today - 30)::timestamp at time zone 'America/Sao_Paulo';
  quiet_45_from timestamptz := (today - 45)::timestamp at time zone 'America/Sao_Paulo';
  quiet_90_from timestamptz := (today - 90)::timestamp at time zone 'America/Sao_Paulo';
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
  -- A page of the screen holds 100 at most; an export the person began reads its pages larger
  -- (`firm_cases_export`, which sets this for its own call only: no API role reaches the setting).
  page_size integer := least(
    greatest(coalesce(target_limit, 25), 1),
    greatest(100, coalesce(nullif(current_setting('one.case_export_page', true), '')::integer, 100))
  );
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
    'novos-mes', 'ajuizados-mes', 'encerrados-mes', 'arquivados-mes',
    'mov-hoje', 'mov-7', 'mov-30', 'parado-30', 'parado-45', 'parado-90', 'nunca-capturados'
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
  ), court as (
    -- What the court did in each case: when a lawsuit of it in court last moved; when the most recent of the
    -- lawsuits ONE read last did something (its last movement, else its filing); and whether a lawsuit of it in
    -- court was never read by any source.
    select pr.case_id,
           max(t.last_movement_at) as moved_at,
           max(coalesce(t.last_movement_at, pr.filed_at::timestamp at time zone 'America/Sao_Paulo'))
             filter (where t.read_at is not null) as active_at,
           bool_or(t.id is null or (t.read_at is null and t.status <> 'off')) as never_read
    from public.proceedings pr
    left join public.proceeding_tracking t on t.proceeding_id = pr.id and t.org_id = pr.org_id
    where pr.org_id = target_org and pr.status = 'filed'
    group by pr.case_id
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
           (fp.case_id is not null) as filed_before,
           -- The court: what moved today, in the last 7 and 30 days; a case in court quiet for more than 30,
           -- 45 and 90 days (only lawsuits ONE read count); one with a lawsuit no source ever read.
           co.moved_at as court_moved_at,
           (co.moved_at >= day_from) as moved_today,
           (co.moved_at >= week_from) as moved_week,
           (co.moved_at >= thirty_from) as moved_thirty,
           (c.status = 'filed' and co.active_at < quiet_30_from) as quiet_30,
           (c.status = 'filed' and co.active_at < quiet_45_from) as quiet_45,
           (c.status = 'filed' and co.active_at < quiet_90_from) as quiet_90,
           (c.status = 'filed' and coalesce(co.never_read, false)) as never_read,
           -- Archived: a case that went to court and ended, this month and in the same days of the month before.
           (c.status = 'closed' and c.closed_at >= month_from and exists (
             select 1 from public.proceedings pr where pr.case_id = c.id and pr.status in ('filed', 'closed')
           )) as archived_month,
           (c.status = 'closed' and c.closed_at >= prev_from and c.closed_at < prev_moment and exists (
             select 1 from public.proceedings pr where pr.case_id = c.id and pr.status in ('filed', 'closed')
           )) as archived_before
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
    left join court co on co.case_id = c.id
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
        when wanted = 'arquivados-mes' then fl.archived_month
        when wanted = 'mov-hoje' then fl.moved_today
        when wanted = 'mov-7' then fl.moved_week
        when wanted = 'mov-30' then fl.moved_thirty
        when wanted = 'parado-30' then fl.quiet_30
        when wanted = 'parado-45' then fl.quiet_45
        when wanted = 'parado-90' then fl.quiet_90
        when wanted = 'nunca-capturados' then fl.never_read
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
        'encerrados-mes', count(*) filter (where ended_month),
        'arquivados-mes', count(*) filter (where archived_month),
        'mov-hoje', count(*) filter (where moved_today),
        'mov-7', count(*) filter (where moved_week),
        'mov-30', count(*) filter (where moved_thirty),
        'parado-30', count(*) filter (where quiet_30),
        'parado-45', count(*) filter (where quiet_45),
        'parado-90', count(*) filter (where quiet_90),
        'nunca-capturados', count(*) filter (where never_read))
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
        'archived', count(*) filter (where archived_month),
        'archived_before', count(*) filter (where archived_before),
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
        -- When a lawsuit of the case last moved in court, and the numbers of its lawsuits in court.
        'moved_at', pg.court_moved_at,
        -- What its lawsuits show in court (a hearing held, a decision that is the judgment, a payment): the step of
        -- its way the list and the spreadsheet show, read with the row and never once per case.
        'court', case when pg.status = 'filed' then jsonb_build_object(
          'held', exists (
            select 1 from public.hearings h where h.case_id = pg.id and h.org_id = target_org and h.status = 'held'
          ),
          'decided', exists (
            select 1 from public.publications p
            where p.case_id = pg.id and p.org_id = target_org and p.active and p.category = 'decisao' and p.judgment is true
          ),
          'paid', exists (
            select 1 from public.publications p
            where p.case_id = pg.id and p.org_id = target_org and p.active and p.category = 'pagamento'
          )
        ) end,
        'cnjs', coalesce((
          select jsonb_agg(pr.cnj order by pr.filed_at nulls last, pr.cnj) from public.proceedings pr
          where pr.case_id = pg.id and pr.status in ('filed', 'closed')
        ), '[]'::jsonb),
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

-- ---------- The list taken to a spreadsheet ----------

/**
 * Whether the caller takes the firm's cases out of ONE: a partner, the controladoria, or who manages the firm
 * account. The screens read it to offer "Exportar"; the export's own functions ask it again.
 */
create or replace function public.may_export_cases(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and public.is_org_member(target_org) and (
    public.has_firm_function(target_org, array['socio', 'controladoria']::public.firm_function[])
    or public.has_org_role(target_org, array['owner', 'admin']::public.org_role[])
  );
$$;

revoke all on function public.may_export_cases(uuid) from public, anon;
grant execute on function public.may_export_cases(uuid) to authenticated;

/**
 * Begins an export of the firm's list of cases, on the record: who may (`may_export_cases`), never a support
 * visit, within the setting's exports a day per person (counted in the days of Brasília) and the setting's cases.
 * The audit trail keeps the view, the module, whether a search narrowed the list and how many cases it holds,
 * never the words searched. Answers the size of the pages to read and how many exports are left today.
 */
create or replace function public.begin_case_export(
  target_org uuid,
  target_view text default null,
  target_module text default null,
  target_searched boolean default false,
  target_rows integer default 0,
  target_format text default 'xlsx'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  daily integer := public.controladoria_setting('export_daily', 20);
  most integer := public.controladoria_setting('export_rows', 100000);
  page integer := greatest(public.controladoria_setting('export_page', 2000), 100);
  day_from timestamptz := ((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
  used integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.may_export_cases(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if coalesce(target_format, '') not in ('xlsx') then
    raise exception 'invalid_format' using errcode = '22023';
  end if;
  if (target_view is not null and target_view !~ '^[a-z][a-z0-9-]{1,40}$')
     or (target_module is not null and target_module !~ '^[a-z][a-z0-9-]{1,60}$') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if coalesce(target_rows, 0) < 1 then
    return jsonb_build_object('ok', false, 'code', 'empty');
  end if;
  if target_rows > most then
    return jsonb_build_object('ok', false, 'code', 'too_many', 'limit', most);
  end if;
  select count(*)::integer into used from public.audit_events e
  where e.org_id = target_org and e.actor_id = auth.uid() and e.action = 'case.exported' and e.created_at >= day_from;
  if used >= daily then
    return jsonb_build_object('ok', false, 'code', 'daily_limit', 'limit', daily);
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'case.exported', 'case_list', target_org::text,
          jsonb_strip_nulls(jsonb_build_object(
            'view', target_view, 'module', target_module, 'searched', coalesce(target_searched, false),
            'rows', target_rows, 'format', target_format)));
  return jsonb_build_object('ok', true, 'page', page, 'left', daily - used - 1);
end;
$$;

revoke all on function public.begin_case_export(uuid, text, text, boolean, integer, text) from public, anon;
grant execute on function public.begin_case_export(uuid, text, text, boolean, integer, text) to authenticated;

/**
 * A page of the list of cases for an export the caller began within the setting's minutes
 * (`begin_case_export`): the same list `firm_cases` answers, in pages of the setting's size.
 */
create or replace function public.firm_cases_export(
  target_org uuid,
  target_filter text default null,
  target_search text default null,
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
as $$
declare
  page integer := greatest(public.controladoria_setting('export_page', 2000), 100);
  minutes integer := greatest(public.controladoria_setting('export_minutes', 60), 1);
  answer jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) or public.is_impersonated() or not public.may_export_cases(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.audit_events e
    where e.org_id = target_org and e.actor_id = auth.uid() and e.action = 'case.exported'
      and e.created_at > now() - make_interval(mins => minutes)
  ) then
    raise exception 'export_not_begun' using errcode = '42501';
  end if;
  perform set_config('one.case_export_page', page::text, true);
  answer := public.firm_cases(
    target_org, target_filter, target_search, page, greatest(coalesce(target_offset, 0), 0),
    target_module, target_sort, target_incident, target_airline
  );
  perform set_config('one.case_export_page', '', true);
  return answer;
end;
$$;

revoke all on function public.firm_cases_export(uuid, text, text, integer, text, text, text, text) from public, anon;
grant execute on function public.firm_cases_export(uuid, text, text, integer, text, text, text, text) to authenticated;
