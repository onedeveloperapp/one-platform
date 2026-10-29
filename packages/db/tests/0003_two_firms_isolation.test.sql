begin;
create extension if not exists pgtap with schema extensions;
select plan(45);

-- ============================================================
-- Two firms in one database never see each other (every migration).
--
-- The check is made from the catalog, so a table added later is covered
-- without anybody remembering this file:
--   * every table that carries `org_id` must have a row of BOTH firms in the
--     fixture below (the first assertion fails when a new one has none);
--   * a person of one firm reads zero rows of the other, in every such table;
--   * what a person reads of their OWN firm is an explicit list, per role.
-- Then the same for the tables keyed by person, for direct writes, and for
-- every function that takes the firm as an argument.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bruno@souza.invalid', '', now(), '{}', '{"display_name":"Bruno Lima"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a1000000-0000-4000-8000-000000000009';

-- Firm A: Ana (owner) and Bruno (a plain member). Firm B: Davi (owner).
insert into public.organizations (id, name, slug, created_by) values
  ('b1000000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'a1000000-0000-4000-8000-000000000004');

insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000004', 'owner', 'socio');

-- One row of each firm in every table that carries the firm. (subscriptions
-- came with the firm: the floor plan follows every new one.)
insert into public.ai_spend (org_id, feature, provider, model) values
  ('b1000000-0000-4000-8000-00000000000a', 'other', 'anthropic', 'modelo-de-teste'),
  ('b1000000-0000-4000-8000-00000000000b', 'other', 'anthropic', 'modelo-de-teste');
insert into public.audit_events (org_id, actor_id, action) values
  ('b1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'teste.evento'),
  ('b1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000004', 'teste.evento');
insert into public.billing_operations (org_id, actor_id, kind, idempotency_key, status) values
  ('b1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'checkout', gen_random_uuid(), 'completed'),
  ('b1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000004', 'checkout', gen_random_uuid(), 'completed');
insert into public.consent_acceptances (term_id, org_id, user_id)
select t.id, m.org_id, m.user_id
from public.consent_terms t cross join public.memberships m
where t.slug = 'newsletter';
insert into public.entitlement_grants (org_id, kind, limits, source, note) values
  ('b1000000-0000-4000-8000-00000000000a', 'comp', '{"assentos_max": 5}', 'admin', 'teste'),
  ('b1000000-0000-4000-8000-00000000000b', 'comp', '{"assentos_max": 5}', 'admin', 'teste');
insert into public.firm_invitations (org_id, email, firm_function, token_hash, expires_at) values
  ('b1000000-0000-4000-8000-00000000000a', 'convite@souza.invalid', 'advogado', repeat('a', 64), now() + interval '7 days'),
  ('b1000000-0000-4000-8000-00000000000b', 'convite@rocha.invalid', 'advogado', repeat('b', 64), now() + interval '7 days');
insert into public.invoices (org_id, provider, provider_invoice_id, amount_cents, status, paid_at) values
  ('b1000000-0000-4000-8000-00000000000a', 'asaas', 'pay_teste_a', 1000, 'paid', now()),
  ('b1000000-0000-4000-8000-00000000000b', 'asaas', 'pay_teste_b', 2000, 'paid', now());
insert into public.meta_attribution (org_id) values
  ('b1000000-0000-4000-8000-00000000000a'), ('b1000000-0000-4000-8000-00000000000b');
insert into public.onboarding_state (user_id, org_id, flow) values
  ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-00000000000a', 'firma'),
  ('a1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-00000000000b', 'firma');
insert into public.product_events (org_id, actor_id, event_name) values
  ('b1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'firm.created'),
  ('b1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000004', 'firm.created');
insert into public.purchase_attributions (org_id, invoice_key, amount_cents, currency, paid_at) values
  ('b1000000-0000-4000-8000-00000000000a', 'asaas:pay_teste_a', 1000, 'BRL', now()),
  ('b1000000-0000-4000-8000-00000000000b', 'asaas:pay_teste_b', 2000, 'BRL', now());
insert into public.signup_attribution (org_id, origem) values
  ('b1000000-0000-4000-8000-00000000000a', 'teste'), ('b1000000-0000-4000-8000-00000000000b', 'teste');
insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, status, output, finished_at)
select firm.run_id, firm.org_id, 'plataforma.verificacao', version.id, version.provider, version.model,
       repeat('a', 64), 'succeeded', '{"resposta": "teste"}'::jsonb, now()
from (values
  ('c1000000-0000-4000-8000-00000000000a'::uuid, 'b1000000-0000-4000-8000-00000000000a'::uuid),
  ('c1000000-0000-4000-8000-00000000000b'::uuid, 'b1000000-0000-4000-8000-00000000000b'::uuid)
) as firm (run_id, org_id)
cross join (
  select id, provider, model from public.prompt_versions where task = 'plataforma.verificacao' and is_active
) as version;
insert into public.approvals (org_id, run_id, task, approver_functions) values
  ('b1000000-0000-4000-8000-00000000000a', 'c1000000-0000-4000-8000-00000000000a', 'plataforma.verificacao', array['socio', 'advogado']::public.firm_function[]),
  ('b1000000-0000-4000-8000-00000000000b', 'c1000000-0000-4000-8000-00000000000b', 'plataforma.verificacao', array['socio', 'advogado']::public.firm_function[]);
insert into public.connections (id, org_id, provider, external_id, label, status) values
  ('d1000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-a', 'WhatsApp A', 'connected'),
  ('d1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'whatsapp', 'waba-b', 'WhatsApp B', 'connected');
insert into public.connection_secrets (connection_id, org_id, key_version, iv, ciphertext, auth_tag) values
  ('d1000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 1, 'AAAAAAAAAAAAAAAA', 'c2VncmVkbw==', 'AAAAAAAAAAAAAAAAAAAAAA=='),
  ('d1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 1, 'BBBBBBBBBBBBBBBB', 'c2VncmVkbw==', 'BBBBBBBBBBBBBBBBBBBBBA==');
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('e1000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'issued', 'org/b1000000-0000-4000-8000-00000000000a/issued/e1000000-0000-4000-8000-00000000000a',
   'documento-a.pdf', 'application/pdf', 100, 'stored', repeat('a', 64), 100, 'application/pdf', now() + interval '1 hour', now()),
  ('e1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'issued', 'org/b1000000-0000-4000-8000-00000000000b/issued/e1000000-0000-4000-8000-00000000000b',
   'documento-b.pdf', 'application/pdf', 100, 'stored', repeat('b', 64), 100, 'application/pdf', now() + interval '1 hour', now());
insert into public.issued_documents (org_id, kind, title, status, verify_code, file_id, content_hash, idempotency_key, issued_at) values
  ('b1000000-0000-4000-8000-00000000000a', 'procuracao', 'Documento A', 'issued', 'ABCDEFGHJKMN', 'e1000000-0000-4000-8000-00000000000a', repeat('a', 64), 'teste-chave-a', now()),
  ('b1000000-0000-4000-8000-00000000000b', 'procuracao', 'Documento B', 'issued', 'BCDEFGHJKMNP', 'e1000000-0000-4000-8000-00000000000b', repeat('b', 64), 'teste-chave-b', now());
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number) values
  ('f1000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-00000000000a', 'simulator', 'sim-iso-a', 'waba-a', '5562900000001'),
  ('f1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-00000000000b', 'simulator', 'sim-iso-b', 'waba-b', '5562900000002');
insert into public.wa_contacts (number_id, org_id, contact_wa_id, saved_name) values
  ('f1000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', '5562999990001', 'Contato A'),
  ('f1000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', '5562999990002', 'Contato B');
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id) values
  ('f2000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-00000000000a', '5562999990001'),
  ('f2000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', '5562999990002');
insert into public.wa_messages (org_id, conversation_id, number_id, direction, kind, body, status) values
  ('b1000000-0000-4000-8000-00000000000a', 'f2000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-00000000000a', 'in', 'text', 'teste', 'received'),
  ('b1000000-0000-4000-8000-00000000000b', 'f2000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', 'in', 'text', 'teste', 'received');
insert into public.wa_conversation_events (org_id, conversation_id, kind, actor_type) values
  ('b1000000-0000-4000-8000-00000000000a', 'f2000000-0000-4000-8000-00000000000a', 'link_sent', 'system'),
  ('b1000000-0000-4000-8000-00000000000b', 'f2000000-0000-4000-8000-00000000000b', 'link_sent', 'system');
insert into public.wa_templates (org_id, waba_id, name, category, status, body) values
  ('b1000000-0000-4000-8000-00000000000a', 'waba-a', 'modelo_teste', 'utility', 'approved', 'Texto do modelo.'),
  ('b1000000-0000-4000-8000-00000000000b', 'waba-b', 'modelo_teste', 'utility', 'approved', 'Texto do modelo.');
insert into public.wa_optouts (org_id, contact_wa_id, source) values
  ('b1000000-0000-4000-8000-00000000000a', '5562999990009', 'manual'),
  ('b1000000-0000-4000-8000-00000000000b', '5562999990008', 'manual');
insert into public.people (id, org_id, full_name) values
  ('a2000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'Cliente Teste A'),
  ('a2000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'Cliente Teste B');
insert into public.cases (id, org_id, seq, incident) values
  ('a3000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 1, 'delay'),
  ('a3000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 1, 'cancellation');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('a4000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'a2000000-0000-4000-8000-00000000000a', 'claimant'),
  ('a4000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'a2000000-0000-4000-8000-00000000000b', 'claimant');
insert into public.flight_segments (org_id, case_id, flight_number, origin_iata, destination_iata) values
  ('b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'G31234', 'GYN', 'GRU'),
  ('b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'AD4512', 'VCP', 'REC');
insert into public.proceedings (id, org_id, case_id, kind, court) values
  ('a5000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'juizado', 'TJGO'),
  ('a5000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'juizado', 'TJSP');
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('a5000000-0000-4000-8000-00000000000a', 'a4000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a'),
  ('a5000000-0000-4000-8000-00000000000b', 'a4000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b');
insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values
  ('a5000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-00000000000a'),
  ('a5000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-00000000000b');
insert into public.case_events (org_id, case_id, kind, actor_type) values
  ('b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'created', 'person'),
  ('b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'created', 'person');
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at) values
  ('a6000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'a2000000-0000-4000-8000-00000000000a', repeat('1', 64), now() + interval '30 days'),
  ('a6000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'a2000000-0000-4000-8000-00000000000b', repeat('2', 64), now() + interval '30 days');
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('e2000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'client', 'org/b1000000-0000-4000-8000-00000000000a/client/e2000000-0000-4000-8000-00000000000a',
   'identidade-a.pdf', 'application/pdf', 100, 'stored', repeat('c', 64), 100, 'application/pdf', now() + interval '1 hour', now()),
  ('e2000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'client', 'org/b1000000-0000-4000-8000-00000000000b/client/e2000000-0000-4000-8000-00000000000b',
   'identidade-b.pdf', 'application/pdf', 100, 'stored', repeat('d', 64), 100, 'application/pdf', now() + interval '1 hour', now());
insert into public.case_documents (org_id, case_id, file_id, kind, source, status) values
  ('b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'e2000000-0000-4000-8000-00000000000a', 'identity', 'client', 'received'),
  ('b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'e2000000-0000-4000-8000-00000000000b', 'identity', 'client', 'received');
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at) values
  ('e3000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'upload', 'org/b1000000-0000-4000-8000-00000000000a/upload/e3000000-0000-4000-8000-00000000000a',
   'procuracao-a.pdf', 'application/pdf', 100, 'stored', repeat('e', 64), 100, 'application/pdf', now() + interval '1 hour', now()),
  ('e3000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'upload', 'org/b1000000-0000-4000-8000-00000000000b/upload/e3000000-0000-4000-8000-00000000000b',
   'procuracao-b.pdf', 'application/pdf', 100, 'stored', repeat('f', 64), 100, 'application/pdf', now() + interval '1 hour', now());
insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status) values
  ('a7000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'e3000000-0000-4000-8000-00000000000a', 'power_of_attorney', 'firm', 'received'),
  ('a7000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'e3000000-0000-4000-8000-00000000000b', 'power_of_attorney', 'firm', 'received');
insert into public.signature_envelopes (org_id, case_id, document_id, method, status, signers) values
  ('b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-00000000000a', 'govbr', 'pending',
   '[{"position": 1, "person_id": "a2000000-0000-4000-8000-00000000000a", "name": "Cliente Teste A"}]'),
  ('b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'a7000000-0000-4000-8000-00000000000b', 'govbr', 'pending',
   '[{"position": 1, "person_id": "a2000000-0000-4000-8000-00000000000b", "name": "Cliente Teste B"}]');
insert into public.client_consents (org_id, case_id, person_id, term_id, term_slug, term_version, term_title)
select f.org_id, f.case_id, f.person_id, t.id, t.slug, t.version, t.title
from (select * from public.consent_terms where slug = 'newsletter' limit 1) as t
cross join (values
  ('b1000000-0000-4000-8000-00000000000a'::uuid, 'a3000000-0000-4000-8000-00000000000a'::uuid, 'a2000000-0000-4000-8000-00000000000a'::uuid),
  ('b1000000-0000-4000-8000-00000000000b'::uuid, 'a3000000-0000-4000-8000-00000000000b'::uuid, 'a2000000-0000-4000-8000-00000000000b'::uuid)
) as f (org_id, case_id, person_id);
insert into public.case_weather (org_id, case_id, icao, observed_at, raw) values
  ('b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'SBGO', now(), 'METAR SBGO 201000Z 09008KT 9999 SCT030 27/18 Q1016'),
  ('b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'SBGR', now(), 'METAR SBGR 201000Z 15006KT 9999 FEW020 20/14 Q1020');
insert into public.case_statements (org_id, case_id, source, transcript) values
  ('b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'firm', 'O voo da cliente do escritório A atrasou seis horas.'),
  ('b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'firm', 'O voo do cliente do escritório B foi cancelado.');
insert into public.admin_complaints (org_id, case_id, channel) values
  ('b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'anac_passageiro'),
  ('b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'consumidor_gov');
insert into public.proceedings (id, org_id, case_id, kind, court, system) values
  ('a8000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'juizado', 'TJGO', 'projudi'),
  ('a8000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'juizado', 'TJGO', 'projudi');
insert into public.filing_packages (id, org_id, case_id, proceeding_id, court, system, kind, status, petition_document_id) values
  ('a9000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-00000000000a', 'TJGO', 'projudi', 'juizado', 'filed', 'a7000000-0000-4000-8000-00000000000a'),
  ('a9000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'a8000000-0000-4000-8000-00000000000b', 'TJGO', 'projudi', 'juizado', 'filed', 'a7000000-0000-4000-8000-00000000000b');
insert into public.filing_package_items (org_id, package_id, position, name, file_id, document_id, bytes) values
  ('b1000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-00000000000a', 1, '01-peticao-inicial.pdf', 'e3000000-0000-4000-8000-00000000000a', 'a7000000-0000-4000-8000-00000000000a', 1000),
  ('b1000000-0000-4000-8000-00000000000b', 'a9000000-0000-4000-8000-00000000000b', 1, '01-peticao-inicial.pdf', 'e3000000-0000-4000-8000-00000000000b', 'a7000000-0000-4000-8000-00000000000b', 1000);
insert into public.filing_receipts (org_id, package_id, proceeding_id, file_id, cnj, filed_on) values
  ('b1000000-0000-4000-8000-00000000000a', 'a9000000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-00000000000a', 'e3000000-0000-4000-8000-00000000000a', '50002023920998090051', current_date),
  ('b1000000-0000-4000-8000-00000000000b', 'a9000000-0000-4000-8000-00000000000b', 'a8000000-0000-4000-8000-00000000000b', 'e3000000-0000-4000-8000-00000000000b', '50003037620998090051', current_date);
insert into public.proceeding_tracking (org_id, case_id, proceeding_id, cnj, source, status) values
  ('b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-00000000000a', '50002023920998090051', 'projudi', 'tracked'),
  ('b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'a8000000-0000-4000-8000-00000000000b', '50003037620998090051', 'projudi', 'tracked');
insert into public.import_batches (id, org_id, file_name) values
  ('aa000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'carteira-a.xlsx'),
  ('aa000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'carteira-b.xlsx');
insert into public.import_rows (org_id, batch_id, row_number, cnj) values
  ('b1000000-0000-4000-8000-00000000000a', 'aa000000-0000-4000-8000-00000000000a', 2, '50002023920998090051'),
  ('b1000000-0000-4000-8000-00000000000b', 'aa000000-0000-4000-8000-00000000000b', 2, '50003037620998090051');
insert into public.movements (org_id, case_id, proceeding_id, source, source_id, occurred_at, title) values
  ('b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-00000000000a', 'projudi', '900000001', now(), 'Processo Distribuído'),
  ('b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'a8000000-0000-4000-8000-00000000000b', 'projudi', '900000002', now(), 'Processo Distribuído');
insert into public.certificate_inventory (org_id, user_id, system, kind) values
  ('b1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001', 'projudi', 'a3_token'),
  ('b1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000004', 'projudi', 'a1');
insert into public.deadlines (org_id, cnj, court, case_id, proceeding_id, title, trigger, trigger_on, days, counting) values
  ('b1000000-0000-4000-8000-00000000000a', '50002023920998090051', 'TJGO', 'a3000000-0000-4000-8000-00000000000a',
   'a8000000-0000-4000-8000-00000000000a', 'Manifestação sobre documentos', 'day', current_date, 15, 'business'),
  ('b1000000-0000-4000-8000-00000000000b', '50003037620998090051', 'TJGO', 'a3000000-0000-4000-8000-00000000000b',
   'a8000000-0000-4000-8000-00000000000b', 'Recurso inominado', 'day', current_date, 10, 'business');
insert into public.hearings (org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode) values
  ('b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-00000000000a',
   'conciliacao', now() + interval '20 days', 'America/Sao_Paulo', 'videoconferencia'),
  ('b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'a8000000-0000-4000-8000-00000000000b',
   'una', now() + interval '30 days', 'America/Sao_Paulo', 'presencial');
insert into public.firm_calendars (org_id, connection_id, calendar_id, name) values
  ('b1000000-0000-4000-8000-00000000000a', 'd1000000-0000-4000-8000-00000000000a', 'agenda-a@group.calendar.invalid', 'Audiências A'),
  ('b1000000-0000-4000-8000-00000000000b', 'd1000000-0000-4000-8000-00000000000b', 'agenda-b@group.calendar.invalid', 'Audiências B');
-- The backend's own list of events to take out: no session reads it, of either firm.
insert into public.hearing_event_removals (hearing_id, org_id, calendar_id) values
  ('a9100000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'agenda-a@group.calendar.invalid'),
  ('a9100000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'agenda-b@group.calendar.invalid');
insert into public.firm_notice_kinds (org_id, kind) values
  ('b1000000-0000-4000-8000-00000000000a', 'hearing_reminder'),
  ('b1000000-0000-4000-8000-00000000000b', 'hearing_reminder');
insert into public.notice_optins (person_id, org_id, phone, source, wording) values
  ('a2000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', '5562999990001', 'client',
   'Quero receber os avisos do meu processo.'),
  ('a2000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', '5562999990002', 'client',
   'Quero receber os avisos do meu processo.');
insert into public.client_notices (org_id, case_id, person_id, phone, kind, occurrence, params, message_id)
select m.org_id, c.id, p.id, '5500999990001', 'payment_alert', 'p:teste', '[]'::jsonb, m.id
from public.wa_messages m
join public.cases c on c.org_id = m.org_id
join public.people p on p.org_id = m.org_id
where m.org_id in ('b1000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000b');
insert into public.civil_court_answers (org_id, case_id, party_id, person_id, accepted, wording, version, source) values
  ('b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'a4000000-0000-4000-8000-00000000000a',
   'a2000000-0000-4000-8000-00000000000a', true, 'Aceito que a minha ação seja proposta na vara cível, com custas.', 1, 'client'),
  ('b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'a4000000-0000-4000-8000-00000000000b',
   'a2000000-0000-4000-8000-00000000000b', false, 'Aceito que a minha ação seja proposta na vara cível, com custas.', 1, 'client');
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b1000000-0000-4000-8000-00000000000a', 'document_check', 'approval'),
  ('b1000000-0000-4000-8000-00000000000b', 'piece_text', 'approval');
insert into public.firm_signers (org_id, user_id) values
  ('b1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000001'),
  ('b1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000004');
-- A use of a lawyer's signature in the cloud (0041): Bruno's in firm A, read by him and by who manages his firm.
insert into public.lawyer_signature_uses (org_id, person_id, psc, purpose, document_hashes, seal_id) values
  ('b1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000002', 'serproid', 'authorization.check', array[repeat('a', 64)], gen_random_uuid()),
  ('b1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000004', 'serproid', 'authorization.check', array[repeat('b', 64)], gen_random_uuid());
-- The test chat of each firm and a trip it follows, with its leg and an alert (0047).
insert into public.test_chats (org_id, number_id, token) values
  ('b1000000-0000-4000-8000-00000000000a', 'f1000000-0000-4000-8000-00000000000a', repeat('a', 43)),
  ('b1000000-0000-4000-8000-00000000000b', 'f1000000-0000-4000-8000-00000000000b', repeat('b', 43));
insert into public.tracked_trips (id, org_id, passenger_name, phone, airline_iata, is_test, label, consent_wording, consent_at, consent_channel) values
  ('ae900000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'Passageira Teste A', '5500988880001', 'LA', true,
   'cancelamento', 'Concordo em receber avisos sobre a viagem que cadastrei.', now(), 'test'),
  ('ae900000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'Passageiro Teste B', '5500988880002', 'G3', true,
   'cancelamento', 'Concordo em receber avisos sobre a viagem que cadastrei.', now(), 'test');
insert into public.tracked_legs (org_id, trip_id, position, flight_number, origin_iata, destination_iata, scheduled_departure_local, scheduled_arrival_local) values
  ('b1000000-0000-4000-8000-00000000000a', 'ae900000-0000-4000-8000-00000000000a', 1, 'LA3456', 'GRU', 'REC', '2099-01-10 08:10', '2099-01-10 11:25'),
  ('b1000000-0000-4000-8000-00000000000b', 'ae900000-0000-4000-8000-00000000000b', 1, 'G31450', 'BSB', 'GIG', '2099-01-10 14:00', '2099-01-10 15:45');
insert into public.flight_alerts (org_id, trip_id, kind, rule_version) values
  ('b1000000-0000-4000-8000-00000000000a', 'ae900000-0000-4000-8000-00000000000a', 'cancelled', 'flight-problem-v1'),
  ('b1000000-0000-4000-8000-00000000000b', 'ae900000-0000-4000-8000-00000000000b', 'cancelled', 'flight-problem-v1');
-- The claim each firm asks by default (0052), and the power of attorney ONE sent its client to sign (0054).
insert into public.firm_claim_defaults (org_id, incident, cents) values
  ('b1000000-0000-4000-8000-00000000000a', 'delay', 800000),
  ('b1000000-0000-4000-8000-00000000000b', 'cancellation', 1000000);
insert into public.case_papers (org_id, case_id, person_id, kind, document_id) values
  ('b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'a2000000-0000-4000-8000-00000000000a',
   'procuracao', 'a7000000-0000-4000-8000-00000000000a'),
  ('b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'a2000000-0000-4000-8000-00000000000b',
   'procuracao', 'a7000000-0000-4000-8000-00000000000b');
-- record_versions: written by the versioning triggers of the inserts above.

-- Tables keyed by the person.
insert into public.notifications (user_id, title) values
  ('a1000000-0000-4000-8000-000000000001', 'Aviso da Ana'),
  ('a1000000-0000-4000-8000-000000000002', 'Aviso do Bruno'),
  ('a1000000-0000-4000-8000-000000000004', 'Aviso do Davi');
insert into public.access_events (user_id) values
  ('a1000000-0000-4000-8000-000000000001'), ('a1000000-0000-4000-8000-000000000004');
insert into public.oab_registrations (id, user_id, uf, number, kind) values
  ('aa000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000002', 'GO', '1001', 'principal'),
  ('aa000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000004', 'GO', '2002', 'principal');
-- What the courts publish to each firm's lawyers: the reading of each registration, and a communication.
insert into public.djen_captures (org_id, user_id, registration_id, uf, number) values
  ('b1000000-0000-4000-8000-00000000000a', 'a1000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-00000000000a', 'GO', '1001'),
  ('b1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000004', 'aa000000-0000-4000-8000-00000000000b', 'GO', '2002');
-- The same communication, addressed to a lawyer of each firm: each firm keeps its own.
insert into public.publications (org_id, hash, court, cnj, available_on, kind, body, lawyer_ids) values
  ('b1000000-0000-4000-8000-00000000000a', 'hashdeteste000001abcdefghijkl', 'TJGO', '50002023920998090051', current_date, 'Intimação', 'Texto de teste.',
   array['a1000000-0000-4000-8000-000000000002']::uuid[]),
  ('b1000000-0000-4000-8000-00000000000b', 'hashdeteste000001abcdefghijkl', 'TJGO', '50002023920998090051', current_date, 'Intimação', 'Texto de teste.',
   array['a1000000-0000-4000-8000-000000000004']::uuid[]);
-- What ONE read of a publication (0040).
insert into public.publication_readings (publication_id, org_id, kind)
select p.id, p.org_id, 'deadline' from public.publications p where p.hash = 'hashdeteste000001abcdefghijkl';

-- The pieces: each firm's verified library, its models, a draft of a lawsuit with a version and what it cites, and a dossier.
insert into public.legal_sources (org_id, kind, number, article, title, source_url) values
  ('b1000000-0000-4000-8000-00000000000a', 'lei', '8078', '14', 'Responsabilidade do fornecedor de serviços', 'https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm'),
  ('b1000000-0000-4000-8000-00000000000b', 'lei', '8078', '14', 'Responsabilidade do fornecedor de serviços', 'https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm');
insert into public.draft_templates (id, org_id, name, body) values
  ('ab000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'Petição inicial', 'Modelo de teste do escritório A, com o texto de uma peça.'),
  ('ab000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'Petição inicial', 'Modelo de teste do escritório B, com o texto de uma peça.');
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_id, template_name, template_body, mode, status, version) values
  ('ac000000-0000-4000-8000-00000000000a', 'b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a', 'a8000000-0000-4000-8000-00000000000a', 'ab000000-0000-4000-8000-00000000000a',
   'Petição inicial', 'Modelo de teste do escritório A, com o texto de uma peça.', 'blank', 'proposed', 1),
  ('ac000000-0000-4000-8000-00000000000b', 'b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b', 'a8000000-0000-4000-8000-00000000000b', 'ab000000-0000-4000-8000-00000000000b',
   'Petição inicial', 'Modelo de teste do escritório B, com o texto de uma peça.', 'blank', 'proposed', 1);
insert into public.case_draft_versions (org_id, draft_id, version, author, body) values
  ('b1000000-0000-4000-8000-00000000000a', 'ac000000-0000-4000-8000-00000000000a', 1, 'template', 'Modelo de teste do escritório A, com o texto de uma peça.'),
  ('b1000000-0000-4000-8000-00000000000b', 'ac000000-0000-4000-8000-00000000000b', 1, 'template', 'Modelo de teste do escritório B, com o texto de uma peça.');
insert into public.case_draft_citations (org_id, draft_id, version, position, kind, number, article, key, raw) values
  ('b1000000-0000-4000-8000-00000000000a', 'ac000000-0000-4000-8000-00000000000a', 1, 0, 'lei', '8078', '14', 'lei::8078#14', 'art. 14 da Lei nº 8078'),
  ('b1000000-0000-4000-8000-00000000000b', 'ac000000-0000-4000-8000-00000000000b', 1, 0, 'lei', '8078', '14', 'lei::8078#14', 'art. 14 da Lei nº 8078');
insert into public.dossiers (org_id, case_id) values
  ('b1000000-0000-4000-8000-00000000000a', 'a3000000-0000-4000-8000-00000000000a'),
  ('b1000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-00000000000b');
insert into public.template_imports (org_id, file_name, source) values
  ('b1000000-0000-4000-8000-00000000000a', 'inicial-a.docx', 'docx'),
  ('b1000000-0000-4000-8000-00000000000b', 'inicial-b.docx', 'docx');

create temporary table results (name text primary key, payload jsonb, id uuid);
grant select, insert on results to authenticated;

-- Every table of `public` that carries the firm, and how many rows of one firm
-- the CURRENT role reads in each. A table the role has no right to read is
-- left out (the catalog scan lists those).
create function pg_temp.firm_rows(target uuid)
returns table (table_name text, visible bigint)
language plpgsql as
$$
declare
  found record;
begin
  for found in
    select c.oid, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and has_column_privilege(c.oid, a.attnum, 'SELECT')
    order by c.relname
  loop
    table_name := found.relname;
    execute format('select count(*) from public.%I where org_id = $1', found.relname) into visible using target;
    return next;
  end loop;
end;
$$;

create function pg_temp.sign_in(who uuid, address text, level text default 'aal2')
returns void language sql as
$$
  select set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', who, 'role', 'authenticated', 'email', address, 'aal', level)::text,
    true
  );
$$;

-- ---------- The fixture covers every table that carries the firm ----------

select is(
  (select coalesce(array_agg(table_name order by table_name), '{}')
   from pg_temp.firm_rows('b1000000-0000-4000-8000-00000000000b') where visible = 0),
  '{}'::text[],
  'every table that carries the firm has a row of firm B in this test (a new table adds its row above)'
);
select is(
  (select coalesce(array_agg(table_name order by table_name), '{}')
   from pg_temp.firm_rows('b1000000-0000-4000-8000-00000000000a') where visible = 0),
  '{}'::text[],
  'and a row of firm A'
);
select is(
  (
    select count(*)::int
    from pg_policy pol
    join pg_class c on c.oid = pol.polrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and exists (select 1 from pg_attribute a where a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped)
      and (coalesce(pg_get_expr(pol.polqual, pol.polrelid), '') = 'true'
           or coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '') = 'true'
           or 'anon'::regrole = any (pol.polroles)
           or 0 = any (pol.polroles))
  ),
  0,
  'no policy of a table that carries the firm is open to everybody or to the anonymous role'
);

-- ---------- The owner of firm A ----------

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000001', 'ana@souza.invalid');
set local role authenticated;

select is(
  (select coalesce(array_agg(table_name order by table_name), '{}')
   from pg_temp.firm_rows('b1000000-0000-4000-8000-00000000000b') where visible > 0),
  '{}'::text[],
  'the owner of firm A reads no row of firm B, in any table'
);
select is(
  (select array_agg(table_name order by table_name)
   from pg_temp.firm_rows('b1000000-0000-4000-8000-00000000000a') where visible > 0),
  array[
    'admin_complaints', 'ai_runs', 'approvals', 'audit_events', 'billing_operations', 'case_advances', 'case_documents',
    'case_draft_citations', 'case_draft_versions', 'case_drafts', 'case_events',
    'case_papers', 'case_parties', 'case_statements',
    'case_weather', 'cases', 'certificate_inventory', 'civil_court_answers', 'client_consents', 'client_links', 'client_notices', 'connections',
    'consent_acceptances',
    'deadlines', 'djen_captures', 'dossiers', 'draft_templates', 'entitlement_grants', 'files', 'filing_package_items', 'filing_packages',
    'filing_receipts', 'firm_autonomy', 'firm_calendars',
    'firm_claim_defaults', 'firm_invitations', 'firm_modules', 'firm_notice_kinds', 'firm_signers', 'flight_alerts', 'flight_checks', 'flight_segments', 'hearings', 'import_batches', 'import_rows', 'invoices',
    'issued_documents', 'lawyer_signature_uses', 'legal_sources', 'memberships',
    'movements', 'notice_optins', 'onboarding_state',
    'people',
    'proceeding_lawyers', 'proceeding_parties', 'proceeding_tracking', 'proceedings', 'publication_readings', 'publications', 'record_versions',
    'signature_envelopes',
    'subscriptions', 'template_imports', 'test_chats', 'tracked_legs', 'tracked_trips',
    'wa_contacts',
    'wa_conversation_events', 'wa_conversations', 'wa_messages', 'wa_numbers', 'wa_optouts', 'wa_templates'
  ],
  'and of their own firm exactly what an owner should'
);
select is(
  (select array_agg(name order by name) from public.organizations),
  array['Souza Advogados'],
  'they see one firm'
);
select is((select count(*)::int from public.memberships), 2, 'its two people');
select is((select count(*)::int from public.profiles), 1, 'one profile: their own');
select is(
  (select array_agg(title order by title) from public.notifications),
  array['Aviso da Ana'],
  'their own notices, not a colleague''s and not another firm''s'
);
select is((select count(*)::int from public.access_events), 1, 'their own sign-ins');
select is(
  (select array_agg(number order by number) from public.oab_registrations),
  array['1001'],
  'the registration of a colleague, not of a lawyer of another firm'
);
select is((select count(*)::int from public.consent_acceptances), 1, 'and their own consent only: a colleague''s is theirs');

-- Writes that name the other firm.
update public.notifications set read_at = now() where user_id = 'a1000000-0000-4000-8000-000000000004';
select throws_ok(
  $$select public.rename_firm('b1000000-0000-4000-8000-00000000000b', 'Tomado')$$,
  '42501', 'not_authorized',
  'another firm cannot be renamed'
);
select throws_ok(
  $$insert into public.audit_events (org_id, actor_id, action)
    values ('b1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000001', 'teste.invasao')$$,
  '42501', null,
  'an audit event cannot be written into another firm'
);
select throws_ok(
  $$insert into public.onboarding_state (user_id, org_id, flow)
    values ('a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-00000000000b', 'firma')$$,
  '42501', null,
  'nor a checklist state'
);
select throws_ok(
  $$insert into public.invoices (org_id, provider, provider_invoice_id, amount_cents)
    values ('b1000000-0000-4000-8000-00000000000b', 'asaas', 'pay_falso', 1)$$,
  '42501', null,
  'nor an invoice (not even into their own firm)'
);

-- Every function that takes the firm.
select throws_ok(
  $$select public.org_entitlements('b1000000-0000-4000-8000-00000000000b')$$,
  'P0001', 'not a member of this organization',
  'what another firm may use is not answered'
);
select is(public.org_has_entitlement('b1000000-0000-4000-8000-00000000000b', 'assentos_max'), false, 'the yes/no form answers no');
select ok(
  not public.is_org_member('b1000000-0000-4000-8000-00000000000b')
  and not public.has_org_role('b1000000-0000-4000-8000-00000000000b', array['owner', 'admin', 'member']::public.org_role[])
  and not public.has_firm_function('b1000000-0000-4000-8000-00000000000b', array['socio', 'advogado', 'controladoria', 'atendimento']::public.firm_function[])
  and not public.shares_firm_with('a1000000-0000-4000-8000-000000000004'),
  'the helpers the policies are built on say no for another firm'
);
select throws_ok(
  $$select * from public.firm_team('b1000000-0000-4000-8000-00000000000b')$$,
  '42501', null,
  'the roster of another firm is refused'
);
select throws_ok(
  $$select public.invite_to_firm('b1000000-0000-4000-8000-00000000000b', 'x@souza.invalid', 'member', 'advogado', repeat('c', 64))$$,
  '42501', 'not_authorized',
  'inviting into another firm is refused'
);
select throws_ok(
  $$select public.revoke_firm_invitation((select id from public.firm_invitations where false))$$,
  '42501', 'not_authorized',
  'an invitation that is not of their firm cannot be revoked'
);
select throws_ok(
  $$select public.set_member_function('b1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000004', 'atendimento')$$,
  '42501', 'not_authorized',
  'changing a function in another firm is refused'
);
select throws_ok(
  $$select public.set_member_role('b1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000004', 'member')$$,
  '42501', 'not_authorized',
  'and a role'
);
select throws_ok(
  $$select public.remove_firm_member('b1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000004')$$,
  '42501', 'not_authorized',
  'removing a person of another firm is refused'
);
select throws_ok(
  $$select public.transfer_firm_ownership('b1000000-0000-4000-8000-00000000000b', 'a1000000-0000-4000-8000-000000000001')$$,
  '42501', 'not_authorized',
  'and so is taking it over'
);
select is(public.leave_firm('b1000000-0000-4000-8000-00000000000b') ->> 'code', 'not_a_member', 'there is nothing to leave in a firm one is not in');
select throws_ok(
  $$select public.update_billing_profile('b1000000-0000-4000-8000-00000000000b', '11144477735', null, null, null)$$,
  '42501', 'forbidden',
  'the billing profile of another firm is refused'
);
select throws_ok(
  $$select public.abandon_incomplete_subscription('b1000000-0000-4000-8000-00000000000b', gen_random_uuid())$$,
  '42501', 'forbidden',
  'and so is its checkout'
);
select throws_ok(
  $$select public.admin_firm_dossier('b1000000-0000-4000-8000-00000000000b')$$,
  '42501', 'not_authorized',
  'the operator''s view of a firm is not for a firm''s owner'
);
select throws_ok(
  $$select public.admin_firms_overview()$$,
  '42501', 'not_authorized',
  'nor the list of every firm'
);
select throws_ok(
  $$select public.grant_entitlement('b1000000-0000-4000-8000-00000000000b', (select id from public.plans limit 1))$$,
  'P0001', 'not_authorized',
  'nor a courtesy'
);
select throws_ok(
  $$select public.set_org_plan('b1000000-0000-4000-8000-00000000000a', (select id from public.plans limit 1))$$,
  'P0001', 'not_authorized',
  'nor the plan of a firm, their own included'
);
reset role;

select is(
  (select array_agg(name order by name) from public.organizations),
  array['Rocha Advocacia', 'Souza Advogados'],
  'both firms kept their names'
);
select is(
  (select read_at from public.notifications where user_id = 'a1000000-0000-4000-8000-000000000004'),
  null,
  'nor did the write aimed at another person''s notice'
);
select is(
  (select count(*)::int from public.firm_invitations where org_id = 'b1000000-0000-4000-8000-00000000000b'),
  1,
  'firm B kept its one invitation'
);

-- ---------- A plain member of firm A ----------

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000002', 'bruno@souza.invalid');
set local role authenticated;
select is(
  (select coalesce(array_agg(table_name order by table_name), '{}')
   from pg_temp.firm_rows('b1000000-0000-4000-8000-00000000000b') where visible > 0),
  '{}'::text[],
  'a plain member of firm A reads no row of firm B either'
);
select is(
  (select array_agg(table_name order by table_name)
   from pg_temp.firm_rows('b1000000-0000-4000-8000-00000000000a') where visible > 0),
  array[
    'admin_complaints', 'ai_runs', 'approvals', 'case_advances', 'case_documents', 'case_draft_citations', 'case_draft_versions',
    'case_drafts', 'case_events', 'case_papers', 'case_parties', 'case_statements',
    'case_weather', 'cases', 'certificate_inventory', 'civil_court_answers', 'client_consents',
    'client_links', 'client_notices',
    'consent_acceptances', 'deadlines', 'djen_captures', 'dossiers', 'draft_templates', 'entitlement_grants', 'files',
    'filing_package_items', 'filing_packages',
    'filing_receipts', 'firm_autonomy', 'firm_calendars', 'firm_claim_defaults', 'firm_modules', 'firm_notice_kinds', 'firm_signers', 'flight_alerts', 'flight_checks', 'flight_segments', 'hearings', 'import_batches',
    'import_rows', 'invoices', 'issued_documents', 'lawyer_signature_uses', 'legal_sources',
    'memberships', 'movements', 'notice_optins', 'people', 'proceeding_lawyers', 'proceeding_parties', 'proceeding_tracking', 'proceedings',
    'publication_readings', 'publications',
    'signature_envelopes',
    'subscriptions', 'template_imports', 'test_chats', 'tracked_legs', 'tracked_trips',
    'wa_contacts', 'wa_conversation_events', 'wa_conversations', 'wa_messages', 'wa_numbers', 'wa_optouts', 'wa_templates'
  ],
  'and of their own firm less than the owner: no audit trail, no history, no invitations, no checkout, no vendor accounts'
);
select throws_ok(
  $$select public.update_billing_profile('b1000000-0000-4000-8000-00000000000a', '11144477735', null, null, null)$$,
  '42501', 'forbidden',
  'a plain member does not change the billing profile of the firm'
);
select throws_ok(
  $$select public.rename_firm('b1000000-0000-4000-8000-00000000000a', 'Renomeado pelo membro')$$,
  '42501', 'not_authorized',
  'nor renames it'
);
reset role;

-- ---------- The owner of firm B ----------

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000004', 'davi@rocha.invalid');
set local role authenticated;
select is(
  (select coalesce(array_agg(table_name order by table_name), '{}')
   from pg_temp.firm_rows('b1000000-0000-4000-8000-00000000000a') where visible > 0),
  '{}'::text[],
  'the owner of firm B reads no row of firm A'
);
select is(
  (select array_agg(table_name order by table_name)
   from pg_temp.firm_rows('b1000000-0000-4000-8000-00000000000b') where visible > 0),
  array[
    'admin_complaints', 'ai_runs', 'approvals', 'audit_events', 'billing_operations', 'case_advances', 'case_documents',
    'case_draft_citations', 'case_draft_versions', 'case_drafts', 'case_events',
    'case_papers', 'case_parties', 'case_statements',
    'case_weather', 'cases', 'certificate_inventory', 'civil_court_answers', 'client_consents', 'client_links', 'client_notices', 'connections',
    'consent_acceptances',
    'deadlines', 'djen_captures', 'dossiers', 'draft_templates', 'entitlement_grants', 'files', 'filing_package_items', 'filing_packages',
    'filing_receipts', 'firm_autonomy', 'firm_calendars',
    'firm_claim_defaults', 'firm_invitations', 'firm_modules', 'firm_notice_kinds', 'firm_signers', 'flight_alerts', 'flight_checks', 'flight_segments', 'hearings', 'import_batches', 'import_rows', 'invoices',
    'issued_documents', 'lawyer_signature_uses', 'legal_sources', 'memberships',
    'movements', 'notice_optins', 'onboarding_state',
    'people',
    'proceeding_lawyers', 'proceeding_parties', 'proceeding_tracking', 'proceedings', 'publication_readings', 'publications', 'record_versions',
    'signature_envelopes',
    'subscriptions', 'template_imports', 'test_chats', 'tracked_legs', 'tracked_trips',
    'wa_contacts',
    'wa_conversation_events', 'wa_conversations', 'wa_messages', 'wa_numbers', 'wa_optouts', 'wa_templates'
  ],
  'and of their own firm the same an owner of firm A reads of theirs'
);
select is(
  (public.org_entitlements('b1000000-0000-4000-8000-00000000000b') -> 'limits' ->> 'assentos_max')::int,
  5,
  'what their own firm may use is answered'
);
reset role;

-- ---------- The platform operator ----------

select pg_temp.sign_in('a1000000-0000-4000-8000-000000000009', 'operador@one.invalid');
set local role authenticated;
select is((select count(*)::int from public.organizations), 2, 'the platform operator sees both firms');
select is(
  (public.admin_firms_overview() -> 'totals' ->> 'firms')::int,
  2,
  'and the console lists both'
);
reset role;

select * from finish();
rollback;
