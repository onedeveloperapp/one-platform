begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- The closing and the referral (0183): the intake keeps who referred a
-- person; a case an intake opens for them is of the origin referral, and the
-- numbers count it; ONE thanks a client who confirmed their money and asks
-- for a referral once, in the conversation it holds, inside the 24 hours.
-- Two firms: nothing of one reaches the other.
--
-- Every person, firm and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1810000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-indica.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1810000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-indica.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1810000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-indica', 'a1810000-0000-4000-8000-000000000001'),
  ('b1810000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-indica', 'a1810000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1810000-0000-4000-8000-00000000000a', 'a1810000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1810000-0000-4000-8000-00000000000b', 'a1810000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('d1810000-0000-4000-8000-00000000000a', 'b1810000-0000-4000-8000-00000000000a', 'whatsapp', 'waba-indica-a', 'WhatsApp A',
   'connected', 'a1810000-0000-4000-8000-000000000001', now()),
  ('d1810000-0000-4000-8000-00000000000b', 'b1810000-0000-4000-8000-00000000000b', 'whatsapp', 'waba-indica-b', 'WhatsApp B',
   'connected', 'a1810000-0000-4000-8000-000000000002', now());
insert into public.wa_numbers (id, org_id, connection_id, provider, phone_number_id, waba_id, display_phone_number, mode) values
  ('e1810000-0000-4000-8000-00000000000a', 'b1810000-0000-4000-8000-00000000000a', 'd1810000-0000-4000-8000-00000000000a',
   'simulator', 'sim-indica-a', 'waba-indica-a', '5500900000181', 'coexistence'),
  ('e1810000-0000-4000-8000-00000000000b', 'b1810000-0000-4000-8000-00000000000b', 'd1810000-0000-4000-8000-00000000000b',
   'simulator', 'sim-indica-b', 'waba-indica-b', '5500900000182', 'coexistence');

-- Maria's case got its money, and she confirmed it on her link; Lia's firm's conversation closed two days ago.
insert into public.people (id, org_id, full_name, phone) values
  ('d1810000-0000-4000-8000-000000000001', 'b1810000-0000-4000-8000-00000000000a', 'Maria Teste', '5500999998101'),
  ('d1810000-0000-4000-8000-000000000002', 'b1810000-0000-4000-8000-00000000000b', 'Lia Teste', '5500999998102');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c1810000-0000-4000-8000-000000000001', 'b1810000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c1810000-0000-4000-8000-000000000002', 'b1810000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.case_parties (id, org_id, case_id, person_id, role) values
  ('e1810000-0000-4000-8000-000000000001', 'b1810000-0000-4000-8000-00000000000a', 'c1810000-0000-4000-8000-000000000001', 'd1810000-0000-4000-8000-000000000001', 'claimant'),
  ('e1810000-0000-4000-8000-000000000002', 'b1810000-0000-4000-8000-00000000000b', 'c1810000-0000-4000-8000-000000000002', 'd1810000-0000-4000-8000-000000000002', 'claimant');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f1810000-0000-4000-8000-000000000001', 'b1810000-0000-4000-8000-00000000000a', 'c1810000-0000-4000-8000-000000000001',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01'),
  ('f1810000-0000-4000-8000-000000000002', 'b1810000-0000-4000-8000-00000000000b', 'c1810000-0000-4000-8000-000000000002',
   'juizado', 'TJGO', 'filed', '10003012720998090100', '2026-09-01');
insert into public.lawsuit_facts (id, org_id, case_id, proceeding_id, kind, release_kind, cents, happened_on, source) values
  ('a9810000-0000-4000-8000-000000000001', 'b1810000-0000-4000-8000-00000000000a', 'c1810000-0000-4000-8000-000000000001',
   'f1810000-0000-4000-8000-000000000001', 'alvara', 'alvara', 300000, current_date - 5, 'person'),
  ('a9810000-0000-4000-8000-000000000002', 'b1810000-0000-4000-8000-00000000000b', 'c1810000-0000-4000-8000-000000000002',
   'f1810000-0000-4000-8000-000000000002', 'alvara', 'alvara', 300000, current_date - 5, 'person');
update public.lawsuit_facts set received_cents = 300000, received_on = current_date - 4
where id in ('a9810000-0000-4000-8000-000000000001', 'a9810000-0000-4000-8000-000000000002');
insert into public.money_shares (org_id, release_id, case_id, party_id, person_id, gross_cents, payable_cents, status, paid_on, client_confirmed_at)
select r.org_id, r.id, r.case_id, cp.id, cp.person_id, 300000, 300000, 'paid', current_date - 1, now()
from public.money_releases r join public.case_parties cp on cp.case_id = r.case_id;
insert into public.wa_conversations (id, org_id, number_id, contact_wa_id, last_inbound_at, last_message_at,
                                     last_message_preview, last_message_direction, unread_count, agent) values
  ('f1810000-0000-4000-8000-00000000000a', 'b1810000-0000-4000-8000-00000000000a', 'e1810000-0000-4000-8000-00000000000a',
   '5500999998101', now() - interval '5 minutes', now() - interval '5 minutes', 'Recebi', 'in', 1, 'one'),
  ('f1810000-0000-4000-8000-00000000000b', 'b1810000-0000-4000-8000-00000000000b', 'e1810000-0000-4000-8000-00000000000b',
   '5500999998102', now() - interval '2 days', now() - interval '2 days', 'Oi', 'in', 0, 'one'),
  -- Somebody Maria referred writes to her firm.
  ('f1810000-0000-4000-8000-00000000000c', 'b1810000-0000-4000-8000-00000000000a', 'e1810000-0000-4000-8000-00000000000a',
   '5500999998103', now() - interval '1 minute', now() - interval '1 minute', 'A Maria me indicou', 'in', 1, 'one');
update public.wa_conversations set contact_name = 'Rui Teste', one_claimed_at = now(), one_claims = 3
where id = 'f1810000-0000-4000-8000-00000000000c';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

select ok(
  public.intake_facts_clean('{"indicado_por": "Maria Teste", "nome": "Rui Teste", "lixo": "x"}'::jsonb)
    = '{"indicado_por": "Maria Teste", "nome": "Rui Teste"}'::jsonb
  and (select (v.output_schema -> 'properties') ? 'indicado_por' from public.prompt_versions v
       where v.task = 'atendimento.entrada' and v.is_active),
  'the intake keeps who referred a person, which its task in force reads'
);

set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
insert into res values ('kept', public.record_conversation_intake('f1810000-0000-4000-8000-00000000000c', 3,
  '{"indicado_por": "Maria Teste"}'::jsonb));
insert into res select 'owed', coalesce(jsonb_agg(to_jsonb(r)), '[]') from public.referral_asks_owed(20) r;
insert into res values ('asked', public.one_ask_referral('c1810000-0000-4000-8000-000000000001',
  'Maria, o escritório agradece a sua confiança.'));
insert into res values ('again', public.one_ask_referral('c1810000-0000-4000-8000-000000000001', 'De novo.'));
insert into res values ('closed', public.one_ask_referral('c1810000-0000-4000-8000-000000000002', 'Fora da janela.'));
reset role;

select ok(
  pg_temp.got('kept', 'code') = 'kept'
  and (select p.referred_by = 'Maria Teste' and p.full_name = 'Rui Teste' and p.phone = '5500999998103'
       from public.people p where p.org_id = 'b1810000-0000-4000-8000-00000000000a' and p.phone = '5500999998103')
  and (select 'referral' = any (f.origins) from public.people_facts('b1810000-0000-4000-8000-00000000000a') f
       where f.full_name = 'Rui Teste'),
  'who says they were referred is a person of the firm at once, counted as a referral'
);

select ok(
  (select jsonb_array_length(payload) = 1 and payload -> 0 ->> 'case_id' = 'c1810000-0000-4000-8000-000000000001'
          and payload -> 0 ->> 'first_name' = 'Maria'
   from res where name = 'owed')
  and pg_temp.got('asked', 'code') = 'queued' and pg_temp.got('again', 'code') = 'not_owed'
  and pg_temp.got('closed', 'code') = 'not_owed'
  and (select referral_asked_at is not null from public.cases where id = 'c1810000-0000-4000-8000-000000000001')
  and exists (select 1 from public.case_events e where e.case_id = 'c1810000-0000-4000-8000-000000000001'
              and e.kind = 'referral_asked' and e.actor_type = 'system'),
  'ONE thanks a client who confirmed their money once, inside the 24 hours, never where the window closed'
);

-- The case an intake opens for a referred person is of the origin referral.
insert into public.cases (id, org_id, seq, module, incident, status, origin) values
  ('c1810000-0000-4000-8000-000000000003', 'b1810000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'intake', 'organic');
update public.wa_conversations set intake_case_id = 'c1810000-0000-4000-8000-000000000003'
where id = 'f1810000-0000-4000-8000-00000000000c';
select is(
  (select origin from public.cases where id = 'c1810000-0000-4000-8000-000000000003'),
  'referral',
  'the case it opens is of the origin referral'
);

select ok(
  not has_function_privilege('authenticated', 'public.referral_asks_owed(integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.one_ask_referral(uuid, text)', 'EXECUTE')
  and not exists (select 1 from public.people p where p.org_id = 'b1810000-0000-4000-8000-00000000000b' and p.referred_by is not null),
  'only the backend asks, and nothing of one firm reaches the other'
);

select * from finish();
rollback;
