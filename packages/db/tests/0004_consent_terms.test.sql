begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

-- ============================================================
-- Consent terms and acceptances (0001, 0015).
--
-- The legal pages render consent_terms, so the text a person accepted is the
-- text the site shows. A published text is immutable; a revision is a new
-- version. Acceptance happens only through accept_terms(): idempotent per
-- version, never during a support visit, never a direct insert.
--
-- Consent belongs to the PERSON: an account accepts before it founds or joins
-- a firm, and the acceptance outlives the firm.
--
-- Every person here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'pessoa@teste.invalid', '', now(), '{}', '{"display_name":"Pessoa"}', now(), now()),
  ('a2000000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a2000000-0000-4000-8000-000000000002';

create temporary table results (name text primary key, payload jsonb, id uuid);
grant select, insert on results to authenticated;

-- ---------- What ships ----------

select is(
  (select array_agg(slug || ':' || locale order by slug) from public.current_consent_terms('pt-BR')),
  array['newsletter:pt-BR'],
  'the only text that ships is the sentence of the waitlist form: no legal document is seeded'
);

select set_config('request.jwt.claims', '{"role":"anon"}', true);
set local role anon;
select is(
  (select count(*)::int from public.consent_terms),
  1,
  'an anonymous visitor reads the texts in force, which is what the legal pages render'
);
reset role;

-- ---------- Publishing ----------

select set_config('request.jwt.claims', '{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select throws_ok(
  $$select public.publish_consent_term('terms', 'pt-BR', 'Termos', 'Texto')$$,
  '42501', 'not_authorized',
  'a person cannot publish a legal text'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"a2000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.publish_consent_term('terms', 'pt-BR', 'Termos de Uso', 'Primeira versão dos termos.');
select public.publish_consent_term('privacy', 'pt-BR', 'Política de Privacidade', 'Primeira versão da política.');
select public.publish_consent_term('terms', 'pt-BR', 'Termos de Uso', 'Texto revisado.');
select throws_ok(
  $$select public.publish_consent_term('terms', 'en', 'Terms of Use', 'A text in a language the platform is not written in.')$$,
  '22023', 'invalid_term',
  'a text in a language the platform is not written in is refused'
);
reset role;

select is(
  (select version from public.consent_terms where slug = 'terms' and locale = 'pt-BR' and is_active),
  2,
  'a revision is published as the next version'
);
select is(
  (select count(*)::int from public.consent_terms where slug = 'terms' and locale = 'pt-BR' and is_active),
  1,
  'and the previous version stops being the one in force'
);
select throws_ok(
  $$update public.consent_terms set body_md = 'alterado em silêncio' where slug = 'privacy'$$,
  '23514', 'consent_term_immutable',
  'a published text cannot be edited, not even by the database owner'
);

-- ---------- Accepting, before there is a firm ----------

select set_config('request.jwt.claims', '{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into results (name, payload) values ('first', public.accept_terms(array['privacy', 'terms'], 'pt-BR', '{"source":"signup","evil":"<script>"}'));
insert into results (name, payload) values ('second', public.accept_terms(array['privacy'], 'pt-BR'));
select throws_ok(
  $$insert into public.consent_acceptances (term_id, org_id, user_id)
    select id, null, auth.uid() from public.consent_terms where slug = 'newsletter' limit 1$$,
  '42501', null,
  'there is no direct way to record an acceptance'
);
select throws_ok(
  $$select public.accept_terms(array['nao-existe'], 'pt-BR')$$,
  '22023', 'unknown_term',
  'accepting a term that does not exist is refused'
);
reset role;

select is(
  (select count(*)::int from public.consent_acceptances
   where user_id = 'a2000000-0000-4000-8000-000000000001' and org_id is null),
  2,
  'an account accepts before it has a firm: one row per term, with no firm on it'
);
select ok(
  (select bool_and((entry ->> 'already')::boolean) from results, jsonb_array_elements(payload) as entry where name = 'second'),
  'accepting the same version again changes nothing and says so'
);
select is(
  (select metadata from public.consent_acceptances a join public.consent_terms t on t.id = a.term_id
   where a.user_id = 'a2000000-0000-4000-8000-000000000001' and t.slug = 'privacy'),
  '{"source": "signup"}'::jsonb,
  'only allowlisted context is stored with the acceptance'
);

-- ---------- A new version, accepted from inside a firm ----------

select set_config('request.jwt.claims', '{"sub":"a2000000-0000-4000-8000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select public.publish_consent_term('terms', 'pt-BR', 'Termos de Uso', 'Terceira versão.');
reset role;

select set_config('request.jwt.claims', '{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated"}', true);
set local role authenticated;
insert into results (name, id) values ('firm', public.create_firm('Escritório de Teste'));
select public.accept_terms(array['terms'], 'pt-BR');
reset role;

select is(
  (select array_agg(t.version order by t.version) from public.consent_acceptances a
   join public.consent_terms t on t.id = a.term_id
   where a.user_id = 'a2000000-0000-4000-8000-000000000001' and t.slug = 'terms'),
  array[2, 3],
  'a new version is a new acceptance, and the old one stays as history'
);
select is(
  (select a.org_id from public.consent_acceptances a join public.consent_terms t on t.id = a.term_id
   where a.user_id = 'a2000000-0000-4000-8000-000000000001' and t.slug = 'terms' and t.version = 3),
  (select id from results where name = 'firm'),
  'an acceptance given inside a firm records the firm'
);
select throws_ok(
  $$update public.consent_acceptances set metadata = '{}'::jsonb
    where user_id = 'a2000000-0000-4000-8000-000000000001'$$,
  '23514', 'consent_history_immutable',
  'an acceptance cannot be rewritten; it can only be revoked'
);
select throws_ok(
  $$update public.consent_acceptances set org_id = gen_random_uuid()
    where user_id = 'a2000000-0000-4000-8000-000000000001'$$,
  '23514', 'consent_history_immutable',
  'nor moved to another firm'
);

-- ---------- Never during a support visit ----------

insert into public.impersonation_sessions (actor_id, target_user_id, reason, session_id, expires_at)
values ('a2000000-0000-4000-8000-000000000002', 'a2000000-0000-4000-8000-000000000001',
        'Investigando um problema relatado', 'f2000000-0000-4000-8000-000000000001', now() + interval '30 minutes');

select set_config('request.jwt.claims',
  '{"sub":"a2000000-0000-4000-8000-000000000001","role":"authenticated","session_id":"f2000000-0000-4000-8000-000000000001"}', true);
set local role authenticated;
select throws_ok(
  $$select public.accept_terms(array['newsletter'], 'pt-BR')$$,
  '42501', 'support_session_cannot_consent',
  'an operator inside a person''s session cannot consent in that person''s name'
);
reset role;

-- ---------- The acceptance outlives the firm ----------

select set_config('request.jwt.claims', '', true);
delete from public.organizations where id = (select id from results where name = 'firm');

select is(
  (select count(*)::int from public.consent_acceptances where user_id = 'a2000000-0000-4000-8000-000000000001'),
  3,
  'deleting the firm deletes no acceptance: consent belongs to the person'
);
select is(
  (select count(*)::int from public.consent_acceptances
   where user_id = 'a2000000-0000-4000-8000-000000000001' and org_id is not null),
  0,
  'the rows only lose the reference to the firm that no longer exists'
);

-- Revoking is the one change an acceptance takes, once.
update public.consent_acceptances set revoked_at = now()
where user_id = 'a2000000-0000-4000-8000-000000000001'
  and term_id = (select id from public.consent_terms where slug = 'privacy' and is_active);
select is(
  (select count(*)::int from public.consent_acceptances
   where user_id = 'a2000000-0000-4000-8000-000000000001' and revoked_at is not null),
  1,
  'an acceptance can be revoked'
);
select throws_ok(
  $$update public.consent_acceptances set revoked_at = null
    where user_id = 'a2000000-0000-4000-8000-000000000001' and revoked_at is not null$$,
  '23514', 'consent_history_immutable',
  'and a revocation is never undone'
);

select * from finish();
rollback;
