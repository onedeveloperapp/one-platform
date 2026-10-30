-- ============================================================
-- 0075_module_offer: what a firm contracted of ONE's modules, the modules
-- to come, and what a firm reads of its partnerships.
--
-- The owner decided on 2026-10-30 that a module of ONE is a package a firm
-- contracts with its subscription (Direito do Passageiro the first), that a
-- firm's people see which modules it contracted, and that the modules to
-- come are shown as such: Direito Previdenciário and Direito Trabalhista,
-- "em breve". The checkout that sells a package is ONE's own billing (M3):
-- here the catalog says how each module is sold and whether it is out yet.
--
--   product_modules  gains its state (`status`: available, or coming soon,
--                    which no firm can have), how ONE sells it (`sold_as`:
--                    a package added to the subscription, or included in
--                    it), one line for the screens and its place among them.
--                    Seeded with the two modules to come.
--   firm_modules     holds only a module that is out
--                    (`firm_modules_available`), and the operator's switch
--                    (0068) answers for a module to come by name.
--   firm_cases       (0033) filters the cases that came from an agency
--                    (`agencia`), counted as the other filters are, and names
--                    the agency on each row that came from one.
--   firm_partnership_facts  what a firm reads of its partnerships: its own
--                    cases from each (going, in all, and waiting for the
--                    client to confirm what the agency sent, 0071), and, to
--                    who manages the firm, what each costs the firm today
--                    (the documents the AI read for it against the day's
--                    ceiling, and the reads of its flights), with the firm's
--                    own reads of the day against its share. Nothing of a
--                    passenger who did not say yes: no count of who the agency
--                    registered, who agreed or whose trips are followed (the
--                    legal opinion on soliciting clients decides whether a
--                    firm may see that).
-- ============================================================

-- ---------- The catalog ----------

alter table public.product_modules add column status text not null default 'available';
alter table public.product_modules add column sold_as text not null default 'package';
alter table public.product_modules add column description text;
alter table public.product_modules add column sort integer not null default 0;
alter table public.product_modules
  add constraint product_modules_status_check check (status in ('available', 'coming_soon')),
  add constraint product_modules_sold_as_check check (sold_as in ('package', 'included')),
  add constraint product_modules_description_check check (
    description is null
    or (char_length(btrim(description)) between 10 and 300 and description !~ '[[:cntrl:]]')
  ),
  -- A module to come is given to no firm, so it is no firm's default either.
  add constraint product_modules_default_check check (status = 'available' or not is_default);

update public.product_modules
set description = 'Ações de passageiros aéreos contra as companhias aéreas: atraso, cancelamento, overbooking '
                  'e bagagem, com o acompanhamento dos voos e a área da agência de viagens parceira.',
    sort = 1
where key = 'direito-do-passageiro';

insert into public.product_modules (key, name, is_default, status, sold_as, description, sort) values
  ('direito-previdenciario', 'Direito Previdenciário', false, 'coming_soon', 'package',
   'Ações de benefícios do INSS em volume: salário-maternidade, auxílios, aposentadorias e revisões.', 2),
  ('direito-trabalhista', 'Direito Trabalhista', false, 'coming_soon', 'package',
   'Reclamações trabalhistas em volume: verbas rescisórias, horas extras e vínculo de emprego.', 3)
on conflict (key) do nothing;

-- ---------- A firm has only a module that is out ----------

/** Refuses a module to come in a firm's modules, however it is written. Internal. */
create or replace function public.firm_modules_available()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.product_modules m where m.key = new.module_key and m.status <> 'available') then
    raise exception 'module_coming_soon' using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.firm_modules_available() from public, anon, authenticated;

create trigger firm_modules_available before insert or update of module_key on public.firm_modules
  for each row execute function public.firm_modules_available();

/** As in 0068, and a module to come is used by nobody. Internal. */
create or replace function public.firm_uses_module(target_org uuid, target_module text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.firm_modules fm
    join public.product_modules m on m.key = fm.module_key
    where fm.org_id = target_org and fm.module_key = target_module
      and m.retired_at is null and m.status = 'available'
  );
$$;

revoke all on function public.firm_uses_module(uuid, text) from public, anon, authenticated;

/** As in 0068, and a module to come is given to no firm: `module_coming_soon`. */
create or replace function public.admin_set_firm_module(
  target_org uuid,
  target_module text,
  target_enabled boolean,
  target_note text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  note text := nullif(regexp_replace(btrim(coalesce(target_note, '')), '\s+', ' ', 'g'), '');
  module public.product_modules%rowtype;
  had boolean;
begin
  if caller is null or not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  perform public.require_aal2();
  if note is null or char_length(note) < 8 or char_length(note) > 500 or note ~ '[[:cntrl:]]' then
    return jsonb_build_object('ok', false, 'code', 'note_required');
  end if;
  if target_enabled is null then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if not exists (select 1 from public.organizations o where o.id = target_org) then
    return jsonb_build_object('ok', false, 'code', 'firm_not_found');
  end if;
  select * into module from public.product_modules where key = target_module;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'module_not_found');
  end if;
  if target_enabled and module.retired_at is not null then
    return jsonb_build_object('ok', false, 'code', 'module_retired');
  end if;
  if target_enabled and module.status <> 'available' then
    return jsonb_build_object('ok', false, 'code', 'module_coming_soon');
  end if;

  had := exists (select 1 from public.firm_modules fm where fm.org_id = target_org and fm.module_key = module.key);
  if had = target_enabled then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  if target_enabled then
    insert into public.firm_modules (org_id, module_key, enabled_by) values (target_org, module.key, caller);
  else
    delete from public.firm_modules where org_id = target_org and module_key = module.key;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, case when target_enabled then 'module.enabled' else 'module.disabled' end,
          'organization', target_org::text, jsonb_build_object('module', module.key, 'note', note));
  return jsonb_build_object('ok', true, 'code', case when target_enabled then 'enabled' else 'disabled' end);
end;
$$;

revoke all on function public.admin_set_firm_module(uuid, text, boolean, text) from public, anon;
grant execute on function public.admin_set_firm_module(uuid, text, boolean, text) to authenticated;

-- ---------- The cases that came from an agency ----------

/**
 * As in 0033, and the cases that came from a partner of the firm (0071): the filter `agencia` (the ones still
 * going, as the other filters count), its count, and on each row the name of the agency it came from.
 */
create or replace function public.firm_cases(
  target_org uuid,
  target_filter text default null,
  target_search text default null,
  target_limit integer default 25,
  target_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  wanted text := nullif(btrim(coalesce(target_filter, '')), '');
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
    'documentos', 'cliente-terminou', 'cronologia', 'reclamacao', 'pecas', 'andamento', 'vara-civel', 'agencia'
  ) then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  searching := name_words is not null or digits <> '';

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
  ), flagged as (
    select c.id, c.seq, c.incident, c.airline_iata, c.flight_date, c.status, c.updated_at, c.partnership_id,
           coalesce(r.waiting, 0) as to_review,
           -- What waits in a case counts while the case is where it can still be done (as the home counts it).
           (f.case_id is not null and c.status in ('intake', 'documents', 'signature')) as client_finished,
           (ct.case_id is not null and c.status not in ('closed', 'declined')) as chronology_contested,
           (o.case_id is not null and c.status not in ('closed', 'declined')) as complaint_overdue,
           (pc.case_id is not null and c.status not in ('closed', 'declined')) as piece_waiting,
           (m.case_id is not null and c.status not in ('closed', 'declined')) as court_moved,
           (rf.case_id is not null and c.status not in ('closed', 'declined')) as civil_refused,
           -- A case an agency's passenger opened with their yes (0071), while it goes on.
           (c.partnership_id is not null and c.status not in ('closed', 'declined')) as from_agency
    from public.cases c
    left join review r on r.case_id = c.id
    left join finished f on f.case_id = c.id
    left join contested ct on ct.case_id = c.id
    left join overdue o on o.case_id = c.id
    left join pieces pc on pc.case_id = c.id
    left join moved m on m.case_id = c.id
    left join refused rf on rf.case_id = c.id
    where c.org_id = target_org
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
        else fl.court_moved
      end
    ) and (not searching or fl.id in (select f.id from found f))
  ), page as (
    select * from matched order by updated_at desc, seq desc limit page_size offset skip
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
        'agencia', count(*) filter (where from_agency))
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
        'incident', pg.incident,
        'airline_iata', pg.airline_iata,
        'flight_date', pg.flight_date,
        'status', pg.status,
        'updated_at', pg.updated_at,
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
      ) order by pg.updated_at desc, pg.seq desc)
      from page pg
    ), '[]'::jsonb)
  ) into answer;
  return answer;
end;
$$;

-- ---------- What a firm reads of its partnerships ----------

/**
 * Each partnership of the firm (active and ended, the active first) with what the firm has of it: its cases still
 * going, its cases in all, and the ones where ONE waits for the client to confirm what the agency sent (0071).
 * To who manages the firm, also what the partnership costs the firm today: the documents the AI read for it
 * (`pax_reading_days`, 0074) against the day's ceiling (`partners.reading_daily`), and the reads of its trips at
 * the flight source (0072); with the firm's own reads of the day, of every trip it follows, against its share
 * (`flight_alerts.watch_firm_daily_reads`). The day is Brasília's, as the counters keep it. For anybody of the
 * firm and the platform operator; nothing of a passenger who did not say yes.
 */
create or replace function public.firm_partnership_facts(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  manager boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not (public.is_org_member(target_org) or public.is_superadmin()) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  manager := public.is_superadmin() or public.has_org_role(target_org, array['owner', 'admin']::public.org_role[]);

  return jsonb_build_object(
    'partnerships', coalesce((
      select jsonb_agg(jsonb_build_object(
        'link_id', l.id,
        'module', l.module_key,
        'status', l.status,
        'cases_going', (
          select count(*) from public.cases c
          where c.org_id = target_org and c.partnership_id = l.id and c.status not in ('closed', 'declined')
        ),
        'cases_total', (
          select count(*) from public.cases c where c.org_id = target_org and c.partnership_id = l.id
        ),
        'awaiting_client', (
          select count(*) from public.cases c
          join public.case_advances a on a.case_id = c.id
          where c.org_id = target_org and c.partnership_id = l.id and a.waiting = 'client_confirmation'
            and c.status not in ('closed', 'declined')
        ),
        'readings_today', case when manager then coalesce((
          select r.readings from public.pax_reading_days r where r.partnership_id = l.id and r.day = today
        ), 0) end,
        'flight_reads_today', case when manager then coalesce((
          select sum(t.watch_reads)::integer from public.tracked_trips t
          join public.pax_trips p on p.id = t.pax_trip_id
          where p.partnership_id = l.id and t.org_id = target_org and t.watch_day = today
        ), 0) end
      ) order by (l.status = 'active') desc, l.started_at desc)
      from public.partner_links l
      where l.org_id = target_org
    ), '[]'::jsonb),
    'manager', manager,
    'readings_daily', case when manager then greatest(public.partner_setting('reading_daily', 300), 1) end,
    'flight_reads_today', case when manager then coalesce((
      select sum(t.watch_reads)::integer from public.tracked_trips t
      where t.org_id = target_org and t.watch_day = today
    ), 0) end,
    'flight_reads_share', case when manager then
      greatest(public.flight_alerts_setting('watch_firm_daily_reads', 150), 0) end
  );
end;
$$;

revoke all on function public.firm_partnership_facts(uuid) from public, anon;
grant execute on function public.firm_partnership_facts(uuid) to authenticated;
