begin;
create extension if not exists pgtap;
select plan(20);

-- ============================================================
-- The case of an area of the firm (0274). Firm A's family area has its script published: the routing reads it, the
-- backend keeps where the triage of a conversation stands (never with another firm's area), and the client's "Quero
-- seguir" opens the case ONE asks the documents of: of no module, of the area, the kind and the version, with its work
-- outside the lawsuit, its documents by name (one sent for nothing named taken as the first still owed), and the
-- client's link that sends a document only for what the case asks. Firm B reads and marks nothing of A's.
--
-- Every person, firm, number and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2740000-0000-4000-8000-000000000001', 'ana@souza-casos-area.invalid', 'Ana Souza'),
  ('a2740000-0000-4000-8000-000000000002', 'caio@rocha-casos-area.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2740000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-casos-area', 'a2740000-0000-4000-8000-000000000001'),
  ('b2740000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-casos-area', 'a2740000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2740000-0000-4000-8000-00000000000a', 'a2740000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2740000-0000-4000-8000-00000000000b', 'a2740000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.firm_areas (id, org_id, law_area, name, source) values
  ('e2740000-0000-4000-8000-0000000000a1', 'b2740000-0000-4000-8000-00000000000a', 'familia', 'Família e sucessões', 'person'),
  ('e2740000-0000-4000-8000-0000000000b1', 'b2740000-0000-4000-8000-00000000000b', 'familia', 'Família e sucessões', 'person');
insert into public.firm_area_scripts (id, org_id, area_id, version, status, script, published_at) values
  ('e2740000-0000-4000-8000-0000000000a2', 'b2740000-0000-4000-8000-00000000000a', 'e2740000-0000-4000-8000-0000000000a1', 1,
   'published', jsonb_build_object(
     'tipos', jsonb_build_array(jsonb_build_object('chave', 'divorcio', 'nome', 'Divórcio consensual',
       'documentos', jsonb_build_array(
         jsonb_build_object('chave', 'rg', 'nome', 'RG ou CNH', 'tipo', 'identity', 'por', 'pessoa', 'essencial', true),
         jsonb_build_object('chave', 'certidao', 'nome', 'Certidão de casamento', 'tipo', 'other', 'por', 'caso', 'essencial', true),
         jsonb_build_object('chave', 'matricula', 'nome', 'Matrícula do imóvel', 'tipo', 'other', 'por', 'caso', 'essencial', false)),
       'pecas', '[]'::jsonb)),
     'perguntas', '[]'::jsonb, 'etapas', '[]'::jsonb,
     'tarefas', jsonb_build_array(jsonb_build_object('chave', 'partilha', 'nome', 'Lista dos bens a partilhar',
       'quem', 'cliente', 'fase', 'documentos', 'tipos', '[]'::jsonb)),
     'honorarios', '', 'duvidas', '', 'recusa', '', 'tribunais', '[]'::jsonb, 'sensiveis', '[]'::jsonb),
   now());
insert into public.connections (id, org_id, provider, external_id, label, status) values
  ('d2740000-0000-4000-8000-00000000000a', 'b2740000-0000-4000-8000-00000000000a', 'whatsapp', 'sessao-274-a', 'WhatsApp A', 'connected');
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number) values
  ('f2740000-0000-4000-8000-00000000000a', 'b2740000-0000-4000-8000-00000000000a', 'd2740000-0000-4000-8000-00000000000a', 'openwa', 'sessao-274-a', 'sessao-274-a', '5562900002741');
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, contact_name, last_inbound_at, last_message_at, last_message_direction) values
  ('c2740000-0000-4000-8000-00000000000a', 'b2740000-0000-4000-8000-00000000000a', 'f2740000-0000-4000-8000-00000000000a', '5562999992741', 'Contato A', now(), now(), 'in');
-- The backend holds it, as its claim of a turn does.
update public.wa_conversations set one_claimed_at = now(), one_claims = 1 where id = 'c2740000-0000-4000-8000-00000000000a';

create temp table res (name text primary key, value jsonb);
grant select, insert on res to authenticated, service_role;
create function pg_temp.got(key text, field text) returns text language sql as
$$ select value ->> field from res where name = key $$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- ---------- The routing, and where the triage stands ----------

select is(
  (select a ->> 'script_id' from jsonb_array_elements(public.firm_attendance('b2740000-0000-4000-8000-00000000000a') -> 'areas') a
   where a ->> 'id' = 'e2740000-0000-4000-8000-0000000000a1'),
  'e2740000-0000-4000-8000-0000000000a2', 'the routing reads the family area''s script in force'
);
select is(
  public.record_area_intake('c2740000-0000-4000-8000-00000000000a', 1, jsonb_build_object(
    'area_id', 'e2740000-0000-4000-8000-0000000000b1', 'script_id', 'e2740000-0000-4000-8000-0000000000a2')) ->> 'code',
  'invalid_state', 'never with an area of another firm'
);
select is(
  public.record_area_intake('c2740000-0000-4000-8000-00000000000a', 1, jsonb_build_object(
    'area_id', 'e2740000-0000-4000-8000-0000000000a1', 'script_id', 'e2740000-0000-4000-8000-0000000000a2',
    'type', 'divorcio', 'answers', '{}'::jsonb, 'etapa', 'oferta')) ->> 'code',
  'kept', 'the backend keeps where the triage stands'
);
select is(
  public.one_open_area_case('c2740000-0000-4000-8000-00000000000a', 1, repeat('a', 64), 'Pronto.') ->> 'code',
  'invalid_data', 'a case opens only for a client who gave their name'
);
select public.record_area_intake('c2740000-0000-4000-8000-00000000000a', 1, jsonb_build_object(
  'area_id', 'e2740000-0000-4000-8000-0000000000a1', 'script_id', 'e2740000-0000-4000-8000-0000000000a2',
  'type', 'divorcio', 'answers', '{}'::jsonb, 'etapa', 'oferta', 'nome', 'Joana Teste Lima'));

-- ---------- The case ONE opens ----------

insert into res values ('opened', public.one_open_area_case('c2740000-0000-4000-8000-00000000000a', 1,
  encode(sha256(convert_to('token-do-caso-da-area-274-abcdefghijk', 'UTF8')), 'hex'), 'Pronto, Joana. Pelo link abaixo.',
  'Triagem do ONE pelo roteiro de Família e sucessões.'));
select ok(pg_temp.got('opened', 'code') in ('opened', 'opened_without_link'), 'the client''s "Quero seguir" opens the case');
select is(
  (select array[coalesce(module, 'none'), area_id::text, area_script_id::text, case_type, coalesce(incident, 'none'), summary]
   from public.cases where id = pg_temp.got('opened', 'case_id')::uuid),
  array['none', 'e2740000-0000-4000-8000-0000000000a1', 'e2740000-0000-4000-8000-0000000000a2', 'divorcio', 'none',
        'Triagem do ONE pelo roteiro de Família e sucessões.'],
  'of no module: of the area, its kind and the script''s version, with the firm''s note of the triage'
);
select is(
  (select array_agg(key || ':' || who) from public.case_tasks where case_id = pg_temp.got('opened', 'case_id')::uuid),
  array['partilha:cliente'], 'with the work outside the lawsuit of its kind'
);
select is(
  (select array_agg(coalesce(d ->> 'need', d ->> 'kind') || ':' || (d ->> 'per') order by d ->> 'kind')
   from jsonb_array_elements(public.case_required_documents(pg_temp.got('opened', 'case_id')::uuid)) d),
  array['identity:claimant', 'certidao:case'],
  'and its documents by name, the identity as ONE reads it today'
);
select is(
  public.one_open_area_case('c2740000-0000-4000-8000-00000000000a', 1, repeat('a', 64), 'Pronto.') ->> 'code',
  'already_opened', 'a conversation opens one case'
);
reset role;

-- A document sent for nothing named is the first the case still asks by name.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, expires_at, confirmed_at,
                          bytes, sha256, detected_mime)
values ('a2740000-0000-4000-8000-0000000000f1', 'b2740000-0000-4000-8000-00000000000a', 'upload',
        'b2740000-0000-4000-8000-00000000000a/teste-274.pdf', 'certidao.pdf', 'application/pdf', 1000, 'stored', now(), now(),
        1000, repeat('a', 64), 'application/pdf');
insert into public.case_documents (org_id, case_id, file_id, kind, source, status)
values ('b2740000-0000-4000-8000-00000000000a', pg_temp.got('opened', 'case_id')::uuid, 'a2740000-0000-4000-8000-0000000000f1',
        'other', 'firm', 'received');
select is(
  (select need from public.case_documents where file_id = 'a2740000-0000-4000-8000-0000000000f1'),
  'certidao', 'a document sent for nothing named is taken as the first the case still asks'
);
select is(
  (select array_agg(d ->> 'need')
   from jsonb_array_elements(public.case_dispensables(pg_temp.got('opened', 'case_id')::uuid)) d),
  array['matricula'], 'and the one asked once stands by its own name'
);
select throws_ok(
  $$insert into public.cases (org_id, seq, module, incident) values ('b2740000-0000-4000-8000-00000000000a', 99, null, null)$$,
  '23514', null, 'a case is of a module, or of an area with its kind and script'
);

-- ---------- The client's link ----------

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is(
  public.client_link_open('token-do-caso-da-area-274-abcdefghijk') -> 'case' ->> 'area',
  'Família e sucessões', 'the client''s link says the case''s area, never a flight'
);
select is(
  public.client_link_reserve_upload('token-do-caso-da-area-274-abcdefghijk', 'other', null, 'outro.pdf', 'application/pdf',
    1000, 'passaporte') ->> 'code',
  'invalid_kind', 'and sends a document only for what the case asks'
);
reset role;

-- ---------- The work outside the lawsuit, the firm's ----------

set local role authenticated;
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a2740000-0000-4000-8000-000000000002', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is((select count(*)::integer from public.case_tasks), 0, 'firm B reads none of A''s work');
select throws_ok(
  format($$select public.mark_case_task('b2740000-0000-4000-8000-00000000000a', %L, true)$$,
    (select id from public.case_tasks where key = 'partilha')),
  '42501', 'not_authorized', 'nor marks it'
);
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a2740000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
select is(
  public.mark_case_task('b2740000-0000-4000-8000-00000000000a', (select id from public.case_tasks where key = 'partilha'), true) ->> 'code',
  'done', 'a person of A says the client''s work is done'
);
reset role;
select ok(
  not has_function_privilege('authenticated', 'public.record_area_intake(uuid, integer, jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.one_open_area_case(uuid, integer, text, text, text)', 'execute'),
  'nobody but the backend keeps a triage or opens a case of an area'
);

-- ---------- The firm's account deleted ----------

-- As the audited deletion of an account does it (0005): with no person's session. The case points at the published
-- script it was opened under (no action): both go with the firm in the same statement.
select set_config('request.jwt.claims', '', true);
select lives_ok(
  $$delete from public.organizations where id = 'b2740000-0000-4000-8000-00000000000a'$$,
  'the firm''s account deleted takes its area cases and the script they were opened under'
);
select is(
  (select count(*)::integer from public.cases where org_id = 'b2740000-0000-4000-8000-00000000000a')
  + (select count(*)::integer from public.firm_area_scripts where org_id = 'b2740000-0000-4000-8000-00000000000a'),
  0, 'and nothing of them is left'
);

select * from finish();
rollback;
