begin;
create extension if not exists pgtap;
select plan(15);

-- ============================================================
-- What ONE now carries on by itself where the firm said how (0052): the
-- claim a firm asks by default for each kind of problem, written by ONE for
-- a claimant nobody set a claim for (never over one a person wrote); and who
-- signs in a state where nobody of the firm is at the bar, within the five
-- causes a year a lawyer may take there without a supplementary
-- registration. Two firms.
--
-- Every person, firm and CPF here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a5800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a5800000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a5800000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@souza.invalid', '', now(), '{}', '{"display_name":"Davi Melo"}', now(), now()),
  ('a5800000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a5800000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());
update public.profiles set is_superadmin = true where id = 'a5800000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('b5800000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-seguir', 'a5800000-0000-4000-8000-000000000001'),
  ('b5800000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-seguir', 'a5800000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b5800000-0000-4000-8000-00000000000a', 'a5800000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b5800000-0000-4000-8000-00000000000a', 'a5800000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b5800000-0000-4000-8000-00000000000a', 'a5800000-0000-4000-8000-000000000003', 'member', 'advogado'),
  ('b5800000-0000-4000-8000-00000000000b', 'a5800000-0000-4000-8000-000000000004', 'owner', 'socio');
-- Nobody of firm A is at the bar in Goiás: Ana in Rio de Janeiro, Bia in São Paulo, Davi in Minas Gerais.
-- Caio, of firm B, is in Goiás.
insert into public.oab_registrations (user_id, uf, number, kind) values
  ('a5800000-0000-4000-8000-000000000001', 'RJ', '58001', 'principal'),
  ('a5800000-0000-4000-8000-000000000002', 'SP', '58002', 'principal'),
  ('a5800000-0000-4000-8000-000000000003', 'MG', '58003', 'principal'),
  ('a5800000-0000-4000-8000-000000000004', 'GO', '58004', 'principal');
-- Ana and Bia sign what ONE prepares for firm A, Ana first; Davi does not. Caio signs for firm B.
insert into public.firm_signers (org_id, user_id, added_by, added_at) values
  ('b5800000-0000-4000-8000-00000000000a', 'a5800000-0000-4000-8000-000000000001', 'a5800000-0000-4000-8000-000000000001', now() - interval '2 days'),
  ('b5800000-0000-4000-8000-00000000000a', 'a5800000-0000-4000-8000-000000000002', 'a5800000-0000-4000-8000-000000000001', now() - interval '1 day'),
  ('b5800000-0000-4000-8000-00000000000b', 'a5800000-0000-4000-8000-000000000004', 'a5800000-0000-4000-8000-000000000004', now());

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2', session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level, 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- A case of a cancellation for an adult of Goiânia, with a leg of the trip and no claim.
create function pg_temp.unclaimed_case(org uuid, cpf text) returns jsonb language plpgsql as $$
declare
  made jsonb := public.create_case(org, 'cancellation', 'LA', date '2026-10-24',
    jsonb_build_object('full_name', 'Mariana Teste', 'cpf', cpf, 'birth_date', '1990-05-02',
      'city', 'Goiânia', 'uf', 'GO'));
begin
  perform public.save_flight_segment((made ->> 'case_id')::uuid, null,
    '{"flight_number": "LA 3456", "origin_iata": "GRU", "destination_iata": "REC", "affected": true}'::jsonb);
  return made;
end;
$$;
create function pg_temp.claim(target uuid) returns jsonb language sql as $$
  select coalesce((public.claim_case_advances(1, target) -> 'claimed') -> 0, '{}'::jsonb);
$$;
create function pg_temp.plan(party uuid) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'fields', jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'comarca', 'Goiânia', 'forum_basis', 'domicile',
      'forum_city', 'Goiânia', 'system', 'projudi'),
    'parties', jsonb_build_array(party)));
$$;
-- An invented case number of a year to come, with its check digits (Resolução CNJ 65/2008).
create function pg_temp.cnj(n integer) returns text language sql as $$
  select lpad(n::text, 7, '0')
    || lpad((98 - ((lpad(n::text, 7, '0') || '2099809' || '0051')::numeric * 100 % 97))::text, 2, '0')
    || '2099809' || '0051';
$$;
-- A lawsuit of a firm in Goiás signed by a lawyer, planned, or filed on a day (numbered n).
create function pg_temp.lawsuit_of(org uuid, case_id uuid, signer uuid, status text, filed date default null,
  n integer default 0)
returns void language plpgsql as $$
declare
  made uuid;
begin
  insert into public.proceedings (org_id, case_id, kind, court, status, cnj, filed_at)
  values (org, case_id, 'juizado', 'TJGO', status, case when status = 'planned' then null else pg_temp.cnj(n) end, filed)
  returning id into made;
  insert into public.proceeding_lawyers (proceeding_id, user_id, org_id) values (made, signer, org);
end;
$$;

-- ---------- The claim a firm asks by default ----------

select pg_temp.sign_in('a5800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_1', pg_temp.unclaimed_case('b5800000-0000-4000-8000-00000000000a', '12345678909'));
insert into res values ('case_2', pg_temp.unclaimed_case('b5800000-0000-4000-8000-00000000000a', '52998224725'));
-- Case 2's claimant has the claim a person wrote.
select public.set_party_claim(pg_temp.got('case_2', 'case_id')::uuid, pg_temp.got('case_2', 'party_id')::uuid, 1500000);
reset role;
select pg_temp.sign_in('a5800000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', pg_temp.unclaimed_case('b5800000-0000-4000-8000-00000000000b', '12345678909'));
reset role;

-- Bia is a lawyer, not a partner; Ana without the second factor; then amounts and kinds that are none.
select pg_temp.sign_in('a5800000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('bia_sets', public.set_firm_claim_default('b5800000-0000-4000-8000-00000000000a', 'cancellation', 1000000));
reset role;
select pg_temp.sign_in('a5800000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
select throws_ok(
  $$select public.set_firm_claim_default('b5800000-0000-4000-8000-00000000000a', 'cancellation', 1000000)$$,
  '42501', 'second_factor_required',
  'a partner says the firm''s default claim with the second factor'
);
reset role;
select pg_temp.sign_in('a5800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('no_kind', public.set_firm_claim_default('b5800000-0000-4000-8000-00000000000a', 'meteor', 1000000));
insert into res values ('no_amount', public.set_firm_claim_default('b5800000-0000-4000-8000-00000000000a', 'cancellation', 0));
reset role;

select ok(
  pg_temp.got('bia_sets', 'code') = 'not_a_partner'
  and pg_temp.got('no_kind', 'code') = 'invalid_incident'
  and pg_temp.got('no_amount', 'code') = 'invalid_amount'
  and not exists (select 1 from public.firm_claim_defaults),
  'only a partner says a default claim, of a kind of problem the case knows and an amount a claim may be'
);

-- Support visits Ana: no default is said in her name.
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a5800000-0000-4000-8000-000000000009', 'a5800000-0000-4000-8000-000000000001', 'b5800000-0000-4000-8000-00000000000a',
        'Conferindo o valor do pedido', 'f5800000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a5800000-0000-4000-8000-000000000001', 'aal2', 'f5800000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.set_firm_claim_default('b5800000-0000-4000-8000-00000000000a', 'cancellation', 1000000)$$,
  '42501', 'not_allowed_in_support_session',
  'a support visit says no default claim'
);
reset role;

-- Case 1 waits for its claim, as ONE left it.
select pg_temp.as_backend();
update public.case_advances set waiting = 'claims_missing', after = now() + interval '6 hours', woken_at = null,
  claimed_at = null
where case_id in (pg_temp.got('case_1', 'case_id')::uuid, pg_temp.got('case_b', 'case_id')::uuid);

select pg_temp.sign_in('a5800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('saved', public.set_firm_claim_default('b5800000-0000-4000-8000-00000000000a', 'cancellation', 1000000));
insert into res values ('again', public.set_firm_claim_default('b5800000-0000-4000-8000-00000000000a', 'cancellation', 1000000));
insert into res values ('read_a', (select coalesce(jsonb_agg(incident), '[]') from public.firm_claim_defaults));
reset role;
select pg_temp.sign_in('a5800000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('read_b', (select coalesce(jsonb_agg(incident), '[]') from public.firm_claim_defaults));
reset role;

select ok(
  pg_temp.got('saved', 'code') = 'saved' and pg_temp.got('again', 'code') = 'unchanged'
  and (select payload = '["cancellation"]'::jsonb from res where name = 'read_a')
  and (select payload = '[]'::jsonb from res where name = 'read_b')
  and (select count(*) = 1 from public.audit_events where action = 'firm.claim_default_set'
       and org_id = 'b5800000-0000-4000-8000-00000000000a' and entity_id = 'cancellation'
       and (metadata ->> 'to')::bigint = 1000000),
  'a partner says the firm''s default claim for a kind of problem, on the record; anybody of the firm reads it, nobody of another'
);

select ok(
  (select after is null and woken_at is not null from public.case_advances
   where case_id = pg_temp.got('case_1', 'case_id')::uuid)
  and (select after > now() from public.case_advances where case_id = pg_temp.got('case_b', 'case_id')::uuid),
  'the firm''s cases that waited for a claim are looked at again; another firm''s are not'
);

-- ---------- ONE writes the default ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_1', pg_temp.claim(pg_temp.got('case_1', 'case_id')::uuid));
insert into res values ('wrong_claim', public.advance_claim_defaults(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_1', 'claim')::integer + 7));
insert into res values ('filled_1', public.advance_claim_defaults(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_1', 'claim')::integer));
insert into res values ('claim_2', pg_temp.claim(pg_temp.got('case_2', 'case_id')::uuid));
insert into res values ('filled_2', public.advance_claim_defaults(pg_temp.got('case_2', 'case_id')::uuid,
  pg_temp.got('claim_2', 'claim')::integer));
insert into res values ('claim_b', pg_temp.claim(pg_temp.got('case_b', 'case_id')::uuid));
insert into res values ('filled_b', public.advance_claim_defaults(pg_temp.got('case_b', 'case_id')::uuid,
  pg_temp.got('claim_b', 'claim')::integer));
reset role;

select ok(
  pg_temp.got('wrong_claim', 'code') = 'not_working'
  and pg_temp.got('filled_1', 'applied')::integer = 1
  and (select claim_cents = 1000000 from public.case_parties where id = pg_temp.got('case_1', 'party_id')::uuid),
  'ONE writes the firm''s default for the case''s kind of problem as the claim of a claimant nobody set, only under the claim it holds'
);

select ok(
  exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_1', 'case_id')::uuid
          and e.kind = 'claim_defaulted' and e.actor_type = 'system' and e.actor_id is null
          and (e.data ->> 'count')::integer = 1 and e.data ->> 'incident' = 'cancellation')
  and (select woken_at is null or woken_at < claimed_at from public.case_advances
       where case_id = pg_temp.got('case_1', 'case_id')::uuid),
  'the timeline says ONE used the firm''s default, and ONE''s own write wakes nothing'
);

select ok(
  pg_temp.got('filled_2', 'applied')::integer = 0
  and (select claim_cents = 1500000 from public.case_parties where id = pg_temp.got('case_2', 'party_id')::uuid)
  and not exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_2', 'case_id')::uuid
                  and e.kind = 'claim_defaulted'),
  'a claim a person wrote is never changed'
);

select ok(
  pg_temp.got('filled_b', 'code') = 'no_default' and pg_temp.got('filled_b', 'applied')::integer = 0
  and (select claim_cents is null from public.case_parties where id = pg_temp.got('case_b', 'party_id')::uuid),
  'a firm with no default has nothing written: another firm''s default is never used'
);

-- ---------- Who signs in a state where nobody of the firm is at the bar ----------

select is(public.occasional_causes_per_year(), 5,
  'five causes a year in a state is the most a lawyer takes there without a supplementary registration');

select pg_temp.as_backend();
set local role service_role;
insert into res values ('go_first', to_jsonb(public.firm_signers_in('b5800000-0000-4000-8000-00000000000a', 'GO')));
insert into res values ('rj_signers', to_jsonb(public.firm_signers_in('b5800000-0000-4000-8000-00000000000a', 'RJ')));
insert into res values ('go_taken', to_jsonb(public.firm_signers_in('b5800000-0000-4000-8000-00000000000a', 'GO',
  '{"a5800000-0000-4000-8000-000000000001": 5}'::jsonb)));
reset role;

select ok(
  (select payload = '["a5800000-0000-4000-8000-000000000001"]'::jsonb from res where name = 'go_first')
  and (select payload = '["a5800000-0000-4000-8000-000000000001"]'::jsonb from res where name = 'rj_signers')
  and (select payload = '["a5800000-0000-4000-8000-000000000002"]'::jsonb from res where name = 'go_taken'),
  'where nobody of the firm is at the bar in the state, ONE names the first signer who may still take a cause there; one the same run filled is passed over; a signer registered in the state is named as before'
);

-- Ana already has five causes of firm A in Goiás this year: four planned and one filed this year; one filed last
-- year does not count.
select pg_temp.lawsuit_of('b5800000-0000-4000-8000-00000000000a', pg_temp.got('case_2', 'case_id')::uuid,
  'a5800000-0000-4000-8000-000000000001', 'planned')
from generate_series(1, 4);
select pg_temp.lawsuit_of('b5800000-0000-4000-8000-00000000000a', pg_temp.got('case_2', 'case_id')::uuid,
  'a5800000-0000-4000-8000-000000000001', 'filed', (now() at time zone 'America/Sao_Paulo')::date, 5801);
select pg_temp.lawsuit_of('b5800000-0000-4000-8000-00000000000a', pg_temp.got('case_2', 'case_id')::uuid,
  'a5800000-0000-4000-8000-000000000001', 'filed',
  ((now() at time zone 'America/Sao_Paulo')::date - interval '1 year')::date, 5802);

select pg_temp.as_backend();
set local role service_role;
insert into res values ('ana_causes', to_jsonb(public.lawyer_state_causes('b5800000-0000-4000-8000-00000000000a',
  'a5800000-0000-4000-8000-000000000001', 'GO', extract(year from (now() at time zone 'America/Sao_Paulo'))::integer)));
insert into res values ('go_full', to_jsonb(public.firm_signers_in('b5800000-0000-4000-8000-00000000000a', 'GO')));
insert into res values ('b_go', to_jsonb(public.firm_signers_in('b5800000-0000-4000-8000-00000000000b', 'GO')));
reset role;

select ok(
  (select payload = '5'::jsonb from res where name = 'ana_causes')
  and (select payload = '["a5800000-0000-4000-8000-000000000002"]'::jsonb from res where name = 'go_full')
  and (select payload = '["a5800000-0000-4000-8000-000000000004"]'::jsonb from res where name = 'b_go'),
  'a signer with five causes of the firm in the state this year is passed over for the next; the firm''s causes are counted, never another firm''s'
);

-- Bia takes four more: nobody of firm A may sign another lawsuit in Goiás this year.
select pg_temp.lawsuit_of('b5800000-0000-4000-8000-00000000000a', pg_temp.got('case_2', 'case_id')::uuid,
  'a5800000-0000-4000-8000-000000000002', 'planned')
from generate_series(1, 4);

-- ONE creates case 1's lawsuit, now that it has its claim: Bia signs, the fifth cause of hers in Goiás.
update public.case_advances set woken_at = null where case_id = pg_temp.got('case_1', 'case_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('created_1', public.advance_create_lawsuits(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_1', 'claim')::integer, pg_temp.plan(pg_temp.got('case_1', 'party_id')::uuid)));
insert into res values ('go_none', to_jsonb(public.firm_signers_in('b5800000-0000-4000-8000-00000000000a', 'GO')));
reset role;

select ok(
  (pg_temp.got('created_1', 'ok'))::boolean and pg_temp.got('created_1', 'unsigned')::integer = 0
  and (select array_agg(pl.user_id) = array['a5800000-0000-4000-8000-000000000002'::uuid]
       from public.proceeding_lawyers pl join public.proceedings p on p.id = pl.proceeding_id
       where p.case_id = pg_temp.got('case_1', 'case_id')::uuid),
  'ONE creates the lawsuit signed by a lawyer of another state who may still take a cause there'
);

select ok(
  exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_1', 'case_id')::uuid
          and e.kind = 'signer_occasional' and e.actor_type = 'system'
          and e.data ->> 'uf' = 'GO' and (e.data ->> 'causes')::integer = 5 and (e.data ->> 'limit')::integer = 5),
  'the timeline says ONE named somebody of another state, and which of their five causes there this is'
);

select ok(
  (select payload = '[]'::jsonb from res where name = 'go_none'),
  'with every signer at five causes in the state this year, ONE names nobody: the lawsuit waits for a lawyer'
);

select * from finish();
rollback;
