begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- What counts as a closing (0146): the power of attorney or the contract
-- signed, then the documents the case needs sent, counted once per case on
-- the day the later of the two came; never ONE's unsigned paper, nor a paper
-- still being signed, nor a refused document. The goals count them in their
-- period and their part of the cases, the real cases only once the firm has
-- one, its test cases while it has none. Two firms: nothing of one reaches the
-- other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1450000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@fechaone.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1450000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@fechaone.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1450000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-fechaone', 'a1450000-0000-4000-8000-000000000001'),
  ('b1450000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-fechaone', 'a1450000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1450000-0000-4000-8000-00000000000a', 'a1450000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1450000-0000-4000-8000-00000000000b', 'a1450000-0000-4000-8000-000000000002', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- A case of one adult client, opened by a person of the firm.
create function pg_temp.new_case(name text, who uuid, org uuid, incident text) returns void language plpgsql as $$
declare
  made jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  made := public.create_case(org, incident, 'LA', date '2026-09-20',
    jsonb_build_object('full_name', 'Cliente ' || initcap(name), 'birth_date', '1985-04-02'));
  reset role;
  insert into res values (name, made);
end;
$$;

-- A document of a case, sent at a moment: of its client, or of nobody in particular (the ticket).
create function pg_temp.doc(name text, kind text, status text, at timestamptz, of_client boolean default true)
returns uuid language plpgsql as $$
declare
  org uuid := (select c.org_id from public.cases c where c.id = pg_temp.got(name, 'case_id')::uuid);
  file uuid := gen_random_uuid();
  made uuid := gen_random_uuid();
begin
  insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes,
    detected_mime, expires_at, confirmed_at)
  values (file, org, 'upload', 'org/' || org || '/upload/' || file, kind || '.pdf', 'application/pdf', 100, 'stored',
    repeat('e', 64), 100, 'application/pdf', now() + interval '1 hour', now());
  insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status, party_id, rejected_reason, created_at)
  values (made, org, pg_temp.got(name, 'case_id')::uuid, file, kind, 'firm', status,
    case when of_client then pg_temp.got(name, 'party_id')::uuid end,
    case when status = 'rejected' then 'Ilegível.' end, at);
  return made;
end;
$$;

-- The papers every case needs (an identity, a proof of address, the ticket), sent a few days ago.
create function pg_temp.papers(name text) returns void language sql as $$
  select pg_temp.doc(name, 'identity', 'accepted', now() - interval '3 days');
  select pg_temp.doc(name, 'address_proof', 'accepted', now() - interval '3 days');
  select pg_temp.doc(name, 'ticket', 'received', now() - interval '2 days', false);
$$;

create function pg_temp.closing(name text) returns record language sql as $$
  select cl.signed_at, cl.papers_at, cl.closed_at
  from public.case_closings((select c.org_id from public.cases c where c.id = pg_temp.got(name, 'case_id')::uuid),
                            array[pg_temp.got(name, 'case_id')::uuid]) cl;
$$;

create function pg_temp.closed_at(name text) returns timestamptz language sql as $$
  select cl.closed_at
  from public.case_closings((select c.org_id from public.cases c where c.id = pg_temp.got(name, 'case_id')::uuid),
                            array[pg_temp.got(name, 'case_id')::uuid]) cl;
$$;

create function pg_temp.signed_at(name text) returns timestamptz language sql as $$
  select cl.signed_at
  from public.case_closings((select c.org_id from public.cases c where c.id = pg_temp.got(name, 'case_id')::uuid),
                            array[pg_temp.got(name, 'case_id')::uuid]) cl;
$$;

-- Firm A: a case signed and with its papers, one with its papers and no signature, one whose power of attorney ONE
-- issued and is being signed, one with its identity refused, and a test case closed.
select pg_temp.new_case('pronto', 'a1450000-0000-4000-8000-000000000001', 'b1450000-0000-4000-8000-00000000000a', 'cancellation');
select pg_temp.papers('pronto');
insert into res values ('pronto-poa', jsonb_build_object('id',
  pg_temp.doc('pronto', 'power_of_attorney', 'accepted', now() - interval '1 day')));

select pg_temp.new_case('sem-assinatura', 'a1450000-0000-4000-8000-000000000001', 'b1450000-0000-4000-8000-00000000000a', 'cancellation');
select pg_temp.papers('sem-assinatura');

select pg_temp.new_case('papel', 'a1450000-0000-4000-8000-000000000001', 'b1450000-0000-4000-8000-00000000000a', 'delay');
select pg_temp.papers('papel');
do $$
declare
  issued uuid := pg_temp.doc('papel', 'power_of_attorney', 'accepted', now() - interval '2 days');
  envelope uuid := gen_random_uuid();
begin
  insert into public.signature_envelopes (id, org_id, case_id, document_id, method, status, signers)
  values (envelope, 'b1450000-0000-4000-8000-00000000000a', pg_temp.got('papel', 'case_id')::uuid, issued, 'govbr', 'pending',
    jsonb_build_array(jsonb_build_object('position', 1, 'person_id', pg_temp.got('papel', 'person_id'), 'name', 'Cliente Papel')));
  insert into public.case_papers (org_id, case_id, person_id, kind, document_id, envelope_id)
  values ('b1450000-0000-4000-8000-00000000000a', pg_temp.got('papel', 'case_id')::uuid,
    pg_temp.got('papel', 'person_id')::uuid, 'procuracao', issued, envelope);
  insert into res values ('papel-envelope', jsonb_build_object('id', envelope));
end;
$$;

select pg_temp.new_case('recusado', 'a1450000-0000-4000-8000-000000000001', 'b1450000-0000-4000-8000-00000000000a', 'cancellation');
select pg_temp.doc('recusado', 'identity', 'rejected', now() - interval '3 days');
select pg_temp.doc('recusado', 'address_proof', 'accepted', now() - interval '3 days');
select pg_temp.doc('recusado', 'ticket', 'accepted', now() - interval '3 days', false);
select pg_temp.doc('recusado', 'power_of_attorney', 'accepted', now() - interval '2 days');

select pg_temp.new_case('teste', 'a1450000-0000-4000-8000-000000000001', 'b1450000-0000-4000-8000-00000000000a', 'cancellation');
update public.cases set is_test = true where id = pg_temp.got('teste', 'case_id')::uuid;
select pg_temp.papers('teste');
select pg_temp.doc('teste', 'power_of_attorney', 'accepted', now() - interval '1 day');

-- Firm B: only a test case, closed.
select pg_temp.new_case('beta', 'a1450000-0000-4000-8000-000000000002', 'b1450000-0000-4000-8000-00000000000b', 'cancellation');
update public.cases set is_test = true where id = pg_temp.got('beta', 'case_id')::uuid;
select pg_temp.papers('beta');
select pg_temp.doc('beta', 'power_of_attorney', 'accepted', now() - interval '1 day');

select ok(
  not has_function_privilege('authenticated', 'public.case_closings(uuid, uuid[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.case_closings(uuid, uuid[])', 'EXECUTE'),
  'only the database reads which cases closed'
);

select ok(
  pg_temp.closed_at('pronto') = (select created_at from public.case_documents
                                 where id = pg_temp.got('pronto-poa', 'id')::uuid)
  and pg_temp.closed_at('sem-assinatura') is null
  and (select cl.papers_at is not null and cl.signed_at is null
       from public.case_closings('b1450000-0000-4000-8000-00000000000a',
         array[pg_temp.got('sem-assinatura', 'case_id')::uuid]) cl),
  'a case closes on the day the later of the signature and the papers came, and not with its papers alone'
);

select ok(
  pg_temp.signed_at('papel') is null and pg_temp.closed_at('papel') is null,
  'the power of attorney ONE issued is no signature while its envelope waits'
);

-- The client signs it: the signed copy comes back a day after the papers.
do $$
declare
  signed uuid := pg_temp.doc('papel', 'power_of_attorney', 'accepted', now() - interval '1 day');
begin
  update public.case_documents set source = 'signature' where id = signed;
  update public.signature_envelopes set status = 'signed', signed_document_id = signed
  where id = pg_temp.got('papel-envelope', 'id')::uuid;
  insert into res values ('papel-signed', jsonb_build_object('id', signed));
end;
$$;
select ok(
  pg_temp.signed_at('papel') = (select created_at from public.case_documents where id = pg_temp.got('papel-signed', 'id')::uuid)
  and pg_temp.closed_at('papel') = pg_temp.signed_at('papel'),
  'once its envelope came back signed, the case closes on the day of the signed copy'
);

select ok(
  pg_temp.closed_at('recusado') is null,
  'a refused identity answers nothing: the case waits for another'
);
insert into res values ('recusado-nova', jsonb_build_object('id',
  pg_temp.doc('recusado', 'identity', 'received', now() - interval '1 hour')));
select ok(
  pg_temp.closed_at('recusado') = (select created_at from public.case_documents
                                   where id = pg_temp.got('recusado-nova', 'id')::uuid),
  'the identity sent after the refusal closes the case on its own day'
);

-- The goals of each firm: every case of the last 40 days, and the delays only.
insert into public.closing_goals (org_id, starts_on, ends_on, incident, target) values
  ('b1450000-0000-4000-8000-00000000000a', (now() at time zone 'America/Sao_Paulo')::date - 40,
   (now() at time zone 'America/Sao_Paulo')::date, null, 10),
  ('b1450000-0000-4000-8000-00000000000a', (now() at time zone 'America/Sao_Paulo')::date - 40,
   (now() at time zone 'America/Sao_Paulo')::date, 'delay', 10),
  ('b1450000-0000-4000-8000-00000000000b', (now() at time zone 'America/Sao_Paulo')::date - 40,
   (now() at time zone 'America/Sao_Paulo')::date, null, 10);

select pg_temp.sign_in('a1450000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a-goals', public.firm_closing_goals('b1450000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('a1450000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('b-goals', public.firm_closing_goals('b1450000-0000-4000-8000-00000000000b'));
reset role;

select ok(
  (select payload ->> 'rule' = 'fechamento-v1' and payload -> 'tests_counted' = 'false'::jsonb from res where name = 'a-goals')
  and (select array_agg((g ->> 'closings')::int order by g ->> 'incident' nulls last)
       from res, jsonb_array_elements(payload -> 'goals') g where name = 'a-goals') = array[1, 3],
  'firm A counts its three real closings, the delay its one, and leaves its test case out'
);

select ok(
  (select payload -> 'tests_counted' = 'true'::jsonb
          and (payload -> 'goals' -> 0 ->> 'closings')::int = 1
   from res where name = 'b-goals'),
  'a firm with no real case counts its test case, and says so; nothing of firm A reaches it'
);

select * from finish();
rollback;
