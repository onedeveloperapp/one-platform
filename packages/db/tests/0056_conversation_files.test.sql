begin;
create extension if not exists pgtap;
select plan(14);

-- ============================================================
-- A file the passenger sends in the conversation joins their case (0050):
-- ONE's turn waits for a file on its way; the files of a turn are listed
-- once; a paper joins the case being gathered, of the claimant whose name it
-- carries, of the passenger or of nobody in particular as the papers a case
-- needs say; an audio joins it as the passenger's account; each is told in
-- the case's timeline and in the conversation as ONE's; a file with no case
-- being gathered, or set aside, stays for a person. Two firms.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a5600000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-arquivos.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a5600000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-arquivos.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b5600000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-arquivos', 'a5600000-0000-4000-8000-000000000001'),
  ('b5600000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-arquivos', 'a5600000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b5600000-0000-4000-8000-00000000000a', 'a5600000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b5600000-0000-4000-8000-00000000000b', 'a5600000-0000-4000-8000-000000000004', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c5600000-0000-4000-8000-00000000000a', 'b5600000-0000-4000-8000-00000000000a', 'whatsapp', 'files-waba-a', 'Chat de teste',
   'connected', 'a5600000-0000-4000-8000-000000000001', now()),
  ('c5600000-0000-4000-8000-00000000000b', 'b5600000-0000-4000-8000-00000000000b', 'whatsapp', 'files-waba-b', 'Chat de teste',
   'connected', 'a5600000-0000-4000-8000-000000000004', now());

-- ONE answers at once here: a test is one transaction, and every message in it is of the same moment.
update public.platform_settings set value = value || '{"debounce_seconds": 0}'::jsonb where key = 'conversation_agent';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.trip(firm uuid, label text) returns uuid language sql as
$$ select t.id from public.tracked_trips t where t.org_id = trip.firm and t.label = trip.label; $$;
create function pg_temp.told(firm uuid, label text, kind text, delay integer) returns uuid language plpgsql as $$
declare
  alert uuid;
  claim integer;
begin
  alert := (public.record_flight_alert(pg_temp.trip(firm, label), kind, 1, delay, 'flight-problem-v1') ->> 'alert_id')::uuid;
  claim := ((public.claim_flight_alerts(1, alert) -> 0) ->> 'claim')::integer;
  perform public.reserve_flight_alert(alert, claim,
    array['Nome', 'Escritório', 'Voo de teste de hoje', 'teve um problema', 'oferecer outro voo']);
  return alert;
end;
$$;
-- The passenger writes, or sends a file, from their mobile to the firm's test number.
create function pg_temp.writes(firm uuid, phone text, kind text, body text, media jsonb default null) returns jsonb
language plpgsql as $$
declare
  number uuid := (select n.id from public.wa_numbers n where n.org_id = firm and n.provider = 'test');
begin
  return public.wa_ingest_inbound(firm, number, phone, 'Passageiro', 'test.in.' || gen_random_uuid(), kind, body, media);
end;
$$;
-- The backend brought a file into the firm's files.
create function pg_temp.stored(firm uuid, message uuid, mime text, name text) returns uuid language plpgsql as $$
declare
  file uuid := gen_random_uuid();
begin
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
                            detected_mime, expires_at, confirmed_at)
  values (file, firm, 'whatsapp', 'org/' || firm || '/whatsapp/' || file, name, mime, 100, 'stored', repeat('c', 64), 100,
          mime, now() + interval '1 hour', now());
  perform public.set_wa_media(firm, message, file, null);
  return file;
end;
$$;
create function pg_temp.claim(conversation uuid) returns integer language sql as $$
  select ((public.claim_conversation_turns(1, conversation) -> 0) ->> 'claim')::integer;
$$;
create function pg_temp.joins(conversation uuid, claim integer, message uuid, kind text, name text default null) returns jsonb
language sql as $$
  select public.one_join_conversation_media(conversation, claim, message, kind, name);
$$;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b5600000-0000-4000-8000-00000000000a',
  'c5600000-0000-4000-8000-00000000000a', 'test', 'files-number-a', 'files-waba-a', '5500900000061', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b5600000-0000-4000-8000-00000000000b',
  'c5600000-0000-4000-8000-00000000000b', 'test', 'files-number-b', 'files-waba-b', '5500900000062', 'Rocha Advocacia', 'cloud'));
insert into res values ('chat_a', public.start_test_chat('b5600000-0000-4000-8000-00000000000a',
  pg_temp.got('number_a', 'number_id')::uuid, repeat('a', 43), 'a5600000-0000-4000-8000-000000000001'));
insert into res values ('chat_b', public.start_test_chat('b5600000-0000-4000-8000-00000000000b',
  pg_temp.got('number_b', 'number_id')::uuid, repeat('b', 43), 'a5600000-0000-4000-8000-000000000004'));

-- Rafael's family flight lands six hours late, he taps SIM and the case opens with his daughter Laura.
insert into res values ('rafael_alert', jsonb_build_object('id', pg_temp.told('b5600000-0000-4000-8000-00000000000a', 'familia', 'delayed', 360)));
update public.tracked_legs set status = 'delayed', estimated_arrival_local = scheduled_arrival_local + interval '6 hours'
where trip_id = pg_temp.trip('b5600000-0000-4000-8000-00000000000a', 'familia');
insert into res values ('rafael', pg_temp.writes('b5600000-0000-4000-8000-00000000000a', '5500988880002', 'button', 'SIM'));
insert into res values ('rafael_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('rafael', 'conversation_id')::uuid)));
insert into res values ('rafael_case', public.one_open_case_from_alert(pg_temp.got('rafael', 'conversation_id')::uuid,
  pg_temp.got('rafael_claim', 'claim')::integer, pg_temp.got('rafael_alert', 'id')::uuid, repeat('e', 64), 'Caso {caso}'));
insert into res values ('rafael_done', public.record_conversation_turn(pg_temp.got('rafael', 'conversation_id')::uuid,
  pg_temp.got('rafael_claim', 'claim')::integer, now()));

-- He sends four files at once: Laura's identity, the boarding pass, a voice note and one the backend could not bring.
update public.wa_conversations set one_through = now() - interval '1 minute'
where id = pg_temp.got('rafael', 'conversation_id')::uuid;
insert into res values ('photo', pg_temp.writes('b5600000-0000-4000-8000-00000000000a', '5500988880002', 'image', null,
  '{"id": "test-media-1", "mime_type": "image/jpeg"}'));
insert into res values ('pass', pg_temp.writes('b5600000-0000-4000-8000-00000000000a', '5500988880002', 'document', null,
  '{"id": "test-media-2", "mime_type": "application/pdf", "filename": "cartao.pdf"}'));
insert into res values ('voice', pg_temp.writes('b5600000-0000-4000-8000-00000000000a', '5500988880002', 'audio', null,
  '{"id": "test-media-3", "mime_type": "audio/ogg"}'));
insert into res values ('lost', pg_temp.writes('b5600000-0000-4000-8000-00000000000a', '5500988880002', 'video', null,
  '{"id": "test-media-4", "mime_type": "video/mp4"}'));
-- The turn waits while a file is on its way.
insert into res values ('waiting', jsonb_build_object('items',
  public.claim_conversation_turns(1, pg_temp.got('rafael', 'conversation_id')::uuid)));
select pg_temp.stored('b5600000-0000-4000-8000-00000000000a', pg_temp.got('photo', 'message_id')::uuid, 'image/jpeg', 'foto.jpg');
select pg_temp.stored('b5600000-0000-4000-8000-00000000000a', pg_temp.got('pass', 'message_id')::uuid, 'application/pdf', 'cartao.pdf');
select pg_temp.stored('b5600000-0000-4000-8000-00000000000a', pg_temp.got('voice', 'message_id')::uuid, 'audio/ogg', 'audio.ogg');
select public.set_wa_media('b5600000-0000-4000-8000-00000000000a', pg_temp.got('lost', 'message_id')::uuid, null, 'too_large');
insert into res values ('files_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('rafael', 'conversation_id')::uuid)));
insert into res values ('files', public.conversation_media_to_join(pg_temp.got('rafael', 'conversation_id')::uuid,
  pg_temp.got('files_claim', 'claim')::integer));
insert into res values ('join_photo', pg_temp.joins(pg_temp.got('rafael', 'conversation_id')::uuid,
  pg_temp.got('files_claim', 'claim')::integer, pg_temp.got('photo', 'message_id')::uuid, 'identity', 'LAURA TESTE'));
insert into res values ('join_pass', pg_temp.joins(pg_temp.got('rafael', 'conversation_id')::uuid,
  pg_temp.got('files_claim', 'claim')::integer, pg_temp.got('pass', 'message_id')::uuid, 'boarding_pass', 'Rafael Teste'));
insert into res values ('join_voice', pg_temp.joins(pg_temp.got('rafael', 'conversation_id')::uuid,
  pg_temp.got('files_claim', 'claim')::integer, pg_temp.got('voice', 'message_id')::uuid, 'statement'));
insert into res values ('join_lost', pg_temp.joins(pg_temp.got('rafael', 'conversation_id')::uuid,
  pg_temp.got('files_claim', 'claim')::integer, pg_temp.got('lost', 'message_id')::uuid, 'left'));
insert into res values ('join_again', pg_temp.joins(pg_temp.got('rafael', 'conversation_id')::uuid,
  pg_temp.got('files_claim', 'claim')::integer, pg_temp.got('photo', 'message_id')::uuid, 'identity', 'Laura Teste'));
insert into res values ('voice_as_paper', pg_temp.joins(pg_temp.got('rafael', 'conversation_id')::uuid,
  pg_temp.got('files_claim', 'claim')::integer, pg_temp.got('voice', 'message_id')::uuid, 'other'));
insert into res values ('wrong_claim', public.conversation_media_to_join(pg_temp.got('rafael', 'conversation_id')::uuid,
  pg_temp.got('files_claim', 'claim')::integer + 1));
insert into res values ('files_after', public.conversation_media_to_join(pg_temp.got('rafael', 'conversation_id')::uuid,
  pg_temp.got('files_claim', 'claim')::integer));

-- An identity with no name ONE could match is the passenger's own.
insert into res values ('own', pg_temp.writes('b5600000-0000-4000-8000-00000000000a', '5500988880002', 'image', null,
  '{"id": "test-media-5", "mime_type": "image/jpeg"}'));
select pg_temp.stored('b5600000-0000-4000-8000-00000000000a', pg_temp.got('own', 'message_id')::uuid, 'image/jpeg', 'rg.jpg');
insert into res values ('join_own', pg_temp.joins(pg_temp.got('rafael', 'conversation_id')::uuid,
  pg_temp.got('files_claim', 'claim')::integer, pg_temp.got('own', 'message_id')::uuid, 'identity', ''));

-- Pedro never said yes: his file has no case being gathered to join.
insert into res values ('pedro', pg_temp.writes('b5600000-0000-4000-8000-00000000000a', '5500988880004', 'image', null,
  '{"id": "test-media-6", "mime_type": "image/jpeg"}'));
select pg_temp.stored('b5600000-0000-4000-8000-00000000000a', pg_temp.got('pedro', 'message_id')::uuid, 'image/jpeg', 'foto.jpg');
insert into res values ('pedro_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('pedro', 'conversation_id')::uuid)));
insert into res values ('join_pedro', pg_temp.joins(pg_temp.got('pedro', 'conversation_id')::uuid,
  pg_temp.got('pedro_claim', 'claim')::integer, pg_temp.got('pedro', 'message_id')::uuid, 'evidence'));

-- Another firm's passenger, and a message of another firm named in this conversation.
insert into res values ('other', pg_temp.writes('b5600000-0000-4000-8000-00000000000b', '5500988880002', 'image', null,
  '{"id": "test-media-7", "mime_type": "image/jpeg"}'));
select pg_temp.stored('b5600000-0000-4000-8000-00000000000b', pg_temp.got('other', 'message_id')::uuid, 'image/jpeg', 'foto.jpg');
insert into res values ('cross', pg_temp.joins(pg_temp.got('rafael', 'conversation_id')::uuid,
  pg_temp.got('files_claim', 'claim')::integer, pg_temp.got('other', 'message_id')::uuid, 'identity', 'Rafael Teste'));
reset role;

-- A person cannot join a file as ONE.
select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'a5600000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select throws_ok(
  format('select public.one_join_conversation_media(%L, 1, %L, %L)',
    pg_temp.got('rafael', 'conversation_id'), pg_temp.got('photo', 'message_id'), 'identity'),
  '42501', null, 'only the backend joins a file of a conversation to a case'
);
reset role;

select ok(
  jsonb_array_length((select payload -> 'items' from res where name = 'waiting')) = 0
  and pg_temp.got('files_claim', 'claim') is not null,
  'ONE''s turn waits while a file is on its way, and takes it once the file arrived'
);

select ok(
  -- (A test is one moment: the files came at the same time, so they are compared as a set.)
  (select array_agg(item ->> 'kind' || ':' || (item ->> 'state') order by item ->> 'kind')
   from res, jsonb_array_elements(payload -> 'items') as x (item) where name = 'files')
    = array['audio:stored', 'document:stored', 'image:stored', 'video:failed']
  and (select item ->> 'mime' from res, jsonb_array_elements(payload -> 'items') as x (item)
       where name = 'files' and item ->> 'kind' = 'document') = 'application/pdf'
  and pg_temp.got('wrong_claim', 'code') = 'not_working'
  and jsonb_array_length((select payload -> 'items' from res where name = 'files_after')) = 0,
  'a turn reads the files the passenger sent since ONE last answered, in order, each once, and only under its claim'
);

select ok(
  pg_temp.got('join_photo', 'code') = 'document'
  and (select p.full_name = 'Laura Teste' from public.case_parties cp join public.people p on p.id = cp.person_id
       where cp.id = pg_temp.got('join_photo', 'party_id')::uuid)
  and (select d.kind = 'identity' and d.source = 'whatsapp' and d.status = 'received' and d.processing = 'pending'
       from public.case_documents d where d.id = pg_temp.got('join_photo', 'document_id')::uuid),
  'an identity joins the case of the claimant whose name it carries, waiting for the check as one sent by the link'
);

select ok(
  pg_temp.got('join_pass', 'code') = 'document' and pg_temp.got('join_pass', 'party_id') is null
  and pg_temp.got('join_own', 'code') = 'document'
  and (select p.full_name = 'Rafael Teste' from public.case_parties cp join public.people p on p.id = cp.person_id
       where cp.id = pg_temp.got('join_own', 'party_id')::uuid),
  'a paper of the trip is of nobody in particular, and an identity with no name matched is the passenger''s'
);

select ok(
  pg_temp.got('join_voice', 'code') = 'statement'
  and (select s.source = 'whatsapp' and s.work = 'transcribe' and s.status = 'received'
              and s.audio_file_id = (select m.media_file_id from public.wa_messages m
                                     where m.id = pg_temp.got('voice', 'message_id')::uuid)
              and (select p.full_name from public.case_parties cp join public.people p on p.id = cp.person_id
                   where cp.id = s.party_id) = 'Rafael Teste'
       from public.case_statements s where s.id = pg_temp.got('join_voice', 'statement_id')::uuid),
  'an audio joins the case as the passenger''s account of what happened, to be transcribed'
);

select ok(
  (select count(*) = 4 from public.case_events e
   where e.case_id = pg_temp.got('rafael_case', 'case_id')::uuid and e.actor_type = 'system'
     and e.kind in ('document_added', 'statement_added'))
  and (select array_agg(e.kind order by e.kind) from public.wa_conversation_events e
       where e.conversation_id = pg_temp.got('rafael', 'conversation_id')::uuid
         and e.kind in ('document_joined', 'statement_joined'))
      = array['document_joined', 'document_joined', 'document_joined', 'statement_joined']
  and (select e.data ->> 'seq' = pg_temp.got('rafael_case', 'seq') from public.wa_conversation_events e
       where e.conversation_id = pg_temp.got('rafael', 'conversation_id')::uuid and e.kind = 'statement_joined'),
  'each file is told in the case''s timeline and in the conversation as ONE''s'
);

select ok(
  pg_temp.got('join_again', 'code') = 'already' and pg_temp.got('join_again', 'join') = 'document'
  and pg_temp.got('voice_as_paper', 'code') = 'already'
  and (select count(*) = 1 from public.case_documents d
       where d.file_id = (select m.media_file_id from public.wa_messages m where m.id = pg_temp.got('photo', 'message_id')::uuid)),
  'a file joins once'
);

select ok(
  pg_temp.got('join_lost', 'code') = 'left'
  and (select m.case_join = 'left' and m.case_join_at is not null from public.wa_messages m
       where m.id = pg_temp.got('lost', 'message_id')::uuid),
  'a file the backend could not bring is set aside for a person'
);

select ok(
  pg_temp.got('join_pedro', 'code') = 'no_case'
  and (select m.case_join = 'no_case' from public.wa_messages m where m.id = pg_temp.got('pedro', 'message_id')::uuid)
  and not exists (select 1 from public.case_documents d where d.org_id = 'b5600000-0000-4000-8000-00000000000a'
                  and d.file_id = (select m.media_file_id from public.wa_messages m
                                   where m.id = pg_temp.got('pedro', 'message_id')::uuid)),
  'a passenger with no case being gathered keeps the file in the conversation'
);

select ok(
  pg_temp.got('cross', 'code') = 'message_not_found'
  and (select m.case_join is null from public.wa_messages m where m.id = pg_temp.got('other', 'message_id')::uuid)
  and not exists (select 1 from public.case_documents d where d.org_id = 'b5600000-0000-4000-8000-00000000000b'),
  'a message of another firm never joins a case through this conversation'
);

-- What a file joined to is the firm's to read, and only the firm's.
select set_config('request.jwt.claims',
  jsonb_build_object('sub', 'a5600000-0000-4000-8000-000000000004', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
select is(
  (select count(*)::integer from public.wa_conversation_events e
   where e.conversation_id = pg_temp.got('rafael', 'conversation_id')::uuid),
  0, 'another firm reads nothing of what ONE did in this conversation'
);
reset role;

select ok(
  exists (select 1 from public.prompt_versions v where v.task = 'atendimento.arquivo.tipo' and v.is_active
          and v.model = 'claude-haiku-5-5' and v.output_schema -> 'properties' -> 'tipo' -> 'enum' ? 'boarding_pass')
  and (select t.autonomy = 'autonomous' and not t.shadow from public.ai_tasks t where t.slug = 'atendimento.arquivo.tipo')
  and not exists (select 1 from public.autonomy_decisions d where d.task = 'atendimento.arquivo.tipo'),
  'a task says what paper a file is, and decides nothing'
);

select ok(
  (select (value ->> 'media_wait_minutes')::integer = 3 from public.platform_settings where key = 'conversation_agent'),
  'how long a turn waits for a file on its way is a setting'
);

select * from finish();
rollback;
