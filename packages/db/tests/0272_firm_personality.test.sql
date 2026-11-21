begin;
create extension if not exists pgtap;
select plan(20);

-- ============================================================
-- The firm's personality (0272). Who manages firm A asks ONE to write its profile, with the site once; one writing at
-- a time keeps the newest words; the backend claims it, reads what to write from, and records the draft, refused when
-- it breaks the rules for everybody; the person approves it, and only then does ONE attend for a new firm. Firm B
-- neither approves nor reads A's; the backend's functions are nobody else's.
--
-- Every person, firm and name here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2720000-0000-4000-8000-000000000001', 'ana@souza-perfil-ia.invalid', 'Ana Souza'),
  ('a2720000-0000-4000-8000-000000000002', 'caio@rocha-perfil-ia.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2720000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-perfil-ia', 'a2720000-0000-4000-8000-000000000001'),
  ('b2720000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-perfil-ia', 'a2720000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2720000-0000-4000-8000-00000000000a', 'a2720000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2720000-0000-4000-8000-00000000000b', 'a2720000-0000-4000-8000-000000000002', 'owner', 'socio');
update public.organizations set operation_answered_at = now(), office_city = 'Goiânia'
where id = 'b2720000-0000-4000-8000-00000000000a';

create temp table res (name text primary key, value jsonb);
grant select, insert on res to authenticated, service_role;
create function pg_temp.got(key text, field text) returns text language sql as
$$ select value ->> field from res where name = key $$;
create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;
create function pg_temp.backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;

/** A profile ONE could write, with a text given in its "sobre". */
create function pg_temp.profile(about text) returns jsonb language sql as $$
  select jsonb_build_object(
    'apresentacao', jsonb_build_object('nome', 'Souza Advogados', 'sobre', about, 'cidades', jsonb_build_array('Goiânia')),
    'tratamento', 'voce', 'tom', 'proximo', 'tamanho', 'curtas',
    'areas', '[]'::jsonb, 'fora_do_horario', 'Respondemos no próximo horário de atendimento.',
    'honorarios', '', 'duvidas', '', 'evitar', '[]'::jsonb);
$$;
create function pg_temp.examples() returns jsonb language sql as $$
  select jsonb_build_array(
    jsonb_build_object('situacao', 'Primeira resposta', 'mensagem', 'Oi, aqui é o escritório Souza. Como posso ajudar?'),
    jsonb_build_object('situacao', 'Pedido de documento', 'mensagem', 'Pode mandar uma foto do seu documento?'),
    jsonb_build_object('situacao', 'Quanto custa', 'mensagem', 'Os honorários estão no contrato que você vê antes de assinar.'));
$$;

-- ---------- Asked ----------

set local role authenticated;
select pg_temp.sign_in('a2720000-0000-4000-8000-000000000001');
insert into res values ('asked', public.request_firm_personality('b2720000-0000-4000-8000-00000000000a', null, 'souza.invalid'));
select is(pg_temp.got('asked', 'code'), 'requested', 'who manages A asks ONE to write its profile');
select is(
  public.request_firm_personality('b2720000-0000-4000-8000-00000000000a', 'Mais formal, por favor', null) ->> 'request_id',
  pg_temp.got('asked', 'request_id'), 'asking again while ONE writes keeps one writing'
);
select is(
  (select requested_change from public.firm_personality_requests where org_id = 'b2720000-0000-4000-8000-00000000000a'),
  'Mais formal, por favor', 'with the newest words'
);
select is(
  public.request_firm_personality('b2720000-0000-4000-8000-00000000000a', null, 'nada de site') ->> 'code',
  'invalid_site', 'a site that is no address is refused'
);
reset role;

-- ---------- Written by ONE ----------

select pg_temp.backend();
set local role service_role;
insert into res values ('claim', (public.claim_personality_requests(5) -> 0));
select is(pg_temp.got('claim', 'org_id'), 'b2720000-0000-4000-8000-00000000000a', 'the backend claims the writing');
select is(
  (select array[i ->> 'site', i -> 'firm' ->> 'name', i -> 'firm' ->> 'city', i -> 'firm' -> 'areas' -> 0 ->> 'name', i ->> 'change']
   from public.personality_request_input(pg_temp.got('claim', 'request_id')::uuid, pg_temp.got('claim', 'claim')::integer) i),
  array['https://souza.invalid', 'Souza Advogados', 'Goiânia', 'Direito do Passageiro', 'Mais formal, por favor'],
  'and reads what to write from: the firm, its place, its areas, the site and the words asked'
);
select is(
  public.record_personality_draft(pg_temp.got('claim', 'request_id')::uuid, pg_temp.got('claim', 'claim')::integer,
    pg_temp.profile('Advocacia para passageiros — rápida!'), pg_temp.examples(), null) ->> 'code',
  'copy_rules', 'a profile with a dash or an exclamation mark is refused'
);
select is(
  public.record_personality_draft(pg_temp.got('claim', 'request_id')::uuid, pg_temp.got('claim', 'claim')::integer,
    pg_temp.profile('Garantimos a sua indenização.'), pg_temp.examples(), null) ->> 'code',
  'promise', 'and so is one that promises a result'
);
insert into res values ('draft', public.record_personality_draft(pg_temp.got('claim', 'request_id')::uuid,
  pg_temp.got('claim', 'claim')::integer, pg_temp.profile('Cuidamos de problemas com voos.'), pg_temp.examples(), null, true));
select is(pg_temp.got('draft', 'code'), 'drafted', 'a profile within the rules is the firm''s draft');
select is(
  public.firm_attendance('b2720000-0000-4000-8000-00000000000a') ->> 'attends', 'false',
  'ONE attends for no new firm before its profile is approved'
);
reset role;
select ok(
  (select personality_site_read_at is not null from public.organizations where id = 'b2720000-0000-4000-8000-00000000000a')
  and (select status from public.firm_personality_requests where org_id = 'b2720000-0000-4000-8000-00000000000a') = 'done',
  'the writing is done, and the site was read once'
);

-- ---------- Approved ----------

set local role authenticated;
select pg_temp.sign_in('a2720000-0000-4000-8000-000000000002');
select throws_ok(
  format($$select public.approve_firm_personality('b2720000-0000-4000-8000-00000000000a', %L)$$, pg_temp.got('draft', 'personality_id')),
  '42501', 'not_authorized', 'firm B never approves A''s profile'
);
select is((select count(*)::integer from public.firm_personalities), 0, 'nor reads it');
select pg_temp.sign_in('a2720000-0000-4000-8000-000000000001', 'aal1');
select throws_ok(
  format($$select public.approve_firm_personality('b2720000-0000-4000-8000-00000000000a', %L)$$, pg_temp.got('draft', 'personality_id')),
  '42501', 'second_factor_required', 'never without the second factor'
);
select pg_temp.sign_in('a2720000-0000-4000-8000-000000000001');
select is(
  public.approve_firm_personality('b2720000-0000-4000-8000-00000000000a', pg_temp.got('draft', 'personality_id')::uuid) ->> 'code',
  'approved', 'who manages A approves it'
);
select is(
  (public.firm_setup_facts('b2720000-0000-4000-8000-00000000000a') ->> 'personality')::boolean, true,
  'the setup''s facts say the profile was approved'
);
reset role;

select pg_temp.backend();
set local role service_role;
select is(
  (select array[a ->> 'attends', a -> 'personality' ->> 'version', a -> 'personality' -> 'profile' ->> 'tratamento']
   from public.firm_attendance('b2720000-0000-4000-8000-00000000000a') a),
  array['true', '1', 'voce'], 'ONE attends for A from then on, with its approved profile'
);
reset role;
select is(
  (select array[status, approved_by::text] from public.firm_personalities where org_id = 'b2720000-0000-4000-8000-00000000000a'),
  array['approved', 'a2720000-0000-4000-8000-000000000001'], 'kept with who approved it'
);
select is(
  (select count(*)::integer from public.audit_events
   where org_id = 'b2720000-0000-4000-8000-00000000000a' and action in ('firm.personality_requested', 'firm.personality_approved')),
  3, 'each ask and the approval on the record'
);
select ok(
  not has_function_privilege('authenticated', 'public.claim_personality_requests(integer)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_personality_draft(uuid, integer, jsonb, jsonb, uuid, boolean)', 'execute')
  and not has_function_privilege('authenticated', 'public.record_personality_use(uuid, uuid)', 'execute'),
  'nobody but the backend claims, records or marks a use'
);

select * from finish();
rollback;
