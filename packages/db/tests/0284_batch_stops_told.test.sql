begin;
create extension if not exists pgtap;
select plan(10);

-- ============================================================
-- What ONE's browser waits for is told to the lawyer (0284). Ana, partner
-- of firm A, approved a batch for ONE's browser. The court asks her code:
-- it is told once (asked again within ten minutes, it is the same stop),
-- skipped on WhatsApp where she has none. ONE holds a filing for her word:
-- told once, and not when it no longer waits. The batch stops: told when
-- the browser stopped it, never when a person did. Firm B reads nothing.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2840000-0000-4000-8000-000000000001', 'ana@lima-aviso.invalid', 'Ana Lima'),
  ('a2840000-0000-4000-8000-000000000002', 'caio@prado-aviso.invalid', 'Caio Prado')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2840000-0000-4000-8000-00000000000a', 'Lima Advogados', 'lima-aviso', 'a2840000-0000-4000-8000-000000000001'),
  ('b2840000-0000-4000-8000-00000000000b', 'Prado Advocacia', 'prado-aviso', 'a2840000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2840000-0000-4000-8000-00000000000a', 'a2840000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2840000-0000-4000-8000-00000000000b', 'a2840000-0000-4000-8000-000000000002', 'owner', 'socio');

insert into public.filing_batches (id, org_id, person_id, system_key, way, status) values
  ('f2840000-0000-4000-8000-00000000000a', 'b2840000-0000-4000-8000-00000000000a', 'a2840000-0000-4000-8000-000000000001',
   'eproc-tjsp', 'browser', 'running'),
  ('f2840000-0000-4000-8000-00000000000c', 'b2840000-0000-4000-8000-00000000000a', 'a2840000-0000-4000-8000-000000000001',
   'eproc-tjsp', 'browser', 'running');

create function pg_temp.tell(batch uuid, kind text, subject text) returns text language sql as $$
  select public.reserve_filing_batch_notice(batch, kind, subject,
    array['Ana', 'eproc do TJSP', 'o tribunal pediu o código do seu aplicativo']) ->> 'code';
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;

-- ---------- The court's code ----------

select is(pg_temp.tell('f2840000-0000-4000-8000-00000000000a', 'code', '2026-11-24T10:00:00Z'), 'not_waiting',
  'a batch that asks no code tells nothing of one');
update public.filing_batches set status = 'awaiting_code', code_kind = 'app', code_asked_at = now()
where id = 'f2840000-0000-4000-8000-00000000000a';
select is(pg_temp.tell('f2840000-0000-4000-8000-00000000000a', 'code', '2026-11-24T10:00:00Z'), 'skipped',
  'the code asked is told, skipped on WhatsApp where the lawyer has none (the bell rings all the same)');
select is((select reason from public.filing_batch_notices where batch_id = 'f2840000-0000-4000-8000-00000000000a'),
  'no_phone', 'and kept with why');
select is(pg_temp.tell('f2840000-0000-4000-8000-00000000000a', 'code', '2026-11-24T10:00:40Z'), 'already',
  'the court asking again within ten minutes is the same stop');

-- ---------- The first filing held for the lawyer's word ----------

select is(pg_temp.tell('f2840000-0000-4000-8000-00000000000a', 'confirm', 'f2840000-0000-4000-8000-0000000000f1'),
  'not_waiting', 'a filing not held for the lawyer tells nothing');

-- ---------- The batch stopped ----------

update public.filing_batches set status = 'stopped', error = 'by_person', finished_at = now()
where id = 'f2840000-0000-4000-8000-00000000000c';
select is(pg_temp.tell('f2840000-0000-4000-8000-00000000000c', 'stopped', 'f2840000-0000-4000-8000-00000000000c'),
  'not_waiting', 'a stop a person asked is never told back');
update public.filing_batches set error = 'court_code_missing' where id = 'f2840000-0000-4000-8000-00000000000c';
select is(pg_temp.tell('f2840000-0000-4000-8000-00000000000c', 'stopped', 'f2840000-0000-4000-8000-00000000000c'),
  'skipped', 'a batch ONE''s browser stopped is told to its lawyer');
select is(pg_temp.tell('f2840000-0000-4000-8000-00000000000c', 'stopped', 'f2840000-0000-4000-8000-00000000000c'),
  'already', 'once');
reset role;

-- ---------- Who reads it ----------

select set_config('request.jwt.claims', '{"sub":"a2840000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::integer from public.filing_batch_notices), 0, 'another firm reads none of it');
select throws_ok($$select public.reserve_filing_batch_notice('f2840000-0000-4000-8000-00000000000a', 'code', 'x', array['a'])$$,
  '42501', null, 'and nobody but the backend keeps one');
reset role;

select * from finish();
rollback;
