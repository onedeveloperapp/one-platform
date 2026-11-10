begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- ============================================================
-- The models and sources ONE gives every firm (0045).
--
-- The platform keeps sources checked where they were published and models
-- of the initial of each kind of lawsuit, provisional until the curator
-- reviews them: every firm reads them, none writes them, and only the
-- operator keeps them, on the record. A platform source answers the gate of
-- a piece of any firm; ONE writes from the platform's model only for a firm
-- that has no model of that kind; a piece may be asked from it; and where a
-- firm checked a key the platform has too, the AI is handed the firm's.
-- Two firms: each reads the platform's, and nothing of the other.
--
-- Every person, firm, CPF and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a5200000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a5200000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@rocha.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now()),
  ('a5200000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());

update public.profiles set is_superadmin = true where id = 'a5200000-0000-4000-8000-000000000009';

-- Firm A: Ana (owner, sócia), with no model of its own. Firm B: Davi (owner, advogado), with two models.
insert into public.organizations (id, name, slug, created_by) values
  ('b5200000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-advogados', 'a5200000-0000-4000-8000-000000000001'),
  ('b5200000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-advocacia', 'a5200000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b5200000-0000-4000-8000-00000000000a', 'a5200000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b5200000-0000-4000-8000-00000000000b', 'a5200000-0000-4000-8000-000000000004', 'owner', 'advogado');
insert into public.oab_registrations (user_id, uf, number, kind) values
  ('a5200000-0000-4000-8000-000000000001', 'GO', '52001', 'principal');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2') returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level)::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.platform_model(kind text) returns uuid language sql as
$$ select t.id from public.draft_templates t where t.org_id is null and t.is_default and t.proceeding_kind = kind; $$;

-- ---------- What the platform ships ----------

select ok(
  (select count(*) = 23 and bool_and(status = 'verified' and source_url like 'https://%' and quote is not null)
   from public.legal_sources where org_id is null),
  'the platform ships 23 sources, each checked at an official address and quoted'
);
select ok(
  (select key = 'lei::8078#14' and citation = 'art. 14 da Lei nº 8.078'
   from public.legal_sources where org_id is null and kind = 'lei' and number = '8078' and article = '14')
    and (select citation = 'art. 21 da Resolução nº 400 da ANAC'
         from public.legal_sources where org_id is null and kind = 'resolucao' and issuer = 'ANAC' and article = '21')
    and (select citation = 'Tema 1.240 do STF' from public.legal_sources where org_id is null and kind = 'tema' and number = '1240'),
  'each source is keyed and cited as the library writes it'
);
select ok(
  (select count(*) = 2 and bool_and(is_default and provisional) and count(distinct proceeding_kind) = 2
   from public.draft_templates where org_id is null and document_kind = 'piece')
    -- And the power of attorney ONE sends a client to sign (0054), provisional too.
    and (select count(*) = 1 and bool_and(is_default and provisional)
         from public.draft_templates where org_id is null and document_kind = 'procuracao'),
  'and one provisional default model for each kind of lawsuit, and one of a power of attorney'
);

-- ---------- Every firm reads them, none writes them ----------

select pg_temp.sign_in('a5200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a_reads', jsonb_build_object(
  'sources', (select count(*) from public.legal_sources where org_id is null),
  'models', (select count(*) from public.draft_templates where org_id is null)));
select throws_ok(
  $$insert into public.legal_sources (org_id, kind, issuer, number, article, title, source_url)
    values (null, 'lei', '', '7565', '256', 'Código Brasileiro de Aeronáutica', 'https://www.planalto.gov.br/ccivil_03/leis/l7565compilado.htm')$$,
  '42501', null,
  'a firm writes no source of the platform'
);
insert into res values ('a_retires', public.retire_legal_source(
  (select id from public.legal_sources where org_id is null and key = 'lei::8078#14'), 'Não serve a este escritório.'));
insert into res values ('a_removes', public.remove_draft_template(pg_temp.platform_model('juizado')));
reset role;

select pg_temp.sign_in('a5200000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('b_reads', jsonb_build_object(
  'sources', (select count(*) from public.legal_sources where org_id is null),
  'models', (select count(*) from public.draft_templates where org_id is null)));
-- Davi's own two models of the small-claims court, and no default.
insert into res values ('b_model_1', public.save_draft_template('b5200000-0000-4000-8000-00000000000b', null,
  '{"name": "Atraso do escritório", "proceeding_kind": "juizado", "body": "EXCELENTÍSSIMO JUÍZO DO [[JUIZO]], [[PARTES]] vem propor a ação."}'::jsonb));
insert into res values ('b_model_2', public.save_draft_template('b5200000-0000-4000-8000-00000000000b', null,
  '{"name": "Cancelamento do escritório", "proceeding_kind": "juizado", "body": "EXCELENTÍSSIMO JUÍZO DO [[JUIZO]], [[PARTES]] vem propor a ação."}'::jsonb));
select throws_ok(
  $$insert into public.draft_templates (org_id, name, proceeding_kind, body, provisional)
    values ('b5200000-0000-4000-8000-00000000000b', 'Modelo provisório', 'juizado', 'EXCELENTÍSSIMO JUÍZO DO [[JUIZO]], texto.', true)$$,
  '42501', null,
  'nor writes a model by hand'
);
reset role;

select ok(
  -- The two pieces and the power of attorney, since 0123 the declaration of residence, since 0125 of hardship.
  (select (payload ->> 'sources')::int = 23 and (payload ->> 'models')::int = 5 from res where name = 'a_reads')
    and (select (payload ->> 'sources')::int = 23 and (payload ->> 'models')::int = 5 from res where name = 'b_reads'),
  'both firms read the sources and the models of the platform'
);
select ok(
  (select payload ->> 'code' = 'not_found' from res where name = 'a_retires')
    and (select payload ->> 'code' = 'not_found' from res where name = 'a_removes')
    and (select status = 'verified' from public.legal_sources where org_id is null and key = 'lei::8078#14')
    and pg_temp.platform_model('juizado') is not null,
  'a firm neither retires a source of the platform nor removes one of its models'
);
select throws_ok(
  $$insert into public.draft_templates (org_id, name, proceeding_kind, body, provisional)
    values ('b5200000-0000-4000-8000-00000000000b', 'Modelo provisório', 'juizado', 'EXCELENTÍSSIMO JUÍZO DO [[JUIZO]], texto.', true)$$,
  '23514', null,
  'a model of a firm is never said to be provisional'
);

-- ---------- The gate and the model ONE writes from ----------

select ok(
  public.legal_source_covers('b5200000-0000-4000-8000-00000000000a', 'lei', '', '8078', '14')
    and public.legal_source_covers('b5200000-0000-4000-8000-00000000000b', 'lei', '', '8078', '14')
    and public.legal_source_covers('b5200000-0000-4000-8000-00000000000b', 'lei', '', '8078', null)
    and public.legal_source_covers('b5200000-0000-4000-8000-00000000000a', 'tema', 'STF', '1240', null)
    and not public.legal_source_covers('b5200000-0000-4000-8000-00000000000a', 'lei', '', '8078', '7'),
  'a source of the platform answers the gate of a piece of any firm, and only for the article it holds'
);
select ok(
  public.draft_template_for('b5200000-0000-4000-8000-00000000000a', 'juizado') = pg_temp.platform_model('juizado')
    and public.draft_template_for('b5200000-0000-4000-8000-00000000000a', 'comum') = pg_temp.platform_model('comum'),
  'ONE writes from the platform''s model of the kind for a firm that has none'
);
select ok(
  public.draft_template_for('b5200000-0000-4000-8000-00000000000b', 'juizado') is null
    and public.draft_template_for('b5200000-0000-4000-8000-00000000000b', 'comum') = pg_temp.platform_model('comum'),
  'a firm with two models of a kind and no default still has a person choose, and has the platform''s for the other kind'
);

-- ---------- A piece asked from a model of the platform ----------

select pg_temp.sign_in('a5200000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_a', public.create_case('b5200000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-20',
  '{"full_name": "Mariana Teste", "cpf": "12345678909", "birth_date": "1985-04-02"}'::jsonb));
insert into res values ('p_blank', public.save_proceeding(pg_temp.got('case_a', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile"}'::jsonb,
  array[pg_temp.got('case_a', 'party_id')::uuid], array['a5200000-0000-4000-8000-000000000001'::uuid]));
insert into res values ('case_ai', public.create_case('b5200000-0000-4000-8000-00000000000a', 'cancellation', 'G3', date '2026-09-21',
  '{"full_name": "Joana Teste", "cpf": "52998224725", "birth_date": "1990-01-15"}'::jsonb));
insert into res values ('p_ai', public.save_proceeding(pg_temp.got('case_ai', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile"}'::jsonb,
  array[pg_temp.got('case_ai', 'party_id')::uuid], array['a5200000-0000-4000-8000-000000000001'::uuid]));
insert into res values ('d_blank', public.request_case_draft(pg_temp.got('p_blank', 'proceeding_id')::uuid,
  pg_temp.platform_model('juizado'), 'blank'));
-- Ana checks article 14 of the consumer code in her own library too, in her own words.
insert into res values ('a_own', public.save_legal_source('b5200000-0000-4000-8000-00000000000a', null,
  '{"kind": "lei", "number": "8078", "article": "14", "title": "Responsabilidade objetiva, como o escritório a conferiu", "source_url": "https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm"}'::jsonb));
insert into res values ('d_ai', public.request_case_draft(pg_temp.got('p_ai', 'proceeding_id')::uuid,
  pg_temp.platform_model('juizado'), 'ai'));
-- A third case whose lawsuit has no piece yet: what waits for a model.
insert into res values ('case_c', public.create_case('b5200000-0000-4000-8000-00000000000a', 'delay', 'G3', date '2026-09-22',
  '{"full_name": "Lia Teste", "cpf": "11144477735", "birth_date": "1988-07-30"}'::jsonb));
insert into res values ('p_c', public.save_proceeding(pg_temp.got('case_c', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile"}'::jsonb,
  array[pg_temp.got('case_c', 'party_id')::uuid], array['a5200000-0000-4000-8000-000000000001'::uuid]));
reset role;

select pg_temp.sign_in('a5200000-0000-4000-8000-000000000004');
set local role authenticated;
select throws_ok(
  $$select public.request_case_draft(pg_temp.got('p_ai', 'proceeding_id')::uuid, pg_temp.platform_model('juizado'), 'blank')$$,
  'P0002', 'case_not_found',
  'nobody of another firm asks for a piece of this one'
);
reset role;

select ok(
  (select payload ->> 'code' = 'requested' from res where name = 'd_blank')
    and (select template_id = pg_temp.platform_model('juizado') and template_name like '%(modelo do ONE)'
                and template_body like 'EXCELENTÍSSIMO(A)%' and status = 'proposed'
         from public.case_drafts where id = pg_temp.got('d_blank', 'draft_id')::uuid),
  'a piece is asked from a model of the platform, keeping its name and its text'
);

update public.case_drafts set work_claimed_at = now(), work_claims = 1 where id = pg_temp.got('d_ai', 'draft_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('work', (select to_jsonb(w) from public.case_draft_to_work(pg_temp.got('d_ai', 'draft_id')::uuid, 1) w));
reset role;

select ok(
  (select jsonb_array_length(payload -> 'library') = 23
          and payload -> 'library' @> '[{"chave": "tema:STF:1240", "como_citar": "Tema 1.240 do STF"}]'::jsonb
          and payload -> 'library' @> '[{"chave": "lei::8078#14", "titulo": "Responsabilidade objetiva, como o escritório a conferiu"}]'::jsonb
          and payload ->> 'template' like 'EXCELENTÍSSIMO(A)%'
   from res where name = 'work'),
  'the AI is handed the platform''s library with the firm''s, and the firm''s entry where both have a key'
);

-- ---------- What the operator keeps ----------

select pg_temp.sign_in('a5200000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.admin_save_platform_source(null, '{"kind": "lei", "number": "7565", "article": "256", "title": "Código Brasileiro de Aeronáutica, art. 256", "source_url": "https://www.planalto.gov.br/ccivil_03/leis/l7565compilado.htm"}'::jsonb)$$,
  '42501', 'not_authorized',
  'only the operator keeps the platform''s sources'
);
reset role;

update public.case_advances set waiting = 'no_model', after = now() + interval '1 day'
where case_id = pg_temp.got('case_c', 'case_id')::uuid;

select pg_temp.sign_in('a5200000-0000-4000-8000-000000000009');
set local role authenticated;
insert into res values ('op_source', public.admin_save_platform_source(null,
  '{"kind": "lei", "number": "7565", "article": "256", "title": "Código Brasileiro de Aeronáutica, art. 256: responsabilidade do transportador", "quote": "Art. 256. O transportador responde pelo dano decorrente:", "source_url": "https://www.planalto.gov.br/ccivil_03/leis/l7565compilado.htm"}'::jsonb));
insert into res values ('op_again', public.admin_save_platform_source(null,
  '{"kind": "lei", "number": "7565", "article": "256", "title": "O mesmo artigo", "source_url": "https://www.planalto.gov.br/ccivil_03/leis/l7565compilado.htm"}'::jsonb));
insert into res values ('op_bad', public.admin_save_platform_source(null,
  '{"kind": "resolucao", "number": "400", "article": "21", "title": "Sem quem a expediu", "source_url": "https://www.anac.gov.br"}'::jsonb));
insert into res values ('op_retire_short', public.admin_retire_platform_source(
  (pg_temp.got('op_source', 'source_id'))::uuid, 'não'));
insert into res values ('op_retire', public.admin_retire_platform_source(
  (pg_temp.got('op_source', 'source_id'))::uuid, 'Artigo revogado, conferido de novo no Planalto.'));
insert into res values ('op_model', public.admin_save_platform_template(null,
  '{"name": "Inicial do juizado, segunda versão do ONE", "proceeding_kind": "juizado", "body": "EXCELENTÍSSIMO(A) SENHOR(A) JUIZ(A) DE DIREITO DO [[JUIZO]], [[PARTES]] vêm propor a ação.", "is_default": true, "provisional": false}'::jsonb));
insert into res values ('op_name', public.admin_save_platform_template(null,
  '{"name": "Inicial do juizado, segunda versão do ONE", "proceeding_kind": "comum", "body": "Texto qualquer de um modelo com a mesma denominação."}'::jsonb));
insert into res values ('op_remove', public.admin_remove_platform_template(
  (select id from public.draft_templates where org_id is null and name like 'Inicial do juizado especial%')));
reset role;

select ok(
  (select payload ->> 'code' = 'saved' from res where name = 'op_source')
    and (select payload ->> 'code' = 'already_in_library' from res where name = 'op_again')
    and (select payload ->> 'code' = 'invalid_source' from res where name = 'op_bad'),
  'the operator registers a source of the platform once, and one that is not a source is refused'
);
select ok(
  (select payload ->> 'code' = 'reason_required' from res where name = 'op_retire_short')
    and (select payload ->> 'code' = 'retired' from res where name = 'op_retire')
    and not public.legal_source_covers('b5200000-0000-4000-8000-00000000000a', 'lei', '', '7565', '256'),
  'and retires it with the reason, after which it answers for nothing'
);
select ok(
  (select payload ->> 'code' = 'saved' from res where name = 'op_model')
    and (select count(*) = 1 from public.draft_templates where org_id is null and is_default and proceeding_kind = 'juizado')
    and pg_temp.platform_model('juizado') = (pg_temp.got('op_model', 'template_id'))::uuid
    and (select payload ->> 'code' = 'name_in_use' from res where name = 'op_name'),
  'a new default of a kind takes the place of the one before, and a name is the platform''s once'
);
select ok(
  (select payload ->> 'code' = 'removed' from res where name = 'op_remove')
    and (select template_id is null and template_name like 'Inicial do juizado especial%' and template_body like 'EXCELENTÍSSIMO(A)%'
         from public.case_drafts where id = pg_temp.got('d_blank', 'draft_id')::uuid),
  'a model removed leaves the drafts asked from it with its name and its text'
);
select ok(
  (select after is null and woken_at is not null from public.case_advances where case_id = pg_temp.got('case_c', 'case_id')::uuid)
    and (select count(*) = 4 from public.audit_events
         where org_id is null and action in ('platform.source_saved', 'platform.source_retired', 'platform.template_saved', 'platform.template_removed')),
  'a model of the platform wakes the cases that wait for one, and what the operator did is on the record'
);

select * from finish();
rollback;
