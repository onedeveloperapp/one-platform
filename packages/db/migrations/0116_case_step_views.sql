-- ============================================================
-- 0116 · The list of cases by the step of their way
--
-- The app said where a case is along its way by two rules: the top of the
-- case, the controladoria's board and the column "Na etapa há" read
-- `case_standing` (0111: at the signature while a paper waits, at the filing
-- once a package is asked for), while the home's card of the steps and the
-- little bar of the list read the case's stage and what its lawsuits show
-- (`firm_case_journey`, 0082). A count of the home then opened a list of
-- another size (its "Documentos" opened every case still with the client).
--
-- `firm_cases` lists the cases at each step by the rule of the top of the
-- case (`etapa-intake` to `etapa-payment`, and `etapa-closed` for a case whose
-- money was released and nobody archived yet), read as the views of who has
-- the case are: who has each case and its step for the whole firm only when
-- such a view is asked. The stock (`firm_case_stock`) counts them, so each
-- step of the home, of the board and of a module's area opens a list of the
-- size it says.
-- ============================================================

/**
 * The firm's list of cases (0033, 0108, 0110, 0111, 0114): a page at a time, counted, filtered and searched in the
 * database. Since 0116 it also lists the cases at a step of their way (`etapa-*`), by the rule of the top of the case.
 */
create or replace function public.firm_cases(
  target_org uuid,
  target_filter text default null,
  target_search text default null,
  target_limit integer default 25,
  target_offset integer default 0,
  target_module text default null,
  target_sort text default null,
  target_incident text default null,
  target_airline text default null,
  target_tests boolean default true
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
  -- How many days at each step make a case stagnant (`estoque-v1`): the setting's, read once.
  limits jsonb := coalesce(
    (select s.value -> 'stagnant_days' from public.platform_settings s where s.key = 'controladoria'), '{}'::jsonb
  );
  -- The cases of a view of who has them or of a step of the way (0116), when that is the view asked for: who has
  -- each case and its step are read for the whole firm only then (it reads every open case), and for the page's
  -- rows otherwise.
  standing_ids uuid[];
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
    'mov-hoje', 'mov-7', 'mov-30', 'parado-30', 'parado-45', 'parado-90', 'nunca-capturados',
    'com-escritorio', 'com-cliente', 'com-one', 'no-tribunal', 'com-plataforma', 'estagnados',
    'etapa-intake', 'etapa-documents', 'etapa-signature', 'etapa-drafting', 'etapa-filing',
    'etapa-hearing', 'etapa-judgment', 'etapa-payment', 'etapa-closed'
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
  if wanted in ('com-escritorio', 'com-cliente', 'com-one', 'no-tribunal', 'com-plataforma', 'estagnados')
    or wanted like 'etapa-%' then
    select coalesce(array_agg(s.case_id), '{}'::uuid[]) into standing_ids
    from public.case_standing(target_org, target_module) s
    where case wanted
      when 'com-escritorio' then s.holder = 'firm'
      when 'com-cliente' then s.holder = 'client'
      when 'com-one' then s.holder = 'one'
      when 'no-tribunal' then s.holder = 'court'
      when 'com-plataforma' then s.holder = 'platform'
      when 'etapa-intake' then s.step = 'intake'
      when 'etapa-documents' then s.step = 'documents'
      when 'etapa-signature' then s.step = 'signature'
      when 'etapa-drafting' then s.step = 'drafting'
      when 'etapa-filing' then s.step = 'filing'
      when 'etapa-hearing' then s.step = 'hearing'
      when 'etapa-judgment' then s.step = 'judgment'
      when 'etapa-payment' then s.step = 'payment'
      when 'etapa-closed' then s.step = 'closed'
      else jsonb_typeof(limits -> s.step) = 'number'
        and greatest(today - (s.step_since at time zone 'America/Sao_Paulo')::date, 0) > (limits ->> s.step)::numeric
    end;
  end if;

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
           c.created_at, c.closed_at, c.is_test,
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
      -- A test case counts unless the page asked for the firm's real cases alone.
      and (coalesce(target_tests, true) or not c.is_test)
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
        when standing_ids is not null then fl.id = any (standing_ids)
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
  ), standing as materialized (
    -- Who has each case of the page, its step, since when and for how many days (`case_standing`, the rule of the
    -- top of the case), read for these cases alone.
    select s.case_id, s.holder, s.why, s.step, s.step_since,
           greatest(today - (s.step_since at time zone 'America/Sao_Paulo')::date, 0) as step_days
    from public.case_standing(
      target_org, target_module, coalesce((select array_agg(pg.id) from page pg), '{}'::uuid[])
    ) s
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
        -- A case of the test chat, marked on its row (0061).
        'is_test', pg.is_test,
        -- Who has the case and why, its step, since when and for how many days, and whether it stagnated (0111).
        'holder', st.holder,
        'why', st.why,
        'step', st.step,
        'step_since', st.step_since,
        'step_days', st.step_days,
        'stagnant', coalesce(case when jsonb_typeof(limits -> st.step) = 'number'
          then st.step_days > (limits ->> st.step)::numeric end, false),
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
      left join standing st on st.case_id = pg.id
    ), '[]'::jsonb)
  ) into answer;
  return answer;
end;
$$;

revoke all on function public.firm_cases(uuid, text, text, integer, integer, text, text, text, text, boolean) from public, anon;
grant execute on function public.firm_cases(uuid, text, text, integer, integer, text, text, text, text, boolean) to authenticated;
