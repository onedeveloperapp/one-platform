begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- ============================================================
-- Account deletion (0013). The unit is the person plus the firm they alone
-- belong to; the history goes with it; files are listed for the Storage API
-- only once nothing alive can be pointed at. A person who is one of several
-- in a firm is removed and the firm stays; the owner of a firm other people
-- belong to cannot be deleted until the firm is handed over. Refused in the
-- database for yourself, a superadmin, a support visit and a live provider
-- subscription. Plus a catalog tripwire: a new NO ACTION / RESTRICT reference
-- fails here until somebody decides what deletion does with it.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ac000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now()),
  ('ac000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'saindo@teste.invalid', '', now(), '{}', '{"display_name":"Saindo"}', now(), now()),
  ('ac000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'outro-operador@one.invalid', '', now(), '{}', '{"display_name":"Outro operador"}', now(), now()),
  ('ac000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'dona@teste.invalid', '', now(), '{}', '{"display_name":"Dona"}', now(), now()),
  ('ac000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'colega@teste.invalid', '', now(), '{}', '{"display_name":"Colega"}', now(), now());

update public.profiles set is_superadmin = true
where id in ('ac000000-0000-4000-8000-000000000001', 'ac000000-0000-4000-8000-000000000003');

-- Firm X has one person. Firm Y has its owner and a colleague.
insert into public.organizations (id, name, slug, created_by) values
  ('bc000000-0000-4000-8000-00000000000a', 'Escritório X', 'escritorio-x', 'ac000000-0000-4000-8000-000000000002'),
  ('bc000000-0000-4000-8000-00000000000b', 'Escritório Y', 'escritorio-y', 'ac000000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bc000000-0000-4000-8000-00000000000a', 'ac000000-0000-4000-8000-000000000002', 'owner', 'socio'),
  ('bc000000-0000-4000-8000-00000000000b', 'ac000000-0000-4000-8000-000000000004', 'owner', 'socio'),
  ('bc000000-0000-4000-8000-00000000000b', 'ac000000-0000-4000-8000-000000000005', 'member', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated;

-- Everything an account accumulates.
insert into public.entitlement_grants (org_id, kind, limits, source, note)
values ('bc000000-0000-4000-8000-00000000000a', 'comp', '{"assentos_max": 3}', 'admin', 'teste');
insert into public.invoices (org_id, provider, provider_invoice_id, amount_cents, currency, status, paid_at)
values ('bc000000-0000-4000-8000-00000000000a', 'asaas', 'pay_x_1', 9700, 'BRL', 'paid', now());
insert into public.firm_invitations (org_id, email, firm_function, token_hash, expires_at)
values ('bc000000-0000-4000-8000-00000000000a', 'convidado@teste.invalid', 'advogado', repeat('a', 64), now() + interval '7 days');
insert into public.oab_registrations (user_id, uf, number) values
  ('ac000000-0000-4000-8000-000000000002', 'GO', '4001'),
  ('ac000000-0000-4000-8000-000000000005', 'GO', '4002');
insert into public.consent_acceptances (term_id, org_id, user_id)
select t.id, m.org_id, m.user_id
from public.consent_terms t
join public.memberships m on m.user_id in ('ac000000-0000-4000-8000-000000000002', 'ac000000-0000-4000-8000-000000000005')
where t.slug = 'newsletter';
insert into public.blog_posts (id, slug, title, is_published) values ('bc000000-0000-4000-8000-000000000002', 'post', 'Post', true);
insert into public.blog_comments (post_id, user_id, body)
values ('bc000000-0000-4000-8000-000000000002', 'ac000000-0000-4000-8000-000000000002', 'Muito bom.');
insert into storage.objects (bucket_id, name) values ('avatars', 'ac000000-0000-4000-8000-000000000002/avatar.png');
insert into public.product_events (org_id, actor_id, event_name)
values ('bc000000-0000-4000-8000-00000000000a', 'ac000000-0000-4000-8000-000000000002', 'firm.created');

-- ---------- Refusals ----------

select set_config('request.jwt.claims', '{"sub":"ac000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_account_deletion_preview('ac000000-0000-4000-8000-000000000003')$$,
  'P0001', 'not_authorized',
  'a person cannot even preview a deletion'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into res values ('preview', public.admin_account_deletion_preview('ac000000-0000-4000-8000-000000000002'));
insert into res values ('preview_owner', public.admin_account_deletion_preview('ac000000-0000-4000-8000-000000000004'));
insert into res values ('preview_colleague', public.admin_account_deletion_preview('ac000000-0000-4000-8000-000000000005'));
select throws_ok(
  $$select public.admin_delete_account('ac000000-0000-4000-8000-000000000002', 'errado@teste.invalid', 'Conta encerrada a pedido')$$,
  'P0001', 'confirmation_mismatch',
  'the typed e-mail is checked in the database, not only in the dialog'
);
select throws_ok(
  $$select public.admin_delete_account('ac000000-0000-4000-8000-000000000002', 'saindo@teste.invalid', 'curto')$$,
  'P0001', 'reason_required',
  'so is the reason'
);
select throws_ok(
  $$select public.admin_delete_account('ac000000-0000-4000-8000-000000000001', 'operador@one.invalid', 'Tentando excluir a mim mesmo')$$,
  'P0001', 'self_delete_forbidden',
  'an operator cannot delete their own account'
);
select throws_ok(
  $$select public.admin_delete_account('ac000000-0000-4000-8000-000000000003', 'outro-operador@one.invalid', 'Excluindo outro operador')$$,
  'P0001', 'target_is_superadmin',
  'nor another operator''s'
);
select throws_ok(
  $$select public.admin_delete_account('ac000000-0000-4000-8000-000000000004', 'dona@teste.invalid', 'Conta encerrada a pedido')$$,
  'P0001', 'shared_firm',
  'the owner of a firm other people belong to is not deleted: the firm is handed over first'
);
reset role;

select ok(
  (select jsonb_array_length(payload -> 'firms') = 1
          and payload -> 'firms' -> 0 ->> 'name' = 'Escritório X'
          and jsonb_array_length(payload -> 'blockers') = 0
          and (payload -> 'counts' ->> 'grants')::int = 1
          and (payload -> 'counts' ->> 'invoices')::int = 1
          and (payload -> 'counts' ->> 'invitations')::int = 1
          and (payload -> 'counts' ->> 'registrations')::int = 1
          and (payload -> 'counts' ->> 'consents')::int = 1
          and (payload -> 'counts' ->> 'files')::int = 1
   from res where name = 'preview'),
  'the preview names the firm that goes with the person and counts what it holds'
);
select ok(
  (select payload -> 'blockers' = '["shared_firm"]'::jsonb and payload -> 'sharedFirms' = '["Escritório Y"]'::jsonb
          and jsonb_array_length(payload -> 'firms') = 0
   from res where name = 'preview_owner'),
  'the preview of an owner with colleagues names the firm that blocks the deletion'
);
select ok(
  (select jsonb_array_length(payload -> 'blockers') = 0 and jsonb_array_length(payload -> 'firms') = 0
          and payload -> 'leavingFirms' = '["Escritório Y"]'::jsonb
   from res where name = 'preview_colleague'),
  'the preview of a colleague says which firm stays with one person fewer'
);

update public.subscriptions set provider = 'asaas', provider_subscription_id = 'sub_live_x'
where org_id = 'bc000000-0000-4000-8000-00000000000a' and status = 'active';
select set_config('request.jwt.claims', '{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_delete_account('ac000000-0000-4000-8000-000000000002', 'saindo@teste.invalid', 'Conta encerrada a pedido')$$,
  'P0001', 'provider_subscription_live',
  'an account still being charged by a provider is not deleted until the charge is canceled'
);
reset role;
update public.subscriptions set provider = null, provider_subscription_id = null
where org_id = 'bc000000-0000-4000-8000-00000000000a' and status = 'active';

insert into public.impersonation_sessions (actor_id, target_user_id, reason, session_id, expires_at)
values ('ac000000-0000-4000-8000-000000000003', 'ac000000-0000-4000-8000-000000000001',
        'Conferindo o console de contas', 'fc000000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select set_config('request.jwt.claims',
  '{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"fc000000-0000-4000-8000-000000000001"}', true);
set local role authenticated;
select throws_ok(
  $$select public.admin_delete_account('ac000000-0000-4000-8000-000000000002', 'saindo@teste.invalid', 'Conta encerrada a pedido')$$,
  'P0001', 'not_authorized',
  'nothing is deleted from inside a support visit, even a visit to an operator'
);
reset role;

-- ---------- Deleting somebody who is one of several in a firm ----------

select set_config('request.jwt.claims', '{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into res values ('delete_colleague', public.admin_delete_account('ac000000-0000-4000-8000-000000000005', 'colega@teste.invalid', 'Conta encerrada a pedido'));
reset role;

select ok(
  not exists (select 1 from auth.users where id = 'ac000000-0000-4000-8000-000000000005')
  and not exists (select 1 from public.oab_registrations where user_id = 'ac000000-0000-4000-8000-000000000005')
  and not exists (select 1 from public.consent_acceptances where user_id = 'ac000000-0000-4000-8000-000000000005'),
  'the colleague is gone, with their registration and their consents'
);
select ok(
  (select count(*)::int = 1 from public.memberships where org_id = 'bc000000-0000-4000-8000-00000000000b')
  and exists (select 1 from public.organizations where id = 'bc000000-0000-4000-8000-00000000000b')
  and (select payload -> 'deletedFirms' = '[]'::jsonb from res where name = 'delete_colleague'),
  'the firm stays, with its owner'
);
select ok(
  exists (
    select 1 from public.audit_events
    where org_id = 'bc000000-0000-4000-8000-00000000000b' and action = 'firm.member.account_deleted'
      and actor_id = 'ac000000-0000-4000-8000-000000000001'
  ),
  'and its trail records that one of its people was removed by the platform'
);

-- ---------- Deleting the only person of a firm ----------

select set_config('request.jwt.claims', '{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into res values ('delete', public.admin_delete_account('ac000000-0000-4000-8000-000000000002', 'Saindo@Teste.invalid', 'Conta encerrada a pedido'));
reset role;

select ok(
  not exists (select 1 from public.organizations where id = 'bc000000-0000-4000-8000-00000000000a')
  and not exists (select 1 from auth.users where id = 'ac000000-0000-4000-8000-000000000002')
  and not exists (select 1 from public.profiles where id = 'ac000000-0000-4000-8000-000000000002'),
  'the person and the firm are gone'
);
select ok(
  not exists (select 1 from public.entitlement_grants where org_id = 'bc000000-0000-4000-8000-00000000000a')
  and not exists (select 1 from public.invoices where org_id = 'bc000000-0000-4000-8000-00000000000a')
  and not exists (select 1 from public.subscriptions where org_id = 'bc000000-0000-4000-8000-00000000000a')
  and not exists (select 1 from public.firm_invitations where org_id = 'bc000000-0000-4000-8000-00000000000a')
  and not exists (select 1 from public.consent_acceptances where user_id = 'ac000000-0000-4000-8000-000000000002')
  and not exists (select 1 from public.oab_registrations where user_id = 'ac000000-0000-4000-8000-000000000002')
  and not exists (select 1 from public.blog_comments where user_id = 'ac000000-0000-4000-8000-000000000002'),
  'with everything the account held'
);
select is(
  (select count(*)::int from public.record_versions where org_id = 'bc000000-0000-4000-8000-00000000000a'),
  0,
  'including the change history the cascade just wrote'
);
select ok(
  (select actor_id is null and org_id is null from public.product_events where event_name = 'firm.created'),
  'usage events survive detached from the person and the firm'
);
select ok(
  (select bool_and(metadata ? 'email_sha256' and not (metadata ? 'email') and not (metadata ? 'display_name'))
          and count(*) = 2
   from public.audit_events where action = 'admin.account.deleted'),
  'the permanent audit event keeps a hash of the address, never the address or the name'
);
select ok(
  exists (select 1 from public.organizations where id = 'bc000000-0000-4000-8000-00000000000b')
  and exists (select 1 from public.subscriptions where org_id = 'bc000000-0000-4000-8000-00000000000b'),
  'the other firm was not touched'
);

select set_config('request.jwt.claims', '{"sub":"ac000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select array_agg(path) from public.admin_orphaned_account_storage(array['bc000000-0000-4000-8000-00000000000a'::uuid], 'ac000000-0000-4000-8000-000000000002')),
  array['ac000000-0000-4000-8000-000000000002/avatar.png'],
  'the files left behind are listed for the Storage API'
);
select throws_ok(
  $$select * from public.admin_orphaned_account_storage(array['bc000000-0000-4000-8000-00000000000b'::uuid], null)$$,
  'P0001', 'firm_still_exists',
  'and the listing refuses to point at a firm that is alive'
);
select throws_ok(
  $$select * from public.admin_orphaned_account_storage('{}'::uuid[], 'ac000000-0000-4000-8000-000000000004')$$,
  'P0001', 'user_still_exists',
  'or at a person who is'
);
reset role;

-- ---------- Tripwire ----------

select is(
  (
    select coalesce(array_agg(c.conrelid::regclass::text || '.' || a.attname
                              order by c.conrelid::regclass::text || '.' || a.attname), '{}')
    from pg_constraint c
    join pg_namespace n on n.oid = c.connamespace
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and n.nspname = 'public'
      and c.confdeltype in ('a', 'r')
  ),
  -- The four of the AI layer point at the platform's own catalog (tasks and
  -- prompt versions): a firm's runs and answers cascade from the firm. An
  -- issued document names its file, and a WhatsApp message the media it
  -- carried, and a filing package and its receipt the files they are made of:
  -- each pair cascades from the firm in the same statement, and a file is
  -- never deleted while something names it.
  -- The references to the reference tables (an airline, an airport, a court,
  -- a kind of notice, a product module) point at rows no firm deletes: a firm
  -- that goes takes its cases, its notices, its modules and its partnerships
  -- with it.
  -- The firm's books (0126, 0129): an entry and a bill name their category, an entry its account, a
  -- statement and its lines name their account; each pair cascades from the
  -- firm in the same statement, and an account or a category something uses
  -- is archived, never deleted.
  array[
    'ai_runs.prompt_version_id',
    'ai_runs.task',
    'approvals.task',
    'cases.airline_iata',
    'cases.module',
    -- The version of its module a case was opened under (0212) is platform data, never deleted once published.
    'cases.module_version_id',
    'client_consents.term_id',
    'client_notices.kind', 'closing_goals.module_key',
    'consent_acceptances.term_id',
    -- Which comarca each municipality belongs to (0145) is platform data of a court, which is never deleted.
    'court_comarcas.court',
    -- A court's way of paying (0135) is platform data of a court, which is never deleted.
    'court_payment_paths.court',
    -- The court systems ONE works on and the texts of the filing ways (0263, 0264) are the platform's, never deleted.
    'court_screen_maps.system_key',
    -- The kind of piece a firm's model of the process writes (0244) is the platform's, which is never deleted.
    'draft_templates.piece_kind',
    'filing_batches.system_key',
    'filing_package_items.file_id',
    'filing_package_items.signed_file_id',
    'filing_receipts.file_id',
    'filing_submissions.receipt_file_id',
    'finance_bills.category_id',
    'finance_entries.account_id',
    'finance_entries.category_id',
    'finance_statement_lines.account_id',
    'finance_statements.account_id',
    'firm_filing_ways.term_id',
    'firm_modules.module_key',
    'firm_notice_kinds.kind',
    'flight_segments.destination_iata',
    'flight_segments.origin_iata',
    'impersonation_sessions.actor_id',
    'issued_documents.file_id',
    'lawyer_filing_ways.system_key',
    'lawyer_filing_ways.term_id',
    'leads.consent_term_id',
    -- A version of a module (0212) names its module, which is never deleted.
    'module_versions.module',
    'partner_invitations.module_key',
    'partner_links.module_key',
    'proceedings.court',
    'prompt_versions.task',
    'subscription_modules.module_id',
    'subscriptions.plan_id',
    'wa_messages.media_file_id'
  ],
  'every NO ACTION / RESTRICT reference is a known one: a new one must be handled by the deletion first'
);

select * from finish();
rollback;
