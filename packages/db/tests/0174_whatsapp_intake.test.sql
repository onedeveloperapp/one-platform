begin;
create extension if not exists pgtap;
select plan(6);

-- ============================================================
-- Any passenger on the firm's WhatsApp (0176): who writes with no alert and
-- no case has the facts of their problem kept on the conversation, cleaned;
-- an intake that qualifies opens the case with the person, the airline and
-- the day, once; one that does not keeps the person as not qualified with
-- the rule's reasons. Two firms: nothing of one reaches the other.
--
-- Every person, firm, number and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1740000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-entrada.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1740000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-entrada.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b1740000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-entrada', 'a1740000-0000-4000-8000-000000000001'),
  ('b1740000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-entrada', 'a1740000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1740000-0000-4000-8000-00000000000a', 'a1740000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1740000-0000-4000-8000-00000000000b', 'a1740000-0000-4000-8000-000000000004', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c1740000-0000-4000-8000-00000000000a', 'b1740000-0000-4000-8000-00000000000a', 'whatsapp', 'intake-waba-a', 'Chat de teste',
   'connected', 'a1740000-0000-4000-8000-000000000001', now()),
  ('c1740000-0000-4000-8000-00000000000b', 'b1740000-0000-4000-8000-00000000000b', 'whatsapp', 'intake-waba-b', 'Chat de teste',
   'connected', 'a1740000-0000-4000-8000-000000000004', now());
update public.platform_settings set value = value || '{"debounce_seconds": 0}'::jsonb where key = 'conversation_agent';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.writes(firm uuid, phone text, body text) returns uuid language plpgsql as $$
declare
  number uuid := (select n.id from public.wa_numbers n where n.org_id = firm and n.provider = 'test');
begin
  return (public.wa_ingest_inbound(firm, number, phone, 'Passageiro', 'test.in.' || gen_random_uuid(), 'text', body)
          ->> 'conversation_id')::uuid;
end;
$$;
create function pg_temp.claim(conversation uuid) returns integer language sql as $$
  select ((public.claim_conversation_turns(1, conversation) -> 0) ->> 'claim')::integer;
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b1740000-0000-4000-8000-00000000000a',
  'c1740000-0000-4000-8000-00000000000a', 'test', 'intake-number-a', 'intake-waba-a', '5500900000071', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b1740000-0000-4000-8000-00000000000b',
  'c1740000-0000-4000-8000-00000000000b', 'test', 'intake-number-b', 'intake-waba-b', '5500900000072', 'Rocha Advocacia', 'cloud'));

-- Lucas writes to firm A with no alert and no case; Rita to firm B.
insert into res values ('lucas', jsonb_build_object('conversation',
  pg_temp.writes('b1740000-0000-4000-8000-00000000000a', '5500988880007', 'Meu voo de ontem atrasou seis horas')));
insert into res values ('lucas_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('lucas', 'conversation')::uuid)));
insert into res values ('lucas_facts', public.record_conversation_intake(pg_temp.got('lucas', 'conversation')::uuid,
  pg_temp.got('lucas_claim', 'claim')::integer,
  jsonb_build_object('problema', 'delay', 'voo', 'LA 3456', 'data', to_char(current_date - 1, 'YYYY-MM-DD'),
    'atraso_horas', '6', 'origem', 'gru', 'destino', 'REC', 'nome', 'Lucas Teste Lima', 'aviso', 'talvez', 'cpf', '52998224725')));
reset role;

select ok(
  pg_temp.got('lucas_facts', 'code') = 'kept'
  and (select payload -> 'facts' from res where name = 'lucas_facts') ?& array['problema', 'voo', 'data', 'atraso_horas', 'nome']
  and not ((select payload -> 'facts' from res where name = 'lucas_facts') ?| array['aviso', 'cpf']),
  'what the task read is kept on the conversation, each fact of its shape, nothing else'
);

set local role service_role;
insert into res values ('opened', public.one_open_case_from_intake(pg_temp.got('lucas', 'conversation')::uuid,
  pg_temp.got('lucas_claim', 'claim')::integer, repeat('a', 64), 'Olá, Lucas. O caso {caso} foi aberto. Link de teste.'));
insert into res values ('again', public.one_open_case_from_intake(pg_temp.got('lucas', 'conversation')::uuid,
  pg_temp.got('lucas_claim', 'claim')::integer, repeat('b', 64), 'Olá, Lucas. O caso {caso} foi aberto. Link de teste.'));
insert into res values ('after', public.record_conversation_intake(pg_temp.got('lucas', 'conversation')::uuid,
  pg_temp.got('lucas_claim', 'claim')::integer, '{"problema": "cancellation"}'::jsonb));
reset role;

select ok(
  pg_temp.got('opened', 'code') = 'opened'
  and (select c.incident = 'delay' and c.airline_iata = 'LA' and c.flight_date = current_date - 1 and c.origin = 'organic'
       from public.cases c where c.id = pg_temp.got('opened', 'case_id')::uuid)
  and (select p.full_name = 'Lucas Teste Lima' and p.phone = '5500988880007'
       from public.case_parties cp join public.people p on p.id = cp.person_id
       where cp.case_id = pg_temp.got('opened', 'case_id')::uuid and cp.role = 'claimant')
  and exists (select 1 from public.client_links l where l.case_id = pg_temp.got('opened', 'case_id')::uuid),
  'an intake that qualifies opens the case with the person, the airline and the day, and the client''s link'
);

select ok(
  pg_temp.got('again', 'code') = 'already_opened' and pg_temp.got('after', 'code') = 'already_opened'
  and (select count(*) = 1 from public.cases where org_id = 'b1740000-0000-4000-8000-00000000000a'),
  'never a second case of the same intake, and its facts are kept no more'
);

set local role service_role;
insert into res values ('rita', jsonb_build_object('conversation',
  pg_temp.writes('b1740000-0000-4000-8000-00000000000b', '5500988880008', 'Meu voo atrasou duas horas')));
insert into res values ('rita_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('rita', 'conversation')::uuid)));
insert into res values ('rita_facts', public.record_conversation_intake(pg_temp.got('rita', 'conversation')::uuid,
  pg_temp.got('rita_claim', 'claim')::integer,
  '{"problema": "delay", "voo": "G3 1450", "data": "2099-01-10", "atraso_horas": "2", "nome": "Rita Teste"}'::jsonb));
insert into res values ('rita_out', public.one_intake_not_qualified(pg_temp.got('rita', 'conversation')::uuid,
  pg_temp.got('rita_claim', 'claim')::integer,
  '{"outcome": "not_qualified", "rule": "qualificacao-v1", "reasons": ["delay_short"]}'::jsonb,
  'Olá, Rita. Pelas regras, este atraso não dá direito a uma ação.'));
reset role;

select ok(
  pg_temp.got('rita_out', 'code') = 'not_qualified'
  and (select point = 'nao_qualificado' and reasons = array['delay_short'] from public.people_funnel('b1740000-0000-4000-8000-00000000000b')
       where person_id = pg_temp.got('rita_out', 'person_id')::uuid)
  and not exists (select 1 from public.cases where org_id = 'b1740000-0000-4000-8000-00000000000b'),
  'one that does not qualify opens nothing, and keeps the person as not qualified with the rule''s reasons'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a1740000-0000-4000-8000-000000000004', 'role', 'authenticated')::text, true);
set local role authenticated;
select ok(
  not exists (select 1 from public.wa_conversations c where c.id = pg_temp.got('lucas', 'conversation')::uuid)
  and not exists (select 1 from public.cases c where c.id = pg_temp.got('opened', 'case_id')::uuid),
  'firm B reads nothing of firm A''s intake'
);
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.record_conversation_intake(uuid, integer, jsonb, text[])', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.one_open_case_from_intake(uuid, integer, text, text, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.one_intake_not_qualified(uuid, integer, jsonb, text)', 'EXECUTE')
  and exists (select 1 from public.prompt_versions v where v.task = 'atendimento.entrada' and v.is_active),
  'only the backend takes a passenger in, with the task''s instructions in force'
);

select * from finish();
rollback;
