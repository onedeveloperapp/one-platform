-- ============================================================
-- 0020_firm_today: what a firm still has to set up, and what needs somebody
-- of the firm today.
--
-- Both are answers computed from the facts in the database on every call.
-- Nothing here is stored, so nothing here goes stale: the setup checklist
-- reflects what the firm has, not what somebody clicked, and the home counts
-- what is waiting now.
-- ============================================================

/**
 * What a firm has in place, as yes or no, for the setup checklist:
 *
 *   firm_document  the firm's CNPJ (or CPF) is recorded;
 *   oab            somebody of the firm has a registration at the bar;
 *   team           the firm has a second person, or an invitation waiting;
 *   whatsapp       the firm has a connected number.
 *
 * Only yes and no leave the function: it shows nobody's registration and no
 * invitation's address, which is why any person of the firm may ask.
 */
create or replace function public.firm_setup_facts(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'firm_document', exists (
      select 1 from public.organizations o where o.id = target_org and o.billing_cpf_cnpj is not null
    ),
    'oab', exists (
      select 1 from public.oab_registrations r
      join public.memberships m on m.user_id = r.user_id
      where m.org_id = target_org
    ),
    'team', (select count(*) from public.memberships m where m.org_id = target_org) > 1
      or exists (
        select 1 from public.firm_invitations i
        where i.org_id = target_org and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
      ),
    'whatsapp', exists (
      select 1 from public.wa_numbers n where n.org_id = target_org and n.status = 'active'
    )
  );
end;
$$;

revoke all on function public.firm_setup_facts(uuid) from public, anon;
grant execute on function public.firm_setup_facts(uuid) to authenticated;

/**
 * What needs somebody of the firm today, counted for the person who asks:
 *
 *   approvals_mine         answers of the AI waiting for a decision that this
 *                          person's function may make;
 *   approvals_waiting      every answer waiting in the firm's queue;
 *   conversations_waiting  conversations where the person wrote last, through
 *                          the platform, and nobody of the firm answered, on a
 *                          connected number. What came with the history of a
 *                          number, from before it was connected, waits for
 *                          nobody: it never opened a window to answer in;
 *   conversations_closing  of those, the ones whose 24-hour window is open
 *                          and ends within the configured hours;
 *   sends_failed           messages of the last day that did not go out;
 *   whatsapp               `active`, `disconnected` (the firm had a number and
 *                          has none connected now) or `none`.
 */
create or replace function public.firm_today(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  my_function public.firm_function;
  closing_hours integer := greatest(coalesce((public.wa_setting('closing_soon_hours') #>> '{}')::integer, 4), 1);
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select m.firm_function into my_function
  from public.memberships m where m.org_id = target_org and m.user_id = auth.uid();
  if not found then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'approvals_mine', (
      select count(*) from public.approvals a
      where a.org_id = target_org and a.status = 'pending' and my_function = any (a.approver_functions)
    ),
    'approvals_waiting', (
      select count(*) from public.approvals a where a.org_id = target_org and a.status = 'pending'
    ),
    'conversations_waiting', (
      select count(*) from public.wa_conversations c
      join public.wa_numbers n on n.id = c.number_id
      where c.org_id = target_org and c.status = 'open' and c.last_message_direction = 'in' and n.status = 'active'
        and c.last_inbound_at is not null and c.last_inbound_at >= c.last_message_at
    ),
    'conversations_closing', (
      select count(*) from public.wa_conversations c
      join public.wa_numbers n on n.id = c.number_id
      where c.org_id = target_org and c.status = 'open' and c.last_message_direction = 'in' and n.status = 'active'
        and c.last_inbound_at is not null and c.last_inbound_at >= c.last_message_at
        and public.wa_window_open(c.last_inbound_at)
        and public.wa_window_closes_at(c.last_inbound_at) < now() + make_interval(hours => closing_hours)
    ),
    'sends_failed', (
      select count(*) from public.wa_messages m
      where m.org_id = target_org and m.direction = 'out' and m.status = 'failed'
        and m.created_at > now() - interval '24 hours'
    ),
    'whatsapp', case
      when exists (select 1 from public.wa_numbers n where n.org_id = target_org and n.status = 'active') then 'active'
      when exists (select 1 from public.wa_numbers n where n.org_id = target_org) then 'disconnected'
      else 'none'
    end
  );
end;
$$;

revoke all on function public.firm_today(uuid) from public, anon;
grant execute on function public.firm_today(uuid) to authenticated;
