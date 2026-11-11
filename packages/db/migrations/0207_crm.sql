-- ============================================================
-- 0207 · The CRM of the attendance (M4, sprint S11): where a lead came from,
-- and the lead who stopped answering.
--
-- An ad on Facebook or Instagram that opens a WhatsApp conversation ("click
-- to WhatsApp") sends, with the person's first message, which ad it was
-- (Meta's `referral`). The backend keeps the first of a conversation
-- (`wa_conversations.ad_referral`: the kind of source, its id, its address,
-- its headline and the click's id; nothing of the person), says so in the
-- conversation (`came_from_ad`), and a case the
-- conversation's intake opens (0176) is of the origin `ads`, unless the person
-- said who referred them (0183), whose word comes first.
--
-- A lead ONE is interviewing on WhatsApp (an intake under way: it told a
-- problem and ONE asked what is missing) who stops answering is followed up
-- by ONE in the same conversation, inside the 24 hours, at the setting's
-- hours after ONE's question (`crm.followup_hours`, 3 and 20: two at most per
-- silence), never to who asked to stop, never where a person of the firm
-- holds the conversation or the firm keeps ONE's answers to a person; the
-- count starts over when the person writes again. The words are the app's
-- (the question still missing, said again), written as ONE's message.
-- ============================================================

insert into public.platform_settings (key, value)
values ('crm', jsonb_build_object('followup_hours', jsonb_build_array(3, 20)))
on conflict (key) do nothing;

alter table public.wa_conversations add column ad_referral jsonb;
alter table public.wa_conversations add column ad_referral_at timestamptz;
alter table public.wa_conversations add column followups integer not null default 0;
alter table public.wa_conversations add column followup_at timestamptz;
alter table public.wa_conversations add constraint wa_conversations_ad_referral_check check (
  ad_referral is null or (jsonb_typeof(ad_referral) = 'object' and octet_length(ad_referral::text) <= 2000)
);
alter table public.wa_conversations add constraint wa_conversations_followups_check check (followups >= 0);
alter table public.wa_conversation_events drop constraint wa_conversation_events_kind_check;
alter table public.wa_conversation_events add constraint wa_conversation_events_kind_check check (kind in (
  'case_opened', 'link_sent', 'person_called', 'taken_over', 'returned_to_one', 'declined', 'stopped',
  'document_joined', 'statement_joined', 'not_qualified', 'lead_followup', 'came_from_ad'
));

/**
 * The backend keeps the ad a conversation came from (the first one), as Meta's `referral` says it: the kind of
 * source, its id, its address, its headline and the click's id, each cleaned. Answers whether it kept it.
 */
create or replace function public.wa_record_ad_referral(target_conversation uuid, target_referral jsonb)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  clean jsonb;
  source_url text := nullif(btrim(coalesce(target_referral ->> 'source_url', '')), '');
begin
  if target_referral is null or jsonb_typeof(target_referral) <> 'object' then
    return false;
  end if;
  clean := jsonb_strip_nulls(jsonb_build_object(
    'source_type', case when target_referral ->> 'source_type' in ('ad', 'post') then target_referral ->> 'source_type' end,
    'source_id', left(nullif(btrim(coalesce(target_referral ->> 'source_id', '')), ''), 64),
    'source_url', case when source_url ~* '^https?://' then left(source_url, 500) end,
    'headline', left(nullif(btrim(coalesce(target_referral ->> 'headline', '')), ''), 200),
    'ctwa_clid', left(nullif(btrim(coalesce(target_referral ->> 'ctwa_clid', '')), ''), 200)
  ));
  if clean = '{}'::jsonb then
    return false;
  end if;
  update public.wa_conversations set ad_referral = clean, ad_referral_at = now()
  where id = target_conversation and ad_referral is null;
  if not found then
    return false;
  end if;
  -- The conversation says where the person came from, by the ad's headline.
  insert into public.wa_conversation_events (org_id, conversation_id, kind, data, actor_type)
  select wc.org_id, wc.id, 'came_from_ad', jsonb_strip_nulls(jsonb_build_object('reason', clean ->> 'headline')), 'system'
  from public.wa_conversations wc where wc.id = target_conversation;
  return true;
end;
$$;

revoke all on function public.wa_record_ad_referral(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.wa_record_ad_referral(uuid, jsonb) to service_role;

/** The case an intake opens is of the origin `ads` when its conversation came from an ad and nobody referred the person. */
create or replace function public.wa_conversations_ad_case()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.intake_case_id is not null and old.intake_case_id is null and new.ad_referral is not null
     and not (new.intake ? 'indicado_por') then
    update public.cases set origin = 'ads'
    where id = new.intake_case_id and (origin is null or origin = 'organic');
  end if;
  return null;
end;
$$;

revoke all on function public.wa_conversations_ad_case() from public, anon, authenticated;

create trigger wa_conversations_ad_case after update of intake_case_id on public.wa_conversations
  for each row execute function public.wa_conversations_ad_case();

/** A person who writes again starts the count of follow-ups over. */
create or replace function public.wa_messages_reset_followups()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.direction = 'in' then
    update public.wa_conversations set followups = 0, followup_at = null
    where id = new.conversation_id and followups > 0;
  end if;
  return null;
end;
$$;

revoke all on function public.wa_messages_reset_followups() from public, anon, authenticated;

create trigger wa_messages_reset_followups after insert on public.wa_messages
  for each row execute function public.wa_messages_reset_followups();

/**
 * The leads ONE owes a follow-up (the backend's): an intake under way on WhatsApp (a problem told, no case opened and
 * no word that it does not qualify) in a conversation ONE holds, as the firm lets ONE answer, inside the 24 hours,
 * whose last message is ONE's and is older than the setting's hours for the next follow-up, never to who asked to stop.
 */
create or replace function public.lead_followups_owed(target_limit integer default 20)
returns table (conversation_id uuid, org_id uuid, followups integer, intake jsonb, contact_name text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hours integer[] := coalesce(
    (select array_agg(x::integer order by ord) from public.platform_settings s,
       jsonb_array_elements_text(s.value -> 'followup_hours') with ordinality as t(x, ord)
     where s.key = 'crm'),
    array[3, 20]
  );
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select wc.id, wc.org_id, wc.followups, wc.intake, wc.contact_name
  from public.wa_conversations wc
  join public.wa_numbers n on n.id = wc.number_id and n.status = 'active'
  where wc.agent = 'one'
    and wc.intake_at is not null and wc.intake_case_id is null and wc.intake_person_id is null
    and wc.intake ? 'problema'
    and wc.followups < coalesce(array_length(hours, 1), 0)
    and wc.last_message_direction = 'out'
    and wc.last_message_at <= now() - make_interval(hours => hours[wc.followups + 1])
    and public.wa_window_open(wc.last_inbound_at)
    and public.firm_autonomy_mode(wc.org_id, 'reply_client') <> 'approval'
    and not exists (select 1 from public.wa_optouts x
                    where x.org_id = wc.org_id and x.contact_wa_id = wc.contact_wa_id)
  order by wc.last_message_at
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.lead_followups_owed(integer) from public, anon, authenticated;
grant execute on function public.lead_followups_owed(integer) to service_role;

/**
 * ONE follows the lead up in the conversation, with the app's words: only while it is still owed (checked again under
 * the conversation's lock), counted, and never twice for the same silence.
 */
create or replace function public.one_lead_followup(target_conversation uuid, target_body text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  message uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.lead_followups_owed(100) o where o.conversation_id = target_conversation) then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  select * into conversation from public.wa_conversations where id = target_conversation for update;
  begin
    message := public.one_message(conversation, target_body, null, null);
  exception when sqlstate 'P0001' then
    return jsonb_build_object('ok', false, 'code', sqlerrm);
  end;
  update public.wa_conversations set followups = followups + 1, followup_at = now() where id = conversation.id;
  insert into public.wa_conversation_events (org_id, conversation_id, kind, data, actor_type)
  values (conversation.org_id, conversation.id, 'lead_followup', jsonb_build_object('count', conversation.followups + 1), 'system');
  return jsonb_build_object('ok', true, 'code', 'queued', 'message_id', message);
end;
$$;

revoke all on function public.one_lead_followup(uuid, text) from public, anon, authenticated;
grant execute on function public.one_lead_followup(uuid, text) to service_role;
