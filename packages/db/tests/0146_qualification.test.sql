begin;
create extension if not exists pgtap;
select plan(9);

-- ============================================================
-- ONE's word on whether a problem qualifies (0147): the backend reads a
-- case's facts and keeps the rule's answer, told in the timeline when it
-- changes; a partner or a lawyer goes on with a case the rule did not qualify,
-- with the reason; and the passenger's yes to a problem that does not qualify
-- opens no case. Two firms: nothing of one reaches the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1460000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@qualione.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1460000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@qualione.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a1460000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@qualione.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1460000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-qualione', 'a1460000-0000-4000-8000-000000000001'),
  ('b1460000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-qualione', 'a1460000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1460000-0000-4000-8000-00000000000a', 'a1460000-0000-4000-8000-000000000001', 'owner', 'advogado'),
  ('b1460000-0000-4000-8000-00000000000a', 'a1460000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('b1460000-0000-4000-8000-00000000000b', 'a1460000-0000-4000-8000-000000000003', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

create function pg_temp.new_case(name text, who uuid, org uuid, incident text) returns void language plpgsql as $$
declare
  made jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  made := public.create_case(org, incident, 'LA', date '2026-11-02',
    jsonb_build_object('full_name', 'Cliente ' || initcap(name), 'birth_date', '1985-04-02'));
  reset role;
  insert into res values (name, made);
end;
$$;

-- What the backend does, as the service role.
create function pg_temp.backend(call text) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  execute call into answer;
  execute 'reset role';
  return answer;
end;
$$;

create function pg_temp.person(who uuid, call text) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform pg_temp.sign_in(who);
  execute 'set local role authenticated';
  execute call into answer;
  execute 'reset role';
  return answer;
end;
$$;

create function pg_temp.verdict(outcome text, reason text) returns jsonb language sql as $$
  select jsonb_build_object('rule', 'qualificacao-v1', 'outcome', outcome, 'reasons', jsonb_build_array(reason),
    'missing', '[]'::jsonb, 'assumptions', '[]'::jsonb, 'claims', jsonb_build_object('material', true, 'moral', true));
$$;

select pg_temp.new_case('alfa', 'a1460000-0000-4000-8000-000000000001', 'b1460000-0000-4000-8000-00000000000a', 'delay');
select pg_temp.new_case('cedo', 'a1460000-0000-4000-8000-000000000001', 'b1460000-0000-4000-8000-00000000000a', 'cancellation');
select pg_temp.new_case('beta', 'a1460000-0000-4000-8000-000000000003', 'b1460000-0000-4000-8000-00000000000b', 'cancellation');

-- Alfa's trip: Goiânia to São Paulo, then abroad.
insert into public.flight_segments (org_id, case_id, position, flight_number, origin_iata, destination_iata,
  scheduled_departure_local, scheduled_arrival_local, affected)
select 'b1460000-0000-4000-8000-00000000000a'::uuid, pg_temp.got('alfa', 'case_id')::uuid, 1, 'LA1234', 'GYN', 'GRU',
  timestamp '2026-11-02 08:00', timestamp '2026-11-02 09:40', true
union all
select 'b1460000-0000-4000-8000-00000000000a'::uuid, pg_temp.got('alfa', 'case_id')::uuid, 2, 'LA8084', 'GRU',
  (select a.iata from public.airports a where a.country <> 'BR' and a.iata is not null order by a.iata limit 1),
  timestamp '2026-11-02 22:00', timestamp '2026-11-03 10:00', false;

select ok(
  not has_function_privilege('authenticated', 'public.case_qualification_facts(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_case_qualification(uuid, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.one_alert_not_qualified(uuid, integer, uuid, jsonb, text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.release_case_qualification(uuid, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.release_case_qualification(uuid, text)', 'EXECUTE'),
  'only the backend reads a case for the rule and keeps its word; a person of the firm only goes on with a case'
);

insert into res values ('alfa-facts', pg_temp.backend(format(
  'select public.case_qualification_facts(%L)', pg_temp.got('alfa', 'case_id'))));
insert into res values ('cedo-facts', pg_temp.backend(format(
  'select public.case_qualification_facts(%L)', pg_temp.got('cedo', 'case_id'))));
select ok(
  pg_temp.got('alfa-facts', 'incident') = 'delay' and pg_temp.got('alfa-facts', 'international') = 'true'
  and pg_temp.got('alfa-facts', 'scheduled_arrival') = '2026-11-02T09:40'
  and pg_temp.got('alfa-facts', 'flight_date') = '2026-11-02'
  and (select payload -> 'international' = 'null'::jsonb from res where name = 'cedo-facts'),
  'the rule reads the affected leg, a leg abroad, and nothing of the flight where the case has no leg'
);

select ok(
  pg_temp.backend(format('select public.record_case_qualification(%L, %L)', pg_temp.got('cedo', 'case_id'),
    '{"rule": "qualificacao-v1", "outcome": "maybe", "reasons": [], "missing": [], "assumptions": []}'))
    ->> 'code' = 'invalid_result'
  and pg_temp.backend(format('select public.record_case_qualification(%L, %L)', pg_temp.got('cedo', 'case_id'),
    pg_temp.verdict('qualifies', 'cancelled'))) ->> 'code' = 'recorded'
  and pg_temp.backend(format('select public.record_case_qualification(%L, %L)', pg_temp.got('cedo', 'case_id'),
    pg_temp.verdict('qualifies', 'cancelled'))) ->> 'code' = 'unchanged',
  'the backend keeps the rule''s word once, and nothing that is not one'
);

-- The interview says the airline told of it a week before: the rule no longer qualifies it.
select pg_temp.backend(format('select public.record_case_qualification(%L, %L)', pg_temp.got('cedo', 'case_id'),
  pg_temp.verdict('not_qualified', 'cancelled_early_notice')));
select ok(
  (select qualification ->> 'outcome' = 'not_qualified' from public.cases where id = pg_temp.got('cedo', 'case_id')::uuid)
  and (select count(*) = 2 from public.case_events
       where case_id = pg_temp.got('cedo', 'case_id')::uuid and kind = 'qualified'),
  'each change of what the rule decided is told in the case''s timeline'
);

select ok(
  pg_temp.person('a1460000-0000-4000-8000-000000000002', format(
    'select public.release_case_qualification(%L, %L)', pg_temp.got('cedo', 'case_id'), 'A companhia não ofereceu alternativa.'))
    ->> 'code' = 'not_allowed'
  and pg_temp.person('a1460000-0000-4000-8000-000000000003', format(
    'select public.release_case_qualification(%L, %L)', pg_temp.got('cedo', 'case_id'), 'A companhia não ofereceu alternativa.'))
    ->> 'code' = 'not_found'
  and pg_temp.person('a1460000-0000-4000-8000-000000000001', format(
    'select public.release_case_qualification(%L, %L)', pg_temp.got('cedo', 'case_id'), 'curto'))
    ->> 'code' = 'reason_required',
  'the attendance may not go on with it, firm B does not see it, and going on asks a reason'
);

insert into res values ('released', pg_temp.person('a1460000-0000-4000-8000-000000000001', format(
  'select public.release_case_qualification(%L, %L)', pg_temp.got('cedo', 'case_id'),
  'A companhia não ofereceu alternativa de voo.')));
select ok(
  pg_temp.got('released', 'code') = 'released'
  and (select qualification_released_by = 'a1460000-0000-4000-8000-000000000001' and qualification_release_reason is not null
       from public.cases where id = pg_temp.got('cedo', 'case_id')::uuid)
  and exists (select 1 from public.audit_events where action = 'case.qualification_released'
              and org_id = 'b1460000-0000-4000-8000-00000000000a')
  and exists (select 1 from public.case_events where case_id = pg_temp.got('cedo', 'case_id')::uuid
              and kind = 'qualification_released' and actor_type = 'person'),
  'a lawyer goes on with the case, with the reason, on the record and in the timeline'
);

select ok(
  pg_temp.person('a1460000-0000-4000-8000-000000000001', format(
    'select public.release_case_qualification(%L, %L)', pg_temp.got('alfa', 'case_id'), 'Seguir com o caso, sim.'))
    ->> 'code' = 'nothing_to_release',
  'a case the rule did not hold has nothing to go on with'
);

select ok(
  pg_temp.backend(format('select public.one_alert_not_qualified(%L, 1, %L, %L, %L)',
    gen_random_uuid(), gen_random_uuid(), pg_temp.verdict('qualifies', 'cancelled'), 'Mensagem.')) ->> 'code' = 'invalid_result'
  and pg_temp.backend(format('select public.one_alert_not_qualified(%L, 1, %L, %L, %L)',
    gen_random_uuid(), gen_random_uuid(), pg_temp.verdict('not_qualified', 'changed_small'), 'Mensagem.')) ->> 'code' = 'not_working',
  'a yes is answered as not qualified only with the rule''s word saying so, and only under the conversation''s claim'
);

-- Firm B's case keeps its own word, and firm A's person reads none of it.
select pg_temp.backend(format('select public.record_case_qualification(%L, %L)', pg_temp.got('beta', 'case_id'),
  pg_temp.verdict('qualifies', 'cancelled')));
select pg_temp.sign_in('a1460000-0000-4000-8000-000000000001');
set local role authenticated;
select ok(
  not exists (select 1 from public.cases where id = pg_temp.got('beta', 'case_id')::uuid)
  and (select qualification ->> 'outcome' = 'not_qualified' from public.cases where id = pg_temp.got('cedo', 'case_id')::uuid),
  'a person of firm A reads its own case''s word and nothing of firm B'
);
reset role;

select * from finish();
rollback;
