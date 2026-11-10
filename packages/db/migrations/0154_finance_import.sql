-- ============================================================
-- 0154 · As contas em aberto do sistema antigo, por planilha
--
-- The plan of the finance, phase 5: a firm that arrives from another system
-- brings the bills it still has to pay and to receive from a spreadsheet,
-- never one by one. The file is read in the person's browser (each line with
-- its way, who, what for, its value, its due day, the month it is of, a
-- category by its name, a lawsuit by its number and a typed line that
-- checks); who operates the books sends the lines a few hundred a call
-- (`import_finance_bills`, the second factor), and each becomes a bill of
-- the books, its category the firm's of that name and way (else the chart's
-- "other" of that way, said on the line), its case the firm's of that
-- lawsuit. A line is told apart by its key in the file: the same file
-- brought twice opens nothing twice. An import is undone whole while
-- nothing of it was paid (`undo_finance_import`): each bill still open with
-- nothing paid is cancelled with the reason, never deleted, and one already
-- paid in part or whole stays, said in the answer.
--
--   finance_imports        each import: who, when, the file's name, counts;
--   import_finance_bills   a call of lines of an import;
--   undo_finance_import    an import undone;
--   firm_finance_imports   what who reads the books sees of them.
-- ============================================================

update public.platform_settings
set value = jsonb_build_object('import_lines_per_call', 500, 'import_lines', 20000) || value
where key = 'finance' and not value ? 'import_lines_per_call';

create table public.finance_imports (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  file_name text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  lines integer not null default 0,
  opened integer not null default 0,
  existed integer not null default 0,
  refused integer not null default 0,
  undone_at timestamptz,
  undone_by uuid references public.profiles (id) on delete set null,
  unique (id, org_id),
  constraint finance_imports_name_check check (file_name is null or char_length(file_name) between 1 and 200),
  constraint finance_imports_counts_check check (lines >= 0 and opened >= 0 and existed >= 0 and refused >= 0)
);

create index finance_imports_org_idx on public.finance_imports (org_id, created_at desc);

alter table public.finance_imports enable row level security;
create policy "finance_imports_select_reader" on public.finance_imports
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_imports to authenticated;
create trigger guard_impersonation_finance_imports after insert or update or delete on public.finance_imports
  for each statement execute function public.guard_impersonation_readonly();

alter table public.finance_bills add column import_id uuid;
alter table public.finance_bills add column import_key text;
alter table public.finance_bills add constraint finance_bills_import_fk
  foreign key (import_id, org_id) references public.finance_imports (id, org_id) on delete set null (import_id);
alter table public.finance_bills add constraint finance_bills_import_key_check
  check (import_key is null or char_length(import_key) between 8 and 120);
create unique index finance_bills_import_key_idx on public.finance_bills (org_id, import_key)
  where import_key is not null and status <> 'cancelled';
create index finance_bills_import_idx on public.finance_bills (import_id) where import_id is not null;

alter table public.finance_bills drop constraint finance_bills_source_check;
alter table public.finance_bills add constraint finance_bills_source_check
  check (source in ('manual', 'series', 'renegotiation', 'fees', 'success', 'cost', 'import'));

/**
 * A call of lines of an import (`operate`, the second factor): the first call names no import and makes one with the
 * file's name; each line becomes a bill of the books, or is said as already in ONE (its key) or refused with why.
 * Each line: `line`, `key` (the browser's hash of the line's key in the file), `direction`, `counterparty`,
 * `description`, `cents`, `due_on`, `competence_on`, `category` (a name), `cnj` (20 digits), `typed_line`.
 */
create or replace function public.import_finance_bills(
  target_org uuid,
  target_import uuid,
  target_file_name text,
  target_lines jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  most integer := greatest(public.finance_setting('import_lines_per_call', 500), 1);
  ceiling integer := greatest(public.finance_setting('import_lines', 20000), 1);
  batch public.finance_imports%rowtype;
  item jsonb;
  direction_value text;
  cents_value bigint;
  due_value date;
  competence_value date;
  category_value uuid;
  category_named boolean;
  case_value uuid;
  key_value text;
  line_value integer;
  typed text;
  problem text;
  made integer := 0;
  known integer := 0;
  notes jsonb := '[]'::jsonb;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if jsonb_typeof(target_lines) is distinct from 'array' or jsonb_array_length(target_lines) = 0
     or jsonb_array_length(target_lines) > most then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'lines');
  end if;
  if target_import is null then
    insert into public.finance_imports (org_id, file_name, created_by)
    values (target_org, nullif(left(btrim(coalesce(target_file_name, '')), 200), ''), auth.uid())
    returning * into batch;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, auth.uid(), 'finance.import_started', 'finance_import', batch.id::text, '{}'::jsonb);
  else
    select * into batch from public.finance_imports where id = target_import and org_id = target_org for update;
    if not found or batch.undone_at is not null then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
  end if;
  if batch.lines + jsonb_array_length(target_lines) > ceiling then
    return jsonb_build_object('ok', false, 'code', 'too_many');
  end if;

  for item in select value from jsonb_array_elements(target_lines) loop
    line_value := coalesce((item ->> 'line')::integer, 0);
    key_value := nullif(item ->> 'key', '');
    direction_value := item ->> 'direction';
    begin
      cents_value := (item ->> 'cents')::bigint;
      due_value := (item ->> 'due_on')::date;
      competence_value := date_trunc('month', coalesce(nullif(item ->> 'competence_on', '')::date, due_value))::date;
    exception when others then
      notes := notes || jsonb_build_object('line', line_value, 'code', 'invalid');
      continue;
    end;
    if key_value is null or char_length(key_value) not between 8 and 120 then
      notes := notes || jsonb_build_object('line', line_value, 'code', 'invalid');
      continue;
    end if;
    if exists (
      select 1 from public.finance_bills b
      where b.org_id = target_org and b.import_key = key_value and b.status <> 'cancelled'
    ) then
      known := known + 1;
      continue;
    end if;
    -- The firm's category of that name and way, else the chart's "other" of that way.
    select c.id into category_value from public.finance_categories c
    where c.org_id = target_org and c.archived_at is null
      and c.kind = case when direction_value = 'pay' then 'expense' else 'income' end
      and public.plain_name(c.name) = public.plain_name(item ->> 'category')
    order by c.position limit 1;
    category_named := category_value is not null;
    if category_value is null then
      select c.id into category_value from public.finance_categories c
      where c.org_id = target_org and c.archived_at is null
        and c.code = case when direction_value = 'pay' then 'despesa.outras' else 'receita.outras' end
      limit 1;
    end if;
    select pr.case_id into case_value from public.proceedings pr
    where pr.org_id = target_org and pr.cnj = nullif(item ->> 'cnj', '')
    order by pr.created_at limit 1;
    typed := case when coalesce(item ->> 'typed_line', '') ~ '^[0-9]{47,48}$' then item ->> 'typed_line' end;
    problem := public.finance_bill_problem(target_org, direction_value, category_value, null, case_value, cents_value,
      due_value);
    if problem is null and (char_length(coalesce(item ->> 'counterparty', '')) > 120
                            or char_length(coalesce(item ->> 'description', '')) > 300) then
      problem := 'text';
    end if;
    if problem is not null then
      notes := notes || jsonb_build_object('line', line_value, 'code', problem);
      continue;
    end if;
    insert into public.finance_bills (org_id, direction, counterparty, description, category_id, case_id, cents, due_on,
      competence_on, typed_line, source, created_by, import_id, import_key)
    values (target_org, direction_value, nullif(btrim(item ->> 'counterparty'), ''), nullif(btrim(item ->> 'description'), ''),
      category_value, case_value, cents_value, due_value, competence_value, typed, 'import', auth.uid(), batch.id, key_value);
    made := made + 1;
    if not category_named and nullif(btrim(coalesce(item ->> 'category', '')), '') is not null then
      notes := notes || jsonb_build_object('line', line_value, 'code', 'category_other');
    end if;
  end loop;

  update public.finance_imports
  set lines = lines + jsonb_array_length(target_lines), opened = opened + made,
      existed = existed + known,
      refused = refused + (select count(*) from jsonb_array_elements(notes) n where n.value ->> 'code' <> 'category_other')
  where id = batch.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.import_lines', 'finance_import', batch.id::text,
    jsonb_build_object('lines', jsonb_array_length(target_lines), 'opened', made, 'existed', known));
  return jsonb_build_object('ok', true, 'import_id', batch.id, 'opened', made, 'existed', known, 'notes', notes);
end;
$$;

revoke all on function public.import_finance_bills(uuid, uuid, text, jsonb) from public, anon;
grant execute on function public.import_finance_bills(uuid, uuid, text, jsonb) to authenticated;

/**
 * An import undone (`operate`, the second factor): each of its bills still open with nothing paid is cancelled with
 * the reason, never deleted; one already paid in part or whole stays, and the answer says how many.
 */
create or replace function public.undo_finance_import(target_org uuid, target_import uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  batch public.finance_imports%rowtype;
  cancelled integer;
  kept integer;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  select * into batch from public.finance_imports where id = target_import and org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if batch.undone_at is not null then
    return jsonb_build_object('ok', true, 'cancelled', 0, 'kept', 0);
  end if;
  update public.finance_bills
  set status = 'cancelled', closed_reason = 'Importação desfeita.', closed_at = now(), closed_by = auth.uid()
  where org_id = target_org and import_id = batch.id and status = 'open' and paid_cents = 0;
  get diagnostics cancelled = row_count;
  select count(*) into kept from public.finance_bills
  where org_id = target_org and import_id = batch.id and status <> 'cancelled';
  update public.finance_imports set undone_at = now(), undone_by = auth.uid() where id = batch.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.import_undone', 'finance_import', batch.id::text,
    jsonb_build_object('cancelled', cancelled, 'kept', kept));
  return jsonb_build_object('ok', true, 'cancelled', cancelled, 'kept', kept);
end;
$$;

revoke all on function public.undo_finance_import(uuid, uuid) from public, anon;
grant execute on function public.undo_finance_import(uuid, uuid) to authenticated;

/** The firm's imports, the latest first, for who reads the books: each with its counts and what of it stands. */
create or replace function public.firm_finance_imports(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.finance_reads(target_org) then
    return null;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', i.id, 'file_name', i.file_name, 'created_at', i.created_at, 'lines', i.lines, 'opened', i.opened,
      'existed', i.existed, 'refused', i.refused, 'undone_at', i.undone_at,
      'paid', (select count(*) from public.finance_bills b where b.import_id = i.id and b.paid_cents > 0)
    ) order by i.created_at desc)
    from (select * from public.finance_imports f where f.org_id = target_org order by f.created_at desc limit 20) i
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.firm_finance_imports(uuid) from public, anon;
grant execute on function public.firm_finance_imports(uuid) to authenticated;
