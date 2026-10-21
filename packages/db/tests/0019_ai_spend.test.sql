begin;
create extension if not exists pgtap with schema extensions;
select plan(16);

-- ============================================================
-- What the platform's use of AI costs (0014).
--
-- One row per model call, charged to the firm it was made for. Only the
-- backend writes the ledger; prices are configuration, and a call with no
-- price is recorded as unpriced, never as free. Two firms: the spend of one
-- is never the other's.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('af000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'socia@teste.invalid', '', now(), '{}', '{"display_name":"Sócia"}', now(), now()),
  ('af000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now()),
  ('af000000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'outra@teste.invalid', '', now(), '{}', '{"display_name":"Outra"}', now(), now());

update public.profiles set is_superadmin = true where id = 'af000000-0000-4000-8000-000000000002';

insert into public.organizations (id, name, slug, created_by) values
  ('bf000000-0000-4000-8000-00000000000a', 'Escritório A', 'escritorio-a', 'af000000-0000-4000-8000-000000000001'),
  ('bf000000-0000-4000-8000-00000000000b', 'Escritório B', 'escritorio-b', 'af000000-0000-4000-8000-000000000003');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bf000000-0000-4000-8000-00000000000a', 'af000000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('bf000000-0000-4000-8000-00000000000b', 'af000000-0000-4000-8000-000000000003', 'owner', 'socio');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated, service_role;

-- ---------- Who writes the ledger ----------

select set_config('request.jwt.claims', '{"sub":"af000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.record_ai_spend('bf000000-0000-4000-8000-00000000000a', 'other', 'anthropic', 'modelo-x', 10, 10)$$,
  '42501', null,
  'a person cannot record a spend, not even for their own firm'
);
select throws_ok(
  $$insert into public.ai_spend (org_id, feature, provider, model) values ('bf000000-0000-4000-8000-00000000000a', 'other', 'anthropic', 'modelo-x')$$,
  '42501', null,
  'nor write the ledger directly'
);
reset role;

-- ---------- Unpriced is not free ----------

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('first', to_jsonb(public.record_ai_spend(
  'bf000000-0000-4000-8000-00000000000a', 'triagem.documento', 'anthropic', 'modelo-x', 1000, 500, 'cf000000-0000-4000-8000-000000000001')));
insert into res values ('odd_feature', to_jsonb(public.record_ai_spend(
  'bf000000-0000-4000-8000-00000000000a', 'Texto Livre com espaços', 'anthropic', 'modelo-sem-preco', 5, 5)));
reset role;

select ok(
  (select not priced and cost_usd_micros = 0 and feature = 'triagem.documento' and tokens_in = 1000 and tokens_out = 500
          and ref_id = 'cf000000-0000-4000-8000-000000000001' and created_by is null
   from public.ai_spend where id = (select (payload #>> '{}')::uuid from res where name = 'first')),
  'a call whose model has no price is recorded as unpriced, with its tokens and what it belongs to'
);
select is(
  (select feature from public.ai_spend where id = (select (payload #>> '{}')::uuid from res where name = 'odd_feature')),
  'other',
  'what the money bought is a slug: anything else is filed as "other"'
);

-- ---------- Prices are configuration ----------

select set_config('request.jwt.claims', '{"sub":"af000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
update public.platform_settings
set value = '{"usdToBrl": 5.5, "models": {"modelo-x": {"inPerMillion": 3, "outPerMillion": 15}}}'::jsonb
where key = 'ai_prices';
insert into res values ('repriced', to_jsonb(public.reprice_ai_spend()));
reset role;

select is((select payload from res where name = 'repriced'), '1'::jsonb, 'saving the price list re-prices what was recorded before it');
select ok(
  (select priced and cost_usd_micros = 10500
   from public.ai_spend where id = (select (payload #>> '{}')::uuid from res where name = 'first')),
  'at the price per token: 1000 in at 3 and 500 out at 15 dollars per million is 10500 micros'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('platform', to_jsonb(public.record_ai_spend(null, 'other', 'anthropic', 'modelo-x', 2000000, 0)));
insert into res values ('firm_b', to_jsonb(public.record_ai_spend('bf000000-0000-4000-8000-00000000000b', 'minuta', 'anthropic', 'modelo-x', 100, 100)));
reset role;

select ok(
  (select priced and cost_usd_micros = 6000000 and org_id is null
   from public.ai_spend where id = (select (payload #>> '{}')::uuid from res where name = 'platform')),
  'a call made for no firm is platform overhead, priced the same way'
);

-- ---------- Who reads it ----------

select set_config('request.jwt.claims', '{"sub":"af000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is((select count(*)::int from public.ai_spend), 0, 'a person does not read the ledger');
select throws_ok(
  $$select public.admin_ai_spend_overview(30)$$,
  'P0001', 'not_authorized',
  'nor its totals'
);
select throws_ok(
  $$select public.reprice_ai_spend()$$,
  'P0001', 'not_authorized',
  'nor re-prices it'
);
select is(
  (select count(*)::int from public.platform_settings where key = 'ai_prices'),
  0,
  'the price list itself is not public'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"af000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
insert into res values ('overview', public.admin_ai_spend_overview(30));
reset role;

select ok(
  (select (payload -> 'totals' ->> 'calls')::int = 4
          and (payload -> 'totals' ->> 'unpricedCalls')::int = 1
          and (payload -> 'totals' ->> 'costUsdMicros')::bigint = 10500 + 6000000 + 1800
          and (payload ->> 'pricedModels')::int = 1
          and (payload ->> 'usdToBrl')::numeric = 5.5
   from res where name = 'overview'),
  'the operator sees the total with the count of unpriced calls beside it'
);
select is(
  (select array_agg(entry ->> 'feature' order by entry ->> 'feature') from res, jsonb_array_elements(payload -> 'byFeature') entry where name = 'overview'),
  array['minuta', 'other', 'triagem.documento'],
  'broken down by what the money bought'
);
select is(
  (select jsonb_agg(
            jsonb_build_object('name', entry.item -> 'name', 'cost', entry.item -> 'costUsdMicros',
                               'calls', entry.item -> 'calls', 'unpriced', entry.item -> 'unpricedCalls')
            order by entry.ord
          )
   from res, jsonb_array_elements(payload -> 'byFirm') with ordinality as entry (item, ord)
   where name = 'overview'),
  '[{"name": null, "cost": 6000000, "calls": 1, "unpriced": 0},
    {"name": "Escritório A", "cost": 10500, "calls": 2, "unpriced": 1},
    {"name": "Escritório B", "cost": 1800, "calls": 1, "unpriced": 0}]'::jsonb,
  'and by the firm each call was made for, the platform''s own calls apart'
);
select is(
  (select (payload ->> 'firmsWithSpend')::int from res where name = 'overview'), 2,
  'with the count of firms that cost something, so a cut list is not read as all of them'
);

-- ---------- Each firm its own ----------

select is(
  (select array_agg(org_id::text || ':' || feature order by feature) from public.ai_spend where org_id is not null),
  array[
    'bf000000-0000-4000-8000-00000000000b:minuta',
    'bf000000-0000-4000-8000-00000000000a:other',
    'bf000000-0000-4000-8000-00000000000a:triagem.documento'
  ],
  'every call is charged to the firm it was made for'
);

select * from finish();
rollback;
