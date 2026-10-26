begin;
create extension if not exists pgtap;
select plan(42);

-- ============================================================
-- The notices to clients (0038). Who manages the firm submits each kind's
-- text to the firm's account at the vendor and switches it on once approved;
-- a person agrees to be told (on their link, or as the firm records it), and
-- every agreement stays on record; the database says what is due and why
-- something cannot go, and reserves each notice with its message to the
-- outbox once, never twice, within the firm's ceiling: a phone is told a
-- thing once, a change stands for the reminder of its moment, a passing
-- failure is tried again later and a few times only. Two firms: nothing of
-- one reaches the other.
--
-- Every person, firm, number and lawsuit here is invented: the lawsuits are
-- of a year to come, the phones of an area code no carrier has (one of a
-- real code, never sent to, shows how a mobile is read with and without its
-- ninth digit).
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ad100000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@avisos.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('ad100000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@avisos.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('ad100000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@avisos.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('bd100000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-avisos', 'ad100000-0000-4000-8000-000000000001'),
  ('bd100000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-avisos', 'ad100000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bd100000-0000-4000-8000-00000000000a', 'ad100000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('bd100000-0000-4000-8000-00000000000a', 'ad100000-0000-4000-8000-000000000002', 'member', 'atendimento'),
  ('bd100000-0000-4000-8000-00000000000b', 'ad100000-0000-4000-8000-000000000004', 'owner', 'advogado');

insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('dd100000-0000-4000-8000-00000000000a', 'bd100000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-a', 'WhatsApp A', 'connected',
   'ad100000-0000-4000-8000-000000000001', now()),
  ('dd100000-0000-4000-8000-00000000000b', 'bd100000-0000-4000-8000-00000000000b', 'whatsapp', 'waba-b', 'WhatsApp B', 'connected',
   'ad100000-0000-4000-8000-000000000004', now());
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number, mode) values
  ('ed100000-0000-4000-8000-00000000000a', 'bd100000-0000-4000-8000-00000000000a', 'dd100000-0000-4000-8000-00000000000a',
   'simulator', 'sim-numero-a', 'waba-a', '5500900000001', 'coexistence'),
  ('ed100000-0000-4000-8000-00000000000b', 'bd100000-0000-4000-8000-00000000000b', 'dd100000-0000-4000-8000-00000000000b',
   'simulator', 'sim-numero-b', 'waba-b', '5500900000002', 'coexistence');

-- Notices go at any hour in this file (the hours of the day are a setting, and a test runs at any hour), and with
-- no wait after a write (a test is one transaction: every write in it is of the same moment).
update public.platform_settings set value = value || '{"send_from_hour": 0, "send_until_hour": 24, "settle_minutes": 0}'::jsonb
where key = 'notices';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2', session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level, 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.reserve_in(label text, firm uuid) returns void language sql as
$$ insert into res values (reserve_in.label, public.reserve_client_notices(reserve_in.firm, 50)); $$;
create function pg_temp.reserve(label text) returns void language sql as
$$ select pg_temp.reserve_in(reserve.label, 'bd100000-0000-4000-8000-00000000000a'); $$;
create function pg_temp.kind_text(kind text) returns text language sql as
$$ select body from public.notice_kinds where notice_kinds.kind = kind_text.kind; $$;
-- Time passes for what was reserved: a test is one transaction, and every notice in it was written a moment ago.
create function pg_temp.later(minutes integer) returns void language sql as
$$ update public.client_notices set reserved_at = reserved_at - make_interval(mins => later.minutes); $$;
create function pg_temp.setting(change jsonb) returns void language sql as
$$ update public.platform_settings set value = value || setting.change where key = 'notices'; $$;

-- Firm A: Maria's case, with a lawsuit filed 40 days ago and a hearing in six days. Firm B: a case of its own.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case', public.create_case('bd100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-01-20',
  '{"full_name": "MARIA TESTE DA SILVA", "birth_date": "1985-04-02", "phone": "5500999998888"}'::jsonb));
insert into res values ('go', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'system', 'projudi', 'comarca', 'Goiânia', 'status', 'filed',
    'cnj', '5000401-61.2099.8.09.0051', 'filed_at', to_char(current_date - 40, 'YYYY-MM-DD')),
  array[pg_temp.got('case', 'party_id')::uuid]));
insert into res values ('hearing', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'videoconferencia', 'day', to_char(current_date + 6, 'YYYY-MM-DD'),
    'time', '14:00', 'link', 'https://sala.invalid/7')));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', public.create_case('bd100000-0000-4000-8000-00000000000b', 'delay', 'AD', date '2026-01-20',
  '{"full_name": "Paulo Teste", "phone": "5500999997777"}'::jsonb));
reset role;

-- ---------- The kinds, and what nobody writes but through the functions ----------

select ok(
  (select array_agg(kind order by position) = array['hearing_change', 'hearing_reminder', 'payment_alert', 'lawsuit_update',
                                                    'document_refused', 'flight_problem', 'case_received', 'lawsuit_filed']
   from public.notice_kinds)
  and (select bool_and(cardinality(params) = cardinality(examples)
                       and (select count(*) from regexp_matches(body, '\{\{([0-9])\}\}', 'g')) = cardinality(params))
       from public.notice_kinds)
  and has_table_privilege('authenticated', 'public.notice_kinds', 'SELECT')
  and has_table_privilege('authenticated', 'public.client_notices', 'SELECT')
  and not has_table_privilege('authenticated', 'public.client_notices', 'INSERT')
  and not has_table_privilege('authenticated', 'public.notice_optins', 'INSERT')
  and not has_table_privilege('authenticated', 'public.notice_optins', 'DELETE')
  and not has_table_privilege('authenticated', 'public.firm_notice_kinds', 'UPDATE')
  and not has_function_privilege('authenticated', 'public.reserve_client_notices(uuid, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.notice_candidates(uuid, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_notice_template(uuid, text, text, text, text, text, text, text, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.promote_notice_template(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.client_link_set_notices(text, boolean, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.client_link_set_notices(text, boolean, text, jsonb)', 'EXECUTE')
  and has_function_privilege('anon', 'public.client_link_notices(text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.begin_notice_template(uuid, text, text)', 'EXECUTE'),
  'the kinds are seeded with a value for each mark of their text, and a session writes nothing but through the functions'
);

-- ---------- Submitting a kind's text ----------

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  $$select public.begin_notice_template('bd100000-0000-4000-8000-00000000000a', 'hearing_reminder', pg_temp.kind_text('hearing_reminder'))$$,
  '42501', 'not_authorized', 'only who manages the firm submits a text to the firm''s account');
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
select throws_ok(
  $$select public.begin_notice_template('bd100000-0000-4000-8000-00000000000a', 'hearing_reminder', pg_temp.kind_text('hearing_reminder'))$$,
  '42501', null, 'and with the second factor');
reset role;

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('out_of_order', public.begin_notice_template('bd100000-0000-4000-8000-00000000000a', 'hearing_reminder',
  'Olá, {{2}}. O escritório {{1}} lembra da audiência {{3}} do processo {{4}} em {{5}}. {{6}} Até logo.'));
insert into res values ('at_edge', public.begin_notice_template('bd100000-0000-4000-8000-00000000000a', 'payment_alert',
  '{{1}}, aviso do escritório {{2}} sobre o seu processo {{3}}'));
insert into res values ('spaced', public.begin_notice_template('bd100000-0000-4000-8000-00000000000a', 'payment_alert',
  'Olá, {{ 1 }}. Aviso do escritório {{2}} sobre o seu processo {{3 }}, com cuidado.'));
insert into res values ('begun', public.begin_notice_template('bd100000-0000-4000-8000-00000000000a', 'hearing_reminder',
  pg_temp.kind_text('hearing_reminder')));
reset role;
select ok(
  pg_temp.got('out_of_order', 'code') = 'invalid_values' and pg_temp.got('at_edge', 'code') = 'value_at_edge'
  -- A value written with spaces inside its braces is the same value, and goes as the vendor reads it.
  and pg_temp.got('spaced', 'body') = 'Olá, {{1}}. Aviso do escritório {{2}} sobre o seu processo {{3}}, com cuidado.'
  and pg_temp.got('begun', 'name') = 'one_lembrete_audiencia_1'
  and (select payload -> 'number' ->> 'waba_id' = 'waba-a' and payload ->> 'category' = 'utility'
              and jsonb_array_length(payload -> 'examples') = 6 from res where name = 'begun'),
  'a text keeps the kind''s values in order and starts and ends with words; its name is the kind''s, numbered'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('recorded', public.record_notice_template('bd100000-0000-4000-8000-00000000000a', 'hearing_reminder',
  'waba-a', 'one_lembrete_audiencia_1', 'PENDING', 'UTILITY', pg_temp.kind_text('hearing_reminder'),
  'Para não receber estes avisos, responda SAIR.', 'ad100000-0000-4000-8000-000000000001'));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('on_pending', public.set_notice_kind('bd100000-0000-4000-8000-00000000000a', 'hearing_reminder', true));
insert into res values ('on_none', public.set_notice_kind('bd100000-0000-4000-8000-00000000000a', 'payment_alert', true));
reset role;
-- The vendor approves it (as its webhook or the next reading of the account says).
update public.wa_templates set status = 'approved' where name = 'one_lembrete_audiencia_1';
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('on', public.set_notice_kind('bd100000-0000-4000-8000-00000000000a', 'hearing_reminder', true));
reset role;
select ok(
  pg_temp.got('recorded', 'code') = 'recorded' and pg_temp.got('recorded', 'status') = 'pending'
  and pg_temp.got('on_pending', 'code') = 'template_not_approved' and pg_temp.got('on_none', 'code') = 'no_template'
  and pg_temp.got('on', 'code') = 'on'
  and (select enabled from public.firm_notice_kinds where org_id = 'bd100000-0000-4000-8000-00000000000a' and kind = 'hearing_reminder')
  and (select count(*) = 1 from public.audit_events where action = 'notices.template_submitted')
  and (select count(*) = 1 from public.audit_events where action = 'notices.kind_on'),
  'a kind goes on only once the vendor approved its template, on the record'
);

-- ---------- Agreeing to be told ----------

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('no_note', public.record_notice_optin(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, true, 'curto'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res select 'blocked', jsonb_agg(jsonb_build_object('kind', c.kind, 'blocker', c.blocker))
  from public.notice_candidates('bd100000-0000-4000-8000-00000000000a', null) c;
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('optin', public.record_notice_optin(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, true, 'Concordou no contrato de honorários.'));
insert into res values ('optin_again', public.record_notice_optin(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, true, 'Concordou no contrato de honorários.'));
reset role;
select ok(
  pg_temp.got('no_note', 'code') = 'note_required'
  and (select payload @> '[{"kind": "hearing_reminder", "blocker": "no_optin"}]'::jsonb from res where name = 'blocked')
  and pg_temp.got('optin', 'code') = 'recorded' and pg_temp.got('optin_again', 'code') = 'unchanged'
  and (select source = 'firm' and phone = '5500999998888' and wording like '%(00) 99999-8888%' and note is not null
       from public.notice_optins where person_id = pg_temp.got('case', 'person_id')::uuid and ended_at is null)
  and (select count(*) = 1 from public.notice_optins where person_id = pg_temp.got('case', 'person_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'notices_agreed'),
  'a person of the firm records how somebody agreed, for the number the firm has, in words kept as they were'
);

-- ---------- What is due, and reserving it once ----------

-- A hearing written a moment ago waits the setting's minutes: a mistake corrected at once never reaches the client.
select pg_temp.setting('{"settle_minutes": 15}');
select pg_temp.as_backend();
set local role service_role;
insert into res select 'settling', jsonb_build_object('n', count(*))
  from public.notice_candidates('bd100000-0000-4000-8000-00000000000a', null) c where c.kind = 'hearing_reminder';
reset role;
select pg_temp.setting('{"settle_minutes": 0}');
select pg_temp.as_backend();
set local role service_role;
insert into res select 'due', jsonb_agg(jsonb_build_object('kind', c.kind, 'occurrence', c.occurrence, 'blocker', c.blocker,
    'early', c.early, 'params', to_jsonb(c.params)))
  from public.notice_candidates('bd100000-0000-4000-8000-00000000000a', null) c;
select pg_temp.reserve('first');
select pg_temp.reserve('again');
reset role;
select ok(
  pg_temp.got('settling', 'n') = '0'
  and (select jsonb_array_length(payload) = 2 from res where name = 'due')
  and (select payload @> jsonb_build_array(jsonb_build_object('kind', 'hearing_reminder', 'blocker', null, 'early', false,
         'occurrence', 'h:' || pg_temp.got('hearing', 'id') || ':' ||
           to_char(((current_date + 6) + time '14:00') at time zone 'America/Sao_Paulo' at time zone 'UTC', 'YYYYMMDDHH24MI') || ':week'))
       from res where name = 'due')
  -- The word on the lawsuit is due too, and cannot go: its kind is off.
  and (select payload @> '[{"kind": "lawsuit_update", "blocker": "kind_off"}]'::jsonb from res where name = 'due'),
  'a hearing in six days is due its reminder of the week once it settled, and the word on a lawsuit waits for its kind'
);

select ok(
  pg_temp.got('first', 'reserved') = '1' and pg_temp.got('again', 'reserved') = '0'
  and (select count(*) = 1 from public.client_notices where phone = '5500999998888')
  and (select count(*) = 1 from public.wa_messages where status = 'queued' and kind = 'template'
         and template_name = 'one_lembrete_audiencia_1'
         and body like 'Olá, Maria. O escritório Souza Advogados lembra que a audiência de conciliação do seu processo nº 5000401-61.2099.8.09.0051 está marcada para %, às 14:00, horário de Brasília. Ela será por videoconferência, pelo link https://sala.invalid/7. A sua presença é importante.%'
         and sent_by is null)
  and (select count(*) = 1 from public.wa_conversations where contact_wa_id = '5500999998888'),
  'the notice is reserved once with its message to the outbox, filled from the case, and a second sweep reserves nothing'
);

-- A message refused for a passing reason is reserved again as the same notice, after a wait that doubles each time,
-- while it has tries; one whose fate is unknown never.
update public.wa_messages set status = 'failed', error_code = 'rate_limited' where kind = 'template';
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('too_soon');
reset role;
select pg_temp.later(31);
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('retried');
reset role;
update public.wa_messages set status = 'failed', error_code = 'rate_limited' where kind = 'template' and status = 'queued';
select pg_temp.later(61);
select pg_temp.setting('{"max_attempts": 2}');
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('spent');
reset role;
select pg_temp.setting('{"max_attempts": 5}');
update public.wa_messages set error_code = 'unconfirmed' where kind = 'template' and status = 'failed';
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('unknown');
reset role;
select ok(
  pg_temp.got('too_soon', 'reserved') = '0' and pg_temp.got('retried', 'reserved') = '1'
  and pg_temp.got('spent', 'reserved') = '0' and pg_temp.got('unknown', 'reserved') = '0'
  and (select attempts = 2 from public.client_notices)
  and (select count(*) = 2 from public.wa_messages where kind = 'template'),
  'a notice refused for a passing reason goes again as itself after its wait and while it has tries, and one that may have gone never'
);

-- ---------- What changed of a hearing ----------

-- The firm tells its clients what changes of a hearing too.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('begun_change', public.begin_notice_template('bd100000-0000-4000-8000-00000000000a', 'hearing_change',
  pg_temp.kind_text('hearing_change')));
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.record_notice_template('bd100000-0000-4000-8000-00000000000a', 'hearing_change', 'waba-a',
  pg_temp.got('begun_change', 'name'), 'APPROVED', 'UTILITY', pg_temp.kind_text('hearing_change'), null,
  'ad100000-0000-4000-8000-000000000001');
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_notice_kind('bd100000-0000-4000-8000-00000000000a', 'hearing_change', true);
reset role;

-- The message that may have gone counts as told: the hearing moves, and then is cancelled, and then put back.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_hearing(pg_temp.got('hearing', 'id')::uuid, null,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'videoconferencia', 'day', to_char(current_date + 6, 'YYYY-MM-DD'),
    'time', '16:00', 'link', 'https://sala.invalid/7'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('moved');
insert into res select 'stood', jsonb_build_object('n', count(*))
  from public.notice_candidates('bd100000-0000-4000-8000-00000000000a', null) c where c.kind = 'hearing_reminder';
reset role;
-- A change certain never to have gone out told nobody: the reminder of the new moment is due again.
update public.wa_messages m set status = 'failed', error_code = 'invalid_recipient'
from public.client_notices n where n.message_id = m.id and n.kind = 'hearing_change';
select pg_temp.as_backend();
set local role service_role;
insert into res select 'failed_change', jsonb_build_object('n', count(*))
  from public.notice_candidates('bd100000-0000-4000-8000-00000000000a', null) c
  where c.kind = 'hearing_reminder' and c.blocker is null;
reset role;
update public.wa_messages m set status = 'queued', error_code = null
from public.client_notices n where n.message_id = m.id and n.kind = 'hearing_change';
-- A change refused for a passing reason waits, stands for the reminder meanwhile, and goes again as itself.
update public.wa_messages m set status = 'failed', error_code = 'rate_limited'
from public.client_notices n where n.message_id = m.id and n.kind = 'hearing_change';
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('change_waits');
reset role;
select pg_temp.later(31);
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('change_retry');
reset role;
select pg_temp.later(60);
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_hearing_status(pg_temp.got('hearing', 'id')::uuid, 'cancelled', null, 'Redesignada pelo juízo.');
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('cancelled');
reset role;
select pg_temp.later(60);
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_hearing_status(pg_temp.got('hearing', 'id')::uuid, 'scheduled', null, null);
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('back');
select pg_temp.reserve('quiet');
reset role;
select ok(
  pg_temp.got('moved', 'reserved') = '1' and pg_temp.got('stood', 'n') = '0' and pg_temp.got('failed_change', 'n') = '1'
  and pg_temp.got('change_waits', 'reserved') = '0' and pg_temp.got('change_retry', 'reserved') = '1'
  and (select attempts = 2 from public.client_notices where kind = 'hearing_change' and occurrence like '%:moved:%')
  and pg_temp.got('cancelled', 'reserved') = '1'
  and pg_temp.got('back', 'reserved') = '1' and pg_temp.got('quiet', 'reserved') = '0'
  and (select array_agg(substring(occurrence from 'h:[0-9a-f-]+:([a-z]+)') order by reserved_at)
         = array['moved', 'cancelled', 'back']
       from public.client_notices where kind = 'hearing_change')
  and (select count(*) = 1 from public.client_notices n join public.wa_messages m on m.id = n.message_id
       where m.body like '%foi remarcada para %às 16:00%')
  and (select count(*) = 1 from public.client_notices n join public.wa_messages m on m.id = n.message_id
       where m.body like '%foi cancelada. Se uma nova data for marcada%')
  and (select count(*) = 1 from public.client_notices n join public.wa_messages m on m.id = n.message_id
       where m.body like '%foi marcada novamente para %')
  -- The change stood for the reminder of the moment it moved to: one message, never two.
  and (select count(*) = 0 from public.client_notices where kind = 'hearing_reminder' and occurrence like '%1900:week'),
  'a hearing the client was told of that moves, is cancelled or is put back is told once per change, standing for its reminder, and a change refused for a passing reason goes again'
);

-- ---------- The word on the lawsuit, and the warning against the scam ----------

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('begun_update', public.begin_notice_template('bd100000-0000-4000-8000-00000000000a', 'lawsuit_update',
  pg_temp.kind_text('lawsuit_update')));
insert into res values ('begun_alert', public.begin_notice_template('bd100000-0000-4000-8000-00000000000a', 'payment_alert',
  pg_temp.kind_text('payment_alert')));
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.record_notice_template('bd100000-0000-4000-8000-00000000000a', 'lawsuit_update', 'waba-a',
  pg_temp.got('begun_update', 'name'), 'APPROVED', 'UTILITY', pg_temp.kind_text('lawsuit_update'), null,
  'ad100000-0000-4000-8000-000000000001');
select public.record_notice_template('bd100000-0000-4000-8000-00000000000a', 'payment_alert', 'waba-a',
  pg_temp.got('begun_alert', 'name'), 'APPROVED', 'UTILITY', pg_temp.kind_text('payment_alert'), null,
  'ad100000-0000-4000-8000-000000000001');
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_notice_kind('bd100000-0000-4000-8000-00000000000a', 'lawsuit_update', true);
select public.set_notice_kind('bd100000-0000-4000-8000-00000000000a', 'payment_alert', true);
reset role;
-- Two publications of the lawsuit triaged as a payment.
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, category, triaged_by, triaged_at,
  proceeding_id, case_id) values
  ('cd100000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-00000000000a', 'avisohash00001', 'TJGO', '50004016120998090051',
   current_date, 'Intimação', 'Expeça-se alvará.', 'pagamento', 'ad100000-0000-4000-8000-000000000001', now(),
   pg_temp.got('go', 'proceeding_id')::uuid, pg_temp.got('case', 'case_id')::uuid),
  ('cd100000-0000-4000-8000-000000000002', 'bd100000-0000-4000-8000-00000000000a', 'avisohash00002', 'TJGO', '50004016120998090051',
   current_date, 'Intimação', 'Levante-se o valor.', 'pagamento', 'ad100000-0000-4000-8000-000000000001', now(),
   pg_temp.got('go', 'proceeding_id')::uuid, pg_temp.got('case', 'case_id')::uuid);
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('alerts');
insert into res select 'updates_waiting', jsonb_build_object('n', count(*)) from public.client_notices where kind = 'lawsuit_update';
reset role;
-- The client was told of the lawsuit in the last days: its word waits. Ten days later it goes (with the
-- hearings' kinds off for that moment: the hearing of the week would be reminded first, and the word would wait
-- again after it).
select pg_temp.later(14400);
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('reminders_off', public.set_notice_kind('bd100000-0000-4000-8000-00000000000a', 'hearing_reminder', false));
select public.set_notice_kind('bd100000-0000-4000-8000-00000000000a', 'hearing_change', false);
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('update');
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_notice_kind('bd100000-0000-4000-8000-00000000000a', 'hearing_reminder', true);
select public.set_notice_kind('bd100000-0000-4000-8000-00000000000a', 'hearing_change', true);
reset role;
select ok(
  pg_temp.got('alerts', 'reserved') = '1'
  and (select count(*) = 1 from public.client_notices where kind = 'payment_alert')
  and (select count(*) = 1 from public.wa_messages where body like '%nunca pede PIX, depósito, boleto ou qualquer pagamento para liberar valores%')
  and pg_temp.got('updates_waiting', 'n') = '0'
  and pg_temp.got('reminders_off', 'code') = 'off'
  and pg_temp.got('update', 'reserved') = '1'
  and (select occurrence = 'u:' || pg_temp.got('go', 'proceeding_id') || ':2' from public.client_notices where kind = 'lawsuit_update')
  and (select count(*) = 1 from public.wa_messages
       where body like '%sobre o seu processo nº 5000401-61.2099.8.09.0051: o processo segue em andamento no tribunal, e a próxima audiência de conciliação está marcada para %'),
  'one warning against the scam per lawsuit and while, and the word on a lawsuit only to who was not told of it lately'
);

-- The word named the next hearing: told of it so, the client is told when it is cancelled.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_hearing_status(pg_temp.got('hearing', 'id')::uuid, 'cancelled', null, 'Redesignada pelo juízo.');
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res select 'after_update', coalesce(jsonb_agg(c.occurrence), '[]'::jsonb)
  from public.notice_candidates('bd100000-0000-4000-8000-00000000000a', null) c where c.kind = 'hearing_change';
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_hearing_status(pg_temp.got('hearing', 'id')::uuid, 'scheduled', null, null);
reset role;
select ok(
  (select hearing_id = pg_temp.got('hearing', 'id')::uuid and about_at = (select starts_at from public.hearings
          where id = pg_temp.got('hearing', 'id')::uuid)
   from public.client_notices where kind = 'lawsuit_update')
  and (select payload = jsonb_build_array('h:' || pg_temp.got('hearing', 'id') || ':cancelled:'
         || (select id from public.client_notices where kind = 'lawsuit_update'))
       from res where name = 'after_update'),
  'a word on the lawsuit that named its next hearing counts as told of it: its cancelling is told'
);

-- ---------- What keeps a notice from going ----------

-- A ceiling of the day reached: nothing more today.
select pg_temp.setting('{"daily_max": 1}');
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('later_hearing', public.save_hearing(null, pg_temp.got('go', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'una', 'mode', 'presencial', 'day', to_char(current_date + 1, 'YYYY-MM-DD'), 'time', '15:00',
    'place', 'Fórum de Goiânia, sala 4.')));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('ceiling');
reset role;
select pg_temp.setting('{"daily_max": 250}');
-- Outside the hours of the day, nothing goes.
select pg_temp.setting(case
  when extract(hour from now() at time zone 'America/Sao_Paulo') < 23
    then jsonb_build_object('send_from_hour', extract(hour from now() at time zone 'America/Sao_Paulo')::integer + 1,
                            'same_day_from_hour', extract(hour from now() at time zone 'America/Sao_Paulo')::integer + 1)
  else '{"send_until_hour": 23}'::jsonb
end);
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('night');
reset role;
select pg_temp.setting('{"send_from_hour": 0, "send_until_hour": 24, "same_day_from_hour": 0}');
-- The person wrote SAIR.
insert into public.wa_optouts (org_id, contact_wa_id, source) values ('bd100000-0000-4000-8000-00000000000a', '5500999998888', 'keyword');
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('opted_out');
insert into res select 'opted_out_due', jsonb_agg(jsonb_build_object('kind', c.kind, 'blocker', c.blocker))
  from public.notice_candidates('bd100000-0000-4000-8000-00000000000a', null) c;
reset role;
select ok(
  pg_temp.got('ceiling', 'reserved') = '0' and pg_temp.got('ceiling', 'room') = '0'
  and pg_temp.got('night', 'reserved') = '0'
  and pg_temp.got('opted_out', 'reserved') = '0'
  and (select payload @> '[{"kind": "hearing_reminder", "blocker": "opted_out"}]'::jsonb from res where name = 'opted_out_due'),
  'nothing goes past the firm''s ceiling of the day, outside the hours of the day, nor to somebody who asked to stop'
);
delete from public.wa_optouts where org_id = 'bd100000-0000-4000-8000-00000000000a';

-- ---------- What the firm reads ----------

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('case_view', public.case_notices(pg_temp.got('case', 'case_id')::uuid));
insert into res values ('firm_view', public.firm_notices('bd100000-0000-4000-8000-00000000000a'));
insert into res values ('unwarned_ok', to_jsonb(public.firm_hearings_unwarned('bd100000-0000-4000-8000-00000000000a',
  array[pg_temp.got('later_hearing', 'id')::uuid])));
reset role;
select ok(
  (select jsonb_array_length(payload -> 'sent') = (select count(*) from public.client_notices
                                                    where org_id = 'bd100000-0000-4000-8000-00000000000a')::integer
          and payload -> 'people' -> 0 ->> 'blocker' is null
          and payload -> 'people' -> 0 -> 'optin' ->> 'source' = 'firm'
          and payload -> 'kinds_on' = '["hearing_change", "hearing_reminder", "lawsuit_update", "payment_alert"]'::jsonb
          and not (payload -> 'due' @> '[{"blocker": "kind_off"}]'::jsonb)
   from res where name = 'case_view')
  and (select (payload ->> 'last_day')::integer >= 1 and payload ->> 'daily_max' = '250' and payload ->> 'accounts' = '1'
              and jsonb_array_length(payload -> 'kinds') = 8 from res where name = 'firm_view')
  and (select payload = '[]'::jsonb from res where name = 'unwarned_ok'),
  'anybody of the firm reads the case''s people, what went and what is due, and the firm''s kinds'
);

-- The client takes the agreement back on their link: it stays on record as given, the hearings of the next days
-- will not be told, and the home says so.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('link', public.create_client_link(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('case', 'person_id')::uuid,
  encode(sha256(convert_to('token-do-cliente-0041-aaaaaaaaaaaaaaaaaaaaaaaa', 'UTF8')), 'hex')));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('withdrawn', public.client_link_set_notices('token-do-cliente-0041-aaaaaaaaaaaaaaaaaaaaaaaa', false, null, '{}'));
reset role;
set local role anon;
insert into res values ('link_notices', public.client_link_notices('token-do-cliente-0041-aaaaaaaaaaaaaaaaaaaaaaaa'));
insert into res values ('link_course', public.client_link_course('token-do-cliente-0041-aaaaaaaaaaaaaaaaaaaaaaaa'));
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('today', public.firm_today('bd100000-0000-4000-8000-00000000000a'));
insert into res values ('unwarned', to_jsonb(public.firm_hearings_unwarned('bd100000-0000-4000-8000-00000000000a',
  array[pg_temp.got('later_hearing', 'id')::uuid, pg_temp.got('hearing', 'id')::uuid])));
reset role;
select ok(
  pg_temp.got('withdrawn', 'code') = 'withdrawn'
  and (select ended_source = 'client' and ended_at is not null and wording like '%(00) 99999-8888%'
       from public.notice_optins where person_id = pg_temp.got('case', 'person_id')::uuid and source = 'firm')
  and (select payload ->> 'agreed' = 'false' and payload ->> 'phone' = '5500999998888' and payload ->> 'active' = 'true'
              and payload ->> 'wording' like 'Quero receber pelo WhatsApp, no número (00) 99999-8888, os avisos do meu processo enviados pelo escritório Souza Advogados%'
              and payload ->> 'wording' like '%alertas de segurança e pedidos para reenviar um documento recusado.%'
       from res where name = 'link_notices')
  and pg_temp.got('today', 'hearings_unwarned') = '2'
  and (select payload = to_jsonb(array[pg_temp.got('later_hearing', 'id'), pg_temp.got('hearing', 'id')])
       from res where name = 'unwarned'),
  'a client takes the agreement back on their link, kept on record, and the hearings they will not be told of are said to the firm'
);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('stale', public.client_link_set_notices('token-do-cliente-0041-aaaaaaaaaaaaaaaaaaaaaaaa', true,
  'Quero receber pelo WhatsApp os avisos, num texto que a página nunca mostrou.', '{}'));
insert into res values ('agreed', public.client_link_set_notices('token-do-cliente-0041-aaaaaaaaaaaaaaaaaaaaaaaa', true,
  pg_temp.got('link_notices', 'wording'), '{"user_agent": "Navegador de teste", "ip": "203.0.113.7", "extra": "ignorado"}'));
insert into res values ('agreed_again', public.client_link_set_notices('token-do-cliente-0041-aaaaaaaaaaaaaaaaaaaaaaaa', true,
  pg_temp.got('link_notices', 'wording'), '{}'));
reset role;
select ok(
  pg_temp.got('stale', 'code') = 'wording_changed' and pg_temp.got('agreed', 'code') = 'agreed'
  and pg_temp.got('agreed_again', 'code') = 'unchanged'
  and (select source = 'client' and link_id is not null and note is null and recorded_by is null
              and evidence = '{"ip": "203.0.113.7", "channel": "link", "user_agent": "Navegador de teste"}'::jsonb
              and wording = pg_temp.got('link_notices', 'wording')
       from public.notice_optins where person_id = pg_temp.got('case', 'person_id')::uuid and ended_at is null)
  and (select count(*) = 2 from public.notice_optins where person_id = pg_temp.got('case', 'person_id')::uuid)
  and (select count(*) = 1 from public.case_events where kind = 'notices_agreed' and actor_type = 'client'),
  'a client agrees on their link only in the words the page showed, with what the server saw of the request and nothing else'
);

-- A link is no switch to flip without end: it agrees a few times a day, and stops whenever asked.
select pg_temp.setting('{"optin_changes_per_day": 1}');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('stop', public.client_link_set_notices('token-do-cliente-0041-aaaaaaaaaaaaaaaaaaaaaaaa', false, null, '{}'));
insert into res values ('too_many', public.client_link_set_notices('token-do-cliente-0041-aaaaaaaaaaaaaaaaaaaaaaaa', true,
  pg_temp.got('link_notices', 'wording'), '{}'));
reset role;
select pg_temp.setting('{"optin_changes_per_day": 10}');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('agreed_later', public.client_link_set_notices('token-do-cliente-0041-aaaaaaaaaaaaaaaaaaaaaaaa', true,
  pg_temp.got('link_notices', 'wording'), '{}'));
reset role;
select ok(
  pg_temp.got('stop', 'code') = 'withdrawn' and pg_temp.got('too_many', 'code') = 'too_many'
  and pg_temp.got('agreed_later', 'code') = 'agreed'
  and (select count(*) = 3 from public.notice_optins where person_id = pg_temp.got('case', 'person_id')::uuid),
  'a client stops whenever they ask, and agrees again a few times a day'
);

select ok(
  (select jsonb_array_length(payload -> 'lawsuits') = 1
          and payload -> 'lawsuits' -> 0 ->> 'cnj' = '50004016120998090051'
          and payload -> 'lawsuits' -> 0 ->> 'time_zone' = 'America/Sao_Paulo'
          and payload -> 'lawsuits' -> 0 -> 'next_hearing' ->> 'place' = 'Fórum de Goiânia, sala 4.'
          and payload -> 'lawsuits' -> 0 -> 'movements' = '[]'::jsonb
   from res where name = 'link_course')
  -- A link made for a case with a lawsuit the court has lasts the longer time of the setting.
  and (select expires_at > now() + interval '170 days' from public.client_links where id = pg_temp.got('link', 'link_id')::uuid),
  'the client follows the lawsuit on their link: its number, the next hearing with how to be there, what the court registered'
);

-- ---------- What a support visit and another firm can do ----------

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('ad100000-0000-4000-8000-000000000004', 'ad100000-0000-4000-8000-000000000001', 'bd100000-0000-4000-8000-00000000000a',
        'Conferindo os avisos', 'fd100000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001', 'aal2', 'fd100000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.record_notice_optin((select id from public.cases where org_id = 'bd100000-0000-4000-8000-00000000000a' limit 1),
      (select person_id from public.case_parties where org_id = 'bd100000-0000-4000-8000-00000000000a' limit 1), false, 'Pedido por telefone.')$$,
  '42501', 'not_allowed_in_support_session', 'a support visit records no agreement');
select throws_ok(
  $$select public.set_notice_kind('bd100000-0000-4000-8000-00000000000a', 'hearing_reminder', false)$$,
  '42501', 'not_allowed_in_support_session', 'nor switches a kind');
select throws_ok(
  $$select public.begin_notice_template('bd100000-0000-4000-8000-00000000000a', 'hearing_reminder',
      (select body from public.notice_kinds where kind = 'hearing_reminder'))$$,
  '42501', 'not_allowed_in_support_session', 'nor submits a text');
reset role;

select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  (select count(*) = 0 from public.client_notices where org_id = 'bd100000-0000-4000-8000-00000000000a')
  and (select count(*) = 0 from public.notice_optins where org_id = 'bd100000-0000-4000-8000-00000000000a')
  and (select count(*) = 0 from public.firm_notice_kinds where org_id = 'bd100000-0000-4000-8000-00000000000a'),
  'firm B reads none of firm A''s notices, agreements or kinds'
);
select throws_ok($$select public.case_notices((select id from public.cases where org_id = 'bd100000-0000-4000-8000-00000000000a' limit 1))$$,
  'P0002', 'case_not_found', 'nor a case''s notices');
select throws_ok($$select public.firm_notices('bd100000-0000-4000-8000-00000000000a')$$, '42501', 'not_authorized',
  'nor the firm''s kinds');
select throws_ok($$select public.firm_hearings_unwarned('bd100000-0000-4000-8000-00000000000a', '{}')$$, '42501', 'not_authorized',
  'nor which hearings will not be told');
reset role;

select pg_temp.as_backend();
set local role service_role;
insert into res select 'firms', jsonb_agg(f.org_id) from public.notice_firms() f;
reset role;
select ok(
  (select payload = '["bd100000-0000-4000-8000-00000000000a"]'::jsonb from res where name = 'firms'),
  'the sweep reserves for the firms with a kind on, and for no other'
);

-- ---------- One phone, told once; a token the vendor refused ----------

-- Firm B: Paulo and Paula, who share the family's WhatsApp, have a lawsuit with a hearing in six days.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('paula', public.save_case_person(pg_temp.got('case_b', 'case_id')::uuid, null,
  '{"full_name": "Paula Teste", "phone": "5500999997777"}'::jsonb, 'claimant'));
insert into res values ('go_b', public.save_proceeding(pg_temp.got('case_b', 'case_id')::uuid, null,
  jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'system', 'projudi', 'comarca', 'Goiânia', 'status', 'filed',
    'cnj', '5000403-31.2099.8.09.0051', 'filed_at', to_char(current_date - 3, 'YYYY-MM-DD')),
  array[pg_temp.got('case_b', 'party_id')::uuid, pg_temp.got('paula', 'party_id')::uuid]));
insert into res values ('hearing_b', public.save_hearing(null, pg_temp.got('go_b', 'proceeding_id')::uuid,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'videoconferencia', 'day', to_char(current_date + 6, 'YYYY-MM-DD'),
    'time', '10:00', 'link', 'https://sala.invalid/8')));
select public.record_notice_optin(pg_temp.got('case_b', 'case_id')::uuid, pg_temp.got('case_b', 'person_id')::uuid, true,
  'Concordou no contrato de honorários.');
select public.record_notice_optin(pg_temp.got('case_b', 'case_id')::uuid, pg_temp.got('paula', 'person_id')::uuid, true,
  'Concordou no contrato de honorários.');
insert into res values ('begun_b', public.begin_notice_template('bd100000-0000-4000-8000-00000000000b', 'hearing_reminder',
  pg_temp.kind_text('hearing_reminder')));
insert into res values ('begun_b_change', public.begin_notice_template('bd100000-0000-4000-8000-00000000000b', 'hearing_change',
  pg_temp.kind_text('hearing_change')));
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.record_notice_template('bd100000-0000-4000-8000-00000000000b', 'hearing_reminder', 'waba-b',
  pg_temp.got('begun_b', 'name'), 'APPROVED', 'UTILITY', pg_temp.kind_text('hearing_reminder'), null,
  'ad100000-0000-4000-8000-000000000004');
select public.record_notice_template('bd100000-0000-4000-8000-00000000000b', 'hearing_change', 'waba-b',
  pg_temp.got('begun_b_change', 'name'), 'APPROVED', 'UTILITY', pg_temp.kind_text('hearing_change'), null,
  'ad100000-0000-4000-8000-000000000004');
reset role;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
select public.set_notice_kind('bd100000-0000-4000-8000-00000000000b', 'hearing_reminder', true);
select public.set_notice_kind('bd100000-0000-4000-8000-00000000000b', 'hearing_change', true);
reset role;
-- The vendor refused firm B's token: nothing goes, and no notice spends a try, until it is connected again.
update public.connections set status = 'error', last_error = 'token_invalid' where id = 'dd100000-0000-4000-8000-00000000000b';
select pg_temp.as_backend();
set local role service_role;
-- Of the kinds that are on (the lawsuit filed three days ago is due its word too, and that kind is off).
insert into res select 'failing', jsonb_build_object('n', count(*), 'all', bool_and(c.blocker = 'number_failing'))
  from public.notice_candidates('bd100000-0000-4000-8000-00000000000b', null) c where c.blocker is distinct from 'kind_off';
select pg_temp.reserve_in('failing_run', 'bd100000-0000-4000-8000-00000000000b');
reset role;
update public.connections set status = 'connected', last_error = null where id = 'dd100000-0000-4000-8000-00000000000b';
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve_in('shared', 'bd100000-0000-4000-8000-00000000000b');
select pg_temp.reserve_in('shared_again', 'bd100000-0000-4000-8000-00000000000b');
reset role;
select ok(
  pg_temp.got('failing', 'n') = '2' and pg_temp.got('failing', 'all') = 'true'
  and pg_temp.got('failing_run', 'reserved') = '0'
  and pg_temp.got('shared', 'reserved') = '1' and pg_temp.got('shared_again', 'reserved') = '0'
  and (select count(*) = 1 from public.client_notices where org_id = 'bd100000-0000-4000-8000-00000000000b')
  and (select count(*) = 1 from public.wa_messages where org_id = 'bd100000-0000-4000-8000-00000000000b' and kind = 'template'),
  'a phone a family shares is told a thing once, and nothing goes while the firm''s token is refused'
);

-- Who was told stops; the hearing moves: the relative who shares the phone, and agreed, is told of it.
insert into res select 'told_b', jsonb_build_object('person', person_id) from public.client_notices
where org_id = 'bd100000-0000-4000-8000-00000000000b' and kind = 'hearing_reminder';
select pg_temp.later(60);
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
select public.record_notice_optin(pg_temp.got('case_b', 'case_id')::uuid, pg_temp.got('told_b', 'person')::uuid, false,
  'Pediu por telefone para não receber.');
select public.save_hearing(pg_temp.got('hearing_b', 'id')::uuid, null,
  jsonb_build_object('kind', 'conciliacao', 'mode', 'videoconferencia', 'day', to_char(current_date + 6, 'YYYY-MM-DD'),
    'time', '11:00', 'link', 'https://sala.invalid/8'));
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve_in('shared_change', 'bd100000-0000-4000-8000-00000000000b');
reset role;
select ok(
  pg_temp.got('shared_change', 'reserved') = '1'
  and (select person_id <> pg_temp.got('told_b', 'person')::uuid and phone = '5500999997777'
       from public.client_notices where org_id = 'bd100000-0000-4000-8000-00000000000b' and kind = 'hearing_change'),
  'a change goes to whoever of the lawsuit still agrees at the phone that was told, once'
);

-- Firm B answers on two accounts at the vendor: which one a text would go to is not the platform's to guess.
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('dd100000-0000-4000-8000-00000000000c', 'bd100000-0000-4000-8000-00000000000b', 'whatsapp', 'waba-b2', 'WhatsApp B2', 'connected',
   'ad100000-0000-4000-8000-000000000004', now());
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number, mode) values
  ('ed100000-0000-4000-8000-00000000000c', 'bd100000-0000-4000-8000-00000000000b', 'dd100000-0000-4000-8000-00000000000c',
   'simulator', 'sim-numero-b2', 'waba-b2', '5500900000003', 'coexistence');
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('two_accounts', public.begin_notice_template('bd100000-0000-4000-8000-00000000000b', 'hearing_reminder',
  pg_temp.kind_text('hearing_reminder')));
reset role;
select is(pg_temp.got('two_accounts', 'code'), 'several_accounts',
  'a firm with two accounts at the vendor is told so, and nothing is submitted');

-- ---------- A new text, who is told of a minor's lawsuit, and a number that changed ----------

-- A new text of a kind that is on goes to the vendor: the one before goes on until the new one is approved.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('resubmitted', public.record_notice_template('bd100000-0000-4000-8000-00000000000a', 'payment_alert',
  'waba-a', 'one_alerta_seguranca_2', 'PENDING', 'UTILITY', pg_temp.kind_text('payment_alert'), null,
  'ad100000-0000-4000-8000-000000000001'));
reset role;
insert into res select 'while_waiting', to_jsonb(k) from public.firm_notice_kinds k
where k.org_id = 'bd100000-0000-4000-8000-00000000000a' and k.kind = 'payment_alert';
update public.wa_templates set status = 'approved' where org_id = 'bd100000-0000-4000-8000-00000000000a' and name = 'one_alerta_seguranca_2';
select ok(
  pg_temp.got('resubmitted', 'waiting') = 'true'
  and pg_temp.got('while_waiting', 'enabled') = 'true'
  and pg_temp.got('while_waiting', 'template_id') <> pg_temp.got('resubmitted', 'template_id')
  and pg_temp.got('while_waiting', 'pending_template_id') = pg_temp.got('resubmitted', 'template_id')
  and (select enabled and template_id = pg_temp.got('resubmitted', 'template_id')::uuid and pending_template_id is null
       from public.firm_notice_kinds where org_id = 'bd100000-0000-4000-8000-00000000000a' and kind = 'payment_alert')
  and (select count(*) = 1 from public.audit_events where action = 'notices.template_in_use'),
  'a new text of a kind that is on waits for the vendor while the one before is used, and takes its place once approved'
);

-- Maria answers for her daughter, who flew with her: the daughter's lawsuit is told to Maria, never to the child.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('guardian', public.save_case_person(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, '{}'::jsonb, 'guardian'));
insert into res values ('minor', public.save_case_person(pg_temp.got('case', 'case_id')::uuid, null,
  '{"full_name": "Lia Teste da Silva", "birth_date": "2016-05-04", "phone": "5500999996666"}'::jsonb, 'claimant',
  pg_temp.got('guardian', 'party_id')::uuid));
insert into res values ('comum', public.save_proceeding(pg_temp.got('case', 'case_id')::uuid, null,
  jsonb_build_object('kind', 'comum', 'court', 'TJGO', 'system', 'projudi', 'comarca', 'Goiânia', 'status', 'filed',
    'cnj', '5000402-46.2099.8.09.0051', 'filed_at', to_char(current_date - 40, 'YYYY-MM-DD')),
  array[pg_temp.got('minor', 'party_id')::uuid]));
reset role;
select ok(
  (select array_agg(person_id) = array[pg_temp.got('case', 'person_id')::uuid]
   from public.notice_recipients(pg_temp.got('comum', 'proceeding_id')::uuid))
  and (select array_agg(person_id) = array[pg_temp.got('case', 'person_id')::uuid]
       from public.notice_recipients(pg_temp.got('go', 'proceeding_id')::uuid))
  and (select count(*) = 0 from public.notice_candidates('bd100000-0000-4000-8000-00000000000a', null) c
       where c.person_id = pg_temp.got('minor', 'person_id')::uuid),
  'a minor''s lawsuit is told to who answers for them, never to the child'
);

-- A mobile is the same person's with or without its ninth digit: one who wrote SAIR from it is not told.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('joana', public.save_case_person(pg_temp.got('case', 'case_id')::uuid, null,
  '{"full_name": "Joana Teste Lima", "phone": "5562999990077"}'::jsonb, 'claimant'));
select public.record_notice_optin(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('joana', 'person_id')::uuid, true,
  'Concordou por mensagem no WhatsApp.');
reset role;
insert into public.wa_optouts (org_id, contact_wa_id, source) values ('bd100000-0000-4000-8000-00000000000a', '556299990077', 'keyword');
select ok(
  public.wa_phone_variants('5562999990077') = array['5562999990077', '556299990077']
  and public.notice_person_blocker('bd100000-0000-4000-8000-00000000000a', pg_temp.got('joana', 'person_id')::uuid) = 'opted_out',
  'a mobile is found with and without its ninth digit, and who asked to stop from either is not told'
);

-- Maria's number changed: what she agreed to was for the old one.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.save_case_person(pg_temp.got('case', 'case_id')::uuid, pg_temp.got('case', 'person_id')::uuid,
  '{"phone": "5500999995555"}'::jsonb);
reset role;
insert into res values ('new_number', jsonb_build_object('blocker',
  public.notice_person_blocker('bd100000-0000-4000-8000-00000000000a', pg_temp.got('case', 'person_id')::uuid)));
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('optin_new_number', public.record_notice_optin(pg_temp.got('case', 'case_id')::uuid,
  pg_temp.got('case', 'person_id')::uuid, true, 'Confirmou o número novo por telefone.'));
reset role;
select ok(
  pg_temp.got('new_number', 'blocker') = 'no_optin' and pg_temp.got('optin_new_number', 'code') = 'recorded'
  and (select phone = '5500999995555' and source = 'firm'
       from public.notice_optins where person_id = pg_temp.got('case', 'person_id')::uuid and ended_at is null)
  and (select count(*) = 4 from public.notice_optins where person_id = pg_temp.got('case', 'person_id')::uuid)
  and (select count(*) = 1 from public.notice_optins
       where person_id = pg_temp.got('case', 'person_id')::uuid and ended_source = 'replaced' and phone = '5500999998888'),
  'an agreement is for its number: another number asks for another, and the one before stays on record as replaced'
);

-- ---------- The words of a hearing, and the earlier hour of its day ----------

select ok(
  char_length(public.notice_how_words('hibrida', repeat('Sala ', 30), 'https://sala.invalid/' || repeat('b', 359))) <= 500
  and public.notice_how_words('hibrida', repeat('Sala ', 30), 'https://sala.invalid/' || repeat('b', 359))
      like '%pelo link https://sala.invalid/' || repeat('b', 359) || '. Fale com o escritório para confirmar o endereço.'
  and public.notice_how_words('videoconferencia', null, 'https://sala.invalid/' || repeat('c', 470))
      = 'Ela será por videoconferência. Fale com o escritório para receber o link de acesso.',
  'a link too long for a value is never cut: the place gives way, or the client is told to ask the firm'
);

-- The earlier hour is for what is about a hearing of the morning of that very day.
select pg_temp.setting('{"send_from_hour": 8}');
select ok(
  public.notice_early((((now() at time zone 'America/Sao_Paulo')::date + time '09:00') at time zone 'America/Sao_Paulo'),
                      'America/Sao_Paulo')
  and not public.notice_early((((now() at time zone 'America/Sao_Paulo')::date + time '16:00') at time zone 'America/Sao_Paulo'),
                              'America/Sao_Paulo')
  and not public.notice_early((((now() at time zone 'America/Sao_Paulo')::date + 1 + time '09:00') at time zone 'America/Sao_Paulo'),
                              'America/Sao_Paulo')
  and not public.notice_early(null, 'America/Sao_Paulo'),
  'the reminder of a hearing''s own day may go from the earlier hour only when the usual hours would not reach it'
);
select pg_temp.setting('{"send_from_hour": 0}');

-- What counts as told: what went or may have gone, and a passing refusal while its tries may last.
select ok(
  public.notice_told('delivered', null, 1, now() - interval '40 days')
  and public.notice_told('failed', 'unconfirmed', 1, now() - interval '40 days')
  and public.notice_told('failed', 'rate_limited', 1, now())
  and public.notice_told('failed', 'vault_unavailable', 1, now())
  and not public.notice_told('failed', 'rate_limited', 1, now() - interval '2 days')
  and not public.notice_told('failed', 'rate_limited', 5, now())
  and not public.notice_told('failed', 'invalid_recipient', 1, now()),
  'a refusal for a passing reason counts as told while its tries may last, and one that said it never went counts as nothing'
);

-- The vendor calls a notice's template marketing: the notice stops, and the screen says why.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('recategorized', public.wa_set_template_category('simulator', 'waba-a', 'one_lembrete_audiencia_1',
  'pt_BR', 'MARKETING'));
insert into res values ('category_ignored', public.wa_set_template_category('simulator', 'waba-a', 'one_lembrete_audiencia_1',
  'pt_BR', 'PROMOCIONAL'));
reset role;
select ok(
  pg_temp.got('recategorized', 'changed') = '1' and pg_temp.got('category_ignored', 'code') = 'ignored'
  and (select blocker = 'template_unusable' from public.notice_kind_route('bd100000-0000-4000-8000-00000000000a', 'hearing_reminder')),
  'a template the vendor calls marketing no longer carries a notice'
);

-- A word on the lawsuit tried again names the hearing as it is then; and it waits while the room left is the room
-- kept for what is about a hearing.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_notice_kind('bd100000-0000-4000-8000-00000000000a', 'hearing_change', false);
select public.set_notice_kind('bd100000-0000-4000-8000-00000000000a', 'payment_alert', false);
reset role;
update public.wa_messages m set status = 'failed', error_code = 'rate_limited'
from public.client_notices n where n.message_id = m.id and n.kind = 'lawsuit_update';
update public.client_notices set reserved_at = reserved_at - interval '31 minutes' where kind = 'lawsuit_update';
select pg_temp.setting('{"urgent_room": 250}');
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('update_held');
reset role;
select pg_temp.setting('{"urgent_room": 0}');
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('update_retry');
reset role;
select ok(
  pg_temp.got('update_held', 'reserved') = '0'
  -- The word on Maria's lawsuit, tried again, and the first word on her daughter's.
  and pg_temp.got('update_retry', 'reserved') = '2'
  and (select attempts = 2 and phone = '5500999995555' and hearing_id = pg_temp.got('later_hearing', 'id')::uuid
              and about_at = (select starts_at from public.hearings where id = pg_temp.got('later_hearing', 'id')::uuid)
       from public.client_notices where kind = 'lawsuit_update' and proceeding_id = pg_temp.got('go', 'proceeding_id')::uuid)
  and (select m.body like '%próxima audiência de conciliação, instrução e julgamento está marcada para %às 15:00%'
       from public.client_notices n join public.wa_messages m on m.id = n.message_id
       where n.kind = 'lawsuit_update' and n.proceeding_id = pg_temp.got('go', 'proceeding_id')::uuid),
  'a word on the lawsuit goes again naming the next hearing as it is then, and only while room is left beyond what hearings keep'
);

-- ---------- A document refused: the client is asked for it again ----------

-- Firm A submits the kind's text, the vendor approves it, and who manages the firm switches it on.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('doc_begun', public.begin_notice_template('bd100000-0000-4000-8000-00000000000a', 'document_refused',
  pg_temp.kind_text('document_refused')));
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.record_notice_template('bd100000-0000-4000-8000-00000000000a', 'document_refused', 'waba-a',
  pg_temp.got('doc_begun', 'name'), 'APPROVED', 'UTILITY', pg_temp.kind_text('document_refused'), null,
  'ad100000-0000-4000-8000-000000000001');
reset role;
-- A case still gathering papers: Rita, who agreed to be told, and her son Caio, a minor she answers for.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('doc_on', public.set_notice_kind('bd100000-0000-4000-8000-00000000000a', 'document_refused', true));
insert into res values ('doc_case', public.create_case('bd100000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-02-10',
  '{"full_name": "RITA TESTE", "birth_date": "1980-03-03", "phone": "5500999994444"}'::jsonb));
insert into res values ('rita_guardian', public.save_case_person(pg_temp.got('doc_case', 'case_id')::uuid,
  pg_temp.got('doc_case', 'person_id')::uuid, '{}'::jsonb, 'guardian'));
insert into res values ('caio', public.save_case_person(pg_temp.got('doc_case', 'case_id')::uuid, null,
  '{"full_name": "Caio Teste", "birth_date": "2015-07-07"}'::jsonb, 'claimant', pg_temp.got('rita_guardian', 'party_id')::uuid));
select public.record_notice_optin(pg_temp.got('doc_case', 'case_id')::uuid, pg_temp.got('doc_case', 'person_id')::uuid, true,
  'Concordou no contrato de honorários.');
reset role;
-- Her papers, as the firm received them.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('f1', public.reserve_file('bd100000-0000-4000-8000-00000000000a', 'client', 'endereco.jpg', 'image/jpeg', 3000, null));
insert into res values ('f2', public.reserve_file('bd100000-0000-4000-8000-00000000000a', 'client', 'caio.jpg', 'image/jpeg', 3000, null));
insert into res values ('f3', public.reserve_file('bd100000-0000-4000-8000-00000000000a', 'client', 'bilhete.pdf', 'application/pdf', 3000, null));
insert into res values ('f4', public.reserve_file('bd100000-0000-4000-8000-00000000000a', 'client', 'cartao.pdf', 'application/pdf', 3000, null));
insert into res values ('f5', public.reserve_file('bd100000-0000-4000-8000-00000000000a', 'client', 'rg.exe', 'image/jpeg', 3000, null));
insert into res values ('f6', public.reserve_file('bd100000-0000-4000-8000-00000000000a', 'client', 'rg-rita.jpg', 'image/jpeg', 3000, null));
insert into res values ('f7', public.reserve_file('bd100000-0000-4000-8000-00000000000a', 'client', 'rg-antigo.jpg', 'image/jpeg', 3000, null));
select public.confirm_file(pg_temp.got('f1', 'file_id')::uuid, repeat('1', 64), 3000, 'image/jpeg', null);
select public.confirm_file(pg_temp.got('f2', 'file_id')::uuid, repeat('2', 64), 3000, 'image/jpeg', null);
select public.confirm_file(pg_temp.got('f3', 'file_id')::uuid, repeat('3', 64), 3000, 'application/pdf', 1);
select public.confirm_file(pg_temp.got('f4', 'file_id')::uuid, repeat('4', 64), 3000, 'application/pdf', 1);
select public.confirm_file(pg_temp.got('f5', 'file_id')::uuid, repeat('5', 64), 3000, 'image/jpeg', null);
select public.confirm_file(pg_temp.got('f6', 'file_id')::uuid, repeat('6', 64), 3000, 'image/jpeg', null);
select public.confirm_file(pg_temp.got('f7', 'file_id')::uuid, repeat('7', 64), 3000, 'image/jpeg', null);
reset role;
insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status) values
  ('cd100000-0000-4000-8000-0000000000d1', 'bd100000-0000-4000-8000-00000000000a', pg_temp.got('doc_case', 'case_id')::uuid,
   pg_temp.got('doc_case', 'party_id')::uuid, pg_temp.got('f1', 'file_id')::uuid, 'address_proof', 'firm', 'received'),
  ('cd100000-0000-4000-8000-0000000000d2', 'bd100000-0000-4000-8000-00000000000a', pg_temp.got('doc_case', 'case_id')::uuid,
   pg_temp.got('caio', 'party_id')::uuid, pg_temp.got('f2', 'file_id')::uuid, 'identity', 'firm', 'received'),
  ('cd100000-0000-4000-8000-0000000000d3', 'bd100000-0000-4000-8000-00000000000a', pg_temp.got('doc_case', 'case_id')::uuid,
   null, pg_temp.got('f3', 'file_id')::uuid, 'ticket', 'firm', 'received');
-- A person refuses Rita's proof of address and the ticket; ONE's check refuses Caio's identity.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('refused_address', public.decide_case_document('cd100000-0000-4000-8000-0000000000d1', 'rejected',
  'A foto ficou desfocada e o endereço não pode ser lido.'));
select public.decide_case_document('cd100000-0000-4000-8000-0000000000d3', 'rejected', 'O bilhete está cortado.');
reset role;
update public.case_documents
-- Written by a model, with a dash and an exclamation a message to a client does not keep.
set status = 'rejected', rejected_reason = 'O documento enviado não é de identidade — envie a certidão de nascimento de Caio!',
    decided_at = now()
where id = 'cd100000-0000-4000-8000-0000000000d2';
-- The boarding pass came after the ticket was refused: the trip's paper is answered. An upload the backend refused
-- on its bytes is nobody's decision.
insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status, rejected_reason) values
  ('cd100000-0000-4000-8000-0000000000d4', 'bd100000-0000-4000-8000-00000000000a', pg_temp.got('doc_case', 'case_id')::uuid,
   null, pg_temp.got('f4', 'file_id')::uuid, 'boarding_pass', 'firm', 'received', null),
  ('cd100000-0000-4000-8000-0000000000d5', 'bd100000-0000-4000-8000-00000000000a', pg_temp.got('doc_case', 'case_id')::uuid,
   pg_temp.got('doc_case', 'party_id')::uuid, pg_temp.got('f5', 'file_id')::uuid, 'identity', 'client', 'rejected',
   'unsupported_type');
-- The identity of somebody taken out of the case, refused: a person's own paper with no party asks nobody else.
insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status, rejected_reason, decided_at)
values ('cd100000-0000-4000-8000-0000000000d7', 'bd100000-0000-4000-8000-00000000000a', pg_temp.got('doc_case', 'case_id')::uuid,
        null, pg_temp.got('f7', 'file_id')::uuid, 'identity', 'firm', 'rejected', 'A foto está escura.', now());
select pg_temp.setting('{"daily_max": 250, "urgent_room": 0}');
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('doc_run');
select pg_temp.reserve('doc_again');
reset role;
select ok(
  pg_temp.got('doc_on', 'code') = 'on' and pg_temp.got('refused_address', 'ok') = 'true'
  and (select count(*) = 2 from public.client_notices where kind = 'document_refused')
  and (select n.person_id = pg_temp.got('doc_case', 'person_id')::uuid and n.phone = '5500999994444'
              and n.params = to_jsonb(array['Rita', 'Souza Advogados',
                                            'o comprovante de endereço, enviado em '
                                              || to_char(now() at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'),
                                            'A foto ficou desfocada e o endereço não pode ser lido'])
       from public.client_notices n
       where n.kind = 'document_refused' and n.document_id = 'cd100000-0000-4000-8000-0000000000d1')
  and (select n.person_id = pg_temp.got('doc_case', 'person_id')::uuid
              and m.body like '%envie de novo o documento de identidade de Caio, enviado em %. Motivo: O documento enviado não é de identidade, envie a certidão de nascimento de Caio. Você pode enviar pelo link%'
       from public.client_notices n join public.wa_messages m on m.id = n.message_id
       where n.kind = 'document_refused' and n.document_id = 'cd100000-0000-4000-8000-0000000000d2')
  and pg_temp.got('doc_again', 'reserved') = '0',
  'a document the firm refused is asked for again, with its reason, to who it is of or who answers for the child, once'
);

-- Rita sends her identity, which a person refuses after the case no longer takes papers on the link.
insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status) values
  ('cd100000-0000-4000-8000-0000000000d6', 'bd100000-0000-4000-8000-00000000000a', pg_temp.got('doc_case', 'case_id')::uuid,
   pg_temp.got('doc_case', 'party_id')::uuid, pg_temp.got('f6', 'file_id')::uuid, 'identity', 'firm', 'received');
update public.cases set status = 'drafting' where id = pg_temp.got('doc_case', 'case_id')::uuid;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
select public.decide_case_document('cd100000-0000-4000-8000-0000000000d6', 'rejected', 'A foto está escura.');
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res select 'doc_due', coalesce(jsonb_agg(c.document_id), '[]'::jsonb)
  from public.notice_candidates('bd100000-0000-4000-8000-00000000000a', pg_temp.got('doc_case', 'case_id')::uuid) c
  where c.kind = 'document_refused';
reset role;
select ok(
  (select payload = '[]'::jsonb from res where name = 'doc_due')
  and not exists (select 1 from public.client_notices
                  where document_id in ('cd100000-0000-4000-8000-0000000000d3', 'cd100000-0000-4000-8000-0000000000d5',
                                        'cd100000-0000-4000-8000-0000000000d6', 'cd100000-0000-4000-8000-0000000000d7'))
  and public.case_document_owed('cd100000-0000-4000-8000-0000000000d1')
  and not public.case_document_owed('cd100000-0000-4000-8000-0000000000d3'),
  'a paper another answered, a file refused on its bytes, a person''s own paper left with no party, and a case that no longer takes papers ask nothing of the client'
);

-- Bruno flew too, sent a receipt through his own link, and was taken out of the case before a person refused it:
-- nobody is asked for it, neither he nor anybody in his place.
update public.cases set status = 'documents' where id = pg_temp.got('doc_case', 'case_id')::uuid;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('bruno', public.save_case_person(pg_temp.got('doc_case', 'case_id')::uuid, null,
  '{"full_name": "Bruno Teste", "birth_date": "1982-02-02", "phone": "5500999993333"}'::jsonb, 'claimant'));
select public.record_notice_optin(pg_temp.got('doc_case', 'case_id')::uuid, pg_temp.got('bruno', 'person_id')::uuid, true,
  'Concordou no contrato de honorários.');
insert into res values ('bruno_link', public.create_client_link(pg_temp.got('doc_case', 'case_id')::uuid,
  pg_temp.got('bruno', 'person_id')::uuid, encode(sha256(convert_to('token-do-bruno-0041-bbbbbbbbbbbbbbbbbbbbbbbb', 'UTF8')), 'hex')));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('f8', public.reserve_file('bd100000-0000-4000-8000-00000000000a', 'client', 'taxi.jpg', 'image/jpeg', 3000, null));
insert into res values ('f9', public.reserve_file('bd100000-0000-4000-8000-00000000000a', 'client', 'recibo.jpg', 'image/jpeg', 3000, null));
insert into res values ('f10', public.reserve_file('bd100000-0000-4000-8000-00000000000a', 'client', 'hotel.jpg', 'image/jpeg', 3000, null));
insert into res values ('f11', public.reserve_file('bd100000-0000-4000-8000-00000000000a', 'client', 'jantar.jpg', 'image/jpeg', 3000, null));
select public.confirm_file(pg_temp.got('f8', 'file_id')::uuid, repeat('8', 64), 3000, 'image/jpeg', null);
select public.confirm_file(pg_temp.got('f9', 'file_id')::uuid, repeat('9', 64), 3000, 'image/jpeg', null);
select public.confirm_file(pg_temp.got('f10', 'file_id')::uuid, repeat('a', 64), 3000, 'image/jpeg', null);
select public.confirm_file(pg_temp.got('f11', 'file_id')::uuid, repeat('b', 64), 3000, 'image/jpeg', null);
reset role;
insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, link_id, status) values
  ('cd100000-0000-4000-8000-0000000000d8', 'bd100000-0000-4000-8000-00000000000a', pg_temp.got('doc_case', 'case_id')::uuid,
   pg_temp.got('bruno', 'party_id')::uuid, pg_temp.got('f9', 'file_id')::uuid, 'receipt', 'client',
   pg_temp.got('bruno_link', 'link_id')::uuid, 'received');
-- Rita's taxi, hotel and dinner receipts, in that order: the taxi is refused after the other two arrived.
insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status, created_at) values
  ('cd100000-0000-4000-8000-0000000000d9', 'bd100000-0000-4000-8000-00000000000a', pg_temp.got('doc_case', 'case_id')::uuid,
   pg_temp.got('doc_case', 'party_id')::uuid, pg_temp.got('f8', 'file_id')::uuid, 'receipt', 'firm', 'received',
   now() - interval '3 minutes'),
  ('cd100000-0000-4000-8000-0000000000da', 'bd100000-0000-4000-8000-00000000000a', pg_temp.got('doc_case', 'case_id')::uuid,
   pg_temp.got('doc_case', 'party_id')::uuid, pg_temp.got('f10', 'file_id')::uuid, 'receipt', 'firm', 'accepted',
   now() - interval '2 minutes'),
  ('cd100000-0000-4000-8000-0000000000db', 'bd100000-0000-4000-8000-00000000000a', pg_temp.got('doc_case', 'case_id')::uuid,
   pg_temp.got('doc_case', 'party_id')::uuid, pg_temp.got('f11', 'file_id')::uuid, 'receipt', 'firm', 'received',
   now() - interval '1 minute');
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('bruno_out', public.remove_case_party(pg_temp.got('bruno', 'party_id')::uuid));
select public.decide_case_document('cd100000-0000-4000-8000-0000000000d8', 'rejected', 'O recibo está ilegível.');
select public.decide_case_document('cd100000-0000-4000-8000-0000000000d9', 'rejected', 'O valor do recibo não aparece.');
reset role;
select pg_temp.as_backend();
set local role service_role;
select pg_temp.reserve('receipts');
reset role;
select ok(
  pg_temp.got('bruno_out', 'ok') = 'true'
  and public.document_recipient('cd100000-0000-4000-8000-0000000000d8') is null
  and not exists (select 1 from public.client_notices where document_id = 'cd100000-0000-4000-8000-0000000000d8')
  and (select n.person_id = pg_temp.got('doc_case', 'person_id')::uuid
              and n.params ->> 2 = 'o comprovante de gastos, enviado em '
                                   || to_char((now() - interval '3 minutes') at time zone 'America/Sao_Paulo', 'DD/MM/YYYY')
       from public.client_notices n where n.document_id = 'cd100000-0000-4000-8000-0000000000d9'),
  'a receipt is asked for again though others of its kind came before its refusal, and nobody is asked for the paper of somebody taken out of the case'
);

-- Lúcia answers for her son, the case's only claimant: the ticket the firm added and refused is asked of her.
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('lucia_case', public.create_case('bd100000-0000-4000-8000-00000000000a', 'delay', 'AD', date '2026-03-03',
  '{"full_name": "Lúcia Teste", "birth_date": "1979-09-09", "phone": "5500999992222"}'::jsonb));
reset role;
update public.case_parties set role = 'guardian' where id = pg_temp.got('lucia_case', 'party_id')::uuid;
select pg_temp.sign_in('ad100000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('lucia_son', public.save_case_person(pg_temp.got('lucia_case', 'case_id')::uuid, null,
  '{"full_name": "Davi Teste", "birth_date": "2014-04-04"}'::jsonb, 'claimant', pg_temp.got('lucia_case', 'party_id')::uuid));
select public.record_notice_optin(pg_temp.got('lucia_case', 'case_id')::uuid, pg_temp.got('lucia_case', 'person_id')::uuid, true,
  'Concordou no contrato de honorários.');
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('f12', public.reserve_file('bd100000-0000-4000-8000-00000000000a', 'client', 'passagem.pdf', 'application/pdf', 3000, null));
select public.confirm_file(pg_temp.got('f12', 'file_id')::uuid, repeat('c', 64), 3000, 'application/pdf', 1);
reset role;
insert into public.case_documents (id, org_id, case_id, party_id, file_id, kind, source, status, rejected_reason, decided_at)
values ('cd100000-0000-4000-8000-0000000000dc', 'bd100000-0000-4000-8000-00000000000a', pg_temp.got('lucia_case', 'case_id')::uuid,
        null, pg_temp.got('f12', 'file_id')::uuid, 'ticket', 'whatsapp', 'rejected', 'O bilhete não mostra o voo.', now());
select ok(
  public.document_recipient('cd100000-0000-4000-8000-0000000000dc') = pg_temp.got('lucia_case', 'person_id')::uuid
  and exists (select 1 from public.notice_candidates('bd100000-0000-4000-8000-00000000000a',
                                                    pg_temp.got('lucia_case', 'case_id')::uuid) c
              where c.document_id = 'cd100000-0000-4000-8000-0000000000dc'
                and c.person_id = pg_temp.got('lucia_case', 'person_id')::uuid and c.blocker is null),
  'a paper of the trip of a case whose claimants are minors is asked of who answers for them'
);

select * from finish();
rollback;
