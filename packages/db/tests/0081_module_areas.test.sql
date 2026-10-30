begin;
create extension if not exists pgtap;
select plan(22);

-- ============================================================
-- Each module has an area of its own (0078): the icon that says what it
-- is, and the lists of a firm read by module (its cases, deadlines,
-- hearings, conversations and the answers of the AI), so a module's area
-- shows nothing of another. And who decides for a firm what a partner
-- decides: a partner, or, in a firm with no partner, who manages the firm
-- account. Two firms: A, founded by a lawyer, with no partner and a second
-- module; B, whose owner is a lawyer beside a partner.
--
-- Every person, firm, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a8100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lima-areas.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a8100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@lima-areas.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a8100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-areas.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a8100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@rocha-areas.invalid', '', now(), '{}', '{"display_name":"Duda Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b8100000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-areas', 'a8100000-0000-4000-8000-000000000001'),
  ('b8100000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-areas', 'a8100000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  -- A: founded by a lawyer, with another lawyer; nobody is a partner.
  ('b8100000-0000-4000-8000-00000000000a', 'a8100000-0000-4000-8000-000000000001', 'owner', 'advogado'),
  ('b8100000-0000-4000-8000-00000000000a', 'a8100000-0000-4000-8000-000000000002', 'member', 'advogado'),
  -- B: its owner is a lawyer, and it has a partner.
  ('b8100000-0000-4000-8000-00000000000b', 'a8100000-0000-4000-8000-000000000003', 'owner', 'advogado'),
  ('b8100000-0000-4000-8000-00000000000b', 'a8100000-0000-4000-8000-000000000004', 'member', 'socio');

-- A second module, out, that firm A has beside the passenger module.
insert into public.product_modules (key, name, status, sold_as, description, sort) values
  ('modulo-de-teste', 'Módulo de Teste', 'available', 'package', 'Um módulo que só este teste conhece.', 9);
insert into public.firm_modules (org_id, module_key) values
  ('b8100000-0000-4000-8000-00000000000a', 'modulo-de-teste');

-- A: a passenger case and a case of the other module; B: a passenger case.
insert into public.cases (id, org_id, seq, module, incident) values
  ('c8100000-0000-4000-8000-000000000001', 'b8100000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay'),
  ('c8100000-0000-4000-8000-000000000002', 'b8100000-0000-4000-8000-00000000000a', 2, 'modulo-de-teste', null),
  ('c8100000-0000-4000-8000-000000000003', 'b8100000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay');
insert into public.people (id, org_id, full_name, phone) values
  ('d8100000-0000-4000-8000-000000000001', 'b8100000-0000-4000-8000-00000000000a', 'Paula Teste', '5562999998101'),
  ('d8100000-0000-4000-8000-000000000002', 'b8100000-0000-4000-8000-00000000000a', 'Tadeu Teste', '5562999998102'),
  ('d8100000-0000-4000-8000-000000000003', 'b8100000-0000-4000-8000-00000000000b', 'Paula Teste', '5562999998101');
insert into public.case_parties (case_id, org_id, person_id, role) values
  ('c8100000-0000-4000-8000-000000000001', 'b8100000-0000-4000-8000-00000000000a', 'd8100000-0000-4000-8000-000000000001', 'claimant'),
  ('c8100000-0000-4000-8000-000000000002', 'b8100000-0000-4000-8000-00000000000a', 'd8100000-0000-4000-8000-000000000002', 'claimant'),
  ('c8100000-0000-4000-8000-000000000003', 'b8100000-0000-4000-8000-00000000000b', 'd8100000-0000-4000-8000-000000000003', 'claimant');

-- A lawsuit of each case, a deadline of each and one of a lawsuit A has no case of, a hearing of each.
insert into public.proceedings (id, org_id, case_id, kind, court) values
  ('e8100000-0000-4000-8000-000000000001', 'b8100000-0000-4000-8000-00000000000a', 'c8100000-0000-4000-8000-000000000001', 'juizado', 'TJGO'),
  ('e8100000-0000-4000-8000-000000000002', 'b8100000-0000-4000-8000-00000000000a', 'c8100000-0000-4000-8000-000000000002', 'juizado', 'TJGO'),
  ('e8100000-0000-4000-8000-000000000003', 'b8100000-0000-4000-8000-00000000000b', 'c8100000-0000-4000-8000-000000000003', 'juizado', 'TJGO');
insert into public.deadlines (org_id, cnj, court, case_id, proceeding_id, title, trigger, trigger_on, days, counting) values
  ('b8100000-0000-4000-8000-00000000000a', '50002023920998090051', 'TJGO', 'c8100000-0000-4000-8000-000000000001',
   'e8100000-0000-4000-8000-000000000001', 'Manifestação sobre documentos', 'day', current_date, 15, 'business'),
  ('b8100000-0000-4000-8000-00000000000a', '50003037620998090051', 'TJGO', 'c8100000-0000-4000-8000-000000000002',
   'e8100000-0000-4000-8000-000000000002', 'Réplica', 'day', current_date, 15, 'business'),
  ('b8100000-0000-4000-8000-00000000000a', '50004051320998090051', 'TJGO', null, null, 'Recurso inominado', 'day',
   current_date, 10, 'business'),
  ('b8100000-0000-4000-8000-00000000000b', '50002023920998090051', 'TJGO', 'c8100000-0000-4000-8000-000000000003',
   'e8100000-0000-4000-8000-000000000003', 'Manifestação sobre documentos', 'day', current_date, 15, 'business');
insert into public.hearings (org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode) values
  ('b8100000-0000-4000-8000-00000000000a', 'c8100000-0000-4000-8000-000000000001', 'e8100000-0000-4000-8000-000000000001',
   'conciliacao', now() + interval '20 days', 'America/Sao_Paulo', 'videoconferencia'),
  ('b8100000-0000-4000-8000-00000000000a', 'c8100000-0000-4000-8000-000000000002', 'e8100000-0000-4000-8000-000000000002',
   'una', now() + interval '25 days', 'America/Sao_Paulo', 'presencial'),
  ('b8100000-0000-4000-8000-00000000000b', 'c8100000-0000-4000-8000-000000000003', 'e8100000-0000-4000-8000-000000000003',
   'conciliacao', now() + interval '20 days', 'America/Sao_Paulo', 'videoconferencia');

-- A's WhatsApp: the passenger case's client (written with the ninth digit, the number without it), the other
-- module's client, and somebody of no case. B has a conversation with its own client.
insert into public.connections (id, org_id, provider, external_id, label, status) values
  ('f8100000-0000-4000-8000-00000000000a', 'b8100000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-areas-a', 'WhatsApp A', 'connected'),
  ('f8100000-0000-4000-8000-00000000000b', 'b8100000-0000-4000-8000-00000000000b', 'whatsapp', 'waba-areas-b', 'WhatsApp B', 'connected');
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number) values
  ('18100000-0000-4000-8000-00000000000a', 'b8100000-0000-4000-8000-00000000000a', 'f8100000-0000-4000-8000-00000000000a',
   'simulator', 'sim-areas-a', 'waba-areas-a', '5562900008101'),
  ('18100000-0000-4000-8000-00000000000b', 'b8100000-0000-4000-8000-00000000000b', 'f8100000-0000-4000-8000-00000000000b',
   'simulator', 'sim-areas-b', 'waba-areas-b', '5562900008102');
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, last_message_at) values
  ('28100000-0000-4000-8000-000000000001', 'b8100000-0000-4000-8000-00000000000a', '18100000-0000-4000-8000-00000000000a',
   '556299998101', now() - interval '1 hour'),
  ('28100000-0000-4000-8000-000000000002', 'b8100000-0000-4000-8000-00000000000a', '18100000-0000-4000-8000-00000000000a',
   '5562999998102', now() - interval '2 hours'),
  ('28100000-0000-4000-8000-000000000003', 'b8100000-0000-4000-8000-00000000000a', '18100000-0000-4000-8000-00000000000a',
   '5562999998199', now() - interval '3 hours'),
  ('28100000-0000-4000-8000-000000000004', 'b8100000-0000-4000-8000-00000000000b', '18100000-0000-4000-8000-00000000000b',
   '5562999998101', now() - interval '1 hour');

-- A document of each of A's cases, each with the AI's check waiting; and the platform's check, of no case.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at)
select f.id, 'b8100000-0000-4000-8000-00000000000a', 'client', 'org/b8100000-0000-4000-8000-00000000000a/client/' || f.id,
       'documento.pdf', 'application/pdf', 100, 'stored', repeat(f.mark, 64), 100, 'application/pdf', now() + interval '1 hour', now()
from (values
  ('38100000-0000-4000-8000-000000000001'::uuid, '1'),
  ('38100000-0000-4000-8000-000000000002'::uuid, '2')
) as f (id, mark);
insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status) values
  ('48100000-0000-4000-8000-000000000001', 'b8100000-0000-4000-8000-00000000000a', 'c8100000-0000-4000-8000-000000000001',
   '38100000-0000-4000-8000-000000000001', 'identity', 'client', 'received'),
  ('48100000-0000-4000-8000-000000000002', 'b8100000-0000-4000-8000-00000000000a', 'c8100000-0000-4000-8000-000000000002',
   '38100000-0000-4000-8000-000000000002', 'identity', 'client', 'received');
insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, subject_type, subject_id, status, output, finished_at)
select r.id, 'b8100000-0000-4000-8000-00000000000a', r.task, v.id, v.provider, v.model, repeat(r.mark, 64), r.kind, r.subject,
       'succeeded', '{"resposta": "teste"}'::jsonb, now()
from (values
  ('58100000-0000-4000-8000-000000000001'::uuid, 'caso.documento.conferencia', 'a', 'case_document', '48100000-0000-4000-8000-000000000001'),
  ('58100000-0000-4000-8000-000000000002'::uuid, 'caso.documento.conferencia', 'b', 'case_document', '48100000-0000-4000-8000-000000000002'),
  ('58100000-0000-4000-8000-000000000003'::uuid, 'plataforma.verificacao', 'c', null, null)
) as r (id, task, mark, kind, subject)
join public.prompt_versions v on v.task = r.task and v.is_active;
insert into public.approvals (org_id, run_id, task, approver_functions)
select 'b8100000-0000-4000-8000-00000000000a', r.id, r.task, array['socio', 'advogado']::public.firm_function[]
from public.ai_runs r where r.org_id = 'b8100000-0000-4000-8000-00000000000a';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, path text[]) returns text language sql as
$$ select payload #>> got.path from res where res.name = got.name; $$;

-- ---------- What says a module ----------

select ok(
  (select icon from public.product_modules where key = 'direito-do-passageiro') = 'NiPlane'
    and (select icon from public.product_modules where key = 'direito-previdenciario') = 'NiUmbrella'
    and (select icon from public.product_modules where key = 'direito-trabalhista') = 'NiHardHat',
  'each module says what it is by its icon: the plane, the umbrella and the hard hat'
);

select throws_ok(
  $$ update public.product_modules set icon = 'aviao.svg' where key = 'modulo-de-teste' $$,
  '23514', null,
  'an icon is a name of the app''s set, never a file nor an address'
);

-- ---------- Who decides for the firm ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a_owner_decides', to_jsonb(public.decides_for_firm('b8100000-0000-4000-8000-00000000000a')));
insert into res values ('a_owner_in_b', to_jsonb(public.decides_for_firm('b8100000-0000-4000-8000-00000000000b')));
insert into res values ('a_claim', public.set_firm_claim_default('b8100000-0000-4000-8000-00000000000a', 'delay', 400000));
insert into res values ('a_signer', public.set_firm_signer('b8100000-0000-4000-8000-00000000000a',
  'a8100000-0000-4000-8000-000000000001', true));
insert into res values ('a_autonomy', public.set_firm_autonomy('b8100000-0000-4000-8000-00000000000a', 'chronology', 'approval'));
insert into res values ('a_triage', public.set_firm_publication_ai_triage('b8100000-0000-4000-8000-00000000000a', true));
reset role;

select ok(
  (select payload = 'true'::jsonb from res where name = 'a_owner_decides')
    and (select payload = 'false'::jsonb from res where name = 'a_owner_in_b'),
  'in a firm with no partner, its owner decides for it, and for no other firm'
);

select ok(
  (select payload ->> 'code' = 'saved' from res where name = 'a_claim')
    and (select payload ->> 'code' = 'saved' from res where name = 'a_signer')
    and (select payload ->> 'ok' = 'true' from res where name = 'a_autonomy')
    and (select payload ->> 'code' = 'saved' from res where name = 'a_triage'),
  'the owner of a firm with no partner says the claim, who signs, what ONE decides alone and the AI''s triage'
);

select ok(
  (select cents from public.firm_claim_defaults where org_id = 'b8100000-0000-4000-8000-00000000000a' and incident = 'delay') = 400000
    and exists (select 1 from public.firm_signers where org_id = 'b8100000-0000-4000-8000-00000000000a'
                and user_id = 'a8100000-0000-4000-8000-000000000001')
    and exists (select 1 from public.audit_events where org_id = 'b8100000-0000-4000-8000-00000000000a'
                and action = 'firm.claim_default_set' and actor_id = 'a8100000-0000-4000-8000-000000000001'),
  'what the owner decided is kept, on the record'
);

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('a_member_decides', to_jsonb(public.decides_for_firm('b8100000-0000-4000-8000-00000000000a')));
insert into res values ('a_member_claim', public.set_firm_claim_default('b8100000-0000-4000-8000-00000000000a', 'delay', 500000));
reset role;

select ok(
  (select payload = 'false'::jsonb from res where name = 'a_member_decides')
    and (select payload ->> 'code' = 'not_a_partner' from res where name = 'a_member_claim'),
  'a lawyer who does not manage the firm decides nothing for it'
);

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('b_owner_decides', to_jsonb(public.decides_for_firm('b8100000-0000-4000-8000-00000000000b')));
insert into res values ('b_owner_claim', public.set_firm_claim_default('b8100000-0000-4000-8000-00000000000b', 'delay', 500000));
insert into res values ('b_owner_triage', public.set_firm_publication_ai_triage('b8100000-0000-4000-8000-00000000000b', true));
reset role;
select pg_temp.sign_in('a8100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_partner_decides', to_jsonb(public.decides_for_firm('b8100000-0000-4000-8000-00000000000b')));
insert into res values ('b_partner_claim', public.set_firm_claim_default('b8100000-0000-4000-8000-00000000000b', 'delay', 500000));
reset role;

select ok(
  (select payload = 'false'::jsonb from res where name = 'b_owner_decides')
    and (select payload ->> 'code' = 'not_a_partner' from res where name = 'b_owner_claim')
    and (select payload ->> 'code' = 'not_allowed' from res where name = 'b_owner_triage'),
  'where the firm has a partner, its owner who is not one decides nothing a partner decides'
);

select ok(
  (select payload = 'true'::jsonb from res where name = 'b_partner_decides')
    and (select payload ->> 'code' = 'saved' from res where name = 'b_partner_claim'),
  'the partner decides, as before'
);

-- ---------- The lists of a firm, by module ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('cases_all', public.firm_cases('b8100000-0000-4000-8000-00000000000a'));
insert into res values ('cases_pax', public.firm_cases('b8100000-0000-4000-8000-00000000000a', null, null, 25, 0, 'direito-do-passageiro'));
insert into res values ('cases_test', public.firm_cases('b8100000-0000-4000-8000-00000000000a', null, null, 25, 0, 'modulo-de-teste'));
insert into res values ('cases_test_search', public.firm_cases('b8100000-0000-4000-8000-00000000000a', null, 'Paula', 25, 0, 'modulo-de-teste'));
insert into res values ('deadlines_all', public.firm_deadlines('b8100000-0000-4000-8000-00000000000a', 'abertos'));
insert into res values ('deadlines_pax', public.firm_deadlines('b8100000-0000-4000-8000-00000000000a', 'abertos', 25, 0, null, 'direito-do-passageiro'));
insert into res values ('deadlines_test', public.firm_deadlines('b8100000-0000-4000-8000-00000000000a', 'abertos', 25, 0, null, 'modulo-de-teste'));
insert into res values ('hearings_all', public.firm_hearings('b8100000-0000-4000-8000-00000000000a', 'proximas'));
insert into res values ('hearings_pax', public.firm_hearings('b8100000-0000-4000-8000-00000000000a', 'proximas', 25, 0, null, 'direito-do-passageiro'));
insert into res values ('chats_pax', to_jsonb(public.firm_module_conversations('b8100000-0000-4000-8000-00000000000a', 'direito-do-passageiro')));
insert into res values ('chats_test', to_jsonb(public.firm_module_conversations('b8100000-0000-4000-8000-00000000000a', 'modulo-de-teste')));
insert into res values ('answers_pax', public.firm_module_approvals('b8100000-0000-4000-8000-00000000000a', 'direito-do-passageiro'));
insert into res values ('answers_test', public.firm_module_approvals('b8100000-0000-4000-8000-00000000000a', 'modulo-de-teste'));
insert into res values ('answers_decided', public.firm_module_approvals('b8100000-0000-4000-8000-00000000000a', 'direito-do-passageiro', true));
reset role;

select ok(
  (select (payload ->> 'total')::int = 2 and (payload #>> '{counts,all}')::int = 2 from res where name = 'cases_all')
    and (select (payload ->> 'total')::int = 1 and (payload #>> '{counts,all}')::int = 1
            and payload #>> '{rows,0,id}' = 'c8100000-0000-4000-8000-000000000001' from res where name = 'cases_pax')
    and (select (payload ->> 'total')::int = 1 and payload #>> '{rows,0,id}' = 'c8100000-0000-4000-8000-000000000002'
         from res where name = 'cases_test'),
  'the cases of a module are its own, counts included, and with no module every case of the firm'
);

select ok(
  (select (payload ->> 'total')::int = 0 from res where name = 'cases_test_search'),
  'a search in a module finds nothing of another module'
);

select ok(
  (select (payload ->> 'total')::int = 3 from res where name = 'deadlines_all')
    and (select (payload ->> 'total')::int = 1 and (payload #>> '{counts,abertos}')::int = 1
            and payload #>> '{rows,0,case_id}' = 'c8100000-0000-4000-8000-000000000001' from res where name = 'deadlines_pax')
    and (select (payload ->> 'total')::int = 1 and payload #>> '{rows,0,case_id}' = 'c8100000-0000-4000-8000-000000000002'
         from res where name = 'deadlines_test'),
  'the deadlines of a module are those of its cases; one of a lawsuit with no case is read with every module'
);

select ok(
  (select (payload ->> 'total')::int = 2 from res where name = 'hearings_all')
    and (select (payload ->> 'total')::int = 1 from res where name = 'hearings_pax'),
  'the hearings of a module are those of its cases'
);

select ok(
  (select payload = '["28100000-0000-4000-8000-000000000001"]'::jsonb from res where name = 'chats_pax')
    and (select payload = '["28100000-0000-4000-8000-000000000002"]'::jsonb from res where name = 'chats_test'),
  'a conversation is of the module of its contact''s case (the number with or without its ninth digit), and one of no case of none'
);

select ok(
  (select (payload ->> 'total')::int = 1 and payload -> 'ids' = jsonb_build_array((
      select a.id from public.approvals a where a.run_id = '58100000-0000-4000-8000-000000000001'))
     from res where name = 'answers_pax')
    and (select (payload ->> 'total')::int = 1 from res where name = 'answers_test')
    and (select payload -> 'ids' = '[]'::jsonb from res where name = 'answers_decided'),
  'the answers of the AI of a module are those about its cases; the platform''s check is of no module'
);

-- A conversation ONE answers waits, as an answer of a module: its contact is the passenger case's client.
insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, subject_type, subject_id, status, output, finished_at)
select '58100000-0000-4000-8000-000000000004', 'b8100000-0000-4000-8000-00000000000a', 'atendimento.conversa', v.id,
       v.provider, v.model, repeat('d', 64), 'wa_conversation', '28100000-0000-4000-8000-000000000001', 'succeeded',
       '{"resposta": "teste"}'::jsonb, now()
from public.prompt_versions v where v.task = 'atendimento.conversa' and v.is_active;
insert into public.approvals (org_id, run_id, task, approver_functions)
values ('b8100000-0000-4000-8000-00000000000a', '58100000-0000-4000-8000-000000000004', 'atendimento.conversa',
        array['socio', 'advogado', 'atendimento']::public.firm_function[]);

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('answers_pax_2', public.firm_module_approvals('b8100000-0000-4000-8000-00000000000a', 'direito-do-passageiro'));
insert into res values ('answers_test_2', public.firm_module_approvals('b8100000-0000-4000-8000-00000000000a', 'modulo-de-teste'));
reset role;

select ok(
  (select (payload ->> 'total')::int = 2 from res where name = 'answers_pax_2')
    and (select (payload ->> 'total')::int = 1 from res where name = 'answers_test_2'),
  'an answer about a conversation is of the module of its contact''s case'
);

-- ---------- Each firm its own ----------

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('b_cases_pax', public.firm_cases('b8100000-0000-4000-8000-00000000000b', null, null, 25, 0, 'direito-do-passageiro'));
insert into res values ('b_chats_pax', to_jsonb(public.firm_module_conversations('b8100000-0000-4000-8000-00000000000b', 'direito-do-passageiro')));
reset role;

select ok(
  (select (payload ->> 'total')::int = 1 and payload #>> '{rows,0,id}' = 'c8100000-0000-4000-8000-000000000003'
   from res where name = 'b_cases_pax')
    and (select payload = '["28100000-0000-4000-8000-000000000004"]'::jsonb from res where name = 'b_chats_pax'),
  'firm B reads its own module, the same client''s number of firm A''s conversation never among them'
);

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$ select public.firm_module_conversations('b8100000-0000-4000-8000-00000000000a', 'direito-do-passageiro') $$,
  '42501', null,
  'nobody of another firm reads a firm''s conversations of a module'
);
select throws_ok(
  $$ select public.firm_module_approvals('b8100000-0000-4000-8000-00000000000a', 'direito-do-passageiro') $$,
  '42501', null,
  'nor its answers of the AI'
);
select throws_ok(
  $$ select public.firm_cases('b8100000-0000-4000-8000-00000000000a', null, null, 25, 0, 'direito-do-passageiro') $$,
  '42501', null,
  'nor its cases of a module'
);
reset role;

select pg_temp.sign_in('a8100000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$ select public.firm_module_approvals('b8100000-0000-4000-8000-00000000000a', null) $$,
  '22023', null,
  'the answers of a module are asked of a module'
);
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.case_in_module(uuid, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.ai_run_in_module(uuid, text)', 'execute')
    and not has_function_privilege('authenticated', 'public.conversation_in_module(uuid, text, text)', 'execute'),
  'what tells a case, a run or a contact of a module is read by the lists only'
);

select ok(
  has_function_privilege('authenticated', 'public.decides_for_firm(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.decides_for_firm(uuid)', 'execute'),
  'who decides for the firm is readable by its people, never by a visitor'
);

select * from finish();
rollback;
