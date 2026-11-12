begin;
create extension if not exists pgtap;
select plan(10);

-- ============================================================
-- The chat's script (0227): the intake keeps who travelled along and where
-- ONE stands, cleaned, and clears a step when asked; a first name of two
-- letters opens a case; the firm's words on its fees and doubts are messages
-- of their own; the third version of the task is in force and the modules
-- that pin it published it. Two firms: nothing of one reaches the other.
--
-- Every person, firm, number and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2270000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-roteiro.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2270000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-roteiro.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2270000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-roteiro', 'a2270000-0000-4000-8000-000000000001'),
  ('b2270000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-roteiro', 'a2270000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2270000-0000-4000-8000-00000000000a', 'a2270000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2270000-0000-4000-8000-00000000000b', 'a2270000-0000-4000-8000-000000000004', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2270000-0000-4000-8000-00000000000a', 'b2270000-0000-4000-8000-00000000000a', 'whatsapp', 'roteiro-waba-a', 'Chat de teste',
   'connected', 'a2270000-0000-4000-8000-000000000001', now()),
  ('c2270000-0000-4000-8000-00000000000b', 'b2270000-0000-4000-8000-00000000000b', 'whatsapp', 'roteiro-waba-b', 'Chat de teste',
   'connected', 'a2270000-0000-4000-8000-000000000004', now());
update public.platform_settings set value = value || '{"debounce_seconds": 0}'::jsonb where key = 'conversation_agent';

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.writes(firm uuid, phone text, body text) returns uuid language plpgsql as $$
declare
  number uuid := (select n.id from public.wa_numbers n where n.org_id = firm and n.provider = 'test');
begin
  return (public.wa_ingest_inbound(firm, number, phone, 'Passageira', 'test.in.' || gen_random_uuid(), 'text', body)
          ->> 'conversation_id')::uuid;
end;
$$;
create function pg_temp.claim(conversation uuid) returns integer language sql as $$
  select ((public.claim_conversation_turns(1, conversation) -> 0) ->> 'claim')::integer;
$$;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b2270000-0000-4000-8000-00000000000a',
  'c2270000-0000-4000-8000-00000000000a', 'test', 'roteiro-number-a', 'roteiro-waba-a', '5500900000271', 'Souza Advogados', 'cloud'));
insert into res values ('number_b', public.register_wa_number('b2270000-0000-4000-8000-00000000000b',
  'c2270000-0000-4000-8000-00000000000b', 'test', 'roteiro-number-b', 'roteiro-waba-b', '5500900000272', 'Rocha Advocacia', 'cloud'));

-- Lu writes to firm A; Rui to firm B.
insert into res values ('lia', jsonb_build_object('conversation',
  pg_temp.writes('b2270000-0000-4000-8000-00000000000a', '5500988882271', 'oi, meu voo cancelou')));
insert into res values ('lia_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('lia', 'conversation')::uuid)));
insert into res values ('rui', jsonb_build_object('conversation',
  pg_temp.writes('b2270000-0000-4000-8000-00000000000b', '5500988882272', 'bom dia, minha mala sumiu')));
insert into res values ('rui_claim', jsonb_build_object('claim', pg_temp.claim(pg_temp.got('rui', 'conversation')::uuid)));

insert into res values ('lia_kept', public.record_conversation_intake(pg_temp.got('lia', 'conversation')::uuid,
  pg_temp.got('lia_claim', 'claim')::integer,
  '{"nome": "Lu", "problema": "cancellation", "companhia": "AD", "voo": "AD 4040", "data": "2099-10-25",
    "aviso": "late", "acompanhantes": "Pedro, 8 anos", "etapa": "resumo", "intruso": "x"}'::jsonb));
select is(
  pg_temp.got('lia_kept', 'facts')::jsonb,
  '{"nome": "Lu", "problema": "cancellation", "companhia": "AD", "voo": "AD 4040", "data": "2099-10-25",
    "aviso": "late", "acompanhantes": "Pedro, 8 anos", "etapa": "resumo"}'::jsonb,
  'the intake keeps who travelled along and where ONE stands, and nothing it does not know'
);

insert into res values ('lia_odd', public.record_conversation_intake(pg_temp.got('lia', 'conversation')::uuid,
  pg_temp.got('lia_claim', 'claim')::integer, '{"etapa": "inventada", "acompanhantes": "1"}'::jsonb));
select is(
  (pg_temp.got('lia_odd', 'facts')::jsonb) ->> 'etapa', 'resumo',
  'a step ONE does not know is never kept, nor companions with no name'
);

insert into res values ('lia_cleared', public.record_conversation_intake(pg_temp.got('lia', 'conversation')::uuid,
  pg_temp.got('lia_claim', 'claim')::integer, '{"data": "2099-10-26"}'::jsonb, array['etapa', 'result']));
select ok(
  not (pg_temp.got('lia_cleared', 'facts')::jsonb ? 'etapa')
    and (pg_temp.got('lia_cleared', 'facts')::jsonb) ->> 'data' = '2099-10-26',
  'a step is cleared when a correction brings a question back, and the correction kept'
);

insert into res values ('rui_kept', public.record_conversation_intake(pg_temp.got('rui', 'conversation')::uuid,
  pg_temp.got('rui_claim', 'claim')::integer, '{"nome": "Rui", "problema": "baggage_lost", "etapa": "oferta"}'::jsonb));
select is(
  (select intake from public.wa_conversations where id = pg_temp.got('lia', 'conversation')::uuid) ->> 'nome', 'Lu',
  'each conversation keeps its own intake'
);

-- Lu says "Quero seguir": a first name of two letters is a name.
insert into res values ('lia_opened', public.one_open_case_from_intake(pg_temp.got('lia', 'conversation')::uuid,
  pg_temp.got('lia_claim', 'claim')::integer, repeat('a', 64),
  'Pronto, Lu. O seu caso está aberto no escritório Souza Advogados. Se preferir uma tela, o seu link mostra o mesmo: https://one.invalid/c/x.'));
select is(pg_temp.got('lia_opened', 'code'), 'opened', 'the case opens with a first name');
select is(
  (select p.full_name from public.case_parties cp join public.people p on p.id = cp.person_id
   where cp.case_id = pg_temp.got('lia_opened', 'case_id')::uuid),
  'Passageira', 'a name of two letters gives way to the WhatsApp profile until the identity says the full one'
);
select is(
  (select count(*)::int from public.cases where org_id = 'b2270000-0000-4000-8000-00000000000b'), 0,
  'nothing of firm A reaches firm B'
);

reset role;
select set_config('request.jwt.claims', '', true);

select ok(
  (select count(*) = 2 from public.one_messages where key in ('fees', 'faq')),
  'the firm writes its own words on its fees and on the common doubts'
);
select ok(
  (select (v.output_schema -> 'properties') ? 'acompanhantes' from public.prompt_versions v
   where v.task = 'atendimento.entrada' and v.is_active),
  'the version of the intake in force reads who travelled along'
);
select is(
  (select (v.manifest #>> '{prompts,atendimento.entrada}')::integer from public.module_versions v
   where v.module = 'direito-do-passageiro' and v.status = 'published' order by v.version desc limit 1),
  (select w.version from public.prompt_versions w where w.task = 'atendimento.entrada' and w.is_active),
  'the latest published version of the module pins it'
);

select * from finish();
rollback;
