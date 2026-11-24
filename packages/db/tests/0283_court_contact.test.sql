begin;
create extension if not exists pgtap;
select plan(13);

-- ============================================================
-- The e-mail and the mobile of each claimant, asked where the case's court
-- asks them (0283). Firm A's passenger lives in São Paulo, whose court's
-- eproc refuses a claimant without e-mail and mobile: before any lawsuit,
-- her e-mail is data the case lacks, ONE's to ask in the chat until it
-- asked, hers to answer once it did; her link says the court asks it. Her
-- lawsuit planned at another court's screen asks nothing, one at the
-- eproc of TJSP asks it, and nothing is asked once the case left the
-- client. Firm B's passenger lives in Goiás, whose court's screen asks
-- nothing, and firm B reads nothing of firm A.
--
-- Every person, firm and number here is invented; the CPF is one every
-- manual uses as an example.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2830000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-contato.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2830000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-contato.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2830000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-contato', 'a2830000-0000-4000-8000-000000000001'),
  ('b2830000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-contato', 'a2830000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2830000-0000-4000-8000-00000000000a', 'a2830000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2830000-0000-4000-8000-00000000000b', 'a2830000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2830000-0000-4000-8000-00000000000a', 'b2830000-0000-4000-8000-00000000000a', 'whatsapp', 'contato-waba-a', 'Chat de teste',
   'connected', 'a2830000-0000-4000-8000-000000000001', now()),
  ('c2830000-0000-4000-8000-00000000000b', 'b2830000-0000-4000-8000-00000000000b', 'whatsapp', 'contato-waba-b', 'Chat de teste',
   'connected', 'a2830000-0000-4000-8000-000000000002', now());
-- The documents a case needs are the setting's: none here, so what the case lacks is the person's data alone.
update public.platform_settings set value = jsonb_set(value, '{required_documents}', '[]'::jsonb) where key = 'cases';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b2830000-0000-4000-8000-00000000000a',
  'c2830000-0000-4000-8000-00000000000a', 'test', 'contato-number-a', 'contato-waba-a', '5500900000283', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b2830000-0000-4000-8000-00000000000b',
  'c2830000-0000-4000-8000-00000000000b', 'test', 'contato-number-b', 'contato-waba-b', '5500900000284', 'Rocha Advocacia', 'cloud'));
reset role;

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('d2830000-0000-4000-8000-000000000001', 'b2830000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'cancellation', 'documents'),
  ('d2830000-0000-4000-8000-000000000002', 'b2830000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'cancellation', 'documents');
-- Everything the papers ask is there; the e-mail is not.
insert into public.people (id, org_id, full_name, cpf, birth_date, nationality, marital_status, profession, phone,
                           postal_code, street, address_number, district, city, uf) values
  ('e2830000-0000-4000-8000-000000000001', 'b2830000-0000-4000-8000-00000000000a', 'Nídia Teste Farias', '52998224725',
   '1980-05-10', 'brasileira', 'casado', 'Professora', '5500988882831', '01310000', 'Avenida Exemplo', '100',
   'Bela Vista', 'São Paulo', 'SP'),
  ('e2830000-0000-4000-8000-000000000002', 'b2830000-0000-4000-8000-00000000000b', 'Nídia Teste Farias', '52998224725',
   '1980-05-10', 'brasileira', 'casado', 'Professora', '5500988882831', '74000000', 'Rua Exemplo', '100',
   'Setor Teste', 'Goiânia', 'GO');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('f2830000-0000-4000-8000-000000000001', 'b2830000-0000-4000-8000-00000000000a', 'd2830000-0000-4000-8000-000000000001',
   'e2830000-0000-4000-8000-000000000001', 'claimant'),
  ('f2830000-0000-4000-8000-000000000002', 'b2830000-0000-4000-8000-00000000000b', 'd2830000-0000-4000-8000-000000000002',
   'e2830000-0000-4000-8000-000000000002', 'claimant');
insert into public.flight_segments (org_id, case_id) values
  ('b2830000-0000-4000-8000-00000000000a', 'd2830000-0000-4000-8000-000000000001'),
  ('b2830000-0000-4000-8000-00000000000b', 'd2830000-0000-4000-8000-000000000002');
-- Firm A's passenger's identity and proof of address were accepted: ONE may check her data in the chat.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at)
select x.id::uuid, 'b2830000-0000-4000-8000-00000000000a', 'whatsapp',
       'org/b2830000-0000-4000-8000-00000000000a/whatsapp/' || x.id, x.name, 'image/jpeg', 100, 'stored', x.sha, 100,
       'image/jpeg', now() + interval '1 hour', now()
from (values ('92830000-0000-4000-8000-000000000001', 'identidade.jpg', repeat('1', 64)),
             ('92830000-0000-4000-8000-000000000002', 'comprovante.jpg', repeat('2', 64))) as x (id, name, sha);
insert into public.case_documents (org_id, case_id, party_id, file_id, kind, source, status, decided_at) values
  ('b2830000-0000-4000-8000-00000000000a', 'd2830000-0000-4000-8000-000000000001', 'f2830000-0000-4000-8000-000000000001',
   '92830000-0000-4000-8000-000000000001', 'identity', 'whatsapp', 'accepted', now()),
  ('b2830000-0000-4000-8000-00000000000a', 'd2830000-0000-4000-8000-000000000001', 'f2830000-0000-4000-8000-000000000001',
   '92830000-0000-4000-8000-000000000002', 'address_proof', 'whatsapp', 'accepted', now());
-- Firm A's conversation with the passenger, inside the 24 hours.
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, last_inbound_at, chat_step) values
  ('82830000-0000-4000-8000-00000000000a', 'b2830000-0000-4000-8000-00000000000a',
   (select n.id from public.wa_numbers n where n.org_id = 'b2830000-0000-4000-8000-00000000000a'),
   '5500988882831', now() - interval '1 hour', '{}'::jsonb);
insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at) values
  ('b2830000-0000-4000-8000-00000000000a', 'd2830000-0000-4000-8000-000000000001', 'e2830000-0000-4000-8000-000000000001',
   encode(sha256(convert_to('token-da-nidia-contato-1234567890', 'UTF8')), 'hex'), now() + interval '30 days');

-- Who has the case, ONE having already looked at it: what it waits for is the subject here, not ONE's next look.
create function pg_temp.standing(firm uuid, target uuid) returns text language sql as $$
  update public.case_advances set woken_at = null, checked_at = now() where case_id = target;
  select s.holder || ' ' || coalesce(s.why, 'nada') from public.case_standing(firm, null, null) s where s.case_id = target;
$$;

-- ---------- The rule ----------

select ok(public.case_asks_contact('d2830000-0000-4000-8000-000000000001'),
  'before any lawsuit, a passenger who lives in São Paulo goes to a court whose screen asks the contact');
select ok(not public.case_asks_contact('d2830000-0000-4000-8000-000000000002'),
  'one who lives in Goiás goes to a court whose screen asks nothing of it');

select set_config('request.jwt.claims', '{"sub":"a2830000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select throws_ok($$select public.case_asks_contact_of('d2830000-0000-4000-8000-000000000001')$$, 'P0002', null,
  'another firm reads nothing of the case');
reset role;

-- ---------- What the case lacks, and who asks it ----------

-- Ana Souza, of firm A, reads the case screen.
select set_config('request.jwt.claims', '{"sub":"a2830000-0000-4000-8000-000000000001","role":"authenticated"}', true);
select ok(public.case_asks_contact_of('d2830000-0000-4000-8000-000000000001'), 'the case screen reads the rule');
select is(pg_temp.standing('b2830000-0000-4000-8000-00000000000a', 'd2830000-0000-4000-8000-000000000001'), 'one data',
  'the e-mail nobody asked yet is ONE''s to ask in the chat');
select is((select public.conversation_person_data(c) ->> 'asks_contact' from public.wa_conversations c
           where c.id = '82830000-0000-4000-8000-00000000000a'), 'true',
  'the chat''s check knows the court asks it');

update public.wa_conversations set chat_step = '{"step": "email"}' where id = '82830000-0000-4000-8000-00000000000a';
select is(public.case_data_in_chat('d2830000-0000-4000-8000-000000000001') ->> 'state', 'asked',
  'ONE asked the e-mail: it waits for the answer');
select is(pg_temp.standing('b2830000-0000-4000-8000-00000000000a', 'd2830000-0000-4000-8000-000000000001'), 'client lacks',
  'once asked, the client answers it');

update public.people set email = 'nidia@exemplo.invalid' where id = 'e2830000-0000-4000-8000-000000000001';
select ok(pg_temp.standing('b2830000-0000-4000-8000-00000000000a', 'd2830000-0000-4000-8000-000000000001')
          not in ('one data', 'client lacks'), 'with the e-mail given, the case lacks nothing of her');
update public.people set email = null where id = 'e2830000-0000-4000-8000-000000000001';

-- The client's link says the court asks it.
select is(public.client_link_open('token-da-nidia-contato-1234567890') -> 'case' ->> 'asks_contact', 'true',
  'the link asks the e-mail and the mobile as data the case lacks');

-- ---------- By the lawsuits, once there are any ----------

insert into public.proceedings (id, org_id, case_id, kind, court, comarca, status) values
  ('72830000-0000-4000-8000-000000000001', 'b2830000-0000-4000-8000-00000000000a', 'd2830000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'Goiânia', 'planned');
update public.proceedings set system = 'projudi' where id = '72830000-0000-4000-8000-000000000001';
select ok(not public.case_asks_contact('d2830000-0000-4000-8000-000000000001'),
  'a lawsuit planned at a screen that asks nothing asks nothing, wherever the client lives');
update public.proceedings set court = 'TJSP', comarca = 'São Paulo', system = 'eproc'
where id = '72830000-0000-4000-8000-000000000001';
select ok(public.case_asks_contact('d2830000-0000-4000-8000-000000000001'),
  'one planned at the eproc of TJSP asks it');
update public.cases set status = 'drafting' where id = 'd2830000-0000-4000-8000-000000000001';
select ok(not public.case_asks_contact('d2830000-0000-4000-8000-000000000001'),
  'once the case left the client, nothing more is asked of them');

select * from finish();
rollback;
