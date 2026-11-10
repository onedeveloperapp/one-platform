-- ============================================================
-- 0135 · O dinheiro do cliente: o caminho de cada tribunal, a divisão por autor, o repasse e o que o cliente recebe
--
-- Phase 10 of the plan of the controladoria, the outcome of the cases and
-- the firm's finance, its first cut. ONE never holds, receives or passes on
-- money (decision 1): it records, splits, prepares and warns, and the firm
-- pays at its bank.
--
-- Each court's way of paying is data (`court_payment_paths`, unconfirmed
-- until read in the act in force): where the court pays the client's part
-- straight to them and sets the fees apart (Estatuto, art. 22, § 4º), only
-- the fees fall in the firm; elsewhere the money falls in the firm's account
-- and the firm passes it on. A release the firm registered as received (0130)
-- owes its split (`money_releases`); the backend splits it by claimant with
-- the rule `repasse-v1` (`@flyee/rules/payout`: the fee kept only with a
-- clause or a signed authorization, the costs the contract lets it keep, the
-- fee never above what the client receives, a minor's part held whole) and
-- the database checks every part adds up (`record_money_split`). Each part
-- (`money_shares`) is passed on within the setting's 5 business days, held
-- for a partner to decide (a fee with no clause, an excess over art. 50), or
-- held until the judge says how a minor's part is paid. The client gives the
-- account they receive in, in their own CPF, on their link, and confirms on
-- it that they received.
-- ============================================================

insert into public.platform_settings (key, value) values ('client_money', jsonb_build_object(
  -- The business days the firm has to pass a client's part on: ONE's proposal, no law sets one.
  'transfer_days', 5
)) on conflict (key) do nothing;

-- ---------- Each court's way of paying ----------
create table public.court_payment_paths (
  court text primary key references public.courts (acronym) on update cascade,
  -- The court pays the client's part straight to the client, the fees set apart to the firm.
  direct boolean not null,
  -- How it pays the client: to an account, or to a Pix key.
  form text not null default 'conta',
  highlights_fees boolean not null default true,
  confirmed boolean not null default false,
  source text,
  checked_on date,
  constraint court_payment_paths_form_check check (form in ('conta', 'pix'))
);

alter table public.court_payment_paths enable row level security;
create policy "court_payment_paths_select_all" on public.court_payment_paths for select to authenticated using (true);
grant select on table public.court_payment_paths to authenticated;

-- The pilot's court, as a proposal to be read in its act in force.
insert into public.court_payment_paths (court, direct, form, highlights_fees, confirmed)
values ('TJGO', false, 'conta', true, false)
on conflict (court) do nothing;

-- ---------- The releases and their parts ----------
create table public.money_releases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  case_id uuid not null,
  proceeding_id uuid not null,
  fact_id uuid not null unique references public.lawsuit_facts (id) on delete cascade,
  -- firm: the money fell in the firm's account and is passed on; direct: the court paid the client.
  path text not null,
  received_cents bigint not null,
  received_on date not null,
  -- pending: the backend owes its split; split: its parts are recorded.
  status text not null default 'pending',
  rule text,
  split_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  constraint money_releases_path_check check (path in ('firm', 'direct')),
  constraint money_releases_status_check check (status in ('pending', 'split')),
  constraint money_releases_cents_check check (received_cents > 0)
);

create table public.money_shares (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  release_id uuid not null references public.money_releases (id) on delete cascade,
  case_id uuid not null,
  party_id uuid,
  person_id uuid,
  minor boolean not null default false,
  gross_cents bigint not null,
  fees_cents bigint not null default 0,
  costs_cents bigint not null default 0,
  held_cents bigint not null default 0,
  held jsonb not null default '[]'::jsonb,
  payable_cents bigint not null,
  -- owed: to pass on by its day; held: waits for a partner; minor: waits for the judge; paid: passed on; direct: the
  -- court paid the client.
  status text not null,
  due_on date,
  paid_on date,
  paid_by uuid references public.profiles (id) on delete set null,
  hold_decision text,
  hold_decided_by uuid references public.profiles (id) on delete set null,
  hold_decided_at timestamptz,
  -- What the court ordered of a minor's part.
  minor_order text,
  client_confirmed_at timestamptz,
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  constraint money_shares_status_check check (status in ('owed', 'held', 'minor', 'paid', 'direct')),
  constraint money_shares_sum_check check (
    gross_cents >= 0 and fees_cents >= 0 and costs_cents >= 0 and held_cents >= 0 and payable_cents >= 0
    and fees_cents + costs_cents + held_cents + payable_cents = gross_cents
  ),
  constraint money_shares_decision_check check (hold_decision is null or hold_decision in ('lowered', 'paid_whole', 'resent')),
  constraint money_shares_minor_check check (minor_order is null or minor_order in ('deposited', 'released', 'accounts'))
);

create index money_shares_release_idx on public.money_shares (release_id);
create index money_shares_due_idx on public.money_shares (org_id, due_on) where status = 'owed';

alter table public.money_releases enable row level security;
alter table public.money_shares enable row level security;
create policy "money_releases_select_reader" on public.money_releases for select to authenticated using (public.finance_reads(org_id));
create policy "money_shares_select_reader" on public.money_shares for select to authenticated using (public.finance_reads(org_id));
grant select on table public.money_releases to authenticated;
grant select on table public.money_shares to authenticated;
create trigger guard_impersonation_money_releases after insert or update or delete on public.money_releases
  for each statement execute function public.guard_impersonation_readonly();
create trigger guard_impersonation_money_shares after insert or update or delete on public.money_shares
  for each statement execute function public.guard_impersonation_readonly();

/**
 * A release the firm registered as received owes its split (0130 records the receipt): by the court's way of paying,
 * once per release. A release corrected or received again changes nothing already split.
 */
create or replace function public.lawsuit_facts_money_release()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  court_of text;
  direct boolean;
begin
  if new.kind <> 'alvara' or new.received_on is null or old.received_on is not null or coalesce(new.received_cents, 0) <= 0
     or new.corrected_at is not null then
    return new;
  end if;
  select p.court into court_of from public.proceedings p where p.id = new.proceeding_id;
  select c.direct into direct from public.court_payment_paths c where c.court = court_of;
  insert into public.money_releases (org_id, case_id, proceeding_id, fact_id, path, received_cents, received_on)
  values (new.org_id, new.case_id, new.proceeding_id, new.id, case when coalesce(direct, false) then 'direct' else 'firm' end,
    new.received_cents, new.received_on)
  on conflict (fact_id) do nothing;
  return new;
end;
$$;

revoke all on function public.lawsuit_facts_money_release() from public, anon, authenticated;
create trigger lawsuit_facts_money_release after update of received_on on public.lawsuit_facts
  for each row execute function public.lawsuit_facts_money_release();

/**
 * What the backend needs to split a release (internal): the received value, the claimants of the lawsuit with whether
 * each is a minor, the case's fees and whether the firm may keep its fee (a clause of the signed contract: a fee
 * contract signed on the case), whether it was a settlement, and the costs the firm advanced, with their receipt.
 */
create or replace function public.money_release_to_split(target_release uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'release_id', r.id, 'path', r.path, 'received_cents', r.received_cents,
    'claimants', coalesce((
      select jsonb_agg(jsonb_build_object('party_id', cp.id, 'person_id', cp.person_id,
        'minor', public.person_minor(cp.person_id)) order by cp.created_at, cp.id)
      from public.proceeding_parties pp join public.case_parties cp on cp.id = pp.party_id
      where pp.proceeding_id = r.proceeding_id and cp.role = 'claimant'
    ), '[]'::jsonb),
    'fees', (select to_jsonb(f) from public.case_fees f where f.case_id = r.case_id),
    'fees_authorized', exists (
      select 1 from public.case_papers p join public.signature_envelopes e on e.id = p.envelope_id
      where p.case_id = r.case_id and p.kind = 'contrato' and e.status = 'signed'),
    'settlement', exists (select 1 from public.lawsuit_facts f where f.proceeding_id = r.proceeding_id and f.kind = 'acordo'
                          and f.corrected_at is null),
    'costs_cents', coalesce((
      select sum(c.cents) from public.case_costs c
      where c.case_id = r.case_id and c.paid_by = 'firm' and c.owed_by = 'client' and c.absorbed_at is null
        and c.file_id is not null
    ), 0)
  )
  from public.money_releases r where r.id = target_release and r.status = 'pending';
$$;

revoke all on function public.money_release_to_split(uuid) from public, anon, authenticated;
grant execute on function public.money_release_to_split(uuid) to service_role;

/** The releases that owe their split, a few at a time (the backend's). */
create or replace function public.money_releases_pending(target_limit integer default 10)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select r.id from public.money_releases r where r.status = 'pending' order by r.created_at limit greatest(target_limit, 1);
$$;

revoke all on function public.money_releases_pending(integer) from public, anon, authenticated;
grant execute on function public.money_releases_pending(integer) to service_role;

/**
 * The backend records the split the rule computed (`repasse-v1`): each part must add up and the parts must add up to
 * what was received; in the direct path every part is the court's to pay. Once.
 */
create or replace function public.record_money_split(target_release uuid, target_rule text, target_shares jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  release public.money_releases%rowtype;
  share jsonb;
  total bigint := 0;
  days integer := coalesce((select (s.value ->> 'transfer_days')::integer from public.platform_settings s where s.key = 'client_money'), 5);
  due date;
  status_of text;
  held_total bigint;
begin
  select * into release from public.money_releases where id = target_release for update;
  if not found or release.status <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'not_pending');
  end if;
  if jsonb_typeof(target_shares) <> 'array' or jsonb_array_length(target_shares) = 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  -- The parts add up to what was received, or nothing is recorded.
  if (select coalesce(sum((s ->> 'gross_cents')::bigint), -1) from jsonb_array_elements(target_shares) s) <> release.received_cents then
    return jsonb_build_object('ok', false, 'code', 'split_mismatch');
  end if;
  -- The due day: the business days after the money arrived, weekends left out.
  due := release.received_on;
  while days > 0 loop
    due := due + 1;
    if extract(isodow from due) < 6 then days := days - 1; end if;
  end loop;
  for share in select * from jsonb_array_elements(target_shares) loop
    held_total := coalesce((select sum((h ->> 'cents')::bigint) from jsonb_array_elements(coalesce(share -> 'held', '[]'::jsonb)) h), 0);
    status_of := case
      when release.path = 'direct' then 'direct'
      when (share ->> 'minor')::boolean then 'minor'
      when held_total > 0 then 'held'
      else 'owed' end;
    insert into public.money_shares (org_id, release_id, case_id, party_id, person_id, minor, gross_cents, fees_cents,
      costs_cents, held_cents, held, payable_cents, status, due_on)
    values (release.org_id, release.id, release.case_id, nullif(share ->> 'party_id', '')::uuid,
      nullif(share ->> 'person_id', '')::uuid, coalesce((share ->> 'minor')::boolean, false),
      (share ->> 'gross_cents')::bigint, (share ->> 'fees_cents')::bigint, (share ->> 'costs_cents')::bigint, held_total,
      coalesce(share -> 'held', '[]'::jsonb), (share ->> 'payable_cents')::bigint, status_of,
      case when release.path = 'firm' then due end);
    total := total + (share ->> 'gross_cents')::bigint;
  end loop;
  if total <> release.received_cents then
    raise exception 'split_mismatch' using errcode = '22023';
  end if;
  update public.money_releases set status = 'split', rule = target_rule, split_at = now() where id = release.id;
  perform public.record_case_event(release.org_id, release.case_id, 'money_split', 'system', jsonb_build_object('path', release.path));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.record_money_split(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_money_split(uuid, text, jsonb) to service_role;

/**
 * Who operates the books records that a part was passed on, on the day it was paid at the bank. On the record; the
 * client is told on their link.
 */
create or replace function public.record_money_transfer(target_share uuid, target_paid_on date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  share public.money_shares%rowtype;
begin
  select * into share from public.money_shares where id = target_share for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if auth.uid() is null or not public.is_org_member(share.org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if public.finance_level(share.org_id) not in ('operate', 'configure') then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if share.status <> 'owed' then
    return jsonb_build_object('ok', false, 'code', 'not_owed');
  end if;
  if target_paid_on is null or target_paid_on > (now() at time zone 'America/Sao_Paulo')::date then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  update public.money_shares set status = 'paid', paid_on = target_paid_on, paid_by = auth.uid() where id = share.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (share.org_id, auth.uid(), 'money.transferred', 'money_share', share.id::text, '{}'::jsonb);
  perform public.record_case_event(share.org_id, share.case_id, 'money_transferred', 'person', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.record_money_transfer(uuid, date) from public, anon;
grant execute on function public.record_money_transfer(uuid, date) to authenticated;

/**
 * A partner (who decides for the firm) decides a held part, with the second factor: `lowered` keeps the fee at what the
 * rule allows and passes the rest on; `paid_whole` passes the whole part on (the fee becomes a bill to receive of the
 * case); `resent` keeps it held while the authorization is sent again. On the record.
 */
create or replace function public.decide_money_hold(target_share uuid, target_decision text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  share public.money_shares%rowtype;
  category uuid;
begin
  select * into share from public.money_shares where id = target_share for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if auth.uid() is null or not public.is_org_member(share.org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.decides_for_firm(share.org_id) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  if share.status <> 'held' or target_decision not in ('lowered', 'paid_whole', 'resent') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  if target_decision = 'resent' then
    update public.money_shares set hold_decision = 'resent', hold_decided_by = auth.uid(), hold_decided_at = now()
    where id = share.id;
  else
    -- The held part is passed on to the client: the fee it held is the firm's to charge apart.
    if target_decision = 'paid_whole' and share.held_cents > 0
       and (select o.finance_opened_on from public.organizations o where o.id = share.org_id) is not null then
      select c.id into category from public.finance_categories c
      where c.org_id = share.org_id and c.code = 'receita.exito' and c.archived_at is null;
      if category is not null then
        insert into public.finance_bills (org_id, direction, counterparty, description, category_id, case_id, cents, due_on,
          competence_on, source, by_one)
        values (share.org_id, 'receive', public.case_client_name(share.case_id), 'Honorários de êxito não compensados', category,
          share.case_id, share.held_cents, (now() at time zone 'America/Sao_Paulo')::date + 30,
          (now() at time zone 'America/Sao_Paulo')::date, 'success', true);
      end if;
    end if;
    update public.money_shares set status = 'owed', payable_cents = payable_cents + held_cents, held_cents = 0,
      hold_decision = target_decision, hold_decided_by = auth.uid(), hold_decided_at = now()
    where id = share.id;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (share.org_id, auth.uid(), 'money.hold_decided', 'money_share', share.id::text, jsonb_build_object('decision', target_decision));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.decide_money_hold(uuid, text) from public, anon;
grant execute on function public.decide_money_hold(uuid, text) to authenticated;

/** A partner or a lawyer records what the judge ordered of a minor's part. On the record. */
create or replace function public.record_minor_order(target_share uuid, target_order text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  share public.money_shares%rowtype;
begin
  select * into share from public.money_shares where id = target_share for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if auth.uid() is null or not public.is_org_member(share.org_id) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return jsonb_build_object('ok', false, 'code', 'support_visit');
  end if;
  if not public.has_firm_function(share.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if share.status <> 'minor' or target_order not in ('deposited', 'released', 'accounts') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data');
  end if;
  update public.money_shares set minor_order = target_order,
    status = case when target_order = 'released' then 'owed' else 'minor' end,
    payable_cents = case when target_order = 'released' then payable_cents + held_cents else payable_cents end,
    held_cents = case when target_order = 'released' then 0 else held_cents end
  where id = share.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (share.org_id, auth.uid(), 'money.minor_order', 'money_share', share.id::text, jsonb_build_object('order', target_order));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.record_minor_order(uuid, text) from public, anon;
grant execute on function public.record_minor_order(uuid, text) to authenticated;

-- ---------- The client's account ----------
create table public.client_payment_accounts (
  person_id uuid primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null,
  pix_key text,
  bank text,
  agency text,
  account text,
  given_at timestamptz not null default now(),
  foreign key (person_id, org_id) references public.people (id, org_id) on delete cascade,
  constraint client_payment_accounts_kind_check check (kind in ('pix', 'conta')),
  constraint client_payment_accounts_data_check check (
    (kind = 'pix' and pix_key is not null and char_length(pix_key) <= 100)
    or (kind = 'conta' and bank is not null and agency is not null and account is not null
        and char_length(bank) <= 80 and char_length(agency) <= 12 and char_length(account) <= 20))
);

alter table public.client_payment_accounts enable row level security;
create policy "client_payment_accounts_select_reader" on public.client_payment_accounts
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.client_payment_accounts to authenticated;
create trigger guard_impersonation_client_payment_accounts after insert or update or delete on public.client_payment_accounts
  for each statement execute function public.guard_impersonation_readonly();

/**
 * The client's money on their own link (the backend's, by the link's token): each part of theirs with what the firm
 * kept and why, what is passed on and when; the account they gave (masked); whether they confirmed. With `target_kind`,
 * the client gives the account they receive in, always in their own CPF: a Pix key that is their CPF, or an account of
 * their own; with `target_confirm`, they say they received a part.
 */
create or replace function public.client_link_money(target_token text, target_kind text default null, target_data jsonb default null,
  target_confirm uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  person public.people%rowtype;
  pix text;
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into person from public.people where id = link.person_id;
  if target_kind is not null then
    if target_kind = 'pix' then
      -- The Pix key is the client's own CPF: the money never goes to somebody else's key.
      pix := regexp_replace(coalesce(target_data ->> 'pix_key', ''), '\D', '', 'g');
      if person.cpf is null or pix <> person.cpf then
        return jsonb_build_object('ok', false, 'code', 'not_own_cpf');
      end if;
      insert into public.client_payment_accounts (person_id, org_id, kind, pix_key)
      values (person.id, person.org_id, 'pix', pix)
      on conflict (person_id) do update set kind = 'pix', pix_key = excluded.pix_key, bank = null, agency = null, account = null,
        given_at = now();
    elsif target_kind = 'conta' then
      if person.cpf is null or coalesce(target_data ->> 'confirm_own', '') <> 'true' then
        return jsonb_build_object('ok', false, 'code', 'not_own_cpf');
      end if;
      begin
        insert into public.client_payment_accounts (person_id, org_id, kind, bank, agency, account)
        values (person.id, person.org_id, 'conta', nullif(btrim(target_data ->> 'bank'), ''),
          nullif(regexp_replace(coalesce(target_data ->> 'agency', ''), '[^0-9-]', '', 'g'), ''),
          nullif(regexp_replace(coalesce(target_data ->> 'account', ''), '[^0-9xX-]', '', 'g'), ''))
        on conflict (person_id) do update set kind = 'conta', pix_key = null, bank = excluded.bank, agency = excluded.agency,
          account = excluded.account, given_at = now();
      exception when check_violation or not_null_violation then
        return jsonb_build_object('ok', false, 'code', 'invalid_data');
      end;
    else
      return jsonb_build_object('ok', false, 'code', 'invalid_data');
    end if;
    insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
    values (person.org_id, null, 'client', 'money.account_given', 'person', person.id::text, jsonb_build_object('kind', target_kind));
  end if;
  if target_confirm is not null then
    update public.money_shares set client_confirmed_at = coalesce(client_confirmed_at, now())
    where id = target_confirm and person_id = person.id and status in ('paid', 'direct');
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    perform public.record_case_event(person.org_id, link.case_id, 'money_confirmed', 'client', '{}'::jsonb);
  end if;
  return jsonb_build_object(
    'ok', true,
    'shares', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'gross_cents', s.gross_cents, 'fees_cents', s.fees_cents, 'costs_cents', s.costs_cents,
        'held_cents', s.held_cents, 'payable_cents', s.payable_cents, 'status', s.status, 'due_on', s.due_on,
        'paid_on', s.paid_on, 'minor', s.minor, 'confirmed_at', s.client_confirmed_at
      ) order by s.due_on nulls last)
      from public.money_shares s
      where s.person_id = person.id
         or (s.minor and exists (select 1 from public.case_parties cp join public.case_parties g on g.id = cp.guardian_id
                                 where cp.id = s.party_id and g.person_id = person.id))
    ), '[]'::jsonb),
    'account', (select jsonb_build_object('kind', a.kind,
      'ends', right(coalesce(a.pix_key, a.account, ''), 4), 'bank', a.bank)
      from public.client_payment_accounts a where a.person_id = person.id)
  );
end;
$$;

revoke all on function public.client_link_money(text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.client_link_money(text, text, jsonb, uuid) to service_role;

-- ---------- What the books read of the clients' money ----------
/** The parts of the firm's clients, for who reads the books: owed by their day, held, a minor's, paid. */
create or replace function public.firm_money_shares(target_org uuid, target_case uuid default null)
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
      'id', s.id, 'case_id', s.case_id, 'case_seq', c.seq, 'person', p.full_name, 'minor', s.minor,
      'gross_cents', s.gross_cents, 'fees_cents', s.fees_cents, 'costs_cents', s.costs_cents, 'held_cents', s.held_cents,
      'held', s.held, 'payable_cents', s.payable_cents, 'status', s.status, 'due_on', s.due_on, 'paid_on', s.paid_on,
      'hold_decision', s.hold_decision, 'minor_order', s.minor_order, 'confirmed_at', s.client_confirmed_at,
      'path', r.path, 'received_on', r.received_on,
      'account', (select jsonb_build_object('kind', a.kind, 'ends', right(coalesce(a.pix_key, a.account, ''), 4))
                  from public.client_payment_accounts a where a.person_id = s.person_id)
    ) order by case s.status when 'owed' then 0 when 'held' then 1 when 'minor' then 2 else 3 end, s.due_on nulls last)
    from public.money_shares s
    join public.money_releases r on r.id = s.release_id
    join public.cases c on c.id = s.case_id
    left join public.people p on p.id = s.person_id
    where s.org_id = target_org and (target_case is null or s.case_id = target_case)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.firm_money_shares(uuid, uuid) from public, anon;
grant execute on function public.firm_money_shares(uuid, uuid) to authenticated;

-- ---------- What waits, and the case screen ----------
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
    -- The clients' parts (0135): passed on late, held for a partner, a minor's waiting for the judge.
    'money', (
      select jsonb_build_object(
        'late', count(*) filter (where s.status = 'owed' and s.due_on < b.today),
        'late_cents', coalesce(sum(s.payable_cents) filter (where s.status = 'owed' and s.due_on < b.today), 0),
        'held', count(*) filter (where s.status = 'held' and s.hold_decision is distinct from 'resent'),
        'minor', count(*) filter (where s.status = 'minor' and s.minor_order is null))
      from public.money_shares s cross join books b
      where s.org_id = target_org
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
    (select md5(coalesce(string_agg(t::text, ',' order by t.id), '')) from public.money_shares t where t.case_id = target_case),
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
