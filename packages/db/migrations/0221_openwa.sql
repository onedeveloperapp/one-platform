-- A number connected through WhatsApp Web, by the platform's OpenWA (the owner, 2026-11-11): the unofficial way,
-- the firm's choice after accepting its risk, beside the official Cloud API. ONE stays the one that receives and
-- sends: OpenWA's deliveries come to ONE (`/api/webhooks/openwa`, signed with the platform's secret), and what is
-- sent goes through the same outbox and the same rules (`reserve_wa_send`: the 24 hours, the opt-outs, a support
-- visit), with no template, which WhatsApp Web does not have.
--
-- * `wa_numbers.provider` takes `openwa`: the number's `phone_number_id` and `waba_id` are its OpenWA session.
-- * A number of OpenWA is a real number: it ends the firm's simulator and test chat, as a number of Meta does, and
--   neither is taken beside it (`register_wa_number`); it counts among the firm's WhatsApp numbers (`usage_now`) and
--   for the test chat's card (`test_chat_link`). Each function is its latest version word for word, but for the
--   provider it names.
-- * `wa_sending_to`: OpenWA tells ONE of every message the number sent, its own included, and may tell it before
--   ONE recorded the id the send got back. While a message of ONE to that person is being sent, a message the
--   number sent is answered later (the delivery is taken again by OpenWA), so ONE's own is never read as the phone's.

alter table public.wa_numbers drop constraint wa_numbers_provider_check;
alter table public.wa_numbers add constraint wa_numbers_provider_check
  check (provider in ('meta', 'simulator', 'test', 'openwa'));

/**
 * Whether a message of the firm to a person is being sent on a number now, its id not recorded yet: claimed for
 * sending in the last two minutes. The backend's.
 */
create or replace function public.wa_sending_to(target_number uuid, target_contact text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.wa_messages m
    join public.wa_conversations c on c.id = m.conversation_id
    where m.number_id = target_number
      and m.direction = 'out'
      and m.status = 'sending'
      and m.wa_message_id is null
      and m.claimed_at > now() - interval '2 minutes'
      and c.contact_wa_id = any (public.wa_phone_variants(regexp_replace(coalesce(target_contact, ''), '\D', '', 'g')))
  );
$$;

revoke all on function public.wa_sending_to(uuid, text) from public, anon, authenticated;

-- From 0047: a number of OpenWA is real, as one of Meta.
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

-- From 0047.
create or replace function public.test_chat_link(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  chat public.test_chats%rowtype;
  keeper boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  keeper := public.test_chat_keeper(target_org, auth.uid()) and not public.is_impersonated();
  select * into chat from public.test_chats c where c.org_id = target_org and c.status = 'active';
  if not found then
    return jsonb_build_object(
      'on', false,
      'keeper', keeper,
      'real_number', exists (
        select 1 from public.wa_numbers n where n.org_id = target_org and n.provider in ('meta', 'openwa') and n.status = 'active'
      ),
      'ended_reason', (
        select c.ended_reason from public.test_chats c where c.org_id = target_org order by c.ended_at desc nulls last limit 1
      )
    );
  end if;
  return jsonb_build_object(
    'on', true,
    'keeper', keeper,
    'started_at', chat.started_at,
    'token', case when keeper then chat.token end
  );
end;
$$;

-- From 0202.
create or replace function public.usage_now(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'processos_ativos', (select count(*) from public.cases c
                         where c.org_id = target_org and c.status not in ('closed', 'declined') and not c.is_test),
    'assentos', (select count(*) from public.memberships m where m.org_id = target_org),
    'whatsapp_numeros', (select count(*) from public.wa_numbers n
                         where n.org_id = target_org and n.provider in ('meta', 'openwa') and n.status = 'active')
  );
$$;
