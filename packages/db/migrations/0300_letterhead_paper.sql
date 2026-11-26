-- ============================================================
-- 0300_letterhead_paper: the firm's letterhead copied, never drawn again (the owner, 2026-11-25: "não é pra inventar,
-- mas sim copiar para ser utilizado no ONE exatamente como o usuário enviou, a não ser que seja um arquivo que tenha
-- conteúdo, aí desconsidere o conteúdo").
--
-- Until now ONE drew a Word letterhead again from what it read of it (its lines and its pictures, 0260), which lost
-- where each thing was, its shapes and its colours. Now ONE keeps a PDF of the firm's paper and draws that page under
-- every page it writes: a PDF the firm sent, its first two pages, the text of a document taken out of them; a Word
-- document made such a PDF by the office suite on ONE's own server (LibreOffice, `apps/web/clock/`), its body emptied
-- first. Each page of the paper is measured (where its header ends and its footer begins), the first apart from the
-- following ones, since a Word document's first page may have a header of its own.
--
--   * `firm_brands` gains the paper: the PDF ONE keeps (`letterhead_paper_file_id`, a file of the brand), its measure
--     (`letterhead_paper`), and where it stands (`letterhead_paper_status`): `converting` while a Word document waits
--     for ONE's server, `ready`, or `failed` with why (`letterhead_paper_problem`). A letterhead sent anew, or taken
--     away, takes its paper with it (a trigger, so 0260's functions stay as they were). A PDF letterhead read before
--     0300 has no paper: its own file is drawn, as it was. A Word letterhead read before 0300 is converted.
--   * `set_firm_letterhead_paper`: the PDF the firm sent, its paper kept at once. Who manages the firm, with the
--     second factor, on the record.
--   * `claim_letterhead_paper` and `record_letterhead_paper`: ONE's server takes the next Word document to convert,
--     at most `max_attempts` times, one at a time, a claim that does not answer in `working_minutes` given back, and
--     says what came of it (`platform_settings.letterhead_papers`). The backend's only.
--   * `confirm_firm_letterhead` confirms only a paper the person could see: a Word document still converting, or one
--     ONE could not convert, is not confirmed.
--   * `discard_file` keeps the paper ONE drew from.
-- ============================================================

-- ---------- The paper ----------

alter table public.firm_brands add column letterhead_paper_file_id uuid references public.files (id) on delete set null;
alter table public.firm_brands add column letterhead_paper jsonb;
alter table public.firm_brands add column letterhead_paper_status text;
alter table public.firm_brands add column letterhead_paper_problem text;
alter table public.firm_brands add column letterhead_paper_attempts integer not null default 0;
alter table public.firm_brands add column letterhead_paper_claim uuid;
alter table public.firm_brands add column letterhead_paper_claimed_at timestamptz;

alter table public.firm_brands add constraint firm_brands_letterhead_paper_check check (
  (letterhead_paper_status is null or letterhead_paper_status in ('converting', 'ready', 'failed'))
  and (letterhead_paper_status is null or letterhead_kind is not null)
  and (letterhead_paper_status = 'ready') = (letterhead_paper is not null and letterhead_paper_file_id is not null)
  and (letterhead_paper is null or (jsonb_typeof(letterhead_paper) = 'object' and octet_length(letterhead_paper::text) <= 32768))
  and (letterhead_paper_problem is null or letterhead_paper_problem in ('refused', 'unavailable', 'not_pdf', 'empty', 'source_missing'))
  and (letterhead_paper_claim is null or letterhead_paper_status = 'converting')
  and letterhead_paper_attempts >= 0
);

/**
 * A letterhead sent anew (another file) or taken away takes its paper with it: a Word document waits to be converted,
 * anything else has no paper until one is kept with it. A statement that keeps the paper itself (another paper file)
 * is left as it wrote it.
 */
create or replace function public.firm_brands_letterhead_paper()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE'
     and new.letterhead_source_file_id is not distinct from old.letterhead_source_file_id
     and new.letterhead_kind is not distinct from old.letterhead_kind then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.letterhead_paper_file_id is distinct from old.letterhead_paper_file_id then
    return new;
  end if;
  if tg_op = 'INSERT' and new.letterhead_paper_file_id is not null then
    return new;
  end if;
  new.letterhead_paper_file_id := null;
  new.letterhead_paper := null;
  new.letterhead_paper_problem := null;
  new.letterhead_paper_attempts := 0;
  new.letterhead_paper_claim := null;
  new.letterhead_paper_claimed_at := null;
  new.letterhead_paper_status := case when new.letterhead_kind = 'word' then 'converting' end;
  return new;
end;
$$;

revoke all on function public.firm_brands_letterhead_paper() from public, anon, authenticated;

create trigger firm_brands_letterhead_paper before insert or update on public.firm_brands
  for each row execute function public.firm_brands_letterhead_paper();

-- A Word letterhead read before 0300 is copied too: ONE's server converts it.
update public.firm_brands set letterhead_paper_status = 'converting' where letterhead_kind = 'word';

insert into public.platform_settings (key, value, is_public)
values ('letterhead_papers', jsonb_build_object('max_attempts', 3, 'working_minutes', 10), false)
on conflict (key) do nothing;

-- ---------- The PDF the firm sent ----------

/**
 * The PDF the firm sent as its letterhead, and the paper ONE kept of it (its first two pages, the text of a document
 * taken out) with its measure: kept, to be confirmed on a page of example before it is used.
 */
create or replace function public.set_firm_letterhead_paper(
  target_org uuid,
  target_source_file uuid,
  target_paper_file uuid,
  target_paper jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.firm_brand_guard(target_org);
  reading jsonb;
begin
  if target_paper is null or jsonb_typeof(target_paper) <> 'object' or octet_length(target_paper::text) > 32768
     or jsonb_typeof(target_paper -> 'first' -> 'margins') <> 'object'
     or jsonb_typeof(target_paper -> 'rest' -> 'margins') <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_letterhead');
  end if;
  if (select count(*) from public.files f
      where f.id in (target_source_file, target_paper_file) and f.org_id = target_org and f.purpose = 'brand'
        and f.status = 'stored') <> 2 then
    return jsonb_build_object('ok', false, 'code', 'file_not_found');
  end if;
  -- What a letterhead of 0260 kept of a PDF: the page and the margins of the text, of its following pages.
  reading := jsonb_build_object(
    'page', target_paper -> 'page',
    'margins', target_paper -> 'rest' -> 'margins',
    'header', target_paper -> 'rest' -> 'header',
    'footer', target_paper -> 'rest' -> 'footer');

  insert into public.firm_brands as b (
    org_id, letterhead_kind, letterhead_source_file_id, letterhead, letterhead_confirmed_at, letterhead_confirmed_by,
    letterhead_paper_file_id, letterhead_paper, letterhead_paper_status, letterhead_paper_problem,
    letterhead_paper_attempts, letterhead_paper_claim, letterhead_paper_claimed_at, updated_by, updated_at
  ) values (
    target_org, 'pdf', target_source_file, reading, null, null,
    target_paper_file, target_paper, 'ready', null, 0, null, null, caller, now()
  )
  on conflict (org_id) do update set
    letterhead_kind = excluded.letterhead_kind,
    letterhead_source_file_id = excluded.letterhead_source_file_id,
    letterhead = excluded.letterhead,
    letterhead_confirmed_at = null,
    letterhead_confirmed_by = null,
    letterhead_paper_file_id = excluded.letterhead_paper_file_id,
    letterhead_paper = excluded.letterhead_paper,
    letterhead_paper_status = 'ready',
    letterhead_paper_problem = null,
    letterhead_paper_attempts = 0,
    letterhead_paper_claim = null,
    letterhead_paper_claimed_at = null,
    updated_by = excluded.updated_by,
    updated_at = excluded.updated_at;

  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'firm.letterhead_read', 'organization', target_org::text,
          jsonb_build_object('kind', 'pdf', 'file', target_source_file, 'paper', target_paper_file,
                             'stripped', coalesce((target_paper ->> 'stripped')::boolean, false)));
  return jsonb_build_object('ok', true, 'code', 'read');
end;
$$;

revoke all on function public.set_firm_letterhead_paper(uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.set_firm_letterhead_paper(uuid, uuid, uuid, jsonb) to authenticated;

-- ---------- The Word document converted on ONE's server ----------

/**
 * The next Word letterhead to convert: one still converting, tried fewer than `max_attempts` times and not claimed in
 * the last `working_minutes`, whose file is kept. Claimed at once; one that has had all its attempts is marked failed
 * first. Null when none is due. The backend's (ONE's server).
 */
create or replace function public.claim_letterhead_paper()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings jsonb := coalesce((select value from public.platform_settings where key = 'letterhead_papers'), '{}'::jsonb);
  most integer := greatest(1, coalesce((settings ->> 'max_attempts')::integer, 3));
  working interval := make_interval(mins => greatest(1, coalesce((settings ->> 'working_minutes')::integer, 10)));
  brand public.firm_brands%rowtype;
  source public.files%rowtype;
  claim uuid := gen_random_uuid();
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;

  -- What had all its attempts and did not answer the last one failed: the suite did not convert it.
  update public.firm_brands set
    letterhead_paper_status = 'failed', letterhead_paper_problem = coalesce(letterhead_paper_problem, 'unavailable'),
    letterhead_paper_claim = null, letterhead_paper_claimed_at = null
  where letterhead_paper_status = 'converting' and letterhead_paper_attempts >= most
    and (letterhead_paper_claimed_at is null or letterhead_paper_claimed_at < now() - working);

  select b.* into brand
  from public.firm_brands b
  where b.letterhead_paper_status = 'converting'
    and b.letterhead_kind = 'word'
    and b.letterhead_paper_attempts < most
    and (b.letterhead_paper_claimed_at is null or b.letterhead_paper_claimed_at < now() - working)
  order by b.letterhead_paper_claimed_at nulls first, b.updated_at, b.org_id
  limit 1
  for update of b skip locked;
  if not found then
    return null;
  end if;

  select * into source from public.files f
  where f.id = brand.letterhead_source_file_id and f.org_id = brand.org_id and f.status = 'stored';
  if not found then
    update public.firm_brands set letterhead_paper_status = 'failed', letterhead_paper_problem = 'source_missing'
    where org_id = brand.org_id;
    return jsonb_build_object('ok', false, 'code', 'source_missing', 'org_id', brand.org_id);
  end if;

  update public.firm_brands set
    letterhead_paper_attempts = letterhead_paper_attempts + 1,
    letterhead_paper_claim = claim,
    letterhead_paper_claimed_at = now()
  where org_id = brand.org_id;
  return jsonb_build_object(
    'ok', true, 'code', 'claimed', 'org_id', brand.org_id, 'claim', claim,
    'source_file_id', source.id, 'storage_path', source.storage_path,
    'margins', brand.letterhead -> 'margins', 'attempt', brand.letterhead_paper_attempts + 1);
end;
$$;

revoke all on function public.claim_letterhead_paper() from public, anon, authenticated;

/**
 * What came of a claim: `ready`, with the paper ONE kept (a file of the firm's brand) and its measure; `retry`, the
 * suite did not answer, to be tried again while attempts remain; `failed`, the document cannot be converted. A claim
 * that is no longer the letterhead's (sent anew, taken away, given back) changes nothing. The backend's.
 */
create or replace function public.record_letterhead_paper(
  target_org uuid,
  target_claim uuid,
  target_outcome text,
  target_paper_file uuid default null,
  target_paper jsonb default null,
  target_problem text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  settings jsonb := coalesce((select value from public.platform_settings where key = 'letterhead_papers'), '{}'::jsonb);
  most integer := greatest(1, coalesce((settings ->> 'max_attempts')::integer, 3));
  brand public.firm_brands%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_outcome is null or target_outcome not in ('ready', 'retry', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  if target_problem is not null
     and target_problem not in ('refused', 'unavailable', 'not_pdf', 'empty', 'source_missing') then
    return jsonb_build_object('ok', false, 'code', 'invalid_outcome');
  end if;
  select * into brand from public.firm_brands
  where org_id = target_org and letterhead_paper_claim = target_claim and letterhead_paper_status = 'converting'
  for update;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'stale');
  end if;

  if target_outcome = 'ready' then
    if target_paper is null or jsonb_typeof(target_paper) <> 'object' or octet_length(target_paper::text) > 32768
       or jsonb_typeof(target_paper -> 'first' -> 'margins') <> 'object'
       or jsonb_typeof(target_paper -> 'rest' -> 'margins') <> 'object' then
      return jsonb_build_object('ok', false, 'code', 'invalid_letterhead');
    end if;
    if not exists (
      select 1 from public.files f
      where f.id = target_paper_file and f.org_id = target_org and f.purpose = 'brand' and f.status = 'stored'
    ) then
      return jsonb_build_object('ok', false, 'code', 'file_not_found');
    end if;
    update public.firm_brands set
      letterhead_paper_file_id = target_paper_file, letterhead_paper = target_paper, letterhead_paper_status = 'ready',
      letterhead_paper_problem = null, letterhead_paper_claim = null, letterhead_paper_claimed_at = null
    where org_id = target_org;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, null, 'firm.letterhead_paper_ready', 'organization', target_org::text,
            jsonb_build_object('paper', target_paper_file, 'attempt', brand.letterhead_paper_attempts));
    return jsonb_build_object('ok', true, 'code', 'ready');
  end if;

  if target_outcome = 'retry' and brand.letterhead_paper_attempts < most then
    update public.firm_brands set
      letterhead_paper_problem = coalesce(target_problem, 'unavailable'),
      letterhead_paper_claim = null, letterhead_paper_claimed_at = null
    where org_id = target_org;
    return jsonb_build_object('ok', true, 'code', 'retry');
  end if;

  update public.firm_brands set
    letterhead_paper_status = 'failed', letterhead_paper_problem = coalesce(target_problem, 'unavailable'),
    letterhead_paper_claim = null, letterhead_paper_claimed_at = null
  where org_id = target_org;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, null, 'firm.letterhead_paper_failed', 'organization', target_org::text,
          jsonb_build_object('problem', coalesce(target_problem, 'unavailable'), 'attempt', brand.letterhead_paper_attempts));
  return jsonb_build_object('ok', true, 'code', 'failed');
end;
$$;

revoke all on function public.record_letterhead_paper(uuid, uuid, text, uuid, jsonb, text) from public, anon, authenticated;

-- ---------- Confirmed only once seen ----------

/** As in 0260, and only a letterhead whose paper the person could see: never one converting nor one that failed. */
create or replace function public.confirm_firm_letterhead(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := public.firm_brand_guard(target_org);
  status text;
begin
  select b.letterhead_paper_status into status
  from public.firm_brands b where b.org_id = target_org and b.letterhead_kind is not null;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_letterhead');
  end if;
  if status in ('converting', 'failed') then
    return jsonb_build_object('ok', false, 'code', 'paper_not_ready');
  end if;
  update public.firm_brands set
    letterhead_confirmed_at = now(), letterhead_confirmed_by = caller, updated_by = caller, updated_at = now()
  where org_id = target_org and letterhead_kind is not null;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, caller, 'firm.letterhead_confirmed', 'organization', target_org::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'confirmed');
end;
$$;

revoke all on function public.confirm_firm_letterhead(uuid) from public, anon;
grant execute on function public.confirm_firm_letterhead(uuid) to authenticated;

-- ---------- The paper is kept ----------

/** As in 0266, and the paper ONE draws under every page it issues (0300). */
create or replace function public.discard_file(target_file uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  file public.files%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into file from public.files where id = target_file for update;
  if not found then
    return jsonb_build_object('ok', true, 'code', 'not_found');
  end if;
  if exists (select 1 from public.issued_documents d where d.file_id = file.id)
     or exists (select 1 from public.case_documents d where d.file_id = file.id or d.normalized_file_id = file.id)
     or exists (select 1 from public.case_statements s where s.audio_file_id = file.id)
     or exists (select 1 from public.wa_messages m where m.media_file_id = file.id)
     or exists (select 1 from public.filing_package_items i where i.file_id = file.id or i.signed_file_id = file.id)
     or exists (select 1 from public.filing_receipts r where r.file_id = file.id)
     or exists (select 1 from public.filing_submissions s where s.receipt_file_id = file.id or s.summary_file_id = file.id)
     or exists (select 1 from public.template_imports i where i.file_id = file.id)
     or exists (select 1 from public.pax_documents d where d.file_id = file.id)
     -- The receipt of a cost of a case (0131).
     or exists (select 1 from public.case_costs c where c.file_id = file.id)
     -- The document of a bill or an entry of the books (0140).
     or exists (select 1 from public.finance_bills b where b.file_id = file.id)
     or exists (select 1 from public.finance_entries e where e.file_id = file.id)
     -- A document of a trip of a person the firm registered, before any case (0170).
     or exists (select 1 from public.tracked_trip_documents d where d.file_id = file.id)
     -- The invoice the firm issued, kept with its record (0165).
     or exists (select 1 from public.finance_invoices i where i.file_id = file.id)
     -- The receipt the court gave of an intermediate piece ONE filed (0189).
     or exists (select 1 from public.case_drafts d where d.receipt_file_id = file.id)
     -- The firm's logo, as sent and as kept, the letterhead it sent (0258, 0260) and the paper ONE copied of it (0300).
     or exists (
       select 1 from public.firm_brands b
       where b.logo_source_file_id = file.id or b.logo_file_id = file.id or b.letterhead_source_file_id = file.id
          or b.letterhead_paper_file_id = file.id
     )
     -- A picture of the letterhead's header or footer, which ONE draws on every page it issues (0260).
     or exists (
       select 1 from public.firm_brands b,
         jsonb_array_elements(
           coalesce(b.letterhead -> 'header' -> 'images', '[]'::jsonb) || coalesce(b.letterhead -> 'footer' -> 'images', '[]'::jsonb)
         ) image
       where b.org_id = file.org_id and image ->> 'file_id' = file.id::text
     ) then
    return jsonb_build_object('ok', false, 'code', 'in_use');
  end if;

  delete from public.files where id = file.id;
  -- A file a partner held is none of the firm's trail (`confirm_file`, 0070).
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (case when file.partner_id is null then file.org_id end, null, 'file.discarded', 'file', file.id::text,
          jsonb_strip_nulls(jsonb_build_object('purpose', file.purpose, 'status', file.status, 'partner', file.partner_id)));
  return jsonb_build_object('ok', true, 'code', 'discarded');
end;
$$;

revoke all on function public.discard_file(uuid) from public, anon, authenticated;
