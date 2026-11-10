begin;
create extension if not exists pgtap;
select plan(25);

-- ============================================================
-- Levar a carteira inteira (0117): who decides for the firm, with the second
-- factor, never a support visit, a few times a day, on the record and never
-- with anybody's data; every sheet holds the firm's own and nothing of another
-- firm's, and the test cases leave with the people who are only in them. Three
-- firms: Lima has a partner and each kind of row, Rocha has no partner (who
-- manages it decides) and Costa has nothing.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1180000-0000-4000-8000-000000000001', 'ana@lima-carteira.invalid', 'Ana Lima'),
  ('a1180000-0000-4000-8000-000000000002', 'caio@lima-carteira.invalid', 'Caio Lima'),
  ('a1180000-0000-4000-8000-000000000003', 'bia@lima-carteira.invalid', 'Bia Lima'),
  ('a1180000-0000-4000-8000-000000000004', 'duda@rocha-carteira.invalid', 'Duda Rocha'),
  ('a1180000-0000-4000-8000-000000000005', 'eva@costa-carteira.invalid', 'Eva Costa'),
  ('a1180000-0000-4000-8000-000000000009', 'suporte@one-carteira.invalid', 'Suporte')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1180000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-carteira', 'a1180000-0000-4000-8000-000000000001'),
  ('b1180000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-carteira', 'a1180000-0000-4000-8000-000000000004'),
  ('b1180000-0000-4000-8000-00000000000c', 'Costa Advocacia', 'costa-carteira', 'a1180000-0000-4000-8000-000000000005');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1180000-0000-4000-8000-00000000000a', 'a1180000-0000-4000-8000-000000000001', 'member', 'socio'),
  ('b1180000-0000-4000-8000-00000000000a', 'a1180000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1180000-0000-4000-8000-00000000000a', 'a1180000-0000-4000-8000-000000000003', 'member', 'controladoria'),
  ('b1180000-0000-4000-8000-00000000000b', 'a1180000-0000-4000-8000-000000000004', 'owner', 'advogado'),
  ('b1180000-0000-4000-8000-00000000000c', 'a1180000-0000-4000-8000-000000000005', 'owner', 'socio');
insert into public.oab_registrations (user_id, uf, number, kind) values
  ('a1180000-0000-4000-8000-000000000001', 'GO', '19181', 'principal');

-- Lima: Maria in a real case; Teo only in a test case; Lia in no case. Rocha: Rui in a case of its own.
insert into public.people (id, org_id, full_name, cpf, birth_date, email, phone, postal_code, street, address_number, district, city, uf) values
  ('d1180000-0000-4000-8000-000000000001', 'b1180000-0000-4000-8000-00000000000a', 'Maria Teste', '52998224725', '1985-04-02',
   'maria@teste.invalid', '5500988880001', '74000000', 'Rua das Flores', '10', 'Centro', 'Goiânia', 'GO'),
  ('d1180000-0000-4000-8000-000000000002', 'b1180000-0000-4000-8000-00000000000a', 'Teo Teste', null, null, null, null, null, null, null, null, null, null),
  ('d1180000-0000-4000-8000-000000000003', 'b1180000-0000-4000-8000-00000000000a', 'Lia Teste', null, null, null, null, null, null, null, null, null, null),
  ('d1180000-0000-4000-8000-000000000004', 'b1180000-0000-4000-8000-00000000000b', 'Rui Teste', '12345678909', null, null, null, null, null, null, null, null, null);
insert into public.cases (id, org_id, seq, module, incident, status, airline_iata, flight_date) values
  ('c1180000-0000-4000-8000-000000000001', 'b1180000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed', 'G3', '2026-09-20'),
  ('c1180000-0000-4000-8000-000000000002', 'b1180000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'intake', null, null),
  ('c1180000-0000-4000-8000-000000000003', 'b1180000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'intake', null, null);
update public.cases set is_test = true where id = 'c1180000-0000-4000-8000-000000000002';
insert into public.case_parties (id, org_id, case_id, person_id, role, claim_cents) values
  ('e1180000-0000-4000-8000-000000000001', 'b1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-000000000001',
   'd1180000-0000-4000-8000-000000000001', 'claimant', 1000000),
  ('e1180000-0000-4000-8000-000000000002', 'b1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-000000000002',
   'd1180000-0000-4000-8000-000000000002', 'claimant', null),
  ('e1180000-0000-4000-8000-000000000004', 'b1180000-0000-4000-8000-00000000000b', 'c1180000-0000-4000-8000-000000000003',
   'd1180000-0000-4000-8000-000000000004', 'claimant', null);
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1180000-0000-4000-8000-000000000001', 'b1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '00051016820998090051', '2026-10-01'),
  ('f1180000-0000-4000-8000-000000000002', 'b1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'planned', null, null);
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('f1180000-0000-4000-8000-000000000001', 'e1180000-0000-4000-8000-000000000001', 'b1180000-0000-4000-8000-00000000000a');
insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values
  ('f1180000-0000-4000-8000-000000000001', 'a1180000-0000-4000-8000-000000000001', 'b1180000-0000-4000-8000-00000000000a');
-- A deadline of the real case, and one of a lawsuit the firm has no case of. Their ids are written because the sheet
-- orders by when and then by id, and rows of one transaction share their moment: a drawn id would draw the order.
insert into public.deadlines (id, org_id, cnj, court, case_id, proceeding_id, title, trigger, trigger_on, days, counting, due_on) values
  ('a3180000-0000-4000-8000-000000000001', 'b1180000-0000-4000-8000-00000000000a', '00051016820998090051', 'TJGO', 'c1180000-0000-4000-8000-000000000001',
   'f1180000-0000-4000-8000-000000000001', 'Réplica à contestação', 'day', '2026-10-05', 15, 'business', '2026-10-26'),
  ('a3180000-0000-4000-8000-000000000002', 'b1180000-0000-4000-8000-00000000000a', '00051025320998090051', 'TJGO', null, null, 'Recurso inominado', 'day', '2026-10-05', 10, 'business', null);
-- Two documents kept and one still being sent, which is no document yet.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, pages, expires_at, confirmed_at)
select f.id::uuid, 'b1180000-0000-4000-8000-00000000000a', 'client', 'org/b1180000-0000-4000-8000-00000000000a/client/' || f.id, f.name,
       'application/pdf', 100, 'stored', repeat(f.mark, 64), 100, 'application/pdf', 1, now() + interval '1 hour', now()
from (values
  ('a2180000-0000-4000-8000-000000000001', 'identidade-maria.pdf', 'a'),
  ('a2180000-0000-4000-8000-000000000002', 'bilhete-teo.pdf', 'b'),
  ('a2180000-0000-4000-8000-000000000003', 'enviando.pdf', 'c')
) as f (id, name, mark);
insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status) values
  ('b1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-000000000001', 'e1180000-0000-4000-8000-000000000001',
   'a2180000-0000-4000-8000-000000000001', 'identity', 'client', 'accepted'),
  ('b1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-000000000002', null,
   'a2180000-0000-4000-8000-000000000002', 'ticket', 'client', 'received'),
  ('b1180000-0000-4000-8000-00000000000a', 'c1180000-0000-4000-8000-000000000001', null,
   'a2180000-0000-4000-8000-000000000003', 'receipt', 'client', 'uploading');

create function pg_temp.sign_in(person uuid, aal text default 'aal2', session uuid default null)
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal, 'session_id', session))::text, true);
$$;

create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated;

create function pg_temp.got(which text, path text[])
returns text language sql as $$
  select value #>> path from res where key = which;
$$;

-- ---------- Who may ----------

select is(
  (select (value ->> 'portfolio_daily')::int from public.platform_settings where key = 'controladoria'),
  3,
  'a person takes the portfolio the setting''s three times a day'
);

select pg_temp.sign_in('a1180000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('lawyer', public.begin_portfolio_export('b1180000-0000-4000-8000-00000000000a'));
reset role;
select is(pg_temp.got('lawyer', '{code}'), 'not_allowed', 'a lawyer of a firm with a partner does not take it');

select pg_temp.sign_in('a1180000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('control', public.begin_portfolio_export('b1180000-0000-4000-8000-00000000000a'));
reset role;
select is(pg_temp.got('control', '{code}'), 'not_allowed', 'nor does the controladoria, who exports lists and does not decide for the firm');

select pg_temp.sign_in('a1180000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
insert into res values ('no-factor', public.begin_portfolio_export('b1180000-0000-4000-8000-00000000000a'));
reset role;
select is(pg_temp.got('no-factor', '{code}'), 'second_factor', 'a partner whose session did not confirm the second factor is told so');

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a1180000-0000-4000-8000-000000000009', 'a1180000-0000-4000-8000-000000000001', 'b1180000-0000-4000-8000-00000000000a',
        'Conferindo a carteira', 'f2180000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a1180000-0000-4000-8000-000000000001', 'aal2', 'f2180000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('visit', public.begin_portfolio_export('b1180000-0000-4000-8000-00000000000a'));
reset role;
select is(pg_temp.got('visit', '{code}'), 'support_visit', 'a support visit never takes it');

select is(
  (select count(*)::int from public.audit_events where action = 'portfolio.exported'),
  0,
  'and none of those is on the record as an export'
);

-- ---------- Nothing is read before it is begun ----------

select pg_temp.sign_in('a1180000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.firm_portfolio_page('b1180000-0000-4000-8000-00000000000a', 'clientes') $$,
  '42501', 'portfolio_not_begun',
  'a page is read only of a portfolio somebody began'
);

-- ---------- Begun, on the record, and nobody's data in it ----------

insert into res values ('begun', public.begin_portfolio_export('b1180000-0000-4000-8000-00000000000a'));
insert into res values ('clientes', public.firm_portfolio_page('b1180000-0000-4000-8000-00000000000a', 'clientes'));
insert into res values ('casos', public.firm_portfolio_page('b1180000-0000-4000-8000-00000000000a', 'casos'));
insert into res values ('acoes', public.firm_portfolio_page('b1180000-0000-4000-8000-00000000000a', 'acoes'));
insert into res values ('prazos', public.firm_portfolio_page('b1180000-0000-4000-8000-00000000000a', 'prazos'));
insert into res values ('documentos', public.firm_portfolio_page('b1180000-0000-4000-8000-00000000000a', 'documentos'));
insert into res values ('clientes-real', public.firm_portfolio_page('b1180000-0000-4000-8000-00000000000a', 'clientes', 0, false));
insert into res values ('casos-real', public.firm_portfolio_page('b1180000-0000-4000-8000-00000000000a', 'casos', 0, false));
insert into res values ('acoes-real', public.firm_portfolio_page('b1180000-0000-4000-8000-00000000000a', 'acoes', 0, false));
insert into res values ('documentos-real', public.firm_portfolio_page('b1180000-0000-4000-8000-00000000000a', 'documentos', 0, false));
insert into res values ('past-end', public.firm_portfolio_page('b1180000-0000-4000-8000-00000000000a', 'clientes', 50));
reset role;

select is(
  (select value -> 'counts' from res where key = 'begun'),
  '{"clientes": 3, "casos": 2, "acoes": 2, "prazos": 2, "audiencias": 0, "documentos": 2, "lancamentos": 0, "contas": 0}'::jsonb,
  'it says how many rows each sheet holds, a document still being sent is no document yet'
);
select ok(
  (select metadata -> 'sheets' = (select value -> 'counts' from res where key = 'begun')
     and (metadata ->> 'tests')::boolean and actor_id = 'a1180000-0000-4000-8000-000000000001' and org_id = 'b1180000-0000-4000-8000-00000000000a'
   from public.audit_events where action = 'portfolio.exported'),
  'the audit trail keeps who took it, of which firm, and how many rows of each'
);
select ok(
  (select metadata::text !~ 'Maria|52998224725|maria@|Flores' from public.audit_events where action = 'portfolio.exported'),
  'and nothing of anybody'
);

-- ---------- Each sheet ----------

select ok(
  pg_temp.got('clientes', '{rows,0,name}') = 'Maria Teste'
    and pg_temp.got('clientes', '{rows,0,cpf}') = '52998224725'
    and pg_temp.got('clientes', '{rows,0,phone}') = '5500988880001'
    and pg_temp.got('clientes', '{rows,0,email}') = 'maria@teste.invalid'
    and pg_temp.got('clientes', '{rows,0,street}') = 'Rua das Flores'
    and pg_temp.got('clientes', '{rows,0,postal_code}') = '74000000'
    and pg_temp.got('clientes', '{rows,0,cases}') = '[1]',
  'a client comes with their CPF, telephone, e-mail, address and cases'
);
select is(
  (select jsonb_array_length(value -> 'rows') from res where key = 'clientes'),
  3,
  'every client of the firm is there, also who is in no case, and nobody of another firm'
);
select ok(
  pg_temp.got('casos', '{rows,0,seq}') = '1' and pg_temp.got('casos', '{rows,0,client}') = 'Maria Teste'
    and pg_temp.got('casos', '{rows,0,status}') = 'filed' and pg_temp.got('casos', '{rows,0,flight_date}') = '2026-09-20'
    and pg_temp.got('casos', '{rows,0,module_name}') = 'Direito do Passageiro'
    and pg_temp.got('casos', '{rows,1,is_test}') = 'true',
  'a case comes with its client, its stage and its flight, a test case said so'
);
select ok(
  pg_temp.got('acoes', '{rows,0,cnj}') = '00051016820998090051' and pg_temp.got('acoes', '{rows,0,claimants}') = 'Maria Teste'
    and pg_temp.got('acoes', '{rows,0,claim_cents}') = '1000000' and pg_temp.got('acoes', '{rows,0,lawyers}') = 'Ana Lima (OAB/GO 19181)',
  'a lawsuit comes with its number, who claims and how much, and its lawyers with their registration'
);
select ok(
  pg_temp.got('prazos', '{rows,0,title}') = 'Réplica à contestação' and pg_temp.got('prazos', '{rows,0,seq}') = '1'
    and pg_temp.got('prazos', '{rows,0,due_on}') = '2026-10-26'
    and pg_temp.got('prazos', '{rows,1,seq}') is null and pg_temp.got('prazos', '{rows,1,cnj}') = '00051025320998090051',
  'a deadline comes with its case and its day, and one of a lawsuit with no case too'
);
select ok(
  pg_temp.got('documentos', '{rows,0,name}') = 'identidade-maria.pdf' and pg_temp.got('documentos', '{rows,0,person}') = 'Maria Teste'
    and pg_temp.got('documentos', '{rows,0,kind}') = 'identity' and pg_temp.got('documentos', '{rows,0,sha256}') = repeat('a', 64)
    and pg_temp.got('documentos', '{rows,0,storage_path}') is null,
  'a document comes as an index: what it is, whose, its name and its mark, never where the file is kept'
);
select is(
  (select count(*)::int from res, jsonb_array_elements(value -> 'rows') r where key = 'documentos' and r ->> 'name' = 'enviando.pdf'),
  0,
  'and one still being sent is not there'
);
select ok(
  pg_temp.got('clientes-real', '{rows,0,cases}') = '[1]'
    and (select jsonb_agg(r ->> 'name' order by r ->> 'name') from res, jsonb_array_elements(value -> 'rows') r where key = 'clientes-real')
      = '["Lia Teste", "Maria Teste"]'::jsonb,
  'with the test cases left out, who is only in them leaves too, and who is in no case stays'
);
select ok(
  (select jsonb_array_length(value -> 'rows') from res where key = 'casos-real') = 1
    and (select jsonb_array_length(value -> 'rows') from res where key = 'acoes-real') = 1
    and (select jsonb_array_length(value -> 'rows') from res where key = 'documentos-real') = 1,
  'and so do their lawsuits and documents'
);
select is(pg_temp.got('past-end', '{rows}'), '[]', 'a page past the end holds nothing');

-- ---------- A firm with no partner, another firm, and the limits ----------

select pg_temp.sign_in('a1180000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('rocha', public.begin_portfolio_export('b1180000-0000-4000-8000-00000000000b'));
insert into res values ('rocha-clients', public.firm_portfolio_page('b1180000-0000-4000-8000-00000000000b', 'clientes'));
reset role;
select ok(
  (pg_temp.got('rocha', '{ok}'))::boolean and pg_temp.got('rocha-clients', '{rows,0,name}') = 'Rui Teste'
    and (select jsonb_array_length(value -> 'rows') from res where key = 'rocha-clients') = 1,
  'in a firm with no partner who manages it decides, and reads its own clients alone'
);

set local role authenticated;
select throws_ok(
  $$ select public.begin_portfolio_export('b1180000-0000-4000-8000-00000000000a') $$,
  '42501', 'not_authorized',
  'nobody of another firm begins a firm''s portfolio'
);
select throws_ok(
  $$ select public.firm_portfolio_page('b1180000-0000-4000-8000-00000000000a', 'clientes') $$,
  '42501', 'not_authorized',
  'nor reads a page of it, having begun their own'
);
reset role;

select pg_temp.sign_in('a1180000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.firm_portfolio_page('b1180000-0000-4000-8000-00000000000a', 'senhas') $$,
  '22023', 'invalid_sheet',
  'a sheet the portfolio does not have is refused'
);
reset role;

update public.platform_settings set value = value || '{"portfolio_rows": 2}'::jsonb where key = 'controladoria';
select pg_temp.sign_in('a1180000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('too-many', public.begin_portfolio_export('b1180000-0000-4000-8000-00000000000a'));
reset role;
update public.platform_settings set value = value || '{"portfolio_rows": 300000, "portfolio_daily": 1}'::jsonb where key = 'controladoria';
select pg_temp.sign_in('a1180000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('daily', public.begin_portfolio_export('b1180000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('a1180000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('empty', public.begin_portfolio_export('b1180000-0000-4000-8000-00000000000c'));
reset role;
select ok(
  pg_temp.got('too-many', '{code}') = 'too_many' and pg_temp.got('too-many', '{limit}') = '2'
    and pg_temp.got('too-many', '{sheet}') = 'clientes'
    and pg_temp.got('daily', '{code}') = 'daily_limit' and pg_temp.got('daily', '{limit}') = '1'
    and pg_temp.got('empty', '{code}') = 'empty',
  'the limits are data and say themselves, and a firm with nothing is told so'
);

select * from finish();
rollback;
