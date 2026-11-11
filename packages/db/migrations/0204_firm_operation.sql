-- ============================================================
-- 0204 · The firms' console, by firm (M3, sprint S10): what the operator
-- reads of one firm's operation beside its dossier (0012): its use against its
-- tier (0202), its WhatsApp (numbers, messages in and out, sends that failed),
-- the cost of its AI this month, its connections at vendors and its calendar,
-- its DJEN readings, what is wrong with it now, and whether it let the
-- support in (0203). Counts and states only: nothing of a client.
-- ============================================================

create or replace function public.admin_firm_operation(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  this_month timestamptz := date_trunc('month', (now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo';
  limits jsonb;
  used jsonb;
begin
  if not public.is_superadmin() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.organizations o where o.id = target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  limits := coalesce(public.org_entitlements(target_org) -> 'limits', '{}'::jsonb);
  used := public.usage_now(target_org);
  return jsonb_build_object(
    'ok', true,
    'usage', (
      select jsonb_agg(jsonb_build_object('metric', m.metric, 'now', coalesce((used ->> m.metric)::integer, 0),
               'ceiling', public.usage_ceiling(limits, m.metric)) order by m.position)
      from (values ('processos_ativos', 1), ('assentos', 2), ('whatsapp_numeros', 3)) as m (metric, position)
    ),
    'alerts_month', (select count(*) from public.usage_alerts a
                     where a.org_id = target_org and a.month = date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date),
    'cases', jsonb_build_object(
      'going', (select count(*) from public.cases c where c.org_id = target_org and c.status not in ('closed', 'declined') and not c.is_test),
      'tests', (select count(*) from public.cases c where c.org_id = target_org and c.is_test),
      'opened_month', (select count(*) from public.cases c where c.org_id = target_org and c.created_at >= this_month and not c.is_test)
    ),
    'whatsapp', jsonb_build_object(
      'numbers', coalesce((select jsonb_agg(jsonb_build_object('provider', n.provider, 'status', n.status))
                           from public.wa_numbers n where n.org_id = target_org), '[]'::jsonb),
      'in_30d', (select count(*) from public.wa_messages w
                 where w.org_id = target_org and w.direction = 'in' and w.created_at > now() - interval '30 days'),
      'out_30d', (select count(*) from public.wa_messages w
                  where w.org_id = target_org and w.direction = 'out' and w.created_at > now() - interval '30 days'),
      'failed_7d', (select count(*) from public.wa_messages w
                    where w.org_id = target_org and w.direction = 'out' and w.status = 'failed'
                      and w.created_at > now() - interval '7 days')
    ),
    'ai', jsonb_build_object(
      'runs_month', (select count(*) from public.ai_runs r where r.org_id = target_org and r.started_at >= this_month),
      'cost_usd_micros_month', (select coalesce(sum(r.cost_usd_micros), 0) from public.ai_runs r
                                where r.org_id = target_org and r.started_at >= this_month)
    ),
    'connections', coalesce((select jsonb_agg(jsonb_build_object('provider', c.provider, 'label', c.label, 'status', c.status)
                                              order by c.provider, c.label)
                             from public.connections c where c.org_id = target_org), '[]'::jsonb),
    'calendar', (select f.status from public.firm_calendars f where f.org_id = target_org limit 1),
    'djen', jsonb_build_object(
      'reading', (select count(*) from public.djen_captures d where d.org_id = target_org and d.active),
      'stopped', (select count(*) from public.djen_captures d where d.org_id = target_org and not d.active)
    ),
    'support_until', (select a.ends_at from public.support_authorizations a
                      where a.id = public.support_access_live(target_org))
  );
end;
$$;

revoke all on function public.admin_firm_operation(uuid) from public, anon;
grant execute on function public.admin_firm_operation(uuid) to authenticated;
