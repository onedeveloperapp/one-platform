-- ============================================================
-- 0159 · Mais formas de honorários, e a divisão com outro advogado
--
-- What phase 7's first cut left out. A firm's fee terms, and a case's fees,
-- gain:
--   * a monthly fee (`monthly_cents` for `monthly_months` months), written by
--     ONE as bills to receive with the entry and the installments;
--   * a fee per act: per hearing held and per appeal the firm files for the
--     client (`hearing_cents`, `appeal_cents`), each written by ONE as a bill
--     to receive when the act happens, once per act;
--   * the fine and the monthly interest of the contract on a fee paid late
--     (`late_fine_percent`, `late_interest_percent`), which the books add to
--     what a late receivable of fees asks; ONE charges nobody, it says it.
-- And the fees of a case may be split with another lawyer or a law firm
-- (`case_fee_splits`: who, their CPF or CNPJ, their registration at the bar,
-- the percent), never with anybody who is not of the bar (Estatuto, art. 34,
-- III and IV; Código de Ética, art. 50): each fee of the case the firm
-- receives owes each split its part, a bill to pay ONE writes, undone with
-- the payment it came from.
--
--   case_fee_acts_hearing, case_fee_acts_appeal    the bills of the acts;
--   case_fee_splits, save_fee_split, end_fee_split  the split;
--   finance_bill_payments_split                    its bills to pay.
-- ============================================================

alter table public.fee_terms add column monthly_cents bigint not null default 0;
alter table public.fee_terms add column monthly_months integer not null default 0;
alter table public.fee_terms add column hearing_cents bigint not null default 0;
alter table public.fee_terms add column appeal_cents bigint not null default 0;
alter table public.fee_terms add column late_fine_percent numeric(5, 2) not null default 0;
alter table public.fee_terms add column late_interest_percent numeric(5, 2) not null default 0;
alter table public.fee_terms add constraint fee_terms_more_check check (
  monthly_cents >= 0 and monthly_months between 0 and 120 and (monthly_months = 0) = (monthly_cents = 0)
  and hearing_cents >= 0 and appeal_cents >= 0
  and late_fine_percent between 0 and 20 and late_interest_percent between 0 and 10
);

alter table public.case_fees add column monthly_cents bigint not null default 0;
alter table public.case_fees add column monthly_months integer not null default 0;
alter table public.case_fees add column hearing_cents bigint not null default 0;
alter table public.case_fees add column appeal_cents bigint not null default 0;
alter table public.case_fees add column late_fine_percent numeric(5, 2) not null default 0;
alter table public.case_fees add column late_interest_percent numeric(5, 2) not null default 0;
alter table public.case_fees add constraint case_fees_more_check check (
  monthly_cents >= 0 and monthly_months between 0 and 120 and (monthly_months = 0) = (monthly_cents = 0)
  and hearing_cents >= 0 and appeal_cents >= 0
  and late_fine_percent between 0 and 20 and late_interest_percent between 0 and 10
);

-- A bill of an act and a bill of a split, each written once.
alter table public.finance_bills drop constraint finance_bills_source_check;
alter table public.finance_bills add constraint finance_bills_source_check
  check (source in ('manual', 'series', 'renegotiation', 'fees', 'success', 'cost', 'import', 'act', 'split'));
alter table public.finance_bills add column act_key text;
create unique index finance_bills_act_idx on public.finance_bills (org_id, act_key) where act_key is not null;

-- What the firm pays another lawyer of a case's fees, a cost of the services sold.
insert into public.finance_categories (org_id, kind, name, code, dre_line, dfc_line, position)
select null, 'expense', 'Honorários de advogados parceiros', 'despesa.parceiros', 'custo', 'operacional', 32
where not exists (select 1 from public.finance_categories where org_id is null and code = 'despesa.parceiros');
insert into public.finance_categories (org_id, kind, name, code, dre_line, dfc_line, position)
select o.id, 'expense', 'Honorários de advogados parceiros', 'despesa.parceiros', 'custo', 'operacional', 32
from public.organizations o
where o.finance_opened_on is not null
  and not exists (select 1 from public.finance_categories c where c.org_id = o.id and c.code = 'despesa.parceiros');

-- ---------- The acts ----------
/** A fee per act, owed when the act happens (internal): a bill to receive of the case, once per act. */
create or replace function public.case_fee_act_bill(target_case uuid, target_key text, target_cents bigint, target_what text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid := (select c.org_id from public.cases c where c.id = target_case);
  category uuid;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if coalesce(target_cents, 0) <= 0 or (select o.finance_opened_on from public.organizations o where o.id = org) is null then
    return;
  end if;
  select c.id into category from public.finance_categories c
  where c.org_id = org and c.code = 'receita.contratuais' and c.archived_at is null;
  if category is null then
    return;
  end if;
  insert into public.finance_bills (org_id, direction, counterparty, description, category_id, case_id, cents, due_on,
    competence_on, source, by_one, act_key)
  values (org, 'receive', public.case_client_name(target_case), target_what, category, target_case, target_cents,
    today + 7, today, 'act', true, target_key)
  on conflict (org_id, act_key) where act_key is not null do nothing;
end;
$$;

revoke all on function public.case_fee_act_bill(uuid, text, bigint, text) from public, anon, authenticated;

/** A hearing held owes the case's fee per hearing. */
create or replace function public.case_fee_acts_hearing()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'held' and old.status is distinct from 'held' and new.case_id is not null then
    perform public.case_fee_act_bill(new.case_id, 'hearing:' || new.id::text,
      (select f.hearing_cents from public.case_fees f where f.case_id = new.case_id), 'Honorários por audiência');
  end if;
  return new;
end;
$$;

revoke all on function public.case_fee_acts_hearing() from public, anon, authenticated;
create trigger hearings_fee_act after update of status on public.hearings
  for each row execute function public.case_fee_acts_hearing();

/** An appeal the firm files for the client owes the case's fee per appeal. */
create or replace function public.case_fee_acts_appeal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.kind = 'recurso' and new.appeal_by = 'autor' and new.corrected_at is null then
    perform public.case_fee_act_bill(new.case_id, 'appeal:' || new.id::text,
      (select f.appeal_cents from public.case_fees f where f.case_id = new.case_id), 'Honorários por recurso');
  end if;
  return new;
end;
$$;

revoke all on function public.case_fee_acts_appeal() from public, anon, authenticated;
create trigger lawsuit_facts_fee_act after insert on public.lawsuit_facts
  for each row execute function public.case_fee_acts_appeal();

-- ---------- The split with another lawyer ----------
create table public.case_fee_splits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  name text not null,
  -- A lawyer's CPF or a law firm's CNPJ, by its digits.
  document text not null,
  -- The registration at the bar: a lawyer's (UF and number) or a law firm's.
  bar_registration text not null,
  percent numeric(5, 2) not null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references public.profiles (id) on delete set null,
  ended_reason text,
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  constraint case_fee_splits_name_check check (char_length(btrim(name)) between 3 and 120),
  constraint case_fee_splits_document_check check (document ~ '^([0-9]{11}|[0-9]{14})$'),
  constraint case_fee_splits_bar_check check (bar_registration ~ '^[A-Z]{2} [0-9]{1,7}[A-Z]?$'),
  constraint case_fee_splits_percent_check check (percent > 0 and percent < 100),
  constraint case_fee_splits_end_check check ((ended_at is null) = (ended_reason is null))
);

create index case_fee_splits_case_idx on public.case_fee_splits (case_id) where ended_at is null;

alter table public.case_fee_splits enable row level security;
create policy "case_fee_splits_select_reader" on public.case_fee_splits
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.case_fee_splits to authenticated;
create trigger guard_impersonation_case_fee_splits after insert or update or delete on public.case_fee_splits
  for each statement execute function public.guard_impersonation_readonly();

/**
 * A partner, a lawyer or the controladoria who reads the books splits a case's fees with another lawyer or law firm:
 * who, their CPF or CNPJ that checks, their registration at the bar, the percent; the splits of a case never reach
 * 100 percent. Never anybody who is not of the bar (the database asks the registration). On the record.
 */
create or replace function public.save_fee_split(target_case uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  digits text := regexp_replace(coalesce(fields ->> 'document', ''), '\D', '', 'g');
  bar text := upper(btrim(regexp_replace(coalesce(fields ->> 'bar_registration', ''), '\s+', ' ', 'g')));
  share numeric;
  saved uuid;
begin
  select * into current_case from public.cases where id = target_case;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if auth.uid() is null or not public.is_org_member(current_case.org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.finance_reads(current_case.org_id)
     or not public.has_firm_function(current_case.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  if char_length(digits) = 11 and not public.cpf_is_valid(digits) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'document');
  end if;
  if char_length(digits) not in (11, 14) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'document');
  end if;
  bar := regexp_replace(bar, '^OAB[/ -]*', '');
  bar := regexp_replace(bar, '^([A-Z]{2})[/ -]*', '\1 ');
  if bar !~ '^[A-Z]{2} [0-9]{1,7}[A-Z]?$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'bar_registration');
  end if;
  if coalesce(fields ->> 'percent', '') !~ '^[0-9]{1,2}(\.[0-9]{1,2})?$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'percent');
  end if;
  share := (fields ->> 'percent')::numeric;
  if share <= 0 or share + coalesce((select sum(s.percent) from public.case_fee_splits s
                                       where s.case_id = target_case and s.ended_at is null), 0) >= 100 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'percent');
  end if;
  begin
    insert into public.case_fee_splits (org_id, case_id, name, document, bar_registration, percent, created_by)
    values (current_case.org_id, target_case, btrim(fields ->> 'name'), digits, bar, share, auth.uid())
    returning id into saved;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'name');
  end;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'fees.split_saved', 'case', target_case::text,
    jsonb_build_object('split', saved, 'percent', share));
  return jsonb_build_object('ok', true, 'split_id', saved);
end;
$$;

revoke all on function public.save_fee_split(uuid, jsonb) from public, anon;
grant execute on function public.save_fee_split(uuid, jsonb) to authenticated;

/** A split ends with its reason (the second factor): the bills already written of it stay. */
create or replace function public.end_fee_split(target_split uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  split public.case_fee_splits%rowtype;
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
begin
  select * into split from public.case_fee_splits where id = target_split;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if auth.uid() is null or not public.is_org_member(split.org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.finance_reads(split.org_id)
     or not public.has_firm_function(split.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  if reason is null or char_length(reason) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'reason');
  end if;
  update public.case_fee_splits set ended_at = now(), ended_by = auth.uid(), ended_reason = reason
  where id = split.id and ended_at is null;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (split.org_id, auth.uid(), 'fees.split_ended', 'case', split.case_id::text, jsonb_build_object('split', split.id));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.end_fee_split(uuid, text) from public, anon;
grant execute on function public.end_fee_split(uuid, text) to authenticated;

/**
 * A fee of a case the firm received (a payment of a bill of the case's fees: the entry, an installment, a month, an
 * act, the success) owes each split in force its part, a bill to pay ONE writes, once per payment and split; the
 * payment undone cancels what of it nobody paid.
 */
create or replace function public.finance_bill_payments_split()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bill public.finance_bills%rowtype;
  split public.case_fee_splits%rowtype;
  category uuid;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  seq integer;
begin
  select * into bill from public.finance_bills where id = new.bill_id;
  if tg_op = 'UPDATE' then
    if new.undone_at is not null and old.undone_at is null then
      update public.finance_bills
      set status = 'cancelled', closed_reason = 'O recebimento dos honorários foi desfeito.', closed_at = now()
      where org_id = new.org_id and act_key like 'split:' || new.id::text || ':%' and status = 'open' and paid_cents = 0;
    end if;
    return new;
  end if;
  if not found or bill.direction <> 'receive' or bill.case_id is null or bill.source not in ('fees', 'success', 'act') then
    return new;
  end if;
  select c.id into category from public.finance_categories c
  where c.org_id = bill.org_id and c.code = 'despesa.parceiros' and c.archived_at is null;
  if category is null then
    return new;
  end if;
  seq := (select c.seq from public.cases c where c.id = bill.case_id);
  for split in
    select * from public.case_fee_splits s where s.case_id = bill.case_id and s.ended_at is null
  loop
    insert into public.finance_bills (org_id, direction, counterparty, description, category_id, case_id, cents, due_on,
      competence_on, source, by_one, act_key)
    values (bill.org_id, 'pay', split.name, left('Parte dos honorários do caso nº ' || seq || ' (' || split.percent || '%)', 300),
      category, bill.case_id, greatest(round(new.base_cents * split.percent / 100)::bigint, 1), today + 5, today,
      'split', true, 'split:' || new.id::text || ':' || split.id::text)
    on conflict (org_id, act_key) where act_key is not null do nothing;
  end loop;
  return new;
end;
$$;

revoke all on function public.finance_bill_payments_split() from public, anon, authenticated;
create trigger finance_bill_payments_split after insert or update of undone_at on public.finance_bill_payments
  for each row execute function public.finance_bill_payments_split();

-- ---------- The terms and the fees of a case, with the new forms (redefined from 0131) ----------
/** Who decides for the firm confirms how it charges (0131), the monthly fee, the acts and the late charges (0159). */
create or replace function public.save_fee_terms(target_org uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  module_value text := nullif(btrim(coalesce(fields ->> 'module', '')), '');
  incident_value text := nullif(btrim(coalesce(fields ->> 'incident', '')), '');
  number_of text;
  saved uuid;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  foreach number_of in array array['entry_cents', 'installments', 'installment_cents', 'success_min_cents', 'monthly_cents', 'monthly_months', 'hearing_cents', 'appeal_cents'] loop
    if coalesce(fields ->> number_of, '0') !~ '^[0-9]{1,12}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', number_of);
    end if;
  end loop;
  if coalesce(fields ->> 'success_percent', '0') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$'
     or (fields ->> 'settlement_percent' is not null and fields ->> 'settlement_percent' <> ''
         and fields ->> 'settlement_percent' !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'percent');
  end if;
  foreach number_of in array array['late_fine_percent', 'late_interest_percent'] loop
    if coalesce(fields ->> number_of, '0') !~ '^[0-9]{1,2}(\.[0-9]{1,2})?$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', number_of);
    end if;
  end loop;
  update public.fee_terms set archived_at = now()
  where org_id = target_org and coalesce(module, '') = coalesce(module_value, '')
    and coalesce(incident, '') = coalesce(incident_value, '') and archived_at is null;
  begin
    insert into public.fee_terms (org_id, module, incident, entry_cents, installments, installment_cents, success_percent,
      success_min_cents, settlement_percent, confirmed_by, monthly_cents, monthly_months, hearing_cents, appeal_cents, late_fine_percent, late_interest_percent)
    values (target_org, module_value, incident_value, coalesce((fields ->> 'entry_cents')::bigint, 0),
      coalesce((fields ->> 'installments')::integer, 0), coalesce((fields ->> 'installment_cents')::bigint, 0),
      coalesce((fields ->> 'success_percent')::numeric, 0), coalesce((fields ->> 'success_min_cents')::bigint, 0),
      nullif(fields ->> 'settlement_percent', '')::numeric, auth.uid(),
      coalesce((fields ->> 'monthly_cents')::bigint, 0), coalesce((fields ->> 'monthly_months')::integer, 0),
      coalesce((fields ->> 'hearing_cents')::bigint, 0), coalesce((fields ->> 'appeal_cents')::bigint, 0),
      coalesce(nullif(fields ->> 'late_fine_percent', '')::numeric, 0),
      coalesce(nullif(fields ->> 'late_interest_percent', '')::numeric, 0))
    returning id into saved;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'values');
  end;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'fees.terms_confirmed', 'fee_terms', saved::text,
    jsonb_build_object('module', module_value, 'incident', incident_value));
  return jsonb_build_object('ok', true, 'terms_id', saved);
end;
$$;

revoke all on function public.save_fee_terms(uuid, jsonb) from public, anon;
grant execute on function public.save_fee_terms(uuid, jsonb) to authenticated;

/** The fees of a case become bills to receive (0131), the monthly fee included (0159). Internal. */
create or replace function public.case_fees_bills(target_case uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  fees public.case_fees%rowtype;
  category uuid;
  client text := public.case_client_name(target_case);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  written integer := 0;
  series uuid := gen_random_uuid();
  turn integer;
begin
  select * into fees from public.case_fees where case_id = target_case for update;
  if not found or fees.bills_at is not null then
    return 0;
  end if;
  if (select o.finance_opened_on from public.organizations o where o.id = fees.org_id) is null then
    return 0;
  end if;
  select c.id into category from public.finance_categories c
  where c.org_id = fees.org_id and c.code = 'receita.contratuais' and c.archived_at is null;
  if category is null then
    return 0;
  end if;
  if fees.entry_cents > 0 then
    insert into public.finance_bills (org_id, direction, counterparty, description, category_id, case_id, cents, due_on,
      competence_on, source, by_one)
    values (fees.org_id, 'receive', client, 'Entrada dos honorários', category, target_case, fees.entry_cents,
      today + 7, today + 7, 'fees', true);
    written := written + 1;
  end if;
  for turn in 1 .. fees.installments loop
    insert into public.finance_bills (org_id, direction, counterparty, description, category_id, case_id, cents, due_on,
      competence_on, series_id, series_index, series_total, source, by_one)
    values (fees.org_id, 'receive', client, 'Parcela dos honorários', category, target_case, fees.installment_cents,
      (today + make_interval(months => turn))::date, (today + make_interval(months => turn))::date, series, turn,
      fees.installments, 'fees', true);
    written := written + 1;
  end loop;
  -- The monthly fee (0159): one bill a month, from the month after the contract, as many months as the fees say.
  series := gen_random_uuid();
  for turn in 1 .. fees.monthly_months loop
    insert into public.finance_bills (org_id, direction, counterparty, description, category_id, case_id, cents, due_on,
      competence_on, series_id, series_index, series_total, source, by_one)
    values (fees.org_id, 'receive', client, 'Mensalidade dos honorários', category, target_case, fees.monthly_cents,
      (today + make_interval(months => turn))::date, (today + make_interval(months => turn))::date, series, turn,
      fees.monthly_months, 'fees', true);
    written := written + 1;
  end loop;
  update public.case_fees set bills_at = now() where case_id = target_case;
  return written;
end;
$$;

revoke all on function public.case_fees_bills(uuid) from public, anon, authenticated;

/** When a client signs the fee contract, the firm's terms in force are the case's (0131), every form (0159). */
create or replace function public.case_fees_on_contract()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  paper record;
  terms public.fee_terms%rowtype;
begin
  if new.status <> 'signed' or old.status = 'signed' then
    return new;
  end if;
  for paper in
    select p.case_id, p.org_id from public.case_papers p where p.envelope_id = new.id and p.kind = 'contrato'
  loop
    if not exists (select 1 from public.case_fees f where f.case_id = paper.case_id) then
      terms := public.fee_terms_for(paper.case_id);
      if terms.id is not null then
        insert into public.case_fees (case_id, org_id, terms_id, entry_cents, installments, installment_cents,
          success_percent, success_min_cents, settlement_percent, source, monthly_cents, monthly_months, hearing_cents, appeal_cents, late_fine_percent, late_interest_percent)
        values (paper.case_id, paper.org_id, terms.id, terms.entry_cents, terms.installments, terms.installment_cents,
          terms.success_percent, terms.success_min_cents, terms.settlement_percent, 'terms', terms.monthly_cents,
          terms.monthly_months, terms.hearing_cents, terms.appeal_cents, terms.late_fine_percent,
          terms.late_interest_percent);
        perform public.record_case_event(paper.org_id, paper.case_id, 'fees_set', 'system', jsonb_build_object('source', 'terms'));
      end if;
    end if;
    perform public.case_fees_bills(paper.case_id);
  end loop;
  return new;
end;
$$;

revoke all on function public.case_fees_on_contract() from public, anon, authenticated;

/** A person sets the fees of a case (0131), every form (0159). */
create or replace function public.save_case_fees(target_case uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  terms public.fee_terms%rowtype;
  number_of text;
  written integer;
begin
  select * into current_case from public.cases where id = target_case;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if auth.uid() is null or not public.is_org_member(current_case.org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.finance_reads(current_case.org_id)
     or not public.has_firm_function(current_case.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if exists (select 1 from public.case_fees f where f.case_id = target_case and f.bills_at is not null) then
    return jsonb_build_object('ok', false, 'code', 'fees_billed');
  end if;
  if coalesce(fields ->> 'from_terms', '') = 'true' then
    terms := public.fee_terms_for(target_case);
    if terms.id is null then
      return jsonb_build_object('ok', false, 'code', 'no_terms');
    end if;
    fields := jsonb_build_object('entry_cents', terms.entry_cents::text, 'installments', terms.installments::text,
      'installment_cents', terms.installment_cents::text, 'success_percent', terms.success_percent::text,
      'success_min_cents', terms.success_min_cents::text, 'settlement_percent', coalesce(terms.settlement_percent::text, ''),
      'monthly_cents', terms.monthly_cents::text, 'monthly_months', terms.monthly_months::text,
      'hearing_cents', terms.hearing_cents::text, 'appeal_cents', terms.appeal_cents::text,
      'late_fine_percent', terms.late_fine_percent::text, 'late_interest_percent', terms.late_interest_percent::text);
  end if;
  foreach number_of in array array['entry_cents', 'installments', 'installment_cents', 'success_min_cents', 'monthly_cents', 'monthly_months', 'hearing_cents', 'appeal_cents'] loop
    if coalesce(fields ->> number_of, '0') !~ '^[0-9]{1,12}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', number_of);
    end if;
  end loop;
  if coalesce(fields ->> 'success_percent', '0') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'percent');
  end if;
  foreach number_of in array array['late_fine_percent', 'late_interest_percent'] loop
    if coalesce(fields ->> number_of, '0') !~ '^[0-9]{1,2}(\.[0-9]{1,2})?$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', number_of);
    end if;
  end loop;
  begin
    insert into public.case_fees (case_id, org_id, terms_id, entry_cents, installments, installment_cents, success_percent,
      success_min_cents, settlement_percent, source, set_by, monthly_cents, monthly_months, hearing_cents, appeal_cents, late_fine_percent, late_interest_percent)
    values (target_case, current_case.org_id, terms.id, coalesce((fields ->> 'entry_cents')::bigint, 0),
      coalesce((fields ->> 'installments')::integer, 0), coalesce((fields ->> 'installment_cents')::bigint, 0),
      coalesce((fields ->> 'success_percent')::numeric, 0), coalesce((fields ->> 'success_min_cents')::bigint, 0),
      nullif(fields ->> 'settlement_percent', '')::numeric, case when terms.id is not null then 'terms' else 'person' end,
      auth.uid(), coalesce((fields ->> 'monthly_cents')::bigint, 0), coalesce((fields ->> 'monthly_months')::integer, 0),
      coalesce((fields ->> 'hearing_cents')::bigint, 0), coalesce((fields ->> 'appeal_cents')::bigint, 0),
      coalesce(nullif(fields ->> 'late_fine_percent', '')::numeric, 0),
      coalesce(nullif(fields ->> 'late_interest_percent', '')::numeric, 0))
    on conflict (case_id) do update set entry_cents = excluded.entry_cents, installments = excluded.installments,
      installment_cents = excluded.installment_cents, success_percent = excluded.success_percent,
      success_min_cents = excluded.success_min_cents, settlement_percent = excluded.settlement_percent,
      source = excluded.source, terms_id = excluded.terms_id, set_by = excluded.set_by, set_at = now(),
      monthly_cents = excluded.monthly_cents, monthly_months = excluded.monthly_months,
      hearing_cents = excluded.hearing_cents, appeal_cents = excluded.appeal_cents,
      late_fine_percent = excluded.late_fine_percent, late_interest_percent = excluded.late_interest_percent;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'values');
  end;
  written := public.case_fees_bills(target_case);
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'fees.case_set', 'case', target_case::text, jsonb_build_object('bills', written));
  perform public.record_case_event(current_case.org_id, target_case, 'fees_set', 'person', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'bills', written);
end;
$$;

revoke all on function public.save_case_fees(uuid, jsonb) from public, anon;
grant execute on function public.save_case_fees(uuid, jsonb) to authenticated;
