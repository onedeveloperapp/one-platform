-- ============================================================
-- 0166 · O contador do escritório e o pacote do mês por e-mail
--
-- Phase 12 of the plan of the controladoria and the finance: the accountant's package of a month (0137, 0163) was only
-- downloaded. Who configures the books registers the firm's accountant (`finance_accountants`: a name, an e-mail, the
-- accounting office and the CRC, one per firm; `save_finance_accountant`, `remove_finance_accountant`, the second
-- factor, never a support visit, on the record), and who operates the books sends a month's package to that address
-- and no other (`begin_finance_package_send`, then `finish_finance_package_send` with what the provider said; within the
-- setting `finance.package_sends`, 10 a day; on the record with the month and never the file). The server builds the
-- same workbook the download builds; ONE keeps no copy of it.
-- ============================================================

update public.platform_settings
set value = jsonb_build_object('package_sends', 10) || value
where key = 'finance' and not value ? 'package_sends';

create table public.finance_accountants (
  org_id uuid primary key references public.organizations (id) on delete cascade,
  name text not null,
  email text not null,
  office text,
  crc text,
  set_by uuid references public.profiles (id) on delete set null,
  set_at timestamptz not null default now(),
  constraint finance_accountants_name_check check (char_length(btrim(name)) between 2 and 120),
  constraint finance_accountants_email_check check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  constraint finance_accountants_office_check check (office is null or char_length(btrim(office)) between 2 and 120),
  constraint finance_accountants_crc_check check (crc is null or crc ~ '^[A-Z]{2}-?[0-9]{3,8}(/[A-Z0-9]{1,3})?$')
);

alter table public.finance_accountants enable row level security;
create policy "finance_accountants_select_reader" on public.finance_accountants
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_accountants to authenticated;
create trigger guard_impersonation_finance_accountants after insert or update or delete on public.finance_accountants
  for each statement execute function public.guard_impersonation_readonly();

create table public.finance_package_sends (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  month date not null,
  email text not null,
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz not null default now(),
  status text not null default 'sending',
  error text,
  finished_at timestamptz,
  constraint finance_package_sends_month_check check (month = date_trunc('month', month)::date),
  constraint finance_package_sends_status_check check (status in ('sending', 'sent', 'failed')),
  constraint finance_package_sends_error_check check (error is null or char_length(error) <= 300)
);

create index finance_package_sends_org_idx on public.finance_package_sends (org_id, requested_at desc);

alter table public.finance_package_sends enable row level security;
create policy "finance_package_sends_select_reader" on public.finance_package_sends
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_package_sends to authenticated;
create trigger guard_impersonation_finance_package_sends after insert or update or delete on public.finance_package_sends
  for each statement execute function public.guard_impersonation_readonly();

/** Who configures the books registers the firm's accountant: one per firm, with the second factor; on the record. */
create or replace function public.save_finance_accountant(target_org uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'configure');
  name_value text := btrim(regexp_replace(coalesce(fields ->> 'name', ''), '\s+', ' ', 'g'));
  email_value text := lower(btrim(coalesce(fields ->> 'email', '')));
  office_value text := nullif(btrim(regexp_replace(coalesce(fields ->> 'office', ''), '\s+', ' ', 'g')), '');
  crc_value text := nullif(upper(regexp_replace(coalesce(fields ->> 'crc', ''), '\s+', '', 'g')), '');
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if char_length(name_value) not between 2 and 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'name');
  end if;
  if email_value !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(email_value) > 254 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'email');
  end if;
  if office_value is not null and char_length(office_value) not between 2 and 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'office');
  end if;
  if crc_value is not null and crc_value !~ '^[A-Z]{2}-?[0-9]{3,8}(/[A-Z0-9]{1,3})?$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'crc');
  end if;
  insert into public.finance_accountants (org_id, name, email, office, crc, set_by)
  values (target_org, name_value, email_value, office_value, crc_value, auth.uid())
  on conflict (org_id) do update set name = excluded.name, email = excluded.email, office = excluded.office,
    crc = excluded.crc, set_by = excluded.set_by, set_at = now();
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.accountant_saved', 'organization', target_org::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.save_finance_accountant(uuid, jsonb) from public, anon;
grant execute on function public.save_finance_accountant(uuid, jsonb) to authenticated;

/** Who configures the books takes the accountant off: nothing more is sent to them. With the second factor. */
create or replace function public.remove_finance_accountant(target_org uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'configure');
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  delete from public.finance_accountants a where a.org_id = target_org;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.accountant_removed', 'organization', target_org::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.remove_finance_accountant(uuid) from public, anon;
grant execute on function public.remove_finance_accountant(uuid) to authenticated;

/**
 * Who operates the books begins sending a month's package to the firm's accountant: only to the address registered,
 * a month that has begun, within the setting's sends of a day; on the record with the month, never the file. Answers
 * where it goes, for the server to send it and say what came of it.
 */
create or replace function public.begin_finance_package_send(target_org uuid, target_month date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  first date := date_trunc('month', target_month)::date;
  accountant public.finance_accountants%rowtype;
  ceiling integer := public.finance_setting('package_sends', 10);
  saved uuid;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if target_month is null or first > date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date)::date then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'month');
  end if;
  select * into accountant from public.finance_accountants a where a.org_id = target_org;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'no_accountant');
  end if;
  if (select count(*) from public.finance_package_sends s
      where s.org_id = target_org and s.requested_at > now() - interval '24 hours') >= ceiling then
    return jsonb_build_object('ok', false, 'code', 'daily_limit', 'limit', ceiling);
  end if;
  insert into public.finance_package_sends (org_id, month, email, requested_by)
  values (target_org, first, accountant.email, auth.uid())
  returning id into saved;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.package_sent', 'organization', target_org::text, jsonb_build_object('month', first));
  return jsonb_build_object('ok', true, 'send_id', saved, 'email', accountant.email, 'name', accountant.name);
end;
$$;

revoke all on function public.begin_finance_package_send(uuid, date) from public, anon;
grant execute on function public.begin_finance_package_send(uuid, date) to authenticated;

/** Who began a sending says what the provider answered: sent, or failed with the provider's words. */
create or replace function public.finish_finance_package_send(target_send uuid, target_sent boolean, target_error text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  update public.finance_package_sends s
  set status = case when target_sent then 'sent' else 'failed' end,
      error = case when target_sent then null else left(nullif(btrim(coalesce(target_error, '')), ''), 300) end,
      finished_at = now()
  where s.id = target_send and s.requested_by = auth.uid() and s.status = 'sending';
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.finish_finance_package_send(uuid, boolean, text) from public, anon;
grant execute on function public.finish_finance_package_send(uuid, boolean, text) to authenticated;
