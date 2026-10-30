-- ============================================================
-- 0078_module_areas: each module has an area of its own, and what a partner
-- decides for a firm has somebody to decide it in a firm with no partner.
--
-- The owner asked on 2026-10-30 that each module the firm contracted open an
-- area of its own, with its lawsuits and nothing of another module, that the
-- menu list the modules (the ones to come said so), and that the pages of the
-- work stop mixing the modules. The screens draw the area and the scope; the
-- database gives each list read by module:
--
--   * `product_modules.icon`: the icon that says what a module is, by its
--     name in the app's set (the passenger module's plane), so a module the
--     platform adds, or one still to come, shows with its own;
--   * `firm_cases`, `firm_deadlines` and `firm_hearings` take a module and
--     answer, counts included, only what is of a case of that module;
--   * `firm_module_conversations` and `firm_module_approvals` give the
--     conversations and the answers of the AI of a module: a conversation is
--     of a module when its contact is somebody of a case of it, and an answer
--     when what it is about is of a case of it (a conversation as above).
--
-- The owner's walk of the same day found a firm founded by a lawyer (its
-- founder chose "Advocacia") where nobody could say who signs nor the Valor
-- da Causa Pedido: those, what ONE decides alone and the AI's triage were a
-- partner's, and the firm had none. They are now decided by who decides for
-- the firm (`decides_for_firm`): a partner, or, in a firm where nobody is a
-- partner, who manages the firm account. Where the firm has partners, only
-- they decide, as before.
-- ============================================================

-- ---------- What says a module ----------

alter table public.product_modules add column icon text;

alter table public.product_modules
  add constraint product_modules_icon_check check (icon is null or icon ~ '^Ni[A-Z][A-Za-z0-9]{1,40}$');

comment on column public.product_modules.icon is
  'The icon that says what the module is, by its name in the app''s set (`IconMap`); null shows the generic one.';

update public.product_modules set icon = 'NiPlane' where key = 'direito-do-passageiro';
update public.product_modules set icon = 'NiUmbrella' where key = 'direito-previdenciario';
update public.product_modules set icon = 'NiHardHat' where key = 'direito-trabalhista';

-- ---------- Who decides for the firm ----------

/**
 * Whether the caller decides for the firm what a partner decides (what ONE decides alone, the Valor da Causa
 * Pedido by default, who signs what ONE prepares, the AI's triage of publications): a partner of the firm; in a
 * firm where nobody is a partner, who manages the firm account (its owner and admins), so a firm founded by a
 * lawyer alone is never left with nobody to decide. Readable by the screens, which say who decides.
 */
create or replace function public.decides_for_firm(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = auth.uid()
      and (
        m.firm_function = 'socio'
        or (
          m.role in ('owner', 'admin')
          and not exists (
            select 1 from public.memberships p where p.org_id = target_org and p.firm_function = 'socio'
          )
        )
      )
  );
$$;

revoke all on function public.decides_for_firm(uuid) from public, anon;
grant execute on function public.decides_for_firm(uuid) to authenticated;

-- ---------- Of a module ----------

/** Whether a case is of a module; a null case is of none. For the lists below, which read as their owner. */
create or replace function public.case_in_module(target_case uuid, target_module text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (select 1 from public.cases c where c.id = target_case and c.module = target_module);
$$;

revoke all on function public.case_in_module(uuid, text) from public, anon, authenticated;

/**
 * As in 0016, decided by who decides for the firm (`decides_for_firm`): a partner, or, in a firm with no
 * partner, who manages the firm account. `not_a_partner` still answers anybody else.
 */
create or replace function public.set_firm_autonomy(
  target_org uuid,
  target_decision text,
  target_mode text,
  target_sample_percent integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chosen public.autonomy_decisions%rowtype;
  before text;
  sample integer := coalesce(target_sample_percent, 20);
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
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_a_partner');
  end if;
  select * into chosen from public.autonomy_decisions d where d.key = target_decision;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'decision_not_found');
  end if;
  if target_mode is null or not (target_mode = any (chosen.modes)) then
    return jsonb_build_object('ok', false, 'code', 'invalid_mode');
  end if;
  if sample not between 1 and 100 then
    return jsonb_build_object('ok', false, 'code', 'invalid_sample');
  end if;
  perform public.require_aal2();
  before := coalesce(
    (select f.mode from public.firm_autonomy f where f.org_id = target_org and f.decision = target_decision),
    chosen.default_mode
  );
  insert into public.firm_autonomy as f (org_id, decision, mode, sample_percent, changed_by)
  values (target_org, target_decision, target_mode, sample, auth.uid())
  on conflict (org_id, decision) do update set
    mode = excluded.mode, sample_percent = excluded.sample_percent, changed_by = excluded.changed_by, changed_at = now();
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'autonomy.set', 'autonomy_decision', target_decision,
    jsonb_strip_nulls(jsonb_build_object('from', before, 'to', target_mode,
      'sample_percent', case when target_mode = 'sampled' then sample end)));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_firm_autonomy(uuid, text, text, integer) from public, anon;
grant execute on function public.set_firm_autonomy(uuid, text, text, integer) to authenticated;

/**
 * As in 0039, named by who decides for the firm (`decides_for_firm`): a partner, or, in a firm with no partner,
 * who manages the firm account. Who signs is still a partner or a lawyer of the firm.
 */
create or replace function public.set_firm_signer(target_org uuid, target_user uuid, target_signs boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_a_partner');
  end if;
  if target_signs is null or target_user is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  if target_signs and not exists (
    select 1 from public.memberships m
    where m.org_id = target_org and m.user_id = target_user and m.firm_function in ('socio', 'advogado')
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_a_lawyer');
  end if;
  perform public.require_aal2();
  if target_signs then
    insert into public.firm_signers (org_id, user_id, added_by) values (target_org, target_user, auth.uid())
    on conflict (org_id, user_id) do nothing;
  else
    delete from public.firm_signers where org_id = target_org and user_id = target_user;
  end if;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'firm.signer_set', 'profile', target_user::text,
    jsonb_build_object('signs', target_signs));
  if target_signs then
    perform public.wake_firm_advance(target_org, 'signer');
  end if;
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_firm_signer(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_firm_signer(uuid, uuid, boolean) to authenticated;

/**
 * As in 0052, said by who decides for the firm (`decides_for_firm`): a partner, or, in a firm with no partner,
 * who manages the firm account.
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
  if not public.decides_for_firm(target_org) then
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

/**
 * As in 0035, switched by who decides for the firm (`decides_for_firm`): a partner, or, in a firm with no
 * partner, who manages the firm account.
 */
create or replace function public.set_firm_publication_ai_triage(target_org uuid, target_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  before boolean;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if target_enabled is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_value');
  end if;
  select o.publication_ai_triage into before from public.organizations o where o.id = target_org for no key update;
  if before = target_enabled then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  update public.organizations set publication_ai_triage = target_enabled where id = target_org;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'publications.ai_triage_set', 'organization', target_org::text,
    jsonb_build_object('enabled', target_enabled));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_firm_publication_ai_triage(uuid, boolean) from public, anon;
grant execute on function public.set_firm_publication_ai_triage(uuid, boolean) to authenticated;

-- ---------- The lists of a firm, by module ----------

/**
 * As in 0075, and, given a module, only the cases of that module (`cases.module`, 0068): its counts, its filters
 * and its pages, so a module's area lists its own lawsuits and nothing of another module. Each row names its
 * module, which a list of every module shows.
 */
drop function if exists public.firm_cases(uuid, text, text, integer, integer);

create or replace function public.firm_cases(
  target_org uuid,
  target_filter text default null,
  target_search text default null,
  target_limit integer default 25,
  target_offset integer default 0,
  target_module text default null
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
    select c.id, c.seq, c.module, c.incident, c.airline_iata, c.flight_date, c.status, c.updated_at, c.partnership_id,
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
    where c.org_id = target_org and (target_module is null or c.module = target_module)
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
        -- The module the case is of (0068), which a list of every module names on each row.
        'module', pg.module,
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

revoke all on function public.firm_cases(uuid, text, text, integer, integer, text) from public, anon;
grant execute on function public.firm_cases(uuid, text, text, integer, integer, text) to authenticated;

/**
 * As in 0034, and, given a module, only the deadlines of a case of that module: a deadline of a lawsuit the firm
 * has no case of is the firm's, read with every module.
 */
drop function if exists public.firm_deadlines(uuid, text, integer, integer, uuid);

create or replace function public.firm_deadlines(
  target_org uuid,
  target_view text,
  target_limit integer default 25,
  target_offset integer default 0,
  target_case uuid default null,
  target_module text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  size integer := least(greatest(coalesce(target_limit, 25), 1), 100);
  skip integer := greatest(coalesce(target_offset, 0), 0);
  soon integer := greatest(public.deadlines_setting('soon_days', 3), 0);
  tries integer := greatest(public.deadlines_setting('max_attempts', 3), 1);
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_view is null or target_view not in ('confirmar', 'proximos', 'vencidos', 'rever', 'abertos', 'concluidos') then
    raise exception 'invalid_view' using errcode = '22023';
  end if;
  return (
    with open_rows as materialized (
      select d.id, d.status, d.created_at,
        public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
          d.confirmed_against) as urgent_on,
        public.deadline_review_reasons_of(d.status, d.publication_id, d.confirmed_at, d.confirmed_revision, d.revision,
          d.computed_revision, d.computed_due_on, d.confirmed_against, d.due_on, d.count_error, d.count_claimed_at,
          d.count_attempts) as review_reasons
      from public.deadlines d
      where d.org_id = target_org and d.status in ('proposed', 'confirmed')
        and (target_case is null or d.case_id = target_case)
        and (target_module is null or public.case_in_module(d.case_id, target_module))
    ),
    listed as (
      select o.id, o.urgent_on, null::timestamptz as closed_at, o.created_at
      from open_rows o
      where target_view <> 'concluidos' and case target_view
        when 'confirmar' then o.status = 'proposed'
        when 'proximos' then o.urgent_on >= today
        when 'vencidos' then o.urgent_on < today
        when 'rever' then cardinality(o.review_reasons) > 0
        else true
      end
      union all
      select d.id, null::date, coalesce(d.done_at, d.dismissed_at), d.created_at
      from public.deadlines d
      where target_view = 'concluidos' and d.org_id = target_org and d.status in ('done', 'dismissed')
        and (target_case is null or d.case_id = target_case)
        and (target_module is null or public.case_in_module(d.case_id, target_module))
    ),
    page as (
      select l.id,
        row_number() over (order by l.urgent_on asc nulls last, l.closed_at desc nulls last, l.created_at, l.id) as position
      from listed l
      order by l.urgent_on asc nulls last, l.closed_at desc nulls last, l.created_at, l.id
      limit size offset skip
    )
    select jsonb_build_object(
      'today', today,
      -- Within how many days a deadline is said to be due soon: the same days the home counts by.
      'soon_days', soon,
      'counts', jsonb_build_object(
        'confirmar', (select count(*) from open_rows o where o.status = 'proposed'),
        'proximos', (select count(*) from open_rows o where o.urgent_on >= today),
        'em_breve', (select count(*) from open_rows o where o.urgent_on between today and today + soon),
        'vencidos', (select count(*) from open_rows o where o.urgent_on < today),
        'rever', (select count(*) from open_rows o where cardinality(o.review_reasons) > 0),
        'abertos', (select count(*) from open_rows),
        'concluidos', (
          select count(*) from public.deadlines d
          where d.org_id = target_org and d.status in ('done', 'dismissed')
            and (target_case is null or d.case_id = target_case)
            and (target_module is null or public.case_in_module(d.case_id, target_module))
        )
      ),
      'total', (select count(*) from listed),
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', p.id,
          'title', p.title,
          'act', p.act,
          'status', p.status,
          'due_on', p.due_on,
          'urgent_on', o.urgent_on,
          'computed_due_on', p.computed_due_on,
          'corrected', p.corrected,
          'correction_reason', p.correction_reason,
          'confirmed_against', p.confirmed_against,
          'trigger', p.trigger,
          'trigger_on', p.trigger_on,
          'days', p.days,
          'counting', p.counting,
          'published_on', p.published_on,
          'starts_on', p.starts_on,
          'explanation', p.explanation,
          -- The checked years of the court's calendar the count goes through, as they are now: a year
          -- checked again since the count says its latest day, with no count made again for it.
          'calendar_checked', coalesce((
            select jsonb_agg(jsonb_build_object('year', y.year, 'checked_on', y.checked_on) order by y.year)
            from public.court_calendar_years y
            where y.court = p.court
              and y.year between extract(year from p.trigger_on)::integer
                and extract(year from coalesce(p.computed_due_on, p.due_on, p.trigger_on))::integer
          ), '[]'::jsonb),
          'revision', p.revision,
          'counted', p.computed_revision = p.revision,
          'count_failed', p.computed_revision is distinct from p.revision and p.count_error is not null
            and p.count_claimed_at is null and p.count_attempts >= tries,
          'overdue', coalesce(o.urgent_on < today, false),
          'review', coalesce(cardinality(o.review_reasons) > 0, false),
          'review_reasons', coalesce(to_jsonb(o.review_reasons), '[]'::jsonb),
          'cnj', p.cnj,
          'court', p.court,
          'case_id', p.case_id,
          'case_seq', (select c.seq from public.cases c where c.id = p.case_id),
          'proceeding_id', p.proceeding_id,
          'proceeding_kind', (select pr.kind from public.proceedings pr where pr.id = p.proceeding_id),
          'publication_id', p.publication_id,
          'publication_active', (select pu.active from public.publications pu where pu.id = p.publication_id),
          'publication_available_on', (select pu.available_on from public.publications pu where pu.id = p.publication_id),
          'confirmed_by', p.confirmed_by,
          'confirmed_at', p.confirmed_at,
          'confirmed_auto', p.confirmed_auto,
          'done_by', p.done_by,
          'done_at', p.done_at,
          'done_note', p.done_note,
          'dismissed_by', p.dismissed_by,
          'dismissed_at', p.dismissed_at,
          'dismiss_reason', p.dismiss_reason,
          'created_by', p.created_by,
          'created_at', p.created_at,
          'proposed_auto', p.proposed_auto
        ) order by pg.position)
        from page pg
        join public.deadlines p on p.id = pg.id
        left join open_rows o on o.id = pg.id
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.firm_deadlines(uuid, text, integer, integer, uuid, text) from public, anon;
grant execute on function public.firm_deadlines(uuid, text, integer, integer, uuid, text) to authenticated;

/**
 * As in 0037, and, given a module, only the hearings of a case of that module.
 */
drop function if exists public.firm_hearings(uuid, text, integer, integer, uuid);

create or replace function public.firm_hearings(
  target_org uuid,
  target_view text,
  target_limit integer default 25,
  target_offset integer default 0,
  target_case uuid default null,
  target_module text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  size integer := least(greatest(coalesce(target_limit, 25), 1), 100);
  skip integer := greatest(coalesce(target_offset, 0), 0);
  duration integer := greatest(public.hearings_setting('duration_minutes', 60), 1);
  ends interval := make_interval(mins => duration);
  soon integer := greatest(public.hearings_setting('soon_days', 7), 0);
  tries integer := greatest(public.hearings_setting('max_attempts', 5), 1);
  past integer := greatest(public.hearings_setting('calendar_past_days', 60), 0);
  calendar public.firm_calendars%rowtype;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_view is null or target_view not in ('proximas', 'sem_resultado', 'realizadas', 'canceladas') then
    raise exception 'invalid_view' using errcode = '22023';
  end if;
  select * into calendar from public.firm_calendars where org_id = target_org and status <> 'off';
  return (
    with firm as (
      select h.id, h.status, h.starts_at, h.updated_at
      from public.hearings h
      where h.org_id = target_org and (target_case is null or h.case_id = target_case)
        and (target_module is null or public.case_in_module(h.case_id, target_module))
    ),
    listed as (
      select f.* from firm f
      where case target_view
        when 'proximas' then f.status = 'scheduled' and f.starts_at + ends >= now()
        when 'sem_resultado' then f.status = 'scheduled' and f.starts_at + ends < now()
        when 'realizadas' then f.status = 'held'
        else f.status = 'cancelled'
      end
    ),
    page as (
      select l.id, row_number() over (order by
        case when target_view in ('proximas', 'sem_resultado') then l.starts_at end asc,
        case when target_view in ('realizadas', 'canceladas') then l.starts_at end desc,
        l.id) as position
      from listed l
      order by
        case when target_view in ('proximas', 'sem_resultado') then l.starts_at end asc,
        case when target_view in ('realizadas', 'canceladas') then l.starts_at end desc,
        l.id
      limit size offset skip
    )
    select jsonb_build_object(
      'soon_days', soon,
      'duration_minutes', duration,
      'counts', jsonb_build_object(
        'proximas', (select count(*) from firm f where f.status = 'scheduled' and f.starts_at + ends >= now()),
        'em_breve', (select count(*) from firm f where f.status = 'scheduled' and f.starts_at + ends >= now()
                       and f.starts_at < now() + make_interval(days => soon)),
        'sem_resultado', (select count(*) from firm f where f.status = 'scheduled' and f.starts_at + ends < now()),
        'realizadas', (select count(*) from firm f where f.status = 'held'),
        'canceladas', (select count(*) from firm f where f.status = 'cancelled')
      ),
      'total', (select count(*) from listed),
      'calendar', case when calendar.org_id is null then null else jsonb_build_object(
        'name', calendar.name, 'status', calendar.status, 'problem', calendar.problem) end,
      -- The hearings of the firm (or the case) the calendar in use refused for good, in any list and page.
      'calendar_failed', case when calendar.org_id is null or calendar.status <> 'active' then 0 else (
        select count(*) from public.hearings h
        where h.org_id = target_org and (target_case is null or h.case_id = target_case)
          and (target_module is null or public.case_in_module(h.case_id, target_module))
          and h.sync_error is not null and h.sync_attempts >= tries and h.sync_claimed_at is null
          and not (h.status = 'cancelled' and h.synced_calendar is null)
          and (h.synced_calendar = calendar.calendar_id or h.starts_at >= now() - make_interval(days => past))
      ) end,
      'rows', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', h.id,
          'kind', h.kind,
          'starts_at', h.starts_at,
          'time_zone', h.time_zone,
          'mode', h.mode,
          'place', h.place,
          'link', h.link,
          'attendee_user_id', h.attendee_user_id,
          'attendee_name', h.attendee_name,
          'notes', h.notes,
          'source', h.source,
          'publication_id', h.publication_id,
          'status', h.status,
          'outcome', h.outcome,
          'outcome_note', h.outcome_note,
          'revision', h.revision,
          'case_id', h.case_id,
          'case_seq', (select c.seq from public.cases c where c.id = h.case_id),
          'client_name', (
            select p.full_name from public.case_parties cp join public.people p on p.id = cp.person_id
            where cp.case_id = h.case_id and cp.role = 'claimant' order by cp.created_at limit 1
          ),
          'proceeding_id', h.proceeding_id,
          'cnj', pr.cnj,
          'court', pr.court,
          'comarca', pr.comarca,
          'proceeding_kind', pr.kind,
          -- How its event stands in the firm's calendar: written, being written, or given up.
          'calendar_state', case
            when calendar.org_id is null or calendar.status <> 'active' then null
            -- Nothing of it is or will be there: cancelled before any calendar had it, or taken out already.
            when h.status = 'cancelled' and (h.synced_calendar is null
                 or (h.synced_revision = h.revision and h.synced_calendar = calendar.calendar_id)) then null
            when h.synced_revision = h.revision and h.synced_calendar = calendar.calendar_id then 'synced'
            -- Of the past and never in this calendar: history, which the calendar does not take.
            when h.synced_calendar is distinct from calendar.calendar_id
                 and h.starts_at < now() - make_interval(days => past) then null
            when h.sync_error is not null and h.sync_attempts >= tries and h.sync_claimed_at is null then 'failed'
            else 'pending'
          end,
          'created_by', h.created_by,
          'created_at', h.created_at,
          'created_auto', h.created_auto,
          -- The court took back a publication that answers for the hearing and nobody said they saw it: it may no longer be.
          'publication_cancel_pending', public.hearing_publication_cancelled(h.id, h.publication_id)
        ) order by pg.position)
        from page pg
        join public.hearings h on h.id = pg.id
        join public.proceedings pr on pr.id = h.proceeding_id
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.firm_hearings(uuid, text, integer, integer, uuid, text) from public, anon;
grant execute on function public.firm_hearings(uuid, text, integer, integer, uuid, text) to authenticated;

-- ---------- The conversations and the answers of the AI of a module ----------

/**
 * Whether a contact of the firm's WhatsApp is somebody of a case of a module: a person of the firm whose phone is
 * the contact's (with or without the ninth digit, `wa_phone_variants`) and who is in a case of the module. A
 * person with cases in two modules is of both. For the functions below, which read as their owner.
 */
create or replace function public.conversation_in_module(target_org uuid, target_contact text, target_module text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.people p
    join public.case_parties cp on cp.person_id = p.id
    join public.cases k on k.id = cp.case_id
    where p.org_id = target_org and p.phone is not null
      and p.phone = any (public.wa_phone_variants(target_contact))
      and k.module = target_module
  );
$$;

revoke all on function public.conversation_in_module(uuid, text, text) from public, anon, authenticated;

/**
 * Whether what a run of the AI is about is of a module: a document, an account of what happened, a piece or a
 * publication of a case of the module, or a conversation whose contact is somebody of a case of it. A run about
 * nothing of a case (the platform's check, a model of the library) is of no module.
 */
create or replace function public.ai_run_in_module(target_run uuid, target_module text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1 from public.ai_runs r
    cross join lateral (
      select case when r.subject_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then r.subject_id::uuid end as subject
    ) s
    where r.id = target_run and s.subject is not null and (
      (r.subject_type = 'case_document' and exists (
        select 1 from public.case_documents d
        where d.id = s.subject and d.org_id = r.org_id and public.case_in_module(d.case_id, target_module)))
      or (r.subject_type = 'case_statement' and exists (
        select 1 from public.case_statements t
        where t.id = s.subject and t.org_id = r.org_id and public.case_in_module(t.case_id, target_module)))
      or (r.subject_type = 'case_draft' and exists (
        select 1 from public.case_drafts d
        where d.id = s.subject and d.org_id = r.org_id and public.case_in_module(d.case_id, target_module)))
      or (r.subject_type = 'publication' and exists (
        select 1 from public.publications p
        where p.id = s.subject and p.org_id = r.org_id and public.case_in_module(p.case_id, target_module)))
      or (r.subject_type = 'wa_conversation' and exists (
        select 1 from public.wa_conversations w
        where w.id = s.subject and w.org_id = r.org_id
          and public.conversation_in_module(w.org_id, w.contact_wa_id, target_module)))
    )
  );
$$;

revoke all on function public.ai_run_in_module(uuid, text) from public, anon, authenticated;

/**
 * The firm's conversations of a module, the latest first: the ones whose contact is somebody of a case of the
 * module. A conversation of nobody's case yet is read with every module only. For anybody of the firm.
 */
create or replace function public.firm_module_conversations(
  target_org uuid,
  target_module text,
  target_limit integer default 60
)
returns uuid[]
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_module is null then
    raise exception 'invalid_module' using errcode = '22023';
  end if;
  return coalesce((
    select array_agg(w.id order by w.last_message_at desc nulls last, w.id)
    from (
      select c.id, c.last_message_at from public.wa_conversations c
      where c.org_id = target_org and public.conversation_in_module(c.org_id, c.contact_wa_id, target_module)
      order by c.last_message_at desc nulls last, c.id
      limit least(greatest(coalesce(target_limit, 60), 1), 200)
    ) w
  ), '{}'::uuid[]);
end;
$$;

revoke all on function public.firm_module_conversations(uuid, text, integer) from public, anon;
grant execute on function public.firm_module_conversations(uuid, text, integer) to authenticated;

/**
 * The answers of the AI of a module, as the firm's queue reads them: the ones that wait (the oldest first, with
 * how many wait in all) or the ones decided (the latest first). An answer is of a module when what it is about
 * is (`ai_run_in_module`). For anybody of the firm: what each person may decide is the queue's, as before.
 */
create or replace function public.firm_module_approvals(
  target_org uuid,
  target_module text,
  target_decided boolean default false,
  target_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  size integer := least(greatest(coalesce(target_limit, 50), 1), 200);
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_module is null then
    raise exception 'invalid_module' using errcode = '22023';
  end if;
  if coalesce(target_decided, false) then
    return jsonb_build_object('ids', coalesce((
      select jsonb_agg(d.id order by d.decided_at desc nulls last, d.id)
      from (
        select a.id, a.decided_at from public.approvals a
        where a.org_id = target_org and a.status in ('approved', 'rejected', 'returned')
          and public.ai_run_in_module(a.run_id, target_module)
        order by a.decided_at desc nulls last, a.id
        limit size
      ) d
    ), '[]'::jsonb));
  end if;
  return (
    with waiting as (
      select a.id, a.created_at from public.approvals a
      where a.org_id = target_org and a.status = 'pending' and public.ai_run_in_module(a.run_id, target_module)
    )
    select jsonb_build_object(
      'total', (select count(*) from waiting),
      'ids', coalesce((
        select jsonb_agg(w.id order by w.created_at, w.id)
        from (select * from waiting order by created_at, id limit size) w
      ), '[]'::jsonb)
    )
  );
end;
$$;

revoke all on function public.firm_module_approvals(uuid, text, boolean, integer) from public, anon;
grant execute on function public.firm_module_approvals(uuid, text, boolean, integer) to authenticated;
