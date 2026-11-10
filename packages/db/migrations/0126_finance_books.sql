-- ============================================================
-- 0126 · Os livros do escritório
--
-- Phase 4 of the plan of the controladoria, the outcome of the cases and the
-- firm's finance, its first cut. The line of the money (the plan's decision
-- 1): ONE records, reads, calculates, prepares and warns; it never holds,
-- receives, passes on, splits, pays or charges money, not even on a firm's
-- behalf, and its only charge is its own subscription. Nothing here moves
-- money: the money moves at the bank, and ONE reads the statement.
--
-- Who reads the books (decision 2) is said before any number: a partner (in
-- a firm with none, who manages the firm account) sees and configures all;
-- anybody else reads the costs of the cases as they read the cases, and
-- nothing of the books, unless a partner grants them "view", "operate" or
-- "configure" (`finance_access`), with the second factor. A support visit
-- reads nothing. Every table of the books is read only by who reads them,
-- and written only through these functions, each with the second factor.
--
-- A partner opens the books with their first day (`open_finance_books`):
-- the platform's provisional chart of accounts is copied for the firm (each
-- category with its line of the income statement and of the cash flow) and
-- a cost centre per module the firm has. The accounts (bank, cash, card, a
-- receiving account of the firm's payment machine, a custody account of
-- clients' money) each start with their opening balance. Entries are an
-- income, an expense, a transfer between two accounts, a client's money
-- (never revenue) or a partner's money, written by hand or by ONE from a
-- statement, each saying who made it; nothing is deleted: an entry is
-- cancelled with its reason, ONE's act is undone, and a statement imported
-- by mistake leaves whole.
--
-- A statement in OFX is read in the person's browser and its lines sent here
-- (`begin_finance_statement`, `add_finance_statement_lines`): the same file
-- twice adds nothing; a line the bank already gave (its own id) is known, and
-- one of another id with the same day, value and memo is kept as a possible
-- repetition, said, never dropped. Then ONE decides what a rule decides
-- (`finance_decide_lines`), in this order: a credit that is a client's money
-- (a court's release, a judicial deposit: by the setting's words, before any
-- model), a line a manual entry already wrote (joined to it, never counted
-- twice), a transfer between two of the firm's accounts, a line a firm's
-- rule answers for; the rest waits for a person, who decides it and may keep
-- the answer as a rule. After each import the balance ONE computes is
-- compared with the bank's.
-- ============================================================

-- ---------- Who reads the books ----------

alter table public.organizations add column finance_opened_on date;
alter table public.organizations add column finance_opened_at timestamptz;
alter table public.organizations add column finance_opened_by uuid references public.profiles (id) on delete set null;
comment on column public.organizations.finance_opened_on is 'The first day of the firm''s books (0126): nothing before it is entered.';

create table public.finance_access (
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  level text not null,
  granted_by uuid references public.profiles (id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (org_id, user_id),
  constraint finance_access_level_check check (level in ('none', 'costs', 'view', 'operate', 'configure'))
);

alter table public.finance_access enable row level security;
create policy "finance_access_select_own" on public.finance_access
  for select to authenticated using (user_id = auth.uid() or public.decides_for_firm(org_id));
grant select on table public.finance_access to authenticated;
create trigger guard_impersonation_finance_access after insert or update or delete on public.finance_access
  for each statement execute function public.guard_impersonation_readonly();

/**
 * What the person asking reads and does of a firm's books: `configure` (a partner, or who decides for a firm with
 * none; or granted), `operate` (enters and reconciles), `view`, `costs` (the costs of the cases, as they read the
 * cases: anybody else's default) or `none`. A support visit reads nothing.
 */
create or replace function public.finance_level(target_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null or not public.is_org_member(target_org) or public.is_impersonated() then 'none'
    when public.decides_for_firm(target_org) then 'configure'
    else coalesce(
      (select a.level from public.finance_access a where a.org_id = target_org and a.user_id = auth.uid()), 'costs')
  end;
$$;

revoke all on function public.finance_level(uuid) from public, anon;
grant execute on function public.finance_level(uuid) to authenticated;

/** Whether the person asking reads the books (view, operate or configure). */
create or replace function public.finance_reads(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.finance_level(target_org) in ('view', 'operate', 'configure');
$$;

revoke all on function public.finance_reads(uuid) from public, anon;
grant execute on function public.finance_reads(uuid) to authenticated;

/**
 * Why the person asking may not write in the books now, or null: a support visit, a level below the one asked
 * (`operate` for entries and statements, `configure` for the accounts, the chart and the access), no second factor,
 * or books not opened yet. Internal.
 */
create or replace function public.finance_write_refusal(target_org uuid, target_level text, target_opened boolean default true)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  level text := public.finance_level(target_org);
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if public.is_impersonated() then
    return 'support_visit';
  end if;
  if (target_level = 'configure' and level <> 'configure')
     or (target_level = 'operate' and level not in ('operate', 'configure')) then
    return 'not_allowed';
  end if;
  if not public.is_aal2() then
    return 'second_factor';
  end if;
  if target_opened and (select o.finance_opened_on from public.organizations o where o.id = target_org) is null then
    return 'books_closed';
  end if;
  return null;
end;
$$;

revoke all on function public.finance_write_refusal(uuid, text, boolean) from public, anon, authenticated;

/**
 * A partner (or who decides for a firm with none) says what a person of the firm reads and does of the books, with the
 * second factor. Who decides for the firm configures always and is never set here.
 */
create or replace function public.set_finance_access(target_org uuid, target_user uuid, target_level text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'configure', false);
  prior text;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if target_level is null or target_level not in ('none', 'costs', 'view', 'operate', 'configure') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'level');
  end if;
  if not exists (select 1 from public.memberships m where m.org_id = target_org and m.user_id = target_user) then
    return jsonb_build_object('ok', false, 'code', 'not_member');
  end if;
  if target_user = auth.uid() then
    return jsonb_build_object('ok', false, 'code', 'own_access');
  end if;
  select a.level into prior from public.finance_access a where a.org_id = target_org and a.user_id = target_user;
  insert into public.finance_access (org_id, user_id, level, granted_by)
  values (target_org, target_user, target_level, auth.uid())
  on conflict (org_id, user_id) do update set level = excluded.level, granted_by = excluded.granted_by, granted_at = now();
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.access_set', 'profile', target_user::text,
    jsonb_build_object('before', coalesce(prior, 'costs'), 'after', target_level));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.set_finance_access(uuid, uuid, text) from public, anon;
grant execute on function public.set_finance_access(uuid, uuid, text) to authenticated;

-- ---------- The chart of accounts, the cost centres, the accounts ----------

/**
 * The categories of the books: the platform's (no firm: a provisional chart for an accountant to review) and each
 * firm's own, copied from it when the books open. Each has its kind (an income, an expense, a client's money, never
 * revenue, a partner's money in or out, a transfer) and its line of the income statement and of the cash flow.
 */
create table public.finance_categories (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations (id) on delete cascade,
  kind text not null,
  name text not null,
  code text,
  dre_line text,
  dfc_line text,
  position integer not null default 0,
  archived_at timestamptz,
  archived_reason text,
  archived_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint finance_categories_kind_check check (kind in ('income', 'expense', 'client_money', 'partner_in', 'partner_out', 'transfer')),
  constraint finance_categories_name_check check (char_length(name) between 2 and 80),
  constraint finance_categories_dre_check check (dre_line is null or dre_line in ('receita', 'deducao', 'custo', 'despesa', 'financeiro', 'fora')),
  constraint finance_categories_dfc_check check (dfc_line is null or dfc_line in ('operacional', 'investimento', 'financiamento', 'fora')),
  constraint finance_categories_archived_check check ((archived_at is null) = (archived_reason is null))
);

create unique index finance_categories_code_idx on public.finance_categories (coalesce(org_id::text, ''), code) where code is not null;
create index finance_categories_org_idx on public.finance_categories (org_id, kind, position);

alter table public.finance_categories enable row level security;
create policy "finance_categories_select_reader" on public.finance_categories
  for select to authenticated using (org_id is not null and public.finance_reads(org_id));
grant select on table public.finance_categories to authenticated;
create trigger guard_impersonation_finance_categories after insert or update or delete on public.finance_categories
  for each statement execute function public.guard_impersonation_readonly();

-- The platform's chart, provisional until an accountant reviews it.
insert into public.finance_categories (org_id, kind, name, code, dre_line, dfc_line, position) values
  (null, 'income', 'Honorários contratuais', 'receita.contratuais', 'receita', 'operacional', 10),
  (null, 'income', 'Honorários de êxito', 'receita.exito', 'receita', 'operacional', 11),
  (null, 'income', 'Honorários de sucumbência', 'receita.sucumbencia', 'receita', 'operacional', 12),
  (null, 'income', 'Reembolso de custas pelo cliente', 'receita.reembolso', 'receita', 'operacional', 13),
  (null, 'income', 'Rendimentos de aplicação', 'receita.rendimentos', 'financeiro', 'operacional', 14),
  (null, 'income', 'Outras receitas', 'receita.outras', 'receita', 'operacional', 19),
  (null, 'expense', 'Tributos sobre a receita (ISS, Simples)', 'despesa.tributos', 'deducao', 'operacional', 20),
  (null, 'expense', 'Custas e despesas dos processos', 'despesa.custas', 'custo', 'operacional', 21),
  (null, 'expense', 'Salários e encargos', 'despesa.pessoal', 'despesa', 'operacional', 22),
  (null, 'expense', 'Aluguel e condomínio', 'despesa.aluguel', 'despesa', 'operacional', 23),
  (null, 'expense', 'Energia, água e internet', 'despesa.utilidades', 'despesa', 'operacional', 24),
  (null, 'expense', 'Software e assinaturas', 'despesa.software', 'despesa', 'operacional', 25),
  (null, 'expense', 'Marketing', 'despesa.marketing', 'despesa', 'operacional', 26),
  (null, 'expense', 'Contabilidade', 'despesa.contabilidade', 'despesa', 'operacional', 27),
  (null, 'expense', 'Material e escritório', 'despesa.material', 'despesa', 'operacional', 28),
  (null, 'expense', 'Deslocamentos', 'despesa.deslocamentos', 'despesa', 'operacional', 29),
  (null, 'expense', 'Tarifas bancárias e juros', 'despesa.financeiras', 'financeiro', 'operacional', 30),
  (null, 'expense', 'Equipamentos', 'despesa.equipamentos', 'despesa', 'investimento', 31),
  (null, 'expense', 'Outras despesas', 'despesa.outras', 'despesa', 'operacional', 39),
  (null, 'client_money', 'Dinheiro de cliente recebido', 'cliente.recebido', 'fora', 'fora', 40),
  (null, 'client_money', 'Dinheiro de cliente repassado', 'cliente.repassado', 'fora', 'fora', 41),
  (null, 'partner_in', 'Aporte de capital', 'socio.aporte', 'fora', 'financiamento', 50),
  (null, 'partner_in', 'Empréstimo de sócio', 'socio.emprestimo', 'fora', 'financiamento', 51),
  (null, 'partner_out', 'Pró-labore', 'socio.prolabore', 'despesa', 'operacional', 52),
  (null, 'partner_out', 'Distribuição de lucros', 'socio.lucros', 'fora', 'financiamento', 53),
  (null, 'transfer', 'Transferência entre contas', 'transferencia', 'fora', 'fora', 60);

create table public.finance_cost_centers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  name text not null,
  module_key text references public.product_modules (key) on delete set null,
  archived_at timestamptz,
  archived_reason text,
  created_at timestamptz not null default now(),
  constraint finance_cost_centers_name_check check (char_length(name) between 2 and 80),
  constraint finance_cost_centers_archived_check check ((archived_at is null) = (archived_reason is null))
);

alter table public.finance_cost_centers enable row level security;
create policy "finance_cost_centers_select_reader" on public.finance_cost_centers
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_cost_centers to authenticated;
create trigger guard_impersonation_finance_cost_centers after insert or update or delete on public.finance_cost_centers
  for each statement execute function public.guard_impersonation_readonly();

/**
 * Where the firm's money is: a bank account, the cash, a card (with the day its bill closes and is due), a receiving
 * account (the payment machine or the means of payment the firm uses outside ONE) or a custody account of clients'
 * money. Each starts the books with its opening balance; only its last digits are kept of a number.
 */
create table public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null,
  name text not null,
  institution text,
  number_tail text,
  opening_cents bigint not null default 0,
  closing_day integer,
  due_day integer,
  archived_at timestamptz,
  archived_reason text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, org_id),
  constraint finance_accounts_kind_check check (kind in ('bank', 'cash', 'card', 'receiving', 'custody')),
  constraint finance_accounts_name_check check (char_length(name) between 2 and 80),
  constraint finance_accounts_institution_check check (institution is null or char_length(institution) between 2 and 80),
  constraint finance_accounts_tail_check check (number_tail is null or number_tail ~ '^[0-9A-Za-z-]{1,8}$'),
  constraint finance_accounts_days_check check (
    (closing_day is null or closing_day between 1 and 31) and (due_day is null or due_day between 1 and 31)
  ),
  constraint finance_accounts_archived_check check ((archived_at is null) = (archived_reason is null))
);

alter table public.finance_accounts enable row level security;
create policy "finance_accounts_select_reader" on public.finance_accounts
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_accounts to authenticated;
create trigger guard_impersonation_finance_accounts after insert or update or delete on public.finance_accounts
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The entries ----------

/**
 * Each movement of money the books hold, as the account sees it (`cents`: in positive, out negative): an income, an
 * expense, a client's money (never revenue), a partner's money, or one leg of a transfer (both legs share
 * `transfer_id`). Written by a person (`manual`) or by ONE from a statement (`one`), each saying who; joined to the
 * statement's line that shows it, once. Never deleted: cancelled with the reason.
 */
create table public.finance_entries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null,
  kind text not null,
  cents bigint not null,
  category_id uuid references public.finance_categories (id) on delete restrict,
  cost_center_id uuid references public.finance_cost_centers (id) on delete set null,
  counterparty text,
  description text,
  case_id uuid,
  occurred_on date not null,
  competence_on date not null,
  transfer_id uuid,
  statement_line_id uuid,
  source text not null default 'manual',
  by_one boolean not null default false,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  cancelled_reason text,
  foreign key (account_id, org_id) references public.finance_accounts (id, org_id) on delete restrict,
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete set null (case_id),
  constraint finance_entries_kind_check check (kind in ('income', 'expense', 'client_money', 'partner', 'transfer')),
  constraint finance_entries_cents_check check (cents <> 0),
  constraint finance_entries_way_check check (
    (kind = 'income' and cents > 0) or (kind = 'expense' and cents < 0) or kind in ('client_money', 'partner', 'transfer')
  ),
  constraint finance_entries_source_check check (source in ('manual', 'one')),
  constraint finance_entries_text_check check (
    (counterparty is null or char_length(counterparty) between 1 and 120)
    and (description is null or char_length(description) between 1 and 300)
  ),
  constraint finance_entries_cancel_check check (
    (cancelled_at is null) = (cancelled_reason is null)
    and (cancelled_reason is null or char_length(cancelled_reason) between 3 and 300)
  )
);

create unique index finance_entries_line_idx on public.finance_entries (statement_line_id)
  where statement_line_id is not null and cancelled_at is null;
create index finance_entries_org_idx on public.finance_entries (org_id, occurred_on desc, created_at desc);
create index finance_entries_account_idx on public.finance_entries (account_id, occurred_on) where cancelled_at is null;
create index finance_entries_transfer_idx on public.finance_entries (transfer_id) where transfer_id is not null;

alter table public.finance_entries enable row level security;
create policy "finance_entries_select_reader" on public.finance_entries
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_entries to authenticated;
create trigger guard_impersonation_finance_entries after insert or update or delete on public.finance_entries
  for each statement execute function public.guard_impersonation_readonly();

-- ---------- The statements ----------

create table public.finance_statements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null,
  file_name text not null,
  file_sha256 text not null,
  format text not null default 'ofx',
  starts_on date,
  ends_on date,
  bank_balance_cents bigint,
  bank_balance_on date,
  -- What ONE's books said of the account on the bank's day, against the bank's balance.
  balance_gap_cents bigint,
  lines_new integer not null default 0,
  lines_known integer not null default 0,
  lines_repeated integer not null default 0,
  status text not null default 'open',
  imported_by uuid references public.profiles (id) on delete set null,
  imported_at timestamptz not null default now(),
  removed_at timestamptz,
  removed_by uuid references public.profiles (id) on delete set null,
  removed_reason text,
  foreign key (account_id, org_id) references public.finance_accounts (id, org_id) on delete restrict,
  constraint finance_statements_format_check check (format in ('ofx')),
  constraint finance_statements_sha_check check (file_sha256 ~ '^[0-9a-f]{64}$'),
  constraint finance_statements_name_check check (char_length(file_name) between 1 and 200),
  constraint finance_statements_status_check check (status in ('open', 'done', 'removed')),
  constraint finance_statements_removed_check check ((status = 'removed') = (removed_at is not null))
);

-- The same file twice adds nothing.
create unique index finance_statements_file_idx on public.finance_statements (account_id, file_sha256) where status <> 'removed';

alter table public.finance_statements enable row level security;
create policy "finance_statements_select_reader" on public.finance_statements
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_statements to authenticated;
create trigger guard_impersonation_finance_statements after insert or update or delete on public.finance_statements
  for each statement execute function public.guard_impersonation_readonly();

create table public.finance_statement_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null,
  statement_id uuid not null references public.finance_statements (id) on delete cascade,
  bank_id text,
  posted_on date not null,
  cents bigint not null,
  memo text not null default '',
  line_key text not null,
  -- pending: waits for a person; entered: an entry of its own; matched: joined to an entry written before it;
  -- ignored: a person said it is nothing for the books (a repetition the bank sent).
  state text not null default 'pending',
  entry_id uuid references public.finance_entries (id) on delete set null,
  repeat_of uuid references public.finance_statement_lines (id) on delete set null,
  decided_by uuid references public.profiles (id) on delete set null,
  decided_by_one boolean not null default false,
  decided_rule text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (account_id, org_id) references public.finance_accounts (id, org_id) on delete restrict,
  constraint finance_statement_lines_cents_check check (cents <> 0),
  constraint finance_statement_lines_state_check check (state in ('pending', 'entered', 'matched', 'ignored')),
  constraint finance_statement_lines_memo_check check (char_length(memo) <= 300),
  constraint finance_statement_lines_bank_check check (bank_id is null or char_length(bank_id) between 1 and 120)
);

create unique index finance_statement_lines_bank_idx on public.finance_statement_lines (account_id, bank_id)
  where bank_id is not null;
create unique index finance_statement_lines_key_idx on public.finance_statement_lines (account_id, line_key)
  where bank_id is null;
create index finance_statement_lines_pending_idx on public.finance_statement_lines (org_id, posted_on)
  where state = 'pending';
create index finance_statement_lines_key_any_idx on public.finance_statement_lines (account_id, line_key);

alter table public.finance_statement_lines enable row level security;
create policy "finance_statement_lines_select_reader" on public.finance_statement_lines
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_statement_lines to authenticated;
create trigger guard_impersonation_finance_statement_lines after insert or update or delete on public.finance_statement_lines
  for each statement execute function public.guard_impersonation_readonly();

alter table public.finance_entries add constraint finance_entries_line_fkey
  foreign key (statement_line_id) references public.finance_statement_lines (id) on delete set null;

/** A firm's rule for its lines: the words a memo holds and the way of the money, kept from a person's answer. */
create table public.finance_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  words text not null,
  direction text not null,
  kind text not null,
  category_id uuid references public.finance_categories (id) on delete cascade,
  cost_center_id uuid references public.finance_cost_centers (id) on delete set null,
  counterparty text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint finance_rules_words_check check (char_length(words) between 3 and 80),
  constraint finance_rules_direction_check check (direction in ('in', 'out')),
  constraint finance_rules_kind_check check (kind in ('income', 'expense', 'client_money', 'partner')),
  constraint finance_rules_counterparty_check check (counterparty is null or char_length(counterparty) between 1 and 120)
);

create unique index finance_rules_words_idx on public.finance_rules (org_id, words, direction);

alter table public.finance_rules enable row level security;
create policy "finance_rules_select_reader" on public.finance_rules
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_rules to authenticated;
create trigger guard_impersonation_finance_rules after insert or update or delete on public.finance_rules
  for each statement execute function public.guard_impersonation_readonly();

-- What a client's money is, as the setting says, and how far a written entry and a transfer are looked for.
insert into public.platform_settings (key, value, is_public) values
  ('finance', jsonb_build_object(
    -- The words of a credit that is a client's money (`@flyee/rules/finance` CLIENT_MONEY_WORDS, kept together by a test).
    'client_money_words', jsonb_build_array('alvara', 'levantamento', 'deposito judicial', 'dep judicial', 'judicial',
      'requisicao de pequeno valor', 'rpv', 'precatorio'),
    -- How many days apart a line and an entry written by hand may be to be the same money.
    'match_days', 5,
    -- How many days apart the two legs of a transfer between the firm's accounts may be.
    'transfer_days', 2,
    -- How many lines a call sends.
    'lines_per_call', 500,
    -- How far back the first day of the books may go.
    'max_years_back', 5
  ), false)
on conflict (key) do nothing;

create or replace function public.finance_setting(target_key text, fallback integer)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select case when s.value ->> target_key ~ '^[0-9]{1,6}$' then (s.value ->> target_key)::integer end
     from public.platform_settings s where s.key = 'finance'),
    fallback);
$$;

revoke all on function public.finance_setting(text, integer) from public, anon, authenticated;

/** A memo as words, as `@flyee/rules/finance` memoWords writes it: no accent, no case, punctuation out. */
create or replace function public.finance_memo_words(target_memo text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(lower(public.plain_name(target_memo)), '[^a-z0-9]+', ' ', 'g'));
$$;

revoke all on function public.finance_memo_words(text) from public, anon, authenticated;

/** A credit whose memo holds one of the setting's words, whole: a client's money, never revenue. Internal. */
create or replace function public.finance_is_client_money(target_memo text, target_cents bigint)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_cents > 0 and exists (
    select 1
    from public.platform_settings s
    cross join lateral jsonb_array_elements_text(s.value -> 'client_money_words') as w (word)
    where s.key = 'finance'
      and strpos(' ' || public.finance_memo_words(target_memo) || ' ', ' ' || public.finance_memo_words(w.word) || ' ') > 0
  );
$$;

revoke all on function public.finance_is_client_money(text, bigint) from public, anon, authenticated;

-- ---------- Opening the books ----------

/**
 * A partner (or who decides for a firm with none) opens the books with their first day, with the second factor: the
 * platform's chart is copied for the firm and a cost centre made per module it has. Said again while nothing is
 * entered, it moves the first day.
 */
create or replace function public.open_finance_books(target_org uuid, target_first_day date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'configure', false);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  firm public.organizations%rowtype;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if not public.decides_for_firm(target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if target_first_day is null or target_first_day > today
     or target_first_day < (today - make_interval(years => public.finance_setting('max_years_back', 5)))::date then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'first_day');
  end if;
  select * into firm from public.organizations where id = target_org for update;
  if firm.finance_opened_on is not null then
    if exists (select 1 from public.finance_entries e where e.org_id = target_org)
       or exists (select 1 from public.finance_statements s where s.org_id = target_org) then
      return jsonb_build_object('ok', false, 'code', 'has_entries');
    end if;
    update public.organizations set finance_opened_on = target_first_day where id = target_org;
  else
    update public.organizations
    set finance_opened_on = target_first_day, finance_opened_at = now(), finance_opened_by = auth.uid()
    where id = target_org;
    insert into public.finance_categories (org_id, kind, name, code, dre_line, dfc_line, position)
    select target_org, c.kind, c.name, c.code, c.dre_line, c.dfc_line, c.position
    from public.finance_categories c
    where c.org_id is null and c.archived_at is null
    on conflict do nothing;
    insert into public.finance_cost_centers (org_id, name, module_key)
    select target_org, left(m.name, 80), m.key
    from public.firm_modules fm join public.product_modules m on m.key = fm.module_key
    where fm.org_id = target_org;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.opened', 'firm', target_org::text, jsonb_build_object('first_day', target_first_day));
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.open_finance_books(uuid, date) from public, anon;
grant execute on function public.open_finance_books(uuid, date) to authenticated;

-- ---------- The accounts, the categories and the cost centres, each in the pattern of a registration ----------

/** Creates or changes an account of the firm (`configure`, the second factor). Its kind never changes once used. */
create or replace function public.save_finance_account(target_org uuid, target_account uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'configure');
  kind_value text := nullif(btrim(coalesce(fields ->> 'kind', '')), '');
  name_value text := btrim(regexp_replace(coalesce(fields ->> 'name', ''), '\s+', ' ', 'g'));
  institution_value text := nullif(btrim(regexp_replace(coalesce(fields ->> 'institution', ''), '\s+', ' ', 'g')), '');
  tail_value text := nullif(btrim(coalesce(fields ->> 'number_tail', '')), '');
  opening_value bigint;
  closing_value integer;
  due_value integer;
  prior public.finance_accounts%rowtype;
  saved uuid;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if kind_value is null or kind_value not in ('bank', 'cash', 'card', 'receiving', 'custody') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'kind');
  end if;
  if char_length(name_value) not between 2 and 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'name');
  end if;
  if institution_value is not null and char_length(institution_value) not between 2 and 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'institution');
  end if;
  if tail_value is not null and tail_value !~ '^[0-9A-Za-z-]{1,8}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'number_tail');
  end if;
  if coalesce(fields ->> 'opening_cents', '0') !~ '^-?[0-9]{1,13}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'opening_cents');
  end if;
  opening_value := coalesce(fields ->> 'opening_cents', '0')::bigint;
  if coalesce(fields ->> 'closing_day', '') !~ '^([1-9]|[12][0-9]|3[01])?$'
     or coalesce(fields ->> 'due_day', '') !~ '^([1-9]|[12][0-9]|3[01])?$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'days');
  end if;
  closing_value := nullif(fields ->> 'closing_day', '')::integer;
  due_value := nullif(fields ->> 'due_day', '')::integer;
  if kind_value = 'card' and (closing_value is null or due_value is null) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'days');
  end if;
  if kind_value <> 'card' then
    closing_value := null;
    due_value := null;
  end if;

  if target_account is null then
    insert into public.finance_accounts (org_id, kind, name, institution, number_tail, opening_cents, closing_day, due_day, created_by)
    values (target_org, kind_value, name_value, institution_value, tail_value, opening_value, closing_value, due_value, auth.uid())
    returning id into saved;
  else
    select * into prior from public.finance_accounts a where a.id = target_account and a.org_id = target_org for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'not_found');
    end if;
    if prior.kind <> kind_value and (
      exists (select 1 from public.finance_entries e where e.account_id = prior.id)
      or exists (select 1 from public.finance_statements s where s.account_id = prior.id)
    ) then
      return jsonb_build_object('ok', false, 'code', 'kind_in_use');
    end if;
    update public.finance_accounts
    set kind = kind_value, name = name_value, institution = institution_value, number_tail = tail_value,
        opening_cents = opening_value, closing_day = closing_value, due_day = due_value, updated_at = now()
    where id = prior.id
    returning id into saved;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), case when target_account is null then 'finance.account_created' else 'finance.account_changed' end,
    'finance_account', saved::text, jsonb_build_object('kind', kind_value));
  return jsonb_build_object('ok', true, 'account_id', saved);
end;
$$;

revoke all on function public.save_finance_account(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_finance_account(uuid, uuid, jsonb) to authenticated;

/**
 * Archives an account with its reason (what an entry uses is never deleted), brings it back (a null reason), or deletes
 * one nothing uses (`target_delete`). Of the configuring level, with the second factor.
 */
create or replace function public.archive_finance_record(
  target_org uuid,
  target_table text,
  target_record uuid,
  target_reason text,
  target_delete boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'configure');
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
  used boolean;
  found_row boolean;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if target_table not in ('account', 'category', 'cost_center') then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'table');
  end if;
  if reason is not null and char_length(reason) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'reason');
  end if;
  found_row := case target_table
    when 'account' then exists (select 1 from public.finance_accounts a where a.id = target_record and a.org_id = target_org)
    when 'category' then exists (select 1 from public.finance_categories c where c.id = target_record and c.org_id = target_org)
    else exists (select 1 from public.finance_cost_centers c where c.id = target_record and c.org_id = target_org)
  end;
  if not found_row then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  used := case target_table
    when 'account' then exists (select 1 from public.finance_entries e where e.account_id = target_record)
      or exists (select 1 from public.finance_statements s where s.account_id = target_record)
    when 'category' then exists (select 1 from public.finance_entries e where e.category_id = target_record)
      or exists (select 1 from public.finance_rules r where r.category_id = target_record)
    else exists (select 1 from public.finance_entries e where e.cost_center_id = target_record)
  end;
  if target_delete then
    if used then
      return jsonb_build_object('ok', false, 'code', 'in_use');
    end if;
    if target_table = 'account' then delete from public.finance_accounts where id = target_record;
    elsif target_table = 'category' then delete from public.finance_categories where id = target_record;
    else delete from public.finance_cost_centers where id = target_record;
    end if;
  elsif target_table = 'account' then
    update public.finance_accounts set archived_at = case when reason is null then null else now() end,
      archived_reason = reason, updated_at = now() where id = target_record;
  elsif target_table = 'category' then
    update public.finance_categories set archived_at = case when reason is null then null else now() end,
      archived_reason = reason, archived_by = case when reason is null then null else auth.uid() end, updated_at = now()
    where id = target_record;
  else
    update public.finance_cost_centers set archived_at = case when reason is null then null else now() end,
      archived_reason = reason where id = target_record;
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(),
    'finance.' || target_table || case when target_delete then '_deleted' when reason is null then '_restored' else '_archived' end,
    'finance_' || target_table, target_record::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.archive_finance_record(uuid, text, uuid, text, boolean) from public, anon;
grant execute on function public.archive_finance_record(uuid, text, uuid, text, boolean) to authenticated;

/** Creates or renames a category of the firm (its kind fixed once used), or a cost centre (`target_table`). */
create or replace function public.save_finance_category(target_org uuid, target_table text, target_record uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'configure');
  name_value text := btrim(regexp_replace(coalesce(fields ->> 'name', ''), '\s+', ' ', 'g'));
  kind_value text := nullif(btrim(coalesce(fields ->> 'kind', '')), '');
  dre_value text := nullif(btrim(coalesce(fields ->> 'dre_line', '')), '');
  dfc_value text := nullif(btrim(coalesce(fields ->> 'dfc_line', '')), '');
  saved uuid;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if char_length(name_value) not between 2 and 80 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'name');
  end if;
  if target_table = 'cost_center' then
    if target_record is null then
      insert into public.finance_cost_centers (org_id, name) values (target_org, name_value) returning id into saved;
    else
      update public.finance_cost_centers set name = name_value where id = target_record and org_id = target_org
      returning id into saved;
    end if;
  elsif target_table = 'category' then
    if kind_value is null or kind_value not in ('income', 'expense', 'client_money', 'partner_in', 'partner_out') then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'kind');
    end if;
    if dre_value is not null and dre_value not in ('receita', 'deducao', 'custo', 'despesa', 'financeiro', 'fora') then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'dre_line');
    end if;
    if dfc_value is not null and dfc_value not in ('operacional', 'investimento', 'financiamento', 'fora') then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'dfc_line');
    end if;
    if target_record is null then
      insert into public.finance_categories (org_id, kind, name, dre_line, dfc_line, position)
      values (target_org, kind_value, name_value, dre_value, dfc_value, 100)
      returning id into saved;
    else
      if exists (select 1 from public.finance_categories c where c.id = target_record and c.org_id = target_org
                   and c.kind <> kind_value)
         and exists (select 1 from public.finance_entries e where e.category_id = target_record) then
        return jsonb_build_object('ok', false, 'code', 'kind_in_use');
      end if;
      update public.finance_categories set name = name_value, kind = kind_value, dre_line = dre_value,
        dfc_line = dfc_value, updated_at = now()
      where id = target_record and org_id = target_org
      returning id into saved;
    end if;
  else
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'table');
  end if;
  if saved is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.' || target_table || '_saved', 'finance_' || target_table, saved::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'id', saved);
end;
$$;

revoke all on function public.save_finance_category(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.save_finance_category(uuid, text, uuid, jsonb) to authenticated;

-- ---------- Writing an entry ----------

/**
 * Why an entry may not be written as given, or null: its account of the firm and open, its category of the firm,
 * open and of a kind that fits the entry's (an income an income's, an expense an expense's, a client's money a client's,
 * a partner's money a partner's), its cost centre and its case of the firm, its day within the books. Internal.
 */
create or replace function public.finance_entry_problem(
  target_org uuid,
  target_account uuid,
  target_kind text,
  target_cents bigint,
  target_category uuid,
  target_cost_center uuid,
  target_case uuid,
  target_day date
)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (select 1 from public.finance_accounts a where a.id = target_account and a.org_id = target_org and a.archived_at is null)
      then 'account'
    when target_kind is null or target_kind not in ('income', 'expense', 'client_money', 'partner', 'transfer') then 'kind'
    when target_cents is null or target_cents = 0 or (target_kind = 'income' and target_cents < 0)
         or (target_kind = 'expense' and target_cents > 0) then 'cents'
    when target_category is not null and not exists (
      select 1 from public.finance_categories c
      where c.id = target_category and c.org_id = target_org and c.archived_at is null
        and case target_kind
          when 'income' then c.kind = 'income'
          when 'expense' then c.kind = 'expense'
          when 'client_money' then c.kind = 'client_money'
          when 'partner' then c.kind in ('partner_in', 'partner_out')
          else c.kind = 'transfer'
        end
    ) then 'category'
    when target_category is null and target_kind <> 'transfer' then 'category'
    when target_cost_center is not null and not exists (
      select 1 from public.finance_cost_centers c where c.id = target_cost_center and c.org_id = target_org and c.archived_at is null
    ) then 'cost_center'
    when target_case is not null and not exists (select 1 from public.cases c where c.id = target_case and c.org_id = target_org)
      then 'case'
    when target_day is null
         or target_day < (select o.finance_opened_on from public.organizations o where o.id = target_org)
         or target_day > (now() at time zone 'America/Sao_Paulo')::date then 'day'
  end;
$$;

revoke all on function public.finance_entry_problem(uuid, uuid, text, bigint, uuid, uuid, uuid, date) from public, anon, authenticated;

/**
 * A person writes an entry by hand (`operate`, the second factor): an income, an expense, a client's money or a
 * partner's money of one account, or a transfer between two (`to_account`: both legs at once). An entry ONE wrote, or
 * one of a statement's line, is changed by cancelling it and writing another.
 */
create or replace function public.save_finance_entry(target_org uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  kind_value text := nullif(btrim(coalesce(fields ->> 'kind', '')), '');
  account_value uuid;
  to_value uuid;
  category_value uuid;
  center_value uuid;
  case_value uuid;
  cents_value bigint;
  day_value date;
  competence_value date;
  counterparty_value text := nullif(btrim(regexp_replace(coalesce(fields ->> 'counterparty', ''), '\s+', ' ', 'g')), '');
  description_value text := nullif(btrim(regexp_replace(coalesce(fields ->> 'description', ''), '\s+', ' ', 'g')), '');
  problem text;
  saved uuid;
  pair uuid;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  begin
    account_value := nullif(fields ->> 'account_id', '')::uuid;
    to_value := nullif(fields ->> 'to_account_id', '')::uuid;
    category_value := nullif(fields ->> 'category_id', '')::uuid;
    center_value := nullif(fields ->> 'cost_center_id', '')::uuid;
    case_value := nullif(fields ->> 'case_id', '')::uuid;
    day_value := nullif(fields ->> 'occurred_on', '')::date;
    competence_value := coalesce(nullif(fields ->> 'competence_on', '')::date, day_value);
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'fields');
  end;
  if coalesce(fields ->> 'cents', '') !~ '^-?[0-9]{1,13}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'cents');
  end if;
  cents_value := (fields ->> 'cents')::bigint;
  if (counterparty_value is not null and char_length(counterparty_value) > 120)
     or (description_value is not null and char_length(description_value) > 300) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'text');
  end if;

  if kind_value = 'transfer' then
    -- A transfer: the value leaves one account and arrives at the other, the same day.
    if to_value is null or to_value = account_value or cents_value <= 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'to_account');
    end if;
    category_value := (select c.id from public.finance_categories c where c.org_id = target_org and c.kind = 'transfer'
                       order by c.position limit 1);
    problem := coalesce(
      public.finance_entry_problem(target_org, account_value, 'transfer', -cents_value, category_value, null, null, day_value),
      public.finance_entry_problem(target_org, to_value, 'transfer', cents_value, category_value, null, null, day_value));
    if problem is not null then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', problem);
    end if;
    pair := gen_random_uuid();
    insert into public.finance_entries (org_id, account_id, kind, cents, category_id, description, occurred_on,
      competence_on, transfer_id, source, created_by)
    values
      (target_org, account_value, 'transfer', -cents_value, category_value, description_value, day_value, day_value, pair, 'manual', auth.uid()),
      (target_org, to_value, 'transfer', cents_value, category_value, description_value, day_value, day_value, pair, 'manual', auth.uid());
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, auth.uid(), 'finance.transfer_written', 'finance_transfer', pair::text, '{}'::jsonb);
    return jsonb_build_object('ok', true, 'transfer_id', pair);
  end if;

  problem := public.finance_entry_problem(target_org, account_value, kind_value, cents_value, category_value, center_value,
    case_value, day_value);
  if problem is not null then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', problem);
  end if;
  if competence_value is null or competence_value < (day_value - interval '5 years')::date
     or competence_value > (day_value + interval '5 years')::date then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'competence');
  end if;
  insert into public.finance_entries (org_id, account_id, kind, cents, category_id, cost_center_id, counterparty,
    description, case_id, occurred_on, competence_on, source, created_by)
  values (target_org, account_value, kind_value, cents_value, category_value, center_value, counterparty_value,
    description_value, case_value, day_value, competence_value, 'manual', auth.uid())
  returning id into saved;
  -- A line of a statement already imported that shows this money is joined to it, never counted twice.
  perform public.finance_match_entry(saved);
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.entry_written', 'finance_entry', saved::text, jsonb_build_object('kind', kind_value));
  return jsonb_build_object('ok', true, 'entry_id', saved);
end;
$$;

revoke all on function public.save_finance_entry(uuid, jsonb) from public, anon;
grant execute on function public.save_finance_entry(uuid, jsonb) to authenticated;

/**
 * An entry written by hand and a pending line of a statement that show the same money (the same account, the same
 * value, within the setting's days) are joined: the line is matched to the entry, and no second entry is written.
 * Internal: called when either of them arrives.
 */
create or replace function public.finance_match_entry(target_entry uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  entry public.finance_entries%rowtype;
  line uuid;
  days integer := public.finance_setting('match_days', 5);
begin
  select * into entry from public.finance_entries where id = target_entry;
  if entry.id is null or entry.statement_line_id is not null or entry.cancelled_at is not null or entry.source <> 'manual' then
    return null;
  end if;
  select l.id into line from public.finance_statement_lines l
  where l.account_id = entry.account_id and l.state = 'pending' and l.cents = entry.cents
    and abs(l.posted_on - entry.occurred_on) <= days
  order by abs(l.posted_on - entry.occurred_on), l.posted_on, l.id
  limit 1
  for update skip locked;
  if line is null then
    return null;
  end if;
  update public.finance_entries set statement_line_id = line where id = entry.id;
  update public.finance_statement_lines
  set state = 'matched', entry_id = entry.id, decided_by_one = true, decided_rule = 'manual_entry', decided_at = now()
  where id = line;
  return line;
end;
$$;

revoke all on function public.finance_match_entry(uuid) from public, anon, authenticated;

/**
 * Cancels an entry with its reason (`operate`, the second factor): both legs of a transfer, and the line of a
 * statement it came from goes back to wait for a person. Nothing is deleted.
 */
create or replace function public.cancel_finance_entry(target_org uuid, target_entry uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
  entry public.finance_entries%rowtype;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if reason is null or char_length(reason) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'reason');
  end if;
  select * into entry from public.finance_entries e where e.id = target_entry and e.org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if entry.cancelled_at is not null then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  perform public.finance_cancel_entries(
    array(select e.id from public.finance_entries e
          where e.id = entry.id or (entry.transfer_id is not null and e.transfer_id = entry.transfer_id)),
    reason, auth.uid());
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.entry_cancelled', 'finance_entry', entry.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.cancel_finance_entry(uuid, uuid, text) from public, anon;
grant execute on function public.cancel_finance_entry(uuid, uuid, text) to authenticated;

/** Cancels entries with the reason, their lines back to wait for a person, each joined line let go. Internal. */
create or replace function public.finance_cancel_entries(target_entries uuid[], target_reason text, target_by uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.finance_statement_lines l
  set state = 'pending', entry_id = null, decided_by = null, decided_by_one = false, decided_rule = null, decided_at = null
  where l.entry_id = any (target_entries) or l.id in (
    select e.statement_line_id from public.finance_entries e where e.id = any (target_entries) and e.statement_line_id is not null
  );
  update public.finance_entries
  set cancelled_at = now(), cancelled_by = target_by, cancelled_reason = left(target_reason, 300), statement_line_id = null
  where id = any (target_entries) and cancelled_at is null;
end;
$$;

revoke all on function public.finance_cancel_entries(uuid[], text, uuid) from public, anon, authenticated;

-- ---------- A statement ----------

/**
 * Begins a statement of an account (`operate`, the second factor), read in the person's browser: the same file of the
 * same account twice is refused (`already_imported`, nothing added). Its lines follow a few hundred a call.
 */
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
  saved uuid;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if not exists (select 1 from public.finance_accounts a where a.id = target_account and a.org_id = target_org and a.archived_at is null) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'account');
  end if;
  if sha !~ '^[0-9a-f]{64}$' or name_value = '' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'file');
  end if;
  if exists (select 1 from public.finance_statements s where s.account_id = target_account and s.file_sha256 = sha and s.status <> 'removed') then
    return jsonb_build_object('ok', false, 'code', 'already_imported');
  end if;
  begin
    insert into public.finance_statements (org_id, account_id, file_name, file_sha256, starts_on, ends_on,
      bank_balance_cents, bank_balance_on, imported_by)
    values (target_org, target_account, name_value, sha, nullif(fields ->> 'starts_on', '')::date,
      nullif(fields ->> 'ends_on', '')::date,
      case when coalesce(fields ->> 'balance_cents', '') ~ '^-?[0-9]{1,13}$' then (fields ->> 'balance_cents')::bigint end,
      nullif(fields ->> 'balance_on', '')::date, auth.uid())
    returning id into saved;
  exception when invalid_datetime_format or datetime_field_overflow then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'days');
  end;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.statement_begun', 'finance_statement', saved::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'statement_id', saved);
end;
$$;

revoke all on function public.begin_finance_statement(uuid, uuid, jsonb) from public, anon;
grant execute on function public.begin_finance_statement(uuid, uuid, jsonb) to authenticated;

/**
 * Adds lines of a statement in course (`operate`, the second factor): each line checked again here (a day within the
 * books and not to come, a value in whole cents not zero, a memo of 300 characters at most). A line the bank already
 * gave (the same id, or with no id the same day, value and memo) is known and added once; one with another id and the
 * same day, value and memo is kept as a possible repetition. Answers how many were new, known and repeated.
 */
create or replace function public.add_finance_statement_lines(target_org uuid, target_statement uuid, target_lines jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  statement public.finance_statements%rowtype;
  item jsonb;
  posted date;
  cents_value bigint;
  memo_value text;
  bank_value text;
  key_value text;
  earlier uuid;
  added integer := 0;
  known integer := 0;
  repeated integer := 0;
  opened date := (select o.finance_opened_on from public.organizations o where o.id = target_org);
  today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  select * into statement from public.finance_statements s
  where s.id = target_statement and s.org_id = target_org and s.status = 'open' for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if jsonb_typeof(target_lines) <> 'array'
     or jsonb_array_length(target_lines) > public.finance_setting('lines_per_call', 500) then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'lines');
  end if;
  for item in select * from jsonb_array_elements(target_lines) loop
    begin
      posted := (item ->> 'posted_on')::date;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'posted_on', 'line', item);
    end;
    if coalesce(item ->> 'cents', '') !~ '^-?[0-9]{1,13}$' or (item ->> 'cents')::bigint = 0 then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'cents', 'line', item);
    end if;
    cents_value := (item ->> 'cents')::bigint;
    memo_value := left(regexp_replace(btrim(coalesce(item ->> 'memo', '')), '\s+', ' ', 'g'), 300);
    bank_value := nullif(left(btrim(coalesce(item ->> 'bank_id', '')), 120), '');
    -- A line before the books' first day belongs to no book, and one still to come is no movement yet.
    if posted < opened or posted > today then
      known := known + 1;
      continue;
    end if;
    key_value := posted::text || '|' || cents_value::text || '|' || public.finance_memo_words(memo_value);
    if bank_value is not null and exists (
      select 1 from public.finance_statement_lines l where l.account_id = statement.account_id and l.bank_id = bank_value
    ) then
      known := known + 1;
      continue;
    end if;
    if bank_value is null and exists (
      select 1 from public.finance_statement_lines l where l.account_id = statement.account_id and l.bank_id is null
        and l.line_key = key_value
    ) then
      known := known + 1;
      continue;
    end if;
    select l.id into earlier from public.finance_statement_lines l
    where l.account_id = statement.account_id and l.line_key = key_value
    order by l.created_at limit 1;
    insert into public.finance_statement_lines (org_id, account_id, statement_id, bank_id, posted_on, cents, memo,
      line_key, repeat_of)
    values (target_org, statement.account_id, statement.id, bank_value, posted, cents_value, memo_value, key_value, earlier);
    added := added + 1;
    if earlier is not null then
      repeated := repeated + 1;
    end if;
  end loop;
  update public.finance_statements
  set lines_new = lines_new + added, lines_known = lines_known + known, lines_repeated = lines_repeated + repeated
  where id = statement.id;
  return jsonb_build_object('ok', true, 'added', added, 'known', known, 'repeated', repeated);
end;
$$;

revoke all on function public.add_finance_statement_lines(uuid, uuid, jsonb) from public, anon;
grant execute on function public.add_finance_statement_lines(uuid, uuid, jsonb) to authenticated;

/**
 * The balance of an account at the end of a day, as the books have it: its opening and what its entries in force moved
 * by then. Internal.
 */
create or replace function public.finance_account_balance(target_account uuid, target_day date)
returns bigint
language sql
stable
security definer
set search_path = public
as $$
  select a.opening_cents + coalesce((
    select sum(e.cents) from public.finance_entries e
    where e.account_id = a.id and e.cancelled_at is null and e.occurred_on <= target_day
  ), 0)
  from public.finance_accounts a where a.id = target_account;
$$;

revoke all on function public.finance_account_balance(uuid, date) from public, anon, authenticated;

/**
 * What a rule decides of the pending lines of a firm (or of one statement), in order: a credit that is a client's money
 * (the setting's words), a line an entry written by hand already shows (joined to it), a transfer between two of the
 * firm's accounts (both legs entered at once), a line a firm's rule answers for. Each entry ONE writes says it is ONE's.
 * Internal: called when a statement is finished, and again when a person keeps a new rule.
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

    -- A client's money, by the setting's words: never revenue.
    if client_category is not null and public.finance_is_client_money(line.memo, line.cents) then
      insert into public.finance_entries (org_id, account_id, kind, cents, category_id, description, occurred_on,
        competence_on, statement_line_id, source, by_one)
      values (target_org, line.account_id, 'client_money', line.cents, client_category, line.memo, line.posted_on,
        line.posted_on, line.id, 'one', true)
      returning id into entry;
      update public.finance_statement_lines set state = 'entered', entry_id = entry, decided_by_one = true,
        decided_rule = 'client_money', decided_at = now() where id = line.id;
      decided := decided + 1;
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

/**
 * Finishes a statement (`operate`, the second factor): ONE decides what its rules decide, and the balance the books
 * give the account on the bank's day is compared with the bank's (`balance_gap_cents`: zero when they agree).
 */
create or replace function public.finish_finance_statement(target_org uuid, target_statement uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  statement public.finance_statements%rowtype;
  decided integer;
  gap bigint;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  select * into statement from public.finance_statements s
  where s.id = target_statement and s.org_id = target_org and s.status = 'open' for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  decided := public.finance_decide_lines(target_org, null);
  if statement.bank_balance_cents is not null and statement.bank_balance_on is not null then
    gap := public.finance_account_balance(statement.account_id, statement.bank_balance_on) - statement.bank_balance_cents;
  end if;
  update public.finance_statements set status = 'done', balance_gap_cents = gap where id = statement.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.statement_imported', 'finance_statement', statement.id::text,
    jsonb_build_object('new', statement.lines_new, 'known', statement.lines_known, 'repeated', statement.lines_repeated));
  return jsonb_build_object('ok', true, 'decided', decided, 'pending', (
    select count(*) from public.finance_statement_lines l where l.statement_id = statement.id and l.state = 'pending'
  ), 'balance_gap_cents', gap);
end;
$$;

revoke all on function public.finish_finance_statement(uuid, uuid) from public, anon;
grant execute on function public.finish_finance_statement(uuid, uuid) to authenticated;

/**
 * Removes a statement imported by mistake, whole (`operate`, the second factor, a reason): the entries ONE wrote from
 * its lines are cancelled, the entries written by hand it joined are let go, and its lines leave.
 */
create or replace function public.remove_finance_statement(target_org uuid, target_statement uuid, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  reason text := nullif(btrim(coalesce(target_reason, '')), '');
  statement public.finance_statements%rowtype;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  if reason is null or char_length(reason) not between 3 and 300 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'reason');
  end if;
  select * into statement from public.finance_statements s
  where s.id = target_statement and s.org_id = target_org and s.status <> 'removed' for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  -- ONE's entries of its lines are cancelled (with the other leg of a transfer); a person's joined entry stays.
  perform public.finance_cancel_entries(array(
    select e.id from public.finance_entries e
    where e.cancelled_at is null and e.source = 'one' and (
      e.statement_line_id in (select l.id from public.finance_statement_lines l where l.statement_id = statement.id)
      or e.transfer_id in (
        select t.transfer_id from public.finance_entries t
        join public.finance_statement_lines l on l.id = t.statement_line_id
        where l.statement_id = statement.id and t.transfer_id is not null
      )
    )
  ), 'O extrato foi removido: ' || reason, auth.uid());
  update public.finance_entries set statement_line_id = null
  where statement_line_id in (select l.id from public.finance_statement_lines l where l.statement_id = statement.id);
  delete from public.finance_statement_lines where statement_id = statement.id;
  update public.finance_statements
  set status = 'removed', removed_at = now(), removed_by = auth.uid(), removed_reason = left(reason, 300)
  where id = statement.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.statement_removed', 'finance_statement', statement.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.remove_finance_statement(uuid, uuid, text) from public, anon;
grant execute on function public.remove_finance_statement(uuid, uuid, text) to authenticated;

/**
 * A person decides a pending line (`operate`, the second factor): an entry of the kind and category they say, or the
 * line ignored with the reason (a repetition the bank sent). Kept as a rule when asked (`rule_words`), which ONE then
 * applies to the other pending lines at once.
 */
create or replace function public.decide_finance_line(target_org uuid, target_line uuid, fields jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  line public.finance_statement_lines%rowtype;
  kind_value text := nullif(btrim(coalesce(fields ->> 'kind', '')), '');
  category_value uuid;
  center_value uuid;
  case_value uuid;
  counterparty_value text := nullif(btrim(regexp_replace(coalesce(fields ->> 'counterparty', ''), '\s+', ' ', 'g')), '');
  words_value text := nullif(btrim(regexp_replace(coalesce(fields ->> 'rule_words', ''), '\s+', ' ', 'g')), '');
  reason text := nullif(btrim(coalesce(fields ->> 'ignore_reason', '')), '');
  problem text;
  entry uuid;
  others integer := 0;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  select * into line from public.finance_statement_lines l where l.id = target_line and l.org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if line.state <> 'pending' then
    return jsonb_build_object('ok', false, 'code', 'decided');
  end if;
  if kind_value = 'ignore' then
    if reason is null or char_length(reason) not between 3 and 300 then
      return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'reason');
    end if;
    update public.finance_statement_lines set state = 'ignored', decided_by = auth.uid(), decided_rule = left(reason, 300),
      decided_at = now() where id = line.id;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (target_org, auth.uid(), 'finance.line_ignored', 'finance_statement_line', line.id::text, '{}'::jsonb);
    return jsonb_build_object('ok', true);
  end if;
  begin
    category_value := nullif(fields ->> 'category_id', '')::uuid;
    center_value := nullif(fields ->> 'cost_center_id', '')::uuid;
    case_value := nullif(fields ->> 'case_id', '')::uuid;
  exception when others then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'fields');
  end;
  problem := public.finance_entry_problem(target_org, line.account_id, kind_value, line.cents, category_value, center_value,
    case_value, line.posted_on);
  if problem is not null or kind_value = 'transfer' then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', coalesce(problem, 'kind'));
  end if;
  if counterparty_value is not null and char_length(counterparty_value) > 120 then
    return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'counterparty');
  end if;
  insert into public.finance_entries (org_id, account_id, kind, cents, category_id, cost_center_id, counterparty,
    description, case_id, occurred_on, competence_on, statement_line_id, source, created_by)
  values (target_org, line.account_id, kind_value, line.cents, category_value, center_value, counterparty_value,
    line.memo, case_value, line.posted_on, line.posted_on, line.id, 'manual', auth.uid())
  returning id into entry;
  update public.finance_statement_lines set state = 'entered', entry_id = entry, decided_by = auth.uid(), decided_at = now()
  where id = line.id;
  if words_value is not null then
    if char_length(words_value) not between 3 and 80
       or strpos(' ' || public.finance_memo_words(line.memo) || ' ', ' ' || public.finance_memo_words(words_value) || ' ') = 0 then
      raise exception 'rule_words' using errcode = '22023';
    end if;
    insert into public.finance_rules (org_id, words, direction, kind, category_id, cost_center_id, counterparty, created_by)
    values (target_org, public.finance_memo_words(words_value), case when line.cents > 0 then 'in' else 'out' end,
      kind_value, category_value, center_value, counterparty_value, auth.uid())
    on conflict (org_id, words, direction) do update set kind = excluded.kind, category_id = excluded.category_id,
      cost_center_id = excluded.cost_center_id, counterparty = excluded.counterparty, created_by = excluded.created_by;
    others := public.finance_decide_lines(target_org, null);
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.line_decided', 'finance_statement_line', line.id::text,
    jsonb_build_object('kind', kind_value, 'rule', words_value is not null));
  return jsonb_build_object('ok', true, 'entry_id', entry, 'others', others);
exception when sqlstate '22023' then
  return jsonb_build_object('ok', false, 'code', 'invalid_data', 'field', 'rule_words');
end;
$$;

revoke all on function public.decide_finance_line(uuid, uuid, jsonb) from public, anon;
grant execute on function public.decide_finance_line(uuid, uuid, jsonb) to authenticated;

/**
 * Undoes what ONE decided of a line (`operate`, the second factor): its entry is cancelled (with the other leg of a
 * transfer), a joined entry written by hand is let go, and the line waits for a person.
 */
create or replace function public.undo_finance_line(target_org uuid, target_line uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  line public.finance_statement_lines%rowtype;
  entry public.finance_entries%rowtype;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  select * into line from public.finance_statement_lines l where l.id = target_line and l.org_id = target_org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if line.state = 'pending' then
    return jsonb_build_object('ok', true, 'code', 'unchanged');
  end if;
  select * into entry from public.finance_entries e where e.id = line.entry_id;
  if line.state = 'matched' then
    update public.finance_entries set statement_line_id = null where id = line.entry_id;
    update public.finance_statement_lines set state = 'pending', entry_id = null, decided_by = null, decided_by_one = false,
      decided_rule = null, decided_at = null where id = line.id;
  elsif line.state = 'ignored' then
    update public.finance_statement_lines set state = 'pending', decided_by = null, decided_rule = null, decided_at = null
    where id = line.id;
  elsif entry.id is not null then
    perform public.finance_cancel_entries(
      array(select e.id from public.finance_entries e
            where e.id = entry.id or (entry.transfer_id is not null and e.transfer_id = entry.transfer_id)),
      'Desfeito', auth.uid());
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.line_undone', 'finance_statement_line', line.id::text, '{}'::jsonb);
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.undo_finance_line(uuid, uuid) from public, anon;
grant execute on function public.undo_finance_line(uuid, uuid) to authenticated;

-- ---------- What the screens read ----------

/**
 * The home of the books, for who reads them: whether they are open and from when, the level of who asks, each account
 * with its balance, the four numbers of the month against the same days of the month before (the balance in the
 * accounts, the revenue, the expense, the clients' money in the accounts), the lines that wait for a person, and the
 * latest entries. Null for who does not read the books.
 */
create or replace function public.firm_finance_home(target_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  firm public.organizations%rowtype;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  month_start date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  before_day date;
  before_start date;
begin
  if not public.finance_reads(target_org) then
    return null;
  end if;
  select * into firm from public.organizations where id = target_org;
  before_start := (month_start - interval '1 month')::date;
  before_day := least((today - interval '1 month')::date, (month_start - 1));
  return jsonb_build_object(
    'level', public.finance_level(target_org),
    'opened_on', firm.finance_opened_on,
    'accounts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'kind', a.kind, 'name', a.name, 'institution', a.institution, 'number_tail', a.number_tail,
        'archived', a.archived_at is not null,
        'balance_cents', public.finance_account_balance(a.id, today),
        'pending', (select count(*) from public.finance_statement_lines l where l.account_id = a.id and l.state = 'pending'),
        'last_statement', (select max(s.ends_on) from public.finance_statements s where s.account_id = a.id and s.status = 'done'),
        'balance_gap_cents', (
          select s.balance_gap_cents from public.finance_statements s
          where s.account_id = a.id and s.status = 'done' order by s.imported_at desc limit 1)
      ) order by a.archived_at nulls first, a.kind, a.name)
      from public.finance_accounts a where a.org_id = target_org
    ), '[]'::jsonb),
    'numbers', jsonb_build_object(
      'balance', jsonb_build_object(
        'now', coalesce((select sum(public.finance_account_balance(a.id, today)) from public.finance_accounts a
                         where a.org_id = target_org and a.kind <> 'card'), 0),
        'before', coalesce((select sum(public.finance_account_balance(a.id, before_day)) from public.finance_accounts a
                            where a.org_id = target_org and a.kind <> 'card'), 0)),
      'income', jsonb_build_object(
        'now', coalesce((select sum(e.cents) from public.finance_entries e where e.org_id = target_org and e.cancelled_at is null
                         and e.kind = 'income' and e.occurred_on between month_start and today), 0),
        'before', coalesce((select sum(e.cents) from public.finance_entries e where e.org_id = target_org and e.cancelled_at is null
                            and e.kind = 'income' and e.occurred_on between before_start and before_day), 0)),
      'expense', jsonb_build_object(
        'now', coalesce((select -sum(e.cents) from public.finance_entries e where e.org_id = target_org and e.cancelled_at is null
                         and e.kind = 'expense' and e.occurred_on between month_start and today), 0),
        'before', coalesce((select -sum(e.cents) from public.finance_entries e where e.org_id = target_org and e.cancelled_at is null
                            and e.kind = 'expense' and e.occurred_on between before_start and before_day), 0)),
      'client_money', jsonb_build_object(
        'now', coalesce((select sum(e.cents) from public.finance_entries e where e.org_id = target_org and e.cancelled_at is null
                         and e.kind = 'client_money' and e.occurred_on <= today), 0),
        'before', coalesce((select sum(e.cents) from public.finance_entries e where e.org_id = target_org and e.cancelled_at is null
                            and e.kind = 'client_money' and e.occurred_on <= before_day), 0))
    ),
    'pending_lines', (select count(*) from public.finance_statement_lines l where l.org_id = target_org and l.state = 'pending'),
    'latest', coalesce((
      select jsonb_agg(x.item order by x.occurred_on desc, x.created_at desc)
      from (
        select e.occurred_on, e.created_at, jsonb_build_object(
          'id', e.id, 'kind', e.kind, 'cents', e.cents, 'occurred_on', e.occurred_on, 'by_one', e.by_one,
          'category', c.name, 'account', a.name, 'counterparty', e.counterparty, 'description', e.description) as item
        from public.finance_entries e
        join public.finance_accounts a on a.id = e.account_id
        left join public.finance_categories c on c.id = e.category_id
        where e.org_id = target_org and e.cancelled_at is null
        order by e.occurred_on desc, e.created_at desc
        limit 5
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.firm_finance_home(uuid) from public, anon;
grant execute on function public.firm_finance_home(uuid) to authenticated;

/** What the person asking reads of the books' level, and whether they are open: what the menu and the screens read. */
create or replace function public.firm_finance_access(target_org uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'level', public.finance_level(target_org),
    'opened', (select o.finance_opened_on is not null from public.organizations o where o.id = target_org),
    'decides', public.decides_for_firm(target_org)
  )
  where public.is_org_member(target_org);
$$;

revoke all on function public.firm_finance_access(uuid) from public, anon;
grant execute on function public.firm_finance_access(uuid) to authenticated;
