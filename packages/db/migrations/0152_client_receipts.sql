-- ============================================================
-- 0152 · O recibo ao cliente
--
-- The plan of the finance, phase 5: when a bill of a client is received, ONE
-- issues the receipt as a document of the firm with its public code, and the
-- client reads it on their link. ONE receives no money: the receipt says what
-- the firm recorded as received (a payment of a bill to receive of a case,
-- written by a person or joined by ONE from the statement), from whom (the
-- person of the case the bill names, else the case's first adult claimant, or
-- who answers for a minor) and what for. A payment undone takes its receipt
-- with it: the receipt is void and its document revoked, which the public
-- check says.
--
-- Issuing it is the firm's to let ONE (`client_receipt`, ONE's by default);
-- kept to a person, the receipt waits for who operates the books to ask for
-- it on the bill. A receipt that keeps failing waits for a person too.
--
--   finance_receipts           each receipt owed, issued, failed or void;
--   case_bill_payer            internal: whom a bill of a case is received from;
--   claim_finance_receipts     the backend's numbered claim;
--   finance_receipt_to_issue   the backend's: what the receipt says;
--   record_finance_receipt     the backend's: the document it became, or why not;
--   request_finance_receipt    a person asks for the receipts of a bill;
--   firm_finance_receipts      what who reads the books sees of them;
--   client_link_receipts       the backend's: a client's receipts on their link;
--   client_link_receipt_file   the backend's: the file of one, to download.
-- ============================================================

update public.platform_settings
set value = jsonb_build_object('receipt_attempts', 5) || value
where key = 'finance' and not value ? 'receipt_attempts';

insert into public.autonomy_decisions (key, task, position, modes) values
  ('client_receipt', null, 150, array['auto', 'approval'])
on conflict (key) do nothing;

insert into public.one_work_kinds (key, family, position, minutes, decision) values
  ('recibo_cliente', 'financeiro', 1110, 3, 'client_receipt')
on conflict (key) do nothing;

create table public.finance_receipts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  bill_id uuid not null,
  payment_id uuid not null references public.finance_bill_payments (id) on delete cascade,
  case_id uuid not null,
  -- Whom it was received from: the person of the case, and the name as the receipt writes it.
  person_id uuid,
  payer text not null,
  cents bigint not null,
  paid_on date not null,
  about text not null,
  -- owed: ONE issues it (or it waits for a person, where the firm keeps it so); issued; failed: after its attempts,
  -- for a person to ask again; void: its payment was undone.
  status text not null default 'owed',
  requested_by uuid references public.profiles (id) on delete set null,
  requested_at timestamptz,
  claim_seq integer not null default 0,
  claimed_at timestamptz,
  attempts integer not null default 0,
  error text,
  issued_document_id uuid,
  issued_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  unique (payment_id),
  unique (id, org_id),
  foreign key (bill_id, org_id) references public.finance_bills (id, org_id) on delete cascade,
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (person_id, org_id) references public.people (id, org_id) on delete set null (person_id),
  foreign key (issued_document_id, org_id) references public.issued_documents (id, org_id)
    on delete set null (issued_document_id),
  constraint finance_receipts_status_check check (status in ('owed', 'issued', 'failed', 'void')),
  constraint finance_receipts_cents_check check (cents > 0),
  constraint finance_receipts_text_check check (
    char_length(payer) between 1 and 200 and char_length(about) between 1 and 300
  ),
  constraint finance_receipts_issued_check check ((status = 'issued') = (issued_at is not null) or status = 'void'),
  constraint finance_receipts_void_check check ((status = 'void') = (voided_at is not null)),
  constraint finance_receipts_error_check check (error is null or error ~ '^[a-z][a-z0-9_]{1,59}$')
);

create index finance_receipts_bill_idx on public.finance_receipts (bill_id);
create index finance_receipts_owed_idx on public.finance_receipts (created_at) where status = 'owed';
create index finance_receipts_case_idx on public.finance_receipts (case_id) where status = 'issued';

alter table public.finance_receipts enable row level security;
create policy "finance_receipts_select_reader" on public.finance_receipts
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.finance_receipts to authenticated;
create trigger guard_impersonation_finance_receipts after insert or update or delete on public.finance_receipts
  for each statement execute function public.guard_impersonation_readonly();

-- A receipt says what a client paid the firm: like the rest of the books, only who reads them reads it, its
-- issued document and its file included (the public check reads neither).
drop policy "issued_documents_select_member" on public.issued_documents;
create policy "issued_documents_select_member" on public.issued_documents
  for select to authenticated
  using (public.is_org_member(org_id) and (kind <> 'recibo' or public.finance_reads(org_id)));

drop policy "files_select_member" on public.files;
create policy "files_select_member" on public.files
  for select to authenticated
  using (
    public.is_org_member(org_id) and partner_id is null and (purpose <> 'finance' or public.finance_reads(org_id))
    and (purpose <> 'issued' or public.finance_reads(org_id) or not exists (
      select 1 from public.issued_documents i where i.file_id = files.id and i.kind = 'recibo'
    ))
  );

-- ---------- Owed when a client's bill is received ----------
/**
 * Whom a bill of a case is received from (internal): the person of the case the bill names (its counterparty, as
 * fee bills write the client's name), else the case's first adult claimant, else who answers for a minor.
 */
create or replace function public.case_bill_payer(target_case uuid, target_counterparty text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select cp.person_id
  from public.case_parties cp
  join public.people p on p.id = cp.person_id
  where cp.case_id = target_case and ((cp.role = 'claimant' and cp.guardian_id is null) or cp.role = 'guardian')
  order by (lower(btrim(p.full_name)) = lower(btrim(coalesce(target_counterparty, '')))) desc,
    (cp.role = 'claimant') desc, cp.created_at
  limit 1;
$$;

revoke all on function public.case_bill_payer(uuid, text) from public, anon, authenticated;

/** A payment of a bill to receive of a case owes its receipt. */
create or replace function public.finance_receipt_owed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  bill public.finance_bills%rowtype;
  payer_id uuid;
  payer_name text;
begin
  select * into bill from public.finance_bills where id = new.bill_id;
  if not found or bill.direction <> 'receive' or bill.case_id is null then
    return new;
  end if;
  payer_id := public.case_bill_payer(bill.case_id, bill.counterparty);
  payer_name := coalesce((select p.full_name from public.people p where p.id = payer_id), nullif(btrim(bill.counterparty), ''));
  if payer_name is null then
    return new;
  end if;
  insert into public.finance_receipts (org_id, bill_id, payment_id, case_id, person_id, payer, cents, paid_on, about)
  values (bill.org_id, bill.id, new.id, bill.case_id, payer_id, left(payer_name, 200), new.base_cents + new.extra_cents,
    new.paid_on, left(coalesce(nullif(btrim(bill.description), ''), 'Honorários advocatícios'), 300))
  on conflict (payment_id) do nothing;
  return new;
end;
$$;

revoke all on function public.finance_receipt_owed() from public, anon, authenticated;

create trigger finance_bill_payments_receipt after insert on public.finance_bill_payments
  for each row execute function public.finance_receipt_owed();

/** A payment undone takes its receipt: void, and the document it became revoked, which the public check says. */
create or replace function public.finance_receipt_undone()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt public.finance_receipts%rowtype;
begin
  if new.undone_at is null or old.undone_at is not null then
    return new;
  end if;
  for receipt in
    select * from public.finance_receipts r where r.payment_id = new.id and r.status <> 'void' for update
  loop
    update public.finance_receipts set status = 'void', voided_at = now(), claimed_at = null where id = receipt.id;
    if receipt.issued_document_id is not null then
      update public.issued_documents
      set status = 'revoked', revoked_at = now(), revoke_reason = 'O pagamento deste recibo foi desfeito pelo escritório.'
      where id = receipt.issued_document_id and org_id = receipt.org_id and status = 'issued';
    end if;
    insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
    values (receipt.org_id, auth.uid(), 'finance.receipt_voided', 'finance_receipt', receipt.id::text,
      jsonb_build_object('bill', receipt.bill_id));
  end loop;
  return new;
end;
$$;

revoke all on function public.finance_receipt_undone() from public, anon, authenticated;

create trigger finance_bill_payments_receipt_void after update of undone_at on public.finance_bill_payments
  for each row execute function public.finance_receipt_undone();

-- ---------- The backend issues it ----------
/**
 * The receipts the backend issues now, each under a number (the backend's): owed, of a firm that lets ONE issue them
 * or asked for by a person, never one another claim holds for less than ten minutes.
 */
create or replace function public.claim_finance_receipts(target_limit integer default 10)
returns table (receipt_id uuid, claim_seq integer)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  with due as (
    select r.id from public.finance_receipts r
    where r.status = 'owed' and (r.claimed_at is null or r.claimed_at < now() - interval '10 minutes')
      and (r.requested_at is not null or public.firm_autonomy_mode(r.org_id, 'client_receipt') = 'auto')
    order by r.created_at
    limit least(greatest(coalesce(target_limit, 10), 1), 50)
    for update skip locked
  )
  update public.finance_receipts r
  set claim_seq = r.claim_seq + 1, claimed_at = now(), attempts = r.attempts + 1
  from due where r.id = due.id
  returning r.id, r.claim_seq;
end;
$$;

revoke all on function public.claim_finance_receipts(integer) from public, anon, authenticated;
grant execute on function public.claim_finance_receipts(integer) to service_role;

/** What the receipt says, for who holds its claim (the backend's). */
create or replace function public.finance_receipt_to_issue(target_receipt uuid, target_seq integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  receipt public.finance_receipts%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into receipt from public.finance_receipts where id = target_receipt;
  if not found or receipt.status <> 'owed' or receipt.claim_seq <> target_seq then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  return jsonb_build_object(
    'ok', true,
    'org_id', receipt.org_id,
    'firm', (select o.name from public.organizations o where o.id = receipt.org_id),
    'firm_document', (select o.billing_cpf_cnpj from public.organizations o where o.id = receipt.org_id),
    'payer', coalesce((select p.full_name from public.people p where p.id = receipt.person_id), receipt.payer),
    'payer_cpf', (select p.cpf from public.people p where p.id = receipt.person_id),
    'cents', receipt.cents,
    'paid_on', receipt.paid_on,
    'about', receipt.about,
    'case_seq', (select c.seq from public.cases c where c.id = receipt.case_id),
    'issued_on', (now() at time zone 'America/Sao_Paulo')::date
  );
end;
$$;

revoke all on function public.finance_receipt_to_issue(uuid, integer) from public, anon, authenticated;
grant execute on function public.finance_receipt_to_issue(uuid, integer) to service_role;

/**
 * What issuing a receipt came to (the backend's): the document it became, or why not. The same document named again
 * is the same record; a document issued for a receipt whose payment was undone meanwhile is revoked at once, so
 * nothing stands for money the firm no longer records. After the setting's attempts, a receipt waits for a person.
 */
create or replace function public.record_finance_receipt(
  target_receipt uuid,
  target_seq integer,
  target_document uuid default null,
  target_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  receipt public.finance_receipts%rowtype;
  code text := coalesce(substring(lower(coalesce(target_code, '')) from '^[a-z][a-z0-9_]{1,59}'), 'failed');
  most integer := greatest(public.finance_setting('receipt_attempts', 5), 1);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into receipt from public.finance_receipts where id = target_receipt for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if target_document is not null and receipt.status = 'issued' and receipt.issued_document_id = target_document then
    return jsonb_build_object('ok', true, 'code', 'issued');
  end if;
  if target_document is not null and not exists (
    select 1 from public.issued_documents i
    where i.id = target_document and i.org_id = receipt.org_id and i.kind = 'recibo' and i.status = 'issued'
  ) then
    return jsonb_build_object('ok', false, 'code', 'document_not_found');
  end if;
  if receipt.status = 'void' then
    if target_document is not null then
      update public.issued_documents
      set status = 'revoked', revoked_at = now(), revoke_reason = 'O pagamento deste recibo foi desfeito pelo escritório.'
      where id = target_document and status = 'issued';
    end if;
    return jsonb_build_object('ok', true, 'code', 'void');
  end if;
  if receipt.status <> 'owed' or receipt.claim_seq <> target_seq then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if target_document is null then
    update public.finance_receipts
    set error = code, claimed_at = null, status = case when receipt.attempts >= most then 'failed' else 'owed' end
    where id = receipt.id;
    return jsonb_build_object('ok', true, 'code', 'failed');
  end if;
  update public.finance_receipts
  set status = 'issued', issued_document_id = target_document, issued_at = now(), error = null, claimed_at = null
  where id = receipt.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (receipt.org_id, null, 'finance.receipt_issued', 'finance_receipt', receipt.id::text,
    jsonb_build_object('bill', receipt.bill_id, 'document', target_document, 'auto', receipt.requested_at is null));
  return jsonb_build_object('ok', true, 'code', 'issued');
end;
$$;

revoke all on function public.record_finance_receipt(uuid, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.record_finance_receipt(uuid, integer, uuid, text) to service_role;

-- ---------- A person asks for it ----------
/**
 * Who operates the books asks for the receipts of a bill (the second factor): one that waits for a person where the
 * firm keeps receipts to a person, or one that failed. Answers how many it asked for.
 */
create or replace function public.request_finance_receipt(target_org uuid, target_bill uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
  asked integer;
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  update public.finance_receipts
  set status = 'owed', requested_by = auth.uid(), requested_at = now(), attempts = 0, error = null, claimed_at = null
  where org_id = target_org and bill_id = target_bill and status in ('owed', 'failed');
  get diagnostics asked = row_count;
  if asked = 0 then
    return jsonb_build_object('ok', false, 'code', 'nothing_owed');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'finance.receipt_requested', 'finance_bill', target_bill::text,
    jsonb_build_object('receipts', asked));
  return jsonb_build_object('ok', true, 'code', 'requested', 'receipts', asked);
end;
$$;

revoke all on function public.request_finance_receipt(uuid, uuid) from public, anon;
grant execute on function public.request_finance_receipt(uuid, uuid) to authenticated;

/**
 * The receipts of the bills a screen shows, for who reads the books: each with where it stands (`waiting` where the
 * firm keeps receipts to a person and nobody asked yet) and, once issued, its public code and file.
 */
create or replace function public.firm_finance_receipts(target_org uuid, target_bills uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  mode text;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not public.finance_reads(target_org) then
    return null;
  end if;
  mode := public.firm_autonomy_mode(target_org, 'client_receipt');
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'bill_id', r.bill_id, 'cents', r.cents, 'paid_on', r.paid_on, 'issued_at', r.issued_at,
      'error', r.error,
      'status', case when r.status = 'owed' and r.requested_at is null and mode <> 'auto' then 'waiting' else r.status end,
      'issued_documents', (select jsonb_build_object('verify_code', i.verify_code, 'file_id', i.file_id)
                           from public.issued_documents i where i.id = r.issued_document_id)
    ) order by r.created_at desc)
    from public.finance_receipts r
    where r.org_id = target_org and r.bill_id = any (coalesce(target_bills, '{}'::uuid[]))
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.firm_finance_receipts(uuid, uuid[]) from public, anon;
grant execute on function public.firm_finance_receipts(uuid, uuid[]) to authenticated;

-- ---------- The client reads them on their link ----------
/** The receipts of the link's person in its case, issued and in force (the backend's, by the link's token). */
create or replace function public.client_link_receipts(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if link.id is null or link.revoked_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  return jsonb_build_object('ok', true, 'receipts', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'cents', r.cents, 'paid_on', r.paid_on, 'about', r.about, 'issued_at', r.issued_at,
      'verify_code', i.verify_code
    ) order by r.paid_on desc, r.created_at desc)
    from public.finance_receipts r
    join public.issued_documents i on i.id = r.issued_document_id and i.status = 'issued'
    where r.case_id = link.case_id and r.person_id = link.person_id and r.status = 'issued'
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.client_link_receipts(text) from public, anon, authenticated;
grant execute on function public.client_link_receipts(text) to service_role;

/** The file of one receipt of the link's person, for the backend to sign a link of a minute. */
create or replace function public.client_link_receipt_file(target_token text, target_receipt uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
  path text;
  title text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if link.id is null or link.revoked_at is not null or link.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  select f.storage_path, i.title into path, title
  from public.finance_receipts r
  join public.issued_documents i on i.id = r.issued_document_id and i.status = 'issued'
  join public.files f on f.id = i.file_id and f.status = 'stored'
  where r.id = target_receipt and r.case_id = link.case_id and r.person_id = link.person_id and r.status = 'issued';
  if path is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'storage_path', path, 'name', title || '.pdf');
end;
$$;

revoke all on function public.client_link_receipt_file(text, uuid) from public, anon, authenticated;
grant execute on function public.client_link_receipt_file(text, uuid) to service_role;

-- ---------- The work of ONE counts it ----------
/** Every act of ONE's work of a firm in a period, the receipts to clients among them (0152). Internal. */
create or replace function public.one_work_acts(target_org uuid, target_from timestamptz, target_to timestamptz)
returns table (kind text, at timestamptz, case_id uuid, assisted boolean, test boolean)
language sql
stable
security definer
set search_path = public
as $$
  -- The conversation: a case ONE opened at the passenger's yes.
  select 'caso_aberto_conversa', e.at, e.case_id, false, null::boolean
  from public.case_events e
  where e.org_id = target_org and e.kind = 'created' and e.actor_type = 'system'
    and e.data ->> 'from' = 'conversation' and e.at >= target_from and e.at < target_to
  union all
  -- ONE's answer that went out in a conversation, written by its model; approved by a person, apart.
  select 'resposta_conversa', m.created_at, null, exists (
           select 1 from public.approvals a
           where a.run_id = m.ai_run_id and a.status = 'approved' and a.decided_by is not null
         ), n.provider = 'test'
  from public.wa_messages m
  join public.ai_runs r on r.id = m.ai_run_id and r.task = 'atendimento.conversa'
  join public.wa_numbers n on n.id = m.number_id
  where m.org_id = target_org and m.direction = 'out' and m.status in ('sent', 'delivered', 'read')
    and m.created_at >= target_from and m.created_at < target_to
  union all
  -- The client's link ONE made and sent, which no person ended or replaced.
  select 'link_cliente', l.created_at, l.case_id, false, null
  from public.client_links l
  where l.org_id = target_org and l.created_by is null and l.revoked_by is null
    and l.created_at >= target_from and l.created_at < target_to
    and exists (
      select 1 from public.case_events e
      where e.case_id = l.case_id and e.kind = 'client_link_created' and e.actor_type = 'system'
        and e.data ->> 'link' = l.id::text
    )
  union all
  -- A file the passenger sent in the conversation, joined to their case by ONE, still there.
  select 'arquivo_conversa', e.at, e.case_id, false, null
  from public.case_events e
  where e.org_id = target_org and e.kind = 'document_added' and e.actor_type = 'system'
    and e.data ->> 'source' = 'whatsapp' and e.at >= target_from and e.at < target_to
    and exists (select 1 from public.case_documents d where d.id::text = e.data ->> 'document')
  union all
  -- An answer of the interview the passenger gave in the conversation and ONE read, which no person rewrote.
  select 'resposta_entrevista', a.answered_at, a.case_id, false, null
  from public.case_interview_answers a
  where a.org_id = target_org and a.source = 'chat' and a.status in ('answered', 'unknown')
    and a.answered_at >= target_from and a.answered_at < target_to
  union all
  -- A document checked by ONE: decided by its check alone, or by a person who approved the check (apart).
  select 'documento_conferido', d.decided_at, d.case_id, d.decided_by is not null, null
  from public.case_documents d
  where d.org_id = target_org and d.status in ('accepted', 'rejected') and d.check_run_id is not null
    and d.decided_at >= target_from and d.decided_at < target_to
    and (d.decided_by is null or exists (
      select 1 from public.approvals a
      where a.run_id = d.check_run_id and a.status = 'approved' and a.decided_by is not null
    ))
  union all
  -- A person's data written from a document, while what was written stands or was confirmed.
  select 'dados_lidos', e.at, e.case_id, e.actor_type = 'person', null
  from public.case_events e
  join public.people p on p.id::text = e.data ->> 'person'
  where e.org_id = target_org and e.kind = 'person_read' and e.at >= target_from and e.at < target_to
    and (
      p.read_fields ?| array(select jsonb_array_elements_text(coalesce(e.data -> 'fields', '[]'::jsonb)))
      or exists (
        select 1 from public.case_events c
        where c.case_id = e.case_id and c.kind = 'person_read_confirmed' and c.at >= e.at
          and c.data ->> 'person' = e.data ->> 'person'
      )
    )
  union all
  -- A photo made a PDF of the size the courts take.
  select 'foto_pdf', f.created_at, d.case_id, false, null
  from public.case_documents d
  join public.files f on f.id = d.normalized_file_id and f.status = 'stored'
  where d.org_id = target_org and f.created_at >= target_from and f.created_at < target_to
  union all
  -- An audio heard and written down, which no person wrote over; approved by a person, apart.
  select 'audio_transcrito', r.finished_at, s.case_id, exists (
           select 1 from public.approvals a
           where a.run_id = s.transcript_run_id and a.status = 'approved' and a.decided_by is not null
         ), null
  from public.case_statements s
  join public.ai_runs r on r.id = s.transcript_run_id
  where s.org_id = target_org and s.audio_file_id is not null and s.transcript is not null
    and r.finished_at >= target_from and r.finished_at < target_to
  union all
  -- The order of the facts that went to the client: by ONE alone, or by a person who approved it (apart).
  select 'ordem_dos_fatos', coalesce(a.decided_at, r.finished_at), s.case_id, a.id is not null, null
  from public.case_statements s
  join public.ai_runs r on r.id = s.chronology_run_id
  left join public.approvals a
    on a.run_id = s.chronology_run_id and a.status = 'approved' and a.decided_by is not null
  where s.org_id = target_org and s.chronology_status in ('approved', 'confirmed', 'contested')
    and coalesce(a.decided_at, r.finished_at) >= target_from and coalesce(a.decided_at, r.finished_at) < target_to
  union all
  -- The lawsuits ONE created.
  select 'acoes_criadas', p.created_at, p.case_id, false, null
  from public.proceedings p
  where p.org_id = target_org and p.created_by_one and p.created_at >= target_from and p.created_at < target_to
  union all
  -- The court's system ONE named for a lawsuit and a person of the firm approved.
  select 'sistema_tribunal', p.system_approved_at, p.case_id, true, null
  from public.proceedings p
  where p.org_id = target_org and p.system_by_one and p.system is not null and p.system_refused_at is null
    and p.system_approved_by is not null
    and p.system_approved_at >= target_from and p.system_approved_at < target_to
  union all
  -- A leg checked against ANAC's record of the flights.
  select 'voo_conferido', f.checked_at, f.case_id, false, null
  from public.flight_checks f
  where f.org_id = target_org and f.source = 'vra' and f.status in ('found', 'not_found')
    and f.checked_at >= target_from and f.checked_at < target_to
  union all
  -- The weather of the affected leg read for the Tema 1.417 (its latest reading).
  select 'clima_lido', (c.weather_read ->> 'at')::timestamptz, c.id, false, null
  from public.cases c
  where c.org_id = target_org and c.weather_read ? 'at'
    and (c.weather_read ->> 'at')::timestamptz >= target_from and (c.weather_read ->> 'at')::timestamptz < target_to
  union all
  -- The decision to file or hold on the Tema 1.417, taken by ONE and kept.
  select 'tema_1417', c.suspension_decided_at, c.id, false, null
  from public.cases c
  where c.org_id = target_org and c.suspension_decided_auto and c.suspension_decision in ('file', 'hold')
    and c.suspension_decided_at >= target_from and c.suspension_decided_at < target_to
  union all
  -- The first text of a piece written by ONE, not turned down nor given up; approved by a lawyer, apart.
  select 'texto_peca', v.created_at, d.case_id, d.approved_by is not null, null
  from public.case_draft_versions v
  join public.case_drafts d on d.id = v.draft_id
  where v.org_id = target_org and v.version = 1 and v.author = 'ai' and d.status in ('proposed', 'approved', 'issued')
    and v.created_at >= target_from and v.created_at < target_to
  union all
  -- A piece ONE approved itself, and nobody took the approval back.
  select 'peca_aprovada', d.approved_at, d.case_id, false, null
  from public.case_drafts d
  where d.org_id = target_org and d.approved_auto and d.status in ('approved', 'issued')
    and d.approved_at >= target_from and d.approved_at < target_to
  union all
  -- A paper for the client to sign (a power of attorney, a contract) ONE wrote and sent, its signature not ended.
  select 'papel_cliente', p.created_at, p.case_id, false, null
  from public.case_papers p
  left join public.signature_envelopes s on s.id = p.envelope_id
  where p.org_id = target_org and p.created_at >= target_from and p.created_at < target_to
    and (s.id is null or s.status not in ('cancelled', 'failed'))
  union all
  -- A dossier of the case written and issued.
  select 'dossie', d.issued_at, d.case_id, false, null
  from public.dossiers d
  where d.org_id = target_org and d.status = 'issued' and d.issued_at >= target_from and d.issued_at < target_to
  union all
  -- A filing package built, not given up.
  select 'pacote_protocolo', f.built_at, f.case_id, false, null
  from public.filing_packages f
  where f.org_id = target_org and f.status in ('ready', 'filed') and f.built_at >= target_from and f.built_at < target_to
  union all
  -- The files of a package signed with a lawyer's authorization.
  select 'arquivos_assinados', f.signed_at, f.case_id, false, null
  from public.filing_packages f
  where f.org_id = target_org and f.status in ('ready', 'filed') and f.signature_status = 'signed'
    and f.signed_at >= target_from and f.signed_at < target_to
  union all
  -- A lawsuit filed by ONE in the court's own channel.
  select 'acao_protocolada', s.filed_at, s.case_id, false, null
  from public.filing_submissions s
  where s.org_id = target_org and s.status = 'filed' and s.filed_at >= target_from and s.filed_at < target_to
  union all
  -- A communication of the DJEN read for the firm.
  select 'publicacao_capturada', p.captured_at, p.case_id, false, null
  from public.publications p
  where p.org_id = target_org and p.captured_at >= target_from and p.captured_at < target_to
  union all
  -- A publication triaged by ONE whose triage stands; checked by a person and kept, apart.
  select 'publicacao_triada', p.triaged_at, p.case_id, p.triaged_by is not null or p.reviewed_by is not null, null
  from public.publications p
  where p.org_id = target_org and p.ai_applied and p.category is not null
    and (p.triaged_by is null or p.category = p.ai_category)
    and p.triaged_at >= target_from and p.triaged_at < target_to
  union all
  -- A deadline ONE read from a publication and proposed, not dismissed.
  select 'prazo_lido', d.created_at, d.case_id, false, null
  from public.deadlines d
  where d.org_id = target_org and d.proposed_auto and d.status <> 'dismissed'
    and d.created_at >= target_from and d.created_at < target_to
  union all
  -- A hearing ONE read from a publication and registered, not cancelled.
  select 'audiencia_lida', h.created_at, h.case_id, false, null
  from public.hearings h
  where h.org_id = target_org and h.created_auto and h.status <> 'cancelled'
    and h.created_at >= target_from and h.created_at < target_to
  union all
  -- A movement of a lawsuit the court made and ONE read, never the history its first reading brought.
  select 'andamento_lido', x.learned_at, x.case_id, false, null
  from (
    select m.case_id, m.learned_at, min(m.learned_at) over (partition by m.proceeding_id, m.source) as first_at
    from public.movements m
    where m.org_id = target_org and m.proceeding_id in (
      select n.proceeding_id from public.movements n
      where n.org_id = target_org and n.learned_at >= target_from and n.learned_at < target_to
    )
  ) x
  where x.learned_at > x.first_at and x.learned_at >= target_from and x.learned_at < target_to
  union all
  -- A deadline counted by the rule over the court's calendar, as it stands.
  select 'prazo_contado', d.computed_at, d.case_id, false, null
  from public.deadlines d
  where d.org_id = target_org and d.computed_due_on is not null and d.computed_revision = d.revision
    and d.status <> 'dismissed' and d.computed_at >= target_from and d.computed_at < target_to
  union all
  -- A deadline ONE confirmed on the day it counted, as it stands.
  select 'prazo_confirmado', d.confirmed_at, d.case_id, false, null
  from public.deadlines d
  where d.org_id = target_org and d.confirmed_auto and d.status in ('confirmed', 'done')
    and d.confirmed_at >= target_from and d.confirmed_at < target_to
  union all
  -- A hearing written to the firm's calendar, as it stands.
  select 'audiencia_agenda', h.synced_at, h.case_id, false, null
  from public.hearings h
  where h.org_id = target_org and h.synced_revision = h.revision and h.synced_calendar is not null
    and h.status <> 'cancelled' and h.synced_at >= target_from and h.synced_at < target_to
  union all
  -- What the client was told on WhatsApp, each notice that went out (never the alert of a flight).
  select case
           when n.kind in ('hearing_reminder', 'hearing_change') then 'aviso_audiencia'
           when n.kind in ('lawsuit_update', 'lawsuit_filed', 'case_received') then 'aviso_andamento'
           when n.kind = 'payment_alert' then 'aviso_golpe'
           else 'pedido_documento'
         end,
         m.created_at, n.case_id, false, null
  from public.client_notices n
  join public.wa_messages m on m.id = n.message_id
  where n.org_id = target_org and m.status in ('sent', 'delivered', 'read')
    and n.kind in ('hearing_reminder', 'hearing_change', 'lawsuit_update', 'lawsuit_filed', 'case_received',
                   'payment_alert', 'document_refused', 'case_questions')
    and m.created_at >= target_from and m.created_at < target_to
  union all
  -- A model of the library ONE made from the firm's own document, while the model is there: saved by ONE, or by a
  -- person from what ONE prepared (apart). The record of its saving is the only one the act leaves.
  select 'modelo_documento', a.created_at, null, a.action = 'library.import_saved', false
  from public.audit_events a
  where a.org_id = target_org and a.action in ('library.import_saved_by_one', 'library.import_saved')
    and a.created_at >= target_from and a.created_at < target_to
    and exists (
      select 1 from public.draft_templates t where t.org_id = target_org and t.id::text = a.metadata ->> 'template_id'
    )
  union all
  -- A line of a bank statement ONE entered or joined in the firm's books, by a rule or by the AI, while it
  -- stands (0128). `firm_one_work` says it only to who reads the books.
  select 'linha_extrato', l.decided_at, null, false, false
  from public.finance_statement_lines l
  where l.org_id = target_org and l.decided_by_one and l.state in ('entered', 'matched')
    and l.decided_at >= target_from and l.decided_at < target_to
  union all
  -- A fact of a lawsuit ONE read and recorded, in force and confirmed (0130).
  select 'resultado_lido', f.created_at, f.case_id, false, null
  from public.lawsuit_facts f
  where f.org_id = target_org and f.by_one and f.confirmed and f.corrected_at is null
    and f.created_at >= target_from and f.created_at < target_to
  union all
  -- A case ONE closed, while it stays closed (0130).
  select 'caso_encerrado', c.closed_at, c.id, false, null
  from public.cases c
  where c.org_id = target_org and c.status = 'closed' and c.closed_by_one
    and c.closed_at >= target_from and c.closed_at < target_to
  union all
  -- A receipt ONE issued to a client, while it stands (0152); one a person asked for, apart.
  select 'recibo_cliente', r.issued_at, r.case_id, r.requested_at is not null, null
  from public.finance_receipts r
  where r.org_id = target_org and r.status = 'issued'
    and r.issued_at >= target_from and r.issued_at < target_to;
$$;

revoke all on function public.one_work_acts(uuid, timestamptz, timestamptz) from public, anon, authenticated;
