-- ============================================================
-- The list of cases as a PDF too (phase 1 of the plan of the controladoria).
--
-- An Excel workbook carries the whole list; a PDF is to read or to print, so
-- it holds fewer lines: the setting's 2,000 (`export_pdf_rows`, in
-- `platform_settings` `controladoria`, beside the workbook's 100,000). The PDF
-- is written in the person's browser, as the workbook is. It is an export like
-- any other: the same people, the same exports a day (the two counted
-- together), on the record as `case.exported` with its format, and never with
-- the words searched.
-- ============================================================

update public.platform_settings
set value = value || '{"export_pdf_rows": 2000}'::jsonb
where key = 'controladoria' and not (value ? 'export_pdf_rows');

/**
 * Begins an export of the firm's list of cases, on the record: who may (`may_export_cases`), never a support
 * visit, within the setting's exports a day per person (counted in the days of Brasília) and the setting's lines
 * for its format. The audit trail keeps the view, the module, whether a search narrowed the list, how many cases
 * it holds and its format, never the words searched. Answers the size of the pages to read and how many exports
 * are left today.
 */
create or replace function public.begin_case_export(
  target_org uuid,
  target_view text default null,
  target_module text default null,
  target_searched boolean default false,
  target_rows integer default 0,
  target_format text default 'xlsx'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  daily integer := public.controladoria_setting('export_daily', 20);
  most integer;
  page integer := greatest(public.controladoria_setting('export_page', 2000), 100);
  day_from timestamptz := ((now() at time zone 'America/Sao_Paulo')::date)::timestamp at time zone 'America/Sao_Paulo';
  used integer;
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
  if not public.may_export_cases(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if coalesce(target_format, '') not in ('xlsx', 'pdf') then
    raise exception 'invalid_format' using errcode = '22023';
  end if;
  if (target_view is not null and target_view !~ '^[a-z][a-z0-9-]{1,40}$')
     or (target_module is not null and target_module !~ '^[a-z][a-z0-9-]{1,60}$') then
    raise exception 'invalid_filter' using errcode = '22023';
  end if;
  if coalesce(target_rows, 0) < 1 then
    return jsonb_build_object('ok', false, 'code', 'empty');
  end if;
  most := case target_format
    when 'pdf' then public.controladoria_setting('export_pdf_rows', 2000)
    else public.controladoria_setting('export_rows', 100000)
  end;
  if target_rows > most then
    return jsonb_build_object('ok', false, 'code', 'too_many', 'limit', most);
  end if;
  select count(*)::integer into used from public.audit_events e
  where e.org_id = target_org and e.actor_id = auth.uid() and e.action = 'case.exported' and e.created_at >= day_from;
  if used >= daily then
    return jsonb_build_object('ok', false, 'code', 'daily_limit', 'limit', daily);
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'case.exported', 'case_list', target_org::text,
          jsonb_strip_nulls(jsonb_build_object(
            'view', target_view, 'module', target_module, 'searched', coalesce(target_searched, false),
            'rows', target_rows, 'format', target_format)));
  return jsonb_build_object('ok', true, 'page', page, 'left', daily - used - 1);
end;
$$;

revoke all on function public.begin_case_export(uuid, text, text, boolean, integer, text) from public, anon;
grant execute on function public.begin_case_export(uuid, text, text, boolean, integer, text) to authenticated;
