-- ============================================================
-- 0156 · A prestação de contas ao cliente
--
-- The plan of the finance, phase 10: once a client's part of a release is
-- passed on (or the court paid it straight to them), ONE issues the
-- accountability statement as a document of the firm with its public code:
-- what the court released, the client's part, the fees and the costs the
-- firm kept and on what basis, what was held and why, what was passed on,
-- when and to which account (by its last digits). The client reads it on
-- their link under "Valores do seu processo". ONE moves no money: the
-- statement says what the firm recorded.
--
-- It follows the decision of the receipts (`client_receipt`): where the firm
-- keeps the receipts to a person, the statement waits for who operates the
-- books to ask for it too. A part that goes back to owed (its Pix undone)
-- voids its statement and revokes its document.
--
--   money_statements            each statement owed, issued, failed or void;
--   claim_money_statements      the backend's numbered claim;
--   money_statement_to_issue    the backend's: what the statement says;
--   record_money_statement      the backend's: the document it became;
--   request_money_statement     a person asks for one;
--   client_link_money_statements, client_link_money_statement_file
--                               the backend's: the client's, on their link.
-- ============================================================

insert into public.one_work_kinds (key, family, position, minutes, decision) values
  ('prestacao_contas', 'financeiro', 1120, 10, 'client_receipt')
on conflict (key) do nothing;

create table public.money_statements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  share_id uuid not null unique references public.money_shares (id) on delete cascade,
  case_id uuid not null,
  person_id uuid,
  status text not null default 'owed',
  -- A part passed on again after its Pix was undone owes a statement again: a new round, a new document.
  round integer not null default 1,
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
  unique (id, org_id),
  foreign key (case_id, org_id) references public.cases (id, org_id) on delete cascade,
  foreign key (person_id, org_id) references public.people (id, org_id) on delete set null (person_id),
  foreign key (issued_document_id, org_id) references public.issued_documents (id, org_id)
    on delete set null (issued_document_id),
  constraint money_statements_status_check check (status in ('owed', 'issued', 'failed', 'void')),
  constraint money_statements_issued_check check ((status = 'issued') = (issued_at is not null) or status = 'void'),
  constraint money_statements_void_check check ((status = 'void') = (voided_at is not null)),
  constraint money_statements_error_check check (error is null or error ~ '^[a-z][a-z0-9_]{1,59}$')
);

create index money_statements_owed_idx on public.money_statements (created_at) where status = 'owed';

alter table public.money_statements enable row level security;
create policy "money_statements_select_reader" on public.money_statements
  for select to authenticated using (public.finance_reads(org_id));
grant select on table public.money_statements to authenticated;
create trigger guard_impersonation_money_statements after insert or update or delete on public.money_statements
  for each statement execute function public.guard_impersonation_readonly();

-- Its document and file, like a receipt's, only to who reads the books (0152, 0153).
drop policy "issued_documents_select_member" on public.issued_documents;
create policy "issued_documents_select_member" on public.issued_documents
  for select to authenticated
  using (public.is_org_member(org_id) and (kind not in ('recibo', 'prestacao') or public.finance_reads(org_id)));

create or replace function public.file_is_receipt(target_file uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.issued_documents i where i.file_id = target_file and i.kind in ('recibo', 'prestacao'));
$$;

/** A part passed on, or paid by the court straight to the client, owes its statement; one back to owed voids it. */
create or replace function public.money_shares_statement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  statement public.money_statements%rowtype;
begin
  if new.status in ('paid', 'direct') and (tg_op = 'INSERT' or old.status not in ('paid', 'direct')) then
    insert into public.money_statements (org_id, share_id, case_id, person_id)
    values (new.org_id, new.id, new.case_id, new.person_id)
    on conflict (share_id) do update
      set status = 'owed', voided_at = null, attempts = 0, error = null, claimed_at = null,
          issued_document_id = null, issued_at = null, round = money_statements.round + 1
      where money_statements.status = 'void';
  elsif tg_op = 'UPDATE' and old.status in ('paid', 'direct') and new.status not in ('paid', 'direct') then
    for statement in select * from public.money_statements s where s.share_id = new.id and s.status <> 'void' for update loop
      update public.money_statements set status = 'void', voided_at = now(), claimed_at = null where id = statement.id;
      if statement.issued_document_id is not null then
        update public.issued_documents
        set status = 'revoked', revoked_at = now(), revoke_reason = 'O repasse desta prestação de contas foi desfeito pelo escritório.'
        where id = statement.issued_document_id and status = 'issued';
      end if;
    end loop;
  end if;
  return new;
end;
$$;

revoke all on function public.money_shares_statement() from public, anon, authenticated;

create trigger money_shares_statement after insert or update of status on public.money_shares
  for each row execute function public.money_shares_statement();

/** The statements the backend issues now, each under a number, as the receipts are (the backend's). */
create or replace function public.claim_money_statements(target_limit integer default 10)
returns table (statement_id uuid, claim_seq integer)
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
    select s.id from public.money_statements s
    where s.status = 'owed' and (s.claimed_at is null or s.claimed_at < now() - interval '10 minutes')
      and (s.requested_at is not null or public.firm_autonomy_mode(s.org_id, 'client_receipt') = 'auto')
    order by s.created_at
    limit least(greatest(coalesce(target_limit, 10), 1), 50)
    for update skip locked
  )
  update public.money_statements s
  set claim_seq = s.claim_seq + 1, claimed_at = now(), attempts = s.attempts + 1
  from due where s.id = due.id
  returning s.id, s.claim_seq;
end;
$$;

revoke all on function public.claim_money_statements(integer) from public, anon, authenticated;
grant execute on function public.claim_money_statements(integer) to service_role;

/** What the statement says, for who holds its claim (the backend's). */
create or replace function public.money_statement_to_issue(target_statement uuid, target_seq integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  statement public.money_statements%rowtype;
  share public.money_shares%rowtype;
  release public.money_releases%rowtype;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into statement from public.money_statements where id = target_statement;
  if not found or statement.status <> 'owed' or statement.claim_seq <> target_seq then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into share from public.money_shares where id = statement.share_id;
  select * into release from public.money_releases where id = share.release_id;
  return jsonb_build_object(
    'ok', true,
    'org_id', statement.org_id,
    'round', statement.round,
    'firm', (select o.name from public.organizations o where o.id = statement.org_id),
    'firm_document', (select o.billing_cpf_cnpj from public.organizations o where o.id = statement.org_id),
    'person', (select p.full_name from public.people p where p.id = share.person_id),
    'person_cpf', (select p.cpf from public.people p where p.id = share.person_id),
    'minor', share.minor,
    'case_seq', (select c.seq from public.cases c where c.id = share.case_id),
    'cnj', (select p.cnj from public.proceedings p where p.id = release.proceeding_id),
    'court', (select p.court from public.proceedings p where p.id = release.proceeding_id),
    'path', release.path,
    'released_cents', release.received_cents,
    'released_on', release.received_on,
    'gross_cents', share.gross_cents,
    'fees_cents', share.fees_cents,
    'fees_percent', (select f.success_percent from public.case_fees f where f.case_id = share.case_id),
    'costs_cents', share.costs_cents,
    'held_cents', share.held_cents,
    'held', share.held,
    'payable_cents', share.payable_cents,
    'paid_on', share.paid_on,
    'account', (select jsonb_build_object('kind', a.kind, 'ends', right(coalesce(a.pix_key, a.account, ''), 4))
                from public.client_payment_accounts a where a.person_id = share.person_id),
    'issued_on', (now() at time zone 'America/Sao_Paulo')::date
  );
end;
$$;

revoke all on function public.money_statement_to_issue(uuid, integer) from public, anon, authenticated;
grant execute on function public.money_statement_to_issue(uuid, integer) to service_role;

/** What issuing a statement came to (the backend's), as a receipt's (0152). */
create or replace function public.record_money_statement(
  target_statement uuid,
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
  statement public.money_statements%rowtype;
  code text := coalesce(substring(lower(coalesce(target_code, '')) from '^[a-z][a-z0-9_]{1,59}'), 'failed');
  most integer := greatest(public.finance_setting('receipt_attempts', 5), 1);
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into statement from public.money_statements where id = target_statement for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if target_document is not null and statement.status = 'issued' and statement.issued_document_id = target_document then
    return jsonb_build_object('ok', true, 'code', 'issued');
  end if;
  if target_document is not null and not exists (
    select 1 from public.issued_documents i
    where i.id = target_document and i.org_id = statement.org_id and i.kind = 'prestacao' and i.status = 'issued'
  ) then
    return jsonb_build_object('ok', false, 'code', 'document_not_found');
  end if;
  if statement.status = 'void' then
    if target_document is not null then
      update public.issued_documents
      set status = 'revoked', revoked_at = now(), revoke_reason = 'O repasse desta prestação de contas foi desfeito pelo escritório.'
      where id = target_document and status = 'issued';
    end if;
    return jsonb_build_object('ok', true, 'code', 'void');
  end if;
  if statement.status <> 'owed' or statement.claim_seq <> target_seq then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  if target_document is null then
    update public.money_statements
    set error = code, claimed_at = null, status = case when statement.attempts >= most then 'failed' else 'owed' end
    where id = statement.id;
    return jsonb_build_object('ok', true, 'code', 'failed');
  end if;
  update public.money_statements
  set status = 'issued', issued_document_id = target_document, issued_at = now(), error = null, claimed_at = null
  where id = statement.id;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (statement.org_id, null, 'money.statement_issued', 'money_statement', statement.id::text,
    jsonb_build_object('document', target_document, 'auto', statement.requested_at is null));
  return jsonb_build_object('ok', true, 'code', 'issued');
end;
$$;

revoke all on function public.record_money_statement(uuid, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.record_money_statement(uuid, integer, uuid, text) to service_role;

/** Who operates the books asks for the statement of a part (the second factor): one kept to a person, or that failed. */
create or replace function public.request_money_statement(target_org uuid, target_share uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  refusal text := public.finance_write_refusal(target_org, 'operate');
begin
  if refusal is not null then
    return jsonb_build_object('ok', false, 'code', refusal);
  end if;
  update public.money_statements
  set status = 'owed', requested_by = auth.uid(), requested_at = now(), attempts = 0, error = null, claimed_at = null
  where org_id = target_org and share_id = target_share and status in ('owed', 'failed');
  if not found then
    return jsonb_build_object('ok', false, 'code', 'nothing_owed');
  end if;
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (target_org, auth.uid(), 'money.statement_requested', 'money_share', target_share::text, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'code', 'requested');
end;
$$;

revoke all on function public.request_money_statement(uuid, uuid) from public, anon;
grant execute on function public.request_money_statement(uuid, uuid) to authenticated;

/** The statements of the firm's parts, for who reads the books (each with its state, and once issued its code and file). */
create or replace function public.firm_money_statements(target_org uuid)
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
      'id', s.id, 'share_id', s.share_id, 'issued_at', s.issued_at, 'error', s.error,
      'status', case when s.status = 'owed' and s.requested_at is null and mode <> 'auto' then 'waiting' else s.status end,
      'verify_code', i.verify_code, 'file_id', i.file_id
    ) order by s.created_at desc)
    from public.money_statements s
    left join public.issued_documents i on i.id = s.issued_document_id
    where s.org_id = target_org and s.status <> 'void'
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.firm_money_statements(uuid) from public, anon;
grant execute on function public.firm_money_statements(uuid) to authenticated;

/** The statements of the link's person, and of a minor they answer for, issued and in force (the backend's). */
create or replace function public.client_link_money_statements(target_token text)
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
  return jsonb_build_object('ok', true, 'statements', coalesce((
    select jsonb_agg(jsonb_build_object('id', s.id, 'share_id', s.share_id, 'verify_code', i.verify_code)
      order by s.issued_at desc)
    from public.money_statements s
    join public.money_shares sh on sh.id = s.share_id
    join public.issued_documents i on i.id = s.issued_document_id and i.status = 'issued'
    where s.case_id = link.case_id and s.status = 'issued'
      and (sh.person_id = link.person_id
           or (sh.minor and exists (select 1 from public.case_parties cp join public.case_parties g on g.id = cp.guardian_id
                                    where cp.id = sh.party_id and g.person_id = link.person_id)))
  ), '[]'::jsonb));
end;
$$;

revoke all on function public.client_link_money_statements(text) from public, anon, authenticated;
grant execute on function public.client_link_money_statements(text) to service_role;

/** The file of one statement of the link's person, for the backend to sign a link of a minute. */
create or replace function public.client_link_money_statement_file(target_token text, target_statement uuid)
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
  from public.money_statements s
  join public.money_shares sh on sh.id = s.share_id
  join public.issued_documents i on i.id = s.issued_document_id and i.status = 'issued'
  join public.files f on f.id = i.file_id and f.status = 'stored'
  where s.id = target_statement and s.case_id = link.case_id and s.status = 'issued'
    and (sh.person_id = link.person_id
         or (sh.minor and exists (select 1 from public.case_parties cp join public.case_parties g on g.id = cp.guardian_id
                                  where cp.id = sh.party_id and g.person_id = link.person_id)));
  if path is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'storage_path', path, 'name', title || '.pdf');
end;
$$;

revoke all on function public.client_link_money_statement_file(text, uuid) from public, anon, authenticated;
grant execute on function public.client_link_money_statement_file(text, uuid) to service_role;

-- ---------- The work of ONE counts it ----------
/** Every act of ONE's work of a firm in a period, the accountability statements among them (0156). Internal. */
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
    and r.issued_at >= target_from and r.issued_at < target_to
  union all
  -- An accountability statement ONE issued to a client, while it stands (0156); one a person asked for, apart.
  select 'prestacao_contas', s.issued_at, s.case_id, s.requested_at is not null, null
  from public.money_statements s
  where s.org_id = target_org and s.status = 'issued'
    and s.issued_at >= target_from and s.issued_at < target_to;
$$;

revoke all on function public.one_work_acts(uuid, timestamptz, timestamptz) from public, anon, authenticated;
