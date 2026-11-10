begin;
create extension if not exists pgtap;
select plan(10);

-- ============================================================
-- A agenda de cada pessoa (0132). In Lima, Ana is a partner, Caio and Gil are
-- lawyers, Bia runs the controladoria and Davi the attendance. Caio is on the
-- record of the first lawsuit; the second has nobody, its deadline came from a
-- publication addressed to Gil; the third case has only Davi responsible.
-- The agenda says who answers for each, the controladoria sets the internal
-- days, each person makes and ends their calendar link (whose hash nobody
-- reads), and the backend reserves each e-mail of the morning once, giving
-- the turn back on the provider's quota. Rocha reads nothing of Lima's.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a1310000-0000-4000-8000-000000000001', 'ana@lima-agenda.invalid', 'Ana Lima'),
  ('a1310000-0000-4000-8000-000000000002', 'caio@lima-agenda.invalid', 'Caio Lima'),
  ('a1310000-0000-4000-8000-000000000003', 'gil@lima-agenda.invalid', 'Gil Lima'),
  ('a1310000-0000-4000-8000-000000000004', 'bia@lima-agenda.invalid', 'Bia Lima'),
  ('a1310000-0000-4000-8000-000000000005', 'davi@lima-agenda.invalid', 'Davi Lima'),
  ('a1310000-0000-4000-8000-000000000009', 'edu@rocha-agenda.invalid', 'Edu Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b1310000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-agenda', 'a1310000-0000-4000-8000-000000000001'),
  ('b1310000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-agenda', 'a1310000-0000-4000-8000-000000000009');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1310000-0000-4000-8000-00000000000a', 'a1310000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1310000-0000-4000-8000-00000000000a', 'a1310000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b1310000-0000-4000-8000-00000000000a', 'a1310000-0000-4000-8000-000000000003', 'member', 'advogado'),
  ('b1310000-0000-4000-8000-00000000000a', 'a1310000-0000-4000-8000-000000000004', 'member', 'controladoria'),
  ('b1310000-0000-4000-8000-00000000000a', 'a1310000-0000-4000-8000-000000000005', 'member', 'atendimento'),
  ('b1310000-0000-4000-8000-00000000000b', 'a1310000-0000-4000-8000-000000000009', 'owner', 'socio');

insert into public.cases (id, org_id, seq, module, incident, status, responsible_id) values
  ('c1310000-0000-4000-8000-000000000001', 'b1310000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed', null),
  ('c1310000-0000-4000-8000-000000000002', 'b1310000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed', null),
  ('c1310000-0000-4000-8000-000000000003', 'b1310000-0000-4000-8000-00000000000a', 3, 'direito-do-passageiro', 'delay', 'filed',
   'a1310000-0000-4000-8000-000000000005');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1310000-0000-4000-8000-000000000001', 'b1310000-0000-4000-8000-00000000000a', 'c1310000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01'),
  ('f1310000-0000-4000-8000-000000000002', 'b1310000-0000-4000-8000-00000000000a', 'c1310000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'filed', '10003021220998090100', '2026-09-01'),
  ('f1310000-0000-4000-8000-000000000003', 'b1310000-0000-4000-8000-00000000000a', 'c1310000-0000-4000-8000-000000000003',
   'juizado', 'TJGO', 'filed', '10003039420998090100', '2026-09-01');
insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values
  ('f1310000-0000-4000-8000-000000000001', 'a1310000-0000-4000-8000-000000000002', 'b1310000-0000-4000-8000-00000000000a');
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, proceeding_id, case_id, category,
                                 triaged_at, lawyer_ids)
values ('d1310000-0000-4000-8000-000000000001', 'b1310000-0000-4000-8000-00000000000a', 'hash-agenda-1', 'TJGO',
        '10003021220998090100', current_date - 3, 'Intimação', 'Intime-se a parte autora para se manifestar em 5 dias.',
        'f1310000-0000-4000-8000-000000000002', 'c1310000-0000-4000-8000-000000000002', 'prazo', now(),
        array['a1310000-0000-4000-8000-000000000003']::uuid[]);
insert into public.deadlines (id, org_id, cnj, court, case_id, proceeding_id, publication_id, title, act, trigger, trigger_on,
                              days, counting, status, due_on, confirmed_at, done_at) values
  ('e1310000-0000-4000-8000-000000000001', 'b1310000-0000-4000-8000-00000000000a', '10003012720998090100', 'TJGO',
   'c1310000-0000-4000-8000-000000000001', 'f1310000-0000-4000-8000-000000000001', null, 'Réplica de Maria Teste', null,
   'day', current_date - 5, 15, 'business', 'confirmed', current_date + 3, now(), null),
  ('e1310000-0000-4000-8000-000000000002', 'b1310000-0000-4000-8000-00000000000a', '10003021220998090100', 'TJGO',
   'c1310000-0000-4000-8000-000000000002', 'f1310000-0000-4000-8000-000000000002', 'd1310000-0000-4000-8000-000000000001',
   'Manifestação', null, 'day', current_date - 3, 5, 'business', 'proposed', current_date + 4, null, null),
  ('e1310000-0000-4000-8000-000000000003', 'b1310000-0000-4000-8000-00000000000a', '10003039420998090100', 'TJGO',
   'c1310000-0000-4000-8000-000000000003', 'f1310000-0000-4000-8000-000000000003', null, 'Recurso', null,
   'day', current_date - 3, 10, 'business', 'done', current_date + 5, null, now());
insert into public.hearings (id, org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode, attendee_user_id) values
  ('a2310000-0000-4000-8000-000000000001', 'b1310000-0000-4000-8000-00000000000a', 'c1310000-0000-4000-8000-000000000003',
   'f1310000-0000-4000-8000-000000000003', 'conciliacao', now() + interval '2 days', 'America/Manaus', 'videoconferencia',
   'a1310000-0000-4000-8000-000000000003');

create function pg_temp.sign_in(person uuid, aal text default 'aal2')
returns void language sql as $$
  select set_config('request.jwt.claims',
    jsonb_build_object('sub', person, 'role', 'authenticated', 'aal', aal)::text, true);
$$;
create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role;
create function pg_temp.got(name text, path text) returns text language sql as $$
  select value #>> path::text[] from res where key = name;
$$;
create function pg_temp.as_person(person uuid, name text, call text) returns void language plpgsql as $$
begin
  perform pg_temp.sign_in(person);
  set local role authenticated;
  execute format('insert into res values (%L, (%s))', name, call);
  reset role;
end;
$$;
create function pg_temp.as_backend(name text, call text) returns void language plpgsql as $$
begin
  set local role service_role;
  execute format('insert into res values (%L, to_jsonb((%s)))', name, call);
  reset role;
end;
$$;

-- ---------- Who answers for each item ----------

select pg_temp.as_person('a1310000-0000-4000-8000-000000000005', 'agenda',
  $$public.firm_agenda('b1310000-0000-4000-8000-00000000000a', current_date, current_date + 6)$$);
select ok(
  (select jsonb_array_length(value -> 'deadlines') = 2 from res where key = 'agenda')
    and (select (d -> 'people') = '["a1310000-0000-4000-8000-000000000002"]'::jsonb
         from res, jsonb_array_elements(value -> 'deadlines') d where key = 'agenda' and d ->> 'id' = 'e1310000-0000-4000-8000-000000000001')
    and (select (d -> 'people') = '["a1310000-0000-4000-8000-000000000003"]'::jsonb
         from res, jsonb_array_elements(value -> 'deadlines') d where key = 'agenda' and d ->> 'id' = 'e1310000-0000-4000-8000-000000000002'),
  'an open deadline is the lawsuit''s lawyers'', else of who its publication was addressed to; a deadline done is no item'
);
select ok(
  (select (h -> 'people') = '["a1310000-0000-4000-8000-000000000003", "a1310000-0000-4000-8000-000000000005"]'::jsonb
     and h ->> 'time_zone' = 'America/Manaus'
   from res, jsonb_array_elements(value -> 'hearings') h where key = 'agenda')
    and pg_temp.got('agenda', '{internal_days}') = '2' and pg_temp.got('agenda', '{me,whole_firm}') = 'false'
    and pg_temp.got('agenda', '{me,digest_on}') = 'true',
  'a hearing is of who attends it and of who is responsible for a case with no lawyer; two internal days by default'
);

-- ---------- The internal days ----------

select pg_temp.as_person('a1310000-0000-4000-8000-000000000002', 'days-caio',
  $$public.set_internal_deadline_days('b1310000-0000-4000-8000-00000000000a', 3)$$);
select pg_temp.as_person('a1310000-0000-4000-8000-000000000004', 'days-bia',
  $$public.set_internal_deadline_days('b1310000-0000-4000-8000-00000000000a', 3)$$);
select pg_temp.as_person('a1310000-0000-4000-8000-000000000004', 'days-bad',
  $$public.set_internal_deadline_days('b1310000-0000-4000-8000-00000000000a', 16)$$);
select ok(
  pg_temp.got('days-caio', '{code}') = 'not_allowed' and pg_temp.got('days-bia', '{ok}') = 'true'
    and pg_temp.got('days-bad', '{code}') = 'invalid_data'
    and (select internal_deadline_days = 3 from public.organizations where id = 'b1310000-0000-4000-8000-00000000000a')
    and exists (select 1 from public.audit_events where action = 'agenda.internal_days_set'
                and org_id = 'b1310000-0000-4000-8000-00000000000a'),
  'the controladoria, or a partner, sets how many business days before the internal deadline comes; on the record'
);

-- ---------- The calendar link ----------

select pg_temp.as_person('a1310000-0000-4000-8000-000000000002', 'link',
  format($$public.start_agenda_calendar('b1310000-0000-4000-8000-00000000000a', %L)$$, encode(sha256('token-do-caio'), 'hex')));
select pg_temp.as_backend('feed', format($$public.agenda_calendar_feed(%L)$$, encode(sha256('token-do-caio'), 'hex')));
select ok(
  pg_temp.got('link', '{ok}') = 'true' and pg_temp.got('feed', '{user_id}') = 'a1310000-0000-4000-8000-000000000002'
    and pg_temp.got('feed', '{internal_days}') = '3'
    and (select jsonb_array_length(value -> 'deadlines') >= 2 from res where key = 'feed'),
  'a person makes their link, and the backend reads its items by the hash of its token'
);

select pg_temp.sign_in('a1310000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok($$ select calendar_hash from public.agenda_preferences $$, '42501', null,
  'nobody of the firm reads the hash of a calendar link, not even its own person');
reset role;

select pg_temp.as_person('a1310000-0000-4000-8000-000000000002', 'link-again',
  format($$public.start_agenda_calendar('b1310000-0000-4000-8000-00000000000a', %L)$$, encode(sha256('outro-token-do-caio'), 'hex')));
select pg_temp.as_backend('feed-old', format($$public.agenda_calendar_feed(%L)$$, encode(sha256('token-do-caio'), 'hex')));
delete from public.memberships where user_id = 'a1310000-0000-4000-8000-000000000002';
select pg_temp.as_backend('feed-left', format($$public.agenda_calendar_feed(%L)$$, encode(sha256('outro-token-do-caio'), 'hex')));
select ok(
  (select value is null from res where key = 'feed-old')
    and (select value is null from res where key = 'feed-left'),
  'a new link ends the one before, and a person who leaves the firm takes their link with them'
);

-- ---------- The e-mail of the morning ----------

select pg_temp.as_person('a1310000-0000-4000-8000-000000000003', 'digest-off',
  $$public.set_agenda_digest('b1310000-0000-4000-8000-00000000000a', false)$$);
select pg_temp.as_backend('owed', $$public.agenda_digests_owed(current_date, current_date + 2)$$);
select ok(
  (select jsonb_agg(p ->> 'user_id' order by p ->> 'user_id') = '["a1310000-0000-4000-8000-000000000001", "a1310000-0000-4000-8000-000000000004", "a1310000-0000-4000-8000-000000000005"]'::jsonb
   from res, jsonb_array_elements(value) f, jsonb_array_elements(f -> 'people') p
   where key = 'owed' and f ->> 'org_id' = 'b1310000-0000-4000-8000-00000000000a')
    and (select bool_and((p ->> 'whole_firm')::boolean = (p ->> 'user_id' <> 'a1310000-0000-4000-8000-000000000005'))
         from res, jsonb_array_elements(value) f, jsonb_array_elements(f -> 'people') p
         where key = 'owed' and f ->> 'org_id' = 'b1310000-0000-4000-8000-00000000000a'),
  'the e-mail is owed to who did not stop it; the partner and the controladoria read the whole firm'
);

select pg_temp.as_backend('reserve-1', $$public.reserve_agenda_digest('b1310000-0000-4000-8000-00000000000a',
  'a1310000-0000-4000-8000-000000000005', current_date, 2)$$);
select pg_temp.as_backend('reserve-2', $$public.reserve_agenda_digest('b1310000-0000-4000-8000-00000000000a',
  'a1310000-0000-4000-8000-000000000005', current_date, 2)$$);
select pg_temp.as_backend('quota', format($$public.finish_agenda_digest(%L, 'quota')$$, pg_temp.got('reserve-1', '{}')));
select pg_temp.as_backend('reserve-3', $$public.reserve_agenda_digest('b1310000-0000-4000-8000-00000000000a',
  'a1310000-0000-4000-8000-000000000005', current_date, 2)$$);
select pg_temp.as_backend('sent', format($$public.finish_agenda_digest(%L, 'sent')$$, pg_temp.got('reserve-3', '{}')));
select ok(
  pg_temp.got('reserve-1', '{}') is not null and (select value is null from res where key = 'reserve-2')
    and pg_temp.got('reserve-3', '{}') is not null
    and (select status = 'sent' from public.agenda_digests where user_id = 'a1310000-0000-4000-8000-000000000005'),
  'an e-mail is reserved once a day; the provider''s quota gives the turn back, and the next round sends it'
);

select pg_temp.as_backend('empty', $$public.reserve_agenda_digest('b1310000-0000-4000-8000-00000000000a',
  'a1310000-0000-4000-8000-000000000001', current_date, 0)$$);
select pg_temp.as_backend('owed-after', $$public.agenda_digests_owed(current_date, current_date + 2)$$);
select ok(
  (select value is null from res where key = 'empty')
    and (select jsonb_agg(p ->> 'user_id') = '["a1310000-0000-4000-8000-000000000004"]'::jsonb
         from res, jsonb_array_elements(value) f, jsonb_array_elements(f -> 'people') p
         where key = 'owed-after' and f ->> 'org_id' = 'b1310000-0000-4000-8000-00000000000a'),
  'a person with nothing that day gets no e-mail and is not asked again; one sent is owed no more'
);

-- ---------- The other firm ----------

select pg_temp.sign_in('a1310000-0000-4000-8000-000000000009');
set local role authenticated;
select throws_ok(
  $$ select public.firm_agenda('b1310000-0000-4000-8000-00000000000a', current_date, current_date + 6) $$,
  '42501', null, 'nobody of another firm reads its agenda');
reset role;

select * from finish();
rollback;
