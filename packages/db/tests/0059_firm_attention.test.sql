begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- What holds a case until somebody of the firm acts (0053): the center of
-- what waits, and the home, also list each signature that waits for a
-- person of the firm (a signed file a client sent back, an outcome nobody
-- can tell) and count the packages whose signature failed. Two firms.
--
-- Every person, firm and CPF here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a5900000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a5900000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b5900000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-atencao', 'a5900000-0000-4000-8000-000000000001'),
  ('b5900000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-atencao', 'a5900000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b5900000-0000-4000-8000-00000000000a', 'a5900000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b5900000-0000-4000-8000-00000000000b', 'a5900000-0000-4000-8000-000000000004', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- A PDF of a firm the backend measured and kept, as a document of a case.
create function pg_temp.document(org uuid, case_id uuid, file_name text, mark text, source text default 'firm',
  envelope uuid default null)
returns uuid language plpgsql as $$
declare
  reserved jsonb;
  made uuid;
begin
  perform pg_temp.as_backend();
  reserved := public.reserve_file(org, 'upload', file_name, 'application/pdf', 4000);
  perform public.confirm_file((reserved ->> 'file_id')::uuid, repeat(mark, 64), 4000, 'application/pdf', 1);
  insert into public.case_documents (org_id, case_id, file_id, kind, source, status, envelope_id)
  values (org, case_id, (reserved ->> 'file_id')::uuid, 'power_of_attorney', source,
    case when source = 'client' then 'received' else 'accepted' end, envelope)
  returning id into made;
  return made;
end;
$$;
-- An envelope of a case in a state, signed by one person.
create function pg_temp.envelope(org uuid, case_id uuid, document uuid, status text, signer text, at timestamptz)
returns uuid language sql as $$
  insert into public.signature_envelopes (org_id, case_id, document_id, method, status, signers, created_at)
  values (org, case_id, document, 'govbr', status,
    jsonb_build_array(jsonb_build_object('position', 1, 'name', signer)), at)
  returning id;
$$;

select pg_temp.sign_in('a5900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_1', public.create_case('b5900000-0000-4000-8000-00000000000a', 'delay', 'G3',
  date '2026-10-20', '{"full_name": "Mariana Teste", "cpf": "12345678909"}'::jsonb));
insert into res values ('case_2', public.create_case('b5900000-0000-4000-8000-00000000000a', 'delay', 'G3',
  date '2026-10-20', '{"full_name": "Rafael Teste", "cpf": "52998224725"}'::jsonb));
insert into res values ('case_closed', public.create_case('b5900000-0000-4000-8000-00000000000a', 'delay', 'G3',
  date '2026-10-20', '{"full_name": "Lucia Teste", "cpf": "11144477735"}'::jsonb));
reset role;
select pg_temp.sign_in('a5900000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('b5900000-0000-4000-8000-00000000000b', 'delay', 'G3',
  date '2026-10-20', '{"full_name": "Pedro Teste", "cpf": "12345678909"}'::jsonb));
reset role;

-- Firm A: Mariana sent back her signed power of attorney an hour ago; Rafael's envelope nobody can tell; one
-- still waits for the client; and one of a case that ended. Firm B: one sent back.
do $$
declare
  org_a uuid := 'b5900000-0000-4000-8000-00000000000a';
  org_b uuid := 'b5900000-0000-4000-8000-00000000000b';
  case_1 uuid := (select payload ->> 'case_id' from res where name = 'case_1')::uuid;
  case_2 uuid := (select payload ->> 'case_id' from res where name = 'case_2')::uuid;
  case_closed uuid := (select payload ->> 'case_id' from res where name = 'case_closed')::uuid;
  case_b uuid := (select payload ->> 'case_id' from res where name = 'case_b')::uuid;
  sent uuid;
begin
  sent := pg_temp.envelope(org_a, case_1, pg_temp.document(org_a, case_1, 'procuracao.pdf', 'a'), 'received',
    'Mariana Teste', now() - interval '2 days');
  perform pg_temp.document(org_a, case_1, 'procuracao-assinada.pdf', 'b', 'client', sent);
  update public.case_documents set created_at = now() - interval '1 hour' where envelope_id = sent;
  perform pg_temp.envelope(org_a, case_2, pg_temp.document(org_a, case_2, 'procuracao.pdf', 'c'), 'uncertain',
    'Rafael Teste', now() - interval '3 hours');
  perform pg_temp.envelope(org_a, case_2, pg_temp.document(org_a, case_2, 'contrato.pdf', 'd'), 'pending',
    'Rafael Teste', now() - interval '3 hours');
  perform pg_temp.envelope(org_a, case_closed, pg_temp.document(org_a, case_closed, 'procuracao.pdf', 'e'), 'received',
    'Lucia Teste', now() - interval '5 hours');
  update public.cases set status = 'closed', closed_at = now() where id = case_closed;
  perform pg_temp.envelope(org_b, case_b, pg_temp.document(org_b, case_b, 'procuracao.pdf', 'f'), 'received',
    'Pedro Teste', now() - interval '1 hour');
end;
$$;

select pg_temp.sign_in('a5900000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('pending_a', public.firm_pending('b5900000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('a5900000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('pending_b', public.firm_pending('b5900000-0000-4000-8000-00000000000b'));
select throws_ok(
  $$select public.firm_pending('b5900000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_authorized',
  'nobody of another firm reads what waits for this one'
);
reset role;

select ok(
  (select jsonb_array_length(payload -> 'signatures_to_confirm') = 2
          and (payload ->> 'signatures_to_confirm_total')::integer = 2
   from res where name = 'pending_a'),
  'a signed file a client sent back and an outcome nobody can tell wait for a person; one still with the client, and one of a case that ended, do not'
);

select ok(
  (select (payload -> 'signatures_to_confirm' -> 0 ->> 'client') = 'Rafael Teste'
          and (payload -> 'signatures_to_confirm' -> 0 ->> 'status') = 'uncertain'
          and (payload -> 'signatures_to_confirm' -> 1 ->> 'client') = 'Mariana Teste'
          and (payload -> 'signatures_to_confirm' -> 1 ->> 'status') = 'received'
          and (payload -> 'signatures_to_confirm' -> 1 ->> 'case_id') = pg_temp.got('case_1', 'case_id')
          and (payload -> 'signatures_to_confirm' -> 1 ->> 'seq')::integer > 0
   from res where name = 'pending_a'),
  'each is said with its case and who signs, the one waiting longest first: a file sent back from when it arrived'
);

select ok(
  (select jsonb_array_length(payload -> 'signatures_to_confirm') = 1
          and (payload -> 'signatures_to_confirm' -> 0 ->> 'client') = 'Pedro Teste'
   from res where name = 'pending_b'),
  'each firm reads only its own'
);

select ok(
  (select (payload ->> 'package_signatures_failed')::integer = 0
          and payload ? 'one_waits' and payload ? 'links_owed' and payload ? 'conversations_called'
   from res where name = 'pending_a'),
  'the packages whose signature failed are counted, and the rest of what waits is said as before'
);

select * from finish();
rollback;
