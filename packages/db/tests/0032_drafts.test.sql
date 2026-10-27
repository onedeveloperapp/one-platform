begin;
create extension if not exists pgtap;
select plan(67);

-- ============================================================
-- The piece of a lawsuit and the dossier of a case (0029). A firm keeps a
-- library of the sources a lawyer of its own checked, and models of its
-- pieces. A draft of a lawsuit is written from a model, by the AI or by a
-- lawyer, and is approved only when every source it cites is in that
-- library, its citations were read from the very text approved, and
-- nothing in it is left to fill in: in the firm's queue and on the case,
-- the same refusal. The approved text becomes the petition of its case.
-- Two firms: nothing of one reaches the other.
--
-- Every person, firm, company, CPF, CNPJ and number here is invented.
-- ============================================================

-- This file is about a firm's own library and models: the platform's (0045), which answer for every firm, are
-- taken out for its length (the transaction rolls back), and 0052 covers them.
delete from public.legal_sources where org_id is null;
delete from public.draft_templates where org_id is null;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('af100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('af100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('af100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@souza.invalid', '', now(), '{}', '{"display_name":"Caio Reis"}', now(), now()),
  ('af100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('af100000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'suporte@one.invalid', '', now(), '{}', '{"display_name":"Suporte"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('bf100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'af100000-0000-4000-8000-000000000001'),
  ('bf100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'af100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bf100000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('bf100000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('bf100000-0000-4000-8000-00000000000a', 'af100000-0000-4000-8000-000000000003', 'member', 'advogado'),
  ('bf100000-0000-4000-8000-00000000000b', 'af100000-0000-4000-8000-000000000004', 'owner', 'advogado');
insert into public.oab_registrations (user_id, uf, number, kind) values
  ('af100000-0000-4000-8000-000000000001', 'GO', '12345', 'principal'),
  ('af100000-0000-4000-8000-000000000004', 'GO', '99999', 'principal');
-- The company an airline answers in court by is what the operator recorded of it.
update public.airlines set legal_name = 'Companhia Aérea Exemplo S.A.', cnpj = '11222333000181' where iata = 'G3';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, session uuid default null, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level, 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- A file of a firm, stored as the backend measured it (as the service role).
create function pg_temp.stored(org uuid, purpose text, name text, mark text) returns uuid language plpgsql as $$
declare
  reserved jsonb := public.reserve_file(org, purpose, name, 'application/pdf', 40000);
begin
  perform public.confirm_file((reserved ->> 'file_id')::uuid, repeat(mark, 64), 40000, 'application/pdf', 3);
  return (reserved ->> 'file_id')::uuid;
end;
$$;
-- The backend claims one draft, whose wait after a passing failure is taken as over.
create function pg_temp.claim(draft uuid) returns integer language plpgsql as $$
declare
  claimed integer;
begin
  update public.case_drafts set work_after = null where id = draft;
  select c.claim into claimed from public.claim_case_drafts(1, draft) c;
  return claimed;
end;
$$;
-- A run of the task about a draft, finished with an answer (as the service role).
create function pg_temp.ran(org uuid, draft uuid, key text, output jsonb) returns jsonb language plpgsql as $$
declare
  started jsonb := public.start_ai_run(org, 'caso.peca.minuta', repeat('f', 64), null, 'case_draft', draft::text, key);
begin
  return public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded', output, 3000, 2000)
    || jsonb_build_object('run_id', started ->> 'run_id');
end;
$$;
-- The signature of a text: 128 numbers. The first `same` are the ones every signature here shares.
create function pg_temp.sig(seed integer default 0, same integer default 128) returns jsonb language sql as
$$ select jsonb_agg(case when g <= same then g else seed * 1000 + g end order by g) from generate_series(1, 128) g; $$;
-- What a worker read of a version.
create function pg_temp.read(version integer, citations jsonb, signature jsonb default null) returns jsonb language sql as
$$ select jsonb_build_object('version', version, 'citations', citations, 'signature', coalesce(signature, pg_temp.sig())); $$;
-- The latest text of a draft.
create function pg_temp.body(draft uuid) returns text language sql as
$$ select v.body from public.case_draft_versions v join public.case_drafts d on d.id = v.draft_id and d.version = v.version where d.id = draft; $$;

-- A lawyer approves what the preview showed: the version on the screen and the mark of its text.
create function pg_temp.approve(draft uuid) returns jsonb language plpgsql as $$
declare
  seen jsonb := public.preview_case_draft(draft);
begin
  return public.approve_case_draft(draft, (seen ->> 'version')::integer, seen ->> 'hash');
end;
$$;
-- A lawyer saves a text written on the latest version.
create function pg_temp.save(draft uuid, body text) returns jsonb language sql as
$$ select public.save_draft_version(draft, body, (select d.version from public.case_drafts d where d.id = draft)); $$;

create temporary table texts (name text primary key, body text);
grant select on texts to anon, authenticated, service_role;
insert into texts values
  ('model', E'EXCELENTÍSSIMO JUÍZO DO [[JUIZO]]\n\n[[PARTES]], por [[ADVOGADOS]], vem propor ação de indenização em face de [[RE]].\n\nDOS FATOS\n\nO voo atrasou. A companhia responde na forma do art. 14 da Lei nº 8078, e a Súmula 999 do STJ trata do dano.\n\nDOS PEDIDOS\n\nPede-se [[PEDIDO_POR_PARTE]]. Dá-se à causa o valor de [[VALOR_DA_CAUSA]].\n\n[[NOMES_DAS_PARTES]]'),
  ('with_mark', E'EXCELENTÍSSIMO JUÍZO DO [[JUIZO]]\n\n[[PARTES]], por [[ADVOGADOS]], vem propor ação de indenização em face de [[RE]].\n\nDOS FATOS\n\nO voo atrasou. A companhia responde na forma do art. 14 da Lei nº 8078. O prazo é [[PRAZO]].\n\nDOS PEDIDOS\n\nPede-se [[PEDIDO_POR_PARTE]]. Dá-se à causa o valor de [[VALOR_DA_CAUSA]].\n\n[[NOMES_DAS_PARTES]]'),
  ('clean', E'EXCELENTÍSSIMO JUÍZO DO [[JUIZO]]\n\n[[PARTES]], por [[ADVOGADOS]], vem propor ação de indenização em face de [[RE]].\n\nDOS FATOS\n\nO voo atrasou. A companhia responde na forma do art. 14 da Lei nº 8078.\n\nDOS PEDIDOS\n\nPede-se [[PEDIDO_POR_PARTE]]. Dá-se à causa o valor de [[VALOR_DA_CAUSA]].\n\n[[NOMES_DAS_PARTES]]');
create function pg_temp.text_of(name text) returns text language sql as
$$ select body from texts where texts.name = text_of.name; $$;

create temporary table cites (name text primary key, item jsonb);
grant select on cites to anon, authenticated, service_role;
insert into cites values
  ('cdc14', '{"kind": "lei", "issuer": "", "number": "8078", "article": "14", "raw": "art. 14 da Lei nº 8.078"}'),
  ('sumula999', '{"kind": "sumula", "issuer": "stj", "number": "999", "article": null, "raw": "Súmula 999 do STJ"}');
create function pg_temp.cited(variadic names text[]) returns jsonb language sql as
$$ select coalesce(jsonb_agg(c.item order by array_position(names, c.name)), '[]'::jsonb) from cites c where c.name = any (names); $$;

-- Three cases of firm A and one of firm B, each with a lawsuit not filed yet at the small-claims court of Goiás.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case1', public.create_case('bf100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('p1', public.save_proceeding(pg_temp.got('case1', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "system": "projudi"}'::jsonb,
  array[pg_temp.got('case1', 'party_id')::uuid], array['af100000-0000-4000-8000-000000000001'::uuid]));
insert into res values ('case2', public.create_case('bf100000-0000-4000-8000-00000000000a', 'cancellation', 'G3', date '2026-09-21',
  '{"full_name": "João Teste", "cpf": "98765432100", "birth_date": "1990-01-15"}'::jsonb));
insert into res values ('p2', public.save_proceeding(pg_temp.got('case2', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile"}'::jsonb,
  array[pg_temp.got('case2', 'party_id')::uuid], array['af100000-0000-4000-8000-000000000001'::uuid]));
insert into res values ('case3', public.create_case('bf100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-22',
  '{"full_name": "Lia Teste"}'::jsonb));
insert into res values ('p3', public.save_proceeding(pg_temp.got('case3', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia"}'::jsonb,
  array[pg_temp.got('case3', 'party_id')::uuid]));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('bf100000-0000-4000-8000-00000000000b', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Paulo Teste"}'::jsonb));
insert into res values ('p_b', public.save_proceeding(pg_temp.got('case_b', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia"}'::jsonb, array[pg_temp.got('case_b', 'party_id')::uuid]));
reset role;

-- ---------- The verified library ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('source_by_attendant', public.save_legal_source('bf100000-0000-4000-8000-00000000000a', null,
  '{"kind": "lei", "number": "8078", "article": "14", "title": "Responsabilidade do fornecedor de serviços", "source_url": "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm"}'::jsonb));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('cdc14', public.save_legal_source('bf100000-0000-4000-8000-00000000000a', null,
  '{"kind": "lei", "number": "8078", "article": "14", "title": "Responsabilidade do fornecedor de serviços", "quote": "O fornecedor de serviços responde, independentemente da existência de culpa", "source_url": "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm"}'::jsonb));
insert into res values ('anac400', public.save_legal_source('bf100000-0000-4000-8000-00000000000a', null,
  '{"kind": "resolucao", "issuer": "anac", "number": "400", "title": "Condições gerais de transporte aéreo", "source_url": "https://www.anac.gov.br/assuntos/legislacao/legislacao-1/resolucoes/resolucoes-2016/resolucao-no-400-13-12-2016"}'::jsonb));
insert into res values ('source_again', public.save_legal_source('bf100000-0000-4000-8000-00000000000a', null,
  '{"kind": "lei", "number": "8078", "article": "14", "title": "A mesma fonte", "source_url": "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm"}'::jsonb));
insert into res values ('source_no_issuer', public.save_legal_source('bf100000-0000-4000-8000-00000000000a', null,
  '{"kind": "sumula", "number": "999", "title": "Uma súmula sem tribunal", "source_url": "https://www.stj.jus.br/sumulas"}'::jsonb));
insert into res values ('source_article_of_sumula', public.save_legal_source('bf100000-0000-4000-8000-00000000000a', null,
  '{"kind": "sumula", "issuer": "STJ", "number": "999", "article": "2", "title": "Uma súmula com artigo", "source_url": "https://www.stj.jus.br/sumulas"}'::jsonb));
insert into res values ('source_decree_no_year', public.save_legal_source('bf100000-0000-4000-8000-00000000000a', null,
  '{"kind": "decreto", "number": "5910", "title": "Um decreto sem ano", "source_url": "https://www.planalto.gov.br/decreto"}'::jsonb));
insert into res values ('source_plain_http', public.save_legal_source('bf100000-0000-4000-8000-00000000000a', null,
  '{"kind": "lei", "number": "9099", "title": "Juizados especiais", "source_url": "http://www.planalto.gov.br/ccivil_03/leis/l9099.htm"}'::jsonb));
reset role;

select ok(
  pg_temp.got('source_by_attendant', 'code') = 'not_allowed'
  and pg_temp.got('cdc14', 'code') = 'verified' and pg_temp.got('anac400', 'code') = 'verified'
  and (select key = 'lei::8078#14' and citation = 'art. 14 da Lei nº 8.078' and status = 'verified'
              and verified_by = 'af100000-0000-4000-8000-000000000001'
       from public.legal_sources where id = pg_temp.got('cdc14', 'source_id')::uuid)
  and (select key = 'resolucao:ANAC:400' and citation = 'Resolução nº 400 da ANAC' and issuer = 'ANAC'
       from public.legal_sources where id = pg_temp.got('anac400', 'source_id')::uuid)
  and (select count(*) = 2 from public.audit_events where action = 'library.source_verified'),
  'a partner or a lawyer adds a source they checked to the firm''s library, under the key a citation of it is read into; who only attends cannot'
);
select ok(
  pg_temp.got('source_again', 'code') = 'already_in_library'
  and pg_temp.got('source_no_issuer', 'code') = 'invalid_source' and pg_temp.got('source_no_issuer', 'field') = 'issuer'
  and pg_temp.got('source_article_of_sumula', 'field') = 'article'
  and pg_temp.got('source_decree_no_year', 'field') = 'number'
  and pg_temp.got('source_plain_http', 'code') = 'invalid_data' and pg_temp.got('source_plain_http', 'field') = 'source_url'
  and (select count(*) = 2 from public.legal_sources),
  'a source is said once and as it is: a súmula with its court and no article, a decree with its year, an address that is the official one'
);
select ok(
  public.legal_source_covers('bf100000-0000-4000-8000-00000000000a', 'lei', '', '8078', '14')
  and public.legal_source_covers('bf100000-0000-4000-8000-00000000000a', 'lei', '', '8078', null)
  and not public.legal_source_covers('bf100000-0000-4000-8000-00000000000a', 'lei', '', '8078', '6')
  and not public.legal_source_covers('bf100000-0000-4000-8000-00000000000a', 'artigo', '', '', '14')
  and public.legal_source_covers('bf100000-0000-4000-8000-00000000000a', 'resolucao', 'anac', '400', null)
  and not public.legal_source_covers('bf100000-0000-4000-8000-00000000000a', 'resolucao', 'ANAC', '400', '21')
  and not public.legal_source_covers('bf100000-0000-4000-8000-00000000000b', 'lei', '', '8078', '14'),
  'the library answers for the very article that was checked and for the norm it is of, never for another article, for an article with no norm, or for another firm'
);

select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('retire_no_reason', public.retire_legal_source(pg_temp.got('anac400', 'source_id')::uuid, ' '));
insert into res values ('retire', public.retire_legal_source(pg_temp.got('anac400', 'source_id')::uuid, 'A resolução foi alterada.'));
reset role;
select ok(
  pg_temp.got('retire_no_reason', 'code') = 'reason_required' and pg_temp.got('retire', 'code') = 'retired'
  and (select status = 'retired' and retired_by = 'af100000-0000-4000-8000-000000000003' and retired_reason = 'A resolução foi alterada.'
       from public.legal_sources where id = pg_temp.got('anac400', 'source_id')::uuid)
  and not public.legal_source_covers('bf100000-0000-4000-8000-00000000000a', 'resolucao', 'ANAC', '400', null),
  'a lawyer retires a source with the reason, and the library stops answering for it'
);
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('back', public.save_legal_source('bf100000-0000-4000-8000-00000000000a', null,
  '{"kind": "resolucao", "issuer": "ANAC", "number": "400", "title": "Condições gerais de transporte aéreo, conferida de novo", "source_url": "https://www.anac.gov.br/assuntos/legislacao/legislacao-1/resolucoes/resolucoes-2016/resolucao-no-400-13-12-2016"}'::jsonb));
insert into res values ('retitled', public.save_legal_source('bf100000-0000-4000-8000-00000000000a', pg_temp.got('cdc14', 'source_id')::uuid,
  '{"title": "Responsabilidade objetiva do fornecedor de serviços", "source_url": "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm"}'::jsonb));
reset role;
select ok(
  pg_temp.got('back', 'code') = 'verified' and pg_temp.got('back', 'source_id') = pg_temp.got('anac400', 'source_id')
  and (select status = 'verified' and retired_at is null and retired_reason is null and verified_by = 'af100000-0000-4000-8000-000000000003'
       from public.legal_sources where id = pg_temp.got('anac400', 'source_id')::uuid)
  and pg_temp.got('retitled', 'code') = 'saved'
  and (select title = 'Responsabilidade objetiva do fornecedor de serviços' and key = 'lei::8078#14' and quote is null
       from public.legal_sources where id = pg_temp.got('cdc14', 'source_id')::uuid),
  'said again, a retired source is back, verified by who says so now; what the firm wrote about a source changes, what the source is does not'
);

select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('retire_other_firm', public.retire_legal_source(pg_temp.got('cdc14', 'source_id')::uuid, 'Não é do meu escritório.'));
insert into res values ('seen_by_b', jsonb_build_object('sources', (select count(*) from public.legal_sources)));
select throws_ok(
  $$select public.save_legal_source('bf100000-0000-4000-8000-00000000000a', null,
      '{"kind": "lei", "number": "9099", "title": "Juizados especiais", "source_url": "https://www.planalto.gov.br/ccivil_03/leis/l9099.htm"}'::jsonb)$$,
  '42501', 'not_authorized', 'nobody adds a source to the library of another firm'
);
reset role;
select ok(
  pg_temp.got('retire_other_firm', 'code') = 'not_found' and pg_temp.got('seen_by_b', 'sources') = '0'
  and (select status = 'verified' from public.legal_sources where id = pg_temp.got('cdc14', 'source_id')::uuid),
  'and nobody reads or retires one of it'
);

-- ---------- The firm's models ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('template_by_attendant', public.save_draft_template('bf100000-0000-4000-8000-00000000000a', null,
  jsonb_build_object('name', 'Petição inicial', 'proceeding_kind', 'juizado', 'body', pg_temp.text_of('model'))));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('template', public.save_draft_template('bf100000-0000-4000-8000-00000000000a', null,
  jsonb_build_object('name', 'Petição inicial', 'proceeding_kind', 'juizado', 'body', pg_temp.text_of('model'))));
insert into res values ('template_same_name', public.save_draft_template('bf100000-0000-4000-8000-00000000000a', null,
  jsonb_build_object('name', '  petição INICIAL ', 'body', pg_temp.text_of('model'))));
insert into res values ('template_short', public.save_draft_template('bf100000-0000-4000-8000-00000000000a', null,
  jsonb_build_object('name', 'Curta', 'body', 'Pouco texto.')));
insert into res values ('template_bad_kind', public.save_draft_template('bf100000-0000-4000-8000-00000000000a', null,
  jsonb_build_object('name', 'Outra', 'proceeding_kind', 'trabalhista', 'body', pg_temp.text_of('model'))));
reset role;
update public.platform_settings set value = jsonb_set(value, '{max_templates}', '1') where key = 'drafts';
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('template_too_many', public.save_draft_template('bf100000-0000-4000-8000-00000000000a', null,
  jsonb_build_object('name', 'Contestação', 'body', pg_temp.text_of('model'))));
reset role;
update public.platform_settings set value = jsonb_set(value, '{max_templates}', '40') where key = 'drafts';
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('template_b', public.save_draft_template('bf100000-0000-4000-8000-00000000000b', null,
  jsonb_build_object('name', 'Petição inicial', 'body', pg_temp.text_of('clean'))));
insert into res values ('template_change_other_firm', public.save_draft_template('bf100000-0000-4000-8000-00000000000b',
  pg_temp.got('template', 'template_id')::uuid, jsonb_build_object('name', 'Tomada', 'body', pg_temp.text_of('clean'))));
insert into res values ('template_remove_other_firm', public.remove_draft_template(pg_temp.got('template', 'template_id')::uuid));
insert into res values ('templates_seen_by_b', jsonb_build_object('n', (select count(*) from public.draft_templates)));
reset role;
select ok(
  pg_temp.got('template_by_attendant', 'code') = 'not_allowed' and pg_temp.got('template', 'code') = 'saved'
  and pg_temp.got('template_same_name', 'code') = 'name_in_use'
  and pg_temp.got('template_short', 'field') = 'body' and pg_temp.got('template_bad_kind', 'field') = 'proceeding_kind'
  and pg_temp.got('template_too_many', 'code') = 'too_many_templates',
  'a partner or a lawyer writes the firm''s models: one name each, a kind of proceeding that exists, as many as the setting allows'
);
select ok(
  pg_temp.got('template_b', 'code') = 'saved'
  and pg_temp.got('template_change_other_firm', 'code') = 'not_found' and pg_temp.got('template_remove_other_firm', 'code') = 'not_found'
  and pg_temp.got('templates_seen_by_b', 'n') = '1'
  and (select name = 'Petição inicial' and body = pg_temp.text_of('model') from public.draft_templates where id = pg_temp.got('template', 'template_id')::uuid),
  'each firm has its own models, and the same name in two firms is two models'
);

-- ---------- A draft started from the model as it is ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ask_bad_mode', public.request_case_draft(pg_temp.got('p1', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'ditado'));
insert into res values ('ask_other_template', public.request_case_draft(pg_temp.got('p1', 'proceeding_id')::uuid, pg_temp.got('template_b', 'template_id')::uuid, 'blank'));
insert into res values ('d1', public.request_case_draft(pg_temp.got('p1', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'blank'));
reset role;
select ok(
  pg_temp.got('ask_bad_mode', 'field') = 'mode' and pg_temp.got('ask_other_template', 'code') = 'template_not_found'
  and pg_temp.got('d1', 'code') = 'requested'
  and (select status = 'proposed' and mode = 'blank' and version = 1 and work = 'check' and checked_version is null
              and template_name = 'Petição inicial' and template_body = pg_temp.text_of('model')
              and requested_by = 'af100000-0000-4000-8000-000000000002'
       from public.case_drafts where id = pg_temp.got('d1', 'draft_id')::uuid)
  and (select author = 'template' and body = pg_temp.text_of('model') and signature is null
       from public.case_draft_versions where draft_id = pg_temp.got('d1', 'draft_id')::uuid and version = 1)
  and (select count(*) = 1 from public.case_events where kind = 'draft_requested' and case_id = pg_temp.got('case1', 'case_id')::uuid),
  'anybody of the firm asks for the piece of a lawsuit from a model of the firm: started as the model itself, its citations are still to be read'
);
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  format('select public.request_case_draft(%L, %L, %L)', pg_temp.got('p1', 'proceeding_id'), pg_temp.got('template_b', 'template_id'), 'blank'),
  'P0002', 'case_not_found', 'nobody asks for a piece of a lawsuit of another firm'
);
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('approve_unread', pg_temp.approve(pg_temp.got('d1', 'draft_id')::uuid));
insert into res values ('today_blank', public.firm_today('bf100000-0000-4000-8000-00000000000a'));
select throws_ok(
  format('select * from public.claim_case_drafts(1, %L)', pg_temp.got('d1', 'draft_id')),
  '42501', null, 'only the backend claims the work on a draft'
);
reset role;
select ok(
  pg_temp.got('approve_unread', 'code') = 'citations_not_checked' and pg_temp.got('today_blank', 'drafts_waiting') = '1'
  and pg_temp.got('today_blank', 'approvals_waiting') = '0',
  'a text whose citations nobody read is not approved; it waits for a lawyer, and the home says so'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('d1_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d1', 'draft_id')::uuid)));
insert into res values ('d1_work_wrong', jsonb_build_object('n',
  (select count(*) from public.case_draft_to_work(pg_temp.got('d1', 'draft_id')::uuid, 7))));
insert into res values ('d1_work', (select to_jsonb(w) from public.case_draft_to_work(pg_temp.got('d1', 'draft_id')::uuid, 1) w));
insert into res values ('d1_read_bad', public.record_draft_work(pg_temp.got('d1', 'draft_id')::uuid, 1, 'checked', null, null,
  jsonb_build_object('version', 1, 'citations', '[{"kind": "boato"}]'::jsonb, 'signature', pg_temp.sig())));
insert into res values ('d1_read', public.record_draft_work(pg_temp.got('d1', 'draft_id')::uuid, 1, 'checked', null, null,
  pg_temp.read(1, pg_temp.cited('cdc14', 'sumula999'))));
insert into res values ('d1_read_again', public.record_draft_work(pg_temp.got('d1', 'draft_id')::uuid, 1, 'checked', null, null,
  pg_temp.read(1, pg_temp.cited('cdc14'))));
reset role;
select ok(
  pg_temp.got('d1_claim', 'claim') = '1' and pg_temp.got('d1_work_wrong', 'n') = '0'
  and pg_temp.got('d1_work', 'work') = 'check' and pg_temp.got('d1_work', 'body') = pg_temp.text_of('model')
  and pg_temp.got('d1_work', 'template') is null and pg_temp.got('d1_work', 'facts') is null
  and pg_temp.got('d1_read_bad', 'code') = 'invalid_payload'
  and pg_temp.got('d1_read', 'code') = 'checked' and pg_temp.got('d1_read', 'citations') = '2'
  and pg_temp.got('d1_read_again', 'code') = 'not_working'
  and (select checked_version = 1 and work is null and work_claimed_at is null from public.case_drafts where id = pg_temp.got('d1', 'draft_id')::uuid)
  and (select array_agg(key order by position) = array['lei::8078#14', 'sumula:STJ:999']
       from public.case_draft_citations where draft_id = pg_temp.got('d1', 'draft_id')::uuid and version = 1)
  and (select cardinality(signature) = 128 from public.case_draft_versions where draft_id = pg_temp.got('d1', 'draft_id')::uuid and version = 1),
  'the worker that holds the claim hands over what it read of the text; each citation is kept under the key the database gives it, once'
);

select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('approve_unverified', pg_temp.approve(pg_temp.got('d1', 'draft_id')::uuid));
reset role;
select is(pg_temp.got('approve_unverified', 'code'), 'citations_not_verified',
  'a draft that cites a source outside the firm''s verified library is not approved');

-- A lawyer writes on it: a new version each time, read again before anybody approves it.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('edit_by_attendant', pg_temp.save(pg_temp.got('d1', 'draft_id')::uuid, pg_temp.text_of('with_mark')));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('edit_short', pg_temp.save(pg_temp.got('d1', 'draft_id')::uuid, 'Pouco.'));
insert into res values ('edit_long', pg_temp.save(pg_temp.got('d1', 'draft_id')::uuid, repeat('a', 150001)));
insert into res values ('edit', pg_temp.save(pg_temp.got('d1', 'draft_id')::uuid, replace(pg_temp.text_of('with_mark'), E'\n', E'\r\n')));
insert into res values ('edit_same', pg_temp.save(pg_temp.got('d1', 'draft_id')::uuid, pg_temp.text_of('with_mark')));
insert into res values ('approve_edited_unread', pg_temp.approve(pg_temp.got('d1', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('cancel_edited_by_attendant', public.cancel_case_draft(pg_temp.got('d1', 'draft_id')::uuid));
insert into res values ('ask_over_text', public.request_case_draft(pg_temp.got('p1', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'ai'));
reset role;
select ok(
  pg_temp.got('edit_by_attendant', 'code') = 'not_allowed'
  and pg_temp.got('edit_short', 'code') = 'invalid_data' and pg_temp.got('edit_long', 'code') = 'too_long'
  and pg_temp.got('edit', 'code') = 'saved' and pg_temp.got('edit', 'version') = '2'
  and pg_temp.got('edit_same', 'code') = 'unchanged'
  and pg_temp.got('approve_edited_unread', 'code') = 'citations_not_checked'
  -- A text a lawyer worked on is given up by who signs, and is never replaced by asking for another.
  and pg_temp.got('cancel_edited_by_attendant', 'code') = 'not_allowed' and pg_temp.got('ask_over_text', 'code') = 'draft_in_course'
  and (select version = 2 and checked_version = 1 and work = 'check' from public.case_drafts where id = pg_temp.got('d1', 'draft_id')::uuid)
  and (select author = 'person' and author_id = 'af100000-0000-4000-8000-000000000003' and body = pg_temp.text_of('with_mark')
       from public.case_draft_versions where draft_id = pg_temp.got('d1', 'draft_id')::uuid and version = 2)
  and (select body = pg_temp.text_of('model') from public.case_draft_versions where draft_id = pg_temp.got('d1', 'draft_id')::uuid and version = 1),
  'a partner or a lawyer edits the text: a new version, the one before kept as it was, and what was read of the old text approves nothing of the new'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('d1_claim2', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d1', 'draft_id')::uuid)));
insert into res values ('d1_read_stale', public.record_draft_work(pg_temp.got('d1', 'draft_id')::uuid, 2, 'checked', null, null,
  pg_temp.read(1, pg_temp.cited('cdc14'))));
insert into res values ('d1_after_stale', (select jsonb_build_object('work', work, 'held', work_claimed_at is not null, 'checked', checked_version)
  from public.case_drafts where id = pg_temp.got('d1', 'draft_id')::uuid));
insert into res values ('d1_claim3', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d1', 'draft_id')::uuid)));
insert into res values ('d1_read2', public.record_draft_work(pg_temp.got('d1', 'draft_id')::uuid, 3, 'checked', null, null,
  pg_temp.read(2, pg_temp.cited('cdc14'))));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('approve_unknown_mark', pg_temp.approve(pg_temp.got('d1', 'draft_id')::uuid));
insert into res values ('edit3', pg_temp.save(pg_temp.got('d1', 'draft_id')::uuid, pg_temp.text_of('clean')));
reset role;
select ok(
  pg_temp.got('d1_claim2', 'claim') = '2' and pg_temp.got('d1_read_stale', 'code') = 'stale_version'
  and pg_temp.got('d1_after_stale', 'work') = 'check' and pg_temp.got('d1_after_stale', 'held') = 'false'
  and pg_temp.got('d1_after_stale', 'checked') = '1'
  and pg_temp.got('d1_claim3', 'claim') = '3' and pg_temp.got('d1_read2', 'code') = 'checked'
  and pg_temp.got('approve_unknown_mark', 'code') = 'unknown_mark' and pg_temp.got('edit3', 'version') = '3',
  'a reading of a version that is no longer the latest is not the draft''s, and its work stays owed; a mark the platform does not know blocks the approval'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('d1_claim4', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d1', 'draft_id')::uuid)));
insert into res values ('d1_read3', public.record_draft_work(pg_temp.got('d1', 'draft_id')::uuid, 4, 'checked', null, null,
  pg_temp.read(3, pg_temp.cited('cdc14'))));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('approve_incomplete', pg_temp.approve(pg_temp.got('d1', 'draft_id')::uuid));
insert into res values ('preview_incomplete', public.preview_case_draft(pg_temp.got('d1', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('approve_incomplete', 'code') = 'draft_incomplete'
  and pg_temp.got('preview_incomplete', 'blocker') = 'draft_incomplete'
  and pg_temp.got('preview_incomplete', 'text') like '%[COMPLETAR: nacionalidade de Maria Teste]%'
  and pg_temp.got('preview_incomplete', 'text') like '%[COMPLETAR: endereço de Maria Teste]%'
  -- A claimant with no Valor da Causa Pedido asks what the court arbitrates: nothing to fill in (0064).
  and pg_temp.got('preview_incomplete', 'text') like '%Maria Teste: o valor que este Juízo arbitrar. Dá-se à causa o valor que este Juízo arbitrar.%'
  and pg_temp.got('preview_incomplete', 'text') not like '%[COMPLETAR: valor%'
  and pg_temp.got('preview_incomplete', 'text') like '%CPF nº 123.456.789-09%'
  and pg_temp.got('preview_incomplete', 'text') not like '%[[%',
  'the facts of the lawsuit are written in by the database, and one that is not on record is left to fill in, which keeps the piece from being approved'
);

select ok(
  public.case_draft_text_blocker('Pede-se [[PARTES]] e [[PRAZO]].') = 'unknown_mark'
  and public.case_draft_text_blocker('Uma marca escrita errada: [[PARTES].') = 'unknown_mark'
  and public.case_draft_text_blocker('Outra: PARTES]] ' || repeat('x', 80)) = 'unknown_mark'
  and public.case_draft_text_blocker('O voo de [ Completar : a data] atrasou.') = 'draft_incomplete'
  -- A character the document cannot write: the PDF would say something else than the text approved.
  and public.case_draft_text_blocker('Atraso ' || chr(8805) || ' 4 horas.') = 'unwritable_characters'
  and public.unwritable_characters('Atraso ' || chr(8805) || ' 4h, ' || chr(8594) || ' ' || chr(8805) || ' e ' || chr(146)) = array[chr(146), chr(8594), chr(8805)]
  -- What people paste and the renderer writes in its plain form passes: curly quotes, dashes, the ellipsis,
  -- a ligature, a space that does not break; and an accent written apart from its letter.
  and public.case_draft_text_blocker(chr(8220) || 'Dano' || chr(8221) || ' ' || chr(8211) || ' ' || chr(8212) || ' '
        || chr(8230) || ' con' || chr(64257) || 'gurado' || chr(160) || 'art. 5' || chr(186) || chr(8209) || 'A, a' || chr(769) || 'rea' || E'\n\tfim') is null
  and public.case_draft_text_blocker('Um texto simples, com acentuação e cedilha: não há o que barrar.') is null,
  'a text is no piece while a mark is left in it (also one written wrong), while something is left to fill in, or while its document could not write a character of it'
);

-- The facts that were missing, put on record.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('maria', public.save_case_person(pg_temp.got('case1', 'case_id')::uuid, pg_temp.got('case1', 'person_id')::uuid,
  '{"nationality": "brasileira", "marital_status": "casado", "profession": "professora", "postal_code": "74000000", "street": "Rua das Flores", "address_number": "10", "district": "Centro", "city": "Goiânia", "uf": "GO"}'::jsonb));
select public.set_party_claim(pg_temp.got('case1', 'case_id')::uuid, pg_temp.got('case1', 'party_id')::uuid, 1000000);
reset role;

select pg_temp.sign_in('af100000-0000-4000-8000-000000000001', null, 'aal1');
set local role authenticated;
select throws_ok(
  format('select pg_temp.approve(%L)', pg_temp.got('d1', 'draft_id')),
  '42501', 'second_factor_required', 'a draft is approved with the second factor'
);
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('approve_by_attendant', pg_temp.approve(pg_temp.got('d1', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('approve_other_firm', pg_temp.approve(pg_temp.got('d1', 'draft_id')::uuid));
insert into res values ('preview_other_firm', public.preview_case_draft(pg_temp.got('d1', 'draft_id')::uuid));
reset role;
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('af100000-0000-4000-8000-000000000009', 'af100000-0000-4000-8000-000000000001', 'bf100000-0000-4000-8000-00000000000a',
        'Conferindo as minutas', 'ff100000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001', 'ff100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select pg_temp.approve(%L)', pg_temp.got('d1', 'draft_id')),
  '42501', 'not_allowed_in_support_session', 'a support visit approves nothing'
);
select throws_ok(
  format('select public.request_case_draft(%L, %L, %L)', pg_temp.got('p3', 'proceeding_id'), pg_temp.got('template', 'template_id'), 'ai'),
  '42501', 'not_allowed_in_support_session', 'asks for no piece'
);
select throws_ok(
  format('select pg_temp.save(%L, %L)', pg_temp.got('d1', 'draft_id'), pg_temp.text_of('model')),
  '42501', 'not_allowed_in_support_session', 'edits none'
);
select throws_ok(
  $$select public.save_legal_source('bf100000-0000-4000-8000-00000000000a', null,
      '{"kind": "lei", "number": "9099", "title": "Juizados especiais", "source_url": "https://www.planalto.gov.br/ccivil_03/leis/l9099.htm"}'::jsonb)$$,
  '42501', 'not_allowed_in_support_session', 'verifies no source'
);
select throws_ok(
  format('select public.request_dossier(%L)', pg_temp.got('case1', 'case_id')),
  '42501', 'not_allowed_in_support_session', 'and asks for no dossier'
);
reset role;

select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('approve', pg_temp.approve(pg_temp.got('d1', 'draft_id')::uuid));
insert into res values ('ask_while_issuing', public.request_case_draft(pg_temp.got('p1', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'blank'));
insert into res values ('edit_approved', pg_temp.save(pg_temp.got('d1', 'draft_id')::uuid, pg_temp.text_of('model')));
insert into res values ('cancel_approved', public.cancel_case_draft(pg_temp.got('d1', 'draft_id')::uuid));
insert into res values ('preview_approved', public.preview_case_draft(pg_temp.got('d1', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('approve_by_attendant', 'code') = 'not_allowed' and pg_temp.got('approve_other_firm', 'code') = 'draft_not_found'
  and pg_temp.got('preview_other_firm', 'code') = 'draft_not_found'
  and pg_temp.got('approve', 'code') = 'approved'
  and (select status = 'approved' and approved_version = 3 and approved_by = 'af100000-0000-4000-8000-000000000001'
              and approved_at is not null and work = 'issue'
       from public.case_drafts where id = pg_temp.got('d1', 'draft_id')::uuid)
  and (select count(*) = 1 from public.audit_events where action = 'draft.approved' and entity_id = pg_temp.got('d1', 'draft_id'))
  and (select count(*) = 1 from public.case_events where kind = 'draft_approved' and case_id = pg_temp.got('case1', 'case_id')::uuid),
  'a partner or a lawyer of the firm approves the draft once nothing blocks it; nobody else does'
);
select ok(
  (select approved_body like '%MARIA TESTE, nacionalidade brasileira, pessoa casada, profissão professora, CPF nº 123.456.789-09, com endereço em Rua das Flores, nº 10, Centro, Goiânia/GO, CEP 74000-000%'
          and approved_body like '%EXCELENTÍSSIMO JUÍZO DO Juizado Especial Cível da Comarca de Goiânia%'
          and approved_body like '%por Ana Souza, OAB/GO 12345, vem propor%'
          and approved_body like '%em face de Companhia Aérea Exemplo S.A., CNPJ nº 11.222.333/0001-81.%'
          and approved_body like '%Pede-se Maria Teste: R$ 10.000,00. Dá-se à causa o valor de R$ 10.000,00.%'
          and approved_body like E'%\n\nMARIA TESTE'
          and approved_body not like '%[[%' and approved_body not like '%COMPLETAR%'
   from public.case_drafts where id = pg_temp.got('d1', 'draft_id')::uuid)
  and pg_temp.got('preview_approved', 'code') = 'approved'
  and pg_temp.got('preview_approved', 'text') = (select approved_body from public.case_drafts where id = pg_temp.got('d1', 'draft_id')::uuid),
  'the text approved has the facts of the lawsuit written in as they were on record that day: the parties, the court, the company, what is asked and who signs'
);
select ok(
  pg_temp.got('ask_while_issuing', 'code') = 'draft_being_issued' and pg_temp.got('edit_approved', 'code') = 'not_editable'
  and pg_temp.got('cancel_approved', 'code') = 'not_editable',
  'an approved draft is no longer edited, given up or replaced: its document is being made'
);

-- ---------- The approved text becomes the petition of its case ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('d1_claim5', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d1', 'draft_id')::uuid)));
insert into res values ('d1_issue_work', (select to_jsonb(w) from public.case_draft_to_work(pg_temp.got('d1', 'draft_id')::uuid, 5) w));
insert into res values ('files', jsonb_build_object(
  'petition', (public.reserve_file('bf100000-0000-4000-8000-00000000000a', 'petition', 'Petição inicial, caso 1, juizado especial.pdf', 'application/pdf', 40000) ->> 'file_id'),
  'petition_b', (public.reserve_file('bf100000-0000-4000-8000-00000000000b', 'petition', 'peca.pdf', 'application/pdf', 40000) ->> 'file_id'),
  'upload', (public.reserve_file('bf100000-0000-4000-8000-00000000000a', 'upload', 'outra.pdf', 'application/pdf', 40000) ->> 'file_id')
));
insert into res values ('issue_bad_payload', public.record_draft_work(pg_temp.got('d1', 'draft_id')::uuid, 5, 'issued', null, null,
  jsonb_build_object('file_id', pg_temp.got('files', 'petition'), 'sha256', 'curto', 'bytes', 40000)));
insert into res values ('issue_other_firm', public.record_draft_work(pg_temp.got('d1', 'draft_id')::uuid, 5, 'issued', null, null,
  jsonb_build_object('file_id', pg_temp.got('files', 'petition_b'), 'sha256', repeat('a', 64), 'bytes', 40000, 'pages', 3)));
insert into res values ('issue_other_purpose', public.record_draft_work(pg_temp.got('d1', 'draft_id')::uuid, 5, 'issued', null, null,
  jsonb_build_object('file_id', pg_temp.got('files', 'upload'), 'sha256', repeat('a', 64), 'bytes', 40000, 'pages', 3)));
insert into res values ('issue', public.record_draft_work(pg_temp.got('d1', 'draft_id')::uuid, 5, 'issued', null, null,
  jsonb_build_object('file_id', pg_temp.got('files', 'petition'), 'sha256', repeat('a', 64), 'bytes', 40000, 'pages', 3)));
insert into res values ('issue_again', public.record_draft_work(pg_temp.got('d1', 'draft_id')::uuid, 5, 'issued', null, null,
  jsonb_build_object('file_id', pg_temp.got('files', 'petition'), 'sha256', repeat('a', 64), 'bytes', 40000, 'pages', 3)));
reset role;
select ok(
  pg_temp.got('d1_issue_work', 'work') = 'issue'
  and pg_temp.got('d1_issue_work', 'body') = (select approved_body from public.case_drafts where id = pg_temp.got('d1', 'draft_id')::uuid)
  and pg_temp.got('d1_issue_work', 'title') = 'Petição inicial, caso 1, juizado especial'
  and pg_temp.got('d1_issue_work', 'firm') = 'Souza Advogados'
  and pg_temp.got('issue_bad_payload', 'code') = 'invalid_payload'
  and pg_temp.got('issue_other_firm', 'code') = 'file_not_found' and pg_temp.got('issue_other_purpose', 'code') = 'file_not_found'
  and pg_temp.got('issue', 'code') = 'issued' and pg_temp.got('issue_again', 'code') = 'not_working',
  'the worker makes the PDF of the approved text at a place reserved for the firm''s pieces; a file of another firm or of another purpose is not taken'
);
select ok(
  (select status = 'issued' and work is null and document_id = pg_temp.got('issue', 'document_id')::uuid
   from public.case_drafts where id = pg_temp.got('d1', 'draft_id')::uuid)
  and (select kind = 'petition' and status = 'accepted' and source = 'firm' and processing = 'skipped'
              and decided_by = 'af100000-0000-4000-8000-000000000001' and file_id = pg_temp.got('files', 'petition')::uuid
              and case_id = pg_temp.got('case1', 'case_id')::uuid
       from public.case_documents where id = pg_temp.got('issue', 'document_id')::uuid)
  and (select status = 'stored' and sha256 = repeat('a', 64) and pages = 3 and purpose = 'petition'
       from public.files where id = pg_temp.got('files', 'petition')::uuid)
  and (select status = 'reserved' from public.files where id = pg_temp.got('files', 'petition_b')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'draft_issued' and actor_type = 'system'
         and case_id = pg_temp.got('case1', 'case_id')::uuid),
  'the file is kept and made the petition of its case in one step: a document the lawyer who approved it accepted'
);

-- A worker that lost the answer of that step takes back the file it believes is nobody's. The database
-- knows better: a file of a case would take its document with it.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('discard_petition', public.discard_file(pg_temp.got('files', 'petition')::uuid));
insert into res values ('discard_nobodys', public.discard_file(pg_temp.got('files', 'upload')::uuid));
reset role;
select ok(
  pg_temp.got('discard_petition', 'ok') = 'false' and pg_temp.got('discard_petition', 'code') = 'in_use'
  and (select status = 'stored' from public.files where id = pg_temp.got('files', 'petition')::uuid)
  and (select count(*) = 1 from public.case_documents where id = pg_temp.got('issue', 'document_id')::uuid)
  and (select document_id = pg_temp.got('issue', 'document_id')::uuid from public.case_drafts
       where id = pg_temp.got('d1', 'draft_id')::uuid)
  and pg_temp.got('discard_nobodys', 'code') = 'discarded'
  and (select count(*) = 0 from public.files where id = pg_temp.got('files', 'upload')::uuid),
  'a file a document of a case names is never forgotten, whatever the worker that asks believes; a file nothing names is'
);
select is(
  (select count(*)::integer from pg_constraint c
   join pg_class t on t.oid = c.conrelid
   join pg_attribute a on a.attrelid = c.conrelid and a.attnum = any (c.conkey) and a.attname <> 'org_id'
   where c.contype = 'f' and c.confrelid = 'public.files'::regclass
     and (position('public.' || t.relname in pg_get_functiondef('public.discard_file(uuid)'::regprocedure)) = 0
          or position('.' || a.attname || ' = file.id' in pg_get_functiondef('public.discard_file(uuid)'::regprocedure)) = 0)),
  0,
  'every column of every table that points at a file is one the database looks at before it forgets a file'
);
-- The system ONE named for the lawsuit is approved by the firm first (0066): a package waits for that.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.decide_court_system(pg_temp.got('p1', 'proceeding_id')::uuid, true);
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('package', public.request_filing_package(pg_temp.got('p1', 'proceeding_id')::uuid, pg_temp.got('issue', 'document_id')::uuid));
insert into res values ('resume_nothing', public.resume_case_draft_work(pg_temp.got('d1', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('package', 'code') = 'requested' and pg_temp.got('resume_nothing', 'code') = 'nothing_to_resume',
  'and it is the petition the filing package of the lawsuit takes'
);

-- ---------- A draft the AI writes ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d2', public.request_case_draft(pg_temp.got('p2', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'ai'));
-- The model changes after the draft was asked for: the draft keeps the one it was asked with.
insert into res values ('template_changed', public.save_draft_template('bf100000-0000-4000-8000-00000000000a', pg_temp.got('template', 'template_id')::uuid,
  jsonb_build_object('name', 'Petição inicial', 'proceeding_kind', 'juizado', 'body', pg_temp.text_of('clean'))));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d2_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d2', 'draft_id')::uuid)));
insert into res values ('d2_work', (select to_jsonb(w) from public.case_draft_to_work(pg_temp.got('d2', 'draft_id')::uuid, 1) w));
reset role;
select ok(
  pg_temp.got('d2', 'code') = 'requested' and pg_temp.got('template_changed', 'code') = 'saved'
  and (select status = 'generating' and mode = 'ai' and version = 0 and work = 'generate'
       from public.case_drafts where id = pg_temp.got('d2', 'draft_id')::uuid)
  and pg_temp.got('d2_work', 'work') = 'generate' and pg_temp.got('d2_work', 'template') = pg_temp.text_of('model')
  and pg_temp.got('d2_work', 'run_key') = 'draft:' || pg_temp.got('d2', 'draft_id') || ':0'
  and pg_temp.got('d2_work', 'requested_by') = 'af100000-0000-4000-8000-000000000001'
  and (select payload -> 'facts' ->> 'ocorrencia' = 'cancellation' and payload -> 'facts' ->> 'quantas_partes' = '1'
              and payload -> 'facts' ->> 'tipo_de_processo' = 'juizado especial cível'
              and (payload -> 'facts')::text !~ 'Teste|Jo.o|98765432100|987\.654'
              and jsonb_array_length(payload -> 'library') = 2
              and payload -> 'library' @> '[{"chave": "lei::8078#14", "como_citar": "art. 14 da Lei nº 8.078"}, {"chave": "resolucao:ANAC:400", "como_citar": "Resolução nº 400 da ANAC"}]'::jsonb
       from res where name = 'd2_work'),
  'to write the first text the worker is handed the model as it was when the draft was asked for, the facts of the case with nobody''s name or CPF, and the library with how each source is cited'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('d2_run', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d2', 'draft_id')::uuid,
  pg_temp.got('d2_work', 'run_key'), jsonb_build_object('texto', pg_temp.text_of('model'), 'observacoes', jsonb_build_array('Conferir o horário de chegada.'))));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.decide_approval(%L, %L)', pg_temp.got('d2_run', 'approval_id'), 'approved'),
  'P0001', 'not_proposed', 'an answer whose text the draft does not have yet is not approved'
);
reset role;
-- The worker says the run failed, and its answer waits in the queue all the same: the queue speaks first.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d2_generated', public.record_draft_work(pg_temp.got('d2', 'draft_id')::uuid, 1, 'retry', null, 'provider_unavailable'));
insert into res values ('d2_generated_again', public.record_draft_work(pg_temp.got('d2', 'draft_id')::uuid, 1, 'generated',
  pg_temp.got('d2_run', 'run_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('today_queued', public.firm_today('bf100000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  pg_temp.got('d2_run', 'approval_id') is not null
  and pg_temp.got('d2_generated', 'code') = 'generated' and pg_temp.got('d2_generated', 'waits') = 'true'
  and pg_temp.got('d2_generated_again', 'code') = 'not_working'
  and (select status = 'proposed' and version = 1 and run_id = pg_temp.got('d2_run', 'run_id')::uuid and work = 'check'
       from public.case_drafts where id = pg_temp.got('d2', 'draft_id')::uuid)
  and (select author = 'ai' and author_id is null and body = pg_temp.text_of('model')
       from public.case_draft_versions where draft_id = pg_temp.got('d2', 'draft_id')::uuid and version = 1)
  and (select status = 'pending' and approver_functions = array['socio', 'advogado']::public.firm_function[]
       from public.approvals where id = pg_temp.got('d2_run', 'approval_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'draft_proposed' and actor_type = 'ai'
         and case_id = pg_temp.got('case2', 'case_id')::uuid)
  and pg_temp.got('today_queued', 'approvals_waiting') = '1' and pg_temp.got('today_queued', 'drafts_waiting') = '0',
  'the answer that waits in the firm''s queue is the draft''s first text, read from the run itself whatever the worker says of it, once; the queue counts it'
);

select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.decide_approval(%L, %L)', pg_temp.got('d2_run', 'approval_id'), 'approved'),
  'P0001', 'approve_on_case', 'a piece is approved on its case and nowhere else: the firm''s queue does not approve the AI''s answer'
);
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d2_claim2', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d2', 'draft_id')::uuid)));
insert into res values ('d2_read', public.record_draft_work(pg_temp.got('d2', 'draft_id')::uuid, 2, 'checked', null, null,
  pg_temp.read(1, pg_temp.cited('cdc14', 'sumula999'))));
insert into res values ('d2_alike_same_text', (select jsonb_build_object('alike', alike) from public.case_drafts where id = pg_temp.got('d2', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.decide_approval(%L, %L)', pg_temp.got('d2_run', 'approval_id'), 'approved'),
  'P0001', 'approve_on_case', 'whatever was read of its text since'
);
insert into res values ('d2_approve_unverified', pg_temp.approve(pg_temp.got('d2', 'draft_id')::uuid));
insert into res values ('d2_edit_too_long', pg_temp.save(pg_temp.got('d2', 'draft_id')::uuid, repeat('ã', 110000)));
insert into res values ('d2_edit', pg_temp.save(pg_temp.got('d2', 'draft_id')::uuid, pg_temp.text_of('clean')));
insert into res values ('joao', public.save_case_person(pg_temp.got('case2', 'case_id')::uuid, pg_temp.got('case2', 'person_id')::uuid,
  '{"nationality": "brasileira", "marital_status": "solteiro", "profession": "motorista", "street": "Avenida Central", "city": "Goiânia", "uf": "GO"}'::jsonb));
select public.set_party_claim(pg_temp.got('case2', 'case_id')::uuid, pg_temp.got('case2', 'party_id')::uuid, 800000);
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d2_claim3', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d2', 'draft_id')::uuid)));
-- Half of what stands for the corrected text is no longer what stands for the piece of the other case.
insert into res values ('d2_read2', public.record_draft_work(pg_temp.got('d2', 'draft_id')::uuid, 3, 'checked', null, null,
  pg_temp.read(2, pg_temp.cited('cdc14'), pg_temp.sig(7, 64))));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
select is(
  jsonb_build_array(
    public.approve_case_draft(pg_temp.got('d2', 'draft_id')::uuid, 1,
      public.preview_case_draft(pg_temp.got('d2', 'draft_id')::uuid) ->> 'hash') ->> 'code',
    public.approve_case_draft(pg_temp.got('d2', 'draft_id')::uuid, 2, md5('o texto de antes')) ->> 'code',
    public.approve_case_draft(pg_temp.got('d2', 'draft_id')::uuid, 2, null) ->> 'code',
    (select status from public.case_drafts where id = pg_temp.got('d2', 'draft_id')::uuid)),
  '["draft_changed", "draft_changed", "draft_changed", "proposed"]'::jsonb,
  'what is approved is what was read: a version that is no longer the latest, or a text that is not the one the preview showed, is not approved'
);
reset role;
select ok(
  pg_temp.got('d2_approve_unverified', 'code') = 'citations_not_verified'
  and pg_temp.got('d2_edit_too_long', 'code') = 'too_long' and pg_temp.got('d2_edit', 'version') = '2'
  and pg_temp.got('d2_read2', 'code') = 'checked'
  and (select status = 'pending' from public.approvals where id = pg_temp.got('d2_run', 'approval_id')::uuid),
  'a correction that would not fit the queue is refused at the edit, never at the approval'
);
select ok(
  (select payload -> 'alike' = jsonb_build_array(jsonb_build_object('draft', pg_temp.got('d1', 'draft_id'), 'case', pg_temp.got('case1', 'case_id'), 'percent', 100))
   from res where name = 'd2_alike_same_text')
  and (select alike = jsonb_build_array(jsonb_build_object('draft', pg_temp.got('d1', 'draft_id'), 'case', pg_temp.got('case1', 'case_id'), 'percent', 50))
       from public.case_drafts where id = pg_temp.got('d2', 'draft_id')::uuid),
  'how alike a piece is to the firm''s pieces of other cases is the share of the signature they have in common, measured each time its text is read'
);

select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d2_approve', pg_temp.approve(pg_temp.got('d2', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('d2_approve', 'code') = 'approved'
  and (select status = 'approved' and edited and decided_by = 'af100000-0000-4000-8000-000000000003'
              and final_output ->> 'texto' = pg_temp.text_of('clean')
              and final_output -> 'observacoes' = '["Conferir o horário de chegada."]'::jsonb
       from public.approvals where id = pg_temp.got('d2_run', 'approval_id')::uuid)
  and (select status = 'approved' and approved_version = 2 and approved_by = 'af100000-0000-4000-8000-000000000003' and work = 'issue'
              and approved_body like '%JOÃO TESTE, nacionalidade brasileira, pessoa solteira, profissão motorista, CPF nº 987.654.321-00, com endereço em Avenida Central, Goiânia/GO%'
              and approved_body like '%R$ 8.000,00%'
       from public.case_drafts where id = pg_temp.got('d2', 'draft_id')::uuid)
  and (select count(*) = 1 from public.audit_events where action = 'ai.approval.approved' and entity_id = pg_temp.got('d2_run', 'approval_id'))
  and (select count(*) = 1 and bool_and(metadata ->> 'version' = '2' and metadata ->> 'hash' ~ '^[0-9a-f]{32}$')
       from public.audit_events where action = 'draft.approved' and entity_id = pg_temp.got('d2', 'draft_id')),
  'approving the draft on its case decides the AI''s answer in the queue, as corrected: that is what the measure of the task counts'
);

-- An approval is taken back while its document was not made.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('reopen_by_attendant', public.reopen_case_draft(pg_temp.got('d2', 'draft_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('reopen', public.reopen_case_draft(pg_temp.got('d2', 'draft_id')::uuid));
insert into res values ('reopened', (select jsonb_build_object('status', status, 'no_text', approved_body is null and approved_version is null,
    'work', work, 'read', checked_version = version)
  from public.case_drafts where id = pg_temp.got('d2', 'draft_id')::uuid));
insert into res values ('reopen_again', public.reopen_case_draft(pg_temp.got('d2', 'draft_id')::uuid));
insert into res values ('approve_again', pg_temp.approve(pg_temp.got('d2', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('reopen_by_attendant', 'code') = 'not_allowed' and pg_temp.got('reopen', 'code') = 'reopened'
  and (select payload = '{"status": "proposed", "no_text": true, "work": null, "read": true}'::jsonb from res where name = 'reopened')
  and pg_temp.got('reopen_again', 'code') = 'not_editable' and pg_temp.got('approve_again', 'code') = 'approved'
  and (select status = 'approved' and work = 'issue' and approved_version = 2 from public.case_drafts where id = pg_temp.got('d2', 'draft_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'draft_reopened' and case_id = pg_temp.got('case2', 'case_id')::uuid)
  and (select count(*) = 1 from public.audit_events where action = 'draft.reopened' and entity_id = pg_temp.got('d2', 'draft_id'))
  -- The answer in the queue was decided once: the second approval is of the draft alone.
  and (select count(*) = 1 from public.audit_events where action = 'ai.approval.approved' and entity_id = pg_temp.got('d2_run', 'approval_id')),
  'a partner or a lawyer takes back an approval whose document was not made yet: the draft is a text to correct again, approved again like any other'
);

-- ---------- Turned down, given up, replaced ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d3', public.request_case_draft(pg_temp.got('p3', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'ai'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d3_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d3', 'draft_id')::uuid)));
insert into res values ('d3_run', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d3', 'draft_id')::uuid,
  'draft:' || pg_temp.got('d3', 'draft_id') || ':0', jsonb_build_object('texto', pg_temp.text_of('clean'), 'observacoes', '[]'::jsonb)));
insert into res values ('d3_generated', public.record_draft_work(pg_temp.got('d3', 'draft_id')::uuid, 1, 'generated', pg_temp.got('d3_run', 'run_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('d3_reject_by_attendant', public.reject_case_draft(pg_temp.got('d3', 'draft_id')::uuid, 'Não serve.'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('d3_reject_no_note', public.reject_case_draft(pg_temp.got('d3', 'draft_id')::uuid, ' '));
insert into res values ('d3_reject', public.reject_case_draft(pg_temp.got('d3', 'draft_id')::uuid, 'O texto não segue o modelo.'));
insert into res values ('d3_reject_again', public.reject_case_draft(pg_temp.got('d3', 'draft_id')::uuid, 'De novo.'));
insert into res values ('d3_approve_rejected', pg_temp.approve(pg_temp.got('d3', 'draft_id')::uuid));
insert into res values ('d3_cancel', public.cancel_case_draft(pg_temp.got('d3', 'draft_id')::uuid));
reset role;
select ok(
  pg_temp.got('d3_generated', 'code') = 'generated' and pg_temp.got('d3_generated', 'waits') = 'true'
  and pg_temp.got('d3_reject_by_attendant', 'code') = 'not_an_approver' and pg_temp.got('d3_reject_no_note', 'code') = 'note_required'
  and pg_temp.got('d3_reject', 'code') = 'rejected' and pg_temp.got('d3_reject_again', 'code') = 'nothing_to_reject'
  and pg_temp.got('d3_approve_rejected', 'code') = 'not_proposed' and pg_temp.got('d3_cancel', 'code') = 'cancelled'
  and (select status = 'rejected' and decision_note = 'O texto não segue o modelo.' from public.approvals where id = pg_temp.got('d3_run', 'approval_id')::uuid)
  and (select status = 'cancelled' and work is null from public.case_drafts where id = pg_temp.got('d3', 'draft_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'draft_rejected' and case_id = pg_temp.got('case3', 'case_id')::uuid),
  'a lawyer turns the AI''s text down with the reason, which is the decision of that answer in the queue; a rejected draft is approved by nobody'
);

-- Given up while its answer waits: the answer leaves the queue with it.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d4', public.request_case_draft(pg_temp.got('p3', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'ai'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d4_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d4', 'draft_id')::uuid)));
insert into res values ('d4_run', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d4', 'draft_id')::uuid,
  'draft:' || pg_temp.got('d4', 'draft_id') || ':0', jsonb_build_object('texto', pg_temp.text_of('clean'), 'observacoes', '[]'::jsonb)));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('d4_cancel', public.cancel_case_draft(pg_temp.got('d4', 'draft_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d4_generated_late', public.record_draft_work(pg_temp.got('d4', 'draft_id')::uuid, 1, 'generated', pg_temp.got('d4_run', 'run_id')::uuid));
reset role;
-- Given up while the AI still writes: its answer is written already withdrawn, and waits for nobody.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d5', public.request_case_draft(pg_temp.got('p3', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'ai'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d5_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d5', 'draft_id')::uuid)));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d5_cancel', public.cancel_case_draft(pg_temp.got('d5', 'draft_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d5_run', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d5', 'draft_id')::uuid,
  'draft:' || pg_temp.got('d5', 'draft_id') || ':0', jsonb_build_object('texto', pg_temp.text_of('clean'), 'observacoes', '[]'::jsonb)));
reset role;
select ok(
  pg_temp.got('d4_cancel', 'code') = 'cancelled' and pg_temp.got('d4_generated_late', 'code') = 'not_working'
  and (select status = 'withdrawn' and decision_note = 'A peça foi descartada.' and decided_by = 'af100000-0000-4000-8000-000000000002'
       from public.approvals where id = pg_temp.got('d4_run', 'approval_id')::uuid)
  and (select status = 'cancelled' and version = 0 from public.case_drafts where id = pg_temp.got('d4', 'draft_id')::uuid)
  and pg_temp.got('d5_cancel', 'code') = 'cancelled' and pg_temp.got('d5_run', 'approval_id') is null
  and (select status = 'withdrawn' and decision_note like 'Nada a decidir%'
       from public.approvals where run_id = pg_temp.got('d5_run', 'run_id')::uuid)
  and (select count(*) = 0 from public.approvals where org_id = 'bf100000-0000-4000-8000-00000000000a' and status = 'pending'),
  'a draft given up takes its answer out of the queue, also when the worker had not said the text was there; an answer that arrives after it waits for nobody'
);

-- Asked again: a draft the AI still writes is replaced; a text that waits for a lawyer is given up first.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d6a', public.request_case_draft(pg_temp.got('p3', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'ai'));
insert into res values ('d6', public.request_case_draft(pg_temp.got('p3', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'ai'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d6_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d6', 'draft_id')::uuid)));
insert into res values ('d6_run', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d6', 'draft_id')::uuid,
  'draft:' || pg_temp.got('d6', 'draft_id') || ':0', jsonb_build_object('texto', pg_temp.text_of('clean'), 'observacoes', '[]'::jsonb)));
insert into res values ('d6_generated', public.record_draft_work(pg_temp.got('d6', 'draft_id')::uuid, 1, 'generated', pg_temp.got('d6_run', 'run_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('d7_over_text', public.request_case_draft(pg_temp.got('p3', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'ai'));
-- Nobody worked on the AI's text yet: whoever works on the case gives it up.
insert into res values ('d6_cancel', public.cancel_case_draft(pg_temp.got('d6', 'draft_id')::uuid));
insert into res values ('d7', public.request_case_draft(pg_temp.got('p3', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'ai'));
reset role;
select ok(
  pg_temp.got('d6a', 'code') = 'requested' and pg_temp.got('d6', 'code') = 'requested'
  and (select status = 'cancelled' and work is null from public.case_drafts where id = pg_temp.got('d6a', 'draft_id')::uuid)
  and pg_temp.got('d7_over_text', 'code') = 'draft_in_course' and pg_temp.got('d6_cancel', 'code') = 'cancelled'
  and pg_temp.got('d7', 'code') = 'requested'
  and (select status = 'cancelled' from public.case_drafts where id = pg_temp.got('d6', 'draft_id')::uuid)
  and (select status = 'withdrawn' and decision_note = 'A peça foi descartada.'
       from public.approvals where id = pg_temp.got('d6_run', 'approval_id')::uuid)
  and (select count(*) = 1 and bool_and(id = pg_temp.got('d7', 'draft_id')::uuid) from public.case_drafts
       where proceeding_id = pg_temp.got('p3', 'proceeding_id')::uuid and status in ('generating', 'proposed', 'approved')),
  'asking again replaces a draft the AI still writes; a text that waits for a lawyer is given up first, and what waited of it leaves the queue: a lawsuit has one draft in course'
);

-- ---------- A work that fails, and the way forward ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('d7_claim1', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d7', 'draft_id')::uuid)));
insert into res values ('d7_retry1', public.record_draft_work(pg_temp.got('d7', 'draft_id')::uuid, 1, 'retry', null, 'provider_unavailable'));
insert into res values ('d7_waits', (select jsonb_build_object('later', work_after > now(), 'error', work_error, 'work', work, 'status', status)
  from public.case_drafts where id = pg_temp.got('d7', 'draft_id')::uuid));
insert into res values ('d7_not_due', jsonb_build_object('n', (select count(*) from public.claim_case_drafts(5, pg_temp.got('d7', 'draft_id')::uuid))));
insert into res values ('d7_claim2', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d7', 'draft_id')::uuid)));
-- A run of it that failed: the next one is another run.
select public.finish_ai_run(
  (public.start_ai_run('bf100000-0000-4000-8000-00000000000a', 'caso.peca.minuta', repeat('f', 64), null, 'case_draft',
     pg_temp.got('d7', 'draft_id'), 'draft:' || pg_temp.got('d7', 'draft_id') || ':0') ->> 'run_id')::uuid,
  'failed', null, 0, 0, null, 'provider_unavailable');
insert into res values ('d7_key_after_failure', (select jsonb_build_object('key', w.run_key) from public.case_draft_to_work(pg_temp.got('d7', 'draft_id')::uuid, 2) w));
insert into res values ('d7_retry2', public.record_draft_work(pg_temp.got('d7', 'draft_id')::uuid, 2, 'retry', null, 'provider_unavailable'));
insert into res values ('d7_claim3', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d7', 'draft_id')::uuid)));
insert into res values ('d7_retry3', public.record_draft_work(pg_temp.got('d7', 'draft_id')::uuid, 3, 'retry', null, 'Provider Unavailable; DROP'));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('today_failed', public.firm_today('bf100000-0000-4000-8000-00000000000a'));
reset role;
select ok(
  pg_temp.got('d7_retry1', 'code') = 'retry' and pg_temp.got('d7_waits', 'later') = 'true'
  and pg_temp.got('d7_waits', 'error') = 'provider_unavailable' and pg_temp.got('d7_waits', 'work') = 'generate'
  and pg_temp.got('d7_waits', 'status') = 'generating' and pg_temp.got('d7_not_due', 'n') = '0'
  and pg_temp.got('d7_key_after_failure', 'key') = 'draft:' || pg_temp.got('d7', 'draft_id') || ':1'
  and pg_temp.got('d7_retry2', 'code') = 'retry' and pg_temp.got('d7_retry3', 'code') = 'failed'
  and (select status = 'failed' and work is null and work_error = 'provider' from public.case_drafts where id = pg_temp.got('d7', 'draft_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'draft_failed' and case_id = pg_temp.got('case3', 'case_id')::uuid)
  and pg_temp.got('today_failed', 'drafts_waiting') = '1',
  'a passing failure waits and is tried again, each run after a failed one being another run, until the attempts are spent; a draft the AI could not write needs somebody, and the home says so'
);

select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('d7_resume', public.resume_case_draft_work(pg_temp.got('d7', 'draft_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d7_claim4', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d7', 'draft_id')::uuid)));
-- The worker stopped and never said what came of it: the claim goes back to the line by itself.
update public.case_drafts set work_claimed_at = now() - interval '2 hours' where id = pg_temp.got('d7', 'draft_id')::uuid;
insert into res values ('d7_claim5', jsonb_build_object('claim', (select c.claim from public.claim_case_drafts(1, pg_temp.got('d7', 'draft_id')::uuid) c)));
insert into res values ('d7_old_claim', public.record_draft_work(pg_temp.got('d7', 'draft_id')::uuid, 4, 'failed', null, 'late'));
insert into res values ('d7_old_claim_work', jsonb_build_object('n',
  (select count(*) from public.case_draft_to_work(pg_temp.got('d7', 'draft_id')::uuid, 4))));
reset role;
select ok(
  pg_temp.got('d7_resume', 'code') = 'resumed' and pg_temp.got('d7_resume', 'work') = 'generate'
  and pg_temp.got('d7_claim4', 'claim') = '4' and pg_temp.got('d7_claim5', 'claim') = '5'
  and pg_temp.got('d7_old_claim', 'code') = 'not_working' and pg_temp.got('d7_old_claim_work', 'n') = '0'
  and (select status = 'generating' and work = 'generate' and work_attempts = 2 and work_claims = 5 and work_claimed_at is not null
       from public.case_drafts where id = pg_temp.got('d7', 'draft_id')::uuid),
  'a person puts a failed work back; a claim nobody finished goes back to the line, and the worker that held it is no longer heard'
);

-- An answer that is no piece: the run succeeded, and what it wrote will never be the draft's text.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d7_key', (select jsonb_build_object('key', w.run_key) from public.case_draft_to_work(pg_temp.got('d7', 'draft_id')::uuid, 5) w));
insert into res values ('d7_short_run', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d7', 'draft_id')::uuid,
  pg_temp.got('d7_key', 'key'), '{"texto": "Não sei.", "observacoes": []}'::jsonb));
insert into res values ('d7_short_waits', (select jsonb_build_object('status', a.status) from public.approvals a
  where a.run_id = pg_temp.got('d7_short_run', 'run_id')::uuid));
insert into res values ('d7_short', public.record_draft_work(pg_temp.got('d7', 'draft_id')::uuid, 5, 'generated',
  pg_temp.got('d7_short_run', 'run_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d7_resume_again', public.resume_case_draft_work(pg_temp.got('d7', 'draft_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d7_claim6', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d7', 'draft_id')::uuid)));
insert into res values ('d7_key_after_short', (select jsonb_build_object('key', w.run_key)
  from public.case_draft_to_work(pg_temp.got('d7', 'draft_id')::uuid, 6) w));
reset role;
select ok(
  pg_temp.got('d7_key', 'key') = 'draft:' || pg_temp.got('d7', 'draft_id') || ':1'
  and pg_temp.got('d7_short_waits', 'status') = 'pending'
  and pg_temp.got('d7_short', 'ok') = 'true' and pg_temp.got('d7_short', 'code') = 'failed'
  and (select status = 'withdrawn' and decision_note = 'A resposta não era uma peça.' and decided_by is null
       from public.approvals where run_id = pg_temp.got('d7_short_run', 'run_id')::uuid)
  and (select count(*) = 1 from public.audit_events where action = 'ai.approval.withdrawn'
         and metadata ->> 'where' = 'worker' and metadata ->> 'run_id' = pg_temp.got('d7_short_run', 'run_id'))
  and (select count(*) = 0 from public.case_draft_versions where draft_id = pg_temp.got('d7', 'draft_id')::uuid)
  and (select count(*) = 2 from public.case_events where kind = 'draft_failed' and case_id = pg_temp.got('case3', 'case_id')::uuid)
  and pg_temp.got('d7_resume_again', 'code') = 'resumed' and pg_temp.got('d7_claim6', 'claim') = '6'
  and pg_temp.got('d7_key_after_short', 'key') = 'draft:' || pg_temp.got('d7', 'draft_id') || ':2'
  and (select status = 'generating' and work = 'generate' and work_error is null and unusable_runs = 1
       from public.case_drafts where id = pg_temp.got('d7', 'draft_id')::uuid),
  'an answer of the AI that is no piece leaves the queue and is never the draft''s text; put back, the work asks the model again in another run'
);

-- ---------- How alike two pieces are: inside the firm, and never with the same case ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('d_b', public.request_case_draft(pg_temp.got('p_b', 'proceeding_id')::uuid, pg_temp.got('template_b', 'template_id')::uuid, 'blank'));
reset role;
-- Another piece of the first case of firm A, whose first is already its petition.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('d8', public.request_case_draft(pg_temp.got('p1', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'blank'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d_b_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d_b', 'draft_id')::uuid)));
insert into res values ('d_b_read', public.record_draft_work(pg_temp.got('d_b', 'draft_id')::uuid, 1, 'checked', null, null,
  pg_temp.read(1, pg_temp.cited('cdc14'))));
insert into res values ('d8_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d8', 'draft_id')::uuid)));
insert into res values ('d8_read', public.record_draft_work(pg_temp.got('d8', 'draft_id')::uuid, 1, 'checked', null, null,
  pg_temp.read(1, pg_temp.cited('cdc14'))));
reset role;
select ok(
  pg_temp.got('d_b_read', 'code') = 'checked' and pg_temp.got('d8', 'code') = 'requested' and pg_temp.got('d8_read', 'code') = 'checked'
  and (select alike = '[]'::jsonb from public.case_drafts where id = pg_temp.got('d_b', 'draft_id')::uuid)
  and (select alike = jsonb_build_array(jsonb_build_object('draft', pg_temp.got('d2', 'draft_id'), 'case', pg_temp.got('case2', 'case_id'), 'percent', 50))
       from public.case_drafts where id = pg_temp.got('d8', 'draft_id')::uuid)
  and (select status = 'issued' from public.case_drafts where id = pg_temp.got('d1', 'draft_id')::uuid),
  'a piece is compared with the pieces of the other cases of its own firm: never with one of another firm, never with another of its own case'
);

-- ---------- The dossier of a case ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('dossier', public.request_dossier(pg_temp.got('case1', 'case_id')::uuid));
insert into res values ('dossier_twice', public.request_dossier(pg_temp.got('case1', 'case_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  format('select public.request_dossier(%L)', pg_temp.got('case1', 'case_id')),
  'P0002', 'case_not_found', 'nobody asks for the dossier of a case of another firm'
);
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('dossier_files', jsonb_build_object(
  'a', pg_temp.stored('bf100000-0000-4000-8000-00000000000a', 'issued', 'dossie.pdf', 'd'),
  'b', pg_temp.stored('bf100000-0000-4000-8000-00000000000b', 'issued', 'dossie.pdf', 'e')
));
insert into res values ('dossier_doc', public.reserve_document('bf100000-0000-4000-8000-00000000000a', 'dossie', 'Dossiê do caso 1',
  'dossie:' || pg_temp.got('dossier', 'dossier_id'), 'ABCDEFGHJKMN'));
select public.claim_document(pg_temp.got('dossier_doc', 'document_id')::uuid, 'cf100000-0000-4000-8000-000000000001');
select public.publish_document(pg_temp.got('dossier_doc', 'document_id')::uuid, 'cf100000-0000-4000-8000-000000000001', pg_temp.got('dossier_files', 'a')::uuid);
insert into res values ('dossier_doc_b', public.reserve_document('bf100000-0000-4000-8000-00000000000b', 'dossie', 'Dossiê do caso 1',
  'dossie:outro-escritorio', 'PQRSTUVWXYZ2'));
select public.claim_document(pg_temp.got('dossier_doc_b', 'document_id')::uuid, 'cf100000-0000-4000-8000-000000000002');
select public.publish_document(pg_temp.got('dossier_doc_b', 'document_id')::uuid, 'cf100000-0000-4000-8000-000000000002', pg_temp.got('dossier_files', 'b')::uuid);
insert into res values ('dossier_other_firm_doc', public.record_dossier(pg_temp.got('dossier', 'dossier_id')::uuid, pg_temp.got('dossier_doc_b', 'document_id')::uuid));
insert into res values ('dossier_issued', public.record_dossier(pg_temp.got('dossier', 'dossier_id')::uuid, pg_temp.got('dossier_doc', 'document_id')::uuid,
  '{"people": 1, "documents": 1}'::jsonb));
insert into res values ('dossier_issued_again', public.record_dossier(pg_temp.got('dossier', 'dossier_id')::uuid, pg_temp.got('dossier_doc', 'document_id')::uuid));
insert into res values ('dossier_other_after', public.record_dossier(pg_temp.got('dossier', 'dossier_id')::uuid, pg_temp.got('dossier_doc_b', 'document_id')::uuid));
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('dossier2', public.request_dossier(pg_temp.got('case1', 'case_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('dossier2_failed', public.record_dossier(pg_temp.got('dossier2', 'dossier_id')::uuid, null, '{}'::jsonb, 'render_failed'));
reset role;
select ok(
  pg_temp.got('dossier', 'code') = 'requested' and pg_temp.got('dossier_twice', 'code') = 'in_course'
  and pg_temp.got('dossier_twice', 'dossier_id') = pg_temp.got('dossier', 'dossier_id')
  and pg_temp.got('dossier_other_firm_doc', 'code') = 'document_not_found'
  -- The same document named again is the same record (the word of the first got lost); another is refused.
  and pg_temp.got('dossier_issued', 'code') = 'issued' and pg_temp.got('dossier_issued_again', 'code') = 'issued'
  and pg_temp.got('dossier_other_after', 'code') = 'not_working'
  and (select status = 'issued' and issued_document_id = pg_temp.got('dossier_doc', 'document_id')::uuid
              and summary = '{"people": 1, "documents": 1}'::jsonb and requested_by = 'af100000-0000-4000-8000-000000000002'
       from public.dossiers where id = pg_temp.got('dossier', 'dossier_id')::uuid)
  and pg_temp.got('dossier2', 'code') = 'requested' and pg_temp.got('dossier2', 'dossier_id') <> pg_temp.got('dossier', 'dossier_id')
  and pg_temp.got('dossier2_failed', 'code') = 'failed'
  and (select status = 'failed' and error = 'render_failed' from public.dossiers where id = pg_temp.got('dossier2', 'dossier_id')::uuid)
  and (select count(*) = 2 from public.case_events where kind = 'dossier_requested' and case_id = pg_temp.got('case1', 'case_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'dossier_issued' and case_id = pg_temp.got('case1', 'case_id')::uuid),
  'anybody of the firm asks for the dossier of a case, once at a time; it is the document the backend issued for that firm, or it failed and is asked again'
);

-- ---------- Two firms, and who writes ----------

select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('seen_b', jsonb_build_object(
  'sources', (select count(*) from public.legal_sources),
  'templates', (select count(*) from public.draft_templates),
  'drafts', (select count(*) from public.case_drafts),
  'versions', (select count(*) from public.case_draft_versions),
  'citations', (select count(*) from public.case_draft_citations),
  'dossiers', (select count(*) from public.dossiers)
));
insert into res values ('b_on_a', jsonb_build_object(
  'reject', public.reject_case_draft(pg_temp.got('d2', 'draft_id')::uuid, 'Não é meu.') ->> 'code',
  'template', public.request_case_draft(pg_temp.got('p_b', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'ai') ->> 'code'
));
select throws_ok(
  format('select public.cancel_case_draft(%L)', pg_temp.got('d7', 'draft_id')),
  'P0002', 'case_not_found', 'nobody gives up a draft of another firm'
);
select throws_ok(
  format('select public.resume_case_draft_work(%L)', pg_temp.got('d7', 'draft_id')),
  'P0002', 'case_not_found', 'or puts its work back'
);
reset role;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('seen_a', jsonb_build_object(
  'sources', (select count(*) from public.legal_sources),
  'templates', (select count(*) from public.draft_templates),
  'drafts', (select count(*) from public.case_drafts),
  'versions', (select count(*) from public.case_draft_versions),
  'citations', (select count(*) from public.case_draft_citations),
  'dossiers', (select count(*) from public.dossiers)
));
select throws_ok(
  $$insert into public.legal_sources (org_id, kind, number, title, source_url)
    values ('bf100000-0000-4000-8000-00000000000a', 'lei', '9099', 'Juizados especiais', 'https://www.planalto.gov.br/ccivil_03/leis/l9099.htm')$$,
  '42501', null, 'the library is written through its functions only'
);
select throws_ok(
  format('update public.case_drafts set status = %L where id = %L', 'approved', pg_temp.got('d7', 'draft_id')),
  '42501', null, 'and so is a draft'
);
select throws_ok(
  format('select public.record_draft_work(%L, 5, %L)', pg_temp.got('d7', 'draft_id'), 'failed'),
  '42501', null, 'what a work came to is said by the backend only'
);
select throws_ok(
  format('select public.case_draft_filled(%L, %L)', pg_temp.got('d1', 'draft_id'), '[[PARTES]]'),
  '42501', null, 'and the facts of a lawsuit are written into a text by the database, for nobody who asks'
);
reset role;
select ok(
  (select payload = '{"sources": 0, "templates": 1, "drafts": 1, "versions": 1, "citations": 1, "dossiers": 0}'::jsonb from res where name = 'seen_b')
  and (select payload = '{"sources": 2, "templates": 1, "drafts": 9, "versions": 8, "citations": 8, "dossiers": 2}'::jsonb from res where name = 'seen_a')
  and (select payload = '{"reject": "draft_not_found", "template": "template_not_found"}'::jsonb from res where name = 'b_on_a'),
  'each firm reads its own library, models, drafts, versions, citations and dossiers, and nothing of the other'
);
-- ---------- A draft follows its lawsuit ----------

-- The run of a first text is still running somewhere: the claim is given back, and that look is no attempt.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('d7_in_course', public.record_draft_work(pg_temp.got('d7', 'draft_id')::uuid, 6, 'in_course'));
insert into res values ('d7_given_back', (select jsonb_build_object('held', work_claimed_at is not null, 'later', work_after > now(),
    'attempts', work_attempts, 'status', status, 'work', work)
  from public.case_drafts where id = pg_temp.got('d7', 'draft_id')::uuid));
insert into res values ('d7_claim7', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('d7', 'draft_id')::uuid)));
insert into res values ('d7_text_run', pg_temp.ran('bf100000-0000-4000-8000-00000000000a', pg_temp.got('d7', 'draft_id')::uuid,
  pg_temp.got('d7_key_after_short', 'key'), jsonb_build_object('texto', pg_temp.text_of('clean'), 'observacoes', '[]'::jsonb)));
insert into res values ('d7_text', public.record_draft_work(pg_temp.got('d7', 'draft_id')::uuid, 7, 'generated',
  pg_temp.got('d7_text_run', 'run_id')::uuid));
reset role;
-- Somebody removes that planned lawsuit: its draft goes with it, and the answer that waited leaves the queue
-- with no decision counted. The first lawsuit is recorded as filed by hand: the text that waited for a
-- lawyer there has nothing left to be for, and the piece already issued stays.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('p3_removed', public.remove_proceeding(pg_temp.got('p3', 'proceeding_id')::uuid));
insert into res values ('p1_filed', public.save_proceeding(pg_temp.got('case1', 'case_id')::uuid, pg_temp.got('p1', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'comarca', 'Goiânia', 'forum_basis', 'domicile', 'system', 'projudi',
    'status', 'filed', 'cnj', '5000303-76.2099.8.09.0051', 'filed_at', (now() at time zone 'America/Sao_Paulo')::date)));
insert into res values ('ask_filed', public.request_case_draft(pg_temp.got('p1', 'proceeding_id')::uuid, pg_temp.got('template', 'template_id')::uuid, 'blank'));
reset role;
-- The other firm's case ends.
update public.cases set status = 'closed', closed_at = now() where id = pg_temp.got('case_b', 'case_id')::uuid;
select ok(
  pg_temp.got('d7_in_course', 'code') = 'in_course'
  and (select payload = '{"held": false, "later": true, "attempts": 0, "status": "generating", "work": "generate"}'::jsonb
       from res where name = 'd7_given_back')
  and pg_temp.got('d7_claim7', 'claim') = '7' and pg_temp.got('d7_text', 'code') = 'generated'
  and pg_temp.got('p3_removed', 'code') = 'removed'
  and (select count(*) = 0 from public.case_drafts where id = pg_temp.got('d7', 'draft_id')::uuid)
  and (select status = 'withdrawn' and decision_note = 'A peça não existe mais.' and decided_by is null
       from public.approvals where id = pg_temp.got('d7_text_run', 'approval_id')::uuid)
  and pg_temp.got('p1_filed', 'code') = 'saved' and pg_temp.got('ask_filed', 'code') = 'already_filed'
  and (select status = 'cancelled' and work is null from public.case_drafts where id = pg_temp.got('d8', 'draft_id')::uuid)
  and (select status = 'issued' and document_id is not null from public.case_drafts where id = pg_temp.got('d1', 'draft_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'draft_cancelled' and actor_type = 'system'
         and case_id = pg_temp.got('case1', 'case_id')::uuid)
  and (select status = 'cancelled' from public.case_drafts where id = pg_temp.got('d_b', 'draft_id')::uuid)
  and (select count(*) = 0 from public.approvals where org_id = 'bf100000-0000-4000-8000-00000000000a' and status = 'pending'),
  'a draft follows its lawsuit: removed, filed or ended, it leaves nothing to decide in the queue and no text waiting for a lawyer; a piece already issued stays'
);

-- ---------- What the AI reads of a case, and what the queue lets go of ----------

select is(
  public.case_text_for_ai(pg_temp.got('case1', 'case_id')::uuid,
    'Maria chegou cedo e MARIA  TESTE ligou do (62) 99999-0000. Mária e o filho esperaram; ela escreveu de maria.teste@exemplo.invalid. CPF 123.456.789-09, CEP 74000-000. João não é deste caso, e Testemunha não é nome.'),
  '[nome] chegou cedo e [nome] ligou do [telefone]. [nome] e o filho esperaram; ela escreveu de [e-mail]. CPF [CPF], CEP [CEP]. João não é deste caso, e Testemunha não é nome.',
  'what the AI reads of a case names none of its people, however a name is written, and carries no e-mail, CPF, CEP or telephone'
);
select is(
  public.case_text_for_ai(pg_temp.got('case1', 'case_id')::uuid,
    'Modelo feito do caso de Fulano Exemplo, CPF 111.444.777-35, contato (62) 3333-4444 e fulano@exemplo.invalid. [[PARTES]], [COMPLETAR: data].'),
  'Modelo feito do caso de Fulano Exemplo, CPF [CPF], contato [telefone] e [e-mail]. [[PARTES]], [COMPLETAR: data].',
  'a model of the firm reaches the AI with what is written as an identifier taken out, and its marks as they are'
);

-- An answer whose draft went away while the answer was being written: left waiting, as that race leaves it.
update public.approvals set status = 'pending', decided_at = null, decided_by = null, decision_note = null
where id = pg_temp.got('d7_text_run', 'approval_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('sweep_orphan', jsonb_build_object('claimed',
  (select count(*) from public.claim_case_drafts(1, '00000000-0000-4000-8000-000000000000'::uuid))));
reset role;
select ok(
  pg_temp.got('sweep_orphan', 'claimed') = '0'
  and (select status = 'withdrawn' and decided_by is null
              and decision_note = 'Nada a decidir: a peça não espera mais por este texto.'
       from public.approvals where id = pg_temp.got('d7_text_run', 'approval_id')::uuid)
  and (select count(*) = 1 from public.audit_events where action = 'ai.approval.withdrawn'
         and entity_id = pg_temp.got('d7_text_run', 'approval_id') and metadata ->> 'where' = 'sweep'),
  'an answer of the AI left waiting for a draft that no longer waits for it leaves the queue at the next sweep'
);

-- A piece of a lawsuit the court already has, or of a case that ended, is nobody's to write again.
update public.case_drafts set status = 'approved' where id = pg_temp.got('d1', 'draft_id')::uuid;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('reopen_filed', public.reopen_case_draft(pg_temp.got('d1', 'draft_id')::uuid));
reset role;
update public.case_drafts set status = 'issued' where id = pg_temp.got('d1', 'draft_id')::uuid;
select pg_temp.sign_in('af100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('ask_closed', public.request_case_draft(pg_temp.got('p_b', 'proceeding_id')::uuid,
  pg_temp.got('template_b', 'template_id')::uuid, 'blank'));
reset role;
select ok(
  pg_temp.got('reopen_filed', 'code') = 'already_filed' and pg_temp.got('ask_closed', 'code') = 'case_closed'
  and (select status = 'issued' from public.case_drafts where id = pg_temp.got('d1', 'draft_id')::uuid),
  'an approval is not taken back for a lawsuit the court already has, and no piece is asked for a case that ended'
);

-- The petition a lawyer approved is decided again by who signs only.
select pg_temp.sign_in('af100000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  format('select public.decide_case_document(%L, %L, %L)', pg_temp.got('issue', 'document_id'), 'rejected', 'Não serve.'),
  '42501', 'not_allowed', 'the document an approved piece became is not refused by who does not sign'
);
reset role;

set local role anon;
select throws_ok('select count(*) from public.case_drafts', '42501', null, 'a visitor reads no draft');
select throws_ok('select count(*) from public.legal_sources', '42501', null, 'and no library');
reset role;

select * from finish();
rollback;
