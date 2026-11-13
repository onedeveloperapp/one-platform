begin;
create extension if not exists pgtap;
select plan(10);

-- ============================================================
-- The chat's script adjusted by the owner (0239). Lia's case waits for
-- nothing of her signature and has no account: ONE asks her account in the
-- chat, before anything else. A reply too short is not one; her written
-- account becomes the case's, from the conversation, to be put in order, and
-- the question ends. The interview of the start is no longer owed. The
-- intake's task reads the arrival, and every module that pins it publishes
-- that version. Nothing of it reaches the other firm.
--
-- Every person, firm, name and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2390000-0000-4000-8000-000000000001', 'ana@lima-relato.invalid', 'Ana Lima'),
  ('a2390000-0000-4000-8000-000000000002', 'duda@rocha-relato.invalid', 'Duda Rocha')
) as u (id, email, name);

insert into public.organizations (id, name, slug, created_by) values
  ('b2390000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-relato', 'a2390000-0000-4000-8000-000000000001'),
  ('b2390000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-relato', 'a2390000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2390000-0000-4000-8000-00000000000a', 'a2390000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2390000-0000-4000-8000-00000000000b', 'a2390000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2390000-0000-4000-8000-00000000000a', 'b2390000-0000-4000-8000-00000000000a', 'whatsapp', 'relato-waba-a', 'Chat de teste',
   'connected', 'a2390000-0000-4000-8000-000000000001', now()),
  ('c2390000-0000-4000-8000-00000000000b', 'b2390000-0000-4000-8000-00000000000b', 'whatsapp', 'relato-waba-b', 'Chat de teste',
   'connected', 'a2390000-0000-4000-8000-000000000002', now());

update public.platform_settings set value = value || '{"debounce_seconds": 0}'::jsonb where key = 'conversation_agent';

insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2390000-0000-4000-8000-000000000001', 'b2390000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'cancellation', 'documents');
insert into public.people (id, org_id, full_name, cpf, birth_date, phone, updated_via) values
  ('d2390000-0000-4000-8000-000000000001', 'b2390000-0000-4000-8000-00000000000a', 'Lia Teste', '52998224725', '1990-05-04',
   '5500988883901', 'firm');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e2390000-0000-4000-8000-000000000001', 'b2390000-0000-4000-8000-00000000000a', 'c2390000-0000-4000-8000-000000000001',
   'd2390000-0000-4000-8000-000000000001', 'claimant');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.writes(firm uuid, phone text, body text) returns uuid language plpgsql as $$
declare
  number uuid := (select n.id from public.wa_numbers n where n.org_id = firm and n.provider = 'test');
begin
  return (public.wa_ingest_inbound(firm, number, phone, 'Lia Teste', 'test.in.' || gen_random_uuid(), 'text', body)
          ->> 'conversation_id')::uuid;
end;
$$;
create function pg_temp.owed(conversation uuid) returns jsonb language sql as $$
  select to_jsonb(o) from public.chat_questions_owed(100) o where o.conversation_id = conversation;
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b2390000-0000-4000-8000-00000000000a',
  'c2390000-0000-4000-8000-00000000000a', 'test', 'relato-number-a', 'relato-waba-a', '5500900000391', 'Lima Advocacia', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b2390000-0000-4000-8000-00000000000b',
  'c2390000-0000-4000-8000-00000000000b', 'test', 'relato-number-b', 'relato-waba-b', '5500900000392', 'Rocha Advogados', 'cloud'));
insert into res values ('lia', jsonb_build_object('conversation',
  pg_temp.writes('b2390000-0000-4000-8000-00000000000a', '5500988883901', 'assinei')));
insert into res values ('other', jsonb_build_object('conversation',
  pg_temp.writes('b2390000-0000-4000-8000-00000000000b', '5500988883901', 'oi')));
insert into res values ('lia_claim', jsonb_build_object('claim',
  ((public.claim_conversation_turns(1, pg_temp.got('lia', 'conversation')::uuid) -> 0) ->> 'claim')::integer));

select is(
  (select jsonb_build_object('kind', o ->> 'kind', 'party', o ->> 'party_id')
   from pg_temp.owed(pg_temp.got('lia', 'conversation')::uuid) o),
  jsonb_build_object('kind', 'account', 'party', 'e2390000-0000-4000-8000-000000000001'),
  'her account is asked in the chat, nothing of her signature waiting'
);
select is(pg_temp.owed(pg_temp.got('other', 'conversation')::uuid), null, 'the same number at the other firm is asked nothing');

insert into res values ('asked', public.one_ask_chat_question(pg_temp.got('lia', 'conversation')::uuid, 'account',
  'e2390000-0000-4000-8000-000000000001', 'Agora me conte, do seu jeito, o que aconteceu na viagem.'));
select is(pg_temp.got('asked', 'code'), 'queued', 'ONE asks it');

select is(
  public.one_write_account(pg_temp.got('lia', 'conversation')::uuid, pg_temp.got('lia_claim', 'claim')::integer,
    'cancelaram') ->> 'code',
  'statement_length', 'a reply too short is not her account');

insert into res values ('written', public.one_write_account(pg_temp.got('lia', 'conversation')::uuid,
  pg_temp.got('lia_claim', 'claim')::integer,
  'O voo foi cancelado no aeroporto, ninguém ofereceu hotel e eu dormi no chão até o dia seguinte.'));
select is(pg_temp.got('written', 'code'), 'written', 'her written account is kept');
select ok(
  (select source = 'whatsapp' and work = 'chronology' and party_id = 'e2390000-0000-4000-8000-000000000001'
   from public.case_statements where id = pg_temp.got('written', 'statement_id')::uuid)
  and public.case_account_state('c2390000-0000-4000-8000-000000000001') = 'preparing',
  'as the case''s account from the conversation, for ONE to put in order');
select is(
  (select coalesce(chat_step ->> 'step', '') from public.wa_conversations where id = pg_temp.got('lia', 'conversation')::uuid),
  '', 'and the question ends');

reset role;
select ok(
  not public.interview_owed('c2390000-0000-4000-8000-000000000001')
  and (select value ->> 'start' = 'false' from public.platform_settings where key = 'interview'),
  'the interview of the start is no longer owed, by the platform''s setting');
select ok(
  (select count(*) = 1 and bool_and((output_schema -> 'properties') ? 'chegada_real'
                                     and (output_schema -> 'properties') ? 'viajou')
   from public.prompt_versions where task = 'atendimento.entrada' and is_active)
  and not exists (
    select 1 from public.product_modules m
    where 'atendimento.entrada' = any (m.version_tasks) and m.retired_at is null
      and (select (v.manifest #>> '{prompts,atendimento.entrada}')::integer from public.module_versions v
           where v.module = m.key and v.status = 'published' order by v.version desc limit 1)
          is distinct from (select w.version from public.prompt_versions w where w.task = 'atendimento.entrada' and w.is_active)
  ),
  'the intake reads the arrival, in the version every module that pins it publishes');

-- Nobody of another firm reads it.
select set_config('request.jwt.claims', '{"sub":"a2390000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.case_statements where case_id = 'c2390000-0000-4000-8000-000000000001'),
  0, 'another firm reads not her account');
reset role;

select * from finish();
rollback;
