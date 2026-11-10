-- ============================================================
-- 0155 · O dinheiro do cliente nos livros: o extrato casa a liberação e o repasse
--
-- Phase 10 of the plan of the finance, what its first cut left to a person.
-- ONE moves no money: it reads in the bank's statement what the court and
-- the firm moved, and records it.
--
--   * A credit the books read as a client's money (0126) that is the money
--     of a release the firm waits for (an `alvara` of a lawsuit of the firm
--     with nothing received yet) is recorded as that release received, by
--     ONE (`money_release_for_line`): the memo carries the lawsuit's number,
--     or the value is the only release waiting that it fits, from the value
--     the court ordered up to the setting's percent above it (a judicial
--     deposit earns its correction). What a person records follows as
--     before: the split (0135) and the success fee (0131).
--   * A debit that is the Pix of a client's part owed (the same value, the
--     memo with the client's name or the middle of their CPF) is that part
--     passed on, by ONE (`money_share_for_line`), on the line's day.
--   * Once a release that fell in the firm's account is split, the fees and
--     the costs the firm kept from it leave the client's money and enter as
--     revenue in that very account (two entries that move nothing), and the
--     success fee and the costs owed back by the client are settled by them.
--   * Undoing ONE's line undoes what it recorded: a part goes back to owed;
--     a release not split yet goes back to waiting (once split, a person
--     corrects it on the case, as before).
--   * The client is asked on their link for the account they receive in as
--     soon as money is expected on the case (a settlement, a judgment won, a
--     deposit or a release), not only once a part exists.
--
--   money_release_for_line, money_share_for_line   internal readers;
--   finance_decide_lines                           redefined from 0129;
--   money_releases_keep                            the fees and costs kept;
--   finance_entries_undo_money                     what an undone line undoes;
--   client_link_money                              redefined from 0135.
-- ============================================================

update public.platform_settings
set value = jsonb_build_object('release_band_percent', 25, 'release_days', 180) || value
where key = 'client_money' and not value ? 'release_band_percent';

alter table public.lawsuit_facts add column received_by_one boolean not null default false;
alter table public.lawsuit_facts add column received_entry_id uuid references public.finance_entries (id) on delete set null;
alter table public.money_shares add column paid_by_one boolean not null default false;
alter table public.money_shares add column paid_entry_id uuid references public.finance_entries (id) on delete set null;
alter table public.money_releases add column entry_id uuid references public.finance_entries (id) on delete set null;
alter table public.money_releases add column kept_at timestamptz;

create index lawsuit_facts_release_waiting_idx on public.lawsuit_facts (org_id, happened_on)
  where kind = 'alvara' and received_on is null and corrected_at is null;

/** A setting of the client's money, by its key, else its default (internal). */
create or replace function public.client_money_setting(target_key text, target_default integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select (s.value ->> target_key)::integer from public.platform_settings s where s.key = 'client_money'),
    target_default);
$$;

revoke all on function public.client_money_setting(text, integer) from public, anon, authenticated;

/**
 * The release a credit of the statement is the money of (internal): of the line's firm, an `alvara` with nothing
 * received yet, ordered in the setting's days before the line; by the lawsuit's number written in the memo (the oldest
 * of that lawsuit), else the only one whose ordered value the credit fits, from that value up to the setting's percent
 * above it. None when two fit, or none does.
 */
create or replace function public.money_release_for_line(target_line uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  line public.finance_statement_lines%rowtype;
  days integer := public.client_money_setting('release_days', 180);
  band integer := public.client_money_setting('release_band_percent', 25);
  digits text;
  found_id uuid;
  fitting integer;
begin
  select * into line from public.finance_statement_lines where id = target_line;
  if not found or line.cents <= 0 then
    return null;
  end if;
  digits := regexp_replace(coalesce(line.memo, ''), '\D', '', 'g');
  select f.id into found_id
  from public.lawsuit_facts f
  join public.proceedings p on p.id = f.proceeding_id
  where f.org_id = line.org_id and f.kind = 'alvara' and f.received_on is null and f.corrected_at is null
    and f.happened_on between line.posted_on - days and line.posted_on
    and p.cnj is not null and char_length(digits) >= 20 and strpos(digits, p.cnj) > 0
  order by f.happened_on, f.created_at, f.id
  limit 1;
  if found_id is not null then
    return found_id;
  end if;
  select (array_agg(f.id order by f.happened_on, f.id))[1], count(*) into found_id, fitting
  from public.lawsuit_facts f
  where f.org_id = line.org_id and f.kind = 'alvara' and f.received_on is null and f.corrected_at is null
    and f.happened_on between line.posted_on - days and line.posted_on
    and coalesce(f.cents, 0) > 0 and line.cents >= f.cents and line.cents * 100 <= f.cents * (100 + band);
  return case when fitting = 1 then found_id end;
end;
$$;

revoke all on function public.money_release_for_line(uuid) from public, anon, authenticated;

/**
 * The client's part a debit of the statement passes on (internal): of the line's firm, owed, of the same value, the
 * memo carrying the middle six digits of the client's CPF (as banks mask it) or the first and the last word of their
 * name. The first by its day when more than one fits.
 */
create or replace function public.money_share_for_line(target_line uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  line public.finance_statement_lines%rowtype;
  words text;
  digits text;
begin
  select * into line from public.finance_statement_lines where id = target_line;
  if not found or line.cents >= 0 then
    return null;
  end if;
  words := ' ' || public.plain_name(regexp_replace(coalesce(line.memo, ''), '[^[:alnum:]]+', ' ', 'g')) || ' ';
  digits := regexp_replace(coalesce(line.memo, ''), '\D', '', 'g');
  return (
    select s.id
    from public.money_shares s
    left join public.people p on p.id = s.person_id
    where s.org_id = line.org_id and s.status = 'owed' and s.payable_cents = -line.cents
      and (
        (p.cpf ~ '^[0-9]{11}$' and strpos(digits, substr(p.cpf, 4, 6)) > 0)
        or (
          char_length(btrim(coalesce(p.full_name, ''))) > 0
          and strpos(words, ' ' || split_part(public.plain_name(p.full_name), ' ', 1) || ' ') > 0
          and strpos(words, ' ' || regexp_replace(public.plain_name(p.full_name), '^.* ', '') || ' ') > 0
        )
      )
    order by s.due_on nulls last, s.id
    limit 1
  );
end;
$$;

revoke all on function public.money_share_for_line(uuid) from public, anon, authenticated;

-- ---------- The statement's lines (redefined from 0129) ----------
/**
 * What a rule decides of the pending lines (0129): a client's part passed on and a release received among them
 * (0155).
 */
create or replace function public.finance_decide_lines(target_org uuid, target_statement uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  line public.finance_statement_lines%rowtype;
  other public.finance_statement_lines%rowtype;
  rule public.finance_rules%rowtype;
  entry uuid;
  pair uuid;
  decided integer := 0;
  transfer_category uuid := (select c.id from public.finance_categories c where c.org_id = target_org and c.kind = 'transfer'
                             and c.archived_at is null order by c.position limit 1);
  client_category uuid := (select c.id from public.finance_categories c where c.org_id = target_org and c.kind = 'client_money'
                           and c.archived_at is null order by c.position limit 1);
  match_days integer := public.finance_setting('match_days', 5);
  transfer_days integer := public.finance_setting('transfer_days', 2);
  bill_id uuid;
  bill public.finance_bills%rowtype;
  share_id uuid;
  share public.money_shares%rowtype;
  release_fact uuid;
begin
  for line in
    select * from public.finance_statement_lines l
    where l.org_id = target_org and l.state = 'pending' and (target_statement is null or l.statement_id = target_statement)
    order by l.posted_on, l.created_at, l.id
    for update skip locked
  loop
    -- A line decided meanwhile (the other leg of a transfer) is left as it is, and a possible repetition of a line the
    -- bank already sent waits for a person: it may be the same money twice, or two payments of one value.
    continue when (select l.state from public.finance_statement_lines l where l.id = line.id) <> 'pending';
    continue when line.repeat_of is not null;

    -- The Pix of a client's part owed (0155): that part passed on, by ONE, on the line's day.
    share_id := case when client_category is not null then public.money_share_for_line(line.id) end;
    if share_id is not null then
      select s.* into share from public.money_shares s where s.id = share_id for update;
      insert into public.finance_entries (org_id, account_id, kind, cents, category_id, counterparty, description, case_id,
        occurred_on, competence_on, statement_line_id, source, by_one)
      values (target_org, line.account_id, 'client_money', line.cents, client_category,
        (select p.full_name from public.people p where p.id = share.person_id), line.memo, share.case_id,
        line.posted_on, line.posted_on, line.id, 'one', true)
      returning id into entry;
      update public.finance_statement_lines set state = 'entered', entry_id = entry, decided_by_one = true,
        decided_rule = 'money_share', decided_at = now() where id = line.id;
      update public.money_shares
      set status = 'paid', paid_on = line.posted_on, paid_by = null, paid_by_one = true, paid_entry_id = entry
      where id = share.id;
      insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
      values (target_org, null, 'money.transferred', 'money_share', share.id::text, jsonb_build_object('auto', true));
      perform public.record_case_event(target_org, share.case_id, 'money_transferred', 'system', '{}'::jsonb);
      decided := decided + 1;
      share_id := null;
      continue;
    end if;

    -- A client's money, by the setting's words: never revenue.
    if client_category is not null and public.finance_is_client_money(line.memo, line.cents) then
      insert into public.finance_entries (org_id, account_id, kind, cents, category_id, description, occurred_on,
        competence_on, statement_line_id, source, by_one)
      values (target_org, line.account_id, 'client_money', line.cents, client_category, line.memo, line.posted_on,
        line.posted_on, line.id, 'one', true)
      returning id into entry;
      update public.finance_statement_lines set state = 'entered', entry_id = entry, decided_by_one = true,
        decided_rule = 'client_money', decided_at = now() where id = line.id;
      -- The money of a release the firm waits for (0155): that release received, by ONE; its split and its success
      -- fee follow as when a person records it.
      release_fact := public.money_release_for_line(line.id);
      if release_fact is not null then
        update public.finance_entries set case_id = (select f.case_id from public.lawsuit_facts f where f.id = release_fact)
        where id = entry;
        update public.lawsuit_facts
        set received_cents = line.cents, received_on = line.posted_on, received_by = null, received_by_one = true,
            received_entry_id = entry
        where id = release_fact and received_on is null;
        update public.money_releases set entry_id = entry where fact_id = release_fact;
        insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
        values (target_org, null, 'outcome.fact_received', 'lawsuit_fact', release_fact::text, jsonb_build_object('auto', true));
        perform public.record_case_event(target_org, (select f.case_id from public.lawsuit_facts f where f.id = release_fact),
          'money_received', 'system', '{}'::jsonb);
        release_fact := null;
      end if;
      decided := decided + 1;
      continue;
    end if;

    -- An open bill the line pays or receives (0129): its entry is the bill's, as ONE's.
    bill_id := public.finance_bill_for_line(line.id);
    if bill_id is not null then
      select b.* into bill from public.finance_bills b where b.id = bill_id;
      insert into public.finance_entries (org_id, account_id, kind, cents, category_id, cost_center_id,
        counterparty, description, case_id, occurred_on, competence_on, statement_line_id, source, by_one)
      values (target_org, line.account_id,
        case (select c.kind from public.finance_categories c where c.id = bill.category_id)
          when 'client_money' then 'client_money' when 'partner_in' then 'partner' when 'partner_out' then 'partner'
          else case when bill.direction = 'pay' then 'expense' else 'income' end end,
        line.cents, bill.category_id, bill.cost_center_id, bill.counterparty, line.memo, bill.case_id,
        line.posted_on, bill.competence_on, line.id, 'one', true)
      returning id into entry;
      update public.finance_statement_lines set state = 'entered', entry_id = entry, decided_by_one = true,
        decided_rule = 'bill', decided_at = now() where id = line.id;
      perform public.finance_pay_bill(bill_id, entry, line.posted_on, abs(line.cents), true);
      decided := decided + 1;
      bill_id := null;
      continue;
    end if;

    -- An entry written by hand that shows the same money.
    select e.id into entry from public.finance_entries e
    where e.account_id = line.account_id and e.source = 'manual' and e.cancelled_at is null and e.statement_line_id is null
      and e.cents = line.cents and abs(e.occurred_on - line.posted_on) <= match_days
    order by abs(e.occurred_on - line.posted_on), e.created_at, e.id
    limit 1;
    if entry is not null then
      update public.finance_entries set statement_line_id = line.id where id = entry;
      update public.finance_statement_lines set state = 'matched', entry_id = entry, decided_by_one = true,
        decided_rule = 'manual_entry', decided_at = now() where id = line.id;
      decided := decided + 1;
      continue;
    end if;

    -- A transfer between two of the firm's accounts: the other leg pending in another account.
    if transfer_category is not null then
      select l.* into other from public.finance_statement_lines l
      where l.org_id = target_org and l.state = 'pending' and l.account_id <> line.account_id and l.cents = -line.cents
        and abs(l.posted_on - line.posted_on) <= transfer_days and l.id <> line.id
      order by abs(l.posted_on - line.posted_on), l.created_at, l.id
      limit 1
      for update skip locked;
      if other.id is not null then
        pair := gen_random_uuid();
        insert into public.finance_entries (org_id, account_id, kind, cents, category_id, description, occurred_on,
          competence_on, statement_line_id, transfer_id, source, by_one)
        values (target_org, line.account_id, 'transfer', line.cents, transfer_category, line.memo, line.posted_on,
          line.posted_on, line.id, pair, 'one', true)
        returning id into entry;
        update public.finance_statement_lines set state = 'entered', entry_id = entry, decided_by_one = true,
          decided_rule = 'transfer', decided_at = now() where id = line.id;
        insert into public.finance_entries (org_id, account_id, kind, cents, category_id, description, occurred_on,
          competence_on, statement_line_id, transfer_id, source, by_one)
        values (target_org, other.account_id, 'transfer', other.cents, transfer_category, other.memo, other.posted_on,
          other.posted_on, other.id, pair, 'one', true)
        returning id into entry;
        update public.finance_statement_lines set state = 'entered', entry_id = entry, decided_by_one = true,
          decided_rule = 'transfer', decided_at = now() where id = other.id;
        decided := decided + 2;
        other := null;
        continue;
      end if;
    end if;

    -- A firm's rule: the longest words that answer first.
    select r.* into rule from public.finance_rules r
    where r.org_id = target_org and r.direction = case when line.cents > 0 then 'in' else 'out' end
      and strpos(' ' || public.finance_memo_words(line.memo) || ' ', ' ' || public.finance_memo_words(r.words) || ' ') > 0
      and public.finance_entry_problem(target_org, line.account_id, r.kind, line.cents, r.category_id, r.cost_center_id,
            null, line.posted_on) is null
    order by char_length(r.words) desc, r.created_at
    limit 1;
    if rule.id is not null then
      insert into public.finance_entries (org_id, account_id, kind, cents, category_id, cost_center_id, counterparty,
        description, occurred_on, competence_on, statement_line_id, source, by_one)
      values (target_org, line.account_id, rule.kind, line.cents, rule.category_id, rule.cost_center_id, rule.counterparty,
        line.memo, line.posted_on, line.posted_on, line.id, 'one', true)
      returning id into entry;
      update public.finance_statement_lines set state = 'entered', entry_id = entry, decided_by_one = true,
        decided_rule = 'rule:' || rule.id, decided_at = now() where id = line.id;
      decided := decided + 1;
      rule := null;
    end if;
  end loop;
  return decided;
end;
$$;

revoke all on function public.finance_decide_lines(uuid, uuid) from public, anon, authenticated;

-- ---------- The client's link (redefined from 0135) ----------
/** The client's money on their link (0135), with whether money is expected on the case (0155). */
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
      from public.client_payment_accounts a where a.person_id = person.id),
    -- Money is expected on the case (0155): the account is asked from now on, before any part exists.
    'expected', exists (
      select 1 from public.lawsuit_facts f
      where f.case_id = link.case_id and f.corrected_at is null
        and (f.kind in ('acordo', 'deposito', 'alvara') or (f.kind = 'sentenca' and f.result in ('procedente', 'parcial')))
    )
  );
end;
$$;

revoke all on function public.client_link_money(text, text, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.client_link_money(text, text, jsonb, uuid) to service_role;

-- ---------- The fees and costs kept from a release ----------
/**
 * Once a release that fell in the firm's account (its credit known in the books) is split, the fees and the costs the
 * firm kept leave the client's money and enter as revenue in that account, on the day of the split: two entries that
 * move nothing. The success fee of that release (0131) is settled by the fees kept, and the costs the client owed back
 * of that case, oldest first, by the costs kept. Once per release.
 */
create or replace function public.money_releases_keep()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  credit public.finance_entries%rowtype;
  fees bigint;
  costs bigint;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  client_category uuid;
  fee_category uuid;
  cost_category uuid;
  client_name text;
  entry uuid;
  bill public.finance_bills%rowtype;
  rest bigint;
  part bigint;
begin
  if new.status <> 'split' or old.status = 'split' or new.path <> 'firm' or new.entry_id is null or new.kept_at is not null then
    return new;
  end if;
  select * into credit from public.finance_entries where id = new.entry_id and cancelled_at is null;
  if not found then
    return new;
  end if;
  select coalesce(sum(s.fees_cents), 0), coalesce(sum(s.costs_cents), 0) into fees, costs
  from public.money_shares s where s.release_id = new.id;
  client_category := (select c.id from public.finance_categories c where c.org_id = new.org_id and c.kind = 'client_money'
                      and c.archived_at is null order by c.position limit 1);
  fee_category := coalesce(
    (select b.category_id from public.finance_bills b where b.fact_id = new.fact_id and b.status = 'open' limit 1),
    (select c.id from public.finance_categories c where c.org_id = new.org_id and c.code = 'receita.exito' and c.archived_at is null));
  cost_category := (select c.id from public.finance_categories c where c.org_id = new.org_id and c.code = 'receita.reembolso'
                    and c.archived_at is null);
  client_name := public.case_client_name(new.case_id);
  if client_category is null then
    return new;
  end if;

  if fees > 0 and fee_category is not null then
    insert into public.finance_entries (org_id, account_id, kind, cents, category_id, counterparty, description, case_id,
      occurred_on, competence_on, source, by_one)
    values (new.org_id, credit.account_id, 'client_money', -fees, client_category, client_name,
      'Honorários retidos do dinheiro do cliente', new.case_id, today, today, 'one', true);
    insert into public.finance_entries (org_id, account_id, kind, cents, category_id, counterparty, description, case_id,
      occurred_on, competence_on, source, by_one)
    values (new.org_id, credit.account_id, 'income', fees, fee_category, client_name,
      'Honorários de êxito retidos da liberação', new.case_id, today, today, 'one', true)
    returning id into entry;
    select * into bill from public.finance_bills b where b.fact_id = new.fact_id and b.status = 'open' limit 1;
    if found then
      perform public.finance_pay_bill(bill.id, entry, today, least(fees, bill.cents - bill.paid_cents), true);
    end if;
  end if;

  if costs > 0 and cost_category is not null then
    insert into public.finance_entries (org_id, account_id, kind, cents, category_id, counterparty, description, case_id,
      occurred_on, competence_on, source, by_one)
    values (new.org_id, credit.account_id, 'client_money', -costs, client_category, client_name,
      'Custos reembolsados do dinheiro do cliente', new.case_id, today, today, 'one', true);
    rest := costs;
    -- One entry a bill (a payment is one entry's), the rest, if any, on an entry of its own.
    for bill in
      select * from public.finance_bills b
      where b.org_id = new.org_id and b.case_id = new.case_id and b.source = 'cost' and b.direction = 'receive'
        and b.status = 'open'
      order by b.due_on, b.created_at, b.id
      for update
    loop
      exit when rest <= 0;
      part := least(rest, bill.cents - bill.paid_cents);
      insert into public.finance_entries (org_id, account_id, kind, cents, category_id, counterparty, description, case_id,
        occurred_on, competence_on, source, by_one)
      values (new.org_id, credit.account_id, 'income', part, coalesce(bill.category_id, cost_category), client_name,
        left(coalesce(bill.description, 'Reembolso de custos'), 300), new.case_id, today, today, 'one', true)
      returning id into entry;
      perform public.finance_pay_bill(bill.id, entry, today, part, true);
      rest := rest - part;
    end loop;
    if rest > 0 then
      insert into public.finance_entries (org_id, account_id, kind, cents, category_id, counterparty, description, case_id,
        occurred_on, competence_on, source, by_one)
      values (new.org_id, credit.account_id, 'income', rest, cost_category, client_name,
        'Custos reembolsados da liberação', new.case_id, today, today, 'one', true);
    end if;
  end if;

  update public.money_releases set kept_at = now() where id = new.id;
  return new;
end;
$$;

revoke all on function public.money_releases_keep() from public, anon, authenticated;

create trigger money_releases_keep after update of status on public.money_releases
  for each row execute function public.money_releases_keep();

-- ---------- What undoing ONE's line undoes ----------
/**
 * An entry cancelled (its line undone, or the entry cancelled with its reason) undoes what ONE recorded from it: a
 * client's part ONE marked passed on goes back to owed; a release ONE recorded as received goes back to waiting while
 * it is not split (its split and its success fee go with it); once split, the release stays as received for a person
 * to correct on the case, and only its link to the entry goes.
 */
create or replace function public.finance_entries_undo_money()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  fact public.lawsuit_facts%rowtype;
  release public.money_releases%rowtype;
begin
  if new.cancelled_at is null or old.cancelled_at is not null then
    return new;
  end if;
  update public.money_shares
  set status = 'owed', paid_on = null, paid_by_one = false, paid_entry_id = null
  where paid_entry_id = new.id and paid_by_one and status = 'paid' and client_confirmed_at is null;

  for fact in
    select * from public.lawsuit_facts f where f.received_entry_id = new.id and f.received_by_one for update
  loop
    select * into release from public.money_releases r where r.fact_id = fact.id for update;
    if release.id is null or release.status = 'pending' then
      delete from public.money_releases where fact_id = fact.id;
      update public.finance_bills
      set status = 'cancelled', closed_reason = 'O recebimento lido do extrato foi desfeito.', closed_at = now()
      where fact_id = fact.id and status = 'open' and paid_cents = 0;
      update public.lawsuit_facts
      set received_cents = null, received_on = null, received_by = null, received_by_one = false, received_entry_id = null
      where id = fact.id;
      perform public.record_case_event(fact.org_id, fact.case_id, 'money_receipt_undone', 'system', '{}'::jsonb);
    else
      update public.lawsuit_facts set received_entry_id = null where id = fact.id;
      update public.money_releases set entry_id = null where id = release.id;
    end if;
    release := null;
  end loop;
  return new;
end;
$$;

revoke all on function public.finance_entries_undo_money() from public, anon, authenticated;

create trigger finance_entries_undo_money after update of cancelled_at on public.finance_entries
  for each row execute function public.finance_entries_undo_money();

-- ---------- The firm's read of the parts (redefined from 0135) ----------
/** The parts of the firm's clients (0135), with what ONE read of the statement (0155). */
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
      'path', r.path, 'received_on', r.received_on, 'paid_by_one', s.paid_by_one,
      'received_by_one', (select f.received_by_one from public.lawsuit_facts f where f.id = r.fact_id),
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
