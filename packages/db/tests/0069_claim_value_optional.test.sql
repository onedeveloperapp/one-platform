begin;
create extension if not exists pgtap;
select plan(7);

-- ============================================================
-- The Valor da Causa Pedido is the firm's to give or not (0064). A claimant
-- with no value asks what the court arbitrates, which the piece says beside
-- their name, and a lawsuit none of whose claimants asks a value gives the
-- cause the value the court arbitrates: nothing of it is left to fill in.
-- The values given are written as before, and the cause is their sum. Two
-- firms: nothing of one reaches the other.
--
-- Every person, firm, company and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a6800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@valor.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a6800000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rui@valor.invalid', '', now(), '{}', '{"display_name":"Rui Costa"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b6800000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-valor', 'a6800000-0000-4000-8000-000000000001'),
  ('b6800000-0000-4000-8000-00000000000b', 'Costa Advocacia', 'costa-valor', 'a6800000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b6800000-0000-4000-8000-00000000000a', 'a6800000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b6800000-0000-4000-8000-00000000000b', 'a6800000-0000-4000-8000-000000000002', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- A draft of a lawsuit, as the backend keeps one, written from a model that asks and gives the cause its value.
create function pg_temp.draft(org uuid, target_case uuid, lawsuit uuid) returns uuid language sql as $$
  insert into public.case_drafts (org_id, case_id, proceeding_id, template_name, template_body, mode, status)
  values (org, target_case, lawsuit, 'Atraso de voo',
    'Pede-se [[PEDIDO_POR_PARTE]]. Dá-se à causa o valor de [[VALOR_DA_CAUSA]].', 'blank', 'proposed')
  returning id;
$$;
create function pg_temp.model() returns text language sql as
$$ select 'Pede-se [[PEDIDO_POR_PARTE]]. Dá-se à causa o valor de [[VALOR_DA_CAUSA]].'::text; $$;

-- Firm A: Maria asks no value; in another case João asks R$ 10.000,00 and Ana Teste, who joined him, none.
select pg_temp.sign_in('a6800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('maria', public.create_case('b6800000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Maria Teste", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('maria_lawsuit', public.save_proceeding(pg_temp.got('maria', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia"}'::jsonb, array[pg_temp.got('maria', 'party_id')::uuid]));
insert into res values ('joao', public.create_case('b6800000-0000-4000-8000-00000000000a', 'cancellation', 'G3', date '2026-09-21',
  '{"full_name": "João Teste", "birth_date": "1990-01-15"}'::jsonb));
insert into res values ('ana', public.save_case_person(pg_temp.got('joao', 'case_id')::uuid, null,
  '{"full_name": "Ana Teste", "birth_date": "1980-03-03"}'::jsonb, 'claimant'));
insert into res values ('joao_claim', public.set_party_claim(pg_temp.got('joao', 'case_id')::uuid,
  pg_temp.got('joao', 'party_id')::uuid, 1000000));
insert into res values ('joao_lawsuit', public.save_proceeding(pg_temp.got('joao', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia"}'::jsonb,
  array[pg_temp.got('joao', 'party_id')::uuid, pg_temp.got('ana', 'party_id')::uuid]));
reset role;
-- Firm B: Paulo asks R$ 7.000,00.
select pg_temp.sign_in('a6800000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('paulo', public.create_case('b6800000-0000-4000-8000-00000000000b', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Paulo Teste", "birth_date": "1979-07-07"}'::jsonb));
insert into res values ('paulo_claim', public.set_party_claim(pg_temp.got('paulo', 'case_id')::uuid,
  pg_temp.got('paulo', 'party_id')::uuid, 700000));
insert into res values ('paulo_lawsuit', public.save_proceeding(pg_temp.got('paulo', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia"}'::jsonb, array[pg_temp.got('paulo', 'party_id')::uuid]));
reset role;

-- The claimants in the order they joined (one transaction gives them one moment), and a draft of each lawsuit.
update public.case_parties set created_at = created_at + interval '1 second'
where id = pg_temp.got('ana', 'party_id')::uuid;
insert into res select 'drafts', jsonb_build_object(
  'maria', pg_temp.draft('b6800000-0000-4000-8000-00000000000a', pg_temp.got('maria', 'case_id')::uuid,
    pg_temp.got('maria_lawsuit', 'proceeding_id')::uuid),
  'joao', pg_temp.draft('b6800000-0000-4000-8000-00000000000a', pg_temp.got('joao', 'case_id')::uuid,
    pg_temp.got('joao_lawsuit', 'proceeding_id')::uuid),
  'paulo', pg_temp.draft('b6800000-0000-4000-8000-00000000000b', pg_temp.got('paulo', 'case_id')::uuid,
    pg_temp.got('paulo_lawsuit', 'proceeding_id')::uuid));

select ok(
  pg_temp.got('maria_lawsuit', 'ok') = 'true' and pg_temp.got('joao_lawsuit', 'ok') = 'true'
  and pg_temp.got('ana', 'ok') = 'true' and pg_temp.got('paulo_lawsuit', 'ok') = 'true'
  and (select claim_cents is null from public.case_parties where id = pg_temp.got('maria', 'party_id')::uuid)
  and public.case_draft_filled(pg_temp.got('drafts', 'maria')::uuid, pg_temp.model())
    = 'Pede-se Maria Teste: o valor que este Juízo arbitrar. Dá-se à causa o valor que este Juízo arbitrar.'
  and public.case_draft_text_blocker(public.case_draft_filled(pg_temp.got('drafts', 'maria')::uuid, pg_temp.model())) is null,
  'a lawsuit whose claimants ask no value gives the cause the value the court arbitrates, and nothing of it is left to fill in'
);

select ok(
  public.case_draft_filled(pg_temp.got('drafts', 'maria')::uuid,
    E'Valor da causa: [[VALOR_DA_CAUSA]].\nAtribui-se à causa o Valor de\n[[VALOR_DA_CAUSA]].')
    = E'Valor da causa: a ser arbitrado por este Juízo.\nAtribui-se à causa o Valor que este Juízo arbitrar.',
  'the value the court arbitrates is said as the text gives the cause its value, however the line breaks'
);

select ok(
  public.case_draft_filled(pg_temp.got('drafts', 'joao')::uuid, pg_temp.model())
    = 'Pede-se João Teste: R$ 10.000,00; Ana Teste: o valor que este Juízo arbitrar. Dá-se à causa o valor de R$ 10.000,00.',
  'the cause is given the values its claimants ask, and a claimant with none asks what the court arbitrates beside them'
);

select pg_temp.sign_in('a6800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_claim', public.set_party_claim(pg_temp.got('joao', 'case_id')::uuid,
  pg_temp.got('ana', 'party_id')::uuid, 1500000));
reset role;
select ok(
  pg_temp.got('ana_claim', 'code') = 'saved'
  and public.case_draft_filled(pg_temp.got('drafts', 'joao')::uuid, pg_temp.model())
    = 'Pede-se João Teste: R$ 10.000,00; Ana Teste: R$ 15.000,00. Dá-se à causa o valor de R$ 25.000,00.',
  'once every claimant asks a value, the cause is their sum'
);

select pg_temp.sign_in('a6800000-0000-4000-8000-000000000002');
set local role authenticated;
select throws_ok(
  format('select public.set_party_claim(%L::uuid, %L::uuid, 100)', pg_temp.got('maria', 'case_id'), pg_temp.got('maria', 'party_id')),
  'P0002', null,
  'firm B writes no value for a claimant of firm A'
);
select ok(
  (select count(*) = 0 from public.case_parties where org_id = 'b6800000-0000-4000-8000-00000000000a')
  and (select count(*) = 1 from public.case_parties where org_id = 'b6800000-0000-4000-8000-00000000000b'),
  'firm B reads only its own claimants'
);
reset role;

select ok(
  public.case_draft_filled(pg_temp.got('drafts', 'paulo')::uuid, pg_temp.model())
    = 'Pede-se Paulo Teste: R$ 7.000,00. Dá-se à causa o valor de R$ 7.000,00.'
  and (select claim_cents is null from public.case_parties where id = pg_temp.got('maria', 'party_id')::uuid)
  and not has_function_privilege('authenticated', 'public.case_draft_filled(uuid, text)', 'execute')
  and not has_function_privilege('anon', 'public.case_draft_filled(uuid, text)', 'execute')
  and not has_function_privilege('authenticated', 'public.test_court_act(text, uuid, text)', 'execute'),
  'firm B''s piece asks what its own claimant asks, firm A''s claimant stays as firm A left it, and only the backend fills a text'
);

select * from finish();
rollback;
