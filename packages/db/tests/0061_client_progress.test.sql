begin;
create extension if not exists pgtap;
select plan(11);

-- ============================================================
-- What the passenger is told of their case's course (0055): once they said,
-- on their own link, that they sent everything, that it arrived and what
-- comes next (the power of attorney to sign, when one ONE sent waits for
-- them), said by ONE in their conversation at once where it can, and by the
-- firm's template otherwise, never both; and that their lawsuit was filed,
-- once a person marked it so (never one that came in as filed). The test chat
-- turns every kind on. Two firms: nothing of one reaches the other.
--
-- Every person, firm, number and lawsuit here is invented: the lawsuits are
-- of a year to come, the phones of an area code no carrier has.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a6100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@progresso.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a6100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@progresso.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b6100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-progresso', 'a6100000-0000-4000-8000-000000000001'),
  ('b6100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-progresso', 'a6100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b6100000-0000-4000-8000-00000000000a', 'a6100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b6100000-0000-4000-8000-00000000000b', 'a6100000-0000-4000-8000-000000000004', 'owner', 'socio');
insert into public.oab_registrations (user_id, uf, number, kind) values
  ('a6100000-0000-4000-8000-000000000001', 'GO', '61001', 'principal'),
  ('a6100000-0000-4000-8000-000000000004', 'GO', '61004', 'principal');
insert into public.firm_signers (org_id, user_id, added_by) values
  ('b6100000-0000-4000-8000-00000000000a', 'a6100000-0000-4000-8000-000000000001', 'a6100000-0000-4000-8000-000000000001'),
  ('b6100000-0000-4000-8000-00000000000b', 'a6100000-0000-4000-8000-000000000004', 'a6100000-0000-4000-8000-000000000004');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c6100000-0000-4000-8000-00000000000a', 'b6100000-0000-4000-8000-00000000000a', 'whatsapp', 'test-waba-pa', 'Chat de teste',
   'connected', 'a6100000-0000-4000-8000-000000000001', now()),
  ('c6100000-0000-4000-8000-00000000000b', 'b6100000-0000-4000-8000-00000000000b', 'whatsapp', 'test-waba-pb', 'Chat de teste',
   'connected', 'a6100000-0000-4000-8000-000000000004', now());

-- Notices go at any hour in this file, and with no wait after a write (a test is one transaction).
update public.platform_settings set value = value || '{"send_from_hour": 0, "send_until_hour": 24, "settle_minutes": 0}'::jsonb
where key = 'notices';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_client() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"anon"}', true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.hash(token text) returns text language sql as
$$ select encode(sha256(convert_to(token, 'UTF8')), 'hex'); $$;
-- A cancellation of an adult of Goiânia with every fact a paper writes, a leg of the trip, a phone and a link.
create function pg_temp.full_case(org uuid, name text, cpf text, phone text, token text)
returns jsonb language plpgsql as $$
declare
  made jsonb := public.create_case(org, 'cancellation', 'LA', date '2026-10-24', jsonb_build_object(
    'full_name', name, 'cpf', cpf, 'birth_date', '1990-05-02', 'nationality', 'brasileira', 'phone', phone,
    'marital_status', 'solteiro', 'profession', 'Professora', 'street', 'Rua das Flores', 'address_number', '10',
    'district', 'Centro', 'city', 'Goiânia', 'uf', 'GO', 'postal_code', '74000000'));
begin
  perform public.save_flight_segment((made ->> 'case_id')::uuid, null,
    '{"flight_number": "LA3456", "origin_iata": "GRU", "destination_iata": "REC", "affected": true}'::jsonb);
  perform public.create_client_link((made ->> 'case_id')::uuid, (made ->> 'person_id')::uuid, pg_temp.hash(token));
  return made;
end;
$$;
create function pg_temp.claim(target uuid) returns jsonb language sql as $$
  select coalesce((public.claim_case_advances(1, target) -> 'claimed') -> 0, '{}'::jsonb);
$$;
create function pg_temp.cnj(n integer) returns text language sql as $$
  select lpad(n::text, 7, '0')
    || lpad((98 - ((lpad(n::text, 7, '0') || '2099809' || '0051')::numeric * 100 % 97))::text, 2, '0')
    || '2099809' || '0051';
$$;
-- A small-claims lawsuit of a case in Goiânia, with its claimant: planned, or filed long before (a spreadsheet's).
create function pg_temp.lawsuit(org uuid, made jsonb, status text, n integer) returns uuid language plpgsql as $$
declare
  lawsuit uuid;
begin
  insert into public.proceedings (org_id, case_id, kind, court, comarca, status, cnj, filed_at)
  values (org, (made ->> 'case_id')::uuid, 'juizado', 'TJGO', 'Goiânia', status,
          case when status = 'planned' then null else pg_temp.cnj(n) end,
          case when status = 'planned' then null else current_date - 300 end)
  returning id into lawsuit;
  insert into public.proceeding_parties (proceeding_id, party_id, org_id) values (lawsuit, (made ->> 'party_id')::uuid, org);
  return lawsuit;
end;
$$;
create function pg_temp.candidates(firm uuid) returns jsonb language sql as $$
  select coalesce(jsonb_agg(jsonb_build_object('kind', c.kind, 'person_id', c.person_id, 'params', to_jsonb(c.params),
                                               'blocker', c.blocker) order by c.kind), '[]'::jsonb)
  from public.notice_candidates(firm, null) c
  where c.kind in ('case_received', 'lawsuit_filed');
$$;

-- Each firm's test chat: its number, and every kind of notice approved and on.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b6100000-0000-4000-8000-00000000000a',
  'c6100000-0000-4000-8000-00000000000a', 'test', 'test-number-pa', 'test-waba-pa', '5500900000061', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b6100000-0000-4000-8000-00000000000b',
  'c6100000-0000-4000-8000-00000000000b', 'test', 'test-number-pb', 'test-waba-pb', '5500900000062', 'Rocha Advocacia', 'cloud'));
insert into res values ('chat_a', public.start_test_chat('b6100000-0000-4000-8000-00000000000a',
  pg_temp.got('number_a', 'number_id')::uuid, repeat('p', 43), 'a6100000-0000-4000-8000-000000000001'));
insert into res values ('chat_b', public.start_test_chat('b6100000-0000-4000-8000-00000000000b',
  pg_temp.got('number_b', 'number_id')::uuid, repeat('q', 43), 'a6100000-0000-4000-8000-000000000004'));
reset role;

-- Firm A: Mariana, who talks to ONE. Firm B: Pedro, whose conversation a person of the firm took over.
select pg_temp.sign_in('a6100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('mariana', pg_temp.full_case('b6100000-0000-4000-8000-00000000000a', 'Mariana Teste',
  '12345678909', '5500999996101', 'token-de-progresso-mariana-123456789'));
reset role;
select pg_temp.sign_in('a6100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('pedro', pg_temp.full_case('b6100000-0000-4000-8000-00000000000b', 'Pedro Teste',
  '11144477735', '5500999996104', 'token-de-progresso-pedro-1234567890'));
reset role;
insert into public.wa_conversations (org_id, number_id, contact_wa_id, last_inbound_at, last_message_at,
                                     last_message_preview, last_message_direction, unread_count, agent) values
  ('b6100000-0000-4000-8000-00000000000a', pg_temp.got('number_a', 'number_id')::uuid, '5500999996101',
   now() - interval '10 minutes', now() - interval '10 minutes', 'Pronto, enviei tudo', 'in', 1, 'one'),
  ('b6100000-0000-4000-8000-00000000000b', pg_temp.got('number_b', 'number_id')::uuid, '5500999996104',
   now() - interval '10 minutes', now() - interval '10 minutes', 'Enviei', 'in', 1, 'person');

-- ---------- The kinds, and who may call what ----------

select ok(
  (select array_agg(kind order by position) = array['hearing_change', 'hearing_reminder', 'payment_alert', 'lawsuit_update',
                                                    'document_refused', 'flight_problem', 'case_received', 'lawsuit_filed',
                                                    'case_questions', 'trip_departure', 'trip_arrival', 'welcome', 'hearing_brief', 'hearing_result']
   from public.notice_kinds)
  and (select params = array['first_name', 'firm', 'next'] from public.notice_kinds where kind = 'case_received')
  and (select params = array['first_name', 'firm', 'lawsuit', 'court'] from public.notice_kinds where kind = 'lawsuit_filed')
  and not has_function_privilege('authenticated', 'public.advance_say_received(uuid, integer, uuid, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.advance_received_people(uuid, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.case_received_owed(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.notice_next_words(uuid, uuid)', 'EXECUTE')
  and public.notice_optin_wording('client', 'Souza Advogados', '5500999996101')
      like 'Quero receber pelo WhatsApp, no número (00) 99999-6101, os avisos do meu processo enviados pelo escritório Souza Advogados: a confirmação do que enviei, o protocolo da ação, %',
  'two more kinds of notice, each with its values; only the backend says them; the words a client agrees to name them'
);

select ok(
  (select count(*) = 14 from public.firm_notice_kinds k where k.org_id = 'b6100000-0000-4000-8000-00000000000a' and k.enabled)
  and (select count(*) = 14 from public.firm_notice_kinds k where k.org_id = 'b6100000-0000-4000-8000-00000000000b' and k.enabled),
  'the test chat approves and turns on every kind, so a tester follows the whole course'
);

-- ---------- Once the client says they finished ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('owed_before', (select coalesce(jsonb_agg(r.person_id), '[]') from public.case_received_owed(pg_temp.got('mariana', 'case_id')::uuid) r));
reset role;
select pg_temp.as_client();
set local role anon;
insert into res values ('finished_mariana', public.client_link_finish('token-de-progresso-mariana-123456789'));
insert into res values ('finished_pedro', public.client_link_finish('token-de-progresso-pedro-1234567890'));
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_mariana', pg_temp.claim(pg_temp.got('mariana', 'case_id')::uuid));
insert into res values ('poa', jsonb_build_object('id', public.paper_template_for('b6100000-0000-4000-8000-00000000000a', 'procuracao')));
insert into res values ('file_mariana', public.reserve_file('b6100000-0000-4000-8000-00000000000a', 'paper', 'procuracao.pdf', 'application/pdf', 4000));
-- ONE sends the power of attorney first, in the same look.
insert into res values ('issued_mariana', public.advance_record_paper(pg_temp.got('mariana', 'case_id')::uuid,
  pg_temp.got('claim_mariana', 'claim')::integer, pg_temp.got('mariana', 'person_id')::uuid, 'procuracao',
  pg_temp.got('poa', 'id')::uuid,
  jsonb_build_object('file_id', pg_temp.got('file_mariana', 'file_id'), 'sha256', repeat('d', 64), 'bytes', 4000, 'pages', 1)));
insert into res values ('people', public.advance_received_people(pg_temp.got('mariana', 'case_id')::uuid,
  pg_temp.got('claim_mariana', 'claim')::integer));
insert into res values ('owed_b', (select coalesce(jsonb_agg(r.person_id), '[]') from public.case_received_owed(pg_temp.got('pedro', 'case_id')::uuid) r));
reset role;

select ok(
  (select payload = '[]'::jsonb from res where name = 'owed_before')
  and (pg_temp.got('claim_mariana', 'received_due'))::boolean
  and pg_temp.got('issued_mariana', 'code') = 'issued'
  and (select payload -> 'people' -> 0 ->> 'person_id' = pg_temp.got('mariana', 'person_id')
              and (payload -> 'people' -> 0 ->> 'paper_waiting')::boolean and payload ->> 'firm' = 'Souza Advogados'
       from res where name = 'people')
  -- A conversation a person of the firm holds is theirs: ONE says nothing in it.
  and (select payload = '[]'::jsonb from res where name = 'owed_b'),
  'once the client says they finished, ONE may tell them in the conversation it holds, after the papers it sends them'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('stale_claim', public.advance_say_received(pg_temp.got('mariana', 'case_id')::uuid,
  pg_temp.got('claim_mariana', 'claim')::integer + 1, pg_temp.got('mariana', 'person_id')::uuid, 'Recebi tudo.'));
insert into res values ('said', public.advance_say_received(pg_temp.got('mariana', 'case_id')::uuid,
  pg_temp.got('claim_mariana', 'claim')::integer, pg_temp.got('mariana', 'person_id')::uuid,
  'Recebi tudo o que você enviou, Mariana. O próximo passo é assinar a procuração, que já está no seu link.'));
insert into res values ('said_again', public.advance_say_received(pg_temp.got('mariana', 'case_id')::uuid,
  pg_temp.got('claim_mariana', 'claim')::integer, pg_temp.got('mariana', 'person_id')::uuid, 'De novo.'));
insert into res values ('candidates_a', pg_temp.candidates('b6100000-0000-4000-8000-00000000000a'));
insert into res values ('candidates_b', pg_temp.candidates('b6100000-0000-4000-8000-00000000000b'));
reset role;

select ok(
  pg_temp.got('stale_claim', 'code') = 'not_working'
  and pg_temp.got('said', 'code') = 'queued'
  and (select m.by_one and m.kind = 'text' and m.status = 'queued' and m.direction = 'out'
       from public.wa_messages m where m.id = pg_temp.got('said', 'message_id')::uuid)
  and (select n.kind = 'case_received' and n.params ->> 2 like 'O próximo passo é assinar a procuração%'
              and n.phone = '5500999996101'
       from public.client_notices n where n.message_id = pg_temp.got('said', 'message_id')::uuid)
  and pg_temp.got('said_again', 'code') = 'not_owed'
  -- What the client wrote last still waits for the firm's answer.
  and (select last_message_direction = 'in' from public.wa_conversations
       where org_id = 'b6100000-0000-4000-8000-00000000000a' and contact_wa_id = '5500999996101'),
  'ONE says it once, as its own message, recorded as the notice; what the client wrote still waits for the firm'
);

select ok(
  (select payload = '[]'::jsonb from res where name = 'candidates_a')
  and (select jsonb_array_length(payload) = 1
              and payload -> 0 ->> 'kind' = 'case_received'
              and payload -> 0 ->> 'person_id' = pg_temp.got('pedro', 'person_id')
              and payload -> 0 -> 'params' ->> 0 = 'Pedro'
              and payload -> 0 -> 'params' ->> 2 = 'Agora o escritório confere os documentos e prepara a ação, e avisa por aqui quando ela for protocolada.'
              and payload -> 0 ->> 'blocker' is null
       from res where name = 'candidates_b'),
  'what ONE said is never due again as a template; where ONE could not say it, the template is due, saying what comes next'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('reserved_b', public.reserve_client_notices('b6100000-0000-4000-8000-00000000000b', 50));
insert into res values ('reserved_b_again', public.reserve_client_notices('b6100000-0000-4000-8000-00000000000b', 50));
insert into res values ('reserved_a', public.reserve_client_notices('b6100000-0000-4000-8000-00000000000a', 50));
reset role;

select ok(
  (pg_temp.got('reserved_b', 'reserved'))::integer = 1
  and (select m.kind = 'template' and m.body like 'Olá, Pedro. O escritório Rocha Advocacia recebeu o seu aviso de que terminou de enviar os documentos do seu caso. Agora o escritório confere%'
       from public.wa_messages m where m.id = (select (payload -> 'messages' ->> 0)::uuid from res where name = 'reserved_b'))
  and (pg_temp.got('reserved_b_again', 'reserved'))::integer = 0
  and (pg_temp.got('reserved_a', 'reserved'))::integer = 0
  and (select count(*) = 1 from public.client_notices n where n.org_id = 'b6100000-0000-4000-8000-00000000000a')
  and (select count(*) = 1 from public.client_notices n where n.org_id = 'b6100000-0000-4000-8000-00000000000b'),
  'the template goes once, in the firm''s own words, and never beside what ONE said'
);

-- ---------- The lawsuit filed ----------

insert into res values ('planned', jsonb_build_object('id',
  pg_temp.lawsuit('b6100000-0000-4000-8000-00000000000a', (select payload from res where name = 'mariana'), 'planned', 0)));
insert into res values ('imported', jsonb_build_object('id',
  pg_temp.lawsuit('b6100000-0000-4000-8000-00000000000b', (select payload from res where name = 'pedro'), 'filed', 7)));
update public.proceedings set status = 'filed', cnj = pg_temp.cnj(61), filed_at = current_date
where id = pg_temp.got('planned', 'id')::uuid;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('filed_a', pg_temp.candidates('b6100000-0000-4000-8000-00000000000a'));
insert into res values ('filed_b', pg_temp.candidates('b6100000-0000-4000-8000-00000000000b'));
reset role;

select ok(
  (select filed_marked_at is not null from public.proceedings where id = pg_temp.got('planned', 'id')::uuid)
  and (select jsonb_array_length(payload) = 1 and payload -> 0 ->> 'kind' = 'lawsuit_filed'
              and payload -> 0 -> 'params' = jsonb_build_array('Mariana', 'Souza Advogados',
                public.cnj_formatted(pg_temp.cnj(61)), 'no Juizado Especial Cível de Goiânia, no TJGO')
       from res where name = 'filed_a')
  and (select payload = '[]'::jsonb from res where name = 'filed_b'),
  'a lawsuit recorded filed is told, with its number and where it runs; one filed long before (a spreadsheet''s) is not'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('told_filed', public.reserve_client_notices('b6100000-0000-4000-8000-00000000000a', 50));
insert into res values ('told_filed_again', public.reserve_client_notices('b6100000-0000-4000-8000-00000000000a', 50));
reset role;

select ok(
  (pg_temp.got('told_filed', 'reserved'))::integer = 1
  and (select m.body like 'Olá, Mariana. O escritório Souza Advogados informa que a sua ação foi protocolada: processo nº %, no Juizado Especial Cível de Goiânia, no TJGO. Você acompanha o andamento pelo link do seu caso%'
       from public.wa_messages m where m.id = (select (payload -> 'messages' ->> 0)::uuid from res where name = 'told_filed'))
  and (pg_temp.got('told_filed_again', 'reserved'))::integer = 0
  and (select count(*) = 2 from public.client_notices n where n.org_id = 'b6100000-0000-4000-8000-00000000000a'),
  'the client is told once that their lawsuit was filed'
);

-- ---------- What keeps a word from going ----------

-- A client of firm B who asked to stop is told nothing, by ONE or by a template; nor is one whose days passed.
select pg_temp.sign_in('a6100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('rui', pg_temp.full_case('b6100000-0000-4000-8000-00000000000b', 'Rui Teste',
  '52998224725', '5500999996105', 'token-de-progresso-rui-12345678901'));
insert into res values ('lia', pg_temp.full_case('b6100000-0000-4000-8000-00000000000b', 'Lia Teste',
  '11144477735', '5500999996106', 'token-de-progresso-lia-123456789012'));
reset role;
insert into public.wa_conversations (org_id, number_id, contact_wa_id, last_inbound_at, last_message_at,
                                     last_message_preview, last_message_direction, unread_count, agent) values
  ('b6100000-0000-4000-8000-00000000000b', pg_temp.got('number_b', 'number_id')::uuid, '5500999996105',
   now() - interval '5 minutes', now() - interval '5 minutes', 'SAIR', 'in', 1, 'one'),
  ('b6100000-0000-4000-8000-00000000000b', pg_temp.got('number_b', 'number_id')::uuid, '5500999996106',
   now() - interval '5 minutes', now() - interval '5 minutes', 'Terminei', 'in', 1, 'one');
insert into public.wa_optouts (org_id, contact_wa_id, source) values
  ('b6100000-0000-4000-8000-00000000000b', '5500999996105', 'keyword');
select pg_temp.as_client();
set local role anon;
insert into res values ('finished_rui', public.client_link_finish('token-de-progresso-rui-12345678901'));
insert into res values ('finished_lia', public.client_link_finish('token-de-progresso-lia-123456789012'));
reset role;
-- Lia finished four days ago: past the setting's three.
update public.client_links set finished_at = now() - interval '4 days'
where case_id = pg_temp.got('lia', 'case_id')::uuid;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('owed_rui', (select coalesce(jsonb_agg(r.person_id), '[]') from public.case_received_owed(pg_temp.got('rui', 'case_id')::uuid) r));
insert into res values ('owed_lia', (select coalesce(jsonb_agg(r.person_id), '[]') from public.case_received_owed(pg_temp.got('lia', 'case_id')::uuid) r));
insert into res values ('late_b', (select coalesce(jsonb_agg(jsonb_build_object('person', c.person_id, 'blocker', c.blocker)), '[]')
  from public.notice_candidates('b6100000-0000-4000-8000-00000000000b', null) c where c.kind = 'case_received'));
reset role;

select ok(
  (select payload = '[]'::jsonb from res where name = 'owed_rui')
  and (select payload = '[]'::jsonb from res where name = 'owed_lia')
  and (select jsonb_array_length(payload) = 1 and payload -> 0 ->> 'person' = pg_temp.got('rui', 'person_id')
              and payload -> 0 ->> 'blocker' = 'opted_out'
       from res where name = 'late_b'),
  'who asked to stop is told nothing, and the word goes only in the days after the client finished'
);

-- A firm that keeps its answers to clients to a person: ONE says nothing by itself in a conversation.
select pg_temp.sign_in('a6100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_firm_autonomy('b6100000-0000-4000-8000-00000000000a', 'reply_client', 'approval');
insert into res values ('ivo', pg_temp.full_case('b6100000-0000-4000-8000-00000000000a', 'Ivo Teste',
  '52998224725', '5500999996107', 'token-de-progresso-ivo-123456789012'));
reset role;
insert into public.wa_conversations (org_id, number_id, contact_wa_id, last_inbound_at, last_message_at,
                                     last_message_preview, last_message_direction, unread_count, agent) values
  ('b6100000-0000-4000-8000-00000000000a', pg_temp.got('number_a', 'number_id')::uuid, '5500999996107',
   now() - interval '5 minutes', now() - interval '5 minutes', 'Terminei', 'in', 1, 'one');
select pg_temp.as_client();
set local role anon;
insert into res values ('finished_ivo', public.client_link_finish('token-de-progresso-ivo-123456789012'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('owed_ivo', (select coalesce(jsonb_agg(r.person_id), '[]') from public.case_received_owed(pg_temp.got('ivo', 'case_id')::uuid) r));
insert into res values ('claim_ivo', pg_temp.claim(pg_temp.got('ivo', 'case_id')::uuid));
reset role;

select ok(
  (select payload = '[]'::jsonb from res where name = 'owed_ivo')
  and not coalesce((pg_temp.got('claim_ivo', 'received_due'))::boolean, false),
  'where a person answers the firm''s clients, ONE says nothing by itself in the conversation'
);

select is(
  (select count(*)::integer from public.client_notices n
   where n.org_id = 'b6100000-0000-4000-8000-00000000000b'
     and n.person_id in (pg_temp.got('mariana', 'person_id')::uuid, pg_temp.got('ivo', 'person_id')::uuid)),
  0,
  'nothing of one firm''s clients is told by the other'
);

select * from finish();
rollback;
