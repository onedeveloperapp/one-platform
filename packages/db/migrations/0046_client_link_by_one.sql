-- ============================================================
-- 0046_client_link_by_one: ONE sends the client's link by itself.
--
-- A case opened by a person waited for that person to remember the client's
-- link (0022): until somebody sent it, the client could send nothing. ONE now
-- sends it, as the firm lets it (`send_client_link`, ONE by default; the
-- adjustments before the tests, item 6, approved by the owner on 2026-10-22):
-- while a case is being gathered (`intake`, `documents`, `signature`), each
-- adult of it who never had a link of that case is sent one in the
-- conversation they have with the firm's WhatsApp, while it is inside the 24
-- hours after their last message. The link is made as a person makes it
-- (`create_client_link`, which now says in the timeline who made it) and its
-- message goes through the outbox of 0019, once.
--
-- ONE sends nothing it could not stand behind: never a second link to a
-- person of a case who ever had one (a link a person ended stays ended),
-- never to who asked to stop, never through a number whose connection
-- failed, never a template (outside the 24 hours WhatsApp takes only a model
-- the vendor approved, which waits for the platform's app at Meta). What ONE
-- cannot send is said, with why, in the firm's center of what waits
-- (`firm_pending.links_owed`) and on the case (`case_links_owed`): no mobile
-- on record, no WhatsApp of the firm connected, a person who never wrote to
-- it or last wrote more than 24 hours ago, one who asked to stop, a firm that
-- sends its links itself, or a link ONE should have sent by now. A client who
-- writes again wakes the case (`wa_conversations_wake_links`), and ONE sends
-- it then.
-- ============================================================

insert into public.autonomy_decisions (key, position, modes) values
  ('send_client_link', 5, array['auto', 'approval'])
on conflict (key) do nothing;

-- How long ONE may take to send a link it can send before the firm is told it did not.
update public.platform_settings
set value = value || jsonb_build_object('link_late_minutes', 30)
where key = 'pending' and not (value ? 'link_late_minutes');

-- ---------- A link says who made it ----------

/**
 * Gives a client their way in (replaces the one of 0038, the same but for
 * who the timeline says made it): a link for one person of one case. The
 * app mints the token and hands only its SHA-256 here. A new link for the
 * same person and case ends the ones before it. Never for a minor: the
 * person who answers for them gets it. A link of a case the court already
 * has lasts the setting's longer time. ONE makes one through its own
 * function for the case it names (`advance_send_client_link`), and the
 * timeline then says it was ONE.
 */
create or replace function public.create_client_link(target_case uuid, target_person uuid, target_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype := public.case_for_writer(target_case);
  person public.people%rowtype;
  link uuid;
  filed boolean := exists (
    select 1 from public.proceedings pr where pr.case_id = current_case.id and pr.status = 'filed'
  );
  ends timestamptz := now() + make_interval(days => greatest(coalesce(
    case when filed
      then (public.cases_setting('client_link_days_filed') #>> '{}')::integer
      else (public.cases_setting('client_link_days') #>> '{}')::integer
    end,
    case when filed then 180 else 30 end), 1));
begin
  if target_token_hash is null or target_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  select * into person from public.people p
  where p.id = target_person and p.org_id = current_case.org_id
    and exists (select 1 from public.case_parties cp where cp.case_id = current_case.id and cp.person_id = p.id);
  if not found then
    return jsonb_build_object('ok', false, 'code', 'person_not_found');
  end if;
  if person.birth_date is not null and person.birth_date > (current_date - interval '18 years')::date then
    return jsonb_build_object('ok', false, 'code', 'minor_cannot_receive');
  end if;
  if current_case.status in ('closed', 'declined') then
    return jsonb_build_object('ok', false, 'code', 'case_closed');
  end if;

  update public.client_links set revoked_at = now(), revoked_by = auth.uid()
  where case_id = current_case.id and person_id = person.id and revoked_at is null and expires_at > now();

  insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at, created_by)
  values (current_case.org_id, current_case.id, person.id, target_token_hash, ends, auth.uid())
  returning id into link;

  perform public.record_case_event(current_case.org_id, current_case.id, 'client_link_created',
    public.case_actor(current_case.id), jsonb_build_object('link', link, 'person', person.id));
  return jsonb_build_object('ok', true, 'code', 'created', 'link_id', link, 'expires_at', ends);
end;
$$;

revoke all on function public.create_client_link(uuid, uuid, text) from public, anon;
grant execute on function public.create_client_link(uuid, uuid, text) to authenticated;

-- ---------- Who is owed a link, and whether ONE can send it ----------

/**
 * The adults of a firm's cases being gathered (`intake`, `documents`,
 * `signature`) who never had a link of their case, each with the
 * conversation ONE would send it in and why ONE cannot, or null when it can
 * now. An adult is who answers for a minor, or a claimant nobody answers for
 * whose birth date does not make them a minor. The conversation is the one
 * the person last wrote in, of a number of the firm that is active and whose
 * connection holds. In the order the reasons are said:
 *
 *   by_person        the firm sends its links itself (`send_client_link`);
 *   no_phone         the person has no mobile on record;
 *   no_number        the firm has no WhatsApp connected;
 *   no_conversation  the person never wrote to the firm's WhatsApp;
 *   opted_out        the person asked the firm to stop;
 *   window_closed    their last message is more than 24 hours old.
 *
 * `since` is when the person joined the case. One case (`target_case`) or
 * every case of the firm. Read by the backend and by the firm's screens
 * through their own functions; no API role calls it.
 */
create or replace function public.client_link_reach(target_org uuid, target_case uuid default null)
returns table (
  case_id uuid,
  seq integer,
  person_id uuid,
  full_name text,
  conversation_id uuid,
  reason text,
  since timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with owed as (
    select k.id as case_id, k.seq, p.id as person_id, p.full_name, p.phone, min(cp.created_at) as since
    from public.cases k
    join public.case_parties cp on cp.case_id = k.id
    join public.people p on p.id = cp.person_id
    where k.org_id = target_org and (target_case is null or k.id = target_case)
      and k.status in ('intake', 'documents', 'signature')
      and (cp.role = 'guardian' or (cp.role = 'claimant' and cp.guardian_id is null))
      and not (p.birth_date is not null and p.birth_date > (current_date - interval '18 years')::date)
      and not exists (select 1 from public.client_links l where l.case_id = k.id and l.person_id = p.id)
    group by k.id, k.seq, p.id, p.full_name, p.phone
  ),
  firm as (
    select
      public.firm_autonomy_mode(target_org, 'send_client_link') = 'auto' as by_one,
      exists (
        select 1 from public.wa_numbers n
        join public.connections cn on cn.id = n.connection_id and cn.status = 'connected'
        where n.org_id = target_org and n.status = 'active'
      ) as connected
  )
  select o.case_id, o.seq, o.person_id, o.full_name, talk.id,
    case
      when not f.by_one then 'by_person'
      when o.phone is null then 'no_phone'
      when not f.connected then 'no_number'
      when talk.id is null then 'no_conversation'
      when exists (
        select 1 from public.wa_optouts x
        where x.org_id = target_org and x.contact_wa_id = any (public.wa_phone_variants(o.phone))
      ) then 'opted_out'
      when not public.wa_window_open(talk.last_inbound_at) then 'window_closed'
    end,
    o.since
  from owed o
  cross join firm f
  left join lateral (
    select wc.id, wc.last_inbound_at from public.wa_conversations wc
    join public.wa_numbers n on n.id = wc.number_id and n.status = 'active'
    join public.connections cn on cn.id = n.connection_id and cn.status = 'connected'
    where wc.org_id = target_org and o.phone is not null
      and wc.contact_wa_id = any (public.wa_phone_variants(o.phone))
    order by wc.last_inbound_at desc nulls last, wc.last_message_at desc nulls last, wc.id
    limit 1
  ) talk on true;
$$;

revoke all on function public.client_link_reach(uuid, uuid) from public, anon, authenticated;

/** Whether ONE can send somebody of a case their link now. */
create or replace function public.case_advance_link_due(target_case uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.cases k
    cross join lateral public.client_link_reach(k.org_id, k.id) r
    where k.id = target_case and r.reason is null
  );
$$;

revoke all on function public.case_advance_link_due(uuid) from public, anon, authenticated;

/**
 * Who of a case ONE can send a link now, with what the message names: their
 * name and the firm's. For the worker that holds the claim; service role
 * only.
 */
create or replace function public.advance_client_links(target_case uuid, target_claim integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.case_advance_held(target_case, target_claim) then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  return jsonb_build_object(
    'ok', true,
    'firm', (select o.name from public.organizations o where o.id = current_case.org_id),
    'people', coalesce((
      select jsonb_agg(jsonb_build_object('person_id', r.person_id, 'full_name', r.full_name) order by r.since, r.person_id)
      from public.client_link_reach(current_case.org_id, current_case.id) r
      where r.reason is null
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.advance_client_links(uuid, integer) from public, anon, authenticated;

/**
 * ONE sends one person of a case their link (decision `send_client_link`):
 * under the case's own lock, it checks again that the person is owed a link
 * and ONE can send it now, makes the link through `create_client_link` (the
 * app minted the token and hands its SHA-256) and writes its message, which
 * the app wrote around the token, to the outbox in the conversation the
 * person last wrote in. The message is ONE's (no person sent it), and the
 * conversation still waits for the firm's answer when the client wrote last.
 * Answers the message to send, or why nothing was. For the worker that holds
 * the claim; service role only.
 */
create or replace function public.advance_send_client_link(
  target_case uuid,
  target_claim integer,
  target_person uuid,
  target_token_hash text,
  target_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  reach record;
  conversation public.wa_conversations%rowtype;
  body text := nullif(btrim(coalesce(target_body, '')), '');
  made jsonb;
  message uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.case_advance_held(target_case, target_claim) then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if body is null or char_length(body) > 4096 then
    return jsonb_build_object('ok', false, 'code', 'invalid_body');
  end if;

  perform set_config('one.system_case', target_case::text, true);
  current_case := public.case_for_writer(target_case);

  select * into reach from public.client_link_reach(current_case.org_id, current_case.id) r
  where r.person_id = target_person;
  if not found then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  if reach.reason is not null then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', reach.reason);
  end if;

  -- The conversation, held and read again: a message the person sent meanwhile only keeps it open.
  select * into conversation from public.wa_conversations wc where wc.id = reach.conversation_id for update;
  if not found or not public.wa_window_open(conversation.last_inbound_at) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'window_closed');
  end if;

  made := public.create_client_link(current_case.id, target_person, target_token_hash);
  if not coalesce((made ->> 'ok')::boolean, false) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', coalesce(made ->> 'code', 'failed'));
  end if;

  insert into public.wa_messages (org_id, conversation_id, number_id, direction, origin, kind, body, status)
  values (conversation.org_id, conversation.id, conversation.number_id, 'out', 'cloud', 'text', body, 'queued')
  returning id into message;

  -- What the client wrote last still waits for the firm: ONE's message answers nothing of it.
  update public.wa_conversations set
    last_message_at = now(),
    last_message_preview = public.wa_preview('text', body),
    last_message_direction = 'out'
  where id = conversation.id
    and not (last_message_direction = 'in' and last_inbound_at is not null and last_inbound_at >= last_message_at);

  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message, 'link_id', made ->> 'link_id');
end;
$$;

revoke all on function public.advance_send_client_link(uuid, integer, uuid, text, text) from public, anon, authenticated;

-- ---------- The sweep takes a case owed a link ----------

/**
 * Claims the cases ONE may carry on now (replaces the one of 0039, adding a
 * link ONE can send: `link_due`), under a number each, the one that waits
 * the longest first: one named (`target_case`, what the app tells of)
 * whatever its wait, the others once their wait is over. Each case is locked
 * on its own as it is looked at, and one with nothing for ONE to do is set
 * aside for the setting's wait, and what it waited for is forgotten (nothing
 * for ONE to do is nothing to wait for). Answers the cases claimed, each
 * with whether sending a link, creating its lawsuits or asking for a package
 * is what to look at, and how many were set aside (more may be due behind
 * them). Service role only.
 */
create or replace function public.claim_case_advances(target_limit integer default 10, target_case uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  stale integer := greatest(public.case_advance_setting('stale_minutes', 15), 1);
  wait integer := greatest(public.case_advance_setting('wait_minutes', 360), 1);
  scan integer := least(greatest(public.case_advance_setting('scan', 200), 1), 2000);
  wanted integer := greatest(least(coalesce(target_limit, 10), 50), 1);
  claimed jsonb := '[]'::jsonb;
  parked integer := 0;
  candidate uuid;
  link boolean;
  lawsuits boolean;
  package boolean;
  claims_now integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  for candidate in
    select a.case_id from public.case_advances a
    where (target_case is null or a.case_id = target_case)
      and (target_case is not null or coalesce(a.after, a.created_at) <= now())
      and (a.claimed_at is null or a.claimed_at < now() - make_interval(mins => stale))
    order by coalesce(a.after, a.created_at), a.case_id
    limit case when target_case is null then scan else 1 end
  loop
    -- Locked one at a time, and read again under the lock: another worker may have taken it meanwhile.
    perform 1 from public.case_advances a
    where a.case_id = candidate
      and (target_case is not null or coalesce(a.after, a.created_at) <= now())
      and (a.claimed_at is null or a.claimed_at < now() - make_interval(mins => stale))
    for update skip locked;
    if not found then
      continue;
    end if;
    link := public.case_advance_link_due(candidate);
    lawsuits := public.case_advance_lawsuits_due(candidate);
    package := public.case_advance_package_due(candidate);
    if link or lawsuits or package or public.case_advance_steps_due(candidate) then
      update public.case_advances a set claimed_at = clock_timestamp(), claims = a.claims + 1
      where a.case_id = candidate
      returning a.claims into claims_now;
      claimed := claimed || jsonb_build_array(jsonb_build_object(
        'case_id', candidate, 'claim', claims_now, 'link_due', link, 'lawsuits_due', lawsuits, 'package_due', package));
      exit when jsonb_array_length(claimed) >= wanted;
    else
      -- A case set aside for good (it ended, or is with the court) stays so.
      update public.case_advances a
      set after = greatest(coalesce(a.after, '-infinity'::timestamptz), now() + make_interval(mins => wait)),
          waiting = null, checked_at = now(), claimed_at = null, attempts = 0
      where a.case_id = candidate;
      parked := parked + 1;
    end if;
  end loop;
  return jsonb_build_object('claimed', claimed, 'parked', parked);
end;
$$;

revoke all on function public.claim_case_advances(integer, uuid) from public, anon, authenticated;

-- ---------- What wakes a case owed a link ----------

/**
 * A client wrote to the firm's WhatsApp: the cases being gathered where a
 * person of that number is owed a link are looked at again, so ONE sends it
 * while the 24 hours are open. Taken in the order of their ids, as every
 * wake of many cases is.
 */
create or replace function public.wa_conversations_wake_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.last_inbound_at is null
     or (tg_op = 'UPDATE' and new.last_inbound_at is not distinct from old.last_inbound_at) then
    return null;
  end if;
  update public.case_advances a
  set after = null, woken_at = clock_timestamp()
  where a.case_id in (
    select b.case_id from public.case_advances b
    where b.org_id = new.org_id and b.after is distinct from 'infinity'::timestamptz
      and b.case_id in (
        select k.id from public.people p
        join public.case_parties cp on cp.person_id = p.id
        join public.cases k on k.id = cp.case_id
        where p.org_id = new.org_id and p.phone = any (public.wa_phone_variants(new.contact_wa_id))
          and k.status in ('intake', 'documents', 'signature')
          and not exists (select 1 from public.client_links l where l.case_id = k.id and l.person_id = p.id)
      )
    order by b.case_id
    for update
  );
  return null;
end;
$$;

revoke all on function public.wa_conversations_wake_links() from public, anon, authenticated;

create trigger wa_conversations_wake_links after insert or update of last_inbound_at on public.wa_conversations
  for each row execute function public.wa_conversations_wake_links();

/**
 * The cases a client who just wrote may now be sent a link in, ONE sending
 * the firm's links: the ones the trigger above woke, named so the app asks
 * for them at once instead of at the next sweep. The backend's; no API role
 * calls it.
 */
create or replace function public.wa_contact_link_cases(target_org uuid, target_contact text)
returns uuid[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(array_agg(distinct k.id order by k.id), '{}'::uuid[])
  from public.people p
  join public.case_parties cp on cp.person_id = p.id
  join public.cases k on k.id = cp.case_id
  where p.org_id = target_org and p.phone = any (public.wa_phone_variants(target_contact))
    and k.status in ('intake', 'documents', 'signature')
    and not exists (select 1 from public.client_links l where l.case_id = k.id and l.person_id = p.id)
    and public.firm_autonomy_mode(target_org, 'send_client_link') = 'auto';
$$;

revoke all on function public.wa_contact_link_cases(uuid, text) from public, anon, authenticated;

/** What a firm chose changed: its cases are looked at again (replaces the one of 0039, with the link). */
create or replace function public.firm_autonomy_wakes_advance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.decision in ('send_client_link', 'create_lawsuits', 'start_piece', 'request_package', 'file_or_hold') then
    update public.case_advances a
    set after = null, woken_at = clock_timestamp(), waiting = null
    where a.case_id in (
      select b.case_id from public.case_advances b
      where b.org_id = new.org_id and b.after is distinct from 'infinity'::timestamptz
      order by b.case_id
      for update
    );
  end if;
  return null;
end;
$$;

revoke all on function public.firm_autonomy_wakes_advance() from public, anon, authenticated;

-- ---------- What the firm reads ----------

/**
 * The people of a case who are owed a link, and why ONE has not sent it:
 * one of the reasons of `client_link_reach`, `sending` while ONE may still
 * send it, or `late` once it should have. For anybody of the firm.
 */
create or replace function public.case_links_owed(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  late integer := greatest(public.pending_setting('link_late_minutes', 30), 1);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'person_id', r.person_id,
      'reason', coalesce(r.reason, case when r.since < now() - make_interval(mins => late) then 'late' else 'sending' end)
    ) order by r.since, r.person_id)
    from public.client_link_reach(current_case.org_id, current_case.id) r
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.case_links_owed(uuid) from public, anon;
grant execute on function public.case_links_owed(uuid) to authenticated;

/**
 * What waits for somebody of the firm (replaces the one of 0044, adding the
 * links ONE did not send): `links_owed` lists, the oldest first, each person
 * of a case being gathered who never had a link that ONE cannot send (with
 * why) or should have sent by now (`late`), and `links_owed_total` counts
 * them. The rest as in 0044.
 */
create or replace function public.firm_pending(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  document_hours integer := greatest(public.pending_setting('documents_stale_hours', 24), 1);
  waits_days integer := greatest(public.pending_setting('one_waits_stale_days', 2), 1);
  list_size integer := least(greatest(public.pending_setting('list_size', 20), 1), 100);
  late integer := greatest(public.pending_setting('link_late_minutes', 30), 1);
  links jsonb;
  links_total integer;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  with owed as (
    select r.case_id, r.seq, r.person_id, r.full_name, r.since,
           coalesce(r.reason, 'late') as reason
    from public.client_link_reach(target_org, null) r
    where r.reason is not null or r.since < now() - make_interval(mins => late)
  )
  select
    coalesce((
      select jsonb_agg(x.item order by x.since, x.seq)
      from (
        select o.since, o.seq, jsonb_build_object(
          'case_id', o.case_id,
          'seq', o.seq,
          'person_id', o.person_id,
          'client', o.full_name,
          'reason', o.reason,
          'since', o.since
        ) as item
        from owed o
        order by o.since, o.seq
        limit list_size
      ) x
    ), '[]'::jsonb),
    (select count(*)::integer from owed)
  into links, links_total;

  return jsonb_build_object(
    'one_waits', coalesce((
      select jsonb_agg(w.item order by w.since nulls last, w.seq)
      from (
        select
          a.waiting_since as since,
          c.seq,
          jsonb_build_object(
            'case_id', c.id,
            'seq', c.seq,
            -- The case is named as its list names it (0033): its first adult claimant, or who answers for a minor.
            'client', coalesce((
              select p.full_name from public.case_parties cp
              join public.people p on p.id = cp.person_id
              where cp.case_id = c.id
              order by (cp.role = 'claimant' and cp.guardian_id is null) desc, (cp.role = 'guardian') desc,
                       cp.created_at, cp.id
              limit 1
            ), ''),
            'waiting', a.waiting,
            'since', a.waiting_since
          ) as item
        from public.case_advances a
        join public.cases c on c.id = a.case_id
        where a.org_id = target_org and a.waiting is not null and a.waiting not in ('unavailable', 'held')
          and c.status not in ('closed', 'declined')
        order by a.waiting_since nulls last, c.seq
        limit list_size
      ) w
    ), '[]'::jsonb),
    'one_waits_total', (
      select count(*) from public.case_advances a
      join public.cases c on c.id = a.case_id
      where a.org_id = target_org and a.waiting is not null and a.waiting not in ('unavailable', 'held')
        and c.status not in ('closed', 'declined')
    ),
    'one_waits_stale', (
      select count(*) from public.case_advances a
      join public.cases c on c.id = a.case_id
      where a.org_id = target_org and a.waiting is not null and a.waiting not in ('unavailable', 'held')
        and c.status not in ('closed', 'declined')
        and a.waiting_since < now() - make_interval(days => waits_days)
    ),
    'links_owed', links,
    'links_owed_total', links_total,
    'deadlines_overdue', coalesce((
      select jsonb_agg(x.item order by x.urgent_on, x.title)
      from (
        select
          u.urgent_on,
          d.title,
          jsonb_build_object(
            'deadline_id', d.id,
            'case_id', d.case_id,
            'seq', (select c.seq from public.cases c where c.id = d.case_id),
            'title', d.title,
            'cnj', d.cnj,
            'due_on', u.urgent_on
          ) as item
        from public.deadlines d
        cross join lateral (
          select public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
            d.confirmed_against) as urgent_on
        ) u
        where d.org_id = target_org and d.status in ('proposed', 'confirmed') and u.urgent_on < today
        order by u.urgent_on, d.title
        limit list_size
      ) x
    ), '[]'::jsonb),
    'deadlines_today', (
      select count(*) from public.deadlines d
      where d.org_id = target_org and d.status in ('proposed', 'confirmed')
        and public.deadline_urgent_on(d.status, d.due_on, d.computed_due_on, d.computed_revision, d.revision,
          d.confirmed_against) = today
    ),
    'hearings_today', (
      select count(*) from public.hearings h
      where h.org_id = target_org and h.status = 'scheduled'
        and (h.starts_at at time zone h.time_zone)::date = (now() at time zone h.time_zone)::date
    ),
    'documents_stale', (
      select count(*) from public.case_documents d
      where d.org_id = target_org and d.status = 'received'
        and d.created_at < now() - make_interval(hours => document_hours)
    ),
    'documents_stale_hours', document_hours,
    'one_waits_stale_days', waits_days
  );
end;
$$;

revoke all on function public.firm_pending(uuid) from public, anon;
grant execute on function public.firm_pending(uuid) to authenticated;
