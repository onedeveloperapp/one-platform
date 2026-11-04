begin;
create extension if not exists pgtap;
select plan(11);

-- ============================================================
-- The client's notices go with no agreement asked (0088). Whoever a lawsuit
-- tells is told at the WhatsApp the firm has for them, unless they asked to
-- stop: on their link, to a person of the firm (who records how), or with
-- SAIR. A request to stop holds for the person whatever their number, until
-- they ask to be told again; every request stays on record. Two firms:
-- nothing of one reaches the other.
--
-- Every person, firm and number here is invented: the phones are of an area
-- code no carrier has.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a9100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@semaceite.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a9100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@semaceite.invalid', '', now(), '{}', '{"display_name":"Bia Prado"}', now(), now()),
  ('a9100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@semaceite.invalid', '', now(), '{}', '{"display_name":"Caio Prado"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b9100000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-sem-aceite', 'a9100000-0000-4000-8000-000000000001'),
  ('b9100000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-sem-aceite', 'a9100000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b9100000-0000-4000-8000-00000000000a', 'a9100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b9100000-0000-4000-8000-00000000000a', 'a9100000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b9100000-0000-4000-8000-00000000000b', 'a9100000-0000-4000-8000-000000000003', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- Firm A: Ana Teste holds a case with Bento Teste, who flew with her. Firm B: a case of its own.
select pg_temp.sign_in('a9100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('b9100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-01-20',
  '{"full_name": "Ana Teste", "birth_date": "1985-04-02", "phone": "5500999991001"}'::jsonb));
insert into res values ('bento', public.save_case_person(pg_temp.got('case', 'case_id')::uuid, null,
  '{"full_name": "Bento Teste", "birth_date": "1983-03-03", "phone": "5500999991002"}'::jsonb, 'claimant'));
insert into res values ('link', public.create_client_link(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid,
  encode(sha256(convert_to('token-da-ana-0091-aaaaaaaaaaaaaaaaaaaaaaaaaa', 'UTF8')), 'hex')));
reset role;
select pg_temp.sign_in('a9100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('case_b', public.create_case('b9100000-0000-4000-8000-00000000000b', 'delay', 'AD', date '2026-01-20',
  '{"full_name": "Davi Teste", "phone": "5500999991003"}'::jsonb));
reset role;

-- ---------- What nobody writes but through the functions ----------

select ok(
  (select relrowsecurity from pg_class where oid = 'public.notice_stops'::regclass)
  and has_table_privilege('authenticated', 'public.notice_stops', 'SELECT')
  and not has_table_privilege('authenticated', 'public.notice_stops', 'INSERT')
  and not has_table_privilege('authenticated', 'public.notice_stops', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.notice_stops', 'DELETE')
  and not has_table_privilege('anon', 'public.notice_stops', 'SELECT'),
  'the requests to stop are read by the firm and written by nobody but through the functions'
);

-- ---------- Nobody is asked to agree ----------

select pg_temp.sign_in('a9100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('view', public.case_notices(pg_temp.got('case', 'case_id')::uuid));
reset role;
set local role anon;
insert into res values ('link_view', public.client_link_notices('token-da-ana-0091-aaaaaaaaaaaaaaaaaaaaaaaaaa'));
reset role;
select ok(
  public.notice_person_blocker('b9100000-0000-4000-8000-00000000000a', pg_temp.got('case', 'person_id')::uuid) is null
  and public.notice_person_blocker('b9100000-0000-4000-8000-00000000000a', pg_temp.got('bento', 'person_id')::uuid) is null
  and (select jsonb_array_length(payload -> 'people') = 2
              and not exists (select 1 from jsonb_array_elements(payload -> 'people') p
                              where jsonb_typeof(p -> 'blocker') <> 'null' or jsonb_typeof(p -> 'stop') <> 'null')
       from res where name = 'view')
  and (select payload ->> 'stopped' = 'false' and payload ->> 'agreed' = 'true' and payload ->> 'opted_out' = 'false'
              and payload ->> 'phone' = '5500999991001' and payload ->> 'firm' = 'Lima Advogados'
              and not (payload ? 'wording')
       from res where name = 'link_view'),
  'a person with a WhatsApp is told without agreeing to anything, and the link asks nothing'
);

-- ---------- A request to stop, recorded by the firm ----------

select pg_temp.sign_in('a9100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('stop_short', public.record_notice_optin(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, false, 'curto'));
insert into res values ('stop', public.record_notice_optin(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, false, 'Pediu por telefone para não receber.'));
insert into res values ('stop_again', public.record_notice_optin(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, false, 'Pediu de novo por telefone.'));
insert into res values ('view_stopped', public.case_notices(pg_temp.got('case', 'case_id')::uuid));
reset role;
select ok(
  pg_temp.got('stop_short', 'code') = 'note_required'
  and pg_temp.got('stop', 'code') = 'stopped' and pg_temp.got('stop_again', 'code') = 'unchanged'
  and (select source = 'firm' and note = 'Pediu por telefone para não receber.'
              and recorded_by = 'a9100000-0000-4000-8000-000000000002' and link_id is null and evidence is null
       from public.notice_stops where person_id = pg_temp.got('case', 'person_id')::uuid and ended_at is null)
  and (select count(*) = 1 from public.notice_stops where person_id = pg_temp.got('case', 'person_id')::uuid)
  and public.notice_person_blocker('b9100000-0000-4000-8000-00000000000a', pg_temp.got('case', 'person_id')::uuid) = 'stopped'
  and (select count(*) = 1 from public.case_events where kind = 'notices_stopped' and actor_type = 'person')
  and (select count(*) = 1 from public.audit_events where action = 'notices.stop_recorded'),
  'anybody of the firm records that a person asked to stop, saying how, once, on the record'
);
select ok(
  (select p -> 'stop' ->> 'source' = 'firm' and p -> 'stop' ->> 'note' = 'Pediu por telefone para não receber.'
          and p ->> 'blocker' = 'stopped'
   from res, jsonb_array_elements(payload -> 'people') p
   where name = 'view_stopped' and p ->> 'person_id' = pg_temp.got('case', 'person_id'))
  and (select p ->> 'blocker' is null
       from res, jsonb_array_elements(payload -> 'people') p
       where name = 'view_stopped' and p ->> 'person_id' = pg_temp.got('bento', 'person_id')),
  'the case says who asked to stop, how and why they are not told, and keeps telling the others'
);

-- A request to stop holds for the person, whatever number the firm has for them later.
select pg_temp.sign_in('a9100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_case_person(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('case', 'person_id')::uuid,
  '{"phone": "5500999991009"}'::jsonb);
reset role;
select is(
  public.notice_person_blocker('b9100000-0000-4000-8000-00000000000a', pg_temp.got('case', 'person_id')::uuid),
  'stopped',
  'a request to stop holds for the person at another number too'
);

-- ---------- A paper of the trip is asked of who may be told ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('file', public.reserve_file('b9100000-0000-4000-8000-00000000000a', 'client', 'passagem.pdf',
  'application/pdf', 3000, null));
select public.confirm_file(pg_temp.got('file', 'file_id')::uuid, repeat('d', 64), 3000, 'application/pdf', 1);
reset role;
insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status, rejected_reason, decided_at)
values ('c9100000-0000-4000-8000-0000000000d1', 'b9100000-0000-4000-8000-00000000000a', pg_temp.got('case', 'case_id')::uuid,
        null, pg_temp.got('file', 'file_id')::uuid, 'ticket', 'whatsapp', 'rejected', 'O bilhete não mostra o voo.', now());
select is(
  public.document_recipient('c9100000-0000-4000-8000-0000000000d1'),
  pg_temp.got('bento', 'person_id')::uuid,
  'a paper of the whole trip is asked of an adult who may be told, before the one who holds the case and asked to stop'
);

-- ---------- The client asks to be told again on their link ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('resumed', public.client_link_set_notices('token-da-ana-0091-aaaaaaaaaaaaaaaaaaaaaaaaaa', true, null,
  '{"user_agent": "Navegador de teste", "ip": "203.0.113.9", "extra": "ignorado"}'));
reset role;
select ok(
  pg_temp.got('resumed', 'code') = 'resumed'
  and (select ended_source = 'client' and ended_by is null and ended_note is null
              and ended_evidence = '{"ip": "203.0.113.9", "channel": "link", "user_agent": "Navegador de teste"}'::jsonb
       from public.notice_stops where person_id = pg_temp.got('case', 'person_id')::uuid)
  and public.notice_person_blocker('b9100000-0000-4000-8000-00000000000a', pg_temp.got('case', 'person_id')::uuid) is null
  -- Both may be told again: the paper is asked of one of them (two people written in one transaction have the
  -- same moment, so which one is the order of their ids).
  and public.document_recipient('c9100000-0000-4000-8000-0000000000d1')
      in (pg_temp.got('case', 'person_id')::uuid, pg_temp.got('bento', 'person_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'notices_resumed' and actor_type = 'client'),
  'the client ends the firm''s record of their request on their link, with what the server saw, and is told again'
);

-- ---------- Stopping on the link, and the firm recording that the person wants the notices again ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('link_stop', public.client_link_set_notices('token-da-ana-0091-aaaaaaaaaaaaaaaaaaaaaaaaaa', false,
  'Um texto qualquer que nada decide.', '{}'));
reset role;
set local role anon;
insert into res values ('link_stopped', public.client_link_notices('token-da-ana-0091-aaaaaaaaaaaaaaaaaaaaaaaaaa'));
reset role;
select pg_temp.sign_in('a9100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('back', public.record_notice_optin(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, true, 'Pediu na reunião para voltar a receber.'));
insert into res values ('back_again', public.record_notice_optin(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, true, 'Pediu na reunião para voltar a receber.'));
reset role;
select ok(
  pg_temp.got('link_stop', 'code') = 'stopped'
  and (select payload ->> 'stopped' = 'true' and payload ->> 'stopped_source' = 'client' and payload ->> 'agreed' = 'false'
       from res where name = 'link_stopped')
  and (select source = 'client' and link_id = pg_temp.got('link', 'link_id')::uuid and evidence = '{"channel": "link"}'::jsonb
              and ended_source = 'firm' and ended_by = 'a9100000-0000-4000-8000-000000000001'
              and ended_note = 'Pediu na reunião para voltar a receber.'
       from public.notice_stops
       where person_id = pg_temp.got('case', 'person_id')::uuid and link_id is not null)
  and pg_temp.got('back', 'code') = 'resumed' and pg_temp.got('back_again', 'code') = 'unchanged'
  and (select count(*) = 2 from public.notice_stops where person_id = pg_temp.got('case', 'person_id')::uuid)
  and (select count(*) = 1 from public.audit_events where action = 'notices.stop_ended'),
  'a client stops on their link whatever words the page sent, and the firm records how they asked to be told again'
);

-- ---------- Another firm ----------

select pg_temp.sign_in('a9100000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  format('select public.record_notice_optin(%L, %L, false, %L)', pg_temp.got('case', 'case_id'),
         pg_temp.got('case', 'person_id'), 'Pediu por telefone para não receber.'),
  'P0002', 'case_not_found', 'another firm records no request about a case of the firm');
select is(
  (select count(*)::integer from public.notice_stops where org_id = 'b9100000-0000-4000-8000-00000000000a'),
  0,
  'and reads none of its requests to stop'
);
insert into res values ('b_stop', public.record_notice_optin(pg_temp.got('case_b', 'case_id')::uuid,
  pg_temp.got('case_b', 'person_id')::uuid, false, 'Pediu por mensagem para não receber.'));
reset role;
select ok(
  pg_temp.got('b_stop', 'code') = 'stopped'
  and public.notice_person_blocker('b9100000-0000-4000-8000-00000000000b', pg_temp.got('case_b', 'person_id')::uuid) = 'stopped'
  and public.notice_person_blocker('b9100000-0000-4000-8000-00000000000a', pg_temp.got('case', 'person_id')::uuid) is null
  and public.notice_person_blocker('b9100000-0000-4000-8000-00000000000a', pg_temp.got('bento', 'person_id')::uuid) is null
  and (select count(*) = 2 from public.notice_stops where org_id = 'b9100000-0000-4000-8000-00000000000a'),
  'its own requests are its own, and stop nobody of the other firm'
);

select * from finish();
rollback;
