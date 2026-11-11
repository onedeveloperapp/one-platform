begin;
create extension if not exists pgtap;
select plan(8);

-- ============================================================
-- The hearing, before and after (0187): who decides for the firm says the
-- value it settles for at least; ONE owes the brief of a hearing two
-- business days before and records it once; who went reports the result to
-- the firm's WhatsApp from the number on their profile, and ONE records the
-- hearing held, the settlement as a fact of the lawsuit and its payment as a
-- deadline to follow; a stranger's message changes nothing. Two firms:
-- nothing of one reaches the other.
--
-- Every person, firm, number and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1850000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-audiencia.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1850000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-audiencia.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1850000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-audiencia', 'a1850000-0000-4000-8000-000000000001'),
  ('b1850000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-audiencia', 'a1850000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1850000-0000-4000-8000-00000000000a', 'a1850000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1850000-0000-4000-8000-00000000000b', 'a1850000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c1850000-0000-4000-8000-00000000000a', 'b1850000-0000-4000-8000-00000000000a', 'whatsapp', 'hearing-waba-a', 'Chat de teste',
   'connected', 'a1850000-0000-4000-8000-000000000001', now());
update public.platform_settings set value = value || '{"debounce_seconds": 0}'::jsonb where key = 'conversation_agent';
insert into public.people (id, org_id, full_name) values
  ('d1850000-0000-4000-8000-000000000001', 'b1850000-0000-4000-8000-00000000000a', 'Maria Teste');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1850000-0000-4000-8000-000000000001', 'b1850000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.case_parties (id, org_id, case_id, person_id, role, claim_cents) values
  ('e1850000-0000-4000-8000-000000000001', 'b1850000-0000-4000-8000-00000000000a', 'c1850000-0000-4000-8000-000000000001',
   'd1850000-0000-4000-8000-000000000001', 'claimant', 1000000);
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1850000-0000-4000-8000-000000000001', 'b1850000-0000-4000-8000-00000000000a', 'c1850000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01');
insert into public.proceeding_parties (org_id, proceeding_id, party_id) values
  ('b1850000-0000-4000-8000-00000000000a', 'f1850000-0000-4000-8000-000000000001', 'e1850000-0000-4000-8000-000000000001');
-- One hearing two days ahead (its brief is owed), one an hour ago with Ana there (its result is reported).
insert into public.hearings (id, org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode, attendee_user_id) values
  ('a7850000-0000-4000-8000-000000000001', 'b1850000-0000-4000-8000-00000000000a', 'c1850000-0000-4000-8000-000000000001',
   'f1850000-0000-4000-8000-000000000001', 'instrucao', now() + interval '2 days', 'America/Sao_Paulo', 'videoconferencia', null),
  ('a7850000-0000-4000-8000-000000000002', 'b1850000-0000-4000-8000-00000000000a', 'c1850000-0000-4000-8000-000000000001',
   'f1850000-0000-4000-8000-000000000001', 'conciliacao', now() - interval '1 hour', 'America/Sao_Paulo', 'videoconferencia',
   'a1850000-0000-4000-8000-000000000001');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.writes(firm uuid, phone text, body text) returns uuid language plpgsql as $$
declare
  number uuid := (select n.id from public.wa_numbers n where n.org_id = firm and n.provider = 'test');
begin
  return (public.wa_ingest_inbound(firm, number, phone, 'Ana', 'test.in.' || gen_random_uuid(), 'text', body)
          ->> 'conversation_id')::uuid;
end;
$$;
create function pg_temp.claim(conversation uuid) returns integer language sql as $$
  select ((public.claim_conversation_turns(1, conversation) -> 0) ->> 'claim')::integer;
$$;
create function pg_temp.run(org uuid, answer jsonb) returns uuid language plpgsql as $$
declare
  made uuid := gen_random_uuid();
begin
  insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, status, output, finished_at)
  select made, org, 'audiencia.resultado', v.id, 'fake', 'fake', repeat('a', 64), 'succeeded', answer, now()
  from public.prompt_versions v where v.task = 'audiencia.resultado' and v.is_active;
  return made;
end;
$$;

-- Ana says the floor of a delay: with the second factor only; and her own WhatsApp, typed without the country.
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1850000-0000-4000-8000-000000000001', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into res values ('floor_aal1', public.set_firm_settlement_floor('b1850000-0000-4000-8000-00000000000a', 'delay', 300000));
select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1850000-0000-4000-8000-000000000001', 'role', 'authenticated', 'aal', 'aal2')::text, true);
insert into res values ('floor', public.set_firm_settlement_floor('b1850000-0000-4000-8000-00000000000a', 'delay', 300000));
insert into res values ('phone_bad', public.set_my_whatsapp('123'));
insert into res values ('phone', public.set_my_whatsapp('(00) 98888-0009'));
reset role;

select ok(
  pg_temp.got('floor_aal1', 'code') = 'second_factor' and pg_temp.got('floor', 'code') = 'saved'
  and (select cents = 300000 from public.firm_settlement_floors where org_id = 'b1850000-0000-4000-8000-00000000000a' and incident = 'delay')
  and pg_temp.got('phone_bad', 'code') = 'invalid_phone'
  and (select whatsapp = '5500988880009' from public.profiles where id = 'a1850000-0000-4000-8000-000000000001'),
  'who decides says the floor with the second factor, and a person says their own WhatsApp'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('owed', jsonb_build_object('list', public.hearing_briefs_owed(10)));
insert into res values ('brief', public.record_hearing_brief('a7850000-0000-4000-8000-000000000001',
  'Audiência de instrução do caso 1. Pedido de R$ 10.000,00. Acordo a partir de R$ 3.000,00.', true));
insert into res values ('owed_after', jsonb_build_object('list', public.hearing_briefs_owed(10)));
reset role;

select ok(
  (select payload #>> '{list,0,hearing_id}' = 'a7850000-0000-4000-8000-000000000001'
          and (payload #>> '{list,0,floor_cents}')::bigint = 300000
          and (payload #>> '{list,0,claimants,0,cents}')::bigint = 1000000
   from res where name = 'owed')
  and pg_temp.got('brief', 'code') = 'recorded'
  and (select jsonb_array_length(payload -> 'list') = 0 from res where name = 'owed_after')
  and (select emailed_at is not null from public.hearing_briefs where hearing_id = 'a7850000-0000-4000-8000-000000000001')
  and exists (select 1 from public.case_events e where e.kind = 'hearing_brief' and e.actor_type = 'system'),
  'the brief of a hearing two days ahead is owed with the floor and the claims, recorded once'
);

-- Ana writes the result from her WhatsApp; a stranger writes too.
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b1850000-0000-4000-8000-00000000000a',
  'c1850000-0000-4000-8000-00000000000a', 'test', 'hearing-number-a', 'hearing-waba-a', '5500900000081', 'Souza Advogados', 'cloud'));
insert into res values ('ana', jsonb_build_object('conversation',
  pg_temp.writes('b1850000-0000-4000-8000-00000000000a', '5500988880009', 'Fizemos acordo de 3 mil, pagamento em 15 dias')));
insert into res values ('ana_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('ana', 'conversation')::uuid)));
insert into res values ('ana_report', public.conversation_hearing_report(pg_temp.got('ana', 'conversation')::uuid,
  pg_temp.got('ana_claim', 'claim')::integer));
insert into res values ('stranger', jsonb_build_object('conversation',
  pg_temp.writes('b1850000-0000-4000-8000-00000000000a', '5500988880008', 'Teve acordo na audiência de hoje')));
insert into res values ('stranger_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('stranger', 'conversation')::uuid)));
insert into res values ('stranger_report', public.conversation_hearing_report(pg_temp.got('stranger', 'conversation')::uuid,
  pg_temp.got('stranger_claim', 'claim')::integer));
reset role;

select ok(
  pg_temp.got('ana_report', 'code') = 'one'
  and (select payload #>> '{hearings,0,hearing_id}' = 'a7850000-0000-4000-8000-000000000002' from res where name = 'ana_report')
  and pg_temp.got('stranger_report', 'code') = 'none',
  'who went is known by the WhatsApp of their profile; a stranger is answered as usual'
);

insert into res values ('run', jsonb_build_object('id', pg_temp.run('b1850000-0000-4000-8000-00000000000a', jsonb_build_object(
  'resultado', 'acordo', 'valor_reais', '3000', 'pagamento_dias', '15', 'resumo', 'Acordo de três mil reais, pago em quinze dias.'))));
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('stranger_record', public.record_hearing_report(pg_temp.got('stranger', 'conversation')::uuid,
  pg_temp.got('stranger_claim', 'claim')::integer, 'a7850000-0000-4000-8000-000000000002', pg_temp.got('run', 'id')::uuid));
insert into res values ('recorded', public.record_hearing_report(pg_temp.got('ana', 'conversation')::uuid,
  pg_temp.got('ana_claim', 'claim')::integer, 'a7850000-0000-4000-8000-000000000002', pg_temp.got('run', 'id')::uuid));
reset role;

select ok(
  pg_temp.got('stranger_record', 'code') = 'not_attendee'
  and not exists (select 1 from public.hearing_reports r where r.conversation_id = pg_temp.got('stranger', 'conversation')::uuid),
  'a report of somebody who did not go to the hearing changes nothing'
);

select ok(
  pg_temp.got('recorded', 'code') = 'recorded'
  and (select status = 'held' and outcome = 'acordo' from public.hearings where id = 'a7850000-0000-4000-8000-000000000002')
  and (select cents = 300000 and pay_days = 15 and reporter_user_id = 'a1850000-0000-4000-8000-000000000001'
       from public.hearing_reports where hearing_id = 'a7850000-0000-4000-8000-000000000002'),
  'the hearing is held with the settlement ONE read from the run'
);

select ok(
  exists (select 1 from public.lawsuit_facts f where f.proceeding_id = 'f1850000-0000-4000-8000-000000000001'
          and f.kind = 'acordo' and f.cents = 300000 and f.by_one)
  and exists (select 1 from public.deadlines d where d.proceeding_id = 'f1850000-0000-4000-8000-000000000001'
              and d.act = 'pagamento_acordo')
  and exists (select 1 from public.case_events e where e.kind = 'hearing_reported' and e.actor_type = 'ai'),
  'the settlement is a fact of the lawsuit and its payment a deadline to follow, as ONE''s'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1850000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok(
  (select count(*) from public.hearing_briefs) = 0
  and (select count(*) from public.hearing_reports) = 0
  and (select count(*) from public.firm_settlement_floors) = 0,
  'another firm reads nothing of it'
);
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.record_hearing_brief(uuid, text, boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_hearing_report(uuid, integer, uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.conversation_hearing_report(uuid, integer)', 'EXECUTE')
  and not has_table_privilege('authenticated', 'public.hearing_reports', 'INSERT'),
  'only the backend writes the brief and reads the report'
);

select * from finish();
rollback;
