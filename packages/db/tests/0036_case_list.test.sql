begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

-- ============================================================
-- The firm's cases as its list reads them (0033): counted, filtered,
-- searched and paged in the database, each case with what waits in it. Two
-- firms: a case, a client or a lawsuit of one never shows in the other's
-- list, whatever is asked or searched.
--
-- Every person, firm and number here is invented: the lawsuits are of a year to come.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a0300000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@lista.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a0300000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@lista.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a0300000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@lista.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b0300000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-lista', 'a0300000-0000-4000-8000-000000000001'),
  ('b0300000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-lista', 'a0300000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b0300000-0000-4000-8000-00000000000a', 'a0300000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b0300000-0000-4000-8000-00000000000a', 'a0300000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b0300000-0000-4000-8000-00000000000b', 'a0300000-0000-4000-8000-000000000004', 'owner', 'advogado');

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal1')::text, true); $$;

-- Asks the list as a person, then leaves the session as it was.
create function pg_temp.list(who uuid, org uuid, filter text default null, search text default null,
                             page_size integer default 25, skip integer default 0) returns jsonb language plpgsql as
$$
declare
  answer jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  answer := public.firm_cases(org, filter, search, page_size, skip);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return answer;
end;
$$;

-- The numbers of the cases an answer lists, in its order.
create function pg_temp.seqs(answer jsonb) returns integer[] language sql as
$$ select coalesce(array_agg((r.value ->> 'seq')::integer order by r.ordinality), '{}') from jsonb_array_elements(answer -> 'rows') with ordinality as r; $$;

create function pg_temp.ana(filter text default null, search text default null, page_size integer default 25, skip integer default 0)
returns jsonb language sql as
$$ select pg_temp.list('a0300000-0000-4000-8000-000000000001', 'b0300000-0000-4000-8000-00000000000a', filter, search, page_size, skip); $$;

-- ---------- Firm A: six cases, each where it is and with what waits in it ----------

insert into public.people (id, org_id, full_name, cpf) values
  ('c0300000-0000-4000-8000-000000000001', 'b0300000-0000-4000-8000-00000000000a', 'João da Silva', '12345678909'),
  ('c0300000-0000-4000-8000-000000000002', 'b0300000-0000-4000-8000-00000000000a', 'Maria Conceição Souza', null),
  ('c0300000-0000-4000-8000-000000000003', 'b0300000-0000-4000-8000-00000000000a', 'Pedro Álvares', '52998224725'),
  ('c0300000-0000-4000-8000-000000000004', 'b0300000-0000-4000-8000-00000000000a', 'Ana Clara Pequena', null),
  ('c0300000-0000-4000-8000-000000000005', 'b0300000-0000-4000-8000-00000000000a', 'Carla Responsável', null),
  ('c0300000-0000-4000-8000-00000000000b', 'b0300000-0000-4000-8000-00000000000b', 'João da Silva', '12345678909');

--   #1 intake      João: a document nobody checked, and his link says he finished
--   #2 drafting    Maria: a chronology she contested, a complaint past its day, a piece the AI could not write
--   #3 filed       Pedro: a lawsuit in court that moved
--   #4 closed      João again: a document nobody checked and a contested chronology, which wait for nobody now
--   #5 documents   a minor, named by who answers for her
--   #6 declined    Maria again
insert into public.cases (id, org_id, seq, incident, airline_iata, flight_date, status, closed_at, close_reason, updated_at) values
  ('d0300000-0000-4000-8000-000000000001', 'b0300000-0000-4000-8000-00000000000a', 1, 'delay', 'G3', date '2026-07-20', 'intake', null, null, now() - interval '1 hour'),
  ('d0300000-0000-4000-8000-000000000002', 'b0300000-0000-4000-8000-00000000000a', 2, 'cancellation', 'AD', null, 'drafting', null, null, now() - interval '2 hours'),
  ('d0300000-0000-4000-8000-000000000003', 'b0300000-0000-4000-8000-00000000000a', 3, 'other', null, null, 'filed', null, null, now() - interval '3 hours'),
  ('d0300000-0000-4000-8000-000000000004', 'b0300000-0000-4000-8000-00000000000a', 4, 'delay', 'G3', null, 'closed', now(), 'Acordo cumprido pela companhia', now() - interval '4 hours'),
  ('d0300000-0000-4000-8000-000000000005', 'b0300000-0000-4000-8000-00000000000a', 5, 'overbooking', null, null, 'documents', null, null, now() - interval '5 hours'),
  ('d0300000-0000-4000-8000-000000000006', 'b0300000-0000-4000-8000-00000000000a', 6, 'delay', null, null, 'declined', now(), 'Fora do prazo para pedir', now() - interval '6 hours'),
  ('d0300000-0000-4000-8000-00000000000b', 'b0300000-0000-4000-8000-00000000000b', 1, 'delay', null, null, 'intake', null, null, now());

insert into public.case_parties (id, org_id, case_id, person_id, role, guardian_id) values
  ('e0300000-0000-4000-8000-000000000001', 'b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000001', 'c0300000-0000-4000-8000-000000000001', 'claimant', null),
  ('e0300000-0000-4000-8000-000000000002', 'b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000002', 'c0300000-0000-4000-8000-000000000002', 'claimant', null),
  ('e0300000-0000-4000-8000-000000000003', 'b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000003', 'c0300000-0000-4000-8000-000000000003', 'claimant', null),
  ('e0300000-0000-4000-8000-000000000004', 'b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000004', 'c0300000-0000-4000-8000-000000000001', 'claimant', null),
  ('e0300000-0000-4000-8000-000000000005', 'b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000005', 'c0300000-0000-4000-8000-000000000005', 'guardian', null),
  ('e0300000-0000-4000-8000-000000000006', 'b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000006', 'c0300000-0000-4000-8000-000000000002', 'claimant', null),
  ('e0300000-0000-4000-8000-00000000000b', 'b0300000-0000-4000-8000-00000000000b', 'd0300000-0000-4000-8000-00000000000b', 'c0300000-0000-4000-8000-00000000000b', 'claimant', null);
-- The minor of #5 is a claimant the guardian answers for; written first, she still does not name the case.
insert into public.case_parties (id, org_id, case_id, person_id, role, guardian_id, created_at) values
  ('e0300000-0000-4000-8000-000000000007', 'b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000005', 'c0300000-0000-4000-8000-000000000004', 'claimant', 'e0300000-0000-4000-8000-000000000005', now() - interval '1 day');

-- Documents nobody checked: one in #1, two in #4, one in firm B.
insert into public.files (id, org_id, purpose, storage_path, name, declared_mime, declared_bytes, status, sha256, bytes, detected_mime, expires_at, confirmed_at)
select f.id, f.org_id, 'client', 'org/' || f.org_id || '/client/' || f.id, 'documento.pdf', 'application/pdf', 100, 'stored',
       repeat(f.mark, 64), 100, 'application/pdf', now() + interval '1 hour', now()
from (values
  ('f0300000-0000-4000-8000-000000000001'::uuid, 'b0300000-0000-4000-8000-00000000000a'::uuid, '1'),
  ('f0300000-0000-4000-8000-000000000002'::uuid, 'b0300000-0000-4000-8000-00000000000a'::uuid, '2'),
  ('f0300000-0000-4000-8000-000000000003'::uuid, 'b0300000-0000-4000-8000-00000000000a'::uuid, '3'),
  ('f0300000-0000-4000-8000-000000000004'::uuid, 'b0300000-0000-4000-8000-00000000000a'::uuid, '4'),
  ('f0300000-0000-4000-8000-00000000000b'::uuid, 'b0300000-0000-4000-8000-00000000000b'::uuid, 'b')
) as f (id, org_id, mark);
insert into public.case_documents (org_id, case_id, file_id, kind, source, status, decided_at) values
  ('b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000001', 'f0300000-0000-4000-8000-000000000001', 'identity', 'client', 'received', null),
  ('b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000004', 'f0300000-0000-4000-8000-000000000002', 'ticket', 'client', 'received', null),
  ('b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000004', 'f0300000-0000-4000-8000-000000000003', 'receipt', 'client', 'received', null),
  -- One somebody already accepted waits for nobody.
  ('b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000002', 'f0300000-0000-4000-8000-000000000004', 'identity', 'firm', 'accepted', now()),
  ('b0300000-0000-4000-8000-00000000000b', 'd0300000-0000-4000-8000-00000000000b', 'f0300000-0000-4000-8000-00000000000b', 'identity', 'client', 'received', null);

-- The client's link: João finished on #1; the link of #2 was ended by the firm, so its word counts no more.
insert into public.client_links (org_id, case_id, person_id, token_hash, expires_at, finished_at, revoked_at) values
  ('b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000001', 'c0300000-0000-4000-8000-000000000001', repeat('1', 64), now() + interval '30 days', now(), null),
  ('b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000002', 'c0300000-0000-4000-8000-000000000002', repeat('2', 64), now() + interval '30 days', now(), now());

insert into public.case_statements (org_id, case_id, source, transcript, chronology_status) values
  ('b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000002', 'firm', 'O voo foi cancelado na véspera.', 'contested'),
  ('b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000004', 'firm', 'O voo atrasou seis horas.', 'contested'),
  ('b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000001', 'firm', 'O voo atrasou.', 'approved');
insert into public.admin_complaints (org_id, case_id, channel, answer_due_on, outcome) values
  ('b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000002', 'anac_passageiro', current_date - 3, 'pending'),
  -- One whose day has not come, and one already answered, wait for nobody.
  ('b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000001', 'consumidor_gov', current_date + 5, 'pending'),
  ('b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000003', 'procon', current_date - 9, 'answered');

-- The lawsuits: a planned one in #2 (whose piece the AI could not write), a planned one in #1 (whose piece waits in
-- the firm's queue, which is somewhere else to decide), Pedro's in court, and one of firm B with another number.
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj) values
  ('10300000-0000-4000-8000-000000000001', 'b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000001', 'juizado', 'TJGO', 'planned', null),
  ('10300000-0000-4000-8000-000000000002', 'b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000002', 'juizado', 'TJGO', 'planned', null),
  ('10300000-0000-4000-8000-000000000003', 'b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000003', 'juizado', 'TJGO', 'filed', '50001236020998090051'),
  ('10300000-0000-4000-8000-00000000000b', 'b0300000-0000-4000-8000-00000000000b', 'd0300000-0000-4000-8000-00000000000b', 'juizado', 'TJGO', 'filed', '50002023920998090051');

insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, status, output, finished_at)
select '20300000-0000-4000-8000-000000000001', 'b0300000-0000-4000-8000-00000000000a', 'plataforma.verificacao', version.id,
       version.provider, version.model, repeat('a', 64), 'succeeded', '{"resposta": "teste"}'::jsonb, now()
from public.prompt_versions version where version.task = 'plataforma.verificacao' and version.is_active;
insert into public.approvals (org_id, run_id, task, approver_functions) values
  ('b0300000-0000-4000-8000-00000000000a', '20300000-0000-4000-8000-000000000001', 'plataforma.verificacao', array['socio', 'advogado']::public.firm_function[]);
insert into public.case_drafts (org_id, case_id, proceeding_id, template_name, template_body, mode, status, version, run_id) values
  ('b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000002', '10300000-0000-4000-8000-000000000002',
   'Petição inicial', 'Modelo de teste, com o texto de uma peça.', 'ai', 'failed', 0, null),
  ('b0300000-0000-4000-8000-00000000000a', 'd0300000-0000-4000-8000-000000000001', '10300000-0000-4000-8000-000000000001',
   'Petição inicial', 'Modelo de teste, com o texto de uma peça.', 'ai', 'proposed', 1, '20300000-0000-4000-8000-000000000001');

-- Pedro's lawsuit moved and nobody of the firm saw it yet.
update public.proceeding_tracking set status = 'tracked', unseen_count = 2
where proceeding_id = '10300000-0000-4000-8000-000000000003';

-- ---------- The counts, and the cases still going ----------

select is(
  pg_temp.ana() -> 'counts',
  '{"all": 6, "going": 4, "open": 2, "preparing": 1, "filed": 1, "ended": 2, "documentos": 2, "cliente-terminou": 1,
    "cronologia": 1, "reclamacao": 1, "pecas": 1, "andamento": 1, "vara-civel": 0, "agencia": 0,
    "novos-mes": 6, "ajuizados-mes": 0, "encerrados-mes": 2, "arquivados-mes": 0,
    "mov-hoje": 0, "mov-7": 0, "mov-30": 0, "parado-30": 0, "parado-45": 0, "parado-90": 0, "nunca-capturados": 1}'::jsonb,
  'the list counts the firm''s cases under every filter, as the home counts what waits'
);
select ok(
  pg_temp.seqs(pg_temp.ana()) = array[1, 2, 3, 5] and (pg_temp.ana() ->> 'total')::integer = 4,
  'with no filter the list shows every case still going, the most recently changed first'
);
select is(
  -- Who has each case and how long it is at its step (0111) are 0112's, and whether it is a test (0114) is 0115's.
  (select jsonb_agg(row.value - 'id'::text - 'updated_at'::text - 'created_at'::text - 'holder'::text - 'why'::text
     - 'step'::text - 'step_since'::text - 'step_days'::text - 'stagnant'::text - 'is_test'::text order by row.ordinality)
   from jsonb_array_elements(pg_temp.ana() -> 'rows') with ordinality as row where row.ordinality in (1, 4)),
  '[{"seq": 1, "client": "João da Silva", "module": "direito-do-passageiro", "incident": "delay", "airline_iata": "G3", "flight_date": "2026-07-20", "status": "intake",
     "to_review": 1, "client_finished": true, "chronology_contested": false, "complaint_overdue": false,
     "piece_waiting": false, "court_moved": false, "civil_refused": false, "agency": null,
     "moved_at": null, "court": null, "cnjs": []},
    {"seq": 5, "client": "Carla Responsável", "module": "direito-do-passageiro", "incident": "overbooking", "airline_iata": null, "flight_date": null, "status": "documents",
     "to_review": 0, "client_finished": false, "chronology_contested": false, "complaint_overdue": false,
     "piece_waiting": false, "court_moved": false, "civil_refused": false, "agency": null,
     "moved_at": null, "court": null, "cnjs": []}]'::jsonb,
  'each case says who it is of and what waits in it; a case of a minor alone is named by who answers for her'
);

-- ---------- Each filter ----------

select ok(
  pg_temp.seqs(pg_temp.ana('open')) = array[1, 5] and pg_temp.seqs(pg_temp.ana('preparing')) = array[2]
  and pg_temp.seqs(pg_temp.ana('filed')) = array[3] and pg_temp.seqs(pg_temp.ana('ended')) = array[4, 6]
  and (pg_temp.ana('ended') ->> 'total')::integer = 2,
  'a group of stages lists the cases in it'
);
select ok(
  -- A document nobody checked is to be checked wherever its case is; the rest waits only while the case goes on.
  pg_temp.seqs(pg_temp.ana('documentos')) = array[1, 4] and pg_temp.seqs(pg_temp.ana('cliente-terminou')) = array[1]
  and pg_temp.seqs(pg_temp.ana('cronologia')) = array[2] and pg_temp.seqs(pg_temp.ana('reclamacao')) = array[2]
  and pg_temp.seqs(pg_temp.ana('pecas')) = array[2] and pg_temp.seqs(pg_temp.ana('andamento')) = array[3],
  'what waits for the firm lists the cases it waits in: a piece in the firm''s queue, a link the firm ended and a case that ended wait for nobody here'
);

-- A lawsuit whose reading was given up counts as one that needs somebody; one no longer followed does not.
update public.proceeding_tracking set status = 'failed', unseen_count = 0 where proceeding_id = '10300000-0000-4000-8000-000000000003';
select is(pg_temp.seqs(pg_temp.ana('andamento')), array[3], 'a lawsuit whose reading was given up is in the list of what moved');
update public.proceeding_tracking set status = 'off', unseen_count = 2 where proceeding_id = '10300000-0000-4000-8000-000000000003';
select is(pg_temp.seqs(pg_temp.ana('andamento')), '{}'::integer[], 'one no longer followed is not');
update public.proceeding_tracking set status = 'tracked', unseen_count = 2 where proceeding_id = '10300000-0000-4000-8000-000000000003';

-- ---------- Searching ----------

select ok(
  -- Every word, in any order, with or without accents or capitals; the ended cases too.
  pg_temp.seqs(pg_temp.ana(null, 'silva joao')) = array[1, 4]
  and pg_temp.seqs(pg_temp.ana(null, 'CONCEICAO')) = array[2, 6]
  and pg_temp.seqs(pg_temp.ana(null, '  Álvares ')) = array[3]
  -- A minor's case is found by her name and by who answers for her.
  and pg_temp.seqs(pg_temp.ana(null, 'ana pequena')) = array[5]
  and pg_temp.seqs(pg_temp.ana(null, 'responsavel carla')) = array[5]
  and pg_temp.seqs(pg_temp.ana(null, 'joao souza')) = '{}'::integer[]
  and (pg_temp.ana(null, 'silva joao') ->> 'total')::integer = 2,
  'a client is found by the words of the name, in any order and without the accents, in every case of theirs'
);
select ok(
  pg_temp.seqs(pg_temp.ana(null, '123.456.789-09')) = array[1, 4]
  and pg_temp.seqs(pg_temp.ana(null, '52998224725')) = array[3]
  and pg_temp.seqs(pg_temp.ana(null, '111.444.777-35')) = '{}'::integer[],
  'a client is found by the CPF, typed with or without its mask'
);
select ok(
  pg_temp.seqs(pg_temp.ana(null, '5000123-60.2099.8.09.0051')) = array[3]
  and pg_temp.seqs(pg_temp.ana(null, '50001236020998090051')) = array[3]
  and pg_temp.seqs(pg_temp.ana(null, '5000123')) = array[3]
  -- A lawsuit of another firm is found by nobody here.
  and pg_temp.seqs(pg_temp.ana(null, '5000202-39.2099.8.09.0051')) = '{}'::integer[],
  'a case is found by its lawsuit''s number, whole or by how it starts'
);
select ok(
  pg_temp.seqs(pg_temp.ana(null, '6')) = array[6] and pg_temp.seqs(pg_temp.ana(null, '#2')) = array[2]
  and pg_temp.seqs(pg_temp.ana(null, '99')) = '{}'::integer[],
  'a case is found by its own number'
);
select ok(
  -- A filter and a search together: João's cases that ended, and his cases still open.
  pg_temp.seqs(pg_temp.ana('ended', 'joao')) = array[4] and pg_temp.seqs(pg_temp.ana('open', 'joao')) = array[1]
  and pg_temp.seqs(pg_temp.ana('filed', 'joao')) = '{}'::integer[]
  -- The counts are the firm's, whatever is searched.
  and pg_temp.ana('ended', 'joao') -> 'counts' = pg_temp.ana() -> 'counts'
  -- What is typed that is neither a name nor a number searches nothing.
  and pg_temp.seqs(pg_temp.ana(null, ' - . ')) = array[1, 2, 3, 5],
  'a search inside a filter finds what is in both, and the counts stay the firm''s'
);

-- ---------- A page at a time ----------

select ok(
  pg_temp.seqs(pg_temp.ana(null, null, 2, 0)) = array[1, 2] and pg_temp.seqs(pg_temp.ana(null, null, 2, 2)) = array[3, 5]
  and pg_temp.seqs(pg_temp.ana(null, null, 2, 4)) = '{}'::integer[]
  and (pg_temp.ana(null, null, 2, 4) ->> 'total')::integer = 4
  -- A size that is none is a page of one at least, and never more than a hundred.
  and pg_temp.seqs(pg_temp.ana(null, null, 0, 0)) = array[1]
  and pg_temp.seqs(pg_temp.ana(null, null, 5000, -3)) = array[1, 2, 3, 5],
  'the list is read a page at a time, and says how many cases there are in all'
);

-- ---------- Two firms, and who may ask ----------

select ok(
  pg_temp.seqs(pg_temp.list('a0300000-0000-4000-8000-000000000004', 'b0300000-0000-4000-8000-00000000000b')) = array[1]
  and (pg_temp.list('a0300000-0000-4000-8000-000000000004', 'b0300000-0000-4000-8000-00000000000b') -> 'counts' ->> 'all')::integer = 1
  and (pg_temp.list('a0300000-0000-4000-8000-000000000004', 'b0300000-0000-4000-8000-00000000000b') -> 'counts' ->> 'documentos')::integer = 1
  -- The same name and the same CPF live in both firms: each finds its own client only.
  and (pg_temp.list('a0300000-0000-4000-8000-000000000004', 'b0300000-0000-4000-8000-00000000000b', null, '12345678909') ->> 'total')::integer = 1
  and (pg_temp.list('a0300000-0000-4000-8000-000000000004', 'b0300000-0000-4000-8000-00000000000b', null, '5000123') ->> 'total')::integer = 0,
  'a firm lists, counts and finds its own cases and none of another'
);
select is(
  pg_temp.seqs(pg_temp.list('a0300000-0000-4000-8000-000000000002', 'b0300000-0000-4000-8000-00000000000a')),
  array[1, 2, 3, 5], 'anybody of the firm reads its list'
);

select pg_temp.sign_in('a0300000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.firm_cases('b0300000-0000-4000-8000-00000000000a')$$,
  '42501', 'not_authorized', 'nobody reads the list of another firm'
);
reset role;
select pg_temp.sign_in('a0300000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.firm_cases('b0300000-0000-4000-8000-00000000000a', 'tudo')$$,
  '22023', 'invalid_filter', 'a filter the list does not have is refused, never read as no filter'
);
reset role;

select * from finish();
rollback;
