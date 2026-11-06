begin;
create extension if not exists pgtap;
select plan(4);

-- ============================================================
-- ONE triages again what the AI answered in the shadow before it said how
-- sure it is (0105): a publication nobody triaged, whose answer says nothing
-- of certainty, of a whole text in force captured within the days ONE reads,
-- in a firm that lets ONE triage, is put back in front of ONE's triage;
-- anything else is left as it is. Two firms.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1060000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@denovo.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1060000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@denovo.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1060000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-denovo', 'a1060000-0000-4000-8000-000000000001'),
  ('b1060000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-denovo', 'a1060000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1060000-0000-4000-8000-00000000000a', 'a1060000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1060000-0000-4000-8000-00000000000b', 'a1060000-0000-4000-8000-000000000002', 'owner', 'advogado');
-- Firm B keeps the triage to a person.
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b1060000-0000-4000-8000-00000000000b', 'publication_triage', 'approval');

-- A1: answered in the shadow with no certainty. A2: answered not sure. A3: triaged by a person. A4: old. A5: cut
-- short. B1: of the firm that triages itself.
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body, truncated, captured_at)
select ('ce106000-0000-4000-8000-0000000000' || n)::uuid, org::uuid, 'denovo00000000' || n, 'TJGO',
       '50002023920998090051', current_date, 'Intimação', 'Texto inventado ' || n, n = 'a5',
       case when n = 'a4' then now() - interval '10 days' else now() end
from (values
  ('a1', 'b1060000-0000-4000-8000-00000000000a'), ('a2', 'b1060000-0000-4000-8000-00000000000a'),
  ('a3', 'b1060000-0000-4000-8000-00000000000a'), ('a4', 'b1060000-0000-4000-8000-00000000000a'),
  ('a5', 'b1060000-0000-4000-8000-00000000000a'), ('b1', 'b1060000-0000-4000-8000-00000000000b')
) as p (n, org);

create function pg_temp.pub(n text) returns uuid language sql as
$$ select ('ce106000-0000-4000-8000-0000000000' || n)::uuid; $$;
-- An answer the AI gave a publication, kept beside it as the shadow kept it: with or without its certainty.
create function pg_temp.answered(n text, said jsonb) returns void language plpgsql as $$
declare
  run uuid := gen_random_uuid();
  org uuid := (select org_id from public.publications where id = pg_temp.pub(n));
begin
  insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, status, output,
                              subject_type, subject_id, finished_at)
  select run, org, 'publicacao.triagem', v.id, v.provider, v.model, repeat('d', 64), 'succeeded', said,
         'publication', pg_temp.pub(n)::text, now()
  from public.prompt_versions v where v.task = 'publicacao.triagem' and v.is_active;
  update public.publications set ai_category = said ->> 'categoria', ai_urgent = false, ai_run_id = run, ai_attempts = 1
  where id = pg_temp.pub(n);
end;
$$;

select pg_temp.answered(n, '{"categoria": "audiencia", "urgente": false, "resumo": "Uma frase."}'::jsonb)
from unnest(array['a1', 'a3', 'a4', 'a5', 'b1']) as n;
select pg_temp.answered('a2', '{"categoria": "prazo", "certeza": "baixa", "urgente": false, "resumo": "Uma frase."}'::jsonb);
update public.publications set category = 'audiencia', triaged_by = 'a1060000-0000-4000-8000-000000000001',
  triaged_at = now() where id = pg_temp.pub('a3');

select ok(
  not has_function_privilege('authenticated', 'public.reopen_unsure_triage()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.reopen_unsure_triage()', 'EXECUTE'),
  'only the backend puts a publication back in front of ONE''s triage'
);

select is(public.reopen_unsure_triage(), 1, 'one publication is put back: the one answered with no word on certainty');

select ok(
  (select ai_category is null and ai_run_id is null and ai_attempts = 0 and category is null
   from public.publications where id = pg_temp.pub('a1'))
  and (select ai_category = 'prazo' from public.publications where id = pg_temp.pub('a2'))
  and (select ai_category = 'audiencia' and category = 'audiencia' from public.publications where id = pg_temp.pub('a3'))
  and (select ai_category is not null from public.publications where id = pg_temp.pub('a4'))
  and (select ai_category is not null from public.publications where id = pg_temp.pub('a5'))
  and (select ai_category is not null from public.publications where id = pg_temp.pub('b1')),
  'an answer not sure, a person''s triage, an old one, a text cut short and a firm that triages itself are left as they are'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
select is(
  (select count(*)::integer from public.claim_publication_triage(1, pg_temp.pub('a1'))),
  1,
  'the sweep asks the AI again of the one put back'
);
reset role;

select * from finish();
rollback;
