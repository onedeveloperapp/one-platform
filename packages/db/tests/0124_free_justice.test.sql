begin;
create extension if not exists pgtap;
select plan(17);

-- ============================================================
-- A justiça gratuita da família na vara cível (0125). Rui and his son Pedro,
-- a minor, go to the civil court together. Each claimant's word on free
-- justice is asked of Rui, who answers for Pedro; while it is missing the
-- filing and the piece wait, and ONE's own approval of the piece waits
-- instead of giving up. Rui asks for both: one declaration for the father
-- and the son is due, filled with both, issued, and the filing waits for its
-- signature; signed, the filing goes. The firm then records that Pedro does
-- not ask: the declaration is ended and owed again for Rui alone. The piece
-- writes the request by name where the model puts its mark, and one without
-- the mark waits for a lawyer. A lawsuit of the small-claims court asks
-- nothing. Nothing of one firm reaches the other.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1240000-0000-4000-8000-000000000001', 'ana@lima-gratuita.invalid', 'Ana Lima'),
  ('a1240000-0000-4000-8000-000000000002', 'duda@rocha-gratuita.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1240000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-gratuita', 'a1240000-0000-4000-8000-000000000001'),
  ('b1240000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-gratuita', 'a1240000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1240000-0000-4000-8000-00000000000a', 'a1240000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1240000-0000-4000-8000-00000000000b', 'a1240000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status, family_choice) values
  ('c1240000-0000-4000-8000-000000000001', 'b1240000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay',
   'drafting', 'together');
insert into public.people (id, org_id, full_name, cpf, birth_date, nationality, marital_status, profession,
                           street, address_number, district, city, uf, postal_code) values
  ('d1240000-0000-4000-8000-000000000001', 'b1240000-0000-4000-8000-00000000000a', 'Rui Teste', '52998224725',
   '1980-01-01', 'brasileira', 'casado', 'Professor', 'Rua das Flores', '10', 'Centro', 'Goiânia', 'GO', '74000000'),
  ('d1240000-0000-4000-8000-000000000002', 'b1240000-0000-4000-8000-00000000000a', 'Pedro Teste', null,
   '2018-05-05', null, null, null, null, null, null, null, null, null);
insert into public.case_parties (id, org_id, case_id, person_id, role, guardian_id) values
  ('e1240000-0000-4000-8000-000000000001', 'b1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000001',
   'd1240000-0000-4000-8000-000000000001', 'claimant', null);
insert into public.case_parties (id, org_id, case_id, person_id, role, guardian_id) values
  ('e1240000-0000-4000-8000-000000000002', 'b1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000001',
   'd1240000-0000-4000-8000-000000000002', 'claimant', 'e1240000-0000-4000-8000-000000000001');
insert into public.client_links (id, org_id, case_id, person_id, token_hash, expires_at, finished_at) values
  ('a7240000-0000-4000-8000-000000000001', 'b1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000001',
   'd1240000-0000-4000-8000-000000000001', encode(sha256(convert_to('token-do-rui-gratuita', 'UTF8')), 'hex'),
   now() + interval '30 days', now());
-- The family's lawsuit in the civil court, its system approved, and a small-claims one of nobody's family.
insert into public.proceedings (id, org_id, case_id, kind, court, status) values
  ('f1240000-0000-4000-8000-000000000001', 'b1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000001',
   'comum', 'TJGO', 'planned');
update public.proceedings set system = 'projudi', system_approved_at = now(), system_approved_by = 'a1240000-0000-4000-8000-000000000001'
where id = 'f1240000-0000-4000-8000-000000000001';
insert into public.proceeding_parties (proceeding_id, party_id, org_id) values
  ('f1240000-0000-4000-8000-000000000001', 'e1240000-0000-4000-8000-000000000001', 'b1240000-0000-4000-8000-00000000000a'),
  ('f1240000-0000-4000-8000-000000000001', 'e1240000-0000-4000-8000-000000000002', 'b1240000-0000-4000-8000-00000000000a');
-- Both said yes to the civil court, through Rui.
insert into public.civil_court_answers (org_id, case_id, party_id, person_id, accepted, wording, version, source, note)
select 'b1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000001', party, 'd1240000-0000-4000-8000-000000000001',
       true, repeat('Aceito que a ação seja proposta na vara cível. ', 2), 1, 'firm', 'Disse ao telefone hoje.'
from unnest(array['e1240000-0000-4000-8000-000000000001', 'e1240000-0000-4000-8000-000000000002']::uuid[]) party;

-- A piece of the lawsuit, the AI's first text with the request's marks, owed ONE's approval.
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_name, template_body, mode, status, version,
                                checked_version, auto_approval_owed)
values ('ac240000-0000-4000-8000-000000000001', 'b1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000001',
        'f1240000-0000-4000-8000-000000000001', 'Inicial', 'Texto do modelo da inicial.', 'ai', 'proposed', 1, 1, true);
-- The client confirmed the facts of the piece (0182): what this file reads is free justice alone.
insert into public.piece_fact_checks (org_id, case_id, draft_id, version, status, facts)
values ('b1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000001',
        'ac240000-0000-4000-8000-000000000001', 1, 'confirmed', 'Você comprou a passagem.');
insert into public.case_draft_versions (org_id, draft_id, version, author, body) values
  ('b1240000-0000-4000-8000-00000000000a', 'ac240000-0000-4000-8000-000000000001', 1, 'ai',
   E'I. DA GRATUIDADE DA JUSTIÇA\n\n[[GRATUIDADE]]\n\nIV. DOS PEDIDOS\n\ne) a produção de provas.\n\n[[PEDIDO_GRATUIDADE]]\n\nDá-se à causa o valor.');

create function pg_temp.sign_in(person uuid) returns void language sql as $$
  select set_config('request.jwt.claims', jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;
create function pg_temp.as_backend() returns void language sql as $$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role, anon;

-- ---------- Nobody answered yet ----------

select ok(
  public.filing_blocker('f1240000-0000-4000-8000-000000000001') = 'free_justice_unanswered'
    and public.case_draft_state_blocker('ac240000-0000-4000-8000-000000000001') = 'free_justice_unanswered',
  'the filing and the piece of the civil court wait for each claimant''s word on free justice'
);
select pg_temp.as_backend();
set local role service_role;
insert into res values ('auto-waits', public.approve_case_draft_unattended('ac240000-0000-4000-8000-000000000001'));
reset role;
select ok(
  (select value ->> 'code' = 'free_justice_unanswered' from res where key = 'auto-waits')
    and (select auto_approval_owed and status = 'proposed' from public.case_drafts where id = 'ac240000-0000-4000-8000-000000000001'),
  'ONE''s own approval of the piece waits for the answers instead of giving up'
);

set local role anon;
insert into res values ('link', public.client_link_free_justice('token-do-rui-gratuita'));
reset role;
select ok(
  (select jsonb_array_length(value -> 'items') = 2
     and value #>> '{items,0,name}' = 'Rui Teste' and value #>> '{items,1,name}' = 'Pedro Teste'
     and (value #>> '{items,1,minor}')::boolean and value -> 'items' -> 0 -> 'asks' = 'null'::jsonb
   from res where key = 'link'),
  'Rui''s link asks for himself and for Pedro, whom he answers for'
);

-- ---------- Rui asks for both ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('rui-yes', to_jsonb(public.client_link_answer_free_justice('token-do-rui-gratuita',
  'e1240000-0000-4000-8000-000000000001', true, '{"ip": "203.0.113.4"}')));
insert into res values ('pedro-yes', public.client_link_answer_free_justice('token-do-rui-gratuita',
  'e1240000-0000-4000-8000-000000000002', true, '{"ip": "203.0.113.4"}'));
reset role;
select ok(
  (select value ->> 'ok' = 'true' from res where key = 'rui-yes')
    and (select value ->> 'ok' = 'true' from res where key = 'pedro-yes')
    and (select count(*) = 2 and bool_and(source = 'client' and asks and person_id = 'd1240000-0000-4000-8000-000000000001'
                                          and evidence ->> 'ip' = '203.0.113.4' and evidence ->> 'channel' = 'link')
         from public.free_justice_answers where case_id = 'c1240000-0000-4000-8000-000000000001'),
  'he answers on his link for himself and for his son, each kept with what the server saw'
);
select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select throws_ok(
  $$ select public.client_link_answer_free_justice('token-do-rui-gratuita', 'e1240000-0000-4000-8000-000000000001', false) $$,
  '42501', null,
  'an answer reaches the database only through the backend'
);
reset role;

select ok(
  exists (select 1 from public.case_papers_due('c1240000-0000-4000-8000-000000000001') where kind = 'declaracao_hipossuficiencia'
          and person_id = 'd1240000-0000-4000-8000-000000000001')
    and public.free_justice_marks_filled('c1240000-0000-4000-8000-000000000001', 'd1240000-0000-4000-8000-000000000001',
          'para: [[GRATUIDADE_PARA]].')
        = 'para: Rui Teste, em nome próprio; Pedro Teste, menor de idade, por quem respondo.'
    and public.filing_blocker('f1240000-0000-4000-8000-000000000001') = 'free_justice_unsigned',
  'one declaration for the father and the son is due, naming both, and the filing waits for it signed'
);

-- ONE issues it from the platform's model.
update public.case_advances set claimed_at = now(), claims = claims + 1
where case_id = 'c1240000-0000-4000-8000-000000000001';
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, expires_at)
values ('a8240000-0000-4000-8000-0000000000aa', 'b1240000-0000-4000-8000-00000000000a', 'paper', 'org/x/declaracao',
        'declaracao.pdf', 'application/pdf', 100, 'reserved', now() + interval '1 hour');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('issued', public.advance_record_paper('c1240000-0000-4000-8000-000000000001',
  (select claims from public.case_advances where case_id = 'c1240000-0000-4000-8000-000000000001'),
  'd1240000-0000-4000-8000-000000000001', 'declaracao_hipossuficiencia',
  public.paper_template_for('b1240000-0000-4000-8000-00000000000a', 'declaracao_hipossuficiencia'),
  jsonb_build_object('file_id', 'a8240000-0000-4000-8000-0000000000aa', 'sha256', repeat('d', 64), 'bytes', '100', 'pages', '1')));
reset role;
select ok(
  (select value ->> 'code' = 'issued' from res where key = 'issued')
    and (select kind = 'free_justice_declaration' from public.case_documents
         where id = (select (value ->> 'document_id')::uuid from res where key = 'issued'))
    and (select strpos(body, '[[GRATUIDADE_PARA]]') > 0 and provisional and org_id is null
         from public.draft_templates where id = public.paper_template_for('b1240000-0000-4000-8000-00000000000a', 'declaracao_hipossuficiencia')),
  'ONE issues it from the platform''s model as a document of its own kind'
);

update public.signature_envelopes set status = 'signed',
  signed_document_id = (select (value ->> 'document_id')::uuid from res where key = 'issued')
where id = (select (value ->> 'envelope_id')::uuid from res where key = 'issued');
select is(public.filing_blocker('f1240000-0000-4000-8000-000000000001'), null,
  'signed, the filing of the family goes');

-- ---------- The piece writes the request ----------

select ok(
  strpos(public.case_draft_filled('ac240000-0000-4000-8000-000000000001',
    (select body from public.case_draft_versions where draft_id = 'ac240000-0000-4000-8000-000000000001')),
    'As partes autoras Rui Teste e Pedro Teste não têm condições de arcar com as custas') > 0
  and strpos(public.case_draft_filled('ac240000-0000-4000-8000-000000000001',
    (select body from public.case_draft_versions where draft_id = 'ac240000-0000-4000-8000-000000000001')),
    'Requer, por fim, a concessão da gratuidade da justiça a Rui Teste e Pedro Teste') > 0
  and public.case_draft_state_blocker('ac240000-0000-4000-8000-000000000001') is null,
  'the piece asks for free justice for both, by name, and nothing about it holds the approval'
);

-- A version with no mark, while somebody asks, waits for a lawyer to put it.
insert into public.case_draft_versions (org_id, draft_id, version, author, body) values
  ('b1240000-0000-4000-8000-00000000000a', 'ac240000-0000-4000-8000-000000000001', 2, 'person', 'Texto sem o pedido.');
update public.case_drafts set version = 2, checked_version = 2 where id = 'ac240000-0000-4000-8000-000000000001';
select is(public.case_draft_state_blocker('ac240000-0000-4000-8000-000000000001'), 'free_justice_mark_missing',
  'a piece without the mark of the request, while somebody asks, is not approved');

-- ---------- The firm records that Pedro does not ask ----------

select pg_temp.sign_in('a1240000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('stale', public.record_free_justice_answer('c1240000-0000-4000-8000-000000000001',
  'e1240000-0000-4000-8000-000000000002', false, 'Rui disse ao telefone.', null));
insert into res values ('pedro-no', public.record_free_justice_answer('c1240000-0000-4000-8000-000000000001',
  'e1240000-0000-4000-8000-000000000002', false, 'Rui disse ao telefone.',
  (select id from public.free_justice_answers where party_id = 'e1240000-0000-4000-8000-000000000002' and replaced_at is null)));
reset role;
select ok(
  (select value ->> 'code' = 'answer_changed' from res where key = 'stale')
    and (select value ->> 'ok' = 'true' from res where key = 'pedro-no')
    and not exists (select 1 from public.case_papers where kind = 'declaracao_hipossuficiencia')
    and (select count(*) >= 1 and bool_and(status = 'rejected') from public.case_documents where kind = 'free_justice_declaration')
    and public.free_justice_marks_filled('c1240000-0000-4000-8000-000000000001', 'd1240000-0000-4000-8000-000000000001',
          '[[GRATUIDADE_PARA]]') = 'Rui Teste, em nome próprio'
    and public.filing_blocker('f1240000-0000-4000-8000-000000000001') = 'free_justice_unsigned',
  'a changed answer ends the declaration (its PDFs go to no court) and a new one is owed for Rui alone'
);

-- ---------- A lawsuit of the small-claims court asks nothing ----------

insert into public.proceedings (id, org_id, case_id, kind, court, status) values
  ('f1240000-0000-4000-8000-000000000002', 'b1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'planned');
insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_name, template_body, mode, status, version, checked_version)
values ('ac240000-0000-4000-8000-000000000002', 'b1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000001',
        'f1240000-0000-4000-8000-000000000002', 'Inicial', 'Texto do modelo da inicial.', 'ai', 'proposed', 1, 1);
insert into public.piece_fact_checks (org_id, case_id, draft_id, version, status, facts)
values ('b1240000-0000-4000-8000-00000000000a', 'c1240000-0000-4000-8000-000000000001',
        'ac240000-0000-4000-8000-000000000002', 1, 'confirmed', 'Você comprou a passagem.');
insert into public.case_draft_versions (org_id, draft_id, version, author, body) values
  ('b1240000-0000-4000-8000-00000000000a', 'ac240000-0000-4000-8000-000000000002', 1, 'ai', E'A.\n\n[[GRATUIDADE]]\n\nB.');
select ok(
  public.case_draft_filled('ac240000-0000-4000-8000-000000000002', E'A.\n\n[[GRATUIDADE]]\n\nB.') = E'A.\n\nB.'
    and public.free_justice_blocker('f1240000-0000-4000-8000-000000000002') is null
    and public.free_justice_piece_blocker('ac240000-0000-4000-8000-000000000002') is null,
  'a lawsuit of the small-claims court asks nothing, and a mark of the request there leaves no blank lines'
);

select ok(
  (select strpos(body, '[[GRATUIDADE]]') > 0 and strpos(body, '[[PEDIDO_GRATUIDADE]]') > 0
     and strpos(body, 'confirmar quais partes autoras pedem a gratuidade') = 0
     and strpos(body, E'a) a citação da ré') > 0
   from public.draft_templates where org_id is null and document_kind = 'piece' and proceeding_kind = 'comum'),
  'the platform''s model of the civil court writes the request where the answers say'
);

-- ---------- Another firm ----------

select pg_temp.sign_in('a1240000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('rocha-reads', public.case_free_justice('c1240000-0000-4000-8000-000000000001'));
select throws_ok(
  $$ select public.record_free_justice_answer('c1240000-0000-4000-8000-000000000001',
       'e1240000-0000-4000-8000-000000000001', false, 'Tentativa de outra firma.', null) $$,
  'P0002', 'case_not_found',
  'nobody of another firm records an answer: the case is not there for them'
);
reset role;
select ok(
  (select value ->> 'code' = 'case_not_found' from res where key = 'rocha-reads')
    and not exists (select 1 from public.free_justice_answers where org_id = 'b1240000-0000-4000-8000-00000000000b'),
  'and reads nothing of it'
);

select ok(
  public.wait_owner('free_justice_unanswered') = 'client' and public.wait_owner('free_justice_unsigned') = 'client'
    and public.filing_types_ok('{"free_justice_declaration": "Declaração de hipossuficiência", "income_proof": "Comprovante de renda"}'),
  'whose each wait is, and the court''s types of the declaration and the proof of income'
);

select ok(
  (select count(*) = 1 and bool_and(strpos(system_prompt, '[[GRATUIDADE]] e [[PEDIDO_GRATUIDADE]]') > 0)
   from public.prompt_versions where task = 'caso.peca.minuta' and is_active),
  'the piece''s instructions in force keep the marks of the request, never written in the AI''s words'
);

select * from finish();
rollback;
