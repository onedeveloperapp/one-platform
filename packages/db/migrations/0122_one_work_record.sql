-- ============================================================
-- 0122 · O trabalho do ONE: a mudança das estimativas registrada inteira
--
-- Saving the firm's estimates (0120) kept its record through
-- `jsonb_strip_nulls`, which also stripped a kind sent back to ONE's minutes
-- (its null) from the minutes that changed, so the record lost which kind it
-- was. The record now keeps it, and never the cost of an hour. The cost read
-- before the change, which nothing used, is no longer read.
-- ============================================================

/**
 * Who decides for the firm sets its minutes of each kind named (`target_minutes`: {kind: minutes}, null to go back
 * to ONE's) and, when `target_set_cost`, the average cost of an hour (null to say none). Never a support visit; on the
 * record with what changed. Answers `{ok}`, or `{ok: false, code}`: `support_visit`, `not_allowed`, `kind`,
 * `minutes`, `cost`.
 */
create or replace function public.set_one_work_estimates(
  target_org uuid,
  target_minutes jsonb,
  target_set_cost boolean default false,
  target_hour_cents integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  entry record;
  wanted integer;
  changed jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if target_minutes is not null and jsonb_typeof(target_minutes) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'minutes');
  end if;
  for entry in select e.key, e.value from jsonb_each(coalesce(target_minutes, '{}'::jsonb)) e loop
    if not exists (select 1 from public.one_work_kinds k where k.key = entry.key) then
      return jsonb_build_object('ok', false, 'code', 'kind');
    end if;
    if jsonb_typeof(entry.value) not in ('number', 'null')
       or (jsonb_typeof(entry.value) = 'number' and (
         entry.value::text !~ '^[0-9]{1,3}$' or entry.value::text::integer > 600)) then
      return jsonb_build_object('ok', false, 'code', 'minutes');
    end if;
  end loop;
  if target_set_cost and target_hour_cents is not null and target_hour_cents not between 1 and 10000000 then
    return jsonb_build_object('ok', false, 'code', 'cost');
  end if;

  for entry in select e.key, e.value from jsonb_each(coalesce(target_minutes, '{}'::jsonb)) e loop
    if jsonb_typeof(entry.value) = 'null' then
      delete from public.firm_one_work_minutes where org_id = target_org and kind = entry.key;
      changed := changed || jsonb_build_object(entry.key, null);
    else
      wanted := entry.value::text::integer;
      insert into public.firm_one_work_minutes (org_id, kind, minutes, updated_by, updated_at)
      values (target_org, entry.key, wanted, auth.uid(), now())
      on conflict (org_id, kind) do update
        set minutes = excluded.minutes, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
      changed := changed || jsonb_build_object(entry.key, wanted);
    end if;
  end loop;
  if target_set_cost then
    if target_hour_cents is null then
      delete from public.firm_one_work_cost where org_id = target_org;
    else
      insert into public.firm_one_work_cost (org_id, hour_cents, updated_by, updated_at)
      values (target_org, target_hour_cents, auth.uid(), now())
      on conflict (org_id) do update
        set hour_cents = excluded.hour_cents, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    end if;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'one_work.estimates_changed', 'firm', target_org::text,
          -- A kind sent back to ONE's is kept as its null: stripping the nulls would drop which it was.
          case when changed = '{}'::jsonb then '{}'::jsonb else jsonb_build_object('minutes', changed) end
          || case when target_set_cost then '{"cost_changed": true}'::jsonb else '{}'::jsonb end);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_one_work_estimates(uuid, jsonb, boolean, integer) from public, anon;
grant execute on function public.set_one_work_estimates(uuid, jsonb, boolean, integer) to authenticated;

