begin;
create extension if not exists pgtap;
select plan(12);

-- ============================================================
-- The purchase is asked nowhere, and ONE writes a piece again when the
-- client's account came after it (0097). The points of an account and the
-- instructions of the order of the facts leave the purchase out; a piece the
-- AI wrote before the account changed, still with something to complete and
-- touched by nobody, of a lawsuit still planned, is given up and asked again
-- from the same model, as the firm lets ONE start pieces, once per change.
-- Two firms: nothing of one reaches the other.
--
-- Every person, firm and number here is invented.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1000000-0000-4000-8000-000000000097', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@refaz.invalid', '', now(), '{}', '{"display_name":"Ana Lima"}', now(), now()),
  ('a1000000-0000-4000-8000-000000000098', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@refaz.invalid', '', now(), '{}', '{"display_name":"Caio Prado"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1000000-0000-4000-8000-00000000097a', 'Lima Advogados', 'lima-refaz', 'a1000000-0000-4000-8000-000000000097'),
  ('b1000000-0000-4000-8000-00000000097b', 'Prado Advocacia', 'prado-refaz', 'a1000000-0000-4000-8000-000000000098');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1000000-0000-4000-8000-00000000097a', 'a1000000-0000-4000-8000-000000000097', 'owner', 'socio'),
  ('b1000000-0000-4000-8000-00000000097b', 'a1000000-0000-4000-8000-000000000098', 'owner', 'advogado');
insert into public.draft_templates (id, org_id, name, body) values
  ('d1000000-0000-4000-8000-00000000097a', 'b1000000-0000-4000-8000-00000000097a', 'Inicial do juizado',
   'Modelo de teste do escritório A, com o texto de uma peça.'),
  ('d1000000-0000-4000-8000-00000000097b', 'b1000000-0000-4000-8000-00000000097b', 'Inicial do juizado',
   'Modelo de teste do escritório B, com o texto de uma peça.');
-- Firm B keeps the start of a piece to a person.
insert into public.firm_autonomy (org_id, decision, mode) values ('b1000000-0000-4000-8000-00000000097b', 'start_piece', 'approval');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.as_backend() returns void language sql as
$$ select set_config('request.jwt.claims', '{"role":"service_role"}', true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;

-- A case of a firm with a planned lawsuit and the AI's first text of its piece, written `written_ago`; the client's
-- account approved `changed_ago` (null: never). `body` is the text; `edited` adds a version a lawyer wrote.
create function pg_temp.drafted(name text, who uuid, org uuid, template uuid, body text, written_ago interval,
                                changed_ago interval, edited boolean default false) returns void language plpgsql as $$
declare
  made jsonb;
  lawsuit uuid := gen_random_uuid();
  draft uuid := gen_random_uuid();
  statement jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  made := public.create_case(org, 'cancellation', 'LA', date '2026-09-20',
    jsonb_build_object('full_name', 'Cliente ' || initcap(translate(name, '_', ' ')),
                       'phone', '55009999' || lpad((abs(hashtext(name)) % 100000)::text, 5, '0')));
  statement := public.add_case_statement((made ->> 'case_id')::uuid, (made ->> 'party_id')::uuid, null,
    'O voo para Recife foi cancelado quando eu já estava no aeroporto, e passei a noite lá esperando.');
  reset role;
  update public.cases set status = 'drafting' where id = (made ->> 'case_id')::uuid;
  update public.case_statements
  set chronology = '20/09/2026, 21:30: o voo foi cancelado.', chronology_status = 'approved', work = null
  where id = (statement ->> 'statement_id')::uuid;
  insert into public.proceedings (id, org_id, case_id, kind, court, status)
  values (lawsuit, org, (made ->> 'case_id')::uuid, 'juizado', 'TJGO', 'planned');
  insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_id, template_name, template_body, mode, status,
                                  version, requested_auto, requested_at)
  values (draft, org, (made ->> 'case_id')::uuid, lawsuit, template, 'Inicial do juizado',
          'Modelo de teste com o texto de uma peça.', 'ai', 'proposed', case when edited then 2 else 1 end, true,
          now() - written_ago);
  insert into public.case_draft_versions (org_id, draft_id, version, author, body, created_at)
  values (org, draft, 1, 'ai', body, now() - written_ago);
  if edited then
    insert into public.case_draft_versions (org_id, draft_id, version, author, author_id, body, based_on, created_at)
    values (org, draft, 2, 'person', who, body || ' Corrigido por um advogado.', 1, now() - written_ago + interval '1 minute');
  end if;
  if changed_ago is not null then
    insert into public.case_events (org_id, case_id, at, kind, actor_type)
    values (org, (made ->> 'case_id')::uuid, now() - changed_ago, 'chronology_approved', 'ai');
  end if;
  insert into res values (name, made || jsonb_build_object('proceeding_id', lawsuit, 'draft_id', draft));
end;
$$;
-- The backend holds the case's look, as the claim of 0039 does, and asks for the pieces written again.
create function pg_temp.redo(name text) returns jsonb language plpgsql as $$
declare
  held integer;
  answer jsonb;
begin
  update public.case_advances set claimed_at = now(), claims = claims + 1
  where case_id = pg_temp.got(name, 'case_id')::uuid returning claims into held;
  perform pg_temp.as_backend();
  set local role service_role;
  answer := public.advance_redo_pieces(pg_temp.got(name, 'case_id')::uuid, held);
  reset role;
  return answer;
end;
$$;
create function pg_temp.status(name text) returns text language sql as
$$ select status from public.case_drafts where id = pg_temp.got(name, 'draft_id')::uuid; $$;

-- ---------- The purchase is no point of an account ----------

select ok(
  public.statement_account_topics() = array['aviso', 'solucao', 'chegada', 'assistencia', 'gastos', 'consequencias']
  and (select not ((output_schema #> '{properties,faltam,items,enum}') ? 'compra')
              and strpos(system_prompt, 'compra: quando e onde') = 0
              and strpos(system_prompt, 'Quanto você pagou') = 0
              and strpos(system_prompt, 'nunca pergunte por ela') > 0
       from public.prompt_versions where task = 'caso.relato.cronologia' and is_active)
  and (select count(*) = 1 from public.prompt_versions where task = 'caso.relato.cronologia' and is_active),
  'the purchase leaves the points of an account and the instructions in force, which say never to ask it'
);

select ok(
  not has_function_privilege('authenticated', 'public.advance_redo_pieces(uuid, integer)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.advance_redo_pieces(uuid, integer)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.case_account_changed_at(uuid)', 'EXECUTE'),
  'only the backend writes a piece again'
);

-- ---------- The scenes ----------

select pg_temp.drafted('due', 'a1000000-0000-4000-8000-000000000097', 'b1000000-0000-4000-8000-00000000097a',
  'd1000000-0000-4000-8000-00000000097a', 'Excelentíssimo Juízo. [COMPLETAR: quando o cliente chegou]', '5 hours', '1 hour');
select pg_temp.drafted('edited', 'a1000000-0000-4000-8000-000000000097', 'b1000000-0000-4000-8000-00000000097a',
  'd1000000-0000-4000-8000-00000000097a', 'Excelentíssimo Juízo. [COMPLETAR: quando o cliente chegou]', '5 hours', '1 hour', true);
select pg_temp.drafted('whole', 'a1000000-0000-4000-8000-000000000097', 'b1000000-0000-4000-8000-00000000097a',
  'd1000000-0000-4000-8000-00000000097a', 'Excelentíssimo Juízo. O cliente chegou no dia seguinte.', '5 hours', '1 hour');
select pg_temp.drafted('after', 'a1000000-0000-4000-8000-000000000097', 'b1000000-0000-4000-8000-00000000097a',
  'd1000000-0000-4000-8000-00000000097a', 'Excelentíssimo Juízo. [COMPLETAR: quando o cliente chegou]', '30 minutes', '1 hour');
select pg_temp.drafted('untold', 'a1000000-0000-4000-8000-000000000097', 'b1000000-0000-4000-8000-00000000097a',
  'd1000000-0000-4000-8000-00000000097a', 'Excelentíssimo Juízo. [COMPLETAR: quando o cliente chegou]', '5 hours', null);
select pg_temp.drafted('firm_b', 'a1000000-0000-4000-8000-000000000098', 'b1000000-0000-4000-8000-00000000097b',
  'd1000000-0000-4000-8000-00000000097b', 'Excelentíssimo Juízo. [COMPLETAR: quando o cliente chegou]', '5 hours', '1 hour');

-- ---------- Nothing without the look of the case ----------

select pg_temp.as_backend();
set local role service_role;
insert into res values ('unheld', public.advance_redo_pieces(pg_temp.got('due', 'case_id')::uuid, 999));
reset role;
select ok(
  pg_temp.got('unheld', 'code') = 'not_working' and pg_temp.status('due') = 'proposed',
  'a worker that does not hold the case writes nothing again'
);

-- ---------- The account came after the piece: ONE writes it again ----------

insert into res values ('redone', pg_temp.redo('due'));
select ok(
  pg_temp.got('redone', 'code') = 'redone' and pg_temp.status('due') = 'cancelled'
  and (select jsonb_array_length(payload -> 'drafts') = 1 from res where name = 'redone'),
  'a piece the AI wrote before the client''s account, still to complete and touched by nobody, is given up'
);
insert into res select 'new_draft', to_jsonb(d) from public.case_drafts d
where d.id = (select (payload -> 'drafts' ->> 0)::uuid from res where name = 'redone');
select ok(
  pg_temp.got('new_draft', 'status') = 'generating' and pg_temp.got('new_draft', 'work') = 'generate'
  and pg_temp.got('new_draft', 'mode') = 'ai' and pg_temp.got('new_draft', 'requested_auto')::boolean
  and pg_temp.got('new_draft', 'template_id') = 'd1000000-0000-4000-8000-00000000097a'
  and pg_temp.got('new_draft', 'proceeding_id') = pg_temp.got('due', 'proceeding_id'),
  'and a new first text is asked of the AI from the same model, as ONE''s'
);
select ok(
  exists (
    select 1 from public.case_events e
    where e.case_id = pg_temp.got('due', 'case_id')::uuid and e.kind = 'draft_redone' and e.actor_type = 'system'
      and e.data ->> 'draft' = pg_temp.got('due', 'draft_id') and e.data ->> 'new_draft' = pg_temp.got('new_draft', 'id')
  ),
  'the timeline says ONE wrote the piece again'
);

-- Its first text comes after the change: the same change never writes it again.
update public.case_drafts set status = 'proposed', work = null, version = 1
where id = pg_temp.got('new_draft', 'id')::uuid;
insert into public.case_draft_versions (org_id, draft_id, version, author, body)
values ('b1000000-0000-4000-8000-00000000097a', pg_temp.got('new_draft', 'id')::uuid, 1, 'ai',
        'Excelentíssimo Juízo. [COMPLETAR: o que a companhia ofereceu]');
insert into res values ('again', pg_temp.redo('due'));
select ok(
  pg_temp.got('again', 'code') = 'none'
  and (select status = 'proposed' from public.case_drafts where id = pg_temp.got('new_draft', 'id')::uuid),
  'a piece written after the account changed is not written again for the same change'
);

-- ---------- What stays a lawyer's ----------

insert into res values ('edited_look', pg_temp.redo('edited'));
insert into res values ('whole_look', pg_temp.redo('whole'));
select ok(
  pg_temp.got('edited_look', 'code') = 'none' and pg_temp.status('edited') = 'proposed'
  and pg_temp.got('whole_look', 'code') = 'none' and pg_temp.status('whole') = 'proposed',
  'a piece a lawyer edited, or one with nothing to complete, stays as it is'
);

insert into res values ('after_look', pg_temp.redo('after'));
insert into res values ('untold_look', pg_temp.redo('untold'));
select ok(
  pg_temp.got('after_look', 'code') = 'none' and pg_temp.status('after') = 'proposed'
  and pg_temp.got('untold_look', 'code') = 'none' and pg_temp.status('untold') = 'proposed',
  'a piece written after the account, or of a case whose account never came, stays as it is'
);

-- A case the firm declined has nothing written again, whatever its account says.
insert into public.case_events (org_id, case_id, at, kind, actor_type)
values ('b1000000-0000-4000-8000-00000000097a', pg_temp.got('untold', 'case_id')::uuid, now(), 'chronology_approved', 'ai');
update public.cases set status = 'declined', closed_at = now() where id = pg_temp.got('untold', 'case_id')::uuid;
insert into res values ('declined_look', pg_temp.redo('untold'));
select ok(
  pg_temp.got('declined_look', 'code') = 'none'
  and not exists (select 1 from public.case_events where case_id = pg_temp.got('untold', 'case_id')::uuid and kind = 'draft_redone'),
  'a case that ended has nothing written again'
);

-- ---------- A firm that keeps the start of a piece to a person ----------

insert into res values ('firm_b_look', pg_temp.redo('firm_b'));
select ok(
  pg_temp.got('firm_b_look', 'code') = 'none' and pg_temp.status('firm_b') = 'proposed'
  and not exists (select 1 from public.case_events where case_id = pg_temp.got('firm_b', 'case_id')::uuid and kind = 'draft_redone'),
  'a firm that keeps the start of a piece to a person has nothing written again'
);

select ok(
  (select count(*) = 1 from public.case_drafts where org_id = 'b1000000-0000-4000-8000-00000000097b')
  and not exists (
    select 1 from public.case_events e
    join public.case_drafts d on d.id::text = e.data ->> 'new_draft'
    where e.kind = 'draft_redone' and d.org_id <> e.org_id
  ),
  'nothing of one firm''s pieces reaches the other'
);

select * from finish();
rollback;
