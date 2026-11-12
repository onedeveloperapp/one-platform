begin;
create extension if not exists pgtap;
select plan(12);

-- ============================================================
-- A justiça gratuita no recurso do juizado (0218). Rui and Lia won less
-- than they asked in the small-claims court, and the firm decides the
-- recurso inominado: each says then whether they ask for free justice, Rui
-- on his link, Lia through the firm. The recurso waits for both answers,
-- and for the mark of the request while somebody asks; ONE issues Rui's
-- declaration though the case is with the court; the recurso writes the
-- request by name; the lawyer files it with the declaration; the preparo is
-- proposed since Lia does not ask. In the other firm Bia asks alone, and no
-- preparo is proposed. A judgment nobody appeals asks nothing, and nothing
-- of one firm reaches the other.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2180000-0000-4000-8000-000000000001', 'ana@souza-recurso.invalid', 'Ana Souza'),
  ('a2180000-0000-4000-8000-000000000002', 'caio@rocha-recurso.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2180000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-recurso', 'a2180000-0000-4000-8000-000000000001'),
  ('b2180000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-recurso', 'a2180000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2180000-0000-4000-8000-00000000000a', 'a2180000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2180000-0000-4000-8000-00000000000b', 'a2180000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2180000-0000-4000-8000-000000000001', 'b2180000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c2180000-0000-4000-8000-000000000002', 'b2180000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.people (id, org_id, full_name, cpf, birth_date, nationality, marital_status, profession,
                           street, address_number, district, city, uf, postal_code) values
  ('d2180000-0000-4000-8000-000000000001', 'b2180000-0000-4000-8000-00000000000a', 'Rui Teste', '52998224725',
   '1980-01-01', 'brasileira', 'casado', 'Professor', 'Rua das Flores', '10', 'Centro', 'Goiânia', 'GO', '74000000'),
  ('d2180000-0000-4000-8000-000000000002', 'b2180000-0000-4000-8000-00000000000a', 'Lia Teste', '11144477735',
   '1985-02-02', 'brasileira', 'casado', 'Arquiteta', 'Rua das Flores', '10', 'Centro', 'Goiânia', 'GO', '74000000'),
  ('d2180000-0000-4000-8000-000000000003', 'b2180000-0000-4000-8000-00000000000b', 'Bia Teste', '12345678909',
   '1990-03-03', 'brasileira', 'solteiro', 'Médica', 'Rua dos Ipês', '20', 'Setor Sul', 'Goiânia', 'GO', '74080000');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e2180000-0000-4000-8000-000000000001', 'b2180000-0000-4000-8000-00000000000a', 'c2180000-0000-4000-8000-000000000001',
   'd2180000-0000-4000-8000-000000000001', 'claimant'),
  ('e2180000-0000-4000-8000-000000000002', 'b2180000-0000-4000-8000-00000000000a', 'c2180000-0000-4000-8000-000000000001',
   'd2180000-0000-4000-8000-000000000002', 'claimant'),
  ('e2180000-0000-4000-8000-000000000003', 'b2180000-0000-4000-8000-00000000000b', 'c2180000-0000-4000-8000-000000000002',
   'd2180000-0000-4000-8000-000000000003', 'claimant');
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at, finished_at) values
  ('a7218000-0000-4000-8000-000000000001', 'b2180000-0000-4000-8000-00000000000a', 'c2180000-0000-4000-8000-000000000001',
   'd2180000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-do-rui-recurso', 'UTF8')), 'hex'),
   now() + interval '180 days', now());
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f2180000-0000-4000-8000-000000000001', 'b2180000-0000-4000-8000-00000000000a', 'c2180000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2025-08-01'),
  ('f2180000-0000-4000-8000-000000000002', 'b2180000-0000-4000-8000-00000000000b', 'c2180000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'filed', '00051016820998090051', '2025-08-01');
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('f2180000-0000-4000-8000-000000000001', 'e2180000-0000-4000-8000-000000000001', 'b2180000-0000-4000-8000-00000000000a'),
  ('f2180000-0000-4000-8000-000000000001', 'e2180000-0000-4000-8000-000000000002', 'b2180000-0000-4000-8000-00000000000a'),
  ('f2180000-0000-4000-8000-000000000002', 'e2180000-0000-4000-8000-000000000003', 'b2180000-0000-4000-8000-00000000000b');
-- A judgment in each firm, less than was asked.
insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, result, cents, happened_on, source) values
  ('b2180000-0000-4000-8000-00000000000a', 'c2180000-0000-4000-8000-000000000001', 'f2180000-0000-4000-8000-000000000001',
   'sentenca', 'parcial', 200000, current_date - 3, 'person'),
  ('b2180000-0000-4000-8000-00000000000b', 'c2180000-0000-4000-8000-000000000002', 'f2180000-0000-4000-8000-000000000002',
   'sentenca', 'parcial', 150000, current_date - 3, 'person');

create function pg_temp.sign_in(person uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;
create function pg_temp.as_backend() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role, anon;

-- ---------- A judgment nobody appeals asks nothing ----------

set local role anon;
insert into res values ('link-before', public.client_link_free_justice('token-do-rui-recurso'));
reset role;
select ok(
  not exists (select 1 from public.free_justice_needs('c2180000-0000-4000-8000-000000000001'))
    and (select jsonb_array_length(value -> 'items') = 0 from res where key = 'link-before'),
  'a lawsuit of the small-claims court asks nothing of free justice while nobody appeals'
);

-- ---------- The firm decides the recurso ----------

select pg_temp.sign_in('a2180000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('decided', public.decide_judgment_path(
  (select id from public.judgment_paths where proceeding_id = 'f2180000-0000-4000-8000-000000000001'), 'recurso_inominado', null));
insert into res values ('firm-reads', public.case_free_justice('c2180000-0000-4000-8000-000000000001'));
reset role;
set local role anon;
insert into res values ('link-asks', public.client_link_free_justice('token-do-rui-recurso'));
reset role;
select ok(
  (select value ->> 'code' = 'decided' from res where key = 'decided')
    and (select count(*) = 2 from public.free_justice_needs('c2180000-0000-4000-8000-000000000001'))
    and (select jsonb_array_length(value -> 'needs') = 2
              and (select bool_and((n ->> 'appeal')::boolean) from jsonb_array_elements(value -> 'needs') n)
         from res where key = 'firm-reads')
    and (select jsonb_array_length(value -> 'items') = 1 and value #>> '{items,0,name}' = 'Rui Teste'
              and (value #>> '{items,0,appeal}')::boolean
         from res where key = 'link-asks'),
  'once the firm decides the recurso, each claimant is asked, Rui on his link, and both are said to be of the appeal'
);

-- The recurso the AI wrote from a model of before, with no mark of the request.
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_name, template_body, mode, status, version,
                                checked_version, piece_kind)
values ('ac218000-0000-4000-8000-000000000001', 'b2180000-0000-4000-8000-00000000000a', 'c2180000-0000-4000-8000-000000000001',
        'f2180000-0000-4000-8000-000000000001', 'Recurso', 'Texto do modelo do recurso.', 'ai', 'proposed', 1, 1, 'recurso');
insert into public.case_draft_versions (org_id, draft_id, version, author, body) values
  ('b2180000-0000-4000-8000-00000000000a', 'ac218000-0000-4000-8000-000000000001', 1, 'ai',
   E'RECURSO\n\nA sentença deve ser reformada.\n\nDiante do exposto, pedem que o recurso seja recebido e provido.');
select is(public.case_draft_state_blocker('ac218000-0000-4000-8000-000000000001'), 'free_justice_unanswered',
  'the recurso is not approved while a claimant has not answered');

-- ---------- Rui asks on his link, Lia does not, through the firm ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('rui-yes', public.client_link_answer_free_justice('token-do-rui-recurso',
  'e2180000-0000-4000-8000-000000000001', true, '{"ip": "203.0.113.9"}'));
reset role;
select pg_temp.sign_in('a2180000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('lia-no', public.record_free_justice_answer('c2180000-0000-4000-8000-000000000001',
  'e2180000-0000-4000-8000-000000000002', false, 'Lia disse ao telefone hoje.', null));
reset role;
select ok(
  (select value ->> 'ok' = 'true' from res where key = 'rui-yes')
    and (select value ->> 'ok' = 'true' from res where key = 'lia-no')
    and public.case_draft_state_blocker('ac218000-0000-4000-8000-000000000001') = 'free_justice_mark_missing',
  'answered, a recurso of a model with no mark of the request waits for a lawyer to put it, since Rui asks'
);

-- ---------- ONE issues Rui's declaration, the case with the court ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('owed', coalesce((select jsonb_agg(case_id) from public.appeal_papers_owed(10)), '[]'::jsonb));
insert into res values ('to-issue', public.appeal_paper_to_issue('c2180000-0000-4000-8000-000000000001'));
reset role;
select ok(
  (select array_agg(person_id) = array['d2180000-0000-4000-8000-000000000001'::uuid]
   from public.appeal_papers_due('c2180000-0000-4000-8000-000000000001'))
    and not exists (select 1 from public.case_papers_due('c2180000-0000-4000-8000-000000000001'))
    and (select value ? 'c2180000-0000-4000-8000-000000000001' from res where key = 'owed')
    and (select value ->> 'code' = 'due' and strpos(value ->> 'body', 'Rui Teste, em nome próprio') > 0
                and strpos(value ->> 'body', '[[') = 0
         from res where key = 'to-issue'),
  'a declaration is owed of Rui alone, through the line of a case with the court, written with his facts'
);

insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, expires_at)
values ('a8218000-0000-4000-8000-0000000000aa', 'b2180000-0000-4000-8000-00000000000a', 'paper', 'org/x/declaracao-recurso',
        'declaracao.pdf', 'application/pdf', 100, 'reserved', now() + interval '1 hour');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('issued', public.record_appeal_paper('c2180000-0000-4000-8000-000000000001',
  'd2180000-0000-4000-8000-000000000001',
  public.paper_template_for('b2180000-0000-4000-8000-00000000000a', 'declaracao_hipossuficiencia'),
  jsonb_build_object('file_id', 'a8218000-0000-4000-8000-0000000000aa', 'sha256', repeat('e', 64), 'bytes', '100', 'pages', '1')));
insert into res values ('again', public.record_appeal_paper('c2180000-0000-4000-8000-000000000001',
  'd2180000-0000-4000-8000-000000000001',
  public.paper_template_for('b2180000-0000-4000-8000-00000000000a', 'declaracao_hipossuficiencia'),
  jsonb_build_object('file_id', 'a8218000-0000-4000-8000-0000000000aa', 'sha256', repeat('e', 64), 'bytes', '100', 'pages', '1')));
reset role;
set local role anon;
insert into res values ('link-issued', public.client_link_free_justice('token-do-rui-recurso'));
reset role;
select ok(
  (select value ->> 'code' = 'issued' from res where key = 'issued')
    and (select value ->> 'code' = 'not_due' from res where key = 'again')
    and (select kind = 'free_justice_declaration' from public.case_documents
         where id = (select (value ->> 'document_id')::uuid from res where key = 'issued'))
    and (select status = 'pending' and method = 'govbr' from public.signature_envelopes
         where id = (select (value ->> 'envelope_id')::uuid from res where key = 'issued'))
    and (select (value ->> 'issued')::boolean from res where key = 'link-issued'),
  'ONE issues it once and sends it to Rui to sign on his link'
);

-- ---------- The recurso of the new model writes the request ----------

insert into public.case_draft_versions (org_id, draft_id, version, author, body)
select 'b2180000-0000-4000-8000-00000000000a', 'ac218000-0000-4000-8000-000000000001', 2, 'ai', k.model
from public.piece_kinds k where k.slug = 'recurso';
update public.case_drafts set version = 2, checked_version = 2 where id = 'ac218000-0000-4000-8000-000000000001';
select ok(
  strpos(public.case_draft_filled('ac218000-0000-4000-8000-000000000001',
    (select body from public.case_draft_versions where draft_id = 'ac218000-0000-4000-8000-000000000001' and version = 2)),
    E'DA GRATUIDADE DA JUSTIÇA\n\nA parte recorrente Rui Teste não tem condições de arcar com o preparo deste recurso') > 0
  and strpos(public.case_draft_filled('ac218000-0000-4000-8000-000000000001',
    (select body from public.case_draft_versions where draft_id = 'ac218000-0000-4000-8000-000000000001' and version = 2)),
    'Requerem, ainda, a concessão da gratuidade da justiça a Rui Teste, nos termos do art. 99, § 7º, da Lei nº 13.105.') > 0
  and public.case_draft_state_blocker('ac218000-0000-4000-8000-000000000001') is null,
  'the recurso asks free justice for Rui by name, under the art. 99, § 7º, and nothing about it holds the approval'
);

select ok(
  (select strpos(v.manifest #>> '{pieces,kinds,recurso,model}', '[[GRATUIDADE]]') > 0
   from public.module_versions v
   where v.module = 'direito-do-passageiro' and v.status = 'published'
   order by v.version desc limit 1)
    and (select strpos(v.manifest #>> '{pieces,kinds,recurso,model}', '[[GRATUIDADE]]') = 0
         from public.module_versions v
         where v.module = 'direito-do-passageiro' and v.version = 1),
  'the platform''s recurso takes the mark in a new version of the module, and the version of before stays as it was'
);

-- ---------- Issued, the lawyer files it with the declaration ----------

insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, expires_at)
values ('a8218000-0000-4000-8000-0000000000bb', 'b2180000-0000-4000-8000-00000000000a', 'paper', 'org/x/recurso',
        'recurso.pdf', 'application/pdf', 100, 'reserved', now() + interval '1 hour');
insert into public.case_documents (id, org_id, case_id, file_id, kind, source, status, decided_at)
values ('ad218000-0000-4000-8000-000000000001', 'b2180000-0000-4000-8000-00000000000a', 'c2180000-0000-4000-8000-000000000001',
        'a8218000-0000-4000-8000-0000000000bb', 'petition', 'firm', 'accepted', now());
update public.case_drafts set status = 'issued', approved_version = 2, approved_body = 'Texto do recurso.', approved_at = now(),
  document_id = 'ad218000-0000-4000-8000-000000000001', decision = 'file', decided_at = now(),
  decided_by = 'a2180000-0000-4000-8000-000000000001', filing_status = 'owed'
where id = 'ac218000-0000-4000-8000-000000000001';
select is(public.piece_filing_blocker('ac218000-0000-4000-8000-000000000001'), 'free_justice_declaration',
  'ONE does not file alone a recurso that goes with the declaration: the lawyer files it with it');

update public.case_drafts set filed_at = now(), filed_how = 'lawyer', filed_by = 'a2180000-0000-4000-8000-000000000001',
  filing_status = 'filed'
where id = 'ac218000-0000-4000-8000-000000000001';
select ok(
  exists (select 1 from public.deadlines d
          where d.proceeding_id = 'f2180000-0000-4000-8000-000000000001' and d.act = 'preparo_recurso_inominado')
    and not exists (select 1 from public.free_justice_needs('c2180000-0000-4000-8000-000000000001')),
  'filed, the preparo is proposed, since Lia does not ask, and nothing is asked of the appeal any more'
);

-- ---------- The other firm: Bia asks alone ----------

select pg_temp.sign_in('a2180000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('b-decided', public.decide_judgment_path(
  (select id from public.judgment_paths where proceeding_id = 'f2180000-0000-4000-8000-000000000002'), 'recurso_inominado', null));
insert into res values ('bia-yes', public.record_free_justice_answer('c2180000-0000-4000-8000-000000000002',
  'e2180000-0000-4000-8000-000000000003', true, 'Bia disse ao telefone hoje.', null));
insert into res values ('rocha-reads', public.case_free_justice('c2180000-0000-4000-8000-000000000001'));
select throws_ok(
  $$ select public.record_free_justice_answer('c2180000-0000-4000-8000-000000000001',
       'e2180000-0000-4000-8000-000000000002', true, 'Tentativa de outra firma.', null) $$,
  'P0002', null,
  'another firm records nothing in the case'
);
reset role;
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_name, template_body, mode, status, version,
                                checked_version, piece_kind, approved_version, approved_body, approved_at, filed_at, filed_how)
values ('ac218000-0000-4000-8000-000000000002', 'b2180000-0000-4000-8000-00000000000b', 'c2180000-0000-4000-8000-000000000002',
        'f2180000-0000-4000-8000-000000000002', 'Recurso', 'Texto do modelo do recurso.', 'ai', 'issued', 1, 1, 'recurso',
        1, 'Texto do recurso da Bia.', now(), null, null);
update public.case_drafts set filed_at = now(), filed_how = 'lawyer' where id = 'ac218000-0000-4000-8000-000000000002';
select ok(
  (select value ->> 'code' = 'decided' from res where key = 'b-decided')
    and (select value ->> 'ok' = 'true' from res where key = 'bia-yes')
    and not exists (select 1 from public.deadlines d
                    where d.proceeding_id = 'f2180000-0000-4000-8000-000000000002' and d.act = 'preparo_recurso_inominado')
    and (select value ->> 'code' = 'case_not_found' from res where key = 'rocha-reads'),
  'where every claimant asks free justice no preparo is proposed, and one firm reads nothing of the other''s case'
);

select * from finish();
rollback;
