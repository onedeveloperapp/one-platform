-- ============================================================
-- 0211 · The usage events in ONE's vocabulary (M5).
--
-- The vocabulary of 0007 was the platform layer's (the account, the firm,
-- the purchase of the previous product's ladder). ONE measures its own work:
-- a case opened (by ONE from a module, by a person, from an import), a case
-- closed, a lawsuit filed, a piece approved (by ONE or by a person), a
-- client's link finished, a conversation started and one that came from an
-- ad. Each is written by the database where the thing happens (a trigger on
-- its own row), so no screen has to remember to report it and none can
-- inflate it; the old names stay known for the rows already written.
--
-- Events, never content, as 0007 promised: the allowlist gains only closed
-- values (who did it, ONE or a person; the module by its slug; the kind of
-- lawsuit; whether the case is a test; where the case came from), never an
-- id, a name, a number or a text. A trigger never fails the write it
-- watches: an event that could not be written is dropped. Only the
-- operator reads them, as before.
-- ============================================================

create or replace function public.product_event_known(event_name text)
returns boolean
language sql
immutable
as $$
  select event_name in (
    'account.created',
    'firm.created',
    'invite.accepted',
    'checkout.started',
    'kit.purchased',
    'subscription.started',
    'subscription.cancel_requested',
    'subscription.canceled',
    'upsell.viewed',
    'upsell.clicked',
    'upsell.purchased',
    'waitlist.joined',
    'case.opened',
    'case.closed',
    'lawsuit.filed',
    'piece.approved',
    'client_link.finished',
    'conversation.started',
    'conversation.from_ad'
  );
$$;

revoke all on function public.product_event_known(text) from public, anon;
grant execute on function public.product_event_known(text) to authenticated;

create or replace function public.product_event_sanitize(target_event text, target_properties jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  props jsonb := coalesce(target_properties, '{}'::jsonb);
begin
  if jsonb_typeof(props) <> 'object' then
    return '{}'::jsonb;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'platform', case when props ->> 'platform' in ('web', 'server') then props ->> 'platform' end,
    'role', case when props ->> 'role' in ('owner', 'admin', 'member') then props ->> 'role' end,
    'firm_function', case
      when props ->> 'firm_function' in ('socio', 'advogado', 'controladoria', 'atendimento')
        then props ->> 'firm_function'
    end,
    'tier_from', case when props ->> 'tier_from' in ('none', 'kit', 'club', 'pro') then props ->> 'tier_from' end,
    'tier_to', case when props ->> 'tier_to' in ('none', 'kit', 'club', 'pro') then props ->> 'tier_to' end,
    'period', case when props ->> 'period' in ('once', 'monthly', 'yearly') then props ->> 'period' end,
    'offer', case when props ->> 'offer' in ('kit', 'club', 'pro') then props ->> 'offer' end,
    'reason', case
      when props ->> 'reason' in (
        'too_expensive', 'not_using', 'missing_tool', 'switched', 'technical', 'temporary', 'other',
        'member', 'admin', 'suspended', 'canceled', 'refund'
      ) then props ->> 'reason'
    end,
    'origin', case
      when props ->> 'origin' in ('home', 'billing', 'menu', 'checkout', 'email', 'site') then props ->> 'origin'
    end,
    'origem', case when lower(props ->> 'origem') ~ '^[a-z0-9][a-z0-9_-]{0,39}$' then lower(props ->> 'origem') end,
    -- ONE's own (0211): who did it, the module, the kind of lawsuit, a test, where a case came from.
    'by', case when props ->> 'by' in ('one', 'person') then props ->> 'by' end,
    'module', case when props ->> 'module' ~ '^[a-z][a-z0-9-]{1,39}$' then props ->> 'module' end,
    'kind', case when props ->> 'kind' in ('juizado', 'comum') then props ->> 'kind' end,
    'test', case when props ->> 'test' in ('true', 'false') then props ->> 'test' end,
    'case_origin', case
      when props ->> 'case_origin' in ('agency', 'referral', 'ads', 'organic', 'returning_client', 'other', 'none')
        then props ->> 'case_origin'
    end
  ));
end;
$$;

revoke all on function public.product_event_sanitize(text, jsonb) from public, anon, authenticated;

/** Writes one of ONE's events from a trigger, never failing the write it watches. */
create or replace function public.usage_event(target_org uuid, target_actor uuid, target_event text, target_properties jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.product_event_insert(target_actor, target_org, target_event, target_properties, null);
exception when others then
  null;
end;
$$;

revoke all on function public.usage_event(uuid, uuid, text, jsonb) from public, anon, authenticated;

create or replace function public.usage_events_cases()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.usage_event(new.org_id, new.created_by, 'case.opened', jsonb_build_object(
      'by', case when new.created_by is null then 'one' else 'person' end,
      'module', new.module, 'test', new.is_test::text, 'case_origin', coalesce(new.origin, 'none')));
  elsif new.status in ('closed', 'declined') and old.status not in ('closed', 'declined') then
    perform public.usage_event(new.org_id, auth.uid(), 'case.closed', jsonb_build_object(
      'by', case when new.closed_by_one then 'one' else 'person' end, 'module', new.module, 'test', new.is_test::text));
  end if;
  return null;
end;
$$;

revoke all on function public.usage_events_cases() from public, anon, authenticated;

create trigger usage_events_cases after insert or update of status on public.cases
  for each row execute function public.usage_events_cases();

create or replace function public.usage_events_proceedings()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  if new.filed_at is not null and old.filed_at is null then
    select cs.module, cs.is_test into c from public.cases cs where cs.id = new.case_id;
    perform public.usage_event(new.org_id, auth.uid(), 'lawsuit.filed', jsonb_build_object(
      'kind', new.kind, 'module', c.module, 'test', coalesce(c.is_test, false)::text));
  end if;
  return null;
end;
$$;

revoke all on function public.usage_events_proceedings() from public, anon, authenticated;

create trigger usage_events_proceedings after update of filed_at on public.proceedings
  for each row execute function public.usage_events_proceedings();

create or replace function public.usage_events_drafts()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select cs.module, cs.is_test into c from public.cases cs where cs.id = new.case_id;
    perform public.usage_event(new.org_id, new.approved_by, 'piece.approved', jsonb_build_object(
      'by', case when new.approved_by is null then 'one' else 'person' end,
      'module', c.module, 'test', coalesce(c.is_test, false)::text));
  end if;
  return null;
end;
$$;

revoke all on function public.usage_events_drafts() from public, anon, authenticated;

create trigger usage_events_drafts after update of status on public.case_drafts
  for each row execute function public.usage_events_drafts();

create or replace function public.usage_events_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
begin
  if new.finished_at is not null and old.finished_at is null then
    select cs.module, cs.is_test into c from public.cases cs where cs.id = new.case_id;
    perform public.usage_event(new.org_id, null, 'client_link.finished', jsonb_build_object(
      'module', c.module, 'test', coalesce(c.is_test, false)::text));
  end if;
  return null;
end;
$$;

revoke all on function public.usage_events_links() from public, anon, authenticated;

create trigger usage_events_links after update of finished_at on public.client_links
  for each row execute function public.usage_events_links();

create or replace function public.usage_events_conversations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.usage_event(new.org_id, null, 'conversation.started', '{}'::jsonb);
  elsif new.ad_referral is not null and old.ad_referral is null then
    perform public.usage_event(new.org_id, null, 'conversation.from_ad', '{}'::jsonb);
  end if;
  return null;
end;
$$;

revoke all on function public.usage_events_conversations() from public, anon, authenticated;

create trigger usage_events_conversations after insert or update of ad_referral on public.wa_conversations
  for each row execute function public.usage_events_conversations();
