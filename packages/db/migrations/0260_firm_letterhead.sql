-- ============================================================
-- 0260_firm_letterhead: the firm's letterhead (the owner, 2026-11-20).
--
-- The second phase of the plan "o escritório preparado antes do primeiro atendimento", its letterhead. The firm sends
-- what it already writes on: a Word document on its letterhead (the most common), whose page, margins, header and
-- footer ONE reads and keeps, and whose own file a piece downloaded in Word is written into; or a PDF of a blank page
-- of its paper, which ONE measures and draws under every page. Either way the person sees a page of example before
-- ONE uses it: what ONE read is used only once confirmed, and a new letterhead waits for its own confirmation.
--
--   * `firm_brands` gains the letterhead: its kind (`word`, `pdf`), the file the firm sent, what ONE read of it
--     (`letterhead`: the page, the margins and, of a Word document, the header and the footer with the files of
--     their pictures, kept as files of the purpose `brand`), and who confirmed it and when.
--   * `set_firm_letterhead` (what ONE read, a new letterhead unconfirmed), `confirm_firm_letterhead` and
--     `remove_firm_letterhead`: who manages the firm, with the second factor, on the record.
-- ============================================================

alter table public.firm_brands add column letterhead_kind text;
alter table public.firm_brands add column letterhead_source_file_id uuid references public.files (id) on delete set null;
alter table public.firm_brands add column letterhead jsonb;
alter table public.firm_brands add column letterhead_confirmed_at timestamptz;
alter table public.firm_brands add column letterhead_confirmed_by uuid references public.profiles (id) on delete set null;

alter table public.firm_brands add constraint firm_brands_letterhead_check check (
  (letterhead_kind is null) = (letterhead is null)
  and (letterhead_kind is null or letterhead_kind in ('word', 'pdf'))
  and (letterhead is null or (jsonb_typeof(letterhead) = 'object' and octet_length(letterhead::text) <= 32768))
  and (letterhead_confirmed_at is null or letterhead_kind is not null)
);

/** The files a letterhead's reading names (its pictures): each must be the firm's, of the purpose `brand`, kept. */
create or replace function public.letterhead_files_ok(target_org uuid, target_data jsonb)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from jsonb_array_elements(
      coalesce(target_data -> 'header' -> 'images', '[]'::jsonb) || coalesce(target_data -> 'footer' -> 'images', '[]'::jsonb)
    ) image
    where not exists (
      select 1 from public.files f
      where f.id::text = image ->> 'file_id' and f.org_id = target_org and f.purpose = 'brand' and f.status = 'stored'
    )
  );
$$;

revoke all on function public.letterhead_files_ok(uuid, jsonb) from public, anon, authenticated;

/** What ONE read of the letterhead the firm sent: kept, to be confirmed on a page of example before it is used. */
create or replace function public.set_firm_letterhead(
  target_org uuid,
  target_kind text,
  target_source_file uuid,
  target_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.firm_brand_guard(target_org);
begin
  if target_kind is null or target_kind not in ('word', 'pdf') or target_data is null
     or jsonb_typeof(target_data) <> 'object' or octet_length(target_data::text) > 32768 then
    return jsonb_build_object('ok', false, 'code', 'invalid_letterhead');
  end if;
  if not exists (
    select 1 from public.files f
    where f.id = target_source_file and f.org_id = target_org and f.purpose = 'brand' and f.status = 'stored'
  ) or not public.letterhead_files_ok(target_org, target_data) then
    return jsonb_build_object('ok', false, 'code', 'file_not_found');
  end if;

  insert into public.firm_brands as b (
    org_id, letterhead_kind, letterhead_source_file_id, letterhead, letterhead_confirmed_at, letterhead_confirmed_by,
    updated_by, updated_at
  ) values (target_org, target_kind, target_source_file, target_data, null, null, caller, now())
  on conflict (org_id) do update set
    letterhead_kind = excluded.letterhead_kind,
    letterhead_source_file_id = excluded.letterhead_source_file_id,
    letterhead = excluded.letterhead,
    letterhead_confirmed_at = null,
    letterhead_confirmed_by = null,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'firm.letterhead_read', 'organization', target_org::text,
          jsonb_build_object('kind', target_kind, 'file', target_source_file));
  return jsonb_build_object('ok', true, 'code', 'read');
end;
$$;

revoke all on function public.set_firm_letterhead(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.set_firm_letterhead(uuid, text, uuid, jsonb) to authenticated;

/** The person saw the page of example: ONE writes on the letterhead from now on. */
create or replace function public.confirm_firm_letterhead(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.firm_brand_guard(target_org);
begin
  update public.firm_brands set
    letterhead_confirmed_at = now(), letterhead_confirmed_by = caller, updated_by = caller, updated_at = now()
  where org_id = target_org and letterhead_kind is not null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_letterhead');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'firm.letterhead_confirmed', 'organization', target_org::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'confirmed');
end;
$$;

revoke all on function public.confirm_firm_letterhead(uuid) from public, anon;
grant execute on function public.confirm_firm_letterhead(uuid) to authenticated;

/** The firm writes on plain paper again. */
create or replace function public.remove_firm_letterhead(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.firm_brand_guard(target_org);
begin
  update public.firm_brands set
    letterhead_kind = null, letterhead_source_file_id = null, letterhead = null,
    letterhead_confirmed_at = null, letterhead_confirmed_by = null, updated_by = caller, updated_at = now()
  where org_id = target_org and letterhead_kind is not null;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'firm.letterhead_removed', 'organization', target_org::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'removed');
end;
$$;

revoke all on function public.remove_firm_letterhead(uuid) from public, anon;
grant execute on function public.remove_firm_letterhead(uuid) to authenticated;
