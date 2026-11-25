begin;
create extension if not exists pgtap with schema extensions;
select plan(9);

-- ============================================================
-- The number of a lawsuit of the piece's own case is never a source it cites (0301). Firm A's petition, filed in
-- the case's own lawsuit, names it at its head and cites the CDC, which the platform's library covers: nothing holds
-- it. A manifestation of the same case also cites a lawsuit of another case of the firm, a precedent the library
-- does not cover: that one holds it, and is the only source listed as not covered and the only one taken on. Firm B
-- reads nothing of firm A's, and nobody of a firm calls the rule directly.
--
-- Every person, firm and number here is invented: the lawsuits are of 2099, with their check digits.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select id::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', email, '', now(), '{}',
       jsonb_build_object('display_name', name), now(), now()
from (values
  ('a3010000-0000-4000-8000-000000000001', 'ana@lima-proprio.invalid', 'Ana Lima'),
  ('a3010000-0000-4000-8000-000000000002', 'duda@rocha-proprio.invalid', 'Duda Rocha')
) as u (id, email, name);
insert into public.organizations (id, name, slug, created_by) values
  ('b3010000-0000-4000-8000-00000000000a', 'Lima Advocacia', 'lima-proprio', 'a3010000-0000-4000-8000-000000000001'),
  ('b3010000-0000-4000-8000-00000000000b', 'Rocha Advogados', 'rocha-proprio', 'a3010000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b3010000-0000-4000-8000-00000000000a', 'a3010000-0000-4000-8000-000000000001', 'owner', 'advogado'),
  ('b3010000-0000-4000-8000-00000000000b', 'a3010000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.cases (id, org_id, seq, incident, status) values
  ('c3010000-0000-4000-8000-00000000000a', 'b3010000-0000-4000-8000-00000000000a', 1, 'cancellation', 'drafting'),
  ('c3010000-0000-4000-8000-00000000000b', 'b3010000-0000-4000-8000-00000000000a', 2, 'delay', 'drafting');
-- The case's own lawsuit, and a lawsuit of another case of the same firm.
insert into public.proceedings (id, org_id, case_id, kind, court, cnj, status) values
  ('d3010000-0000-4000-8000-00000000000a', 'b3010000-0000-4000-8000-00000000000a', 'c3010000-0000-4000-8000-00000000000a',
   'juizado', 'TJGO', '51234564920998090051', 'filed'),
  ('d3010000-0000-4000-8000-00000000000b', 'b3010000-0000-4000-8000-00000000000a', 'c3010000-0000-4000-8000-00000000000b',
   'juizado', 'TJRJ', '76543213820998190001', 'filed');
insert into public.case_drafts (id, org_id, case_id, proceeding_id, piece_kind, template_name, template_body, mode,
                                status, version, checked_version) values
  ('e3010000-0000-4000-8000-00000000000a', 'b3010000-0000-4000-8000-00000000000a', 'c3010000-0000-4000-8000-00000000000a',
   'd3010000-0000-4000-8000-00000000000a', 'juntada', 'Petição de juntada', 'Texto do modelo da petição de juntada.',
   'blank', 'proposed', 1, 1),
  ('e3010000-0000-4000-8000-00000000000b', 'b3010000-0000-4000-8000-00000000000a', 'c3010000-0000-4000-8000-00000000000a',
   'd3010000-0000-4000-8000-00000000000a', 'manifestacao', 'Manifestação', 'Texto do modelo da manifestação do escritório.',
   'blank', 'proposed', 1, 1);
insert into public.case_draft_versions (org_id, draft_id, version, author, body) values
  ('b3010000-0000-4000-8000-00000000000a', 'e3010000-0000-4000-8000-00000000000a', 1, 'person',
   'Processo nº 5123456-49.2099.8.09.0051. A autora junta o comprovante, nos termos do art. 14 da Lei nº 8.078.'),
  ('b3010000-0000-4000-8000-00000000000a', 'e3010000-0000-4000-8000-00000000000b', 1, 'person',
   'Processo nº 5123456-49.2099.8.09.0051. Como decidido no processo 7654321-38.2099.8.19.0001, a companhia responde.');
insert into public.case_draft_citations (org_id, draft_id, version, position, kind, number, article, key, raw) values
  ('b3010000-0000-4000-8000-00000000000a', 'e3010000-0000-4000-8000-00000000000a', 1, 0, 'processo',
   '51234564920998090051', null, 'processo::51234564920998090051', '5123456-49.2099.8.09.0051'),
  ('b3010000-0000-4000-8000-00000000000a', 'e3010000-0000-4000-8000-00000000000a', 1, 1, 'lei', '8078', '14',
   'lei::8078#14', 'art. 14 da Lei nº 8.078'),
  ('b3010000-0000-4000-8000-00000000000a', 'e3010000-0000-4000-8000-00000000000b', 1, 0, 'processo',
   '51234564920998090051', null, 'processo::51234564920998090051', '5123456-49.2099.8.09.0051'),
  ('b3010000-0000-4000-8000-00000000000a', 'e3010000-0000-4000-8000-00000000000b', 1, 1, 'processo',
   '76543213820998190001', null, 'processo::76543213820998190001', '7654321-38.2099.8.19.0001');

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;

select is(public.case_draft_state_blocker('e3010000-0000-4000-8000-00000000000a'), null,
  'a petition naming its own lawsuit and citing what the library covers is not held');
select is(public.case_draft_state_blocker('e3010000-0000-4000-8000-00000000000b'), 'citations_not_verified',
  'a lawsuit of another case is a precedent, and holds the piece while the library does not cover it');
select is(public.case_draft_uncovered_keys('e3010000-0000-4000-8000-00000000000b', 1),
  array['processo::76543213820998190001'], 'the precedent is the one source not covered, the own lawsuit is none');

select pg_temp.sign_in('a3010000-0000-4000-8000-000000000001');
set local role authenticated;
select is((select array_agg(key order by key) from public.case_draft_sources('e3010000-0000-4000-8000-00000000000a')),
  array['lei::8078#14'], 'the screen lists no own lawsuit among the sources');
select is((select array_agg(key || ':' || covered order by key) from public.case_draft_sources('e3010000-0000-4000-8000-00000000000b')),
  array['processo::76543213820998190001:false'], 'and lists the precedent as not covered');
select is(public.take_draft_sources('e3010000-0000-4000-8000-00000000000b', 1) -> 'sources',
  '["processo::76543213820998190001"]'::jsonb, 'the lawyer takes on the precedent alone');
select is(public.take_draft_sources('e3010000-0000-4000-8000-00000000000a', 1) ->> 'code', 'nothing_to_take',
  'and has nothing to take on for a piece that names only its own lawsuit');
reset role;

-- ---------- Each firm its own ----------

select pg_temp.sign_in('a3010000-0000-4000-8000-000000000002');
set local role authenticated;
select is((select count(*)::integer from public.case_draft_sources('e3010000-0000-4000-8000-00000000000b')), 0,
  'firm B reads nothing of what firm A''s pieces cite');
select throws_ok($$select public.cites_own_lawsuit('c3010000-0000-4000-8000-00000000000a', 'processo', '51234564920998090051')$$,
  '42501', null, 'nobody of a firm calls the rule of the own lawsuit directly');
reset role;

select * from finish();
rollback;
