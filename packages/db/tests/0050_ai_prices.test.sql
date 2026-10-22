begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

-- ============================================================
-- What each model costs (0043, over 0014 and 0016).
--
-- The price book says what the vendors bill: a rate for what goes in and for
-- what comes out, the audio a model hears (at its own rate, or as any input),
-- other rates for the whole of a request over a threshold, and rates that take
-- effect on a day, a call priced as of the moment it happened. A rate that is
-- not a number prices nothing and never stops a run from closing. Pricing the
-- ledger again reaches the run. Two firms: each run is charged to its own, and
-- neither reads the price book.
--
-- Every person and firm here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a5000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a5000000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('a5000000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a5000000-0000-4000-8000-000000000009';

-- Firm A: Ana (owner, sócia). Firm B: Davi (owner, advogado).
insert into public.organizations (id, name, slug, created_by) values
  ('b5000000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'a5000000-0000-4000-8000-000000000001'),
  ('b5000000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'a5000000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b5000000-0000-4000-8000-00000000000a', 'a5000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b5000000-0000-4000-8000-00000000000b', 'a5000000-0000-4000-8000-000000000004', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal1')
returns void language sql as
$$
  select set_config(
    'request.jwt.claims',
    jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text,
    true
  );
$$;

create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;

create function pg_temp.cost(model text, tokens_in bigint, tokens_out bigint, audio bigint default 0, at timestamptz default now())
returns bigint language sql as
$$ select c.cost_usd_micros from public.ai_spend_cost(model, tokens_in, tokens_out, audio, at) c; $$;

create function pg_temp.priced(model text) returns boolean language sql as
$$ select c.priced from public.ai_spend_cost(model, 1000, 1000) c; $$;

-- ---------- The book the platform ships ----------

select ok(
  (select public.ai_price_rate(p -> 'inPerMillion') = 4 and public.ai_price_rate(p -> 'outPerMillion') = 20
   from (select public.ai_model_price('claude-opus-5-5') p) x),
  'Claude Opus 5.5 is priced at 4 dollars in and 20 out per million tokens'
);
select ok(
  (select public.ai_price_rate(p -> 'inPerMillion') = 2 and public.ai_price_rate(p -> 'outPerMillion') = 10
   from (select public.ai_model_price('claude-sonnet-5-5') p) x),
  'Claude Sonnet 5.5 at 2 and 10'
);
select ok(
  (select public.ai_price_rate(p -> 'inPerMillion') = 0.10
          and (p -> 'longContext' ->> 'aboveTokensIn')::int = 100000
          and public.ai_price_rate(p -> 'longContext' -> 'inPerMillion') = 0.50
          and public.ai_price_rate(p -> 'longContext' -> 'outPerMillion') = 2.50
   from (select public.ai_model_price('claude-haiku-5-5') p) x),
  'Claude Haiku 5.5 at 0.10 and 0.50, and 0.50 and 2.50 for a prompt over 100,000 tokens'
);
select ok(
  pg_temp.cost('gemini-3.6-flash', 1000000, 1000000, 0, '2026-10-22 12:00+00') = 4500000
    and pg_temp.cost('gemini-3.6-flash', 1000000, 1000000, 0, '2027-01-01 00:00+00') = 9000000,
  'Gemini 3.6 Flash at 0.75 and 3.75 until the end of 2026, and doubled from 1 January 2027'
);
select ok(
  (select bool_and(p ->> 'source' like 'https://%' and p ->> 'checkedOn' = '2026-10-22')
   from (select public.ai_model_price(m) p from unnest(array['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5', 'gemini-3.6-flash']) m) x),
  'each model says the page its prices were read on, and the day'
);

-- ---------- Rates as the vendors bill them ----------

update public.platform_settings
set value = jsonb_build_object('models', jsonb_build_object(
  'modelo-base', '{"inPerMillion": 3, "outPerMillion": 15}'::jsonb,
  'modelo-faixa', '{"inPerMillion": 0.10, "outPerMillion": 0.50, "longContext": {"aboveTokensIn": 100000, "inPerMillion": 0.50, "outPerMillion": 2.50}}'::jsonb,
  'modelo-datas', '{"inPerMillion": 0.75, "outPerMillion": 3.75, "changes": [{"from": "2027-01-01", "inPerMillion": 1.50, "outPerMillion": 7.50}, {"from": "2026-13-45", "inPerMillion": 99}, {"from": "amanhã", "inPerMillion": 99}]}'::jsonb,
  'modelo-audio', '{"inPerMillion": 1, "outPerMillion": 2, "audioInPerMillion": 5}'::jsonb,
  'modelo-torto', '{"inPerMillion": "abc", "outPerMillion": -1}'::jsonb,
  'modelo-virgula', '{"inPerMillion": "0,30", "outPerMillion": "1.5"}'::jsonb
))
where key = 'ai_prices';

select is(pg_temp.cost('modelo-base', 1000, 500), 10500::bigint, 'a price per million in dollars is the price per token in micros');
select is(
  pg_temp.cost('modelo-faixa', 100000, 1000), 10500::bigint,
  'a prompt of exactly the threshold pays the usual rates'
);
select is(
  pg_temp.cost('modelo-faixa', 100001, 1000), 52501::bigint,
  'one token over it, the whole request pays the other rates, output included'
);
select is(
  pg_temp.cost('modelo-faixa', 90000, 0, 20000), 55000::bigint,
  'the audio counts towards the threshold, and is priced at the rates of the request'
);
select ok(
  pg_temp.cost('modelo-datas', 1000, 1000, 0, '2026-12-31 23:59+00') = 4500
    and pg_temp.cost('modelo-datas', 1000, 1000, 0, '2027-01-01 00:00+00') = 9000,
  'a change takes effect on its day, read in UTC'
);
select is(
  pg_temp.cost('modelo-datas', 1000, 0, 0, '2099-01-01 00:00+00'), 1500::bigint,
  'a change whose day is not a date (13th month, a word) is laid over nothing, and no change of the future arrives early'
);
select is(pg_temp.cost('modelo-audio', 1000, 1000, 1000), 8000::bigint, 'audio at its own rate where the vendor prices it apart');
select is(pg_temp.cost('modelo-base', 0, 0, 1000), 3000::bigint, 'and at the input rate where it does not');
select ok(
  not pg_temp.priced('modelo-torto') and pg_temp.cost('modelo-torto', 1000, 1000) = 0,
  'a rate that is not a number, or is negative, prices nothing'
);
select ok(
  pg_temp.priced('modelo-virgula') and pg_temp.cost('modelo-virgula', 1000, 1000) = 1500,
  'a rate written with a comma is not read as a number, and the other side still prices'
);
select ok(not pg_temp.priced('modelo-que-ninguem-precificou'), 'a model the book does not name is unpriced');

-- ---------- A run, closed with what it heard ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('start_a', public.start_ai_run(
  'b5000000-0000-4000-8000-00000000000a', 'plataforma.verificacao', repeat('a', 64),
  'a5000000-0000-4000-8000-000000000001', null, null, 'precos-0001'
));
insert into res values ('start_b', public.start_ai_run(
  'b5000000-0000-4000-8000-00000000000b', 'plataforma.verificacao', repeat('b', 64),
  'a5000000-0000-4000-8000-000000000004', null, null, 'precos-0002'
));
insert into res values ('finish_a', public.finish_ai_run(
  target_run => ((select payload from res where name = 'start_a') ->> 'run_id')::uuid,
  target_status => 'succeeded',
  target_output => '{"resposta": "Recebido."}',
  target_tokens_in => 1000,
  target_tokens_out => 1000,
  target_model => 'modelo-audio',
  target_audio_tokens_in => 1000
));
-- The positional call of every caller before 0043 still means what it meant.
insert into res values ('finish_b', public.finish_ai_run(
  ((select payload from res where name = 'start_b') ->> 'run_id')::uuid, 'succeeded',
  '{"resposta": "Recebido."}', 1000, 500, 'modelo-base'
));
reset role;

select ok(
  (select (payload ->> 'cost_usd_micros')::bigint = 8000 and (payload ->> 'priced')::boolean from res where name = 'finish_a'),
  'a run is priced with the audio it heard'
);
select ok(
  (select r.audio_tokens_in = 1000 and r.cost_usd_micros = 8000 and s.audio_tokens_in = 1000 and s.cost_usd_micros = 8000
          and s.org_id = 'b5000000-0000-4000-8000-00000000000a'
   from public.ai_runs r join public.ai_spend s on s.id = r.spend_id
   where r.id = ((select payload from res where name = 'start_a') ->> 'run_id')::uuid),
  'the audio is kept on the run and on its line of the ledger, charged to its firm'
);
select ok(
  (select (payload ->> 'cost_usd_micros')::bigint = 10500 from res where name = 'finish_b')
    and (select s.org_id = 'b5000000-0000-4000-8000-00000000000b' and s.audio_tokens_in = 0
         from public.ai_spend s
         where s.ref_id = ((select payload from res where name = 'start_b') ->> 'run_id')::uuid),
  'a call that names seven arguments or fewer is closed as before, charged to the other firm'
);

-- ---------- Pricing again ----------

update public.platform_settings
set value = jsonb_set(value, '{models,modelo-base}', '{"inPerMillion": 6, "outPerMillion": 30}'::jsonb)
where key = 'ai_prices';

select pg_temp.sign_in('a5000000-0000-4000-8000-000000000009', 'aal2');
set local role authenticated;
insert into res values ('repriced', to_jsonb(public.reprice_ai_spend()));
reset role;

select ok(
  (select payload::int >= 1 from res where name = 'repriced')
    and (select r.cost_usd_micros = 21000 and s.cost_usd_micros = 21000
         from public.ai_runs r join public.ai_spend s on s.id = r.spend_id
         where r.id = ((select payload from res where name = 'start_b') ->> 'run_id')::uuid),
  'a new price reaches the ledger and the run alike'
);

-- ---------- Neither firm reads the book ----------

select pg_temp.sign_in('a5000000-0000-4000-8000-000000000001', 'aal2');
set local role authenticated;
select throws_ok(
  $$select public.ai_model_price('modelo-base')$$,
  '42501', null,
  'a member of a firm cannot read the price of a model'
);
select throws_ok(
  $$select * from public.ai_spend_cost('modelo-base', 1, 1)$$,
  '42501', null,
  'nor price a call'
);
select is(
  (select count(*)::int from public.platform_settings where key = 'ai_prices'), 0,
  'nor read the price book'
);
select throws_ok(
  $$select public.reprice_ai_spend()$$,
  'P0001', 'not_authorized',
  'nor price the ledger again'
);
reset role;

select * from finish();
rollback;
