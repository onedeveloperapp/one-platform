begin;
create extension if not exists pgtap;
select plan(22);

-- ============================================================
-- Each module's setup and colour, and the clause a firm gives its agencies
-- (0081): the modules carry a colour of the design system; who manages a
-- firm answers the setup of a module it has, once, never in a support visit;
-- who decides for the firm gives the words of the clause, starting from ONE's
-- proposal written for it; and an agency is offered its firm's words, or else
-- ONE's. Two firms (one with a partner, one run by its owner alone) and two
-- agencies.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a8400000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-modulo.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a8400000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza-modulo.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a8400000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-modulo.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a8400000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@viagens-sol-modulo.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a8400000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'fabi@turismo-mar-modulo.invalid', '', now(), '{}', '{"display_name":"Fabi Costa"}', now(), now()),
  ('a8400000-0000-4000-8000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'gil@souza-modulo.invalid', '', now(), '{}', '{"display_name":"Gil Prado"}', now(), now()),
  ('a8400000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'iara@operador-modulo.invalid', '', now(), '{}', '{"display_name":"Iara Nunes"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a8400000-0000-4000-8000-000000000009';

-- Firm A has a partner (Ana) and a lawyer who manages nothing (Bia); firm B is run by its owner, a lawyer, alone.
insert into public.organizations (id, name, slug, created_by) values
  ('b8400000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-modulo', 'a8400000-0000-4000-8000-000000000001'),
  ('b8400000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-modulo', 'a8400000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b8400000-0000-4000-8000-00000000000a', 'a8400000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b8400000-0000-4000-8000-00000000000a', 'a8400000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b8400000-0000-4000-8000-00000000000a', 'a8400000-0000-4000-8000-000000000006', 'admin', 'atendimento'),
  ('b8400000-0000-4000-8000-00000000000b', 'a8400000-0000-4000-8000-000000000003', 'owner', 'advogado');

insert into public.partners (id, name) values
  ('c8400000-0000-4000-8000-00000000000a', 'Viagens Sol'),
  ('c8400000-0000-4000-8000-00000000000b', 'Turismo Mar');
insert into public.partner_members (partner_id, user_id, role) values
  ('c8400000-0000-4000-8000-00000000000a', 'a8400000-0000-4000-8000-000000000004', 'owner'),
  ('c8400000-0000-4000-8000-00000000000b', 'a8400000-0000-4000-8000-000000000005', 'owner');
insert into public.partner_links (id, partner_id, org_id, module_key) values
  ('d8400000-0000-4000-8000-00000000000a', 'c8400000-0000-4000-8000-00000000000a', 'b8400000-0000-4000-8000-00000000000a', 'direito-do-passageiro'),
  ('d8400000-0000-4000-8000-00000000000b', 'c8400000-0000-4000-8000-00000000000b', 'b8400000-0000-4000-8000-00000000000b', 'direito-do-passageiro');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, aal text default 'aal2', session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated',
  'aal', aal, 'session_id', session))::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- ---------- The module's colour ----------

select ok(
  (select tone from public.product_modules where key = 'direito-do-passageiro') = 'secondary'
  and (select tone from public.product_modules where key = 'direito-previdenciario') = 'accent-1'
  and (select tone from public.product_modules where key = 'direito-trabalhista') = 'accent-4',
  'each module has its colour among the tones of the design system'
);
select throws_ok(
  $$ update public.product_modules set tone = 'vermelho-vivo' where key = 'direito-do-passageiro' $$,
  '23514', null,
  'a colour that is no tone of the design system is refused'
);

-- ---------- The module's setup ----------

select ok(
  exists (select 1 from public.firm_modules where org_id = 'b8400000-0000-4000-8000-00000000000a'
          and module_key = 'direito-do-passageiro' and setup_answered_at is null),
  'a new firm has the passenger module with its setup never answered'
);

select pg_temp.sign_in('a8400000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$ select public.answer_module_setup('b8400000-0000-4000-8000-00000000000a', 'direito-do-passageiro') $$,
  '42501', 'not_authorized',
  'somebody who does not manage the firm answers no module''s setup'
);
reset role;

select pg_temp.sign_in('a8400000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$ select public.answer_module_setup('b8400000-0000-4000-8000-00000000000a', 'direito-do-passageiro') $$,
  '42501', 'not_authorized',
  'nobody of another firm answers it'
);
reset role;

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a8400000-0000-4000-8000-000000000009', 'a8400000-0000-4000-8000-000000000001', 'b8400000-0000-4000-8000-00000000000a',
        'Conferindo os módulos', 'f8400000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a8400000-0000-4000-8000-000000000001', 'aal2', 'f8400000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.answer_module_setup('b8400000-0000-4000-8000-00000000000a', 'direito-do-passageiro') $$,
  '42501', 'not_allowed_in_support_session',
  'a support visit answers nothing'
);
reset role;

select pg_temp.sign_in('a8400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('soon', public.answer_module_setup('b8400000-0000-4000-8000-00000000000a', 'direito-trabalhista'));
insert into res values ('answered', public.answer_module_setup('b8400000-0000-4000-8000-00000000000a', 'direito-do-passageiro'));
reset role;

select ok(
  pg_temp.got('soon', 'code') = 'module_not_enabled',
  'a module the firm does not have has no setup to answer'
);
select ok(
  pg_temp.got('answered', 'code') = 'answered'
  and (select setup_answered_at is not null from public.firm_modules
       where org_id = 'b8400000-0000-4000-8000-00000000000a' and module_key = 'direito-do-passageiro')
  and exists (select 1 from public.audit_events where action = 'firm.module_setup_answered'
              and org_id = 'b8400000-0000-4000-8000-00000000000a' and metadata ->> 'module' = 'direito-do-passageiro'),
  'who manages the firm answers the module''s setup, on the firm''s record'
);

select pg_temp.sign_in('a8400000-0000-4000-8000-000000000006');
set local role authenticated;
insert into res values ('again', public.answer_module_setup('b8400000-0000-4000-8000-00000000000a', 'direito-do-passageiro'));
reset role;

select ok(
  pg_temp.got('again', 'code') = 'unchanged'
  and (select count(*) from public.audit_events where action = 'firm.module_setup_answered'
       and org_id = 'b8400000-0000-4000-8000-00000000000a') = 1,
  'another manager answering again keeps the first moment'
);

select ok(
  (select setup_answered_at is null from public.firm_modules
   where org_id = 'b8400000-0000-4000-8000-00000000000b' and module_key = 'direito-do-passageiro'),
  'the other firm''s module setup is its own'
);

-- ---------- The words the firm gives its agencies ----------

select pg_temp.sign_in('a8400000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('proposal_a', jsonb_build_object('text', public.pax_firm_clause_proposal('b8400000-0000-4000-8000-00000000000a')));
reset role;

select ok(
  position('Souza Advogados' in pg_temp.got('proposal_a', 'text')) > 0
  and position('que a agência compartilhe' in pg_temp.got('proposal_a', 'text')) > 0
  and position('{' in pg_temp.got('proposal_a', 'text')) = 0,
  'ONE''s proposal is written for the firm, with its name and the agency said in general'
);

select pg_temp.sign_in('a8400000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$ select public.pax_firm_clause_proposal('b8400000-0000-4000-8000-00000000000a') $$,
  '42501', 'not_authorized',
  'nobody of another firm reads it'
);
reset role;

-- Bia is a lawyer of a firm with a partner: the words are the partner's to give.
select pg_temp.sign_in('a8400000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  format('select public.pax_save_firm_clause(%L, %L)', 'b8400000-0000-4000-8000-00000000000a', pg_temp.got('proposal_a', 'text')),
  '42501', 'not_authorized',
  'in a firm with a partner, a lawyer gives no words for the agencies'
);
reset role;

select pg_temp.sign_in('a8400000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
select throws_ok(
  format('select public.pax_save_firm_clause(%L, %L)', 'b8400000-0000-4000-8000-00000000000a', pg_temp.got('proposal_a', 'text')),
  '42501', 'second_factor_required',
  'the partner gives them with the second factor'
);
reset role;

select pg_temp.sign_in('a8400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('short', public.pax_save_firm_clause('b8400000-0000-4000-8000-00000000000a', 'Curto demais.'));
insert into res values ('saved', public.pax_save_firm_clause('b8400000-0000-4000-8000-00000000000a',
  'O cliente autoriza, de forma específica, que a agência compartilhe com o escritório Souza Advogados o seu nome, '
  || 'o seu WhatsApp e os voos desta viagem, para o escritório acompanhar os voos e avisar de um problema.'));
insert into res values ('same', public.pax_save_firm_clause('b8400000-0000-4000-8000-00000000000a',
  '  O cliente autoriza, de forma específica, que a agência compartilhe com o escritório Souza Advogados o seu nome, '
  || 'o seu WhatsApp e os voos desta viagem, para o escritório acompanhar os voos e avisar de um problema.  '));
reset role;

select ok(
  pg_temp.got('short', 'code') = 'invalid_clause' and pg_temp.got('saved', 'code') = 'saved'
  and pg_temp.got('saved', 'version') = '1' and pg_temp.got('same', 'code') = 'unchanged'
  and exists (select 1 from public.audit_events where action = 'pax.firm_clause.saved'
              and org_id = 'b8400000-0000-4000-8000-00000000000a'),
  'the partner gives the words, a version at a time, on the firm''s record; the same words are no new version'
);

-- Firm B has no partner: its owner decides for it.
select pg_temp.sign_in('a8400000-0000-4000-8000-000000000003');
set local role authenticated;
select is(
  (select count(*)::integer from public.pax_firm_clauses where org_id = 'b8400000-0000-4000-8000-00000000000a'),
  0,
  'nobody of another firm reads the firm''s words'
);
insert into res values ('b_proposal', jsonb_build_object('text', public.pax_firm_clause_proposal('b8400000-0000-4000-8000-00000000000b')));
reset role;

select ok(
  position('Rocha Advocacia' in pg_temp.got('b_proposal', 'text')) > 0
  and position('Souza Advogados' in pg_temp.got('b_proposal', 'text')) = 0,
  'each firm''s proposal names its own firm'
);

select pg_temp.sign_in('a8400000-0000-4000-8000-000000000002');
set local role authenticated;
select is(
  (select count(*)::integer from public.pax_firm_clauses where org_id = 'b8400000-0000-4000-8000-00000000000a'),
  1,
  'anybody of the firm reads the words it gives'
);
reset role;

-- ---------- What an agency is offered ----------

select pg_temp.sign_in('a8400000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('offer_sol', public.pax_clause_offer('c8400000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('a8400000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('offer_mar', public.pax_clause_offer('c8400000-0000-4000-8000-00000000000b'));
reset role;

select ok(
  pg_temp.got('offer_sol', 'source') = 'firm' and pg_temp.got('offer_sol', 'firm') = 'Souza Advogados'
  and pg_temp.got('offer_sol', 'version') = '1'
  and position('acompanhar os voos e avisar de um problema' in pg_temp.got('offer_sol', 'text')) > 0,
  'an agency is offered the words its firm gave'
);
select ok(
  pg_temp.got('offer_mar', 'source') = 'one' and pg_temp.got('offer_mar', 'firm') = 'Rocha Advocacia'
  and position('Turismo Mar' in pg_temp.got('offer_mar', 'text')) > 0,
  'an agency whose firm gave none is offered ONE''s proposal'
);

select pg_temp.sign_in('a8400000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$ select public.pax_clause_offer('c8400000-0000-4000-8000-00000000000a') $$,
  '42501', 'not_authorized',
  'nobody of the firm reads what its agency is offered'
);
reset role;

-- The agency registers its firm's words as they are: the clause the database takes.
select pg_temp.sign_in('a8400000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('registered', public.pax_save_consent_term('c8400000-0000-4000-8000-00000000000a', pg_temp.got('offer_sol', 'text')));
reset role;

select ok(
  pg_temp.got('registered', 'code') = 'saved'
  and (select body = pg_temp.got('offer_sol', 'text') from public.pax_consent_terms
       where partner_id = 'c8400000-0000-4000-8000-00000000000a' and version = 1),
  'the agency registers its firm''s words in its contract, word for word'
);

select * from finish();
rollback;
