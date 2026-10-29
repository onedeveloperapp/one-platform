begin;
create extension if not exists pgtap;
select plan(13);

-- ============================================================
-- An agency's API (0073): who manages the agency creates a key of a
-- partnership, kept as its hash alone; the backend, reading the key from a
-- request, sends the agency's lines as a spreadsheet's, issues a passenger's
-- link and reads where a passenger stands, each call counted within the
-- setting's minute; a key revoked, or of a partnership that ended, answers
-- nothing, and a key reads nothing of another partnership. Two firms.
--
-- Every person, firm, agency, name and fact here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a7700000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza-api.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a7700000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha-api.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a7700000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@viagens-api.invalid', '', now(), '{}', '{"display_name":"Duda Alves"}', now(), now()),
  ('a7700000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'edu@viagens-api.invalid', '', now(), '{}', '{"display_name":"Edu Matos"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b7700000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-api', 'a7700000-0000-4000-8000-000000000001'),
  ('b7700000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-api', 'a7700000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b7700000-0000-4000-8000-00000000000a', 'a7700000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b7700000-0000-4000-8000-00000000000b', 'a7700000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.partners (id, name) values ('c7700000-0000-4000-8000-0000000000aa', 'Viagens Sol');
insert into public.partner_members (partner_id, user_id, role) values
  ('c7700000-0000-4000-8000-0000000000aa', 'a7700000-0000-4000-8000-000000000003', 'owner'),
  ('c7700000-0000-4000-8000-0000000000aa', 'a7700000-0000-4000-8000-000000000004', 'member');
-- An agency works with one firm per module at a time: with firm B it worked before.
insert into public.partner_links (id, partner_id, org_id, module_key, status, ended_at, end_reason) values
  ('d7700000-0000-4000-8000-00000000000a', 'c7700000-0000-4000-8000-0000000000aa', 'b7700000-0000-4000-8000-00000000000a',
   'direito-do-passageiro', 'active', null, null),
  ('d7700000-0000-4000-8000-00000000000b', 'c7700000-0000-4000-8000-0000000000aa', 'b7700000-0000-4000-8000-00000000000b',
   'direito-do-passageiro', 'ended', now() - interval '3 days', 'Parceria anterior de teste');
insert into public.pax_consent_terms (partner_id, version, body) values
  ('c7700000-0000-4000-8000-0000000000aa', 1, 'Autorizo a agência a compartilhar meus dados com o escritório parceiro, nos termos do contrato.');
-- A passenger of the partnership with firm B, whom a key of the partnership with firm A never reaches.
insert into public.pax_travelers (partner_id, partnership_id, org_id, full_name, cpf) values
  ('c7700000-0000-4000-8000-0000000000aa', 'd7700000-0000-4000-8000-00000000000b', 'b7700000-0000-4000-8000-00000000000b',
   'Outra Parceria Teste', '52998224725');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.hash(token text) returns text language sql as
$$ select encode(sha256(convert_to(token, 'UTF8')), 'hex'); $$;

-- ---------- The keys ----------

select pg_temp.sign_in('a7700000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('created', public.pax_create_api_key('d7700000-0000-4000-8000-00000000000a', 'Sistema de reservas',
  pg_temp.hash('one_chave-de-teste-da-agencia-000000'), 'chave-de'));
insert into res values ('read_keys', jsonb_build_object('labels', (select jsonb_agg(label) from public.partner_api_keys)));
reset role;
select pg_temp.sign_in('a7700000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.pax_create_api_key('d7700000-0000-4000-8000-00000000000a', 'Outra chave', repeat('e', 64), 'outra-ch')$$,
  '42501', 'not_authorized',
  'a member of the agency who does not manage it creates no key'
);
reset role;
select pg_temp.sign_in('a7700000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('firm_keys', jsonb_build_object('count', (select count(*) from public.partner_api_keys)));
reset role;

select ok(
  pg_temp.got('created', 'code') = 'created'
  and (select payload -> 'labels' ->> 0 from res where name = 'read_keys') = 'Sistema de reservas'
  and pg_temp.got('firm_keys', 'count') = '0',
  'who manages the agency creates a key the agency reads, and the firm does not'
);
select ok(
  not has_column_privilege('authenticated', 'public.partner_api_keys', 'key_hash', 'SELECT')
  and not has_column_privilege('authenticated', 'public.partner_api_keys', 'window_calls', 'SELECT')
  and not has_function_privilege('authenticated', 'public.pax_api_import(text, jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.pax_api_status(text, text)', 'execute'),
  'no session reads a key''s hash, and only the backend calls with a key'
);

-- ---------- What a key does ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('imported', public.pax_api_import(pg_temp.hash('one_chave-de-teste-da-agencia-000000'),
  '[{"line": 1, "nome": "Rafaela Teste", "cpf": "111.444.777-35", "whatsapp": "(62) 99999-0001",
     "localizador": "XYZ987", "voo": "LA3456", "origem": "GRU", "destino": "REC",
     "partida": "2099-01-10T08:10", "chegada": "2099-01-10T11:25"},
    {"line": 2, "nome": "Lia Teste", "nascimento": "2018-05-10"}]'::jsonb));
insert into res values ('bad_key', public.pax_api_import(repeat('0', 64), '[]'::jsonb));
insert into res values ('link', public.pax_api_issue_link(pg_temp.hash('one_chave-de-teste-da-agencia-000000'),
  '111.444.777-35', pg_temp.hash('acordo-pela-api-0000000000000000')));
insert into res values ('minor_link', public.pax_api_issue_link(pg_temp.hash('one_chave-de-teste-da-agencia-000000'),
  '', pg_temp.hash('acordo-pela-api-1111111111111111')));
insert into res values ('other_partnership', public.pax_api_status(pg_temp.hash('one_chave-de-teste-da-agencia-000000'),
  '529.982.247-25'));
insert into res values ('status', public.pax_api_status(pg_temp.hash('one_chave-de-teste-da-agencia-000000'), '11144477735'));
reset role;

select ok(
  pg_temp.got('imported', 'code') = 'imported' and pg_temp.got('imported', 'added') = '2'
  and pg_temp.got('imported', 'trips_added') = '1' and pg_temp.got('imported', 'legs_added') = '1'
  and exists (select 1 from public.pax_travelers t
              where t.partnership_id = 'd7700000-0000-4000-8000-00000000000a' and t.cpf = '11144477735'
                and t.created_by is null)
  and exists (select 1 from public.audit_events where action = 'pax.import' and metadata ->> 'via' = 'api'),
  'a key sends the agency''s lines as a spreadsheet''s, on the record as the API''s'
);
select ok(pg_temp.got('bad_key', 'code') = 'invalid_key', 'a key that is none answers nothing');
select ok(
  pg_temp.got('link', 'code') = 'issued'
  and exists (select 1 from public.pax_confirm_links l join public.pax_travelers t on t.id = l.holder_id
              where t.cpf = '11144477735' and l.token_hash = pg_temp.hash('acordo-pela-api-0000000000000000')),
  'a key issues a passenger''s link, named by CPF'
);
select ok(
  pg_temp.got('minor_link', 'code') = 'traveler_not_found' and pg_temp.got('other_partnership', 'code') = 'traveler_not_found',
  'a key reaches no passenger without a CPF, nor one of another partnership'
);
select ok(
  pg_temp.got('status', 'acordo') = 'sem_resposta' and pg_temp.got('status', 'link_aberto') = 'true'
  and pg_temp.got('status', 'com_o_escritorio') = 'false'
  and (select payload -> 'viagens' -> 0 ->> 'acompanhamento' from res where name = 'status') = 'waiting_consent',
  'a key reads where a passenger stands'
);

-- ---------- The minute, revoking, and the end of the partnership ----------

update public.platform_settings set value = value || '{"api_calls_per_minute": 6}'::jsonb where key = 'partners';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('sixth', public.pax_api_status(pg_temp.hash('one_chave-de-teste-da-agencia-000000'), '11144477735'));
insert into res values ('seventh', public.pax_api_status(pg_temp.hash('one_chave-de-teste-da-agencia-000000'), '11144477735'));
reset role;
select ok(
  pg_temp.got('sixth', 'ok') = 'true' and pg_temp.got('seventh', 'code') = 'rate_limited',
  'a key calls at most the setting''s times a minute'
);

select pg_temp.sign_in('a7700000-0000-4000-8000-000000000003', 'aal1');
set local role authenticated;
select throws_ok(
  format('select public.pax_revoke_api_key(%L)', pg_temp.got('created', 'key_id')),
  '42501', 'second_factor_required',
  'revoking a key asks the second factor'
);
reset role;
select pg_temp.sign_in('a7700000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('second', public.pax_create_api_key('d7700000-0000-4000-8000-00000000000a', 'Outro sistema',
  pg_temp.hash('one_segunda-chave-da-agencia-0000000'), 'segunda-'));
insert into res values ('revoked', public.pax_revoke_api_key(pg_temp.got('created', 'key_id')::uuid));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('after_revoke', public.pax_api_status(pg_temp.hash('one_chave-de-teste-da-agencia-000000'), '11144477735'));
reset role;
select ok(
  pg_temp.got('revoked', 'code') = 'revoked' and pg_temp.got('after_revoke', 'code') = 'invalid_key',
  'a revoked key answers nothing'
);

update public.partner_links set status = 'ended', ended_at = now(), end_reason = 'Fim do teste'
where id = 'd7700000-0000-4000-8000-00000000000a';
select pg_temp.as_backend();
set local role service_role;
insert into res values ('after_end', public.pax_api_status(pg_temp.hash('one_segunda-chave-da-agencia-0000000'), '11144477735'));
reset role;
select ok(
  pg_temp.got('second', 'code') = 'created' and pg_temp.got('after_end', 'code') = 'partnership_ended',
  'nor a key of a partnership that ended'
);

select pg_temp.sign_in('a7700000-0000-4000-8000-000000000003');
set local role authenticated;
select throws_ok(
  $$select public.pax_create_api_key('d7700000-0000-4000-8000-00000000000a', 'Depois do fim', repeat('f', 64), 'depois-x')$$,
  'P0001', 'partnership_ended',
  'and no key is created for it'
);
reset role;

select * from finish();
rollback;
