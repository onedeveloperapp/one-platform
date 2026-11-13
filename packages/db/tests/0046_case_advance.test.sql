begin;
create extension if not exists pgtap;
select plan(20);

-- ============================================================
-- ONE carries a case from one step to the next by itself, where its firm
-- lets it (0039): it creates the lawsuits the rules plan, signed by who the
-- firm named; asks the AI for the first text of each piece from the firm's
-- model; and asks for the filing package once the piece became the
-- petition. Through the very functions a person writes through, said in
-- the timeline as ONE's, never undoing what a person did. Two firms.
--
-- Every person, firm and CPF here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a4600000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@souza.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a4600000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'bia@souza.invalid', '', now(), '{}', '{"display_name":"Bia Lima"}', now(), now()),
  ('a4600000-0000-4000-8000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'duda@souza.invalid', '', now(), '{}', '{"display_name":"Duda Reis"}', now(), now()),
  ('a4600000-0000-4000-8000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@rocha.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now()),
  ('a4600000-0000-4000-8000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'operador@one.invalid', '', now(), '{}', '{"display_name":"Operador"}', now(), now());
update public.profiles set is_superadmin = true where id = 'a4600000-0000-4000-8000-000000000009';

insert into public.organizations (id, name, slug, created_by) values
  ('b4600000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-andamento', 'a4600000-0000-4000-8000-000000000001'),
  ('b4600000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-andamento', 'a4600000-0000-4000-8000-000000000004');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b4600000-0000-4000-8000-00000000000a', 'a4600000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b4600000-0000-4000-8000-00000000000a', 'a4600000-0000-4000-8000-000000000002', 'member', 'advogado'),
  ('b4600000-0000-4000-8000-00000000000a', 'a4600000-0000-4000-8000-000000000003', 'member', 'atendimento'),
  ('b4600000-0000-4000-8000-00000000000b', 'a4600000-0000-4000-8000-000000000004', 'owner', 'socio');

-- These firms keep the court system with a person, as every firm did before 0240 (ONE's by default since).
insert into public.firm_autonomy (org_id, decision, mode) values
  ('b4600000-0000-4000-8000-00000000000a', 'court_system', 'approval'),
  ('b4600000-0000-4000-8000-00000000000b', 'court_system', 'approval');

-- Ana is at the bar in Goiás, Bia in São Paulo, Caio in Goiás.
insert into public.oab_registrations (user_id, uf, number, kind) values
  ('a4600000-0000-4000-8000-000000000001', 'GO', '46001', 'principal'),
  ('a4600000-0000-4000-8000-000000000002', 'SP', '46002', 'principal'),
  ('a4600000-0000-4000-8000-000000000004', 'GO', '46004', 'principal');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid, level text default 'aal2', session uuid default null) returns void language sql as
$$ select set_config('request.jwt.claims',
     jsonb_strip_nulls(jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', level, 'session_id', session))::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
-- A file the backend measured and kept (called as the service role).
create function pg_temp.stored(org uuid, file_name text, purpose text default 'upload') returns uuid language plpgsql as $$
declare
  reserved jsonb := public.reserve_file(org, purpose, file_name, 'application/pdf', 4000);
begin
  perform public.confirm_file((reserved ->> 'file_id')::uuid, repeat('a', 64), 4000, 'application/pdf', 1);
  return (reserved ->> 'file_id')::uuid;
end;
$$;
-- A case ready for its lawsuits: an adult of Goiânia with what each claimant asks, and a leg of the trip.
create function pg_temp.ready_case(org uuid, cpf text) returns jsonb language plpgsql as $$
declare
  made jsonb := public.create_case(org, 'delay', 'G3', date '2026-01-20',
    jsonb_build_object('full_name', 'Maria Teste', 'cpf', cpf, 'birth_date', '1985-04-02',
      'city', 'Goiânia', 'uf', 'GO'));
begin
  perform public.save_flight_segment((made ->> 'case_id')::uuid, null,
    '{"flight_number": "G3 1234", "origin_iata": "GYN", "destination_iata": "GRU", "affected": true}'::jsonb);
  perform public.set_party_claim((made ->> 'case_id')::uuid, (made ->> 'party_id')::uuid, 1000000);
  return made;
end;
$$;
-- What a worker holds of a case, claimed by name.
create function pg_temp.claim(target uuid) returns jsonb language sql as $$
  select coalesce((public.claim_case_advances(1, target) -> 'claimed') -> 0, '{}'::jsonb);
$$;
-- The plan the rules give a case of one adult in Goiás.
create function pg_temp.plan(party uuid, system text default 'projudi') returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object(
    'fields', jsonb_build_object('kind', 'juizado', 'court', 'TJGO', 'comarca', 'Goiânia', 'forum_basis', 'domicile',
      'forum_city', 'Goiânia', 'system', system),
    'parties', jsonb_build_array(party)));
$$;

-- Firm A: two cases ready for their lawsuits. Firm B: one, in a firm where a person creates them.
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_1', pg_temp.ready_case('b4600000-0000-4000-8000-00000000000a', '12345678909'));
insert into res values ('case_2', pg_temp.ready_case('b4600000-0000-4000-8000-00000000000a', '52998224725'));
reset role;
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000004');
set local role authenticated;
insert into res values ('case_b', pg_temp.ready_case('b4600000-0000-4000-8000-00000000000b', '12345678909'));
insert into res values ('b_mode', public.set_firm_autonomy('b4600000-0000-4000-8000-00000000000b', 'create_lawsuits', 'approval'));
reset role;

-- ---------- Who signs what ONE prepares ----------

select pg_temp.sign_in('a4600000-0000-4000-8000-000000000002');
set local role authenticated;
insert into res values ('bia_names', public.set_firm_signer('b4600000-0000-4000-8000-00000000000a',
  'a4600000-0000-4000-8000-000000000002', true));
reset role;
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001', 'aal1');
set local role authenticated;
select throws_ok(
  $$select public.set_firm_signer('b4600000-0000-4000-8000-00000000000a', 'a4600000-0000-4000-8000-000000000001', true)$$,
  '42501', 'second_factor_required',
  'a partner names who signs with the second factor'
);
reset role;
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('ana_signs', public.set_firm_signer('b4600000-0000-4000-8000-00000000000a',
  'a4600000-0000-4000-8000-000000000001', true));
insert into res values ('ana_again', public.set_firm_signer('b4600000-0000-4000-8000-00000000000a',
  'a4600000-0000-4000-8000-000000000001', true));
insert into res values ('duda_signs', public.set_firm_signer('b4600000-0000-4000-8000-00000000000a',
  'a4600000-0000-4000-8000-000000000003', true));
insert into res values ('caio_signs', public.set_firm_signer('b4600000-0000-4000-8000-00000000000a',
  'a4600000-0000-4000-8000-000000000004', true));
reset role;

select ok(
  pg_temp.got('bia_names', 'code') = 'not_a_partner'
  and pg_temp.got('ana_signs', 'code') = 'saved' and pg_temp.got('ana_again', 'code') = 'unchanged'
  and pg_temp.got('duda_signs', 'code') = 'not_a_lawyer' and pg_temp.got('caio_signs', 'code') = 'not_a_lawyer'
  and (select count(*) = 1 from public.firm_signers where org_id = 'b4600000-0000-4000-8000-00000000000a')
  and (select count(*) = 1 from public.audit_events where action = 'firm.signer_set'
       and org_id = 'b4600000-0000-4000-8000-00000000000a'),
  'a partner names a partner or a lawyer of the firm to sign what ONE prepares, on the record; nobody else, and nobody of another firm'
);

-- Support visits Ana: nobody is named in her name.
insert into public.impersonation_sessions (actor_id, target_user_id, target_org_id, reason, session_id, expires_at)
values ('a4600000-0000-4000-8000-000000000009', 'a4600000-0000-4000-8000-000000000001', 'b4600000-0000-4000-8000-00000000000a',
        'Conferindo quem assina', 'f4600000-0000-4000-8000-000000000001', now() + interval '30 minutes');
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001', 'aal2', 'f4600000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.set_firm_signer('b4600000-0000-4000-8000-00000000000a', 'a4600000-0000-4000-8000-000000000002', true)$$,
  '42501', 'not_allowed_in_support_session',
  'nor does a support visit'
);
reset role;

-- ---------- ONE creates the lawsuits ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_1', pg_temp.claim(pg_temp.got('case_1', 'case_id')::uuid));
insert into res values ('claim_b', pg_temp.claim(pg_temp.got('case_b', 'case_id')::uuid));
insert into res values ('wrong_claim', public.advance_create_lawsuits(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_1', 'claim')::integer + 1, pg_temp.plan(pg_temp.got('case_1', 'party_id')::uuid)));
insert into res values ('created_1', public.advance_create_lawsuits(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_1', 'claim')::integer, pg_temp.plan(pg_temp.got('case_1', 'party_id')::uuid)));
insert into res values ('again_1', public.advance_create_lawsuits(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_1', 'claim')::integer, pg_temp.plan(pg_temp.got('case_1', 'party_id')::uuid)));
reset role;

select ok(
  (pg_temp.got('claim_1', 'lawsuits_due'))::boolean
  and pg_temp.got('claim_b', 'case_id') is null
  and (select a.waiting is null and a.after > now() from public.case_advances a
       where a.case_id = pg_temp.got('case_b', 'case_id')::uuid)
  and pg_temp.got('wrong_claim', 'code') = 'not_working'
  and pg_temp.got('created_1', 'code') = 'created' and pg_temp.got('created_1', 'unsigned') = '0'
  -- Its lawsuits are there: nothing is due, and ONE's own writes woke nothing.
  and pg_temp.got('again_1', 'code') = 'not_due',
  'a case ready for its lawsuits is claimed where the firm lets ONE create them, and only once; one of a firm where a person creates them is set aside'
);
select ok(
  (select count(*) = 1 from public.proceedings p where p.case_id = pg_temp.got('case_1', 'case_id')::uuid
   and p.kind = 'juizado' and p.court = 'TJGO' and p.system = 'projudi' and p.created_by is null)
  and (select array_agg(pl.user_id) = array['a4600000-0000-4000-8000-000000000001'::uuid]
       from public.proceeding_lawyers pl join public.proceedings p on p.id = pl.proceeding_id
       where p.case_id = pg_temp.got('case_1', 'case_id')::uuid)
  and (select status = 'drafting' from public.cases where id = pg_temp.got('case_1', 'case_id')::uuid)
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_1', 'case_id')::uuid
              and e.kind = 'proceeding_saved' and e.actor_type = 'system' and e.actor_id is null)
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_1', 'case_id')::uuid
              and e.kind = 'status_changed' and e.actor_type = 'system' and e.data ->> 'to' = 'drafting'),
  'ONE creates the lawsuits the rules plan, signed by the firm''s signers at the bar in that state, moves the case to drafting, and the timeline says it was ONE'
);

-- ---------- The piece ----------

-- The firm has two models for the small-claims court and no default: ONE does not choose for it.
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('model_1', public.save_draft_template('b4600000-0000-4000-8000-00000000000a', null,
  '{"name": "Atraso de voo", "proceeding_kind": "juizado", "body": "Excelentíssimo juízo [[JUIZO]], [[PARTES]] vem propor a ação."}'::jsonb));
insert into res values ('model_2', public.save_draft_template('b4600000-0000-4000-8000-00000000000a', null,
  '{"name": "Cancelamento", "proceeding_kind": "juizado", "body": "Excelentíssimo juízo [[JUIZO]], [[PARTES]] vem propor a ação."}'::jsonb));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('steps_no_model', public.advance_case_steps(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_1', 'claim')::integer));
insert into res values ('record_no_model', public.record_case_advance(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_1', 'claim')::integer, pg_temp.got('steps_no_model', 'waiting')));
-- ONE's own writes wake nothing: the record of its look says when to look again, and a new look waits the same.
insert into res values ('woken_by_one', (select to_jsonb(a) from public.case_advances a
  where a.case_id = pg_temp.got('case_1', 'case_id')::uuid));
insert into res values ('claim_again', pg_temp.claim(pg_temp.got('case_1', 'case_id')::uuid));
insert into res values ('steps_again', public.advance_case_steps(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_again', 'claim')::integer));
select public.record_case_advance(pg_temp.got('case_1', 'case_id')::uuid, pg_temp.got('claim_again', 'claim')::integer,
  pg_temp.got('steps_again', 'waiting'));
insert into res values ('waited_no_model', (select to_jsonb(a) from public.case_advances a
  where a.case_id = pg_temp.got('case_1', 'case_id')::uuid));
reset role;
-- A partner says which is the default: the case that waited for one is looked at again.
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('model_default', public.save_draft_template('b4600000-0000-4000-8000-00000000000a',
  pg_temp.got('model_2', 'template_id')::uuid,
  '{"name": "Cancelamento", "proceeding_kind": "juizado", "is_default": true, "body": "Excelentíssimo juízo [[JUIZO]], [[PARTES]] vem propor a ação."}'::jsonb));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('woken', (select to_jsonb(a) from public.case_advances a
  where a.case_id = pg_temp.got('case_1', 'case_id')::uuid));
insert into res values ('claim_piece', pg_temp.claim(pg_temp.got('case_1', 'case_id')::uuid));
insert into res values ('steps_piece', public.advance_case_steps(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_piece', 'claim')::integer));
select public.record_case_advance(pg_temp.got('case_1', 'case_id')::uuid, pg_temp.got('claim_piece', 'claim')::integer,
  pg_temp.got('steps_piece', 'waiting'));
reset role;

select ok(
  pg_temp.got('steps_no_model', 'waiting') = 'no_model'
  and jsonb_array_length((select payload -> 'drafts' from res where name = 'steps_no_model')) = 0
  and pg_temp.got('woken_by_one', 'waiting') = 'no_model'
  and (pg_temp.got('woken_by_one', 'after'))::timestamptz > now() + interval '5 hours'
  and pg_temp.got('steps_again', 'waiting') = 'no_model'
  and pg_temp.got('waited_no_model', 'waiting') = 'no_model'
  and (pg_temp.got('waited_no_model', 'after'))::timestamptz > now() + interval '5 hours'
  and pg_temp.got('woken', 'after') is null
  and not (pg_temp.got('claim_piece', 'lawsuits_due'))::boolean,
  'with more than one model and no default, ONE waits for the firm to say which, and looks again once it does'
);
select ok(
  jsonb_array_length((select payload -> 'drafts' from res where name = 'steps_piece')) = 1
  and pg_temp.got('steps_piece', 'waiting') is null
  and (select d.status = 'generating' and d.mode = 'ai' and d.template_id = pg_temp.got('model_2', 'template_id')::uuid
              and d.requested_by is null
       from public.case_drafts d where d.case_id = pg_temp.got('case_1', 'case_id')::uuid)
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_1', 'case_id')::uuid
              and e.kind = 'draft_requested' and e.actor_type = 'system')
  and (select a.waiting is null and a.after is null and a.claimed_at is null from public.case_advances a
       where a.case_id = pg_temp.got('case_1', 'case_id')::uuid)
  and not (select bool_or(is_default) from public.draft_templates where id = pg_temp.got('model_1', 'template_id')::uuid),
  'ONE asks the AI for the first text of the piece from the firm''s default model, as ONE'
);

-- A lawsuit a person created with nobody signing it, in São Paulo, while the firm has nobody to sign what ONE
-- prepares (Ana stopped; a signer of another state would be named within their causes there, 0052): ONE waits,
-- and names the signer at the bar there once the firm sets one.
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('lawsuit_2', public.save_proceeding(pg_temp.got('case_2', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJSP", "comarca": "São Paulo", "forum_basis": "event_place", "forum_reason": "O voo chegou a São Paulo.", "forum_city": "São Paulo", "system": "eproc"}'::jsonb,
  array[pg_temp.got('case_2', 'party_id')::uuid]));
select public.set_firm_signer('b4600000-0000-4000-8000-00000000000a', 'a4600000-0000-4000-8000-000000000001', false);
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_2', pg_temp.claim(pg_temp.got('case_2', 'case_id')::uuid));
insert into res values ('steps_no_signer', public.advance_case_steps(pg_temp.got('case_2', 'case_id')::uuid,
  pg_temp.got('claim_2', 'claim')::integer));
select public.record_case_advance(pg_temp.got('case_2', 'case_id')::uuid, pg_temp.got('claim_2', 'claim')::integer,
  pg_temp.got('steps_no_signer', 'waiting'));
reset role;
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('bia_signs', public.set_firm_signer('b4600000-0000-4000-8000-00000000000a',
  'a4600000-0000-4000-8000-000000000002', true));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_2b', pg_temp.claim(pg_temp.got('case_2', 'case_id')::uuid));
insert into res values ('steps_signed', public.advance_case_steps(pg_temp.got('case_2', 'case_id')::uuid,
  pg_temp.got('claim_2b', 'claim')::integer));
select public.record_case_advance(pg_temp.got('case_2', 'case_id')::uuid, pg_temp.got('claim_2b', 'claim')::integer,
  pg_temp.got('steps_signed', 'waiting'));
reset role;

select ok(
  pg_temp.got('lawsuit_2', 'code') = 'saved'
  and pg_temp.got('steps_no_signer', 'waiting') = 'no_signer'
  and pg_temp.got('bia_signs', 'code') = 'saved'
  and jsonb_array_length((select payload -> 'drafts' from res where name = 'steps_signed')) = 1
  and (select array_agg(pl.user_id) = array['a4600000-0000-4000-8000-000000000002'::uuid]
       from public.proceeding_lawyers pl where pl.proceeding_id = pg_temp.got('lawsuit_2', 'proceeding_id')::uuid)
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_2', 'case_id')::uuid
              and e.kind = 'signers_named' and e.actor_type = 'system'),
  'a lawsuit nobody signs waits for a signer at the bar in its state, and ONE names who the firm set once there is one'
);

-- ---------- The package ----------

-- The piece of case 1 became its petition (as the issue of 0029 makes it), and the firm accepted the papers.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('files', jsonb_build_object(
  'petition', pg_temp.stored('b4600000-0000-4000-8000-00000000000a', 'peticao.pdf', 'petition'),
  'identity', pg_temp.stored('b4600000-0000-4000-8000-00000000000a', 'rg.pdf'),
  'contract', pg_temp.stored('b4600000-0000-4000-8000-00000000000a', 'contrato.pdf'),
  'evidence', pg_temp.stored('b4600000-0000-4000-8000-00000000000a', 'email.pdf'),
  'orphan', pg_temp.stored('b4600000-0000-4000-8000-00000000000a', 'rg-de-quem-saiu.pdf')));
reset role;
insert into public.case_documents (org_id, case_id, file_id, kind, source, status, decided_at)
values ('b4600000-0000-4000-8000-00000000000a', pg_temp.got('case_1', 'case_id')::uuid, pg_temp.got('files', 'petition')::uuid,
        'petition', 'firm', 'accepted', now());
update public.case_drafts d set status = 'issued', work = null, version = 1, approved_version = 1,
  approved_body = 'Texto aprovado.', approved_at = now(), approved_auto = true,
  document_id = (select cd.id from public.case_documents cd where cd.file_id = pg_temp.got('files', 'petition')::uuid)
where d.case_id = pg_temp.got('case_1', 'case_id')::uuid;
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('doc_identity', public.attach_case_document(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('files', 'identity')::uuid, 'identity', pg_temp.got('case_1', 'party_id')::uuid));
insert into res values ('doc_contract', public.attach_case_document(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('files', 'contract')::uuid, 'contract', pg_temp.got('case_1', 'party_id')::uuid));
insert into res values ('doc_evidence', public.attach_case_document(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('files', 'evidence')::uuid, 'evidence', null));
-- The identity of somebody taken out of the case keeps no party: it is nobody's of the lawsuit.
insert into res values ('doc_orphan', public.attach_case_document(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('files', 'orphan')::uuid, 'identity', null));
select public.decide_case_document(pg_temp.got(x, 'document_id')::uuid, 'accepted')
from unnest(array['doc_identity', 'doc_contract', 'doc_evidence', 'doc_orphan']) as x;
reset role;
-- A paper that arrived and waits for the firm's word keeps the package back; once it is accepted, it goes too.
select pg_temp.as_backend();
set local role service_role;
insert into res values ('files_late', jsonb_build_object(
  'late', pg_temp.stored('b4600000-0000-4000-8000-00000000000a', 'recibo.pdf')));
reset role;
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('doc_late', public.attach_case_document(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('files_late', 'late')::uuid, 'receipt', null));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_docs', pg_temp.claim(pg_temp.got('case_1', 'case_id')::uuid));
insert into res values ('steps_docs', public.advance_case_steps(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_docs', 'claim')::integer, true));
select public.record_case_advance(pg_temp.got('case_1', 'case_id')::uuid, pg_temp.got('claim_docs', 'claim')::integer,
  pg_temp.got('steps_docs', 'waiting'));
reset role;
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
select public.decide_case_document(pg_temp.got('doc_late', 'document_id')::uuid, 'accepted');
reset role;
-- The firm leaves the decision on the Tema 1.417 to a person, who did not decide yet: no package.
insert into public.firm_autonomy (org_id, decision, mode)
values ('b4600000-0000-4000-8000-00000000000a', 'file_or_hold', 'approval');
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_pending', pg_temp.claim(pg_temp.got('case_1', 'case_id')::uuid));
insert into res values ('steps_pending', public.advance_case_steps(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_pending', 'claim')::integer, true));
select public.record_case_advance(pg_temp.got('case_1', 'case_id')::uuid, pg_temp.got('claim_pending', 'claim')::integer,
  pg_temp.got('steps_pending', 'waiting'));
reset role;
delete from public.firm_autonomy where org_id = 'b4600000-0000-4000-8000-00000000000a' and decision = 'file_or_hold';
-- The firm holds the case (Tema 1.417): no package.
update public.cases set suspension_decision = 'hold' where id = pg_temp.got('case_1', 'case_id')::uuid;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_held', pg_temp.claim(pg_temp.got('case_1', 'case_id')::uuid));
insert into res values ('steps_held', public.advance_case_steps(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_held', 'claim')::integer, true));
select public.record_case_advance(pg_temp.got('case_1', 'case_id')::uuid, pg_temp.got('claim_held', 'claim')::integer,
  pg_temp.got('steps_held', 'waiting'));
reset role;
update public.cases set suspension_decision = 'file' where id = pg_temp.got('case_1', 'case_id')::uuid;
-- The system of the lawsuit is ONE's, and the package waits for the firm to approve it (0066).
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_unapproved', pg_temp.claim(pg_temp.got('case_1', 'case_id')::uuid));
insert into res values ('steps_unapproved', public.advance_case_steps(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_unapproved', 'claim')::integer, true));
select public.record_case_advance(pg_temp.got('case_1', 'case_id')::uuid, pg_temp.got('claim_unapproved', 'claim')::integer,
  pg_temp.got('steps_unapproved', 'waiting'));
reset role;
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('system_approved', public.decide_court_system(
  (select p.id from public.proceedings p where p.case_id = pg_temp.got('case_1', 'case_id')::uuid), true));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_package', pg_temp.claim(pg_temp.got('case_1', 'case_id')::uuid));
insert into res values ('steps_package', public.advance_case_steps(pg_temp.got('case_1', 'case_id')::uuid,
  pg_temp.got('claim_package', 'claim')::integer, true));
select public.record_case_advance(pg_temp.got('case_1', 'case_id')::uuid, pg_temp.got('claim_package', 'claim')::integer,
  pg_temp.got('steps_package', 'waiting'));
insert into res values ('claim_after', pg_temp.claim(pg_temp.got('case_1', 'case_id')::uuid));
reset role;

select ok(
  pg_temp.got('steps_docs', 'waiting') = 'documents_waiting'
  and pg_temp.got('steps_pending', 'waiting') = 'suspension_pending'
  and pg_temp.got('steps_held', 'waiting') = 'held'
  and jsonb_array_length((select payload -> 'packages' from res where name = 'steps_held')) = 0
  and pg_temp.got('steps_unapproved', 'waiting') = 'system_unapproved'
  and jsonb_array_length((select payload -> 'packages' from res where name = 'steps_unapproved')) = 0
  and pg_temp.got('system_approved', 'code') = 'approved'
  and jsonb_array_length((select payload -> 'packages' from res where name = 'steps_package')) = 1
  and (select f.status = 'requested' and f.requested_by is null
              and f.document_ids @> array[pg_temp.got('doc_identity', 'document_id')::uuid, pg_temp.got('doc_evidence', 'document_id')::uuid]
              and not (pg_temp.got('doc_contract', 'document_id')::uuid = any (f.document_ids))
              and not (pg_temp.got('doc_orphan', 'document_id')::uuid = any (f.document_ids))
              and pg_temp.got('doc_late', 'document_id')::uuid = any (f.document_ids)
       from public.filing_packages f where f.case_id = pg_temp.got('case_1', 'case_id')::uuid)
  and exists (select 1 from public.case_events e where e.case_id = pg_temp.got('case_1', 'case_id')::uuid
              and e.kind = 'filing_package_requested' and e.actor_type = 'system')
  and pg_temp.got('claim_after', 'case_id') is null,
  'once the piece is the petition, ONE asks for the package with the papers of the lawsuit''s people and of the trip, never the firm''s contract, and never for a case held or whose decision waits for a person'
);

-- A lawyer cancels the package ONE asked for: ONE never asks for another of that lawsuit.
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('package_cancelled', public.cancel_filing_package(
  (select f.id from public.filing_packages f where f.case_id = pg_temp.got('case_1', 'case_id')::uuid)));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_cancelled', pg_temp.claim(pg_temp.got('case_1', 'case_id')::uuid));
reset role;

select ok(
  pg_temp.got('package_cancelled', 'code') = 'cancelled'
  and pg_temp.got('claim_cancelled', 'case_id') is null
  and (select bool_and(cancelled_by_person) from public.filing_packages f
       where f.case_id = pg_temp.got('case_1', 'case_id')::uuid),
  'a package a person cancelled is never asked for again'
);

-- ---------- What a person did stays ----------

-- Case 2's piece is given up by a lawyer: ONE never asks for it again. A third case gets a petition by hand.
update public.case_drafts set status = 'cancelled', work = null where case_id = pg_temp.got('case_2', 'case_id')::uuid;
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_3', pg_temp.ready_case('b4600000-0000-4000-8000-00000000000a', '11144477735'));
insert into res values ('lawsuit_3', public.save_proceeding(pg_temp.got('case_3', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "forum_city": "Goiânia", "system": "projudi"}'::jsonb,
  array[pg_temp.got('case_3', 'party_id')::uuid], array['a4600000-0000-4000-8000-000000000001'::uuid]));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('file_3', jsonb_build_object('id', pg_temp.stored('b4600000-0000-4000-8000-00000000000a', 'minha-peca.pdf')));
reset role;
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('petition_3', public.attach_case_document(pg_temp.got('case_3', 'case_id')::uuid,
  pg_temp.got('file_3', 'id')::uuid, 'petition', null));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_2c', pg_temp.claim(pg_temp.got('case_2', 'case_id')::uuid));
insert into res values ('claim_3', pg_temp.claim(pg_temp.got('case_3', 'case_id')::uuid));
reset role;

select ok(
  pg_temp.got('claim_2c', 'case_id') is null
  and pg_temp.got('claim_3', 'case_id') is null
  and not public.advance_piece_due(pg_temp.got('lawsuit_2', 'proceeding_id')::uuid)
  and not public.advance_piece_due(pg_temp.got('lawsuit_3', 'proceeding_id')::uuid),
  'a piece a person gave up is never asked again, and a petition the firm added by hand keeps ONE from asking for one'
);

-- Signers a person took off a lawsuit are never named again by ONE: the piece waits for a person to name them.
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_6', pg_temp.ready_case('b4600000-0000-4000-8000-00000000000a', '12345678909'));
insert into res values ('lawsuit_6', public.save_proceeding(pg_temp.got('case_6', 'case_id')::uuid, null,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "forum_city": "Goiânia", "system": "projudi"}'::jsonb,
  array[pg_temp.got('case_6', 'party_id')::uuid], array['a4600000-0000-4000-8000-000000000001'::uuid]));
select public.save_proceeding(pg_temp.got('case_6', 'case_id')::uuid, pg_temp.got('lawsuit_6', 'proceeding_id')::uuid,
  '{"kind": "juizado", "court": "TJGO", "comarca": "Goiânia", "forum_basis": "domicile", "forum_city": "Goiânia", "system": "projudi"}'::jsonb,
  null, array[]::uuid[]);
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_6', pg_temp.claim(pg_temp.got('case_6', 'case_id')::uuid));
insert into res values ('steps_6', public.advance_case_steps(pg_temp.got('case_6', 'case_id')::uuid,
  pg_temp.got('claim_6', 'claim')::integer));
select public.record_case_advance(pg_temp.got('case_6', 'case_id')::uuid, pg_temp.got('claim_6', 'claim')::integer,
  pg_temp.got('steps_6', 'waiting'));
reset role;

select ok(
  pg_temp.got('steps_6', 'waiting') = 'signers_removed'
  and jsonb_array_length((select payload -> 'drafts' from res where name = 'steps_6')) = 0
  and not exists (select 1 from public.proceeding_lawyers pl
                  where pl.proceeding_id = pg_temp.got('lawsuit_6', 'proceeding_id')::uuid),
  'signers a person took off a lawsuit are never named again: its piece waits for a person to name who signs'
);

-- Lawsuits a person removed are never made again.
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_4', pg_temp.ready_case('b4600000-0000-4000-8000-00000000000a', '52998224725'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_4', pg_temp.claim(pg_temp.got('case_4', 'case_id')::uuid));
insert into res values ('created_4', public.advance_create_lawsuits(pg_temp.got('case_4', 'case_id')::uuid,
  pg_temp.got('claim_4', 'claim')::integer, pg_temp.plan(pg_temp.got('case_4', 'party_id')::uuid)));
select public.record_case_advance(pg_temp.got('case_4', 'case_id')::uuid, pg_temp.got('claim_4', 'claim')::integer, null);
reset role;
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('removed_4', public.remove_proceeding(
  (select p.id from public.proceedings p where p.case_id = pg_temp.got('case_4', 'case_id')::uuid)));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_4b', pg_temp.claim(pg_temp.got('case_4', 'case_id')::uuid));
reset role;

select ok(
  pg_temp.got('created_4', 'code') = 'created' and pg_temp.got('removed_4', 'code') = 'removed'
  and pg_temp.got('claim_4b', 'case_id') is null
  and not exists (select 1 from public.proceedings p where p.case_id = pg_temp.got('case_4', 'case_id')::uuid),
  'lawsuits a person removed are never made again'
);

-- A look that fails for a moment is tried again later each time, until ONE says it needs a person; and a case that
-- ends while a worker looks at it stays set aside.
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('case_5', pg_temp.ready_case('b4600000-0000-4000-8000-00000000000a', '11144477735'));
reset role;
select pg_temp.as_backend();
set local role service_role;
insert into res values ('claim_5_1', pg_temp.claim(pg_temp.got('case_5', 'case_id')::uuid));
select public.record_case_advance(pg_temp.got('case_5', 'case_id')::uuid, pg_temp.got('claim_5_1', 'claim')::integer,
  null, true);
insert into res values ('failed_1', (select jsonb_build_object('after', a.after, 'attempts', a.attempts, 'waiting', a.waiting)
  from public.case_advances a where a.case_id = pg_temp.got('case_5', 'case_id')::uuid));
insert into res values ('claim_5_2', pg_temp.claim(pg_temp.got('case_5', 'case_id')::uuid));
select public.record_case_advance(pg_temp.got('case_5', 'case_id')::uuid, pg_temp.got('claim_5_2', 'claim')::integer,
  null, true);
insert into res values ('failed_2', (select jsonb_build_object('after', a.after, 'attempts', a.attempts, 'waiting', a.waiting)
  from public.case_advances a where a.case_id = pg_temp.got('case_5', 'case_id')::uuid));
insert into res values ('claim_5_3', pg_temp.claim(pg_temp.got('case_5', 'case_id')::uuid));
select public.record_case_advance(pg_temp.got('case_5', 'case_id')::uuid, pg_temp.got('claim_5_3', 'claim')::integer,
  null, true);
insert into res values ('failed_3', (select jsonb_build_object('after', a.after, 'attempts', a.attempts, 'waiting', a.waiting)
  from public.case_advances a where a.case_id = pg_temp.got('case_5', 'case_id')::uuid));
insert into res values ('claim_5_4', pg_temp.claim(pg_temp.got('case_5', 'case_id')::uuid));
select public.record_case_advance(pg_temp.got('case_5', 'case_id')::uuid, pg_temp.got('claim_5_4', 'claim')::integer,
  null, true);
insert into res values ('failed_4', (select jsonb_build_object('after', a.after, 'attempts', a.attempts, 'waiting', a.waiting)
  from public.case_advances a where a.case_id = pg_temp.got('case_5', 'case_id')::uuid));
insert into res values ('claim_5e', pg_temp.claim(pg_temp.got('case_5', 'case_id')::uuid));
reset role;
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
select public.set_case_status(pg_temp.got('case_5', 'case_id')::uuid, 'declined', 'O cliente desistiu da ação.');
reset role;
select pg_temp.as_backend();
set local role service_role;
select public.record_case_advance(pg_temp.got('case_5', 'case_id')::uuid, pg_temp.got('claim_5e', 'claim')::integer, null);
reset role;

select ok(
  pg_temp.got('failed_1', 'waiting') = 'unavailable' and pg_temp.got('failed_1', 'attempts') = '1'
  and (select (r.payload ->> 'after')::timestamptz < (s.payload ->> 'after')::timestamptz
       from res r, res s where r.name = 'failed_1' and s.name = 'failed_2')
  and pg_temp.got('failed_3', 'waiting') = 'unavailable'
  and pg_temp.got('failed_4', 'waiting') = 'stuck' and pg_temp.got('failed_4', 'attempts') = '4'
  and (pg_temp.got('failed_4', 'after'))::timestamptz > now() + interval '5 hours'
  and (select a.after = 'infinity' and a.waiting is null and a.claimed_at is null from public.case_advances a
       where a.case_id = pg_temp.got('case_5', 'case_id')::uuid),
  'a failed look is tried again later each time until ONE says it needs a person, and a case that ends while looked at stays set aside'
);

-- ---------- Only the backend, only through its own functions ----------

-- A person of another firm who names case 1 as ONE's writes nothing to it.
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000004');
set local role authenticated;
select set_config('one.system_case', pg_temp.got('case_1', 'case_id'), true);
select throws_ok(
  format($$select public.save_proceeding(%L::uuid, null, '{"kind": "juizado"}'::jsonb)$$, pg_temp.got('case_1', 'case_id')),
  'P0002', 'case_not_found',
  'naming a case as ONE''s lets no session write to it'
);
select set_config('one.system_case', '', true);
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.claim_case_advances(integer, uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.advance_create_lawsuits(uuid, integer, jsonb)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.advance_case_steps(uuid, integer, boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.record_case_advance(uuid, integer, text, boolean)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.case_system_writer(uuid)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_firm_signer(uuid, uuid, boolean)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_firm_signer(uuid, uuid, boolean)', 'EXECUTE')
  and has_column_privilege('authenticated', 'public.case_advances', 'waiting', 'SELECT')
  and not has_column_privilege('authenticated', 'public.case_advances', 'claims', 'SELECT')
  and not has_column_privilege('authenticated', 'public.case_advances', 'after', 'SELECT')
  and not has_column_privilege('authenticated', 'public.case_advances', 'woken_at', 'SELECT'),
  'what ONE does to a case is the backend''s; the firm reads what ONE waits for, never the claim'
);

select pg_temp.sign_in('a4600000-0000-4000-8000-000000000001');
set local role authenticated;
select throws_ok(
  $$select public.claim_case_advances(10, null)$$,
  '42501', null,
  'no session claims a case'
);
reset role;

-- ---------- A case that ends is set aside, and comes back reopened ----------

select pg_temp.sign_in('a4600000-0000-4000-8000-000000000004');
set local role authenticated;
select public.set_case_status(pg_temp.got('case_b', 'case_id')::uuid, 'declined', 'O cliente desistiu da ação.');
reset role;
insert into res values ('declined_b', (select to_jsonb(a) from public.case_advances a where a.case_id = pg_temp.got('case_b', 'case_id')::uuid));
select pg_temp.sign_in('a4600000-0000-4000-8000-000000000004');
set local role authenticated;
select public.set_case_status(pg_temp.got('case_b', 'case_id')::uuid, 'intake');
reset role;

select ok(
  pg_temp.got('declined_b', 'after') = 'infinity'
  and (select a.after is null from public.case_advances a where a.case_id = pg_temp.got('case_b', 'case_id')::uuid)
  and (select count(*) = 6 from public.case_advances a where a.org_id = 'b4600000-0000-4000-8000-00000000000a'),
  'every case has its record; one that ends is never read by the sweep, and one reopened is read again'
);

-- ---------- Isolation ----------

select pg_temp.sign_in('a4600000-0000-4000-8000-000000000004');
set local role authenticated;
select ok(
  (select count(*) = 0 from public.firm_signers where org_id = 'b4600000-0000-4000-8000-00000000000a')
  and (select count(*) = 0 from public.case_advances where org_id = 'b4600000-0000-4000-8000-00000000000a')
  and (select count(*) = 1 from public.case_advances where org_id = 'b4600000-0000-4000-8000-00000000000b'),
  'another firm reads nothing of who signs here, nor of what ONE waits for in its cases'
);
reset role;

select pg_temp.sign_in('a4600000-0000-4000-8000-000000000003');
set local role authenticated;
select ok(
  -- Bia: Ana stopped signing what ONE prepares, above.
  (select count(*) = 1 from public.firm_signers where org_id = 'b4600000-0000-4000-8000-00000000000a')
  and (select waiting is null from public.case_advances where case_id = pg_temp.got('case_1', 'case_id')::uuid),
  'anybody of the firm reads who signs what ONE prepares, and what ONE waits for in a case'
);
reset role;

select * from finish();
rollback;
