begin;
create extension if not exists pgtap;
select plan(15);

-- ============================================================
-- The firm's registrations start from documents (0085): the reading of a
-- document for a registration and the reading of a filing's receipt are
-- tasks that decide nothing, each with its instructions in force; a firm may
-- have the setting's reads in a day, counted for it alone, and never in a
-- support visit. On a client's link, the document of a child sent before the
-- child is in the case is read within the link's reads of the day, and then
-- becomes the child's. Two firms.
--
-- Every person, firm and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a8800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-leitura.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a8800000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-leitura.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a8800000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'suporte@one-leitura.invalid', '', now(), '{}', '{"display_name":"Suporte"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b8800000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-leitura', 'a8800000-0000-4000-8000-000000000001'),
  ('b8800000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-leitura', 'a8800000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b8800000-0000-4000-8000-00000000000a', 'a8800000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b8800000-0000-4000-8000-00000000000b', 'a8800000-0000-4000-8000-000000000002', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2',
     'session_id', coalesce(session::text, ''))::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.hash(token text) returns text language sql as
$$ select encode(sha256(convert_to(token, 'UTF8')), 'hex'); $$;

-- ---------- The tasks ----------

select ok(
  (select count(*) = 2 from public.ai_tasks t
   where t.slug in ('caso.documento.leitura', 'caso.protocolo.leitura') and t.autonomy = 'autonomous' and not t.shadow),
  'both readings are tasks that never wait for anybody, and the firm reads their runs'
);
-- One version of each in force; the document's reading is in its second since 0293 (the day of a flight without its year).
select ok(
  (select count(*) = 2 from public.prompt_versions v
   where v.task in ('caso.documento.leitura', 'caso.protocolo.leitura') and v.is_active
     and v.version = case v.task when 'caso.documento.leitura' then 2 else 1 end),
  'each reading has its instructions in force'
);
select ok(
  (select v.output_schema -> 'required' ? 'trechos' and v.output_schema -> 'required' ? 'dados_lidos'
          and v.system_prompt like '%certidão de nascimento%' and v.system_prompt like '%print de tela da reserva%'
   from public.prompt_versions v where v.task = 'caso.documento.leitura' and v.is_active)
  and (select v.output_schema -> 'required' ? 'numero_processo' and v.output_schema -> 'required' ? 'data_protocolo'
       from public.prompt_versions v where v.task = 'caso.protocolo.leitura' and v.is_active),
  'the reading takes a child''s birth certificate and a screenshot of a booking; the receipt''s gives the number and the day'
);

-- ---------- How many reads a firm may have ----------

update public.platform_settings set value = jsonb_build_object('per_day', 2) where key = 'document_prefill';

select pg_temp.sign_in('a8800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('fresh', public.prefill_reading_allowed('b8800000-0000-4000-8000-00000000000a'));
select throws_ok(
  $$ select public.prefill_reading_allowed('b8800000-0000-4000-8000-00000000000b') $$,
  '42501', 'not_authorized',
  'nobody reads for another firm'
);
reset role;

select ok(
  pg_temp.got('fresh', 'ok') = 'true' and pg_temp.got('fresh', 'left') = '2',
  'a firm with no read today may have the setting''s reads'
);

-- Two reads of the firm today, one of yesterday, and one of the other firm.
insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, output, finished_at, started_at)
select f.org_id, f.task, v.id, v.provider, v.model, repeat('b', 64), 'succeeded', '{}'::jsonb, f.started_at, f.started_at
from (values
  ('b8800000-0000-4000-8000-00000000000a'::uuid, 'caso.documento.leitura', now() - interval '1 hour'),
  ('b8800000-0000-4000-8000-00000000000a'::uuid, 'caso.protocolo.leitura', now() - interval '2 hours'),
  ('b8800000-0000-4000-8000-00000000000a'::uuid, 'caso.documento.leitura', now() - interval '30 hours'),
  ('b8800000-0000-4000-8000-00000000000b'::uuid, 'caso.documento.leitura', now() - interval '1 hour')
) as f (org_id, task, started_at)
join public.prompt_versions v on v.task = f.task and v.is_active;

select pg_temp.sign_in('a8800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('spent', public.prefill_reading_allowed('b8800000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('a8800000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('other', public.prefill_reading_allowed('b8800000-0000-4000-8000-00000000000b'));
reset role;

select ok(
  pg_temp.got('spent', 'ok') = 'false' and pg_temp.got('spent', 'code') = 'prefill_limit',
  'the reads of the last 24 hours count against the firm''s day, both readings together'
);
select ok(
  pg_temp.got('other', 'ok') = 'true' and pg_temp.got('other', 'left') = '1',
  'another firm''s reads are its own'
);

-- ---------- Never in a support visit, never anonymously ----------

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a8800000-0000-4000-8000-000000000009', 'a8800000-0000-4000-8000-000000000002',
        'b8800000-0000-4000-8000-00000000000b', 'chamado de teste 088',
        'c8800000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a8800000-0000-4000-8000-000000000002', 'c8800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('visit', public.prefill_reading_allowed('b8800000-0000-4000-8000-00000000000b'));
reset role;

select ok(
  pg_temp.got('visit', 'code') = 'not_allowed_in_support_session',
  'a support visit has nothing read'
);

set local role anon;
select throws_ok(
  $$ select public.prefill_reading_allowed('b8800000-0000-4000-8000-00000000000a') $$,
  '42501', null,
  'nobody signed out asks'
);
reset role;

-- ---------- A child from their document, on the client's link ----------

update public.platform_settings set value = jsonb_build_object('per_day', 200, 'per_link', 1) where key = 'document_prefill';

select pg_temp.sign_in('a8800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('b8800000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('link', public.create_client_link(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, pg_temp.hash('token-da-maria-leitura-1234567890')));
reset role;
select pg_temp.sign_in('a8800000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('case_b', public.create_case('b8800000-0000-4000-8000-00000000000b', 'cancellation', null, null,
  '{"full_name": "Paulo Teste", "cpf": "52998224725", "birth_date": "1980-01-10"}'::jsonb));
insert into res values ('link_b', public.create_client_link(pg_temp.got('case_b', 'case_id')::uuid,
  pg_temp.got('case_b', 'person_id')::uuid, pg_temp.hash('token-do-paulo-leitura-1234567890')));
reset role;

-- The client sends two documents of a child not in the case yet, and their own identity.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
insert into res values ('child_doc', public.client_link_reserve_upload('token-da-maria-leitura-1234567890', 'identity',
  null, 'certidao.jpg', 'image/jpeg', 120000));
insert into res values ('child_doc2', public.client_link_reserve_upload('token-da-maria-leitura-1234567890', 'identity',
  null, 'rg-crianca.jpg', 'image/jpeg', 120000));
insert into res values ('holder_doc', public.client_link_reserve_upload('token-da-maria-leitura-1234567890', 'identity',
  pg_temp.got('case', 'party_id')::uuid, 'rg.jpg', 'image/jpeg', 120000));
select throws_ok(
  format('select public.client_link_prefill_to_read(%L, %L)', 'token-da-maria-leitura-1234567890',
         pg_temp.got('child_doc', 'document_id')),
  '42501', null,
  'only the backend asks what a link''s upload is to be read'
);
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('to_read', public.client_link_prefill_to_read('token-da-maria-leitura-1234567890',
  pg_temp.got('child_doc', 'document_id')::uuid));
insert into res values ('to_read_holder', public.client_link_prefill_to_read('token-da-maria-leitura-1234567890',
  pg_temp.got('holder_doc', 'document_id')::uuid));
insert into res values ('to_read_other', public.client_link_prefill_to_read('token-do-paulo-leitura-1234567890',
  pg_temp.got('child_doc', 'document_id')::uuid));
reset role;

select ok(
  pg_temp.got('to_read', 'ok') = 'true' and pg_temp.got('to_read', 'org_id') = 'b8800000-0000-4000-8000-00000000000a'
  and pg_temp.got('to_read', 'storage_path') is not null,
  'the document of a child not in the case yet is handed to the reading, of the link''s firm'
);
select ok(
  pg_temp.got('to_read_holder', 'code') = 'not_found' and pg_temp.got('to_read_other', 'code') = 'not_found',
  'nothing else is: a document of somebody already in the case, nor one of another link'
);

-- One read of the link today, and the setting gives a link one.
insert into public.ai_runs (org_id, task, prompt_version_id, provider, model, input_hash, status, output, finished_at,
                            subject_type, subject_id)
select 'b8800000-0000-4000-8000-00000000000a', v.task, v.id, v.provider, v.model, repeat('c', 64), 'succeeded', '{}'::jsonb,
       now(), 'case_document', pg_temp.got('child_doc', 'document_id')
from public.prompt_versions v where v.task = 'caso.documento.leitura' and v.is_active;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('spent_link', public.client_link_prefill_to_read('token-da-maria-leitura-1234567890',
  pg_temp.got('child_doc2', 'document_id')::uuid));
reset role;

select ok(
  pg_temp.got('spent_link', 'code') = 'prefill_limit',
  'a link has the setting''s reads in a day'
);

-- The client adds the child with what was read, and the document becomes the child's.
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
insert into res values ('child', public.client_link_add_dependent('token-da-maria-leitura-1234567890',
  '{"full_name": "Pedro Teste", "birth_date": "2018-06-01"}'::jsonb));
insert into res values ('assigned', public.client_link_assign_upload('token-da-maria-leitura-1234567890',
  pg_temp.got('child_doc', 'document_id')::uuid, pg_temp.got('child', 'party_id')::uuid));
insert into res values ('assigned_again', public.client_link_assign_upload('token-da-maria-leitura-1234567890',
  pg_temp.got('child_doc', 'document_id')::uuid, pg_temp.got('child', 'party_id')::uuid));
insert into res values ('assigned_foreign', public.client_link_assign_upload('token-da-maria-leitura-1234567890',
  pg_temp.got('child_doc2', 'document_id')::uuid, pg_temp.got('case_b', 'party_id')::uuid));
insert into res values ('assigned_other_link', public.client_link_assign_upload('token-do-paulo-leitura-1234567890',
  pg_temp.got('child_doc2', 'document_id')::uuid, pg_temp.got('case_b', 'party_id')::uuid));
reset role;

select ok(
  pg_temp.got('assigned', 'code') = 'assigned'
  and (select party_id = pg_temp.got('child', 'party_id')::uuid and status = 'uploading' from public.case_documents
       where id = pg_temp.got('child_doc', 'document_id')::uuid),
  'the document becomes the child''s, still to be sent as any upload'
);
select ok(
  pg_temp.got('assigned_again', 'code') = 'not_found' and pg_temp.got('assigned_foreign', 'code') = 'party_not_found'
  and pg_temp.got('assigned_other_link', 'code') = 'not_found',
  'only once, only to a person of the link, and only a document of the link'
);

select * from finish();
rollback;
