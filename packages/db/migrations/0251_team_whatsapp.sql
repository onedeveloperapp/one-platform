-- ============================================================
-- Who goes to a hearing: the team's WhatsApp, and attendees from outside
-- the firm (0251). The owner, 2026-11-14:
--
--   * the firm has one WhatsApp connected, its main number, which ONE uses
--     as the firm's contact; nobody else of the team connects theirs
--     (`register_wa_number` refuses a second real number, redefined from
--     0221);
--   * each person of the team says their own WhatsApp in their setup, which
--     is required: by it they are linked to a hearing and report it (0187,
--     0247); it is never the firm's own number nor a colleague's
--     (`set_my_whatsapp`, redefined from 0187);
--   * who goes to a hearing with no account in ONE (an attendee the firm
--     hires) reports it too, and the firm keeps them in a list of its own
--     (`hearing_contacts`): chosen for a hearing where the firm takes notice
--     of it, or added there with their name and WhatsApp, and offered for
--     the next ones. A hearing keeps who it was chosen for
--     (`hearings.attendee_contact_id`); the name and the WhatsApp ONE
--     writes to and knows the report by stay on the hearing, as since 0187.
-- ============================================================

-- ---------- The firm's attendees from outside ----------

create table public.hearing_contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  phone text not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, org_id),
  unique (org_id, phone),
  constraint hearing_contacts_name_check check (name = btrim(name) and char_length(name) between 2 and 120),
  constraint hearing_contacts_phone_check check (phone ~ '^[0-9]{12,13}$')
);

alter table public.hearing_contacts enable row level security;
revoke all on table public.hearing_contacts from public, anon, authenticated;
create policy "hearing_contacts_select_member" on public.hearing_contacts
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.hearing_contacts to authenticated;
create trigger guard_impersonation_hearing_contacts after insert or update or delete on public.hearing_contacts
  for each statement execute function public.guard_impersonation_readonly();

alter table public.hearings add column attendee_contact_id uuid;
alter table public.hearings add constraint hearings_attendee_contact_fkey
  foreign key (attendee_contact_id, org_id) references public.hearing_contacts (id, org_id)
  on delete set null (attendee_contact_id);
create index hearings_attendee_contact_idx on public.hearings (attendee_contact_id) where attendee_contact_id is not null;

/** A WhatsApp as the firm writes it: digits, the country's 55 before a number of 10 or 11; null when it is none. */
create or replace function public.whatsapp_digits(target_phone text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when d is null then null
    when char_length(d) in (10, 11) then '55' || d
    else d
  end
  from (select nullif(regexp_replace(coalesce(target_phone, ''), '[^0-9]', '', 'g'), '') as d) x;
$$;

revoke all on function public.whatsapp_digits(text) from public, anon, authenticated;

/**
 * Why a WhatsApp is not one of the firm's people or attendees (0251): `firm_number` when it is the firm's own
 * connected number, `member_number` when somebody of the firm has it on their profile (`except_user` aside), null
 * otherwise. Internal.
 */
create or replace function public.firm_whatsapp_taken(target_org uuid, target_phone text, except_user uuid default null)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.wa_numbers n
      where n.org_id = target_org and n.status = 'active' and n.provider in ('meta', 'openwa')
        and n.display_phone_number = any (public.wa_phone_variants(target_phone))
    ) then 'firm_number'
    when exists (
      select 1 from public.memberships m join public.profiles p on p.id = m.user_id
      where m.org_id = target_org and p.whatsapp = any (public.wa_phone_variants(target_phone))
        and m.user_id is distinct from except_user
    ) then 'member_number'
  end;
$$;

revoke all on function public.firm_whatsapp_taken(uuid, text, uuid) from public, anon, authenticated;

/**
 * Somebody of the firm keeps an attendee from outside in the firm's list (0251): their name and WhatsApp, the same
 * WhatsApp brought back with the new name when it was there. Never the firm's own number nor a colleague's. Answers
 * the attendee's id. Never a support visit.
 */
create or replace function public.save_hearing_contact(target_org uuid, target_name text, target_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  label text := nullif(btrim(regexp_replace(coalesce(target_name, ''), '\s+', ' ', 'g')), '');
  digits text := public.whatsapp_digits(target_phone);
  taken text;
  contact_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if label is null or char_length(label) not between 2 and 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'name');
  end if;
  if digits is null or digits !~ '^[0-9]{12,13}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone', 'field', 'phone');
  end if;
  taken := public.firm_whatsapp_taken(target_org, digits);
  if taken is not null then
    return jsonb_build_object('ok', false, 'code', taken, 'field', 'phone');
  end if;
  insert into public.hearing_contacts as c (org_id, name, phone, created_by)
  values (target_org, label, digits, auth.uid())
  on conflict (org_id, phone) do update set name = excluded.name, archived_at = null
  returning c.id into contact_id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id)
  values (target_org, auth.uid(), 'hearing_contact.saved', 'hearing_contact', contact_id::text);
  return jsonb_build_object('ok', true, 'code', 'saved', 'id', contact_id);
end;
$$;

revoke all on function public.save_hearing_contact(uuid, text, text) from public, anon;
grant execute on function public.save_hearing_contact(uuid, text, text) to authenticated;

/** Somebody of the firm takes an attendee out of the list (0251); the hearings they were chosen for keep them. */
create or replace function public.archive_hearing_contact(target_contact uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  contact public.hearing_contacts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  select * into contact from public.hearing_contacts where id = target_contact for update;
  if not found or not public.is_org_member(contact.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if contact.archived_at is not null then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  update public.hearing_contacts set archived_at = now() where id = contact.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id)
  values (contact.org_id, auth.uid(), 'hearing_contact.archived', 'hearing_contact', contact.id::text);
  return jsonb_build_object('ok', true, 'code', 'archived');
end;
$$;

revoke all on function public.archive_hearing_contact(uuid) from public, anon;
grant execute on function public.archive_hearing_contact(uuid) to authenticated;

/**
 * Who goes to a hearing stays tied to the firm's list (0251): an attendee chosen from it writes their name and
 * WhatsApp on the hearing; a name and a WhatsApp written on a hearing (the form's "Outra pessoa", 0187) join the list
 * and the hearing points to them; a colleague, or nobody, points to none. A WhatsApp of the firm's own or of a
 * colleague never joins the list. Internal.
 */
create or replace function public.hearings_attendee_contact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  contact public.hearing_contacts%rowtype;
begin
  if new.attendee_user_id is not null or (new.attendee_name is null and new.attendee_phone is null) then
    new.attendee_contact_id := null;
    return new;
  end if;
  if new.attendee_contact_id is not null
     and (tg_op = 'INSERT' or new.attendee_contact_id is distinct from old.attendee_contact_id) then
    select * into contact from public.hearing_contacts c where c.id = new.attendee_contact_id and c.org_id = new.org_id;
    if found then
      new.attendee_name := contact.name;
      new.attendee_phone := contact.phone;
      return new;
    end if;
    new.attendee_contact_id := null;
  end if;
  if new.attendee_phone is null then
    -- A name with no WhatsApp: nobody of the list.
    new.attendee_contact_id := null;
    return new;
  end if;
  select * into contact from public.hearing_contacts c where c.org_id = new.org_id and c.phone = new.attendee_phone;
  if found then
    new.attendee_contact_id := contact.id;
  elsif new.attendee_name is not null and char_length(new.attendee_name) between 2 and 120
        and public.firm_whatsapp_taken(new.org_id, new.attendee_phone) is null then
    insert into public.hearing_contacts (org_id, name, phone, created_by)
    values (new.org_id, new.attendee_name, new.attendee_phone, auth.uid())
    returning id into new.attendee_contact_id;
  else
    new.attendee_contact_id := null;
  end if;
  return new;
end;
$$;

revoke all on function public.hearings_attendee_contact() from public, anon, authenticated;

create trigger hearings_attendee_contact
  before insert or update of attendee_user_id, attendee_name, attendee_phone, attendee_contact_id on public.hearings
  for each row execute function public.hearings_attendee_contact();

/**
 * Who goes to a hearing, said where the firm takes notice of it (0251): a colleague, an attendee of the firm's list,
 * or nobody yet. Whoever writes the case's hearings. Never a support visit.
 */
create or replace function public.set_hearing_attendee(target_hearing uuid, target_user uuid, target_contact uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  hearing public.hearings%rowtype;
  current_case public.cases%rowtype;
  contact public.hearing_contacts%rowtype;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if target_user is not null and target_contact is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  select * into hearing from public.hearings where id = target_hearing for update;
  if not found or hearing.case_id is null or not public.is_org_member(hearing.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(hearing.case_id);
  if hearing.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'code', 'not_scheduled');
  end if;
  if target_user is not null and not exists (
    select 1 from public.memberships m where m.org_id = hearing.org_id and m.user_id = target_user
  ) then
    return jsonb_build_object('ok', false, 'code', 'not_found', 'field', 'attendee');
  end if;
  if target_contact is not null then
    select * into contact from public.hearing_contacts c
    where c.id = target_contact and c.org_id = hearing.org_id and c.archived_at is null;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found', 'field', 'attendee');
    end if;
  end if;
  if hearing.attendee_user_id is not distinct from target_user
     and hearing.attendee_contact_id is not distinct from target_contact
     and (target_user is not null or target_contact is not null
          or (hearing.attendee_name is null and hearing.attendee_phone is null)) then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  update public.hearings set
    attendee_user_id = target_user,
    attendee_contact_id = target_contact,
    attendee_name = case when target_contact is not null then contact.name end,
    attendee_phone = case when target_contact is not null then contact.phone end
  where id = hearing.id;
  perform public.record_case_event(hearing.org_id, hearing.case_id, 'hearing_attendee_set', 'person',
    jsonb_build_object('hearing', hearing.id, 'attendee', target_user, 'contact', target_contact));
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (hearing.org_id, auth.uid(), 'hearing.attendee_set', 'hearing', hearing.id::text,
          jsonb_build_object('attendee', target_user, 'contact', target_contact));
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_hearing_attendee(uuid, uuid, uuid) from public, anon;
grant execute on function public.set_hearing_attendee(uuid, uuid, uuid) to authenticated;

-- The attendees from outside already written on hearings join their firm's list.
update public.hearings h set attendee_phone = h.attendee_phone
where h.attendee_user_id is null and h.attendee_phone is not null and h.attendee_name is not null;

-- ---------- Each person's WhatsApp ----------

/**
 * A person says their own WhatsApp (replaces 0187's), for ONE to know their reports and link them to a hearing: never
 * the firm's own number nor one a colleague has (0251). Never a support visit.
 */
create or replace function public.set_my_whatsapp(target_phone text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  digits text := public.whatsapp_digits(target_phone);
  firm uuid := (select m.org_id from public.memberships m where m.user_id = auth.uid() limit 1);
  taken text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    raise exception 'not_allowed_in_support_session' using errcode = '42501';
  end if;
  if digits is not null and digits !~ '^[0-9]{12,13}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_phone');
  end if;
  if digits is not null and firm is not null then
    taken := public.firm_whatsapp_taken(firm, digits, auth.uid());
    if taken is not null then
      return jsonb_build_object('ok', false, 'code', taken);
    end if;
  end if;
  update public.profiles set whatsapp = digits where id = auth.uid();
  -- An attendee of the list who is a person of the firm now is the person, no longer an attendee from outside.
  if digits is not null and firm is not null then
    update public.hearing_contacts set archived_at = now()
    where org_id = firm and archived_at is null and phone = any (public.wa_phone_variants(digits));
  end if;
  return jsonb_build_object('ok', true, 'code', 'saved');
end;
$$;

revoke all on function public.set_my_whatsapp(text) from public, anon;
grant execute on function public.set_my_whatsapp(text) to authenticated;

-- ---------- One WhatsApp per firm ----------

/**
 * A number of the firm recorded once the vendor connected it (replaces 0221's): as there, and a second real number is
 * refused while the firm's main one is connected (0251). Service role.
 */
create or replace function public.register_wa_number(
  target_org uuid,
  target_connection uuid,
  target_provider text,
  target_phone_number_id text,
  target_waba_id text,
  target_display_phone_number text,
  target_verified_name text default null,
  target_mode text default 'cloud'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conn public.connections%rowtype;
  digits text := regexp_replace(coalesce(target_display_phone_number, ''), '\D', '', 'g');
  number_id uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  select * into conn from public.connections where id = target_connection and org_id = target_org;
  if not found or conn.provider <> 'whatsapp' then
    return jsonb_build_object('ok', false, 'code', 'connection_not_found');
  end if;
  if conn.status <> 'connected' then
    return jsonb_build_object('ok', false, 'code', 'connection_not_connected');
  end if;
  if exists (
    select 1 from public.wa_numbers n
    where n.provider = target_provider and n.phone_number_id = target_phone_number_id
      and n.status = 'active' and n.org_id <> target_org
  ) then
    return jsonb_build_object('ok', false, 'code', 'number_in_use');
  end if;
  -- The firm has one WhatsApp, its main number, ONE's contact (0251): nobody of the team connects another; a new
  -- number is connected once the one in use is disconnected.
  if target_provider in ('meta', 'openwa') and exists (
    select 1 from public.wa_numbers n
    where n.org_id = target_org and n.status = 'active' and n.provider in ('meta', 'openwa')
      and not (n.provider = target_provider and n.phone_number_id = target_phone_number_id)
  ) then
    return jsonb_build_object('ok', false, 'code', 'firm_has_number');
  end if;
  -- A firm's numbers are the vendor's or the simulator's and the test chat's, never both. An opt-out belongs
  -- to the firm, whatever number it was said to: with the two side by side, a simulated "voltar" would undo
  -- what a real person asked.
  if target_provider in ('simulator', 'test') and exists (
    select 1 from public.wa_numbers n where n.org_id = target_org and n.provider in ('meta', 'openwa')
  ) then
    return jsonb_build_object('ok', false, 'code',
      case when target_provider = 'test' then 'test_chat_not_allowed' else 'simulator_not_allowed' end);
  end if;

  select n.id into number_id from public.wa_numbers n
  where n.org_id = target_org and n.provider = target_provider and n.phone_number_id = target_phone_number_id
  order by n.created_at desc limit 1
  for update;

  if number_id is null then
    insert into public.wa_numbers (
      org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number, verified_name, mode
    ) values (
      target_org, target_connection, target_provider, target_phone_number_id, target_waba_id, digits,
      nullif(btrim(target_verified_name), ''), coalesce(target_mode, 'cloud')
    )
    returning id into number_id;
  else
    update public.wa_numbers set
      connection_id = target_connection,
      waba_id = target_waba_id,
      display_phone_number = digits,
      verified_name = nullif(btrim(target_verified_name), ''),
      mode = coalesce(target_mode, 'cloud'),
      status = 'active',
      disconnect_reason = null,
      disconnected_at = null,
      connected_at = now(),
      contacts_sync_requested_at = null,
      history_sync_requested_at = null,
      history_progress = null
    where id = number_id;
  end if;

  -- The firm's first real number ends its time on the simulator and the test chat, for good.
  if target_provider in ('meta', 'openwa') then
    update public.wa_numbers set
      status = 'disconnected', disconnect_reason = 'replaced_by_real_number', disconnected_at = now()
    where org_id = target_org and provider in ('simulator', 'test') and status = 'active';
    update public.test_chats set status = 'ended', ended_at = now(), ended_reason = 'replaced_by_real_number'
    where org_id = target_org and status = 'active';
  end if;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, conn.connected_by, 'whatsapp.number.connected', 'wa_number', number_id::text,
          jsonb_build_object('provider', target_provider, 'mode', coalesce(target_mode, 'cloud')));

  return jsonb_build_object('ok', true, 'code', 'registered', 'number_id', number_id);
end;
$$;

revoke all on function public.register_wa_number(uuid, uuid, text, text, text, text, text, text) from public, anon, authenticated;

-- ---------- The hearings as the firm's lists read them ----------

/** The firm's hearings (replaces 0078's): as there, with the attendee of the firm's list each was chosen for (0251). */
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
          'attendee_contact_id', h.attendee_contact_id,
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
