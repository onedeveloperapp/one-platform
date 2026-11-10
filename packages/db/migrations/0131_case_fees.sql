-- ============================================================
-- 0131 · Honorários e custos do caso
--
-- Phase 7 of the plan of the controladoria, the outcome of the cases and the
-- firm's finance, its first cut. How the firm charges is its fee terms
-- (`fee_terms`), confirmed once per module and kind of problem by who
-- decides for the firm, with the second factor (decision 4): an entry, a
-- number of installments, a fixed value, and a share of success, with its
-- minimum and its share of a settlement. When the client signs the fee
-- contract, the terms in force are the case's (`case_fees`), and, where the
-- books are open, ONE writes the entry and the installments as bills to
-- receive of the case; when a release the firm registered as received
-- arrives, ONE writes the success fee as a bill to receive. ONE never
-- charges the client: those bills are "Para cobrar ou informar". The costs
-- of a case (`case_costs`) are written by anybody of the firm who works on
-- it: what was paid, by whom, and who owes it back; one the client owes is a
-- bill to receive of the reimbursement where the books are open. Who reads
-- only the costs of the cases reads the costs and nothing of the fees. The
-- books say how many cases in court have no fees set.
-- ============================================================

-- ---------- The fee terms of the firm ----------
create table public.fee_terms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  -- The module and the kind of problem they are of; null is every one.
  module text,
  incident text,
  entry_cents bigint not null default 0,
  installments integer not null default 0,
  installment_cents bigint not null default 0,
  success_percent numeric(5, 2) not null default 0,
  success_min_cents bigint not null default 0,
  -- The share of a settlement, when it is another one than the success's.
  settlement_percent numeric(5, 2),
  confirmed_by uuid references public.profiles (id) on delete set null,
  confirmed_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint fee_terms_values_check check (
    entry_cents >= 0 and installments between 0 and 60 and installment_cents >= 0
    and (installments = 0) = (installment_cents = 0)
    and success_percent between 0 and 100 and success_min_cents >= 0
    and (settlement_percent is null or settlement_percent between 0 and 100)
  )
);

create unique index fee_terms_scope_idx on public.fee_terms (org_id, coalesce(module, ''), coalesce(incident, ''))
  where archived_at is null;

alter table public.fee_terms enable row level security;
create policy "fee_terms_select_reader" on public.fee_terms
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.fee_terms to authenticated;
create trigger guard_impersonation_fee_terms after insert or update or delete on public.fee_terms
  for each statement execute function public.guard_impersonation_readonly();

/**
 * Who decides for the firm confirms how it charges a module and a kind of problem (or every one), with the second
 * factor (decision 4); the terms before are archived, never deleted. Nothing of it is a value a client sees.
 */
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
  foreach number_of in array array['entry_cents', 'installments', 'installment_cents', 'success_min_cents'] loop
    if coalesce(fields ->> number_of, '0') !~ '^[0-9]{1,12}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', number_of);
    end if;
  end loop;
  if coalesce(fields ->> 'success_percent', '0') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$'
     or (fields ->> 'settlement_percent' is not null and fields ->> 'settlement_percent' <> ''
         and fields ->> 'settlement_percent' !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'percent');
  end if;
  update public.fee_terms set archived_at = now()
  where org_id = target_org and coalesce(module, '') = coalesce(module_value, '')
    and coalesce(incident, '') = coalesce(incident_value, '') and archived_at is null;
  begin
    insert into public.fee_terms (org_id, module, incident, entry_cents, installments, installment_cents, success_percent,
      success_min_cents, settlement_percent, confirmed_by)
    values (target_org, module_value, incident_value, coalesce((fields ->> 'entry_cents')::bigint, 0),
      coalesce((fields ->> 'installments')::integer, 0), coalesce((fields ->> 'installment_cents')::bigint, 0),
      coalesce((fields ->> 'success_percent')::numeric, 0), coalesce((fields ->> 'success_min_cents')::bigint, 0),
      nullif(fields ->> 'settlement_percent', '')::numeric, auth.uid())
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

-- ---------- The fees of a case ----------
create table public.case_fees (
  case_id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  terms_id uuid references public.fee_terms (id) on delete set null,
  entry_cents bigint not null default 0,
  installments integer not null default 0,
  installment_cents bigint not null default 0,
  success_percent numeric(5, 2) not null default 0,
  success_min_cents bigint not null default 0,
  settlement_percent numeric(5, 2),
  -- From the firm's terms when the contract was signed, or a person's for this case.
  source text not null,
  set_by uuid references public.profiles (id) on delete set null,
  set_at timestamptz not null default now(),
  -- ONE wrote the entry and the installments as bills to receive.
  bills_at timestamptz,
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  constraint case_fees_source_check check (source in ('terms', 'person'))
);

alter table public.case_fees enable row level security;
create policy "case_fees_select_reader" on public.case_fees
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.case_fees to authenticated;
create trigger guard_impersonation_case_fees after insert or update or delete on public.case_fees
  for each statement execute function public.guard_impersonation_readonly();

-- A bill ONE wrote from the fees of a case, and the fact of the result it came from.
alter table public.finance_bills drop constraint finance_bills_source_check;
alter table public.finance_bills add constraint finance_bills_source_check
  check (source in ('manual', 'series', 'renegotiation', 'fees', 'success', 'cost'));
alter table public.finance_bills add column fact_id uuid references public.lawsuit_facts (id) on delete set null;
create unique index finance_bills_fact_idx on public.finance_bills (fact_id) where fact_id is not null;

/** The client of a case, as a bill names who it is of: its first adult claimant. Internal. */
create or replace function public.case_client_name(target_case uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.full_name from public.case_parties cp join public.people p on p.id = cp.person_id
  where cp.case_id = target_case and cp.role = 'claimant'
  order by cp.created_at limit 1;
$$;

revoke all on function public.case_client_name(uuid) from public, anon, authenticated;

/**
 * The fees of a case become bills to receive (internal), where the books are open and no bill was written of them yet:
 * the entry, due in a week, and each installment a month apart, of the firm's category of contractual fees.
 */
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
  update public.case_fees set bills_at = now() where case_id = target_case;
  return written;
end;
$$;

revoke all on function public.case_fees_bills(uuid) from public, anon, authenticated;

/**
 * The fee terms in force for a case (internal): its module and kind of problem, else its module, else every one.
 */
create or replace function public.fee_terms_for(target_case uuid)
returns public.fee_terms
language sql
stable
security definer
set search_path = public
as $$
  select t.* from public.fee_terms t join public.cases c on c.org_id = t.org_id
  where c.id = target_case and t.archived_at is null
    and (t.module is null or t.module = c.module) and (t.incident is null or t.incident = c.incident)
  order by (t.module is not null and t.incident is not null) desc, (t.module is not null) desc, (t.incident is not null) desc
  limit 1;
$$;

revoke all on function public.fee_terms_for(uuid) from public, anon, authenticated;

/** When a client signs the fee contract, the firm's terms in force are the case's, and ONE writes its bills. */
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
          success_percent, success_min_cents, settlement_percent, source)
        values (paper.case_id, paper.org_id, terms.id, terms.entry_cents, terms.installments, terms.installment_cents,
          terms.success_percent, terms.success_min_cents, terms.settlement_percent, 'terms');
        perform public.record_case_event(paper.org_id, paper.case_id, 'fees_set', 'system', jsonb_build_object('source', 'terms'));
      end if;
    end if;
    perform public.case_fees_bills(paper.case_id);
  end loop;
  return new;
end;
$$;

revoke all on function public.case_fees_on_contract() from public, anon, authenticated;
create trigger signature_envelopes_case_fees after update of status on public.signature_envelopes
  for each row execute function public.case_fees_on_contract();

/**
 * A partner, a lawyer or the controladoria sets the fees of a case by hand (one whose contract was signed outside
 * ONE, or imported), or from the firm's terms in force; ONE then writes the bills, where the books are open.
 */
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
      'success_min_cents', terms.success_min_cents::text, 'settlement_percent', coalesce(terms.settlement_percent::text, ''));
  end if;
  foreach number_of in array array['entry_cents', 'installments', 'installment_cents', 'success_min_cents'] loop
    if coalesce(fields ->> number_of, '0') !~ '^[0-9]{1,12}$' then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', number_of);
    end if;
  end loop;
  if coalesce(fields ->> 'success_percent', '0') !~ '^[0-9]{1,3}(\.[0-9]{1,2})?$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'percent');
  end if;
  begin
    insert into public.case_fees (case_id, org_id, terms_id, entry_cents, installments, installment_cents, success_percent,
      success_min_cents, settlement_percent, source, set_by)
    values (target_case, current_case.org_id, terms.id, coalesce((fields ->> 'entry_cents')::bigint, 0),
      coalesce((fields ->> 'installments')::integer, 0), coalesce((fields ->> 'installment_cents')::bigint, 0),
      coalesce((fields ->> 'success_percent')::numeric, 0), coalesce((fields ->> 'success_min_cents')::bigint, 0),
      nullif(fields ->> 'settlement_percent', '')::numeric, case when terms.id is not null then 'terms' else 'person' end,
      auth.uid())
    on conflict (case_id) do update set entry_cents = excluded.entry_cents, installments = excluded.installments,
      installment_cents = excluded.installment_cents, success_percent = excluded.success_percent,
      success_min_cents = excluded.success_min_cents, settlement_percent = excluded.settlement_percent,
      source = excluded.source, terms_id = excluded.terms_id, set_by = excluded.set_by, set_at = now();
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

-- ---------- The success fee, when a release is received ----------
/**
 * When a release the firm registered as received arrives (0130), ONE writes the success fee as a bill to receive of
 * the case, once per release, where the books are open and the case has a share of success: the share of a
 * settlement's release when the case has one, the success's otherwise, never under its minimum.
 */
create or replace function public.lawsuit_facts_success_fee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fees public.case_fees%rowtype;
  share numeric;
  amount bigint;
  category uuid;
  settled boolean;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if new.kind <> 'alvara' or new.received_on is null or old.received_on is not null or coalesce(new.received_cents, 0) <= 0
     or new.corrected_at is not null then
    return new;
  end if;
  select * into fees from public.case_fees where case_id = new.case_id;
  if not found or fees.success_percent <= 0 then
    return new;
  end if;
  if (select o.finance_opened_on from public.organizations o where o.id = new.org_id) is null then
    return new;
  end if;
  select c.id into category from public.finance_categories c
  where c.org_id = new.org_id and c.code = 'receita.exito' and c.archived_at is null;
  if category is null then
    return new;
  end if;
  settled := exists (select 1 from public.lawsuit_facts f where f.proceeding_id = new.proceeding_id and f.kind = 'acordo'
                     and f.corrected_at is null);
  share := case when settled and fees.settlement_percent is not null then fees.settlement_percent else fees.success_percent end;
  amount := greatest(round(new.received_cents * share / 100)::bigint, fees.success_min_cents);
  if amount <= 0 then
    return new;
  end if;
  insert into public.finance_bills (org_id, direction, counterparty, description, category_id, case_id, cents, due_on,
    competence_on, source, by_one, fact_id)
  values (new.org_id, 'receive', public.case_client_name(new.case_id), 'Honorários de êxito', category, new.case_id, amount,
    today + 5, today, 'success', true, new.id)
  on conflict (fact_id) where fact_id is not null do nothing;
  return new;
end;
$$;

revoke all on function public.lawsuit_facts_success_fee() from public, anon, authenticated;
create trigger lawsuit_facts_success_fee after update of received_on on public.lawsuit_facts
  for each row execute function public.lawsuit_facts_success_fee();

-- ---------- The costs of a case ----------
create table public.case_costs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  description text not null,
  cents bigint not null,
  spent_on date not null,
  -- Who paid it: the firm or the client; and who owes it back to the firm, when anybody does.
  paid_by text not null,
  owed_by text,
  file_id uuid references public.files (id) on delete set null,
  bill_id uuid references public.finance_bills (id) on delete set null,
  absorbed_at timestamptz,
  absorbed_by uuid references public.profiles (id) on delete set null,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  constraint case_costs_cents_check check (cents > 0),
  constraint case_costs_text_check check (char_length(description) between 2 and 200),
  constraint case_costs_paid_check check (paid_by in ('firm', 'client')),
  constraint case_costs_owed_check check (owed_by is null or (paid_by = 'firm' and owed_by in ('client', 're')))
);

create index case_costs_case_idx on public.case_costs (case_id, spent_on);

alter table public.case_costs enable row level security;
create policy "case_costs_select_member" on public.case_costs
  for select to authenticated using (public.is_org_member(org_id));
grant select on table public.case_costs to authenticated;
create trigger guard_impersonation_case_costs after insert or update or delete on public.case_costs
  for each statement execute function public.guard_impersonation_readonly();

/**
 * Anybody of the firm who works on a case writes a cost of it (never a support visit): what, how much, when, who paid
 * and who owes it back. A cost the firm paid and the client owes is, where the books are open, a bill to receive of
 * the reimbursement, which the person never sees as the firm's money.
 */
create or replace function public.save_case_cost(target_case uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  description_value text := btrim(regexp_replace(coalesce(fields ->> 'description', ''), '\s+', ' ', 'g'));
  paid_value text := coalesce(nullif(fields ->> 'paid_by', ''), 'firm');
  owed_value text := nullif(fields ->> 'owed_by', '');
  day_value date;
  cents_value bigint;
  file_value uuid;
  category uuid;
  bill uuid;
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
  if coalesce(fields ->> 'cents', '') !~ '^[0-9]{1,12}$' or (fields ->> 'cents')::bigint <= 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'cents');
  end if;
  cents_value := (fields ->> 'cents')::bigint;
  begin
    day_value := (fields ->> 'spent_on')::date;
    file_value := nullif(fields ->> 'file_id', '')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'spent_on');
  end;
  if day_value is null or day_value > (now() at time zone 'America/Sao_Paulo')::date then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'spent_on');
  end if;
  if char_length(description_value) not between 2 and 200 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'description');
  end if;
  if file_value is not null and not exists (
    select 1 from public.files f where f.id = file_value and f.org_id = current_case.org_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'file');
  end if;
  begin
    insert into public.case_costs (org_id, case_id, description, cents, spent_on, paid_by, owed_by, file_id, created_by)
    values (current_case.org_id, current_case.id, description_value, cents_value, day_value, paid_value, owed_value,
      file_value, auth.uid())
    returning id into saved;
  exception when check_violation then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'paid_by');
  end;
  if paid_value = 'firm' and owed_value = 'client'
     and (select o.finance_opened_on from public.organizations o where o.id = current_case.org_id) is not null then
    select c.id into category from public.finance_categories c
    where c.org_id = current_case.org_id and c.code = 'receita.reembolso' and c.archived_at is null;
    if category is not null then
      insert into public.finance_bills (org_id, direction, counterparty, description, category_id, case_id, cents, due_on,
        competence_on, source)
      values (current_case.org_id, 'receive', public.case_client_name(current_case.id), left('Reembolso: ' || description_value, 300),
        category, current_case.id, cents_value, (now() at time zone 'America/Sao_Paulo')::date + 30,
        (now() at time zone 'America/Sao_Paulo')::date, 'cost')
      returning id into bill;
      update public.case_costs set bill_id = bill where id = saved;
    end if;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'fees.cost_written', 'case_cost', saved::text, '{}'::jsonb);
  perform public.record_case_event(current_case.org_id, current_case.id, 'cost_written', 'person', '{}'::jsonb);
  return jsonb_build_object('ok', true, 'cost_id', saved, 'bill_id', bill);
end;
$$;

revoke all on function public.save_case_cost(uuid, jsonb) from public, anon;
grant execute on function public.save_case_cost(uuid, jsonb) to authenticated;

/**
 * Who decides for the firm, or who operates the books, absorbs a cost the client owed (the lawsuit ended with no
 * release): the reimbursement's bill is cancelled with the reason, never deleted.
 */
create or replace function public.absorb_case_cost(target_cost uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cost public.case_costs%rowtype;
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
begin
  select * into cost from public.case_costs where id = target_cost for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if auth.uid() is null or not public.is_org_member(cost.org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if public.finance_level(cost.org_id) not in ('operate', 'configure') then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if reason is null or char_length(reason) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'reason');
  end if;
  update public.case_costs set absorbed_at = now(), absorbed_by = auth.uid() where id = cost.id and absorbed_at is null;
  update public.finance_bills set status = 'cancelled', closed_at = now(), closed_by = auth.uid(), closed_reason = reason
  where id = cost.bill_id and status = 'open';
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (cost.org_id, auth.uid(), 'fees.cost_absorbed', 'case_cost', cost.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.absorb_case_cost(uuid, text) from public, anon;
grant execute on function public.absorb_case_cost(uuid, text) to authenticated;

-- ---------- What waits: the cases in court with no fees ----------
/** What waits for somebody of the books, the cases in court with no fees among it (0131). */
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
    'bills', (
      select jsonb_build_object(
        'pay_soon', count(*) filter (where bl.direction = 'pay' and bl.due_on between b.today and b.today + soon),
        'pay_soon_cents', coalesce(sum(bl.cents - bl.paid_cents) filter (
          where bl.direction = 'pay' and bl.due_on between b.today and b.today + soon), 0),
        'pay_late', count(*) filter (where bl.direction = 'pay' and bl.due_on < b.today),
        'pay_late_cents', coalesce(sum(bl.cents - bl.paid_cents) filter (
          where bl.direction = 'pay' and bl.due_on < b.today), 0),
        'receive_late', count(*) filter (where bl.direction = 'receive' and bl.due_on < b.today),
        'receive_late_cents', coalesce(sum(bl.cents - bl.paid_cents) filter (
          where bl.direction = 'receive' and bl.due_on < b.today), 0),
        -- A receivable near the five years in which fees may be charged (Estatuto da Advocacia, art. 25).
        'receive_old', count(*) filter (where bl.direction = 'receive'
          and bl.due_on < (b.today - make_interval(years => old_years) + interval '6 months')::date)
      )
      from public.finance_bills bl
      cross join books b
      cross join (select public.finance_setting('bill_soon_days', 7) as soon,
                         public.finance_setting('bill_old_years', 5) as old_years) s
      where bl.org_id = target_org and bl.status = 'open'
    ),
    -- The cases in court with no fees set (0131), before any release.
    'fees_missing', (
      select count(*) from public.cases c
      where c.org_id = target_org and c.status = 'filed' and not c.is_test
        and not exists (select 1 from public.case_fees f where f.case_id = c.id)
    ),
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

-- ---------- The case screen follows the fees and the costs ----------
/** The mark of what the case screen shows, the fees and the costs among it (0131). */
create or replace function public.case_pulse(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  advance public.case_advances%rowtype;
  stale integer := greatest(public.case_advance_setting('stale_minutes', 15), 1);
  stamp text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    raise exception 'case_not_found' using errcode = 'P0002';
  end if;
  select * into advance from public.case_advances where case_id = target_case;

  select md5(concat_ws('|',
    current_case::text,
    (select concat(count(*), '/', max(e.at)) from public.case_events e where e.case_id = target_case),
    (select concat(a.waiting, '/', a.checked_at, '/', a.waiting_since, '/', a.claimed_at, '/', a.woken_at, '/', a.after)
       from public.case_advances a where a.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_parties t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.people t
       where t.id in (select cp.person_id from public.case_parties cp where cp.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.flight_segments t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.flight_checks t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_documents t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_statements t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_interviews t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_interview_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_links t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_consents t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.signature_envelopes t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_papers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.civil_court_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.residence_declarations t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.free_justice_answers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.proceedings t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.proceeding_parties t
       where t.proceeding_id in (select p.id from public.proceedings p where p.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t::text), '')) from public.proceeding_lawyers t
       where t.proceeding_id in (select p.id from public.proceedings p where p.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.proceeding_tracking t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_drafts t where t.case_id = target_case),
    (select concat(count(*), '/', max(v.created_at)) from public.case_draft_versions v
       where v.draft_id in (select d.id from public.case_drafts d where d.case_id = target_case)),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.filing_packages t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.dossiers t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.deadlines t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.hearings t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.client_notices t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.admin_complaints t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.lawsuit_facts t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.case_costs t where t.case_id = target_case),
    (select md5(coalesce(string_agg(t::text, ','), '')) from public.case_fees t where t.case_id = target_case),
    -- Of a publication, only what a member reads of it: never the AI's word in the shadow.
    (select md5(coalesce(string_agg(concat_ws(',', t.id, t.category, t.triaged_at, t.active, t.cancel_seen_at,
        t.review_due, t.judgment, t.judgment_source, t.ack_owed, t.acked_at), ';' order by t.id), ''))
       from public.publications t where t.case_id = target_case),
    (select md5(coalesce(string_agg(concat_ws(',', r.publication_id, r.kind, r.status, r.reason, r.updated_at), ';'
        order by r.publication_id, r.kind), ''))
       from public.publication_readings r
       where r.publication_id in (select p.id from public.publications p where p.case_id = target_case))
  )) into stamp;

  return jsonb_build_object(
    'stamp', stamp,
    'advance', jsonb_build_object(
      'running', coalesce(advance.claimed_at is not null and advance.claimed_at > now() - make_interval(mins => stale), false),
      'due', coalesce(advance.woken_at is not null
        and (advance.checked_at is null or advance.woken_at > advance.checked_at)
        and (advance.after is null or advance.after <= now()), false),
      'waiting_since', advance.waiting_since,
      'checked_at', advance.checked_at
    )
  );
end;
$$;

revoke all on function public.case_pulse(uuid) from public, anon;
grant execute on function public.case_pulse(uuid) to authenticated;
