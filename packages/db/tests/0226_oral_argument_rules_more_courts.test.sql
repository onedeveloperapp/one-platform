begin;
create extension if not exists pgtap;
select plan(5);

-- ============================================================
-- As regras de sustentação oral do TJSP, do TJRJ e do TJMG (0226). A
-- virtual session of the TJSP's Colégio Recursal is counted 48 hours before
-- its start; one of the TJMG's turmas recursais from the publication of its
-- pauta, with the day it was made available; one of the TJRJ's turmas
-- recursais has no rule, which ONE says. A rule with no numbers for its kind
-- is refused, and only the backend reads what is to count. Two firms:
-- nothing of one reaches the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a2260000-0000-4000-8000-000000000001', 'ana@souza-regras.invalid', 'Ana Souza'),
  ('a2260000-0000-4000-8000-000000000002', 'caio@rocha-regras.invalid', 'Caio Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b2260000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-regras', 'a2260000-0000-4000-8000-000000000001'),
  ('b2260000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-regras', 'a2260000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2260000-0000-4000-8000-00000000000a', 'a2260000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2260000-0000-4000-8000-00000000000b', 'a2260000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, module, incident, status) values
  ('c2260000-0000-4000-8000-000000000001', 'b2260000-0000-4000-8000-00000000000a', 1, 'direito-do-passageiro', 'delay', 'filed'),
  ('c2260000-0000-4000-8000-000000000002', 'b2260000-0000-4000-8000-00000000000a', 2, 'direito-do-passageiro', 'delay', 'filed'),
  ('c2260000-0000-4000-8000-000000000003', 'b2260000-0000-4000-8000-00000000000b', 1, 'direito-do-passageiro', 'delay', 'filed');
insert into public.proceedings (id, org_id, case_id, kind, court, status, cnj, filed_at) values
  ('f2260000-0000-4000-8000-000000000001', 'b2260000-0000-4000-8000-00000000000a', 'c2260000-0000-4000-8000-000000000001',
   'juizado', 'TJSP', 'filed', '10003015320998260100', '2025-08-01'),
  ('f2260000-0000-4000-8000-000000000002', 'b2260000-0000-4000-8000-00000000000a', 'c2260000-0000-4000-8000-000000000002',
   'juizado', 'TJMG', 'filed', '10003011620998130100', '2025-08-01'),
  ('f2260000-0000-4000-8000-000000000003', 'b2260000-0000-4000-8000-00000000000b', 'c2260000-0000-4000-8000-000000000003',
   'juizado', 'TJRJ', 'filed', '10003014820998190100', '2025-08-01');
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, document_type, body, proceeding_id, case_id,
                                 category, triaged_at) values
  ('ce226000-0000-4000-8000-0000000000a1', 'b2260000-0000-4000-8000-00000000000a', 'regrasone0000a1', 'TJMG',
   '10003011620998130100', current_date, 'Intimação', 'Pauta', 'Intimação da pauta. Processo retirado de pauta.',
   'f2260000-0000-4000-8000-000000000002', 'c2260000-0000-4000-8000-000000000002', 'ciencia', now());
insert into public.judgment_sessions (org_id, case_id, proceeding_id, publication_id, kind, starts_on, starts_at, source) values
  ('b2260000-0000-4000-8000-00000000000a', 'c2260000-0000-4000-8000-000000000001', 'f2260000-0000-4000-8000-000000000001',
   null, 'virtual', current_date + 10, '10:00', 'person'),
  ('b2260000-0000-4000-8000-00000000000a', 'c2260000-0000-4000-8000-000000000002', 'f2260000-0000-4000-8000-000000000002',
   'ce226000-0000-4000-8000-0000000000a1', 'virtual', current_date + 20, null, 'publication'),
  ('b2260000-0000-4000-8000-00000000000b', 'c2260000-0000-4000-8000-000000000003', 'f2260000-0000-4000-8000-000000000003',
   null, 'virtual', current_date + 10, null, 'person');

create temp table res (key text primary key, value jsonb) on commit drop;
grant all on res to authenticated, service_role, anon;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res select 'count', jsonb_object_agg(t.court, to_jsonb(t)) from public.sessions_to_count(20) t
  where t.session_id in (select s.id from public.judgment_sessions s
                         where s.proceeding_id in ('f2260000-0000-4000-8000-000000000001', 'f2260000-0000-4000-8000-000000000002',
                                                   'f2260000-0000-4000-8000-000000000003'));
reset role;

select ok(
  (select value #>> '{TJSP,until_kind}' = 'hours_before' and (value #>> '{TJSP,until_hours}')::integer = 48
          and value #>> '{TJSP,until_anchor}' = 'session' and value #>> '{TJSP,basis}' like 'Resolução nº 984/2025%'
   from res where key = 'count'),
  'a virtual session of the TJSP''s Colégio Recursal is counted 48 hours before its start'
);

select ok(
  (select value #>> '{TJMG,until_kind}' = 'days_after_publication' and (value #>> '{TJMG,until_days}')::integer = 5
          and value #>> '{TJMG,until_counting}' = 'business' and value #>> '{TJMG,published_on}' = current_date::text
   from res where key = 'count'),
  'one of the TJMG''s turmas recursais is counted from the publication of its pauta, with its day'
);

select ok(
  (select value #>> '{TJRJ,until_kind}' is null and value ? 'TJRJ' from res where key = 'count'),
  'one of the TJRJ''s turmas recursais has no rule, for ONE to say so'
);

select throws_ok(
  $$ insert into public.oral_argument_rules (court, body, session_kind, until_kind, basis)
     values ('TJBA', 'tribunal', 'virtual', 'hours_before', 'Regra sem as horas') $$,
  '23514', null,
  'a rule with no numbers for its kind is refused'
);

select set_config('request.jwt.claims', jsonb_build_object('sub', 'a2260000-0000-4000-8000-000000000002', 'role', 'authenticated')::text, true);
set local role authenticated;
select throws_ok(
  $$ select * from public.sessions_to_count(20) $$,
  '42501', null,
  'only the backend reads what is to count, never a firm''s member'
);
reset role;

select * from finish();
rollback;
