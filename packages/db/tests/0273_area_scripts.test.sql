begin;
create extension if not exists pgtap;
select plan(23);

-- ============================================================
-- The script of each area of the firm (0273). Who manages firm A asks ONE to write the script of its family area,
-- never of a module's area; one writing at a time per area keeps the newest words; the backend claims it, reads what
-- to write from and records the draft, refused when it breaks its shape or the rules for everybody; the person
-- corrects it, publishes it (never edited again), makes a new draft of it and withdraws it with why. Firm B neither
-- acts on nor reads A's scripts; the backend's functions are nobody else's.
--
-- Every person, firm and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2730000-0000-4000-8000-000000000001', 'ana@souza-roteiro.invalid', 'Ana Souza'),
  ('a2730000-0000-4000-8000-000000000002', 'caio@rocha-roteiro.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2730000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-roteiro', 'a2730000-0000-4000-8000-000000000001'),
  ('b2730000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-roteiro', 'a2730000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2730000-0000-4000-8000-00000000000a', 'a2730000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2730000-0000-4000-8000-00000000000b', 'a2730000-0000-4000-8000-000000000002', 'owner', 'socio');
-- Family is an area of A's own; its passenger area came with the module every new firm is given.
insert into public.firm_areas (id, org_id, law_area, name, source) values
  ('c2730000-0000-4000-8000-0000000000f1', 'b2730000-0000-4000-8000-00000000000a', 'familia', 'Família e sucessões', 'person');
insert into public.firm_areas (id, org_id, law_area, name, source)
select 'c2730000-0000-4000-8000-0000000000f2', 'b2730000-0000-4000-8000-00000000000a', 'passageiro', 'Direito do Passageiro', 'module'
where not exists (
  select 1 from public.firm_areas a
  where a.org_id = 'b2730000-0000-4000-8000-00000000000a' and a.law_area = 'passageiro' and a.removed_at is null
);

create temp table res (name text primary key, value jsonb);
grant select, insert on res to authenticated, service_role;
create function pg_temp.got(key text, field text) returns text language sql as
$$ select value ->> field from res where name = key $$;
create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;
create function pg_temp.backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;

/** A script ONE could write, with a text given as its refusal and a criterion given to its question's second option. */
create function pg_temp.script(refusal text, criterion text default 'pessoa') returns jsonb language sql as $$
  select jsonb_build_object(
    'tipos', jsonb_build_array(
      jsonb_build_object('chave', 'divorcio', 'nome', 'Divórcio consensual',
        'documentos', jsonb_build_array(
          jsonb_build_object('chave', 'rg', 'nome', 'RG ou CNH', 'tipo', 'identity', 'por', 'pessoa', 'essencial', true),
          jsonb_build_object('chave', 'certidao', 'nome', 'Certidão de casamento', 'tipo', 'other', 'por', 'caso', 'essencial', true)),
        'pecas', jsonb_build_array('Petição inicial de divórcio'))),
    'perguntas', jsonb_build_array(
      jsonb_build_object('chave', 'bens', 'texto', 'Há bens a dividir?', 'tipos', '[]'::jsonb,
        'opcoes', jsonb_build_array(
          jsonb_build_object('chave', 'nao', 'texto', 'Não', 'criterio', 'segue'),
          jsonb_build_object('chave', 'exterior', 'texto', 'Sim, no exterior', 'criterio', criterion)))),
    'etapas', jsonb_build_array(jsonb_build_object('chave', 'cejusc', 'nome', 'Audiência no CEJUSC', 'fase', 'processo')),
    'tarefas', '[]'::jsonb,
    'honorarios', '', 'duvidas', '', 'recusa', refusal,
    'tribunais', jsonb_build_array(jsonb_build_object('tribunal', 'TJGO', 'sistema', 'Projudi')),
    'sensiveis', jsonb_build_array(jsonb_build_object('dado', 'criancas', 'nome', 'Dados dos filhos', 'guarda_anos', 5)));
$$;

-- ---------- Asked ----------

set local role authenticated;
select pg_temp.sign_in('a2730000-0000-4000-8000-000000000001');
insert into res values ('asked', public.request_area_script('b2730000-0000-4000-8000-00000000000a',
  'c2730000-0000-4000-8000-0000000000f1', null, '{}'));
select is(pg_temp.got('asked', 'code'), 'requested', 'who manages A asks ONE to write the script of its family area');
select is(
  public.request_area_script('b2730000-0000-4000-8000-00000000000a', 'c2730000-0000-4000-8000-0000000000f1',
    'Só divórcio consensual', '{}') ->> 'request_id',
  pg_temp.got('asked', 'request_id'), 'asking again while ONE writes keeps one writing, with the newest words'
);
select is(
  public.request_area_script('b2730000-0000-4000-8000-00000000000a',
    (select a.id from public.firm_areas a where a.org_id = 'b2730000-0000-4000-8000-00000000000a' and a.law_area = 'passageiro'
       and a.removed_at is null), null, '{}') ->> 'code',
  'area_not_found', 'a module''s area is set up in the module, never by a script'
);
select is(
  public.request_area_script('b2730000-0000-4000-8000-00000000000a', 'c2730000-0000-4000-8000-0000000000f1', null,
    array['d2730000-0000-4000-8000-000000000001']::uuid[]) ->> 'code',
  'file_not_found', 'a document that is not the firm''s, for the interview, is refused'
);
select pg_temp.sign_in('a2730000-0000-4000-8000-000000000002');
select throws_ok(
  $$select public.request_area_script('b2730000-0000-4000-8000-00000000000a', 'c2730000-0000-4000-8000-0000000000f1', null, '{}')$$,
  '42501', 'not_authorized', 'firm B never asks for A''s script'
);
reset role;

-- ---------- Written by ONE ----------

select pg_temp.backend();
set local role service_role;
insert into res values ('claim', (public.claim_area_script_requests(5) -> 0));
select is(pg_temp.got('claim', 'area_id'), 'c2730000-0000-4000-8000-0000000000f1', 'the backend claims the writing');
select is(
  (select array[i -> 'area' ->> 'name', i -> 'area' ->> 'law_area', i -> 'firm' ->> 'name', i ->> 'change']
   from public.area_script_request_input(pg_temp.got('claim', 'request_id')::uuid, pg_temp.got('claim', 'claim')::integer) i),
  array['Família e sucessões', 'familia', 'Souza Advogados', 'Só divórcio consensual'],
  'and reads what to write from: the area, the firm and the words asked'
);
select is(
  public.record_area_script_draft(pg_temp.got('claim', 'request_id')::uuid, pg_temp.got('claim', 'claim')::integer,
    pg_temp.script('Não atendemos este caso — obrigado!'), null) ->> 'code',
  'copy_rules', 'a script with a dash or an exclamation mark is refused'
);
select is(
  public.record_area_script_draft(pg_temp.got('claim', 'request_id')::uuid, pg_temp.got('claim', 'claim')::integer,
    pg_temp.script('Obrigado.', 'talvez'), null) ->> 'code',
  'shape', 'and so is an option with no criterion of the firm''s'
);
insert into res values ('draft', public.record_area_script_draft(pg_temp.got('claim', 'request_id')::uuid,
  pg_temp.got('claim', 'claim')::integer, pg_temp.script('Obrigado por contar. Não vamos poder cuidar deste caso.'), null));
select is(pg_temp.got('draft', 'code'), 'drafted', 'a script within its shape and the rules is the area''s draft');
reset role;

-- ---------- Corrected and published ----------

set local role authenticated;
select pg_temp.sign_in('a2730000-0000-4000-8000-000000000002');
select is((select count(*)::integer from public.firm_area_scripts), 0, 'firm B reads none of A''s scripts');
select throws_ok(
  format($$select public.publish_area_script('b2730000-0000-4000-8000-00000000000a', %L)$$, pg_temp.got('draft', 'script_id')),
  '42501', 'not_authorized', 'nor publishes one'
);
select pg_temp.sign_in('a2730000-0000-4000-8000-000000000001', 'aal1');
select throws_ok(
  format($$select public.publish_area_script('b2730000-0000-4000-8000-00000000000a', %L)$$, pg_temp.got('draft', 'script_id')),
  '42501', 'second_factor_required', 'never without the second factor'
);
select pg_temp.sign_in('a2730000-0000-4000-8000-000000000001');
select is(
  public.save_area_script_draft('b2730000-0000-4000-8000-00000000000a', pg_temp.got('draft', 'script_id')::uuid,
    pg_temp.script('Garantimos o resultado em outro caso.')) ->> 'code',
  'promise', 'a correction that promises a result is refused'
);
select is(
  public.save_area_script_draft('b2730000-0000-4000-8000-00000000000a', pg_temp.got('draft', 'script_id')::uuid,
    pg_temp.script('Obrigado. O escritório não cuida deste caso.', 'nao_atendemos')) ->> 'code',
  'saved', 'who manages A corrects the draft in place'
);
select is(
  (public.firm_setup_facts('b2730000-0000-4000-8000-00000000000a') ->> 'area_scripts')::boolean, false,
  'the setup''s facts say an area waits for its script'
);
select is(
  public.publish_area_script('b2730000-0000-4000-8000-00000000000a', pg_temp.got('draft', 'script_id')::uuid) ->> 'code',
  'published', 'and publishes it'
);
select is(
  (public.firm_setup_facts('b2730000-0000-4000-8000-00000000000a') ->> 'area_scripts')::boolean, true,
  'every area of A that no module serves has its script'
);
insert into res values ('copy', public.copy_area_script('b2730000-0000-4000-8000-00000000000a',
  pg_temp.got('draft', 'script_id')::uuid));
select is(pg_temp.got('copy', 'version'), '2', 'a correction by hand of the version in force is a new draft of it');
select is(
  public.withdraw_area_script('b2730000-0000-4000-8000-00000000000a', pg_temp.got('draft', 'script_id')::uuid, 'Erro no critério') ->> 'code',
  'withdrawn', 'a published version is withdrawn with why'
);
reset role;

select throws_ok(
  format($$update public.firm_area_scripts set script = '{}'::jsonb where id = %L$$, pg_temp.got('draft', 'script_id')),
  '23514', 'script_released_immutable', 'a published version is never edited'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_area_script_requests(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.area_script_request_input(uuid, integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_area_script_draft(uuid, integer, jsonb, uuid)', 'execute'),
  'nobody but the backend claims, reads or records a writing'
);
-- As the audited deletion of an account does it (0005): with no person's session.
select set_config('request.jwt.claims', '', true);
select lives_ok(
  $$delete from public.organizations where id = 'b2730000-0000-4000-8000-00000000000a'$$,
  'the firm''s account deleted takes its published scripts with it'
);

select * from finish();
rollback;
