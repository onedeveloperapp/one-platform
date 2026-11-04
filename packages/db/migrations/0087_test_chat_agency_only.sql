-- ============================================================
-- 0087_test_chat_agency_only: the test chat is the agency's passenger's
-- only.
--
-- The owner, 2026-11-03: the test chat came with four ready passengers
-- (0047: a cancellation, a family, a connection, an international flight)
-- and a tab to follow a real flight (0051), beside the passenger an agency
-- registers with the test WhatsApp (0071, 0076). One of the ready ones bore
-- the same name as the agency's, and the test is the agency's: the owner
-- asked that the ready passengers go and that the test chat work only with
-- the passengers an agency registers at the test WhatsApp. A test chat
-- turned on brings no passenger of its own; the trips the test chats had
-- that no agency registered are deleted (a case one of them opened stays,
-- as the firm's record of its test). `seed_test_trips` stays, for the
-- database tests that use the ready trips as their scenes.
-- ============================================================

-- What no agency registered goes: the ready trips and the real flights the test chats followed.
delete from public.tracked_trips t where t.is_test and t.pax_trip_id is null;

/** 0047, redefined: turns the test chat on, with no passenger of its own: an agency's brings theirs. Service role. */
create or replace function public.start_test_chat(target_org uuid, target_number uuid, target_token text, target_by uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  chat uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.test_chat_keeper(target_org, target_by) then
    return jsonb_build_object('ok', false, 'code', 'not_authorized');
  end if;
  if target_token is null or target_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_token');
  end if;
  if not exists (
    select 1 from public.wa_numbers n
    where n.id = target_number and n.org_id = target_org and n.provider = 'test' and n.status = 'active'
  ) then
    return jsonb_build_object('ok', false, 'code', 'number_not_found');
  end if;
  perform 1 from public.organizations o where o.id = target_org for no key update;
  if exists (select 1 from public.test_chats c where c.org_id = target_org and c.status = 'active') then
    return jsonb_build_object('ok', false, 'code', 'already_on');
  end if;

  insert into public.test_chats (org_id, number_id, token, started_by)
  values (target_org, target_number, target_token, target_by)
  returning id into chat;
  perform public.test_chat_templates(target_org, target_number);

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, target_by, 'test_chat.started', 'test_chat', chat::text, jsonb_build_object('trips_made', 0));
  return jsonb_build_object('ok', true, 'code', 'started', 'chat_id', chat);
end;
$$;

revoke all on function public.start_test_chat(uuid, uuid, text, uuid) from public, anon, authenticated;
