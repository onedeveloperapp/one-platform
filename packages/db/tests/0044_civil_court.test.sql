begin;
create extension if not exists pgtap;
select plan(21);

-- ============================================================
-- A family with a minor goes to the civil court together (0025,
-- `tipo-de-processo-v2`): the split is a lawyer's choice, recorded with its
-- reason, told what each court decided of it (`court_notes`, the operator's);
-- each claimant of a lawsuit planned in the civil court (for a minor, who
-- answers for them) says they accept it, on their link or through the firm,
-- in the words shown, kept as given; no package is built without it, and a
-- "no" gives up the package in course and is counted for the firm. Two firms.
--
-- Every person, firm and CPF here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ae440000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('ae440000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('ae440000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('ae440000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());
update public.profiles set is_superadmin = true where id = 'ae440000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('be440000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados-44', 'ae440000-0000-4000-8000-000000000001'),
  ('be440000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia-44', 'ae440000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('be440000-0000-4000-8000-00000000000a', 'ae440000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('be440000-0000-4000-8000-00000000000a', 'ae440000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('be440000-0000-4000-8000-00000000000b', 'ae440000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- The words the firm's screen shows for a claimant of the first case, read under the session in force.
create function pg_temp.firm_words(case_id uuid, party text) returns text language sql as
$$ select item ->> 'wording' from jsonb_array_elements(public.case_civil_court(firm_words.case_id) -> 'needs') item
   where item ->> 'party_id' = firm_words.party; $$;
-- The words a link showed for a claimant: what its page answers in.
create function pg_temp.words(party text) returns text language sql as
$$ select item ->> 'wording' from res, jsonb_array_elements(res.payload -> 'items') item
   where res.name = 'asked' and item ->> 'party_id' = words.party; $$;

-- Firm A: Maria (an adult of Goiânia), the guardian she is, her son João (a minor) and Pedro (an adult), on a flight
-- from Goiânia to Guarulhos. Firm B: Paulo.
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('be440000-0000-4000-8000-00000000000a', 'cancellation', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste", "cpf": "12345678909", "birth_date": "1985-04-02", "city": "Goiânia", "uf": "GO"}'::jsonb));
insert into res values ('guardian', public.save_case_person(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, '{}'::jsonb, 'guardian'));
insert into res values ('minor', public.save_case_person(pg_temp.got('case', 'case_id')::uuid, null,
  '{"full_name": "Joao Teste", "birth_date": "2015-03-10"}'::jsonb, 'claimant', pg_temp.got('guardian', 'party_id')::uuid));
insert into res values ('adult', public.save_case_person(pg_temp.got('case', 'case_id')::uuid, null,
  '{"full_name": "Pedro Teste", "birth_date": "1984-08-20", "city": "Goiânia", "uf": "GO"}'::jsonb, 'claimant'));
insert into res values ('segment', public.save_flight_segment(pg_temp.got('case', 'case_id')::uuid, null,
  '{"flight_number": "G3 1234", "origin_iata": "GYN", "destination_iata": "GRU", "scheduled_departure_local": "2026-09-20T08:00"}'::jsonb));
reset role;
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('be440000-0000-4000-8000-00000000000b', 'delay', null, null,
  '{"full_name": "Paulo Teste"}'::jsonb));
reset role;

-- ---------- What each court decided of a split, kept by the operator ----------

select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(
  (select stance from public.court_notes where court = 'TJMT' and topic = 'family_split') = 'against'
  and (select stance from public.court_notes where court = 'TJDFT' and topic = 'family_split') = 'divided'
  and (select bool_and(jsonb_array_length(sources) >= 3 and read_on = date '2026-10-13') from public.court_notes)
  and (select bool_and(summary !~ '[—–!]') from public.court_notes),
  'a member reads what the platform read of each court on a family split, with its sources and the day it was read'
);
select throws_ok(
  $$select public.admin_save_court_note('TJGO', 'family_split', 'against', 'Uma câmara qualquer decidiu alguma coisa sobre a divisão da família.', '[{"label": "Fonte", "url": "https://www.tjgo.jus.br/"}]'::jsonb, date '2026-10-13')$$,
  '42501', null,
  'a member of a firm writes no court''s note: the operator does'
);
reset role;

select pg_temp.sign_in('ae440000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('note_insecure', public.admin_save_court_note('TJGO', 'family_split', 'against',
  'Uma câmara do tribunal decidiu contra a divisão da família entre juizado e vara.',
  '[{"label": "Fonte", "url": "http://www.tjgo.jus.br/"}]'::jsonb, date '2026-10-13'));
insert into res values ('note_court', public.admin_save_court_note('TJXX', 'family_split', 'against',
  'Uma câmara do tribunal decidiu contra a divisão da família entre juizado e vara.',
  '[{"label": "Fonte", "url": "https://www.tjgo.jus.br/"}]'::jsonb, date '2026-10-13'));
insert into res values ('note_saved', public.admin_save_court_note('tjgo', 'family_split', 'divided',
  'Uma câmara do tribunal decidiu contra a divisão da família entre juizado e vara.',
  '[{"label": "Fonte", "url": "https://www.tjgo.jus.br/"}]'::jsonb, date '2026-10-13'));
insert into res values ('note_removed', public.admin_remove_court_note('TJGO', 'family_split'));
insert into res values ('note_again', public.admin_remove_court_note('TJGO', 'family_split'));
reset role;

select ok(
  pg_temp.got('note_insecure', 'code') = 'invalid_value'
  and pg_temp.got('note_court', 'code') = 'unknown_court'
  and pg_temp.got('note_saved', 'code') = 'saved'
  and pg_temp.got('note_removed', 'code') = 'removed'
  and pg_temp.got('note_again', 'code') = 'not_found'
  and (select count(*) = 2 from public.audit_events where action in ('admin.court_note.saved', 'admin.court_note.removed')
       and entity_id = 'TJGO:family_split'),
  'the operator writes a court''s note with sources on the web, for a court that exists, and takes it away, on the record'
);

-- ---------- The family's choice, a lawyer's ----------

select pg_temp.sign_in('ae440000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('choice_bia', public.set_family_choice(pg_temp.got('case', 'case_id')::uuid, 'split', 'A família pediu.'));
reset role;
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('choice_bare', public.set_family_choice(pg_temp.got('case', 'case_id')::uuid, 'split', ' '));
insert into res values ('choice_bad', public.set_family_choice(pg_temp.got('case', 'case_id')::uuid, 'apart', null));
insert into res values ('choice_split', public.set_family_choice(pg_temp.got('case', 'case_id')::uuid, 'split',
  'Os pais preferem o juizado para os adultos.'));
insert into res values ('choice_split_row', (select to_jsonb(c) from public.cases c where c.id = pg_temp.got('case', 'case_id')::uuid));
insert into res values ('choice_together', public.set_family_choice(pg_temp.got('case', 'case_id')::uuid, 'together',
  'um motivo que não fica'));
insert into res values ('choice_same', public.set_family_choice(pg_temp.got('case', 'case_id')::uuid, 'together'));
reset role;

select ok(
  pg_temp.got('choice_bia', 'code') = 'not_a_lawyer'
  and pg_temp.got('choice_bare', 'code') = 'family_reason_required'
  and pg_temp.got('choice_bad', 'code') = 'invalid_data'
  and pg_temp.got('choice_split', 'code') = 'saved'
  and pg_temp.got('choice_split_row', 'family_choice') = 'split'
  and pg_temp.got('choice_split_row', 'family_choice_by') = 'ae440000-0000-4000-8000-000000000001'
  and pg_temp.got('choice_together', 'code') = 'saved'
  and pg_temp.got('choice_same', 'code') = 'unchanged'
  and (select family_choice = 'together' and family_choice_reason is null
       from public.cases where id = pg_temp.got('case', 'case_id')::uuid)
  and (select count(*) = 2 from public.case_events where case_id = pg_temp.got('case', 'case_id')::uuid
       and kind = 'family_choice_saved'),
  'splitting a family is a partner''s or a lawyer''s choice with its reason; together, the default, keeps no reason'
);

select pg_temp.sign_in('ae440000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  format($$select public.set_family_choice(%L, 'split', 'Outro escritório decide.')$$, pg_temp.got('case', 'case_id')),
  'P0002', null,
  'another firm cannot choose for this one''s family'
);
reset role;

-- ---------- Together, the lawsuits are planned ----------

select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('juizado_unchosen', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile"}'::jsonb,
  array[pg_temp.got('case', 'party_id')::uuid, pg_temp.got('adult', 'party_id')::uuid]));
insert into res values ('plan', public.create_planned_proceedings(pg_temp.got('case', 'case_id')::uuid, jsonb_build_array(
  jsonb_build_object('fields', '{"kind": "comum", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "forum_city": "Goiânia", "system": "projudi"}'::jsonb,
    'parties', jsonb_build_array(pg_temp.got('case', 'party_id'), pg_temp.got('minor', 'party_id'), pg_temp.got('adult', 'party_id')))
)));
insert into res values ('choice_late', public.set_family_choice(pg_temp.got('case', 'case_id')::uuid, 'split',
  'Os pais preferem o juizado para os adultos.'));
insert into res values ('needs', public.case_civil_court(pg_temp.got('case', 'case_id')::uuid));
reset role;

select ok(
  pg_temp.got('juizado_unchosen', 'code') = 'family_split_unchosen'
  and pg_temp.got('plan', 'code') = 'created'
  and pg_temp.got('choice_late', 'code') = 'proceedings_planned',
  'with a minor in the family, a small-claims lawsuit is a split nobody chose; the family goes together, and the choice comes before the plan'
);

insert into res values ('lawsuit', jsonb_build_object('id',
  (select id from public.proceedings where case_id = pg_temp.got('case', 'case_id')::uuid)));
select ok(
  jsonb_array_length((select payload -> 'needs' from res where name = 'needs')) = 3
  and (select bool_and(item ->> 'accepted' is null) from res, jsonb_array_elements(payload -> 'needs') item where name = 'needs')
  and (select item ->> 'answerer_id' from res, jsonb_array_elements(payload -> 'needs') item
       where name = 'needs' and item ->> 'party_id' = pg_temp.got('minor', 'party_id')) = pg_temp.got('case', 'person_id')
  and (select item ->> 'wording' like 'Joao Teste é menor de idade%Aceito que a ação de Joao Teste seja proposta na vara cível.'
       from res, jsonb_array_elements(payload -> 'needs') item
       where name = 'needs' and item ->> 'party_id' = pg_temp.got('minor', 'party_id'))
  and (select item ->> 'wording' like 'A família viaja com criança ou adolescente%junto com a família.'
       from res, jsonb_array_elements(payload -> 'needs') item
       where name = 'needs' and item ->> 'party_id' = pg_temp.got('adult', 'party_id'))
  and (select bool_and((item ->> 'planned')::boolean) from res, jsonb_array_elements(payload -> 'needs') item where name = 'needs'),
  'each claimant of the lawsuit planned in the civil court is asked, a minor through who answers for them, in the words of the setting'
);

-- No package without every word: the gate stops before anything else is looked at. (The system ONE named for the
-- lawsuit is approved by the firm first, 0066: that gate comes before every other.)
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
select public.decide_court_system(pg_temp.got('lawsuit', 'id')::uuid, true);
insert into res values ('package_early', public.request_filing_package(pg_temp.got('lawsuit', 'id')::uuid,
  gen_random_uuid(), '{}'));
reset role;
select is(pg_temp.got('package_early', 'code'), 'civil_court_unanswered',
  'no filing package is built for a lawsuit in the civil court while a claimant did not accept it');

-- ---------- On the client's link ----------

select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('link', public.create_client_link(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('case', 'person_id')::uuid,
  encode(sha256(convert_to('token-do-cliente-0044-aaaaaaaaaaaaaaaaaaaaaaaa', 'UTF8')), 'hex')));
reset role;
set local role anon;
insert into res values ('asked', public.client_link_civil_court('token-do-cliente-0044-aaaaaaaaaaaaaaaaaaaaaaaa'));
insert into res values ('asked_nothing', public.client_link_civil_court('token-que-nao-existe-0044-aaaaaaaaaaaaaaaaaaaa'));
reset role;

select ok(
  jsonb_array_length((select payload -> 'items' from res where name = 'asked')) = 2
  and (select array_agg(item ->> 'party_id' order by item ->> 'party_id') from res, jsonb_array_elements(payload -> 'items') item
       where name = 'asked')
      = (select array_agg(p order by p) from unnest(array[pg_temp.got('case', 'party_id'), pg_temp.got('minor', 'party_id')]) p)
  and pg_temp.got('asked_nothing', 'code') = 'link_not_open'
  and not has_function_privilege('anon', 'public.client_link_answer_civil_court(text, uuid, boolean, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.client_link_answer_civil_court(text, uuid, boolean, text, jsonb)', 'EXECUTE'),
  'a link asks its person for their own claim and the minors they answer for, never another adult''s; only the backend records the answer'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('stale', public.client_link_answer_civil_court('token-do-cliente-0044-aaaaaaaaaaaaaaaaaaaaaaaa',
  pg_temp.got('case', 'party_id')::uuid, true, 'Palavras que a página mostrou antes de mudarem.', '{}'));
insert into res values ('not_hers', public.client_link_answer_civil_court('token-do-cliente-0044-aaaaaaaaaaaaaaaaaaaaaaaa',
  pg_temp.got('adult', 'party_id')::uuid, true, pg_temp.words(pg_temp.got('case', 'party_id')), '{}'));
insert into res values ('own', public.client_link_answer_civil_court('token-do-cliente-0044-aaaaaaaaaaaaaaaaaaaaaaaa',
  pg_temp.got('case', 'party_id')::uuid, true, pg_temp.words(pg_temp.got('case', 'party_id')),
  '{"user_agent": "Navegador de teste", "ip": "192.0.2.10", "extra": "nunca"}'));
insert into res values ('own_again', public.client_link_answer_civil_court('token-do-cliente-0044-aaaaaaaaaaaaaaaaaaaaaaaa',
  pg_temp.got('case', 'party_id')::uuid, true, pg_temp.words(pg_temp.got('case', 'party_id')), '{}'));
insert into res values ('child', public.client_link_answer_civil_court('token-do-cliente-0044-aaaaaaaaaaaaaaaaaaaaaaaa',
  pg_temp.got('minor', 'party_id')::uuid, true, pg_temp.words(pg_temp.got('minor', 'party_id')), '{}'));
reset role;

select ok(
  pg_temp.got('stale', 'code') = 'wording_changed'
  and pg_temp.got('not_hers', 'code') = 'not_asked'
  and pg_temp.got('own', 'code') = 'accepted'
  and pg_temp.got('own_again', 'code') = 'unchanged'
  and pg_temp.got('child', 'code') = 'accepted'
  and (select source = 'client' and person_id = pg_temp.got('case', 'person_id')::uuid and version = 1
              and evidence = '{"ip": "192.0.2.10", "channel": "link", "user_agent": "Navegador de teste"}'::jsonb
              and wording = pg_temp.words(pg_temp.got('case', 'party_id'))
       from public.civil_court_answers where party_id = pg_temp.got('case', 'party_id')::uuid)
  and (select count(*) = 2 from public.case_events where case_id = pg_temp.got('case', 'case_id')::uuid
       and kind = 'civil_court_answered' and actor_type = 'client'),
  'the client answers in the words the page showed, for themselves and the minor they answer for, with what the server saw'
);

-- Nobody of the family asks for free justice (0125): the gate of the civil court waits for that word too, and here
-- it is the claimants' acceptance alone that is tried.
insert into public.free_justice_answers (org_id, case_id, party_id, person_id, asks, source, note)
select cp.org_id, cp.case_id, cp.id, public.civil_court_answerer(cp.id), false, 'firm', 'Disseram que não pedem.'
from public.proceeding_parties pp
join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
where pp.proceeding_id = pg_temp.got('lawsuit', 'id')::uuid and public.civil_court_answerer(cp.id) is not null;

-- The firm records Pedro's word, given in person, saying how: anybody of the firm.
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('firm_short', public.record_civil_court_answer(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('adult', 'party_id')::uuid, true, 'sim', null,
  pg_temp.firm_words(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('adult', 'party_id'))));
insert into res values ('firm_other', public.record_civil_court_answer(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('guardian', 'party_id')::uuid, true, 'Disse que sim no escritório.', null, 'Palavras de ninguém.'));
-- A screen read before Maria answered on her link does not overwrite her answer unseen.
insert into res values ('firm_stale', public.record_civil_court_answer(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'party_id')::uuid, false, 'Disse que não por telefone.', null,
  pg_temp.firm_words(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('case', 'party_id'))));
-- Nor records words the screen did not show.
insert into res values ('firm_words', public.record_civil_court_answer(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('adult', 'party_id')::uuid, true, 'Assinou o termo no escritório em 14/10.', null,
  'Palavras que a tela mostrou antes de mudarem, com tamanho bastante.'));
insert into res values ('firm', public.record_civil_court_answer(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('adult', 'party_id')::uuid, true, 'Assinou o termo no escritório em 14/10.', null,
  pg_temp.firm_words(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('adult', 'party_id'))));
-- Every word given: the gate lets the request through, to what a package needs next.
insert into res values ('package_open', public.request_filing_package(pg_temp.got('lawsuit', 'id')::uuid,
  gen_random_uuid(), '{}'));
reset role;

select ok(
  pg_temp.got('firm_short', 'code') = 'how_required'
  and pg_temp.got('firm_other', 'code') = 'party_not_found'
  and pg_temp.got('firm_stale', 'code') = 'answer_changed'
  and pg_temp.got('firm_words', 'code') = 'wording_changed'
  and pg_temp.got('firm', 'code') = 'recorded'
  and (select source = 'firm' and note = 'Assinou o termo no escritório em 14/10.' and recorded_by = 'ae440000-0000-4000-8000-000000000002'
              and person_id = (select person_id from public.case_parties where id = pg_temp.got('adult', 'party_id')::uuid)
       from public.civil_court_answers where party_id = pg_temp.got('adult', 'party_id')::uuid)
  and pg_temp.got('package_open', 'code') = 'petition_not_found',
  'a person of the firm records a claimant''s word given some other way, saying how; with every word given, the gate opens'
);

-- ---------- A "no" ----------

-- A package in course for the lawsuit, as a person asked it, with a petition the firm accepted.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('petition_file', public.reserve_file('be440000-0000-4000-8000-00000000000a', 'upload', 'inicial.pdf',
  'application/pdf', 300000));
select public.confirm_file(pg_temp.got('petition_file', 'file_id')::uuid, repeat('a', 64), 300000, 'application/pdf', 8);
reset role;
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('petition', public.attach_case_document(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('petition_file', 'file_id')::uuid, 'petition'));
select public.decide_case_document(pg_temp.got('petition', 'document_id')::uuid, 'accepted');
insert into res values ('package', public.request_filing_package(pg_temp.got('lawsuit', 'id')::uuid,
  pg_temp.got('petition', 'document_id')::uuid, '{}'));
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('child_no', public.client_link_answer_civil_court('token-do-cliente-0044-aaaaaaaaaaaaaaaaaaaaaaaa',
  pg_temp.got('minor', 'party_id')::uuid, false, pg_temp.words(pg_temp.got('minor', 'party_id')), '{}'));
reset role;
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('today', public.firm_today('be440000-0000-4000-8000-00000000000a'));
insert into res values ('list', public.firm_cases('be440000-0000-4000-8000-00000000000a', 'vara-civel'));
insert into res values ('package_after', public.request_filing_package(pg_temp.got('lawsuit', 'id')::uuid,
  pg_temp.got('petition', 'document_id')::uuid, '{}'));
reset role;

select ok(
  pg_temp.got('package', 'code') = 'requested'
  and pg_temp.got('child_no', 'code') = 'declined'
  and (select status from public.filing_packages where id = pg_temp.got('package', 'package_id')::uuid) = 'cancelled'
  and pg_temp.got('package_after', 'code') = 'civil_court_unanswered'
  and exists (select 1 from public.case_events where case_id = pg_temp.got('case', 'case_id')::uuid
              and kind = 'filing_package_cancelled' and actor_type = 'client' and data ->> 'reason' = 'civil_court_declined'),
  'a "no" gives up the package in course, told in the timeline, and no other is built while it stands'
);
select ok(
  (select payload ->> 'civil_court_declined' from res where name = 'today') = '1'
  and (select payload -> 'counts' ->> 'vara-civel' from res where name = 'list') = '1'
  and (select payload ->> 'total' from res where name = 'list') = '1'
  and (select payload -> 'rows' -> 0 ->> 'id' from res where name = 'list') = pg_temp.got('case', 'case_id'),
  'the firm is told: on its home and in the list of cases'
);
select ok(
  (select count(*) = 2 from public.civil_court_answers where party_id = pg_temp.got('minor', 'party_id')::uuid)
  and (select count(*) = 1 and bool_and(not accepted) from public.civil_court_answers
       where party_id = pg_temp.got('minor', 'party_id')::uuid and replaced_at is null),
  'every answer stays on record as it was given; the latest is the one in force'
);

-- A link accepts for one claimant a few times a day; saying no always passes.
update public.platform_settings set value = value || '{"answers_per_day": 1}'::jsonb where key = 'civil_court_consent';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('child_more', public.client_link_answer_civil_court('token-do-cliente-0044-aaaaaaaaaaaaaaaaaaaaaaaa',
  pg_temp.got('minor', 'party_id')::uuid, true, pg_temp.words(pg_temp.got('minor', 'party_id')), '{}'));
insert into res values ('own_no', public.client_link_answer_civil_court('token-do-cliente-0044-aaaaaaaaaaaaaaaaaaaaaaaa',
  pg_temp.got('case', 'party_id')::uuid, false, pg_temp.words(pg_temp.got('case', 'party_id')), '{}'));
reset role;
select ok(
  pg_temp.got('child_more', 'code') = 'too_many' and pg_temp.got('own_no', 'code') = 'declined',
  'a link accepts for one claimant a few times a day, and says no whenever asked'
);

-- ---------- Who gives the word today ----------

-- Maria accepts again for herself and says no for João: one case with a "no". Then João gets another guardian,
-- Rui: Maria's "no" no longer counts, nor would her "yes", and the filing waits for Rui's word.
update public.platform_settings set value = value || '{"answers_per_day": 10}'::jsonb where key = 'civil_court_consent';
select pg_temp.as_backend();
set local role service_role;
select public.client_link_answer_civil_court('token-do-cliente-0044-aaaaaaaaaaaaaaaaaaaaaaaa',
  pg_temp.got('case', 'party_id')::uuid, true, pg_temp.words(pg_temp.got('case', 'party_id')), '{}');
reset role;
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('today_before', public.firm_today('be440000-0000-4000-8000-00000000000a'));
insert into res values ('rui', public.save_case_person(pg_temp.got('case', 'case_id')::uuid, null,
  '{"full_name": "Rui Teste", "birth_date": "1980-02-02", "city": "Goiânia", "uf": "GO"}'::jsonb, 'guardian'));
select public.save_case_person(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('minor', 'person_id')::uuid, '{}'::jsonb,
  'claimant', pg_temp.got('rui', 'party_id')::uuid);
insert into res values ('needs_rui', public.case_civil_court(pg_temp.got('case', 'case_id')::uuid));
insert into res values ('today_rui', public.firm_today('be440000-0000-4000-8000-00000000000a'));
insert into res values ('list_rui', public.firm_cases('be440000-0000-4000-8000-00000000000a', 'vara-civel'));
reset role;
insert into res values ('blocker_rui', jsonb_build_object('code', public.filing_blocker(pg_temp.got('lawsuit', 'id')::uuid)));

select ok(
  pg_temp.got('today_before', 'civil_court_declined') = '1'
  and pg_temp.got('today_rui', 'civil_court_declined') = '0'
  and (select payload ->> 'total' from res where name = 'list_rui') = '0'
  and pg_temp.got('blocker_rui', 'code') = 'civil_court_unanswered'
  and (select item ->> 'answerer_id' = pg_temp.got('rui', 'person_id') and item ->> 'accepted' is null
       from res, jsonb_array_elements(payload -> 'needs') item
       where name = 'needs_rui' and item ->> 'party_id' = pg_temp.got('minor', 'party_id')),
  'a word counts while who gave it gives the claimant''s word today: another guardian is asked again, and the counts follow'
);

-- Rui's yes, given in person; a package asked and built (written here as ready), then Pedro's word taken back
-- after it was ready: the receipt asks again and is refused, and the home no longer counts the package to file.
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000002');
set local role authenticated;
select public.record_civil_court_answer(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('minor', 'party_id')::uuid, true,
  'Rui assinou o termo no escritório.', null,
  pg_temp.firm_words(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('minor', 'party_id')));
reset role;
-- Rui's word on free justice for João too (0125): Maria's no longer counts once Rui answers for him.
update public.free_justice_answers set replaced_at = now()
where party_id = pg_temp.got('minor', 'party_id')::uuid and replaced_at is null;
insert into public.free_justice_answers (org_id, case_id, party_id, person_id, asks, source, note)
select cp.org_id, cp.case_id, cp.id, public.civil_court_answerer(cp.id), false, 'firm', 'Disse que não pede.'
from public.case_parties cp where cp.id = pg_temp.got('minor', 'party_id')::uuid;
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('package_ready', public.request_filing_package(pg_temp.got('lawsuit', 'id')::uuid,
  pg_temp.got('petition', 'document_id')::uuid, '{}'));
reset role;
update public.filing_packages set status = 'ready' where id = pg_temp.got('package_ready', 'package_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('receipt_file', public.reserve_file('be440000-0000-4000-8000-00000000000a', 'upload', 'recibo.pdf',
  'application/pdf', 90000));
select public.confirm_file(pg_temp.got('receipt_file', 'file_id')::uuid, repeat('7', 64), 90000, 'application/pdf', 1);
reset role;
update public.files set uploaded_by = 'ae440000-0000-4000-8000-000000000001'
where id = pg_temp.got('receipt_file', 'file_id')::uuid;
-- Pedro's word moves to a "no" through a new answer row written as the backend would keep it, with no package
-- touched (as when the answer arrived through another way): the receipt alone must notice.
update public.civil_court_answers set accepted = false
where party_id = pg_temp.got('adult', 'party_id')::uuid and replaced_at is null;
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('today_blocked', public.firm_today('be440000-0000-4000-8000-00000000000a'));
insert into res values ('blockers', (select coalesce(jsonb_agg(to_jsonb(b)), '[]'::jsonb)
  from public.filing_blockers('be440000-0000-4000-8000-00000000000a', array[pg_temp.got('lawsuit', 'id')::uuid]) b));
insert into res values ('receipt_blocked', public.attach_filing_receipt(pg_temp.got('package_ready', 'package_id')::uuid,
  pg_temp.got('receipt_file', 'file_id')::uuid, '5000303-76.2099.8.09.0051', (now() at time zone 'America/Sao_Paulo')::date));
reset role;
update public.civil_court_answers set accepted = true
where party_id = pg_temp.got('adult', 'party_id')::uuid and replaced_at is null;
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('receipt', public.attach_filing_receipt(pg_temp.got('package_ready', 'package_id')::uuid,
  pg_temp.got('receipt_file', 'file_id')::uuid, '5000303-76.2099.8.09.0051', (now() at time zone 'America/Sao_Paulo')::date));
insert into res values ('needs_filed', public.case_civil_court(pg_temp.got('case', 'case_id')::uuid));
reset role;

select ok(
  pg_temp.got('package_ready', 'code') = 'requested'
  and pg_temp.got('today_blocked', 'filings_ready') = '0'
  and (select payload -> 0 ->> 'code' from res where name = 'blockers') = 'civil_court_unanswered'
  and pg_temp.got('receipt_blocked', 'code') = 'civil_court_unanswered'
  and pg_temp.got('receipt', 'code') = 'filed'
  and (select bool_and(not (item ->> 'planned')::boolean) and count(*) = 3
       from res, jsonb_array_elements(payload -> 'needs') item where name = 'needs_filed'),
  'what blocks a filing is asked again at the receipt and kept out of what the home counts to file; a filed lawsuit keeps its words as the record'
);

-- ---------- A minor joined after the adults were planned ----------

-- Firm A's second family: an adult planned in the small-claims court, then a minor is added.
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_3', public.create_case('be440000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-21',
  '{"full_name": "Lia Teste", "birth_date": "1988-05-05", "city": "Goiânia", "uf": "GO"}'::jsonb));
insert into res values ('lawsuit_3', public.save_proceeding(pg_temp.got('case_3', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "system": "projudi"}'::jsonb,
  array[pg_temp.got('case_3', 'party_id')::uuid]));
select public.decide_court_system(pg_temp.got('lawsuit_3', 'proceeding_id')::uuid, true);
insert into res values ('guardian_3', public.save_case_person(pg_temp.got('case_3', 'case_id')::uuid,
  pg_temp.got('case_3', 'person_id')::uuid, '{}'::jsonb, 'guardian'));
insert into res values ('minor_3', public.save_case_person(pg_temp.got('case_3', 'case_id')::uuid, null,
  '{"full_name": "Davi Teste", "birth_date": "2017-01-01"}'::jsonb, 'claimant', pg_temp.got('guardian_3', 'party_id')::uuid));
insert into res values ('package_3', public.request_filing_package(pg_temp.got('lawsuit_3', 'proceeding_id')::uuid,
  gen_random_uuid(), '{}'));
insert into res values ('together_3', public.set_family_choice(pg_temp.got('case_3', 'case_id')::uuid, 'split',
  'A família já tinha os adultos no juizado.'));
insert into res values ('back_together_3', public.set_family_choice(pg_temp.got('case_3', 'case_id')::uuid, 'together'));
reset role;

select ok(
  pg_temp.got('lawsuit_3', 'code') = 'saved'
  and pg_temp.got('package_3', 'code') = 'family_split_unchosen'
  and pg_temp.got('together_3', 'code') = 'saved'
  and pg_temp.got('back_together_3', 'code') = 'proceedings_planned',
  'adults planned in the small-claims court before a minor joined file only once a lawyer records the split, which may come after them'
);

-- The split recorded, a package for Lia's lawsuit is built (written here as ready); then the lawsuit goes to the
-- civil court: the package was built for the small-claims court, and Lia, in a family split, is asked in the
-- words of any adult.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('petition_3_file', public.reserve_file('be440000-0000-4000-8000-00000000000a', 'upload', 'inicial-3.pdf',
  'application/pdf', 300000));
select public.confirm_file(pg_temp.got('petition_3_file', 'file_id')::uuid, repeat('b', 64), 300000, 'application/pdf', 8);
reset role;
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('petition_3', public.attach_case_document(pg_temp.got('case_3', 'case_id')::uuid,
  pg_temp.got('petition_3_file', 'file_id')::uuid, 'petition'));
select public.decide_case_document(pg_temp.got('petition_3', 'document_id')::uuid, 'accepted');
insert into res values ('package_3_split', public.request_filing_package(pg_temp.got('lawsuit_3', 'proceeding_id')::uuid,
  pg_temp.got('petition_3', 'document_id')::uuid, '{}'));
reset role;
update public.filing_packages set status = 'ready' where id = pg_temp.got('package_3_split', 'package_id')::uuid;
select pg_temp.sign_in('ae440000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_proceeding(pg_temp.got('case_3', 'case_id')::uuid, pg_temp.got('lawsuit_3', 'proceeding_id')::uuid,
  '{"kind": "comum", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "system": "projudi"}'::jsonb);
insert into res values ('receipt_3', public.attach_filing_receipt(pg_temp.got('package_3_split', 'package_id')::uuid,
  pg_temp.got('receipt_file', 'file_id')::uuid, '5000401-61.2099.8.09.0051', (now() at time zone 'America/Sao_Paulo')::date));
insert into res values ('needs_3', public.case_civil_court(pg_temp.got('case_3', 'case_id')::uuid));
reset role;

select ok(
  pg_temp.got('package_3_split', 'code') = 'requested'
  and pg_temp.got('receipt_3', 'code') = 'package_outdated'
  and (select item ->> 'wording' like 'A sua ação é proposta na vara cível%'
       from res, jsonb_array_elements(payload -> 'needs') item
       where name = 'needs_3' and item ->> 'party_id' = pg_temp.got('case_3', 'party_id')),
  'a package built for the small-claims court is built again for the civil court; an adult of a split family is asked in the words of any adult'
);

-- ---------- The other firm ----------

select pg_temp.sign_in('ae440000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_needs', public.case_civil_court(pg_temp.got('case', 'case_id')::uuid));
insert into res values ('b_today', public.firm_today('be440000-0000-4000-8000-00000000000b'));
select ok(
  pg_temp.got('b_needs', 'code') = 'case_not_found'
  and (select count(*) from public.civil_court_answers) = 0
  and pg_temp.got('b_today', 'civil_court_declined') = '0',
  'another firm reads none of these answers, nor what the case needs'
);
select throws_ok(
  format($$select public.record_civil_court_answer(%L, %L, true, 'Disse que sim por telefone.', null, 'Palavras quaisquer.')$$,
    pg_temp.got('case', 'case_id'), pg_temp.got('adult', 'party_id')),
  'P0002', null,
  'nor records one for it'
);
reset role;

select * from finish();
rollback;
