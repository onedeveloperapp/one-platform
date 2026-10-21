begin;
create extension if not exists pgtap;
select plan(40);

-- ============================================================
-- What the courts publish to the firm's lawyers (0028). The backend reads
-- the DJEN for each registration at the bar held by somebody of a firm, a
-- few days at a time, and keeps each communication once under its hash; a
-- person of the firm says what each one is; and the AI says it too, in
-- shadow mode: beside the person's word, out of the firm's sight. Two firms:
-- nothing of one reaches the other, even when a court addressed the same
-- communication to both.
--
-- Every person, firm, registration and case number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ad100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('ad100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('ad100000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@souza.invalid', '', now(), '{}', '{"display_name":"Caio Reis"}', now(), now()),
  ('ad100000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'eva@souza.invalid', '', now(), '{}', '{"display_name":"Eva Dias"}', now(), now()),
  ('ad100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('ad100000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'olga@one.invalid', '', now(), '{}', '{"display_name":"Olga Operadora"}', now(), now());
update public.profiles set is_superadmin = true where id = 'ad100000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('bd100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'ad100000-0000-4000-8000-000000000001'),
  ('bd100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'ad100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bd100000-0000-4000-8000-00000000000a', 'ad100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('bd100000-0000-4000-8000-00000000000a', 'ad100000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('bd100000-0000-4000-8000-00000000000a', 'ad100000-0000-4000-8000-000000000003', 'member', 'controladoria'),
  ('bd100000-0000-4000-8000-00000000000a', 'ad100000-0000-4000-8000-000000000005', 'member', 'advogado'),
  ('bd100000-0000-4000-8000-00000000000b', 'ad100000-0000-4000-8000-000000000004', 'owner', 'advogado');
-- Who is registered at the bar: Ana in two states; Eva, Davi and Bia (who answers clients, and is a lawyer too,
-- under a number with a letter) in one. Caio, who runs the deadlines, is registered nowhere.
insert into public.oab_registrations (id, user_id, uf, number, kind) values
  ('cd100000-0000-4000-8000-000000000001', 'ad100000-0000-4000-8000-000000000001', 'GO', '12345', 'principal'),
  ('cd100000-0000-4000-8000-000000000002', 'ad100000-0000-4000-8000-000000000001', 'SP', '54321', 'suplementar'),
  ('cd100000-0000-4000-8000-000000000003', 'ad100000-0000-4000-8000-000000000005', 'GO', '22222', 'principal'),
  ('cd100000-0000-4000-8000-000000000004', 'ad100000-0000-4000-8000-000000000004', 'GO', '99999', 'principal'),
  ('cd100000-0000-4000-8000-000000000005', 'ad100000-0000-4000-8000-000000000002', 'GO', '33333A', 'principal');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2', 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.today() returns date language sql as
$$ select (now() at time zone 'America/Sao_Paulo')::date; $$;
-- The reading of a registration, by the registration that holds it now.
create function pg_temp.capture_of(registration uuid) returns uuid language sql as
$$ select id from public.djen_captures where registration_id = capture_of.registration; $$;
-- The backend claims the reading of one registration, whose wait is taken as over, and asks what to read.
create function pg_temp.claim(registration uuid) returns jsonb language plpgsql as $$
declare
  held record;
  claimed jsonb;
begin
  update public.djen_captures set retry_after = null, captured_at = captured_at - interval '1 day'
  where registration_id = registration;
  select * into held from public.claim_djen_captures(1, pg_temp.capture_of(registration));
  select to_jsonb(r) into claimed from public.djen_capture_to_read(held.capture_id, held.claim) r;
  return claimed;
end;
$$;
-- A communication as the worker hands it over: with the start of its text as plain text.
create function pg_temp.item(hash text, cnj text, day text, body text, active boolean default true, reason text default null)
returns jsonb language sql as
$$ select jsonb_build_object('hash', hash, 'court', 'TJGO', 'cnj', cnj, 'available_on', day, 'kind', 'Intimação',
     'document_type', 'Despacho', 'text', body, 'head', left(body, 1200),
     'link', 'https://projudi.tjgo.jus.br/BuscaProcesso', 'unit', '2º Juizado Especial Cível de Goiânia',
     'class_name', 'Procedimento do Juizado Especial Cível', 'active', active, 'cancel_reason', reason); $$;
-- A run of the shadow triage for a publication, finished with an answer (as the service role).
create function pg_temp.ran(org uuid, publication uuid, output jsonb, claim integer default 1) returns jsonb language plpgsql as $$
declare
  started jsonb := public.start_ai_run(org, 'publicacao.triagem', repeat('f', 64), null, 'publication', publication::text,
    'triagem:' || publication::text || ':' || claim::text);
begin
  return public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded', output, 500, 60)
    || jsonb_build_object('run_id', started ->> 'run_id');
end;
$$;
-- A publication of a firm, by its hash.
create function pg_temp.pub(org uuid, hash text) returns uuid language sql as
$$ select id from public.publications p where p.org_id = pub.org and p.hash = pub.hash; $$;

-- A case of firm A with a lawsuit the court already has, and one still planned.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('bd100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('lawsuit', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "system": "projudi", "status": "filed", "cnj": "5000202-39.2099.8.09.0051", "filed_at": "2026-10-01"}'::jsonb,
  array[pg_temp.got('case', 'party_id')::uuid]));
insert into res values ('lawsuit_planned', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "comum", "court": "TJGO", "system": "projudi"}'::jsonb));
reset role;

-- ---------- Who is read ----------

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select count(*) from public.claim_djen_captures(10)$$, '42501', null,
  'a person never claims a capture: only the backend reads the DJEN');
select throws_ok($$select public.prepare_djen_captures()$$, '42501', null,
  'nor says who is read');
reset role;

create temporary table held (capture_id uuid, claim integer);
grant select, insert on held to service_role;
select pg_temp.as_backend();
set local role service_role;
select public.prepare_djen_captures();
insert into held select * from public.claim_djen_captures(10);
insert into res values ('first', (select jsonb_build_object(
  'count', count(*), 'claims', jsonb_agg(distinct r.claim),
  'since', jsonb_agg(distinct r.since), 'through', jsonb_agg(distinct r.through), 'windows', jsonb_agg(distinct r.window_days),
  'lawyers', jsonb_agg(r.uf || r.number order by r.uf, r.number))
  from held h cross join lateral public.djen_capture_to_read(h.capture_id, h.claim) r));
insert into res values ('again', jsonb_build_object('count', (select count(*) from public.claim_djen_captures(10))));
-- What to read is told to who holds the claim, and to nobody else.
insert into res values ('not_held', jsonb_build_object('count',
  (select count(*) from held h cross join lateral public.djen_capture_to_read(h.capture_id, h.claim + 1) r)));
reset role;

select ok(
  pg_temp.got('first', 'count') = '5'
  and (select payload -> 'lawyers' = '["GO12345", "GO22222", "GO33333A", "GO99999", "SP54321"]'::jsonb and payload -> 'claims' = '[1]'::jsonb
              and payload -> 'since' = jsonb_build_array(pg_temp.today() - 30)
              and payload -> 'through' = jsonb_build_array(pg_temp.today())
              and payload -> 'windows' = '[5]'::jsonb
       from res where name = 'first')
  and pg_temp.got('again', 'count') = '0' and pg_temp.got('not_held', 'count') = '0'
  and (select count(*) = 5 from public.djen_captures),
  'every registration held by somebody of a firm is read, whatever they do in it, from thirty days back to today the first time, once'
);

-- ---------- A capture ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('wrong_claim', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000001'), 7, 'done', '[]'::jsonb, null, pg_temp.today()));
-- A round that ends names the day it read through: one that names none says nothing was read, and is refused.
insert into res values ('no_day', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000001'), 1, 'done', '[]'::jsonb));
insert into res values ('no_day_row', (select jsonb_build_object('held', claimed_at is not null, 'at', captured_at)
  from public.djen_captures where registration_id = 'cd100000-0000-4000-8000-000000000001'));
insert into res values ('captured', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000001'), 1, 'done',
  jsonb_build_array(
    pg_temp.item('hashdolitigio0001abcdefghijkl', '5000202-39.2099.8.09.0051', (current_date - 2)::text, 'Fica a parte autora intimada a se manifestar em cinco dias.'),
    pg_temp.item('hashsemcaso00001abcdefghijklm', '50003037620998090051', (current_date - 1)::text, 'Designada audiência de conciliação.'),
    pg_temp.item('curto', '50003037620998090051', (current_date - 1)::text, 'Sem hash que sirva.'),
    pg_temp.item('hashsemnumero0001abcdefghijkl', '123', (current_date - 1)::text, 'Sem número de processo.'),
    pg_temp.item('hashdofuturo00001abcdefghijkl', '50003037620998090051', (current_date + 30)::text, 'Com um dia que ainda não veio.'),
    -- A day that is not one: left out alone, the others kept. Written another way it is no day either, and
    -- one the calendar does not have is refused by the database itself.
    pg_temp.item('hashsemdia0000001abcdefghijkl', '50003037620998090051', 'ontem', 'Com um dia que não é um dia.'),
    pg_temp.item('hashdiatrocado001abcdefghijkl', '50003037620998090051', to_char(current_date - 1, 'DD/MM/YYYY'), 'Com o dia escrito de outro jeito.'),
    pg_temp.item('hashdiaquenaoha01abcdefghijkl', '50003037620998090051', '2026-02-31', 'Com um dia que o calendário não tem.')),
  null, pg_temp.today()));
insert into res values ('recorded_twice', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000001'), 1, 'done', '[]'::jsonb, null, pg_temp.today()));
-- The same communication was addressed to a lawyer of the other firm too.
insert into res values ('captured_b', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000004'), 1, 'done',
  jsonb_build_array(pg_temp.item('hashsemcaso00001abcdefghijklm', '50003037620998090051', (current_date - 1)::text, 'Designada audiência de conciliação.')),
  null, pg_temp.today()));
reset role;

select ok(
  pg_temp.got('wrong_claim', 'code') = 'not_working'
  and pg_temp.got('no_day', 'code') = 'invalid_through'
  and pg_temp.got('no_day_row', 'held') = 'true' and pg_temp.got('no_day_row', 'at') is null
  and pg_temp.got('captured', 'code') = 'done' and pg_temp.got('captured', 'new') = '2' and pg_temp.got('captured', 'skipped') = '6'
  and pg_temp.got('recorded_twice', 'code') = 'not_working'
  and pg_temp.got('captured_b', 'new') = '1' and pg_temp.got('captured_b', 'skipped') = '0'
  and (select count(*) = 2 from public.publications where org_id = 'bd100000-0000-4000-8000-00000000000a')
  and (select count(*) = 1 from public.publications where org_id = 'bd100000-0000-4000-8000-00000000000b')
  and (select captured_through = pg_temp.today() and captured_at is not null and claimed_at is null
              and attempts = 0 and last_new = 2 and error is null
              -- What could not be kept is counted, with its moment, for the firm to look at.
              and last_skipped = 6 and skipped_at is not null and round_skipped = 0
       from public.djen_captures where registration_id = 'cd100000-0000-4000-8000-000000000001')
  and (select last_skipped = 0 and skipped_at is null and skipped_items = '[]'::jsonb
       from public.djen_captures where registration_id = 'cd100000-0000-4000-8000-000000000004'),
  'a capture keeps each communication once per firm, leaves out and counts what it cannot keep, and says so only under its own claim, at a day it names'
);

select ok(
  (select skipped_items = jsonb_build_array(
            jsonb_build_object('court', 'TJGO', 'day', current_date - 1),
            jsonb_build_object('hash', 'hashsemnumero0001abcdefghijkl', 'court', 'TJGO', 'day', current_date - 1),
            jsonb_build_object('hash', 'hashdofuturo00001abcdefghijkl', 'court', 'TJGO', 'day', current_date + 30),
            jsonb_build_object('hash', 'hashsemdia0000001abcdefghijkl', 'court', 'TJGO'),
            jsonb_build_object('hash', 'hashdiatrocado001abcdefghijkl', 'court', 'TJGO'),
            jsonb_build_object('hash', 'hashdiaquenaoha01abcdefghijkl', 'court', 'TJGO'))
          and round_skipped_items = '[]'::jsonb
   from public.djen_captures where registration_id = 'cd100000-0000-4000-8000-000000000001')
  and not exists (select 1 from public.publications where hash in ('hashdiatrocado001abcdefghijkl', 'hashdiaquenaoha01abcdefghijkl')),
  'what a reading left out is kept by what tells each one apart (its hash, its court, its day), so a person can open it at the DJEN'
);

select ok(
  (select proceeding_id = pg_temp.got('lawsuit', 'proceeding_id')::uuid and case_id = pg_temp.got('case', 'case_id')::uuid
          and cnj = '50002023920998090051' and lawyer_ids = array['ad100000-0000-4000-8000-000000000001']::uuid[]
          and unit = '2º Juizado Especial Cível de Goiânia' and document_type = 'Despacho' and active and cancel_reason is null
          and cancelled_at is null and category is null and not truncated and head = body and tail is null
   from public.publications where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdolitigio0001abcdefghijkl'))
  and (select proceeding_id is null and case_id is null
       from public.publications where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashsemcaso00001abcdefghijklm'))
  and (select count(*) = 1 from public.case_events
       where case_id = pg_temp.got('case', 'case_id')::uuid and kind = 'publication_captured' and actor_type = 'system'),
  'a communication of a lawsuit of the firm is linked to it and told in the timeline of its case; another is kept with no case'
);

-- ---------- The next rounds ----------

-- Read again a few hours later: a communication the court cancelled says so, a long text is cut and says so,
-- and nothing is kept twice.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('second', pg_temp.claim('cd100000-0000-4000-8000-000000000001'));
insert into res values ('captured_again', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000001'), 2, 'done',
  jsonb_build_array(
    pg_temp.item('hashdolitigio0001abcdefghijkl', '5000202-39.2099.8.09.0051', (current_date - 2)::text, 'Comunicação cancelada: publicada em duplicidade.', false),
    pg_temp.item('hashsemcaso00001abcdefghijklm', '50003037620998090051', (current_date - 1)::text, 'Designada audiência de conciliação.'),
    pg_temp.item('hashdotextao00001abcdefghijkl', '5000202-39.2099.8.09.0051', (current_date - 1)::text, repeat('Sentença. ', 12000))
      || jsonb_build_object('head', '  Vistos. A parte autora pede indenização.  ', 'tail', 'Julgo procedente o pedido. Intimem-se.')),
  null, pg_temp.today()));
reset role;

select ok(
  pg_temp.got('second', 'claim') = '2'
  and pg_temp.got('second', 'since') = (pg_temp.today() - 3)::text
  and pg_temp.got('captured_again', 'new') = '1'
  -- The court put its reason in the place of the text: the reason is kept, and so is what the firm first read.
  and (select not active and cancelled_at is not null and cancel_reason like 'Comunicação cancelada%'
              and body = 'Fica a parte autora intimada a se manifestar em cinco dias.'
       from public.publications where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdolitigio0001abcdefghijkl'))
  and (select active and body = 'Designada audiência de conciliação.' from public.publications
       where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashsemcaso00001abcdefghijklm'))
  -- A text longer than what is kept is cut, and says it was; its start and its end are the ones the worker read.
  and (select truncated and char_length(body) = 100000 and head = 'Vistos. A parte autora pede indenização.'
              and tail = 'Julgo procedente o pedido. Intimem-se.'
       from public.publications where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdotextao00001abcdefghijkl'))
  and (select count(*) = 3 from public.publications where org_id = 'bd100000-0000-4000-8000-00000000000a')
  and (select count(*) = 2 from public.case_events where kind = 'publication_captured')
  and (select count(*) = 1 from public.case_events where kind = 'publication_cancelled' and data ->> 'triaged' = 'false')
  -- A clean reading does not unsay what an earlier one left out.
  and (select last_new = 1 and last_skipped = 6 and skipped_at is not null and jsonb_array_length(skipped_items) = 6
       from public.djen_captures where registration_id = 'cd100000-0000-4000-8000-000000000001'),
  'read again, a round goes a few days back: what the court cancelled says so and why, a long text says it was cut, and nothing is kept or told twice'
);

-- A passing failure waits before the next attempt; a round that keeps failing waits for the next round.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('retry_1', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000002'), 1, 'retry', '[]'::jsonb, 'djen_rate_limited'));
insert into res values ('held_back', jsonb_build_object('count',
  (select count(*) from public.claim_djen_captures(10, pg_temp.capture_of('cd100000-0000-4000-8000-000000000002')))));
reset role;
insert into res select 'waits', jsonb_build_object('minutes', round(extract(epoch from (retry_after - now())) / 60), 'attempts', attempts)
from public.djen_captures where registration_id = 'cd100000-0000-4000-8000-000000000002';
update public.djen_captures set retry_after = now() - interval '1 minute' where registration_id = 'cd100000-0000-4000-8000-000000000002';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('retry_claim', (select to_jsonb(c) from public.claim_djen_captures(10, pg_temp.capture_of('cd100000-0000-4000-8000-000000000002')) c));
select public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000002'), 2, 'retry', '[]'::jsonb, 'djen_rate_limited');
reset role;
update public.djen_captures set retry_after = now() - interval '1 minute' where registration_id = 'cd100000-0000-4000-8000-000000000002';
select pg_temp.as_backend();
set local role service_role;
select count(*) from public.claim_djen_captures(10, pg_temp.capture_of('cd100000-0000-4000-8000-000000000002'));
insert into res values ('retry_3', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000002'), 3, 'retry', '[]'::jsonb, 'djen_rate_limited'));
reset role;

select ok(
  pg_temp.got('retry_1', 'code') = 'retry' and pg_temp.got('held_back', 'count') = '0'
  and pg_temp.got('waits', 'minutes') = '20' and pg_temp.got('waits', 'attempts') = '1'
  and pg_temp.got('retry_claim', 'claim') = '2'
  and pg_temp.got('retry_3', 'code') = 'failed'
  and (select error = 'djen_rate_limited' and attempts = 0 and claimed_at is null and captured_at is null
              and retry_after > now() + interval '5 hours'
       from public.djen_captures where registration_id = 'cd100000-0000-4000-8000-000000000002'),
  'a passing failure waits before the next attempt, and a round that keeps failing waits for the next round'
);

-- A reading nobody finished (its worker died) goes back to the line under a new number; the worker that
-- comes back late says nothing; and after its attempts it is given up until the next round.
update public.djen_captures set claimed_at = now() - interval '1 hour' where registration_id = 'cd100000-0000-4000-8000-000000000003';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('stale_2', (select to_jsonb(c) from public.claim_djen_captures(1, pg_temp.capture_of('cd100000-0000-4000-8000-000000000003')) c));
insert into res values ('stale_late', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000003'), 1, 'done',
  jsonb_build_array(pg_temp.item('hashdoatrasado001abcdefghijkl', '50003037620998090051', (current_date - 1)::text, 'De um trabalhador que ficou para trás.')),
  null, pg_temp.today()));
reset role;
update public.djen_captures set claimed_at = now() - interval '1 hour' where registration_id = 'cd100000-0000-4000-8000-000000000003';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('stale_3', (select to_jsonb(c) from public.claim_djen_captures(1, pg_temp.capture_of('cd100000-0000-4000-8000-000000000003')) c));
reset role;
update public.djen_captures set claimed_at = now() - interval '1 hour' where registration_id = 'cd100000-0000-4000-8000-000000000003';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('stale_over', jsonb_build_object('count',
  (select count(*) from public.claim_djen_captures(1, pg_temp.capture_of('cd100000-0000-4000-8000-000000000003')))));
reset role;

select ok(
  pg_temp.got('stale_2', 'claim') = '2' and pg_temp.got('stale_late', 'code') = 'not_working'
  and pg_temp.got('stale_3', 'claim') = '3' and pg_temp.got('stale_over', 'count') = '0'
  and not exists (select 1 from public.publications where hash = 'hashdoatrasado001abcdefghijkl')
  and (select error = 'abandoned' and attempts = 0 and claimed_at is null and captured_at is null
              and retry_after > now() + interval '5 hours'
       from public.djen_captures where registration_id = 'cd100000-0000-4000-8000-000000000003'),
  'a reading nobody finished goes back to the line under a new number, a late worker writes nothing, and after its attempts it waits for the next round'
);

-- ---------- A lawsuit and its number ----------

-- A case number that becomes a lawsuit of the firm links what was captured before, at once and in its own firm
-- only; a number corrected lets go what was linked under the wrong one.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('filed_later', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('lawsuit_planned', 'proceeding_id')::uuid,
  '{"kind": "comum", "court": "TJGO", "system": "projudi", "status": "filed", "cnj": "5000303-76.2099.8.09.0051", "filed_at": "2026-10-05"}'::jsonb));
reset role;
insert into res select 'linked_later', jsonb_build_object(
  'a', (select proceeding_id = pg_temp.got('lawsuit_planned', 'proceeding_id')::uuid and case_id = pg_temp.got('case', 'case_id')::uuid
        from public.publications where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashsemcaso00001abcdefghijklm')),
  'b', (select proceeding_id is null and case_id is null
        from public.publications where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000b', 'hashsemcaso00001abcdefghijklm')));
update public.proceedings set cnj = '50004041620998090051' where id = pg_temp.got('lawsuit_planned', 'proceeding_id')::uuid;
insert into res select 'let_go', jsonb_build_object(
  'a', (select proceeding_id is null and case_id is null
        from public.publications where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashsemcaso00001abcdefghijklm')));
update public.proceedings set cnj = '50003037620998090051' where id = pg_temp.got('lawsuit_planned', 'proceeding_id')::uuid;

select ok(
  pg_temp.got('filed_later', 'code') = 'saved'
  and pg_temp.got('linked_later', 'a') = 'true' and pg_temp.got('linked_later', 'b') = 'true'
  and pg_temp.got('let_go', 'a') = 'true'
  and (select proceeding_id = pg_temp.got('lawsuit_planned', 'proceeding_id')::uuid
       from public.publications where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashsemcaso00001abcdefghijklm')),
  'what was captured before its lawsuit had the number is linked once it does, in its own firm only, and let go when the number is corrected'
);

-- ---------- What a member reads ----------

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('bia_reads', jsonb_build_object(
  'publications', (select count(*) from public.publications),
  'captures', (select count(*) from public.djen_captures),
  'today', public.firm_today('bd100000-0000-4000-8000-00000000000a')));
select throws_ok($$select ai_category from public.publications$$, '42501', null,
  'what the AI said of a publication is not the firm''s to read while the triage is in shadow mode');
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('davi_reads', jsonb_build_object(
  'publications', (select count(*) from public.publications),
  'hashes', (select jsonb_agg(hash) from public.publications),
  'captures', (select count(*) from public.djen_captures),
  'today', public.firm_today('bd100000-0000-4000-8000-00000000000b')));
reset role;

select ok(
  pg_temp.got('bia_reads', 'publications') = '3' and pg_temp.got('bia_reads', 'captures') = '4'
  -- One of the three was cancelled by the court before anybody triaged it: nobody has to say what it is.
  and (select payload -> 'today' ->> 'publications_new' = '2' and payload -> 'today' ->> 'publications_cancelled' = '0'
              and payload -> 'today' ->> 'djen_late' = '0' and payload -> 'today' ->> 'djen_stopped' = '0'
              -- The reading of one registration left communications out a moment ago.
              and payload -> 'today' ->> 'djen_incomplete' = '1'
       from res where name = 'bia_reads')
  and pg_temp.got('davi_reads', 'publications') = '1' and pg_temp.got('davi_reads', 'captures') = '1'
  and (select payload -> 'hashes' = '["hashsemcaso00001abcdefghijklm"]'::jsonb
              and payload -> 'today' ->> 'publications_new' = '1' and payload -> 'today' ->> 'djen_incomplete' = '0'
       from res where name = 'davi_reads'),
  'each firm reads its own publications and readings, and the home counts the ones nobody said what they are'
);

-- A reading that is late is told on the home: read longer ago than the setting says, or never read since it was due.
update public.djen_captures set captured_at = now() - interval '30 hours' where registration_id = 'cd100000-0000-4000-8000-000000000001';
update public.djen_captures set created_at = now() - interval '30 hours' where registration_id = 'cd100000-0000-4000-8000-000000000002';
-- And a registration no sweep has seen at all, held for that long: the reading itself is not running.
update public.memberships set created_at = now() - interval '40 hours' where user_id = 'ad100000-0000-4000-8000-000000000003';
insert into public.oab_registrations (id, user_id, uf, number, kind, created_at) values
  ('cd100000-0000-4000-8000-000000000006', 'ad100000-0000-4000-8000-000000000003', 'MG', '77777', 'principal', now() - interval '30 hours'),
  -- One added a moment ago is only waiting for the next sweep.
  ('cd100000-0000-4000-8000-000000000007', 'ad100000-0000-4000-8000-000000000003', 'RJ', '88888', 'suplementar', now());
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('late', public.firm_today('bd100000-0000-4000-8000-00000000000a'));
reset role;
delete from public.oab_registrations where id in ('cd100000-0000-4000-8000-000000000006', 'cd100000-0000-4000-8000-000000000007');
update public.djen_captures set captured_at = now() where registration_id = 'cd100000-0000-4000-8000-000000000001';
update public.djen_captures set created_at = now() where registration_id = 'cd100000-0000-4000-8000-000000000002';

select is(pg_temp.got('late', 'djen_late'), '3', 'the home says how many registrations were not read for a day, or not seen by any sweep for that long: nothing new means something only when the reading is up to date');

-- ---------- The triage, by a person ----------

insert into res select 'ids', jsonb_build_object(
  'a', pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashsemcaso00001abcdefghijklm'),
  'a_cancelled', pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdolitigio0001abcdefghijkl'),
  'a_long', pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdotextao00001abcdefghijkl'),
  'b', pg_temp.pub('bd100000-0000-4000-8000-00000000000b', 'hashsemcaso00001abcdefghijklm'));
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('bia_triages', public.triage_publication(pg_temp.got('ids', 'a')::uuid, 'audiencia'));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('davi_triages_other', public.triage_publication(pg_temp.got('ids', 'a')::uuid, 'audiencia'));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('caio_bad', public.triage_publication(pg_temp.got('ids', 'a')::uuid, 'urgente'));
insert into res values ('caio_triages', public.triage_publication(pg_temp.got('ids', 'a')::uuid, 'prazo', '  Manifestar até sexta.  '));
insert into res values ('caio_changes', public.triage_publication(pg_temp.got('ids', 'a')::uuid, 'audiencia'));
-- The same word again, with a note: the note is kept, and the timeline is not told the same thing twice.
insert into res values ('caio_notes', public.triage_publication(pg_temp.got('ids', 'a')::uuid, 'audiencia', 'Conciliação no dia 20.'));
insert into res values ('caio_cancelled', public.triage_publication(pg_temp.got('ids', 'a_cancelled')::uuid, 'ciencia'));
reset role;

select ok(
  pg_temp.got('bia_triages', 'code') = 'not_allowed'
  and pg_temp.got('davi_triages_other', 'code') = 'not_found'
  and pg_temp.got('caio_bad', 'code') = 'invalid_category'
  and pg_temp.got('caio_triages', 'code') = 'saved' and pg_temp.got('caio_changes', 'code') = 'saved'
  and pg_temp.got('caio_notes', 'code') = 'saved'
  -- What the court took back has nothing in it to do.
  and pg_temp.got('caio_cancelled', 'code') = 'cancelled'
  and (select category = 'audiencia' and note = 'Conciliação no dia 20.' and triaged_by = 'ad100000-0000-4000-8000-000000000003'
              and triaged_at is not null
       from public.publications where id = pg_temp.got('ids', 'a')::uuid)
  and (select category is null from public.publications where id = pg_temp.got('ids', 'b')::uuid)
  and (select category is null from public.publications where id = pg_temp.got('ids', 'a_cancelled')::uuid)
  and (select count(*) = 3 from public.audit_events where action = 'publication.triaged' and entity_id = pg_temp.got('ids', 'a'))
  and (select count(*) = 2 from public.case_events where kind = 'publication_triaged' and actor_type = 'person'),
  'who signs or runs the firm''s deadlines says what a publication of their own firm is, and may say it again; each word is kept'
);

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('ad100000-0000-4000-8000-000000000009', 'ad100000-0000-4000-8000-000000000003', 'bd100000-0000-4000-8000-00000000000a',
        'Conferindo as publicações', 'fd100000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000003', 'fd100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  format('select public.triage_publication(%L, %L)', pg_temp.got('ids', 'a'), 'ciencia'),
  '42501', 'not_allowed_in_support_session',
  'a support visit says nothing of a publication'
);
reset role;

-- ---------- The triage, by the AI, in shadow mode ----------

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select count(*) from public.claim_publication_triage(10)$$, '42501', null,
  'a person never claims the shadow triage');
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res values ('shadow_claim', (select jsonb_build_object('ids', jsonb_agg(c.publication_id), 'claims', jsonb_agg(distinct c.claim))
  from public.claim_publication_triage(10) c));
insert into res values ('shadow_stale', jsonb_build_object('count',
  (select count(*) from public.publication_to_triage(pg_temp.got('ids', 'a')::uuid, 9))));
insert into res select 'shadow_read', to_jsonb(t) from public.publication_to_triage(pg_temp.got('ids', 'a')::uuid, 1) t;
insert into res select 'shadow_read_long', jsonb_build_object('truncated', t.truncated, 'length', char_length(t.body))
from public.publication_to_triage(pg_temp.got('ids', 'a_long')::uuid, 1) t;
-- The person said it is a hearing; the AI says a deadline. The two words sit side by side.
insert into res values ('run_a', pg_temp.ran('bd100000-0000-4000-8000-00000000000a', pg_temp.got('ids', 'a')::uuid,
  '{"categoria": "prazo", "urgente": true, "resumo": "Manifestar em cinco dias."}'::jsonb));
insert into res values ('shadow_other_claim', public.record_publication_triage(pg_temp.got('ids', 'a')::uuid, 9, 'done', pg_temp.got('run_a', 'run_id')::uuid));
insert into res values ('shadow_done', public.record_publication_triage(pg_temp.got('ids', 'a')::uuid, 1, 'done', pg_temp.got('run_a', 'run_id')::uuid));
-- An answer outside the categories is no answer, and is not asked again.
insert into res values ('run_b', pg_temp.ran('bd100000-0000-4000-8000-00000000000b', pg_temp.got('ids', 'b')::uuid,
  '{"categoria": "urgentissimo", "urgente": true, "resumo": "?"}'::jsonb));
insert into res values ('shadow_invalid', public.record_publication_triage(pg_temp.got('ids', 'b')::uuid, 1, 'done', pg_temp.got('run_b', 'run_id')::uuid));
-- The provider was out: nothing was learned of the publication, so the try does not count, and it waits.
insert into res values ('shadow_released', public.record_publication_triage(pg_temp.got('ids', 'a_long')::uuid, 1, 'released', null, 'provider_rejected'));
insert into res values ('shadow_again', jsonb_build_object('count', (select count(*) from public.claim_publication_triage(10))));
reset role;

select ok(
  -- The one the court cancelled is not classified.
  (select payload -> 'ids' @> jsonb_build_array(pg_temp.got('ids', 'a'), pg_temp.got('ids', 'a_long'), pg_temp.got('ids', 'b'))
          and jsonb_array_length(payload -> 'ids') = 3 and payload -> 'claims' = '[1]'::jsonb
   from res where name = 'shadow_claim')
  and pg_temp.got('shadow_stale', 'count') = '0'
  and pg_temp.got('shadow_read', 'court') = 'TJGO' and pg_temp.got('shadow_read', 'body') = 'Designada audiência de conciliação.'
  and pg_temp.got('shadow_read', 'document_type') = 'Despacho' and pg_temp.got('shadow_read', 'truncated') = 'false'
  and pg_temp.got('shadow_read_long', 'truncated') = 'true' and pg_temp.got('shadow_read_long', 'length') = '100000'
  and pg_temp.got('shadow_other_claim', 'code') = 'not_working'
  and pg_temp.got('shadow_done', 'code') = 'done'
  and pg_temp.got('shadow_invalid', 'code') = 'failed'
  and pg_temp.got('shadow_released', 'code') = 'released'
  and pg_temp.got('shadow_again', 'count') = '0'
  -- The AI's word sits beside the person's, which is another, and changes nothing of it.
  and (select ai_category = 'prazo' and ai_urgent and ai_run_id = pg_temp.got('run_a', 'run_id')::uuid and ai_claimed_at is null
              and category = 'audiencia' and note = 'Conciliação no dia 20.'
       from public.publications where id = pg_temp.got('ids', 'a')::uuid)
  and (select ai_category is null and ai_error = 'invalid_answer' and category is null
       from public.publications where id = pg_temp.got('ids', 'b')::uuid)
  and (select ai_category is null and ai_error = 'provider_rejected' and ai_attempts = 0 and ai_claimed_at is null
              and ai_retry_after > now() + interval '15 minutes'
       from public.publications where id = pg_temp.got('ids', 'a_long')::uuid),
  'the AI classifies each publication once, under a claim, from the run''s own answer; its word sits beside the person''s and changes nothing of it'
);

-- An answer of the shadow triage waits in nobody's queue, whatever the autonomy of its task is set to; and the
-- run that holds it is not the firm's to read, by the owner or by anybody.
update public.ai_tasks set autonomy = 'approval' where slug = 'publicacao.triagem';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('run_c', pg_temp.ran('bd100000-0000-4000-8000-00000000000a', pg_temp.got('ids', 'a_cancelled')::uuid,
  '{"categoria": "ciencia", "urgente": false, "resumo": "Cancelada."}'::jsonb));
reset role;
update public.ai_tasks set autonomy = 'autonomous' where slug = 'publicacao.triagem';
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('owner_reads_runs', jsonb_build_object(
  'shadow', (select count(*) from public.ai_runs where task = 'publicacao.triagem'),
  'by_subject', (select count(*) from public.ai_runs where subject_type = 'publication'),
  'approvals', (select count(*) from public.approvals where task = 'publicacao.triagem')));
reset role;

select ok(
  pg_temp.got('run_a', 'approval_id') is null and pg_temp.got('run_c', 'approval_id') is null
  and not exists (select 1 from public.approvals where task = 'publicacao.triagem')
  and (select count(*) = 3 from public.ai_runs where task = 'publicacao.triagem' and status = 'succeeded')
  and pg_temp.got('owner_reads_runs', 'shadow') = '0' and pg_temp.got('owner_reads_runs', 'by_subject') = '0'
  and pg_temp.got('owner_reads_runs', 'approvals') = '0',
  'an answer of the shadow triage waits in no queue, whatever its task is set to, and its run is not the firm''s to read'
);

-- ---------- What a court takes back after somebody triaged it ----------

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('long_triaged', public.triage_publication(pg_temp.got('ids', 'a_long')::uuid, 'prazo'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('third', pg_temp.claim('cd100000-0000-4000-8000-000000000001'));
insert into res values ('cancelled_later', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000001'), 3, 'done',
  jsonb_build_array(pg_temp.item('hashdotextao00001abcdefghijkl', '5000202-39.2099.8.09.0051', (current_date - 1)::text,
    repeat('Sentença. ', 12000), false, 'Publicada no processo errado.')),
  null, pg_temp.today()));
reset role;
insert into res select 'pending_before', jsonb_build_object('pending', cancel_pending)
from public.publications where id = pg_temp.got('ids', 'a_long')::uuid;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('cancel_today', public.firm_today('bd100000-0000-4000-8000-00000000000a'));
insert into res values ('bia_sees', public.acknowledge_publication_cancel(pg_temp.got('ids', 'a_long')::uuid));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('davi_sees', public.acknowledge_publication_cancel(pg_temp.got('ids', 'a_long')::uuid));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('caio_sees_active', public.acknowledge_publication_cancel(pg_temp.got('ids', 'a')::uuid));
insert into res values ('caio_sees', public.acknowledge_publication_cancel(pg_temp.got('ids', 'a_long')::uuid));
insert into res values ('caio_sees_again', public.acknowledge_publication_cancel(pg_temp.got('ids', 'a_long')::uuid));
insert into res values ('cancel_seen_today', public.firm_today('bd100000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  pg_temp.got('long_triaged', 'code') = 'saved' and pg_temp.got('cancelled_later', 'new') = '0'
  -- The person's word stays, with the court's reason beside it.
  and (select not active and category = 'prazo' and cancel_reason = 'Publicada no processo errado.' and truncated
       from public.publications where id = pg_temp.got('ids', 'a_long')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'publication_cancelled' and data ->> 'triaged' = 'true')
  and pg_temp.got('cancel_today', 'publications_cancelled') = '1' and pg_temp.got('pending_before', 'pending') = 'true'
  and pg_temp.got('bia_sees', 'code') = 'not_allowed' and pg_temp.got('davi_sees', 'code') = 'not_found'
  and pg_temp.got('caio_sees_active', 'code') = 'not_cancelled'
  and pg_temp.got('caio_sees', 'code') = 'saved' and pg_temp.got('caio_sees_again', 'code') = 'saved'
  and pg_temp.got('cancel_seen_today', 'publications_cancelled') = '0'
  and (select cancel_seen_by = 'ad100000-0000-4000-8000-000000000003' and cancel_seen_at is not null and not cancel_pending
       from public.publications where id = pg_temp.got('ids', 'a_long')::uuid)
  -- One the court cancelled before anybody said what it was asks nothing of anybody.
  and (select not cancel_pending and not active from public.publications where id = pg_temp.got('ids', 'a_cancelled')::uuid)
  and (select count(*) = 1 from public.audit_events where action = 'publication.cancel_seen'),
  'a court that cancels what somebody triaged is told on the home and in the case until a person who runs the deadlines says they saw it'
);

-- ---------- How the shadow compares, for the operator ----------

-- Another publication where the person and the AI say the same.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('fourth', pg_temp.claim('cd100000-0000-4000-8000-000000000001'));
select public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000001'), 4, 'done',
  jsonb_build_array(pg_temp.item('hashdadecisao0001abcdefghijkl', '5000202-39.2099.8.09.0051', current_date::text, 'Julgo procedente o pedido.')),
  null, pg_temp.today());
select count(*) from public.claim_publication_triage(10);
reset role;
insert into res select 'ids_2', jsonb_build_object('c', pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdadecisao0001abcdefghijkl'));
select pg_temp.as_backend();
set local role service_role;
insert into res values ('run_d', pg_temp.ran('bd100000-0000-4000-8000-00000000000a', pg_temp.got('ids_2', 'c')::uuid,
  '{"categoria": "decisao", "urgente": false, "resumo": "Sentença."}'::jsonb));
select public.record_publication_triage(pg_temp.got('ids_2', 'c')::uuid, 1, 'done', pg_temp.got('run_d', 'run_id')::uuid);
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.triage_publication(pg_temp.got('ids_2', 'c')::uuid, 'decisao');
select throws_ok($$select public.admin_publication_triage_measure(90)$$, '42501', null,
  'a firm does not read how the shadow triage compares');
select throws_ok($$select public.admin_reopen_publication_triage()$$, '42501', null,
  'nor puts back what the AI gave up on');
select throws_ok($$select public.admin_djen_health()$$, '42501', null,
  'nor reads how every firm''s reading is doing');
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('measure', public.admin_publication_triage_measure(90));
insert into res values ('health', public.admin_djen_health());
insert into res values ('reopened', public.admin_reopen_publication_triage());
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('reopened_claim', (select jsonb_build_object('ids', jsonb_agg(c.publication_id)) from public.claim_publication_triage(10) c));
reset role;

select ok(
  -- Five were captured in all (four of one firm, one of the other); every number is a part of the one before it.
  pg_temp.got('measure', 'captured') = '5' and pg_temp.got('measure', 'classified_by_ai') = '2'
  and pg_temp.got('measure', 'gave_up') = '1'
  and pg_temp.got('measure', 'compared') = '2' and pg_temp.got('measure', 'agreed') = '1'
  and (select payload -> 'by_category' = '[{"agreed": 0, "category": "audiencia", "compared": 1}, {"agreed": 1, "category": "decisao", "compared": 1}]'::jsonb
       from res where name = 'measure')
  -- What the AI gave up on goes back to the line when the operator says so.
  and pg_temp.got('reopened', 'reopened') = '1'
  and (select payload -> 'ids' = jsonb_build_array(pg_temp.got('ids', 'b')) from res where name = 'reopened_claim'),
  'the operator reads how often the AI said what the person said, in all and by the person''s category, and puts back what it gave up on'
);

select ok(
  pg_temp.got('health', 'registrations') = '5' and pg_temp.got('health', 'firms') = '2'
  -- Bia's was claimed and never read; Ana's in São Paulo and Eva's had their rounds fail.
  and pg_temp.got('health', 'never_read') = '3' and pg_temp.got('health', 'late') = '0'
  -- Each registration is in one of three: read in time, late, or waiting for a first reading not late yet.
  and pg_temp.got('health', 'in_time') = '2' and pg_temp.got('health', 'waiting_first') = '3'
  and pg_temp.got('health', 'left_out') = '6' and pg_temp.got('health', 'incomplete') = '1'
  and pg_temp.got('health', 'unseen') = '0' and pg_temp.got('health', 'unseen_since') is null
  and pg_temp.got('health', 'stopped') = '0'
  and (select payload -> 'failing' = '[{"code": "abandoned", "registrations": 1}, {"code": "djen_rate_limited", "registrations": 1}]'::jsonb
       from res where name = 'health'),
  'the operator reads how the reading is doing across every firm: how many registrations, never read, late, failing and why, and what was left out'
);

-- A claim of the shadow triage nobody finished goes back to the line, and is given up after its attempts.
select pg_temp.as_backend();
set local role service_role;
select public.record_publication_triage(pg_temp.got('ids', 'b')::uuid, 2, 'failed', null, 'output_incomplete');
insert into res values ('fifth', pg_temp.claim('cd100000-0000-4000-8000-000000000001'));
select public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000001'), 5, 'done',
  jsonb_build_array(pg_temp.item('hashdoalvara00001abcdefghijkl', '5000202-39.2099.8.09.0051', current_date::text, 'Expeça-se alvará.')),
  null, pg_temp.today());
insert into res values ('slow_1', (select to_jsonb(c) from public.claim_publication_triage(10) c));
reset role;
update public.publications set ai_claimed_at = now() - interval '2 hours' where hash = 'hashdoalvara00001abcdefghijkl';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('slow_2', (select to_jsonb(c) from public.claim_publication_triage(10) c));
insert into res values ('slow_old_word', public.record_publication_triage(pg_temp.got('slow_1', 'publication_id')::uuid, 1, 'retry', null, 'output_incomplete'));
insert into res values ('slow_retry', public.record_publication_triage(pg_temp.got('slow_1', 'publication_id')::uuid, 2, 'retry', null, 'output_incomplete'));
insert into res values ('slow_held', jsonb_build_object('count', (select count(*) from public.claim_publication_triage(10))));
reset role;
update public.publications set ai_retry_after = now() - interval '1 minute' where hash = 'hashdoalvara00001abcdefghijkl';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('slow_3', (select to_jsonb(c) from public.claim_publication_triage(10) c));
insert into res values ('slow_last', public.record_publication_triage(pg_temp.got('slow_1', 'publication_id')::uuid, 3, 'retry', null, 'output_incomplete'));
insert into res values ('slow_over', jsonb_build_object('count', (select count(*) from public.claim_publication_triage(10))));
reset role;

select ok(
  pg_temp.got('slow_1', 'claim') = '1' and pg_temp.got('slow_2', 'claim') = '2'
  and pg_temp.got('slow_old_word', 'code') = 'not_working'
  and pg_temp.got('slow_retry', 'code') = 'retry' and pg_temp.got('slow_held', 'count') = '0'
  and pg_temp.got('slow_3', 'claim') = '3' and pg_temp.got('slow_last', 'code') = 'failed'
  and pg_temp.got('slow_over', 'count') = '0'
  and (select ai_category is null and ai_error = 'output_incomplete' and ai_claimed_at is null
       from public.publications where hash = 'hashdoalvara00001abcdefghijkl'),
  'a shadow triage nobody finished is taken under a new number, waits after a failure of its own, and is given up after its attempts'
);

-- ---------- Many days, read a few at a time ----------

-- Ana's registration in São Paulo was never read whole: its round failed. It is read by days now.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('days_1', pg_temp.claim('cd100000-0000-4000-8000-000000000002'));
insert into res values ('days_part', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000002'),
  (pg_temp.got('days_1', 'claim'))::integer, 'partial',
  jsonb_build_array(
    pg_temp.item('hashdosdias00001abcdefghijkl', '10009874520998260100', (current_date - 27)::text, 'Cite-se.'),
    pg_temp.item('ruim', '10009874520998260100', (current_date - 27)::text, 'Sem hash que sirva.')),
  null, pg_temp.today() - 25));
-- The reading only goes forward, and a day that has not come was not read.
insert into res values ('days_back', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000002'),
  (pg_temp.got('days_1', 'claim'))::integer, 'partial', '[]'::jsonb, null, pg_temp.today() - 29));
insert into res values ('days_ahead', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000002'),
  (pg_temp.got('days_1', 'claim'))::integer, 'partial', '[]'::jsonb, null, pg_temp.today() + 5));
reset role;
insert into res select 'days_row', jsonb_build_object('resume', resume_from, 'round', round_new, 'held', claimed_at is not null,
  'through', captured_through, 'at', captured_at, 'error', error, 'attempts', attempts, 'round_skipped', round_skipped)
from public.djen_captures where registration_id = 'cd100000-0000-4000-8000-000000000002';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('days_pause', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000002'),
  (pg_temp.got('days_1', 'claim'))::integer, 'paused'));
-- Due again at once, with nobody touching its wait: from the day after the last one read.
insert into res values ('days_2', (select to_jsonb(c) from public.claim_djen_captures(1, pg_temp.capture_of('cd100000-0000-4000-8000-000000000002')) c));
insert into res values ('days_2_read', (select to_jsonb(r) from public.djen_capture_to_read(
  pg_temp.capture_of('cd100000-0000-4000-8000-000000000002'), (pg_temp.got('days_2', 'claim'))::integer) r));
insert into res values ('days_done', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000002'),
  (pg_temp.got('days_2', 'claim'))::integer, 'done',
  jsonb_build_array(pg_temp.item('hashdosdias00002abcdefghijkl', '10009874520998260100', (current_date - 2)::text, 'Manifeste-se.')),
  null, pg_temp.today()));
reset role;

select ok(
  pg_temp.got('days_1', 'since') = (pg_temp.today() - 30)::text
  and pg_temp.got('days_part', 'code') = 'partial' and pg_temp.got('days_part', 'new') = '1' and pg_temp.got('days_part', 'skipped') = '1'
  and pg_temp.got('days_back', 'code') = 'partial' and pg_temp.got('days_ahead', 'code') = 'partial'
  and pg_temp.got('days_row', 'resume') = (pg_temp.today() - 24)::text
  and pg_temp.got('days_row', 'round') = '1' and pg_temp.got('days_row', 'held') = 'true'
  and pg_temp.got('days_row', 'round_skipped') = '1'
  -- Days were read: what stopped the reading before is over, and this was not a try that came to nothing.
  and pg_temp.got('days_row', 'error') is null and pg_temp.got('days_row', 'attempts') = '1'
  -- Nothing says the registration was read while days remain.
  and pg_temp.got('days_row', 'through') is null and pg_temp.got('days_row', 'at') is null
  and pg_temp.got('days_pause', 'code') = 'paused'
  and (pg_temp.got('days_2', 'claim'))::integer = (pg_temp.got('days_1', 'claim'))::integer + 1
  and pg_temp.got('days_2_read', 'since') = (pg_temp.today() - 24)::text
  and pg_temp.got('days_done', 'code') = 'done' and pg_temp.got('days_done', 'new') = '2' and pg_temp.got('days_done', 'skipped') = '1'
  and (select captured_through = pg_temp.today() and captured_at is not null and resume_from is null
              and last_new = 2 and round_new = 0 and last_skipped = 1 and round_skipped = 0 and claimed_at is null
              and attempts = 0 and error is null
       from public.djen_captures where registration_id = 'cd100000-0000-4000-8000-000000000002'),
  'many days are read a few at a time: what was read is kept, the reading goes on from where it stopped, and only the end says it was read'
);

-- Once in a while a round reads many days again: a court may cancel a communication long after it published it.
update public.djen_captures set deep_read_at = now() - interval '8 days' where registration_id = 'cd100000-0000-4000-8000-000000000001';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('deep', pg_temp.claim('cd100000-0000-4000-8000-000000000001'));
select public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000001'), (pg_temp.got('deep', 'claim'))::integer, 'done', '[]'::jsonb, null, pg_temp.today());
insert into res values ('shallow', pg_temp.claim('cd100000-0000-4000-8000-000000000001'));
select public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000001'), (pg_temp.got('shallow', 'claim'))::integer, 'done', '[]'::jsonb, null, pg_temp.today());
reset role;

select ok(
  pg_temp.got('deep', 'since') = (pg_temp.today() - 30)::text
  and pg_temp.got('shallow', 'since') = (pg_temp.today() - 3)::text
  and (select resume_from is null and deep_read_at > now() - interval '1 minute'
       from public.djen_captures where registration_id = 'cd100000-0000-4000-8000-000000000001'),
  'once in a while a round reads thirty days again, and the next ones a few'
);

-- ---------- A registration that leaves, and comes back ----------

-- Eva's reading is finished, then her registration is removed, then added again as another row.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('eva', pg_temp.claim('cd100000-0000-4000-8000-000000000003'));
select public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000003'), (pg_temp.got('eva', 'claim'))::integer, 'done', '[]'::jsonb, null, pg_temp.today());
reset role;
insert into res select 'eva_before', jsonb_build_object('id', id) from public.djen_captures where registration_id = 'cd100000-0000-4000-8000-000000000003';
-- Eva is on record in a lawsuit of the firm the court has: the courts go on addressing her.
insert into public.proceeding_lawyers (proceeding_id, user_id, org_id)
values (pg_temp.got('lawsuit', 'proceeding_id')::uuid, 'ad100000-0000-4000-8000-000000000005', 'bd100000-0000-4000-8000-00000000000a');
delete from public.oab_registrations where id = 'cd100000-0000-4000-8000-000000000003';
-- And Bia, who had a registration, leaves the firm.
delete from public.memberships where user_id = 'ad100000-0000-4000-8000-000000000002';
select pg_temp.as_backend();
set local role service_role;
select public.prepare_djen_captures();
insert into res values ('gone_claims', jsonb_build_object('count', (select count(*) from public.claim_djen_captures(10, (pg_temp.got('eva_before', 'id'))::uuid))));
reset role;
insert into res select 'eva_gone', jsonb_build_object('active', active, 'kept', deactivated_at is not null, 'user', user_id, 'registration', registration_id,
  'through', captured_through)
from public.djen_captures where id = (pg_temp.got('eva_before', 'id'))::uuid;
insert into res select 'bia_gone', jsonb_build_object('active', active, 'claimed', claimed_at)
from public.djen_captures where org_id = 'bd100000-0000-4000-8000-00000000000a' and number = '33333A';
insert into res select 'stopped_events', jsonb_build_object(
  'stopped', (select count(*) from public.audit_events where action = 'publications.reading_stopped'),
  'eva', (select metadata from public.audit_events where action = 'publications.reading_stopped'
          and entity_id = pg_temp.got('eva_before', 'id')),
  'resumed', (select count(*) from public.audit_events where action = 'publications.reading_resumed'));
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('stopped_today', public.firm_today('bd100000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('stopped_health', public.admin_djen_health());
reset role;
insert into public.oab_registrations (id, user_id, uf, number, kind) values
  ('cd100000-0000-4000-8000-000000000013', 'ad100000-0000-4000-8000-000000000005', 'GO', '22222', 'principal');
-- A reading kept for longer than the setting says is forgotten.
update public.djen_captures set deactivated_at = now() - interval '100 days'
where org_id = 'bd100000-0000-4000-8000-00000000000a' and number = '33333A';
select pg_temp.as_backend();
set local role service_role;
select public.prepare_djen_captures();
insert into res values ('back_claims', jsonb_build_object('count', (select count(*) from public.claim_djen_captures(10, (pg_temp.got('eva_before', 'id'))::uuid))));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('resumed_today', public.firm_today('bd100000-0000-4000-8000-00000000000a'));
reset role;

select ok(
  pg_temp.got('eva_gone', 'active') = 'false' and pg_temp.got('eva_gone', 'kept') = 'true'
  -- Whose reading stopped stays named, for the firm to be told.
  and pg_temp.got('eva_gone', 'user') = 'ad100000-0000-4000-8000-000000000005' and pg_temp.got('eva_gone', 'registration') is null
  and pg_temp.got('gone_claims', 'count') = '0'
  -- A reading that was held when its registration left is let go.
  and pg_temp.got('bia_gone', 'active') = 'false' and pg_temp.got('bia_gone', 'claimed') is null
  -- Added again, it is the same reading, which goes on from where it was: it does not start over.
  and (select active and registration_id = 'cd100000-0000-4000-8000-000000000013' and user_id = 'ad100000-0000-4000-8000-000000000005'
              and captured_through = pg_temp.today() and deactivated_at is null
       from public.djen_captures where id = (pg_temp.got('eva_before', 'id'))::uuid)
  and pg_temp.got('back_claims', 'count') = '0'
  and not exists (select 1 from public.djen_captures where number = '33333A')
  and (select count(*) = 4 from public.djen_captures),
  'a registration nobody of the firm holds anymore is no longer read; added again it goes on from where it was, and a reading kept too long is forgotten'
);

select ok(
  pg_temp.got('stopped_events', 'stopped') = '2' and pg_temp.got('stopped_events', 'resumed') = '0'
  and (select payload -> 'eva' = jsonb_build_object('uf', 'GO', 'number', '22222', 'read_through', pg_temp.today())
       from res where name = 'stopped_events')
  -- Eva is still on record in a lawsuit the court has; Bia, who left too, is in none.
  and pg_temp.got('stopped_today', 'djen_stopped') = '1' and pg_temp.got('stopped_health', 'stopped') = '2'
  and pg_temp.got('resumed_today', 'djen_stopped') = '0'
  and (select count(*) = 1 from public.audit_events where action = 'publications.reading_resumed'
         and entity_id = pg_temp.got('eva_before', 'id'))
  and (select count(*) = 0 from public.audit_events where org_id = 'bd100000-0000-4000-8000-00000000000b' and action like 'publications.reading%'),
  'a reading that stops is never quiet: it is written in the firm''s record, and the home says so while that lawyer is still on record in a lawsuit of the firm'
);

-- ---------- A reading a person asks for ----------

insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bd100000-0000-4000-8000-00000000000a', 'ad100000-0000-4000-8000-000000000002', 'member', 'atendimento');
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('ask_bia', public.request_djen_capture('bd100000-0000-4000-8000-00000000000a'));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok($$select public.request_djen_capture('bd100000-0000-4000-8000-00000000000a')$$, '42501', 'not_authorized',
  'a reading of another firm is not asked for');
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000003', 'fd100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.request_djen_capture('bd100000-0000-4000-8000-00000000000a')$$, '42501', 'not_allowed_in_support_session',
  'nor by a support visit');
select throws_ok(
  format('select public.acknowledge_publication_cancel(%L)', pg_temp.got('ids', 'a_long')),
  '42501', 'not_allowed_in_support_session',
  'and a support visit sees nothing in the firm''s place'
);
reset role;
select pg_temp.as_backend();
-- Bia's registration is read again now that she is back; every other one of the firm was read a moment ago.
update public.djen_captures set captured_at = now(), captured_through = pg_temp.today(), requested_at = null, retry_after = null, error = null
where org_id = 'bd100000-0000-4000-8000-00000000000a';
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('ask_first', public.request_djen_capture('bd100000-0000-4000-8000-00000000000a'));
insert into res values ('ask_first_again', public.request_djen_capture('bd100000-0000-4000-8000-00000000000a'));
reset role;
update public.djen_captures set captured_at = now(), captured_through = pg_temp.today(), requested_at = null
where org_id = 'bd100000-0000-4000-8000-00000000000a';
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('ask_soon', public.request_djen_capture('bd100000-0000-4000-8000-00000000000a'));
reset role;
-- Read two hours ago, and one of them waiting hours after a round that failed.
update public.djen_captures set captured_at = now() - interval '2 hours' where org_id = 'bd100000-0000-4000-8000-00000000000a';
update public.djen_captures set retry_after = now() + interval '5 hours', error = 'djen_unavailable'
where org_id = 'bd100000-0000-4000-8000-00000000000a' and number = '54321';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('ask_not_due', jsonb_build_object('count',
  (select count(*) from public.claim_djen_captures(10, null, 'bd100000-0000-4000-8000-00000000000a'))));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('ask', public.request_djen_capture('bd100000-0000-4000-8000-00000000000a'));
insert into res values ('ask_again', public.request_djen_capture('bd100000-0000-4000-8000-00000000000a'));
reset role;
insert into res select 'ask_waits', jsonb_build_object('retry', retry_after)
from public.djen_captures where org_id = 'bd100000-0000-4000-8000-00000000000a' and number = '54321';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('ask_other_firm', jsonb_build_object('count',
  (select count(*) from public.claim_djen_captures(10, null, 'bd100000-0000-4000-8000-00000000000b'))));
insert into res values ('ask_claimed', (select jsonb_build_object('count', count(*),
    'firms', jsonb_agg(distinct (select d.org_id from public.djen_captures d where d.id = c.capture_id)))
  from public.claim_djen_captures(10, null, 'bd100000-0000-4000-8000-00000000000a') c));
reset role;
-- A firm where nobody is registered at the bar has nothing to read.
delete from public.oab_registrations where user_id = 'ad100000-0000-4000-8000-000000000004';
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('ask_nobody', public.request_djen_capture('bd100000-0000-4000-8000-00000000000b'));
reset role;

select ok(
  pg_temp.got('ask_bia', 'code') = 'not_allowed'
  -- A registration never read is asked for, and asking again says the reading is on its way, not that it was made.
  and pg_temp.got('ask_first', 'code') = 'requested' and pg_temp.got('ask_first', 'registrations') = '1'
  and pg_temp.got('ask_first_again', 'code') = 'in_course'
  -- Every one read a moment ago: too soon, with how long the firm waits between two requests.
  and pg_temp.got('ask_soon', 'code') = 'too_soon' and pg_temp.got('ask_soon', 'minutes') = '30'
  -- Read two hours ago, none was due by itself.
  and pg_temp.got('ask_not_due', 'count') = '0'
  and pg_temp.got('ask', 'code') = 'requested' and pg_temp.got('ask', 'registrations') = '4'
  and pg_temp.got('ask_again', 'code') = 'in_course'
  -- A person who asks does not wait the hours of a round that failed.
  and pg_temp.got('ask_waits', 'retry') is null
  and pg_temp.got('ask_other_firm', 'count') = '0'
  and pg_temp.got('ask_claimed', 'count') = '4'
  and (select payload -> 'firms' = '["bd100000-0000-4000-8000-00000000000a"]'::jsonb from res where name = 'ask_claimed')
  and pg_temp.got('ask_nobody', 'code') = 'no_registrations'
  and (select count(*) = 2 from public.audit_events
       where action = 'publications.capture_requested' and org_id = 'bd100000-0000-4000-8000-00000000000a'),
  'who signs or runs the deadlines asks for a reading of their own firm now, once in a while, and only that firm is read for it'
);

-- ---------- A page with its marks, and a lawsuit that is removed ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('late_claim', (select jsonb_build_object('claim', c.claims)
  from public.djen_captures c where c.org_id = 'bd100000-0000-4000-8000-00000000000a' and c.number = '12345'));
insert into res values ('late_items', public.record_djen_capture(pg_temp.capture_of('cd100000-0000-4000-8000-000000000001'),
  (pg_temp.got('late_claim', 'claim'))::integer, 'partial',
  jsonb_build_array(
    -- A page with its marks and no start said by the worker: the marks are never shown in its place.
    pg_temp.item('hashdapagina00001abcdefghijkl', '50005055320998090051', (current_date - 1)::text, '<html><body><p>Intime-se.</p></body></html>') - 'head',
    pg_temp.item('hashdoengano00001abcdefghijkl', '50006069020998090051', (current_date - 1)::text, 'Cite-se a parte ré.')),
  null, pg_temp.today() - 1));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
-- The number is recorded on a lawsuit that is only planned, by mistake, and the lawsuit is then removed.
insert into res values ('wrong_lawsuit', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "cnj": "5000606-90.2099.8.09.0051"}'::jsonb));
reset role;
insert into res select 'wrong_linked', jsonb_build_object('linked', proceeding_id = pg_temp.got('wrong_lawsuit', 'proceeding_id')::uuid
  and case_id = pg_temp.got('case', 'case_id')::uuid)
from public.publications where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdoengano00001abcdefghijkl');
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('wrong_removed', public.remove_proceeding(pg_temp.got('wrong_lawsuit', 'proceeding_id')::uuid));
reset role;

select ok(
  pg_temp.got('late_items', 'code') = 'partial' and pg_temp.got('late_items', 'new') = '2'
  and (select head = '' and tail is null and body like '<html>%'
       from public.publications where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdapagina00001abcdefghijkl'))
  and pg_temp.got('wrong_lawsuit', 'code') = 'saved' and pg_temp.got('wrong_linked', 'linked') = 'true'
  and pg_temp.got('wrong_removed', 'ok') = 'true'
  and not exists (select 1 from public.proceedings where id = pg_temp.got('wrong_lawsuit', 'proceeding_id')::uuid)
  and (select proceeding_id is null and case_id is null
       from public.publications where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdoengano00001abcdefghijkl')),
  'the marks of a page are never shown as the start of a text; and a lawsuit that is removed takes its link with it, so its publications are no case''s again'
);

-- The shadow triage classifies what arrived lately, and gives up a publication the provider keeps refusing.
select pg_temp.as_backend();
set local role service_role;
update public.publications set captured_at = now() - interval '8 days' where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdapagina00001abcdefghijkl');
insert into res values ('old_claim', jsonb_build_object('count',
  (select count(*) from public.claim_publication_triage(1, pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdapagina00001abcdefghijkl')))));
insert into res values ('refused_claim', (select to_jsonb(c)
  from public.claim_publication_triage(1, pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdoengano00001abcdefghijkl')) c));
update public.publications set ai_rejections = 4 where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdoengano00001abcdefghijkl');
-- The provider being out counts for nothing of the publication, however many times.
insert into res values ('refused_out', public.record_publication_triage(pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdoengano00001abcdefghijkl'),
  (pg_temp.got('refused_claim', 'claim'))::integer, 'released', null, 'provider_unavailable'));
update public.publications set ai_retry_after = null where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdoengano00001abcdefghijkl');
insert into res values ('refused_claim_2', (select to_jsonb(c)
  from public.claim_publication_triage(1, pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdoengano00001abcdefghijkl')) c));
insert into res values ('refused_5', public.record_publication_triage(pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdoengano00001abcdefghijkl'),
  (pg_temp.got('refused_claim_2', 'claim'))::integer, 'released', null, 'provider_rejected'));
update public.publications set ai_retry_after = null where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdoengano00001abcdefghijkl');
insert into res values ('refused_claim_3', (select to_jsonb(c)
  from public.claim_publication_triage(1, pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdoengano00001abcdefghijkl')) c));
insert into res values ('refused_6', public.record_publication_triage(pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdoengano00001abcdefghijkl'),
  (pg_temp.got('refused_claim_3', 'claim'))::integer, 'released', null, 'provider_rejected'));
insert into res values ('refused_over', jsonb_build_object('count',
  (select count(*) from public.claim_publication_triage(1, pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdoengano00001abcdefghijkl')))));
reset role;

select ok(
  pg_temp.got('old_claim', 'count') = '0'
  and pg_temp.got('refused_out', 'code') = 'released' and pg_temp.got('refused_5', 'code') = 'released'
  and pg_temp.got('refused_6', 'code') = 'failed' and pg_temp.got('refused_over', 'count') = '0'
  and (select ai_category is null and ai_rejections = 6 and ai_attempts = 3 and ai_error = 'provider_rejected'
              and ai_claimed_at is null and ai_retry_after is null
       from public.publications where id = pg_temp.pub('bd100000-0000-4000-8000-00000000000a', 'hashdoengano00001abcdefghijkl')),
  'the shadow triage classifies what arrived in the last days only, and a publication the provider itself refused time after time is given up, never one it could not reach'
);

-- ---------- A registration is one number, however it is typed ----------

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('zeros_taken', public.add_oab_registration('GO', '0012.345'));
insert into res values ('zeros_only', public.add_oab_registration('RJ', '0000000'));
insert into res values ('zeros_own', public.add_oab_registration('RJ', '00123-b'));
reset role;
insert into res select 'zeros_row', jsonb_build_object('number', number, 'uf', uf) from public.oab_registrations
where id = pg_temp.got('zeros_own', 'id')::uuid;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
select public.remove_oab_registration(pg_temp.got('zeros_own', 'id')::uuid);
reset role;

select ok(
  pg_temp.got('zeros_taken', 'code') = 'registration_in_use' and pg_temp.got('zeros_only', 'code') = 'invalid_registration'
  and pg_temp.got('zeros_own', 'code') = 'added' and pg_temp.got('zeros_row', 'number') = '123B'
  and (select count(*) = 1 from public.oab_registrations where uf = 'GO' and number = '12345'),
  'a registration is one number however it is typed: zeros before it do not make another, so nobody reads a lawyer''s publications under another spelling of their number'
);

-- Nothing of the capture is the firm's to write.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$update public.djen_captures set captured_through = current_date$$, '42501', null,
  'a person does not write what was read');
select throws_ok(
  $$insert into public.publications (org_id, hash, court, cnj, available_on, kind, body)
    values ('bd100000-0000-4000-8000-00000000000a', 'hashinventado001abcdefghijkl', 'TJGO', '50002023920998090051', current_date, 'Intimação', 'x')$$,
  '42501', null,
  'nor a publication'
);
select throws_ok($$update public.publications set category = 'ciencia'$$, '42501', null,
  'nor what a publication is, around the function that keeps the word');
reset role;

-- A setting that is not a number does not stop the reading: its default stands.
update public.platform_settings set value = value || '{"every_hours": "seis", "window_days": "cinco"}'::jsonb where key = 'publications';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('odd_setting', (select jsonb_build_object('window', r.window_days)
  from public.djen_captures c
  cross join lateral public.djen_capture_to_read(c.id, c.claims) r
  where c.org_id = 'bd100000-0000-4000-8000-00000000000a' and c.number = '12345'));
reset role;

select is(pg_temp.got('odd_setting', 'window'), '5', 'a setting that is not a number does not stop the reading: its default stands');

select * from finish();
rollback;
