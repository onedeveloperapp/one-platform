-- ============================================================
-- 0127 · Os livros, segunda parte
--
-- Phase 4 of the plan of the controladoria, the outcome of the cases and the
-- firm's finance, its second cut. A statement may also be a CSV or an Excel
-- workbook the bank exports, read in the person's browser like the OFX
-- (never uploaded; each line without an id of the bank's takes the hash of
-- its key and of how many times the key came before it in the file, so the
-- same export twice adds nothing and two equal payments of one file are two
-- lines). A client's money that arrived in an account of the firm's own is
-- to be set apart until a person says it was (`apart_at`; in a custody
-- account it is apart by being there). What waits for somebody of the books
-- (the lines ONE left, an account whose statement is late, a client's money
-- to set apart) is read by who reads the books, and by nobody else
-- (`firm_finance_attention`). An export of the entries is on the record,
-- never with what was searched (`begin_finance_export`). And the books keep
-- a person's identification for the setting's years after a movement, after
-- which its words (who, what, the case, the bank's memo) are taken out and
-- the values stay (`finance_retention_sweep`).
-- ============================================================

-- ---------- Statements in CSV and Excel ----------
alter table public.finance_statements drop constraint finance_statements_format_check;
alter table public.finance_statements add constraint finance_statements_format_check
  check (format in ('ofx', 'csv', 'xlsx'));
/** Begins a statement, now of a format: the OFX, or a CSV or an Excel workbook read in the browser. */
create or replace function public.begin_finance_statement(target_org uuid, target_account uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  sha text := lower(btrim(coalesce(fields ->> 'sha256', '')));
  name_value text := left(btrim(coalesce(fields ->> 'file_name', '')), 200);
  format_value text := coalesce(nullif(btrim(coalesce(fields ->> 'format', '')), ''), 'ofx');
  saved uuid;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if not exists (select 1 from public.finance_accounts a where a.id = target_account and a.org_id = target_org and a.archived_at is null) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'account');
  end if;
  if format_value not in ('ofx', 'csv', 'xlsx') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'file');
  end if;
  if sha !~ '^[0-9a-f]{64}$' or name_value = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'file');
  end if;
  if exists (select 1 from public.finance_statements s where s.account_id = target_account and s.file_sha256 = sha and s.status <> 'removed') then
    return jsonb_build_object('ok', false, 'code', 'already_imported');
  end if;
  begin
    insert into public.finance_statements (org_id, account_id, file_name, file_sha256, format, starts_on, ends_on,
      bank_balance_cents, bank_balance_on, imported_by)
    values (target_org, target_account, name_value, sha, format_value, nullif(fields ->> 'starts_on', '')::date,
      nullif(fields ->> 'ends_on', '')::date,
      case when coalesce(fields ->> 'balance_cents', '') ~ '^-?[0-9]{1,13}$' then (fields ->> 'balance_cents')::bigint end,
      nullif(fields ->> 'balance_on', '')::date, auth.uid())
    returning id into saved;
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'days');
  end;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.statement_begun', 'finance_statement', saved::text,
    jsonb_build_object('format', format_value));
  return jsonb_build_object('ok', true, 'statement_id', saved);
end;
$$;

revoke all on function public.begin_finance_statement(uuid, uuid, jsonb) from public, anon;
grant execute on function public.begin_finance_statement(uuid, uuid, jsonb) to authenticated;

-- ---------- A client's money set apart ----------
alter table public.finance_entries add column apart_at timestamptz;
alter table public.finance_entries add column apart_by uuid references public.profiles (id) on delete set null;
comment on column public.finance_entries.apart_at is
  'A client''s money a person said was set apart (0127); one in a custody account is apart by being there.';

/**
 * Says a client's money that arrived in an account of the firm's own was set apart, or takes it back (`operate`, the
 * second factor, on the record). Only a client's money that came in, in force, outside a custody account.
 */
create or replace function public.set_finance_money_apart(target_org uuid, target_entry uuid, target_apart boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  entry public.finance_entries%rowtype;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  select e.* into entry from public.finance_entries e
  where e.id = target_entry and e.org_id = target_org
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if entry.kind <> 'client_money' or entry.cents <= 0 or entry.cancelled_at is not null
     or exists (select 1 from public.finance_accounts a where a.id = entry.account_id and a.kind = 'custody') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'entry');
  end if;
  if coalesce(target_apart, false) = (entry.apart_at is not null) then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  update public.finance_entries
  set apart_at = case when target_apart then now() end, apart_by = case when target_apart then auth.uid() end
  where id = entry.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), case when target_apart then 'finance.money_set_apart' else 'finance.money_apart_undone' end,
    'finance_entry', entry.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_finance_money_apart(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_finance_money_apart(uuid, uuid, boolean) to authenticated;

-- ---------- The setting ----------
-- How many days without a statement make an account's late, how many exports a person takes a day, and how many
-- years after a movement the books keep who it was of. Added to what the setting holds, never over it.
update public.platform_settings
set value = jsonb_build_object('statement_late_days', 10, 'exports_daily', 20, 'keep_years', 6) || value
where key = 'finance';

-- ---------- What waits for who reads the books ----------
/**
 * What waits for somebody of the books, for who reads them and nobody else (null for anybody else, and for books not
 * open): the lines of a statement ONE left to a person (how many, of how many accounts, since when), each account whose
 * statement is late (its last one ended more than the setting's days ago, or it never had one since that long), and the
 * clients' money that came into an account of the firm's own and nobody said was set apart (how many, how much, since
 * when). The center of what waits and the home read it.
 */
create or replace function public.firm_finance_attention(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with books as (
    select o.finance_opened_on as opened, (now() at time zone 'America/Sao_Paulo')::date as today,
      public.finance_setting('statement_late_days', 10) as late_days
    from public.organizations o
    where o.id = target_org and o.finance_opened_on is not null and public.finance_reads(target_org)
  ),
  last_statement as (
    select s.account_id, max(coalesce(s.ends_on, (s.imported_at at time zone 'America/Sao_Paulo')::date)) as last_on
    from public.finance_statements s
    where s.org_id = target_org and s.status <> 'removed'
    group by s.account_id
  )
  select case when not exists (select 1 from books) then null else jsonb_build_object(
    'level', public.finance_level(target_org),
    'lines', (
      select jsonb_build_object('count', count(*), 'accounts', count(distinct l.account_id), 'oldest', min(l.posted_on))
      from public.finance_statement_lines l
      where l.org_id = target_org and l.state = 'pending'
    ),
    'late', coalesce((
      select jsonb_agg(jsonb_build_object('account_id', a.id, 'name', a.name, 'kind', a.kind, 'last_on', ls.last_on)
                       order by ls.last_on nulls first, a.name)
      from public.finance_accounts a
      cross join books b
      left join last_statement ls on ls.account_id = a.id
      where a.org_id = target_org and a.archived_at is null and a.kind in ('bank', 'card', 'receiving', 'custody')
        and coalesce(ls.last_on, greatest(b.opened, (a.created_at at time zone 'America/Sao_Paulo')::date))
            < b.today - b.late_days
    ), '[]'::jsonb),
    'apart', (
      select jsonb_build_object('count', count(*), 'cents', coalesce(sum(e.cents), 0), 'oldest', min(e.occurred_on))
      from public.finance_entries e
      join public.finance_accounts a on a.id = e.account_id
      where e.org_id = target_org and e.kind = 'client_money' and e.cents > 0 and e.cancelled_at is null
        and e.apart_at is null and a.kind <> 'custody'
    )
  ) end;
$$;

revoke all on function public.firm_finance_attention(uuid) from public, anon;
grant execute on function public.firm_finance_attention(uuid) to authenticated;

-- ---------- The export of the entries, on the record ----------
/**
 * Begins an export of the entries (Excel or PDF, written in the browser) by who reads the books, never a support visit,
 * within the setting's exports a day per person: on the record with its format and how many lines, never with what was
 * searched.
 */
create or replace function public.begin_finance_export(target_org uuid, target_format text, target_rows integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  taken integer;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.finance_reads(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if target_format is null or target_format not in ('xlsx', 'pdf') or target_rows is null or target_rows < 0
     or target_rows > 100000 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'export');
  end if;
  select count(*) into taken from public.audit_events a
  where a.org_id = target_org and a.actor_id = auth.uid() and a.action = 'finance.exported'
    and (a.created_at at time zone 'America/Sao_Paulo')::date = (now() at time zone 'America/Sao_Paulo')::date;
  if taken >= public.finance_setting('exports_daily', 20) then
    return jsonb_build_object('ok', false, 'code', 'daily_limit');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.exported', 'organization', target_org::text,
    jsonb_build_object('format', target_format, 'rows', target_rows));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.begin_finance_export(uuid, text, integer) from public, anon;
grant execute on function public.begin_finance_export(uuid, text, integer) to authenticated;

-- ---------- How long the books keep who a movement was of ----------
alter table public.finance_entries add column deidentified_at timestamptz;
alter table public.finance_statement_lines add column deidentified_at timestamptz;

/**
 * The books keep the words that identify a movement (who it was of, what was written of it, the case, the bank's memo)
 * for the setting's years after it; then they are taken out and the values, days, accounts and categories stay, as the
 * fiscal record needs (the backend's daily sweep, a batch at a time). A line's key, which holds its memo, becomes its id.
 */
create or replace function public.finance_retention_sweep(target_limit integer default 2000)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  cutoff date := ((now() at time zone 'America/Sao_Paulo')::date
                  - make_interval(years => public.finance_setting('keep_years', 6)))::date;
  done_entries integer;
  done_lines integer;
begin
  with due as (
    select e.id from public.finance_entries e
    where e.deidentified_at is null and e.occurred_on < cutoff
      and (e.counterparty is not null or e.description is not null or e.case_id is not null)
    order by e.occurred_on
    limit greatest(coalesce(target_limit, 2000), 1)
    for update skip locked
  )
  update public.finance_entries e
  set counterparty = null, description = null, case_id = null, deidentified_at = now()
  from due where e.id = due.id;
  get diagnostics done_entries = row_count;

  with due as (
    select l.id from public.finance_statement_lines l
    where l.deidentified_at is null and l.posted_on < cutoff
    order by l.posted_on
    limit greatest(coalesce(target_limit, 2000), 1)
    for update skip locked
  )
  update public.finance_statement_lines l
  set memo = '', line_key = 'x|' || l.id::text, deidentified_at = now()
  from due where l.id = due.id;
  get diagnostics done_lines = row_count;
  return done_entries + done_lines;
end;
$$;

revoke all on function public.finance_retention_sweep(integer) from public, anon, authenticated;
grant execute on function public.finance_retention_sweep(integer) to service_role;
