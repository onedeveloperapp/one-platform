begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- Essential and dispensable documents (0177): the essentials are the
-- case's kind of problem's (a bag's take the RIB); each dispensable says
-- where it stands (asked, sent, not had, past its days); the client says
-- "não tenho" on the link, or a person of the firm for them; the link reads
-- them. Two firms: nothing of one reaches the other.
--
-- Every person, firm and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1750000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-docs.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1750000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-docs.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1750000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-docs', 'a1750000-0000-4000-8000-000000000001'),
  ('b1750000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-docs', 'a1750000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1750000-0000-4000-8000-00000000000a', 'a1750000-0000-4000-8000-000000000001', 'owner', 'atendimento'),
  ('b1750000-0000-4000-8000-00000000000b', 'a1750000-0000-4000-8000-000000000002', 'owner', 'socio');
-- The papers are kept to a person here, so the dispensables are asked right away (0181: where ONE sends them, they
-- wait for the signature; pgTAP 0179).
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b1750000-0000-4000-8000-00000000000a', 'send_signature_papers', 'approval'),
  ('b1750000-0000-4000-8000-00000000000b', 'send_signature_papers', 'approval');
insert into public.people (id, org_id, full_name) values
  ('d1750000-0000-4000-8000-000000000001', 'b1750000-0000-4000-8000-00000000000a', 'Maria Teste');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1750000-0000-4000-8000-000000000001', 'b1750000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'intake'),
  ('c1750000-0000-4000-8000-000000000002', 'b1750000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'baggage_lost', 'intake');
insert into public.case_parties (org_id, case_id, person_id, role) values
  ('b1750000-0000-4000-8000-00000000000a', 'c1750000-0000-4000-8000-000000000001', 'd1750000-0000-4000-8000-000000000001', 'claimant');
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at) values
  ('a8750000-0000-4000-8000-000000000001', 'b1750000-0000-4000-8000-00000000000a', 'c1750000-0000-4000-8000-000000000001',
   'd1750000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-dos-documentos', 'UTF8')), 'hex'), now() + interval '30 days');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.state(target_case uuid, target_kind text) returns text language sql as
$$ select d ->> 'state' from jsonb_array_elements(public.case_dispensables(target_case)) d where d ->> 'kind' = target_kind; $$;

select ok(
  (select array_agg(e ->> 'kind' order by e ->> 'kind') = array['address_proof', 'identity', 'ticket']
   from jsonb_array_elements(public.case_required_documents('c1750000-0000-4000-8000-000000000001')) e)
  and (select array_agg(e ->> 'kind' order by e ->> 'kind') = array['address_proof', 'baggage_report', 'identity', 'ticket']
       from jsonb_array_elements(public.case_required_documents('c1750000-0000-4000-8000-000000000002')) e),
  'the essentials are the case''s kind of problem''s: a bag''s take the airline''s report of the irregularity'
);

select ok(
  pg_temp.state('c1750000-0000-4000-8000-000000000001', 'receipt') = 'asked'
  and pg_temp.state('c1750000-0000-4000-8000-000000000001', 'evidence') = 'asked'
  and (select bool_and(d ->> 'label' <> '') from jsonb_array_elements(public.case_dispensables('c1750000-0000-4000-8000-000000000001')) d),
  'the dispensables are asked, each in its words'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res values ('not_have', public.client_link_not_have('token-dos-documentos', 'receipt'));
insert into res values ('essential', public.client_link_not_have('token-dos-documentos', 'identity'));
insert into res values ('open', public.client_link_open('token-dos-documentos'));
reset role;

select ok(
  pg_temp.got('not_have', 'code') = 'recorded' and pg_temp.got('essential', 'code') = 'not_dispensable'
  and pg_temp.state('c1750000-0000-4000-8000-000000000001', 'receipt') = 'not_have'
  and exists (select 1 from public.case_events e where e.case_id = 'c1750000-0000-4000-8000-000000000001' and e.kind = 'document_not_had'),
  'the client says on the link they do not have a dispensable, never an essential, on the case''s timeline'
);

select ok(
  jsonb_array_length((select payload -> 'required_documents' from res where name = 'open')) = 3
  and (select count(*) = 2 from jsonb_array_elements((select payload -> 'dispensables' from res where name = 'open'))),
  'the client''s link reads the case''s essentials and its dispensables'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1750000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
insert into res values ('firm', public.record_document_not_have('c1750000-0000-4000-8000-000000000001', 'evidence'));
reset role;
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1750000-0000-4000-8000-000000000002', 'role', 'authenticated', 'aal', 'aal2')::text, true);
set local role authenticated;
insert into res values ('other_firm', public.record_document_not_have('c1750000-0000-4000-8000-000000000002', 'evidence'));
insert into res values ('other_needs', public.case_document_needs('c1750000-0000-4000-8000-000000000001'));
reset role;

select ok(
  pg_temp.got('firm', 'code') = 'recorded'
  and pg_temp.state('c1750000-0000-4000-8000-000000000001', 'evidence') = 'not_have'
  and pg_temp.got('other_firm', 'code') = 'not_found' and pg_temp.got('other_needs', 'code') = 'not_found',
  'a person of the firm says it for the client; another firm says and reads nothing'
);

update public.cases set created_at = now() - interval '10 days' where id = 'c1750000-0000-4000-8000-000000000002';
select ok(
  pg_temp.state('c1750000-0000-4000-8000-000000000002', 'receipt') = 'expired',
  'past the setting''s days the case goes on without it'
);

select ok(
  not has_function_privilege('anon', 'public.client_link_not_have(text, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.client_link_not_have(text, text)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.case_document_answers', 'INSERT'),
  'only the backend writes the client''s answer, and nobody writes the table but through the functions'
);

select * from finish();
rollback;
