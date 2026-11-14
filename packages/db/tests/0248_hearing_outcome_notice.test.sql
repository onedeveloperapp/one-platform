begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The client told what came of their hearing (0248). Lia's conciliation
-- at firm A was held with no settlement, said twenty minutes ago: her
-- notice is due with the result and what comes next. A settlement is said
-- with the airline's term to pay and never its value; an instruction
-- hearing and a hearing that did not take place have their own words. A
-- hearing said a moment ago waits for a correction. Nothing of firm A
-- reaches firm B.
--
-- Every person, firm, name and number here is invented; the lawsuit's
-- number is of a year to come.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2480000-0000-4000-8000-000000000001', 'ana@lima-resultado.invalid', 'Ana Lima'),
  ('a2480000-0000-4000-8000-000000000002', 'duda@rocha-resultado.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b2480000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-resultado', 'a2480000-0000-4000-8000-000000000001'),
  ('b2480000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-resultado', 'a2480000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2480000-0000-4000-8000-00000000000a', 'a2480000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2480000-0000-4000-8000-00000000000b', 'a2480000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2480000-0000-4000-8000-000000000001', 'b2480000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'cancellation', 'filed');
insert into public.people (id, org_id, full_name, birth_date, phone, updated_via) values
  ('d2480000-0000-4000-8000-000000000001', 'b2480000-0000-4000-8000-00000000000a', 'Lia Teste', '1990-05-04', '5500988884801', 'firm');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e2480000-0000-4000-8000-000000000001', 'b2480000-0000-4000-8000-00000000000a', 'c2480000-0000-4000-8000-000000000001',
   'd2480000-0000-4000-8000-000000000001', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f2480000-0000-4000-8000-000000000001', 'b2480000-0000-4000-8000-00000000000a', 'c2480000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2099-09-01');
insert into public.proceeding_parties (org_id, proceeding_id, party_id) values
  ('b2480000-0000-4000-8000-00000000000a', 'f2480000-0000-4000-8000-000000000001', 'e2480000-0000-4000-8000-000000000001');

-- The conciliation, held with no settlement twenty minutes ago; an instruction, held a minute ago.
insert into public.hearings (id, org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode, status, outcome) values
  ('a2480000-0000-4000-8000-0000000000a1', 'b2480000-0000-4000-8000-00000000000a', 'c2480000-0000-4000-8000-000000000001',
   'f2480000-0000-4000-8000-000000000001', 'conciliacao', now() - interval '2 hours', 'America/Sao_Paulo', 'presencial',
   'held', 'sem_acordo'),
  ('a2480000-0000-4000-8000-0000000000a2', 'b2480000-0000-4000-8000-00000000000a', 'c2480000-0000-4000-8000-000000000001',
   'f2480000-0000-4000-8000-000000000001', 'instrucao', now() - interval '1 hour', 'America/Sao_Paulo', 'presencial',
   'held', 'acordo');
insert into public.case_events (org_id, case_id, kind, actor_type, data, at) values
  ('b2480000-0000-4000-8000-00000000000a', 'c2480000-0000-4000-8000-000000000001', 'hearing_held', 'person',
   '{"hearing": "a2480000-0000-4000-8000-0000000000a1", "outcome": "sem_acordo"}', now() - interval '20 minutes'),
  ('b2480000-0000-4000-8000-00000000000a', 'c2480000-0000-4000-8000-000000000001', 'hearing_held', 'system',
   '{"hearing": "a2480000-0000-4000-8000-0000000000a2", "outcome": "acordo"}', now() - interval '1 minute');
insert into public.hearing_reports (org_id, case_id, hearing_id, result, cents, pay_days, summary) values
  ('b2480000-0000-4000-8000-00000000000a', 'c2480000-0000-4000-8000-000000000001', 'a2480000-0000-4000-8000-0000000000a2',
   'acordo', 300000, 15, 'Acordo de três mil reais, pago em quinze dias.');

select is(
  (select params[5] from public.notice_candidates('b2480000-0000-4000-8000-00000000000a') c
   where c.kind = 'hearing_outcome' and c.hearing_id = 'a2480000-0000-4000-8000-0000000000a1'),
  'não houve acordo. O processo segue para a decisão do juiz, e o escritório avisa você quando ela sair.',
  'the client of a hearing held with no settlement is due the result and what comes next');
select ok(
  (select params[1] = 'Lia' and params[3] = 'audiência de conciliação' and person_id = 'd2480000-0000-4000-8000-000000000001'
   from public.notice_candidates('b2480000-0000-4000-8000-00000000000a') c
   where c.kind = 'hearing_outcome' and c.hearing_id = 'a2480000-0000-4000-8000-0000000000a1'),
  'to her, naming the hearing');
select is(
  (select count(*)::integer from public.notice_candidates('b2480000-0000-4000-8000-00000000000a') c
   where c.kind = 'hearing_outcome' and c.hearing_id = 'a2480000-0000-4000-8000-0000000000a2'),
  0, 'a result said a moment ago waits for a correction');
select is(
  public.hearing_outcome_words('a2480000-0000-4000-8000-0000000000a2'),
  'houve acordo com a companhia aérea, que tem 15 dias para pagar. O escritório acompanha o pagamento e fala com você sobre os valores.',
  'a settlement is said with the airline''s term to pay, never its value');
update public.hearings set outcome = 'outro' where id = 'a2480000-0000-4000-8000-0000000000a2';
update public.hearing_reports set result = 'instrucao', cents = null where hearing_id = 'a2480000-0000-4000-8000-0000000000a2';
select ok(
  public.hearing_outcome_words('a2480000-0000-4000-8000-0000000000a2') like 'não houve acordo, e o juiz marcou uma audiência de instrução.%',
  'an instruction hearing marked has its own words');
update public.hearings set status = 'scheduled', outcome = null where id = 'a2480000-0000-4000-8000-0000000000a2';
update public.hearing_reports set result = 'nao_realizada' where hearing_id = 'a2480000-0000-4000-8000-0000000000a2';
select is(public.hearing_outcome_words('a2480000-0000-4000-8000-0000000000a2'),
  'a audiência não aconteceu. O escritório avisa você da nova data.', 'and a hearing that did not take place');

-- Nobody of another firm reads it.
select set_config('request.jwt.claims', '{"sub":"a2480000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.hearings where org_id = 'b2480000-0000-4000-8000-00000000000a')
  + (select count(*)::integer from public.hearing_reports where org_id = 'b2480000-0000-4000-8000-00000000000a'),
  0, 'another firm reads neither the hearings nor their results');
reset role;

select * from finish();
rollback;
