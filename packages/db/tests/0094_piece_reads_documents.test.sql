begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The piece is written from what ONE already knows of the case (0091). The
-- check of a document reads the purchase on a ticket and the expense on a
-- receipt; what the documents the firm accepted say of them, as their check
-- was applied, reaches the piece and the order of the client's account; a
-- document a person decided without the AI says nothing. Two firms: nothing
-- of one reaches the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a9400000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@leitura.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a9400000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@leitura.invalid', '', now(), '{}', '{"display_name":"Caio Prado"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b9400000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-leitura', 'a9400000-0000-4000-8000-000000000001'),
  ('b9400000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-leitura', 'a9400000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b9400000-0000-4000-8000-00000000000a', 'a9400000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b9400000-0000-4000-8000-00000000000b', 'a9400000-0000-4000-8000-000000000003', 'owner', 'advogado');
-- Firm B has a person decide each check of a document: its answers wait in the queue.
insert into public.firm_autonomy (org_id, decision, mode) values ('b9400000-0000-4000-8000-00000000000b', 'document_check', 'approval');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- A document of a case, with a file of its own, as the firm received it.
create function pg_temp.document(org uuid, target_case uuid, kind text, name text) returns uuid language plpgsql as $$
declare
  reserved jsonb;
  made uuid := gen_random_uuid();
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  reserved := public.reserve_file(org, 'client', name, 'image/jpeg', 3000, null);
  perform public.confirm_file((reserved ->> 'file_id')::uuid, md5(name) || md5(name), 3000, 'image/jpeg', null);
  insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status)
  values (made, org, target_case, null, (reserved ->> 'file_id')::uuid, kind, 'client', 'received');
  return made;
end;
$$;
-- The check of a document, run and finished with an answer: ONE's word where the firm lets it, else the queue's.
create function pg_temp.checked(org uuid, document uuid, output jsonb) returns uuid language plpgsql as $$
declare
  started jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  started := public.start_ai_run(org, 'caso.documento.conferencia', repeat('c', 64), null, 'case_document', document::text,
    'check:' || document::text);
  perform public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded', output, 900, 400);
  update public.case_documents set check_run_id = (started ->> 'run_id')::uuid where id = document;
  return (started ->> 'run_id')::uuid;
end;
$$;

-- Firm A: Ana's case; firm B: Davi's.
select pg_temp.sign_in('a9400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('b9400000-0000-4000-8000-00000000000a', 'cancellation', 'LA', date '2026-09-20',
  '{"full_name": "Ana Teste", "cpf": "12345678909", "birth_date": "1985-04-02", "phone": "5500999994001"}'::jsonb));
reset role;
select pg_temp.sign_in('a9400000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('case_b', public.create_case('b9400000-0000-4000-8000-00000000000b', 'delay', 'AD', date '2026-09-20',
  '{"full_name": "Davi Teste", "phone": "5500999994003"}'::jsonb));
reset role;

-- ---------- The instructions ----------

select ok(
  (select output_schema -> 'properties' ? 'compra' and output_schema -> 'properties' ? 'gasto'
          and output_schema -> 'required' ? 'gasto'
          and strpos(system_prompt, 'o dia em que a passagem foi comprada') > 0
   from public.prompt_versions where task = 'caso.documento.conferencia' and is_active)
  and (select strpos(system_prompt, '"registro_oficial"') > 0 and strpos(system_prompt, '"gastos"') > 0
       from public.prompt_versions where task = 'caso.peca.minuta' and is_active)
  and not has_function_privilege('authenticated', 'public.case_document_readings(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.case_document_readings(uuid)', 'EXECUTE'),
  'the check reads the purchase and the expense, the piece is told what they are, and only the database reads them'
);

-- ---------- What ONE applied by itself ----------

insert into res select 'ticket', jsonb_build_object('id', pg_temp.document('b9400000-0000-4000-8000-00000000000a',
  pg_temp.got('case', 'case_id')::uuid, 'ticket', 'bilhete.jpg'));
insert into res select 'receipt', jsonb_build_object('id', pg_temp.document('b9400000-0000-4000-8000-00000000000a',
  pg_temp.got('case', 'case_id')::uuid, 'receipt', 'jantar.jpg'));
insert into res select 'refused', jsonb_build_object('id', pg_temp.document('b9400000-0000-4000-8000-00000000000a',
  pg_temp.got('case', 'case_id')::uuid, 'receipt', 'taxi.jpg'));
select pg_temp.checked('b9400000-0000-4000-8000-00000000000a', pg_temp.got('ticket', 'id')::uuid,
  '{"decisao": "aceitar", "trechos": [], "compra": {"data": "2026-08-01", "canal": "site da companhia", "valor": "R$ 980,00", "reserva": "abc123"},
    "gasto": {"descricao": "", "valor": "", "data": ""}}'::jsonb);
select pg_temp.checked('b9400000-0000-4000-8000-00000000000a', pg_temp.got('receipt', 'id')::uuid,
  '{"decisao": "aceitar", "trechos": [], "compra": {"data": "", "canal": "", "valor": "", "reserva": ""},
    "gasto": {"descricao": "Jantar no aeroporto", "valor": "R$ 62,50", "data": "2026-09-20"}}'::jsonb);
select pg_temp.checked('b9400000-0000-4000-8000-00000000000a', pg_temp.got('refused', 'id')::uuid,
  '{"decisao": "recusar", "trechos": [], "compra": {"data": "", "canal": "", "valor": "", "reserva": ""},
    "gasto": {"descricao": "Táxi", "valor": "R$ 80,00", "data": "2026-09-20"}}'::jsonb);
reset role;
-- ONE applied the first two (the firm lets it); the third was refused.
update public.case_documents set status = 'accepted', decided_at = now()
where id in (pg_temp.got('ticket', 'id')::uuid, pg_temp.got('receipt', 'id')::uuid);
update public.case_documents set status = 'rejected', rejected_reason = 'O valor do recibo não aparece.', decided_at = now()
where id = pg_temp.got('refused', 'id')::uuid;
insert into res values ('readings', public.case_document_readings(pg_temp.got('case', 'case_id')::uuid));

select ok(
  (select payload -> 'compras' = jsonb_build_array(jsonb_build_object(
            'data_da_compra', '2026-08-01', 'canal', 'site da companhia', 'valor_pago', 'R$ 980,00', 'localizador', 'ABC123',
            'documento', 'o bilhete ou a reserva da passagem',
            'enviado_em', to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')))
   from res where name = 'readings')
  and (select jsonb_array_length(payload -> 'gastos') = 1
              and payload -> 'gastos' -> 0 ->> 'descricao' = 'Jantar no aeroporto'
              and payload -> 'gastos' -> 0 ->> 'valor' = 'R$ 62,50'
              and payload -> 'gastos' -> 0 ->> 'data' = '2026-09-20'
              and payload -> 'gastos' -> 0 ->> 'documento' = 'o comprovante de gastos'
       from res where name = 'readings'),
  'what accepted documents say of the purchase and of an expense is read, and a refused one says nothing'
);

-- ---------- What a person decided ----------

insert into res select 'b_receipt', jsonb_build_object('id', pg_temp.document('b9400000-0000-4000-8000-00000000000b',
  pg_temp.got('case_b', 'case_id')::uuid, 'receipt', 'hotel.jpg'));
insert into res select 'b_withdrawn', jsonb_build_object('id', pg_temp.document('b9400000-0000-4000-8000-00000000000b',
  pg_temp.got('case_b', 'case_id')::uuid, 'receipt', 'lanche.jpg'));
select pg_temp.checked('b9400000-0000-4000-8000-00000000000b', pg_temp.got('b_receipt', 'id')::uuid,
  '{"decisao": "aceitar", "motivo": "", "tipo_identificado": "nota de hotel", "legivel": true, "nome_no_documento": "",
    "confere_com_a_pessoa": "sem_nome", "observacoes": "", "trechos": [],
    "compra": {"data": "", "canal": "", "valor": "", "reserva": ""},
    "gasto": {"descricao": "Diária de hotel", "valor": "R$ 310,00", "data": "2026-09-20"}}'::jsonb);
select pg_temp.checked('b9400000-0000-4000-8000-00000000000b', pg_temp.got('b_withdrawn', 'id')::uuid,
  '{"decisao": "aceitar", "trechos": [], "compra": {"data": "", "canal": "", "valor": "", "reserva": ""},
    "gasto": {"descricao": "Lanche", "valor": "R$ 25,00", "data": "2026-09-20"}}'::jsonb);
reset role;
insert into res select 'b_waiting', jsonb_build_object('n', count(*)) from public.approvals
where org_id = 'b9400000-0000-4000-8000-00000000000b' and status = 'pending';
-- A person approves the first check as it came (the card keeps every field the model gave), and decides the
-- second document without the AI, which withdraws its check.
select pg_temp.sign_in('a9400000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res select 'decided', public.decide_approval(a.id, 'approved',
  (select r.output from public.ai_runs r where r.id = a.run_id), null)
from public.approvals a
where a.org_id = 'b9400000-0000-4000-8000-00000000000b' and a.status = 'pending'
  and a.run_id = (select check_run_id from public.case_documents where id = pg_temp.got('b_receipt', 'id')::uuid);
reset role;
update public.approvals set status = 'withdrawn', decided_at = now()
where run_id = (select check_run_id from public.case_documents where id = pg_temp.got('b_withdrawn', 'id')::uuid);
update public.case_documents set status = 'accepted', decided_at = now() where id = pg_temp.got('b_withdrawn', 'id')::uuid;
insert into res values ('b_readings', public.case_document_readings(pg_temp.got('case_b', 'case_id')::uuid));

select ok(
  pg_temp.got('decided', 'ok') = 'true' and pg_temp.got('b_waiting', 'n') = '2'
  and (select status = 'accepted' from public.case_documents where id = pg_temp.got('b_receipt', 'id')::uuid)
  and (select jsonb_array_length(payload -> 'gastos') = 1 and payload -> 'gastos' -> 0 ->> 'descricao' = 'Diária de hotel'
       from res where name = 'b_readings')
  and (select payload -> 'compras' = '[]'::jsonb from res where name = 'b_readings'),
  'a check a person approved says what it read, and one withdrawn says nothing'
);

-- ---------- The order of the account reads them, and nothing crosses firms ----------

select pg_temp.sign_in('a9400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('statement', public.add_case_statement(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'party_id')::uuid, null,
  'O voo foi cancelado e eu esperei a noite toda no aeroporto, sem nenhuma informação da companhia.'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res select 'claim', jsonb_build_object('claim', c.claim)
from public.claim_case_statements(1, pg_temp.got('statement', 'statement_id')::uuid) c;
insert into res select 'to_order', to_jsonb(d)
from public.case_statement_to_process(pg_temp.got('statement', 'statement_id')::uuid, pg_temp.got('claim', 'claim')::integer) d;
reset role;
select ok(
  (select payload -> 'readings' -> 'compras' -> 0 ->> 'valor_pago' = 'R$ 980,00'
          and payload -> 'readings' -> 'gastos' -> 0 ->> 'valor' = 'R$ 62,50'
   from res where name = 'to_order'),
  'the order of the account reads what the documents say, so ONE never asks it of the client'
);
select ok(
  not exists (select 1 from jsonb_array_elements(public.case_document_readings(pg_temp.got('case', 'case_id')::uuid) -> 'gastos') g
              where g ->> 'descricao' in ('Diária de hotel', 'Lanche'))
  and not exists (select 1 from jsonb_array_elements(public.case_document_readings(pg_temp.got('case_b', 'case_id')::uuid) -> 'gastos') g
                  where g ->> 'descricao' = 'Jantar no aeroporto'),
  'what one firm''s documents say reaches no case of the other'
);
select pg_temp.sign_in('a9400000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  format('select public.case_document_readings(%L)', pg_temp.got('case', 'case_id')),
  '42501', null, 'no session reads what a case''s documents say but through the backend');
reset role;
select ok(
  (select count(*) = 0 from public.case_documents d
   where d.case_id = pg_temp.got('case', 'case_id')::uuid and d.status = 'accepted' and d.check_run_id is null),
  'every accepted document of the case came through its check'
);

select * from finish();
rollback;
