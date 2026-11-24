-- ============================================================
-- Filing by hand, with ONE's guide (0269): the third of the three ways to
-- file on a court's screen (the owner, 2026-11-20; root CLAUDE.md, "Three
-- ways to file"), completed. The lawyer files in the court's system with
-- their own login, with ONE's package and ONE's guide:
--
--   * the guide's sheet: what the court's screen asks, step by step, each
--     value ready to copy, read from the case for a package ready to file
--     (`filing_package_sheet`): the lawsuit, its claimants with their
--     address and contact, who answers for a minor, the airline that answers
--     in court, the lawyers, the files, and the codes of the CNJ's unified
--     tables for the class and the subjects (`platform_settings.tpu`);
--   * where a court's screen refuses a claimant with no e-mail and mobile
--     (`court_screen_systems.asks_contact`): the eproc of TJSP, by its
--     manual for lawyers "Da distribuição de inicial" (13/04/2026 and
--     20/07/2026: "obrigatoriamente o(s) endereço(s) e contato (e-mail e
--     celular)", the step blocked without them) and its notes of version
--     9.19. 0283 asks them of the client;
--   * a package ready for days with nothing filed is said to the lawyers of
--     its lawsuit: a line of the center (`firm_filing_attention`, redefined
--     from 0102, `waiting`) once it waits the setting's days, and a reminder
--     on the bell and on their WhatsApp, as the firm's template of a new
--     kind for the team (`filing_waits`, as 0188's), at most the setting's
--     rounds, each the setting's days after the last
--     (`filing_waits_owed`, `reserve_filing_waits`,
--     `filing_waits_reminders`). A package ONE files, or about to (a
--     submission of any channel), one outdated, or one something holds is
--     nobody's to file now and is never said.
-- ============================================================

-- ---------- Where a court's screen asks each claimant's contact ----------

alter table public.court_screen_systems add column asks_contact boolean not null default false;

update public.court_screen_systems set asks_contact = true, updated_at = now() where key = 'eproc-tjsp';

-- ---------- The codes of the CNJ's unified tables a petition of the passenger module names ----------

-- The classes (436 Procedimento do Juizado Especial Cível, 7 Procedimento Comum Cível), the subject of each problem
-- (4829 Atraso de vôo, 4830 Cancelamento de vôo, 4831 Overbooking, 4832 Extravio de bagagem: TJSP's table of the
-- subjects of its airport small-claims court, from the TPU of July 2022, and 0101 from the CNJ's SGT on 2026-10-14)
-- and the moral damage each lawsuit adds (7779 Indenização por Dano Moral). A problem with no code here is named by
-- its words, never by a code guessed.
insert into public.platform_settings (key, value, is_public) values
  ('tpu', jsonb_build_object(
     'classes', jsonb_build_object('juizado', 436, 'comum', 7),
     'subjects', jsonb_build_object('delay', 4829, 'cancellation', 4830, 'overbooking', 4831, 'baggage_lost', 4832),
     'moral', 7779),
   false)
on conflict (key) do nothing;

-- How long a package waits before it is said, how far apart the reminders go, and how many (`pending_setting`).
update public.platform_settings
set value = jsonb_build_object('filing_waits_days', 2, 'filing_waits_again_days', 5, 'filing_waits_rounds', 3) || value,
    updated_at = now()
where key = 'pending';

-- ---------- The sheet of a package ----------

/**
 * What the court's screen asks to file a package ready to file (0269), for the guide of who files it by hand: the
 * lawsuit (its kind, court, system, comarca, unit, the Valor da Causa Pedido of its claimants, the problem, the
 * codes of the class and of the subjects), the court's screen as the platform knows it (its name, its address, how
 * a lawyer signs in, whether it asks each claimant's contact), each claimant in the order of the case with their
 * address, contact, free justice and who answers for a minor, the airline that answers in court with its address,
 * the lawyers of the lawsuit with their registration, and the files in order. Null for a package not ready.
 * Anybody of the firm: the case's people are theirs to read on the case already.
 */
create or replace function public.filing_package_sheet(target_package uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  package public.filing_packages%rowtype;
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  court_row public.courts%rowtype;
  screen public.court_screen_systems%rowtype;
  tpu jsonb := coalesce((select s.value from public.platform_settings s where s.key = 'tpu'), '{}'::jsonb);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into package from public.filing_packages where id = target_package;
  if not found or not public.is_org_member(package.org_id) then
    raise exception 'package_not_found' using errcode = 'P0002';
  end if;
  if package.status <> 'ready' then
    return null;
  end if;
  select * into lawsuit from public.proceedings where id = package.proceeding_id;
  select * into current_case from public.cases where id = package.case_id;
  select * into court_row from public.courts where acronym = package.court;
  select * into screen from public.court_screen_systems where court = package.court and system = package.system;
  return jsonb_build_object(
    'package_id', package.id,
    'kind', package.kind,
    'court', package.court,
    'court_state', court_row.uf,
    'system', package.system,
    'screen', case when screen.key is null then null else jsonb_build_object(
      'key', screen.key, 'name', screen.name, 'host', screen.host, 'login_kind', screen.login_kind,
      'asks_contact', screen.asks_contact) end,
    'comarca', lawsuit.comarca,
    'unit', lawsuit.unit,
    'incident', current_case.incident,
    'value_cents', (
      select sum(cp.claim_cents) from public.proceeding_parties pp
      join public.case_parties cp on cp.id = pp.party_id
      where pp.proceeding_id = lawsuit.id and cp.claim_cents is not null),
    'codes', jsonb_build_object(
      'class', tpu #> array['classes', package.kind],
      'subject', tpu #> array['subjects', coalesce(current_case.incident, '')],
      'moral', tpu -> 'moral'),
    'claimants', coalesce((
      select jsonb_agg(jsonb_build_object(
        'party_id', cp.id,
        'name', p.full_name, 'cpf', p.cpf, 'birth_date', p.birth_date,
        'street', p.street, 'number', p.address_number, 'complement', p.complement, 'district', p.district,
        'city', p.city, 'state', p.uf, 'zip', p.postal_code,
        'email', p.email, 'phone', p.phone,
        'free_justice', (
          select a.asks from public.free_justice_answers a where a.party_id = cp.id and a.replaced_at is null),
        'guardian', (
          select jsonb_build_object('name', gp.full_name, 'cpf', gp.cpf, 'email', gp.email, 'phone', gp.phone)
          from public.case_parties g join public.people gp on gp.id = g.person_id
          where g.id = cp.guardian_id)
      ) order by cp.created_at, cp.id)
      from public.proceeding_parties pp
      join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
      join public.people p on p.id = cp.person_id
      where pp.proceeding_id = lawsuit.id
    ), '[]'::jsonb),
    'defendant', (
      select jsonb_build_object('name', coalesce(a.legal_name, a.name), 'cnpj', a.cnpj, 'address', a.address)
      from public.airlines a where a.iata = current_case.airline_iata),
    'lawyers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', pl.user_id,
        'name', coalesce(pr.display_name, ''),
        'oab', (
          select jsonb_build_object('uf', r.uf, 'number', r.number) from public.oab_registrations r
          where r.user_id = pl.user_id
          order by (r.uf = court_row.uf) desc, (r.kind = 'principal') desc, r.id
          limit 1)
      ) order by pr.display_name, pl.user_id)
      from public.proceeding_lawyers pl join public.profiles pr on pr.id = pl.user_id
      where pl.proceeding_id = lawsuit.id
    ), '[]'::jsonb),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', i.position, 'name', i.name, 'part', i.part, 'parts', i.parts,
        'document_kind', case when i.document_id = package.petition_document_id then 'petition' else d.kind end
      ) order by i.position)
      from public.filing_package_items i
      left join public.case_documents d on d.id = i.document_id
      where i.package_id = package.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.filing_package_sheet(uuid) from public, anon;
grant execute on function public.filing_package_sheet(uuid) to authenticated;

-- ---------- The packages that wait for somebody to file them ----------

/**
 * The packages ready to file that nobody files (0269): ready, of a lawsuit still planned in a case in course, with
 * no submission of ONE's (by the court's channel, ONE's browser or a lawyer's extension), not outdated and held by
 * nothing (`filing_blocker`), built the setting's days ago or more; in one firm, or in every firm. Internal.
 */
create or replace function public.filing_packages_waiting(target_org uuid default null)
returns table (
  package_id uuid, org_id uuid, case_id uuid, proceeding_id uuid, seq integer, court text, system text,
  since timestamptz, is_test boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.org_id, p.case_id, p.proceeding_id, k.seq, p.court, p.system,
         coalesce(p.built_at, p.requested_at), coalesce(k.is_test, false)
  from public.filing_packages p
  join public.proceedings pr on pr.id = p.proceeding_id and pr.status = 'planned'
  join public.cases k on k.id = p.case_id and k.status not in ('closed', 'declined')
  where p.status = 'ready'
    and (target_org is null or p.org_id = target_org)
    and coalesce(p.built_at, p.requested_at)
        <= now() - make_interval(days => greatest(public.pending_setting('filing_waits_days', 2), 1))
    and not exists (select 1 from public.filing_submissions s where s.package_id = p.id)
    and not public.filing_package_outdated(p)
    and public.filing_blocker(p.proceeding_id) is null;
$$;

revoke all on function public.filing_packages_waiting(uuid) from public, anon, authenticated;

/**
 * What ONE's filing waits on a person for, in a firm (replaces 0102's): as there, `signatures` and `filings`
 * (with `filings_total`), and `waiting` (0269): each package ready to file that nobody files, the setting's days
 * after it was built, the oldest first, with its case, its court's system, since when, and the lawyers of its
 * lawsuit (a partner or a lawyer of the firm), with `waiting_total`. Anybody of the firm.
 */
create or replace function public.firm_filing_attention(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  list_size integer := least(greatest(public.pending_setting('list_size', 20), 1), 100);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'signatures', coalesce((
      select jsonb_agg(row_to_json(x)::jsonb order by x.seq, x.user_id)
      from (
        select pl.user_id,
               coalesce(pr.display_name, '') as name,
               count(distinct a.proceeding_id)::integer as lawsuits,
               count(distinct a.case_id)::integer as cases,
               min(a.seq) as seq,
               (array_agg(a.case_id order by a.seq, a.case_id))[1] as case_id,
               case
                 when not exists (select 1 from public.lawyer_cpfs lc where lc.user_id = pl.user_id) then 'cpf_missing'
                 when exists (
                   select 1 from public.connections c
                   where c.person_id = pl.user_id and c.org_id = target_org and c.status in ('connected', 'error')
                     and c.expires_at > now()
                 ) then 'expiring'
                 else 'none'
               end as state,
               (select max(c.expires_at) from public.connections c
                where c.person_id = pl.user_id and c.org_id = target_org and c.status in ('connected', 'error')
                  and c.expires_at > now()) as expires_at
        from public.lawsuits_awaiting_signature(target_org) a
        join public.proceeding_lawyers pl on pl.proceeding_id = a.proceeding_id
        join public.memberships m
          on m.org_id = target_org and m.user_id = pl.user_id and m.firm_function in ('socio', 'advogado')
        join public.profiles pr on pr.id = pl.user_id
        group by pl.user_id, pr.display_name
      ) x
    ), '[]'::jsonb),
    'filings', coalesce((
      select jsonb_agg(row_to_json(y)::jsonb order by y.since, y.submission_id)
      from (
        select s.id as submission_id, s.case_id, k.seq, s.status, s.error, s.updated_at as since
        from public.filing_submissions s
        join public.cases k on k.id = s.case_id
        where s.org_id = target_org and k.status not in ('closed', 'declined')
          and (s.status in ('refused', 'failed', 'unknown')
               or (s.status = 'filed' and s.error in ('number_missing', 'number_refused')
                   and exists (select 1 from public.filing_packages p where p.id = s.package_id and p.status = 'ready')))
        order by s.updated_at, s.id
        limit list_size
      ) y
    ), '[]'::jsonb),
    'filings_total', (
      select count(*) from public.filing_submissions s
      join public.cases k on k.id = s.case_id
      where s.org_id = target_org and k.status not in ('closed', 'declined')
        and (s.status in ('refused', 'failed', 'unknown')
             or (s.status = 'filed' and s.error in ('number_missing', 'number_refused')
                 and exists (select 1 from public.filing_packages p where p.id = s.package_id and p.status = 'ready')))
    ),
    'waiting', coalesce((
      select jsonb_agg(row_to_json(w)::jsonb order by w.since, w.package_id)
      from (
        select f.package_id, f.case_id, f.seq, f.court, f.system, f.since,
               (select s.name from public.court_screen_systems s
                where s.court = f.court and s.system = f.system) as system_name,
               coalesce((
                 select jsonb_agg(pl.user_id order by pl.user_id)
                 from public.proceeding_lawyers pl
                 join public.memberships m
                   on m.org_id = target_org and m.user_id = pl.user_id and m.firm_function in ('socio', 'advogado')
                 where pl.proceeding_id = f.proceeding_id
               ), '[]'::jsonb) as lawyers
        from public.filing_packages_waiting(target_org) f
        order by f.since, f.package_id
        limit list_size
      ) w
    ), '[]'::jsonb),
    'waiting_total', (select count(*) from public.filing_packages_waiting(target_org))
  );
end;
$$;

revoke all on function public.firm_filing_attention(uuid) from public, anon;
grant execute on function public.firm_filing_attention(uuid) to authenticated;

-- ---------- The reminder to the lawyers of a lawsuit ----------

alter table public.notice_kinds drop constraint notice_kinds_kind_check;
alter table public.notice_kinds add constraint notice_kinds_kind_check check (kind in (
  'hearing_reminder', 'hearing_change', 'lawsuit_update', 'payment_alert', 'document_refused', 'flight_problem',
  'case_received', 'lawsuit_filed', 'case_questions', 'trip_departure', 'trip_arrival', 'welcome',
  'hearing_brief', 'hearing_result', 'hearing_outcome', 'filing_waits'
));

insert into public.notice_kinds (kind, position, template_base, body, footer, params, examples) values
  ('filing_waits', 16, 'one_protocolo_pendente',
   'Olá, {{1}}. {{2}} está pronta para protocolar no {{3}} desde {{4}}. O pacote, a ficha com cada dado e os passos estão no caso.',
   'Mensagem para a equipe do escritório.',
   array['first_name', 'what', 'court', 'moment'],
   array['Ana', 'A ação do caso 12', 'eproc do TJSP', 'sexta-feira, 20 de novembro'])
on conflict (kind) do nothing;

-- The test chats on now get the new kind too (0055).
do $$
declare
  chat record;
begin
  for chat in select c.org_id, c.number_id from public.test_chats c where c.status = 'active' loop
    perform public.test_chat_templates(chat.org_id, chat.number_id);
  end loop;
end;
$$;

create table public.filing_waits_reminders (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  package_id uuid not null references public.filing_packages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  round smallint not null,
  -- The WhatsApp written to, when the lawyer has one.
  phone text,
  -- sent     the firm's template went to the lawyer's WhatsApp (the bell rings either way);
  -- skipped  it could not go, and why: no WhatsApp, a request to stop, no template, no number.
  status text not null,
  reason text,
  message_id uuid references public.wa_messages (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (package_id, user_id, round),
  constraint filing_waits_reminders_round_check check (round between 1 and 20),
  constraint filing_waits_reminders_phone_check check (phone is null or phone ~ '^[0-9]{12,15}$'),
  constraint filing_waits_reminders_status_check check (status in ('sent', 'skipped')),
  constraint filing_waits_reminders_reason_check check ((status = 'skipped') = (reason is not null)
    and (reason is null or reason ~ '^[a-z][a-z_]{2,40}$'))
);

create index filing_waits_reminders_org_idx on public.filing_waits_reminders (org_id, created_at desc);

alter table public.filing_waits_reminders enable row level security;
create policy "filing_waits_reminders_select_member" on public.filing_waits_reminders
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.filing_waits_reminders to authenticated;
create trigger guard_impersonation_filing_waits_reminders after insert or update or delete on public.filing_waits_reminders
  for each statement execute function public.guard_impersonation_readonly();

/**
 * The reminders owed now (0269): for each package that waits (`filing_packages_waiting`) and each lawyer of its
 * lawsuit (a partner or a lawyer of the firm), the next round, when fewer than the setting's rounds went and the
 * last went the setting's days ago or more; the oldest package first. With what the reminder says. Service role.
 */
create or replace function public.filing_waits_owed(target_limit integer default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rounds integer := least(greatest(public.pending_setting('filing_waits_rounds', 3), 0), 20);
  again integer := greatest(public.pending_setting('filing_waits_again_days', 5), 1);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(row_to_json(o)::jsonb order by o.since, o.package_id, o.user_id)
    from (
      select w.package_id, w.org_id, w.case_id, w.seq, w.court, w.system, w.since, w.is_test,
             (select s.name from public.court_screen_systems s where s.court = w.court and s.system = w.system)
               as system_name,
             pl.user_id,
             coalesce(pr.display_name, '') as name,
             coalesce((select max(r.round) from public.filing_waits_reminders r
                       where r.package_id = w.package_id and r.user_id = pl.user_id), 0) + 1 as round
      from public.filing_packages_waiting(null) w
      join public.proceeding_lawyers pl on pl.proceeding_id = w.proceeding_id
      join public.memberships m
        on m.org_id = w.org_id and m.user_id = pl.user_id and m.firm_function in ('socio', 'advogado')
      join public.profiles pr on pr.id = pl.user_id
      where (select count(*) from public.filing_waits_reminders r
             where r.package_id = w.package_id and r.user_id = pl.user_id) < rounds
        and not exists (
          select 1 from public.filing_waits_reminders r
          where r.package_id = w.package_id and r.user_id = pl.user_id
            and r.created_at > now() - make_interval(days => again)
        )
      order by w.since, w.package_id, pl.user_id
      limit greatest(least(coalesce(target_limit, 50), 200), 1)
    ) o
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.filing_waits_owed(integer) from public, anon, authenticated;
grant execute on function public.filing_waits_owed(integer) to service_role;

/**
 * Keeps a round of the reminder of a package that waits to a lawyer of its lawsuit (0269), once per package, lawyer
 * and round, and writes it to their WhatsApp as the firm's template of `filing_waits`; what cannot go there is kept as
 * skipped with why, and the bell rings all the same. A package that no longer waits, or a person who is no longer a
 * lawyer of its lawsuit, keeps nothing. Answers the message queued, for the outbox. Service role.
 */
create or replace function public.reserve_filing_waits(
  target_package uuid,
  target_user uuid,
  target_round integer,
  target_params text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  package public.filing_packages%rowtype;
  current_case public.cases%rowtype;
  notice public.notice_kinds%rowtype;
  template public.wa_templates%rowtype;
  sender public.wa_numbers%rowtype;
  phone text;
  conversation uuid;
  message uuid;
  rendered text;
  skip text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into package from public.filing_packages where id = target_package for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if target_round is null or target_round < 1 or target_round > 20 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  if exists (
    select 1 from public.filing_waits_reminders r
    where r.package_id = package.id and r.user_id = target_user and r.round = target_round
  ) then
    return jsonb_build_object('ok', true, 'code', 'already');
  end if;
  if not exists (select 1 from public.filing_packages_waiting(package.org_id) w where w.package_id = package.id)
     or not exists (
       select 1 from public.proceeding_lawyers pl
       join public.memberships m
         on m.org_id = package.org_id and m.user_id = pl.user_id and m.firm_function in ('socio', 'advogado')
       where pl.proceeding_id = package.proceeding_id and pl.user_id = target_user
     ) then
    return jsonb_build_object('ok', true, 'code', 'not_waiting');
  end if;
  select * into current_case from public.cases where id = package.case_id;
  select p.whatsapp into phone from public.profiles p where p.id = target_user;
  select * into notice from public.notice_kinds k where k.kind = 'filing_waits';
  select t.* into template from public.wa_templates t
  join public.firm_notice_kinds k on k.template_id = t.id
  where k.org_id = package.org_id and k.kind = 'filing_waits' and k.enabled
    and t.status = 'approved' and t.category = 'utility';
  if found then
    select n.* into sender from public.wa_numbers n
    join public.connections cn on cn.id = n.connection_id and cn.status = 'connected'
    where n.org_id = package.org_id and n.waba_id = template.waba_id and n.status = 'active'
      and (n.provider = 'test') = (coalesce(current_case.is_test, false) and not public.is_test_firm(current_case.org_id))
    order by n.connected_at
    limit 1;
  end if;

  skip := case
    when phone is null then 'no_phone'
    when exists (
      select 1 from public.wa_optouts o
      where o.org_id = package.org_id and o.contact_wa_id = any (public.wa_phone_variants(phone))
    ) then 'opted_out'
    when template.id is null then 'no_template'
    when sender.id is null then 'no_number'
    when target_params is null or cardinality(target_params) <> cardinality(notice.params)
         or template.param_count <> cardinality(target_params)
         or array_position(target_params, null) is not null
         or exists (select 1 from unnest(target_params) as v(value)
                    where public.notice_value(v.value) is null or public.notice_value(v.value) <> v.value)
      then 'invalid_values'
  end;
  if skip is not null then
    insert into public.filing_waits_reminders (org_id, package_id, user_id, round, phone, status, reason)
    values (package.org_id, package.id, target_user, target_round, phone, 'skipped', skip)
    on conflict (package_id, user_id, round) do nothing
    returning id into message;
    if message is null then
      return jsonb_build_object('ok', true, 'code', 'already');
    end if;
    message := null;
    insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
    values (package.org_id, null, 'system', 'filing.reminded', 'filing_package', package.id::text,
            jsonb_build_object('user', target_user, 'round', target_round, 'whatsapp', skip));
    return jsonb_build_object('ok', true, 'code', 'skipped', 'reason', skip);
  end if;

  select wc.id into conversation from public.wa_conversations wc
  where wc.number_id = sender.id and wc.contact_wa_id = any (public.wa_phone_variants(phone))
  order by wc.last_inbound_at desc nulls last
  limit 1;
  if conversation is null then
    conversation := public.wa_open_conversation(package.org_id, sender.id, phone, null);
  end if;

  rendered := public.notice_rendered(template.body, target_params);
  insert into public.wa_messages (
    org_id, conversation_id, number_id, direction, origin, kind, body, template_id, template_name, template_params, status
  ) values (
    package.org_id, conversation, sender.id, 'out', 'cloud', 'template', rendered, template.id, template.name,
    to_jsonb(target_params), 'queued'
  )
  returning id into message;
  update public.wa_conversations set
    last_message_at = now(),
    last_message_preview = public.wa_preview('template', rendered),
    last_message_direction = 'out'
  where id = conversation
    and not (last_message_direction = 'in' and last_inbound_at is not null and last_inbound_at >= last_message_at);

  insert into public.filing_waits_reminders (org_id, package_id, user_id, round, phone, status, message_id)
  values (package.org_id, package.id, target_user, target_round, phone, 'sent', message);
  insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (package.org_id, null, 'system', 'filing.reminded', 'filing_package', package.id::text,
          jsonb_build_object('user', target_user, 'round', target_round, 'whatsapp', 'sent'));
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message, 'conversation_id', conversation);
end;
$$;

revoke all on function public.reserve_filing_waits(uuid, uuid, integer, text[]) from public, anon, authenticated;
grant execute on function public.reserve_filing_waits(uuid, uuid, integer, text[]) to service_role;
