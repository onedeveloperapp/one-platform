begin;
create extension if not exists pgtap;
select plan(21);

-- ============================================================
-- The AI's triage of publications out of the shadow (0035). A category the
-- AI met its goal in is let out by the operator, on the record (never a
-- deadline nor a hearing): the AI's answer is then the triage of a
-- publication nobody triaged yet, in a firm whose partner lets it be, and a
-- share of it waits for a person's check. Any person's word that shows the
-- AI hid a deadline or a hearing puts the category back in the shadow by
-- itself (a check, a person's own triage, or a person's triage the AI's
-- answer came after), and what the AI triaged of it and nobody checked
-- waits for a person again, in every firm. Two firms.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('ad800000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@amostra.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('ad800000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@amostra.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('ad800000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@amostra.invalid', '', now(), '{}', '{"display_name":"Caio Reis"}', now(), now()),
  ('ad800000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@amostra.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('ad800000-0000-4000-8000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'eva@amostra.invalid', '', now(), '{}', '{"display_name":"Eva Dias"}', now(), now()),
  ('ad800000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'olga@amostra.invalid', '', now(), '{}', '{"display_name":"Olga Operadora"}', now(), now());
update public.profiles set is_superadmin = true where id = 'ad800000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('bd800000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-amostra', 'ad800000-0000-4000-8000-000000000001'),
  ('bd800000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-amostra', 'ad800000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('bd800000-0000-4000-8000-00000000000a', 'ad800000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('bd800000-0000-4000-8000-00000000000a', 'ad800000-0000-4000-8000-000000000002', 'member', 'controladoria'),
  ('bd800000-0000-4000-8000-00000000000a', 'ad800000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('bd800000-0000-4000-8000-00000000000b', 'ad800000-0000-4000-8000-000000000004', 'owner', 'advogado'),
  ('bd800000-0000-4000-8000-00000000000b', 'ad800000-0000-4000-8000-000000000005', 'member', 'socio');

-- What the DJEN brought, as the capture keeps it: A1 to A8 for firm A, B1 and B2 for firm B.
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, body)
select ('ce800000-0000-4000-8000-0000000000' || n)::uuid, org::uuid, 'amostra0000000' || n, 'TJGO', '50002023920998090051',
       current_date - 2, 'Intimação', 'Texto inventado ' || n
from (values
  ('a1', 'bd800000-0000-4000-8000-00000000000a'), ('a2', 'bd800000-0000-4000-8000-00000000000a'),
  ('a3', 'bd800000-0000-4000-8000-00000000000a'), ('a4', 'bd800000-0000-4000-8000-00000000000a'),
  ('a5', 'bd800000-0000-4000-8000-00000000000a'), ('a6', 'bd800000-0000-4000-8000-00000000000a'),
  ('a7', 'bd800000-0000-4000-8000-00000000000a'), ('a8', 'bd800000-0000-4000-8000-00000000000a'),
  ('b1', 'bd800000-0000-4000-8000-00000000000b'), ('b2', 'bd800000-0000-4000-8000-00000000000b')
) as p (n, org);

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2', 'session_id', session))::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.pub(n text) returns uuid language sql as
$$ select ('ce800000-0000-4000-8000-0000000000' || n)::uuid; $$;
create function pg_temp.row_of(n text) returns public.publications language sql as
$$ select * from public.publications where id = pg_temp.pub(n); $$;
-- Whether a publication falls in a share of a category's sample: the same reckoning the database makes.
create function pg_temp.bucket(n text) returns integer language sql as
$$ select mod(mod(hashtextextended(pg_temp.pub(n)::text, 7), 100) + 100, 100)::integer; $$;
-- The AI's triage of one publication, as the backend runs and records it.
create function pg_temp.ai_says(n text, category text) returns jsonb language plpgsql as $$
declare
  held record;
  started jsonb;
  finished jsonb;
  org uuid := (select org_id from public.publications where id = pg_temp.pub(n));
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  select * into held from public.claim_publication_triage(1, pg_temp.pub(n));
  started := public.start_ai_run(org, 'publicacao.triagem', repeat('f', 64), null, 'publication', pg_temp.pub(n)::text,
    'triagem:' || pg_temp.pub(n)::text || ':' || held.claim::text);
  finished := public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded',
    jsonb_build_object('categoria', category, 'urgente', false, 'resumo', 'Uma frase.'), 500, 60);
  finished := public.record_publication_triage(pg_temp.pub(n), held.claim, 'done', (started ->> 'run_id')::uuid);
  execute 'reset role';
  return finished;
end;
$$;

-- ---------- In the shadow, the AI decides nothing ----------

select ok(
  (select count(*) = 6 and bool_and(mode = 'shadow') from public.publication_triage_policies)
  and (select not publication_ai_triage from public.organizations where id = 'bd800000-0000-4000-8000-00000000000a')
  and not has_table_privilege('authenticated', 'public.publication_triage_policies', 'UPDATE')
  and has_column_privilege('authenticated', 'public.publications', 'ai_applied', 'SELECT')
  and not has_column_privilege('authenticated', 'public.publications', 'ai_category', 'SELECT')
  and has_column_privilege('authenticated', 'public.publication_triage_policies', 'mode', 'SELECT')
  and not has_column_privilege('authenticated', 'public.publication_triage_policies', 'note', 'SELECT')
  and not has_column_privilege('authenticated', 'public.publication_triage_policies', 'demoted_at', 'SELECT')
  -- What asks somebody's work taken for anything else is a miss, one of them for another too.
  and public.triage_missed('ciencia', 'prazo') and public.triage_missed('audiencia', 'prazo')
  and public.triage_missed('prazo', 'audiencia') and public.triage_missed('ciencia', 'decisao')
  and public.triage_missed('outro', 'pagamento') and not public.triage_missed('prazo', 'prazo')
  and not public.triage_missed('prazo', 'ciencia') and not public.triage_missed('decisao', 'outro')
  and not public.triage_missed(null, 'prazo'),
  'every category starts in the shadow, no firm lets the AI triage until a partner says so, and what the AI said stays out of the firm''s sight'
);

insert into res values ('shadow_a1', pg_temp.ai_says('a1', 'ciencia'));
select ok(
  pg_temp.got('shadow_a1', 'code') = 'done' and pg_temp.got('shadow_a1', 'applied') = 'false'
  and (select ai_category = 'ciencia' and category is null and not ai_applied and not review_due from pg_temp.row_of('a1')),
  'in the shadow the AI''s answer is kept beside the publication, and the publication still waits for a person'
);

-- ---------- The goal, and the operator ----------

select pg_temp.sign_in('ad800000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('below', public.set_publication_triage_policy('ciencia', 'sampled', 50, 'Meta batida no período.'));
insert into res values ('short_note', public.set_publication_triage_policy('ciencia', 'sampled', 50, 'curta'));
reset role;
select ok(
  pg_temp.got('below', 'code') = 'below_goal'
  and (select payload -> 'measure' ->> 'compared' = '0' from res where name = 'below')
  and pg_temp.got('short_note', 'code') = 'reason_required',
  'a category does not leave the shadow below the goal, and never without a note'
);

-- A deadline and a hearing ask a person for what follows their triage: they never leave the shadow.
update public.platform_settings
set value = value || '{"promote_min_compared": 0, "promote_min_agreed_percent": 1}'::jsonb
where key = 'publications';
select pg_temp.sign_in('ad800000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('acting_prazo', public.set_publication_triage_policy('prazo', 'sampled', 100, 'Meta batida no período.'));
insert into res values ('acting_hearing', public.set_publication_triage_policy('audiencia', 'sampled', 100, 'Meta batida no período.'));
insert into res values ('acting_decision', public.set_publication_triage_policy('decisao', 'sampled', 100, 'Meta batida no período.'));
insert into res values ('acting_payment', public.set_publication_triage_policy('pagamento', 'sampled', 100, 'Meta batida no período.'));
reset role;
select ok(
  pg_temp.got('acting_prazo', 'code') = 'acting_category' and pg_temp.got('acting_hearing', 'code') = 'acting_category'
  and pg_temp.got('acting_decision', 'code') = 'acting_category' and pg_temp.got('acting_payment', 'code') = 'acting_category'
  and (select bool_and(mode = 'shadow') from public.publication_triage_policies
       where category in ('prazo', 'audiencia', 'decisao', 'pagamento')),
  'a deadline, a hearing, a decision and a payment never leave the shadow'
);
select throws_ok(
  $$update public.publication_triage_policies set mode = 'sampled' where category = 'prazo'$$,
  '23514', null,
  'not even written straight into the table'
);

-- A smaller goal for the test: two publications a person also triaged, half of them agreeing.
update public.platform_settings
set value = value || '{"promote_min_compared": 2, "promote_min_agreed_percent": 50}'::jsonb
where key = 'publications';
-- People triage A2 and A3 as notices, and the AI, in the shadow, agrees.
select pg_temp.sign_in('ad800000-0000-4000-8000-000000000002');
set local role authenticated;
select public.triage_publication(pg_temp.pub('a2'), 'ciencia');
select public.triage_publication(pg_temp.pub('a3'), 'ciencia');
reset role;
select pg_temp.ai_says('a2', 'ciencia');
select pg_temp.ai_says('a3', 'ciencia');

select pg_temp.sign_in('ad800000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.set_publication_triage_policy('ciencia', 'sampled', 50, 'Meta batida no período.')$$,
  '42501', 'not_authorized',
  'a partner of a firm lets no category out of the shadow'
);
reset role;

select pg_temp.sign_in('ad800000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('promoted', public.set_publication_triage_policy('ciencia', 'sampled', 50, 'Meta batida no período.'));
reset role;
select ok(
  pg_temp.got('promoted', 'code') = 'saved'
  and (select mode = 'sampled' and sample_percent = 50 and changed_by = 'ad800000-0000-4000-8000-000000000009'
       from public.publication_triage_policies where category = 'ciencia')
  and (select count(*) = 1 from public.audit_events where action = 'publications.triage_policy_changed'
       and metadata ->> 'category' = 'ciencia' and metadata -> 'measure' ->> 'compared' = '2'),
  'the operator lets a category that met its goal out of the shadow, with its measure on the record'
);

-- ---------- Out of the shadow ----------

-- Each firm's partner lets the AI's answer be the firm's triage; firm B's says no again after B1 was triaged by it.
select pg_temp.sign_in('ad800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_on', public.set_firm_publication_ai_triage('bd800000-0000-4000-8000-00000000000a', true));
reset role;
select pg_temp.sign_in('ad800000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('eva_on', public.set_firm_publication_ai_triage('bd800000-0000-4000-8000-00000000000b', true));
reset role;
insert into res values ('b1', pg_temp.ai_says('b1', 'ciencia'));
select pg_temp.sign_in('ad800000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('davi_off', public.set_firm_publication_ai_triage('bd800000-0000-4000-8000-00000000000b', false));
reset role;
select pg_temp.sign_in('ad800000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('eva_off', public.set_firm_publication_ai_triage('bd800000-0000-4000-8000-00000000000b', false));
insert into res values ('eva_other', public.set_firm_publication_ai_triage('bd800000-0000-4000-8000-00000000000a', false));
reset role;
insert into res values ('b2', pg_temp.ai_says('b2', 'ciencia'));

insert into res values ('a4', pg_temp.ai_says('a4', 'ciencia'));
insert into res values ('a5', pg_temp.ai_says('a5', 'ciencia'));
insert into res values ('a6', pg_temp.ai_says('a6', 'ciencia'));
-- A category still in the shadow decides nothing, whatever the firm says.
insert into res values ('a7', pg_temp.ai_says('a7', 'decisao'));

select ok(
  pg_temp.got('a4', 'applied') = 'true'
  and (select category = 'ciencia' and ai_applied and triaged_by is null and triaged_at is not null
              and review_due = (pg_temp.bucket('a4') < 50)
       from pg_temp.row_of('a4'))
  and (select review_due = (pg_temp.bucket('a5') < 50) and review_due = (pg_temp.got('a5', 'sampled') = 'true')
       from pg_temp.row_of('a5'))
  and pg_temp.got('a7', 'applied') = 'false'
  and (select category is null and ai_category = 'decisao' from pg_temp.row_of('a7'))
  and (select count(*) = 3 from public.audit_events where action = 'publication.triaged_by_ai' and actor_type = 'ai'
       and org_id = 'bd800000-0000-4000-8000-00000000000a'),
  'in a category out of the shadow the AI''s answer is the triage, a share of it waits for a check, decided by the publication itself'
);

select ok(
  pg_temp.got('ana_on', 'code') = 'saved' and pg_temp.got('eva_on', 'code') = 'saved'
  and pg_temp.got('b1', 'applied') = 'true'
  and pg_temp.got('davi_off', 'code') = 'not_allowed' and pg_temp.got('eva_other', 'code') = 'not_found'
  and pg_temp.got('eva_off', 'code') = 'saved'
  and (select not publication_ai_triage from public.organizations where id = 'bd800000-0000-4000-8000-00000000000b')
  and pg_temp.got('b2', 'applied') = 'false'
  and (select category is null and ai_category = 'ciencia' from pg_temp.row_of('b2'))
  and (select count(*) = 3 from public.audit_events where action = 'publications.ai_triage_set'),
  'a partner of a firm says whether the AI''s answer is the firm''s triage, and with it off each publication waits for a person'
);

insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('ad800000-0000-4000-8000-000000000009', 'ad800000-0000-4000-8000-000000000001', 'bd800000-0000-4000-8000-00000000000a',
        'Conferindo a triagem', 'fe800000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('ad800000-0000-4000-8000-000000000001', 'fe800000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.set_firm_publication_ai_triage('bd800000-0000-4000-8000-00000000000a', false)$$,
  '42501', 'not_allowed_in_support_session',
  'a support visit does not change what the firm lets the AI do'
);
reset role;

-- ---------- The check ----------

select pg_temp.sign_in('ad800000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('read_a4', (select to_jsonb(p) from (
  select ai_applied, review_due, category, triaged_by from public.publications where id = pg_temp.pub('a4')) p));
insert into res values ('check_a4', public.triage_publication(pg_temp.pub('a4'), 'ciencia'));
reset role;
select ok(
  pg_temp.got('read_a4', 'ai_applied') = 'true' and pg_temp.got('read_a4', 'category') = 'ciencia'
  and pg_temp.got('check_a4', 'demoted') = 'false'
  and (select not review_due and reviewed_by = 'ad800000-0000-4000-8000-000000000002' and reviewed_at is not null
              and triaged_by = 'ad800000-0000-4000-8000-000000000002' and ai_category = 'ciencia'
       from pg_temp.row_of('a4'))
  and (select mode = 'sampled' from public.publication_triage_policies where category = 'ciencia'),
  'a person reads that the triage is the AI''s, and the same word confirms it'
);

-- A person finds a deadline where the AI said there was only a notice.
select pg_temp.sign_in('ad800000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('miss', public.triage_publication(pg_temp.pub('a5'), 'prazo'));
reset role;
select ok(
  pg_temp.got('miss', 'demoted') = 'true'
  and (select mode = 'shadow' and demoted_at is not null from public.publication_triage_policies where category = 'ciencia')
  and (select category = 'prazo' and ai_category = 'ciencia' and not review_due
              and reviewed_by = 'ad800000-0000-4000-8000-000000000001'
       from pg_temp.row_of('a5'))
  and (select count(*) = 1 from public.audit_events where action = 'publications.triage_demoted'
       and metadata ->> 'category' = 'ciencia' and metadata ->> 'found' = 'prazo' and actor_type = 'person'),
  'a check that shows the AI hid a deadline puts its category back in the shadow, on the record'
);

select ok(
  (select review_due from pg_temp.row_of('a6'))
  and (select review_due from pg_temp.row_of('b1'))
  and not (select review_due from pg_temp.row_of('a4'))
  and not (select review_due from pg_temp.row_of('b2')),
  'and what the AI triaged of that category and nobody checked waits for a person again, in every firm'
);

-- The next answer of a category back in the shadow decides nothing.
update public.publications set ai_category = null, ai_attempts = 0 where id = pg_temp.pub('a1');
insert into res values ('after', pg_temp.ai_says('a1', 'ciencia'));
select ok(
  pg_temp.got('after', 'applied') = 'false'
  and (select category is null from pg_temp.row_of('a1')),
  'a category back in the shadow decides nothing again'
);

-- ---------- What the operator and the firm read ----------

select pg_temp.sign_in('ad800000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('measure', public.admin_publication_triage_measure(90));
reset role;
-- The checks of A4 and A5 were made with the AI's word on the screen: only A2 and A3, triaged blind, are comparisons.
select ok(
  (select (payload ->> 'applied')::integer = 4 and (payload ->> 'waiting_review')::integer = 2
          and (payload ->> 'checked')::integer = 2 and payload -> 'goal' ->> 'min_compared' = '2'
   from res where name = 'measure')
  and (select c ->> 'mode' = 'shadow' and (c ->> 'misses')::integer = 1 and (c ->> 'compared')::integer = 2
              and (c ->> 'agreed')::integer = 2 and c ->> 'demoted_at' is not null
       from res r, jsonb_array_elements(r.payload -> 'by_ai_category') c
       where r.name = 'measure' and c ->> 'category' = 'ciencia'),
  'the operator reads each category of the AI''s answer with its mode, its measure (blind triages only) and the goal'
);

select pg_temp.sign_in('ad800000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok($$select public.admin_publication_triage_measure(90)$$, '42501', 'not_authorized',
  'a firm does not read the measure across firms');
select ok(
  (public.firm_today('bd800000-0000-4000-8000-00000000000a') ->> 'publications_to_review')::integer
    = (select count(*)::integer from public.publications where org_id = 'bd800000-0000-4000-8000-00000000000a' and review_due and active)
  and (public.firm_today('bd800000-0000-4000-8000-00000000000a') ->> 'publications_to_review')::integer >= 1,
  'the firm''s home counts the AI''s triage that waits for a person''s check'
);
reset role;

select pg_temp.sign_in('ad800000-0000-4000-8000-000000000003');
set local role authenticated;
insert into res values ('caio', public.triage_publication(pg_temp.pub('a6'), 'ciencia'));
reset role;
select ok(
  pg_temp.got('caio', 'code') = 'not_allowed' and (select review_due from pg_temp.row_of('a6')),
  'who answers clients checks nothing: the check is of who signs or runs the deadlines'
);

-- ---------- A miss found otherwise than by a check ----------

-- The goal lets the category out again in spite of its misses, for the test.
update public.platform_settings set value = value || '{"promote_max_misses": 10}'::jsonb where key = 'publications';
select pg_temp.sign_in('ad800000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('again', public.set_publication_triage_policy('ciencia', 'sampled', 50, 'De volta depois da revisão.'));
reset role;
-- A person triaged A8 as a deadline; the AI's answer comes after, and says a notice.
select pg_temp.sign_in('ad800000-0000-4000-8000-000000000002');
set local role authenticated;
select public.triage_publication(pg_temp.pub('a8'), 'prazo');
reset role;
insert into res values ('late_ai', pg_temp.ai_says('a8', 'ciencia'));
select ok(
  pg_temp.got('again', 'code') = 'saved' and pg_temp.got('late_ai', 'applied') = 'false'
  and (select mode = 'shadow' from public.publication_triage_policies where category = 'ciencia')
  and (select category = 'prazo' and ai_category = 'ciencia' from pg_temp.row_of('a8'))
  and (select count(*) = 1 from public.audit_events where action = 'publications.triage_demoted'
       and actor_type = 'system' and actor_id is null and metadata ->> 'found' = 'prazo'),
  'an answer of the AI that would have hidden the deadline a person found first puts its category back in the shadow'
);

-- In firm B, whose partner said no, a person triages B2 blind: a hearing, where the AI had said a notice.
select pg_temp.sign_in('ad800000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('again2', public.set_publication_triage_policy('ciencia', 'sampled', 50, 'De volta outra vez.'));
reset role;
select pg_temp.sign_in('ad800000-0000-4000-8000-000000000005');
set local role authenticated;
insert into res values ('blind_b2', public.triage_publication(pg_temp.pub('b2'), 'audiencia'));
reset role;
select ok(
  pg_temp.got('again2', 'code') = 'saved'
  -- Who triaged blind is not told: the AI's word on a category in the shadow is not the firm's to read.
  and pg_temp.got('blind_b2', 'code') = 'saved' and pg_temp.got('blind_b2', 'demoted') = 'false'
  and (select mode = 'shadow' from public.publication_triage_policies where category = 'ciencia')
  and (select count(*) = 1 from public.audit_events where action = 'publications.triage_demoted'
       and actor_id = 'ad800000-0000-4000-8000-000000000005' and metadata ->> 'found' = 'audiencia'),
  'a person''s own triage that finds a hearing where the AI said otherwise puts the category back too, in a firm that does not let the AI triage'
);

-- The category out again; the deadline of A8 is said again with a note: nothing new is found, nothing goes back.
select pg_temp.sign_in('ad800000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('again3', public.set_publication_triage_policy('ciencia', 'sampled', 50, 'De volta mais uma vez.'));
reset role;
select pg_temp.sign_in('ad800000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('resaid', public.triage_publication(pg_temp.pub('a8'), 'prazo', 'Prazo de cinco dias.'));
reset role;
select ok(
  pg_temp.got('again3', 'code') = 'saved' and pg_temp.got('resaid', 'code') = 'saved'
  and (select mode = 'sampled' from public.publication_triage_policies where category = 'ciencia')
  and (select count(*) = 3 from public.audit_events where action = 'publications.triage_demoted'),
  'the same word said again finds no new miss'
);

select * from finish();
rollback;
