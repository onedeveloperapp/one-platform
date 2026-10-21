begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

-- ============================================================
-- What a firm still has to set up, and what needs somebody today (0020).
--
-- Both are computed from the facts on every call: a step of the setup is done
-- when the thing exists, and the home counts what is waiting now, for the
-- person who asks. Two firms: what one has in place or waiting never shows in
-- the other's answer.
--
-- Every person, firm, number and message here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('aa000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('aa000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bruno@souza.invalid', '', now(), '{}', '{"display_name":"Bruno Lima"}', now(), now()),
  ('aa000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('aa000000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'sem-escritorio@teste.invalid', '', now(), '{}', '{"display_name":"Sem Escritório"}', now(), now());

-- Firm A starts with its owner alone. Firm B has nothing but its owner either.
insert into public.organizations (id, name, slug, created_by) values
  ('ba000000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'aa000000-0000-4000-8000-000000000001'),
  ('ba000000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'aa000000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('ba000000-0000-4000-8000-00000000000a', 'aa000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('ba000000-0000-4000-8000-00000000000b', 'aa000000-0000-4000-8000-000000000004', 'owner', 'advogado');

create function pg_temp.sign_in(who uuid) returns void language sql as
$$
  select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true);
$$;

-- Asks as a person, then leaves the session as it was: the fixtures below are written with no person signed in.
create function pg_temp.facts(who uuid, org uuid) returns jsonb language plpgsql as
$$
declare
  answer jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  answer := public.firm_setup_facts(org);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return answer;
end;
$$;

create function pg_temp.today(who uuid, org uuid) returns jsonb language plpgsql as
$$
declare
  answer jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  answer := public.firm_today(org);
  reset role;
  perform set_config('request.jwt.claims', '', true);
  return answer;
end;
$$;

-- ---------- The setup, from facts ----------

select is(
  pg_temp.facts('aa000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-00000000000a'),
  '{"firm_document": false, "oab": false, "team": false, "whatsapp": false}'::jsonb,
  'a firm that was just founded has nothing in place'
);

update public.organizations set billing_cpf_cnpj = '11222333000181' where id = 'ba000000-0000-4000-8000-00000000000a';
select is(
  pg_temp.facts('aa000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-00000000000a') ->> 'firm_document',
  'true', 'the firm''s document is in place once it is recorded'
);

insert into public.oab_registrations (user_id, uf, number, kind) values
  ('aa000000-0000-4000-8000-000000000001', 'GO', '1001', 'principal');
select is(
  pg_temp.facts('aa000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-00000000000a') ->> 'oab',
  'true', 'a registration at the bar of anybody of the firm counts'
);

-- An invitation that waits counts as the team being formed; one that was revoked or expired does not.
insert into public.firm_invitations (id, org_id, email, firm_function, token_hash, expires_at, revoked_at) values
  ('ca000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-00000000000a', 'revogado@souza.invalid', 'advogado', repeat('1', 64), now() + interval '7 days', now()),
  ('ca000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-00000000000a', 'vencido@souza.invalid', 'advogado', repeat('2', 64), now() - interval '1 day', null);
select is(
  pg_temp.facts('aa000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-00000000000a') ->> 'team',
  'false', 'an invitation that was revoked or expired forms no team'
);
insert into public.firm_invitations (org_id, email, firm_function, token_hash, expires_at) values
  ('ba000000-0000-4000-8000-00000000000a', 'bruno@souza.invalid', 'atendimento', repeat('3', 64), now() + interval '7 days');
select is(
  pg_temp.facts('aa000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-00000000000a') ->> 'team',
  'true', 'an invitation that waits does'
);
delete from public.firm_invitations where org_id = 'ba000000-0000-4000-8000-00000000000a';
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('ba000000-0000-4000-8000-00000000000a', 'aa000000-0000-4000-8000-000000000002', 'member', 'atendimento');
select is(
  pg_temp.facts('aa000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-00000000000a') ->> 'team',
  'true', 'and so does a second person, who may ask too'
);

insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('da000000-0000-4000-8000-00000000000a', 'ba000000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-a', 'WhatsApp A', 'connected', 'aa000000-0000-4000-8000-000000000001', now()),
  ('da000000-0000-4000-8000-00000000000b', 'ba000000-0000-4000-8000-00000000000b', 'whatsapp', 'waba-b', 'WhatsApp B', 'connected', 'aa000000-0000-4000-8000-000000000004', now());
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number) values
  ('ea000000-0000-4000-8000-00000000000a', 'ba000000-0000-4000-8000-00000000000a', 'da000000-0000-4000-8000-00000000000a', 'simulator', 'sim-a', 'waba-a', '5562900000001');

select is(
  pg_temp.facts('aa000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-00000000000a'),
  '{"firm_document": true, "oab": true, "team": true, "whatsapp": true}'::jsonb,
  'with a connected number the firm has everything in place'
);
select is(
  pg_temp.facts('aa000000-0000-4000-8000-000000000004', 'ba000000-0000-4000-8000-00000000000b'),
  '{"firm_document": false, "oab": false, "team": false, "whatsapp": false}'::jsonb,
  'and nothing of it shows in the other firm''s answer'
);

select pg_temp.sign_in('aa000000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.firm_setup_facts('ba000000-0000-4000-8000-00000000000a')$$,
  '42501', null, 'somebody of another firm does not ask what a firm has in place'
);
select throws_ok(
  $$select public.firm_today('ba000000-0000-4000-8000-00000000000a')$$,
  '42501', null, 'nor what needs somebody in it'
);
reset role;
select set_config('request.jwt.claims', '', true);

-- ---------- What needs somebody today ----------

select is(
  pg_temp.today('aa000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-00000000000a'),
  '{"approvals_mine": 0, "approvals_waiting": 0, "conversations_waiting": 0, "conversations_closing": 0, "sends_failed": 0, "whatsapp": "active", "documents_to_review": 0, "clients_finished": 0, "chronologies_contested": 0, "complaints_overdue": 0, "filings_ready": 0, "drafts_waiting": 0, "publications_new": 0, "publications_cancelled": 0, "djen_late": 0, "djen_incomplete": 0, "djen_stopped": 0, "movements_new": 0, "tracking_failed": 0, "deadlines_to_confirm": 0, "deadlines_soon": 0, "deadlines_overdue": 0, "deadlines_review": 0, "publications_without_deadline": 0, "publications_without_hearing": 0, "publications_to_review": 0, "hearings_soon": 0, "hearings_unresolved": 0, "calendar_lost": 0, "hearings_unwarned": 0, "civil_court_declined": 0}'::jsonb,
  'a firm with nothing waiting says so'
);

-- Two answers of the AI wait in firm A: one for the partners and lawyers, one for whoever attends. One waits in firm B.
insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, status, output, finished_at)
select run.run_id, run.org_id, 'plataforma.verificacao', version.id, version.provider, version.model,
       repeat('a', 64), 'succeeded', '{"resposta": "teste"}'::jsonb, now()
from (values
  ('fa000000-0000-4000-8000-000000000001'::uuid, 'ba000000-0000-4000-8000-00000000000a'::uuid),
  ('fa000000-0000-4000-8000-000000000002'::uuid, 'ba000000-0000-4000-8000-00000000000a'::uuid),
  ('fa000000-0000-4000-8000-000000000003'::uuid, 'ba000000-0000-4000-8000-00000000000b'::uuid)
) as run (run_id, org_id)
cross join (
  select id, provider, model from public.prompt_versions where task = 'plataforma.verificacao' and is_active
) as version;
insert into public.approvals (org_id, run_id, task, approver_functions) values
  ('ba000000-0000-4000-8000-00000000000a', 'fa000000-0000-4000-8000-000000000001', 'plataforma.verificacao', array['socio', 'advogado']::public.firm_function[]),
  ('ba000000-0000-4000-8000-00000000000a', 'fa000000-0000-4000-8000-000000000002', 'plataforma.verificacao', array['atendimento']::public.firm_function[]),
  ('ba000000-0000-4000-8000-00000000000b', 'fa000000-0000-4000-8000-000000000003', 'plataforma.verificacao', array['socio', 'advogado']::public.firm_function[]);

-- Five conversations in firm A:
--   Maria wrote 22 hours ago and nobody answered: waiting, and its window closes in two hours;
--   João wrote an hour ago: waiting, with time to spare;
--   Carla wrote two days ago: waiting, and only a template reaches her now;
--   Pedro was answered: not waiting. The answer to him failed an hour ago; an older one failed two days ago;
--   Rita's conversation came with the history of the number, from before it was connected: her last
--   word is hers, and it waits for nobody, because it never opened a window to answer in.
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, last_inbound_at, last_message_at, last_message_direction) values
  ('0a000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-00000000000a', 'ea000000-0000-4000-8000-00000000000a', '5562999990001', now() - interval '22 hours', now() - interval '22 hours', 'in'),
  ('0a000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-00000000000a', 'ea000000-0000-4000-8000-00000000000a', '5562999990002', now() - interval '1 hour', now() - interval '1 hour', 'in'),
  ('0a000000-0000-4000-8000-000000000003', 'ba000000-0000-4000-8000-00000000000a', 'ea000000-0000-4000-8000-00000000000a', '5562999990003', now() - interval '2 days', now() - interval '2 days', 'in'),
  ('0a000000-0000-4000-8000-000000000004', 'ba000000-0000-4000-8000-00000000000a', 'ea000000-0000-4000-8000-00000000000a', '5562999990004', now() - interval '3 hours', now() - interval '1 hour', 'out'),
  ('0a000000-0000-4000-8000-000000000005', 'ba000000-0000-4000-8000-00000000000a', 'ea000000-0000-4000-8000-00000000000a', '5562999990005', null, now() - interval '40 days', 'in');
insert into public.wa_messages (org_id, conversation_id, number_id, direction, kind, body, status, error_code, created_at) values
  ('ba000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-000000000004', 'ea000000-0000-4000-8000-00000000000a', 'out', 'text', 'Não saiu.', 'failed', 'unavailable', now() - interval '1 hour'),
  ('ba000000-0000-4000-8000-00000000000a', '0a000000-0000-4000-8000-000000000004', 'ea000000-0000-4000-8000-00000000000a', 'out', 'text', 'Não saiu, faz tempo.', 'failed', 'unavailable', now() - interval '2 days');

select is(
  pg_temp.today('aa000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-00000000000a'),
  '{"approvals_mine": 1, "approvals_waiting": 2, "conversations_waiting": 3, "conversations_closing": 1, "sends_failed": 1, "whatsapp": "active", "documents_to_review": 0, "clients_finished": 0, "chronologies_contested": 0, "complaints_overdue": 0, "filings_ready": 0, "drafts_waiting": 0, "publications_new": 0, "publications_cancelled": 0, "djen_late": 0, "djen_incomplete": 0, "djen_stopped": 0, "movements_new": 0, "tracking_failed": 0, "deadlines_to_confirm": 0, "deadlines_soon": 0, "deadlines_overdue": 0, "deadlines_review": 0, "publications_without_deadline": 0, "publications_without_hearing": 0, "publications_to_review": 0, "hearings_soon": 0, "hearings_unresolved": 0, "calendar_lost": 0, "hearings_unwarned": 0, "civil_court_declined": 0}'::jsonb,
  'the partner sees the answer that is hers to decide, the conversations nobody answered, the one about to close, and what failed today'
);
select is(
  pg_temp.today('aa000000-0000-4000-8000-000000000002', 'ba000000-0000-4000-8000-00000000000a') -> 'approvals_mine',
  '1'::jsonb,
  'who attends sees the answer that is theirs, counted by their own function'
);

-- The number leaves: the conversations cannot be answered from it, and the home says the firm is disconnected.
update public.wa_numbers set status = 'disconnected', disconnected_at = now(), disconnect_reason = 'partner_removed'
where id = 'ea000000-0000-4000-8000-00000000000a';

select ok(
  (select today ->> 'whatsapp' = 'disconnected' and (today ->> 'conversations_waiting')::integer = 0
          and (today ->> 'conversations_closing')::integer = 0
   from pg_temp.today('aa000000-0000-4000-8000-000000000001', 'ba000000-0000-4000-8000-00000000000a') as today)
  and pg_temp.today('aa000000-0000-4000-8000-000000000004', 'ba000000-0000-4000-8000-00000000000b')
      = '{"approvals_mine": 1, "approvals_waiting": 1, "conversations_waiting": 0, "conversations_closing": 0, "sends_failed": 0, "whatsapp": "none", "documents_to_review": 0, "clients_finished": 0, "chronologies_contested": 0, "complaints_overdue": 0, "filings_ready": 0, "drafts_waiting": 0, "publications_new": 0, "publications_cancelled": 0, "djen_late": 0, "djen_incomplete": 0, "djen_stopped": 0, "movements_new": 0, "tracking_failed": 0, "deadlines_to_confirm": 0, "deadlines_soon": 0, "deadlines_overdue": 0, "deadlines_review": 0, "publications_without_deadline": 0, "publications_without_hearing": 0, "publications_to_review": 0, "hearings_soon": 0, "hearings_unresolved": 0, "calendar_lost": 0, "hearings_unwarned": 0, "civil_court_declined": 0}'::jsonb,
  'a firm whose number left is told so, and the other firm counts only what is its own'
);

select * from finish();
rollback;
