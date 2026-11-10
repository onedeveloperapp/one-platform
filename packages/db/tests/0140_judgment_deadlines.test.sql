begin;
create extension if not exists pgtap;
select plan(10);

-- ============================================================
-- A judgment proposes the terms the law gives it (0141): embargos de
-- declaração and the appeal of its lawsuit's kind, as ONE's, once per act,
-- never over a term a person wrote, none of an acórdão's appeal, the appeal
-- once the lawsuit is known, taken back when the publication stops being the
-- judgment (what a person confirmed stays), and nothing where the firm keeps
-- the deadlines of its publications to a person. Two firms: nothing of one
-- reaches the other.
--
-- Every person, firm and number here is invented: the lawsuits are of 2099.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a1400000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@sentencaone.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a1400000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'davi@sentencaone.invalid', '', now(), '{}', '{"display_name":"Davi Rocha"}', now(), now());

insert into public.organizations (id, name, slug, created_by) values
  ('b1400000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-sentencaone', 'a1400000-0000-4000-8000-000000000001'),
  ('b1400000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-sentencaone', 'a1400000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b1400000-0000-4000-8000-00000000000a', 'a1400000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b1400000-0000-4000-8000-00000000000b', 'a1400000-0000-4000-8000-000000000002', 'owner', 'advogado');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.pub(n text) returns uuid language sql as
$$ select ('ce140000-0000-4000-8000-0000000000' || n)::uuid; $$;

-- A case with its client and a lawsuit the court has, of the kind asked.
create function pg_temp.lawsuit(name text, who uuid, org uuid, kind text, cnj text) returns void
language plpgsql as $$
declare
  made jsonb;
  filed jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  made := public.create_case(org, 'cancellation', 'LA', date '2026-09-20',
    jsonb_build_object('full_name', 'Cliente ' || initcap(name), 'birth_date', '1985-04-02'));
  filed := public.save_proceeding((made ->> 'case_id')::uuid, null,
    jsonb_build_object('kind', kind, 'court', 'TJGO', 'system', 'projudi', 'comarca', 'Goiânia', 'status', 'filed',
      'cnj', cnj, 'filed_at', to_char(current_date, 'YYYY-MM-DD')),
    array[(made ->> 'party_id')::uuid]);
  reset role;
  insert into res values (name, made || jsonb_build_object('proceeding_id', filed ->> 'proceeding_id'));
end;
$$;

-- A person of the firm triages a publication as a decision and says whether it is the judgment.
create function pg_temp.person_judges(who uuid, n text, judgment boolean) returns jsonb language plpgsql as $$
declare
  answer jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  if (select category is null from public.publications where id = pg_temp.pub(n)) then
    perform public.triage_publication(pg_temp.pub(n), 'decisao', null);
  end if;
  answer := public.set_publication_judgment(pg_temp.pub(n), judgment, 'person');
  reset role;
  return answer;
end;
$$;

-- ONE triages a publication as a decision, and the backend keeps what the rule of the judgment read of it (0107).
create function pg_temp.one_judges(n text) returns jsonb language plpgsql as $$
declare
  held record;
  started jsonb;
  org uuid := (select org_id from public.publications where id = pg_temp.pub(n));
  answer jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  execute 'set local role service_role';
  select * into held from public.claim_publication_triage(1, pg_temp.pub(n));
  started := public.start_ai_run(org, 'publicacao.triagem', repeat('f', 64), null, 'publication', pg_temp.pub(n)::text,
    'triagem:' || pg_temp.pub(n)::text || ':' || held.claim::text);
  perform public.finish_ai_run((started ->> 'run_id')::uuid, 'succeeded',
    jsonb_build_object('resumo', 'Uma frase.', 'categoria', 'decisao', 'certeza', 'alta', 'urgente', false), 500, 60);
  perform public.record_publication_triage(pg_temp.pub(n), held.claim, 'done', (started ->> 'run_id')::uuid);
  answer := public.record_publication_judgment_rule(pg_temp.pub(n), true);
  execute 'reset role';
  return answer;
end;
$$;

-- The terms of one publication, as act:who:status.
create function pg_temp.terms(n text) returns text language sql as
$$ select coalesce(string_agg(act || ':' || case when proposed_auto and created_by is null then 'one' else 'person' end
     || ':' || status, ',' order by act), '')
   from public.deadlines where publication_id = pg_temp.pub(n); $$;

select pg_temp.lawsuit('jec', 'a1400000-0000-4000-8000-000000000001', 'b1400000-0000-4000-8000-00000000000a',
  'juizado', '5000801-75.2099.8.09.0051');
select pg_temp.lawsuit('civel', 'a1400000-0000-4000-8000-000000000001', 'b1400000-0000-4000-8000-00000000000a',
  'comum', '5000802-60.2099.8.09.0051');
select pg_temp.lawsuit('beta', 'a1400000-0000-4000-8000-000000000002', 'b1400000-0000-4000-8000-00000000000b',
  'juizado', '5000803-45.2099.8.09.0051');

-- What the DJEN brought: A1 to A5 for firm A (A5 of no lawsuit yet), B1 and B2 for firm B.
insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, document_type, body,
  proceeding_id, case_id)
select pg_temp.pub(n), org::uuid, 'sentencaone0000' || n, 'TJGO', cnj, current_date, 'Intimação', doc,
       'SENTENÇA. Dispensado o relatório. Julgo procedente o pedido.',
       case when lawsuit is null then null else pg_temp.got(lawsuit, 'proceeding_id')::uuid end,
       case when lawsuit is null then null else pg_temp.got(lawsuit, 'case_id')::uuid end
from (values
  ('a1', 'b1400000-0000-4000-8000-00000000000a', 'jec', '50008017520998090051', 'Sentença'),
  ('a2', 'b1400000-0000-4000-8000-00000000000a', 'civel', '50008026020998090051', 'Sentença'),
  ('a3', 'b1400000-0000-4000-8000-00000000000a', 'jec', '50008017520998090051', 'Acórdão'),
  ('a4', 'b1400000-0000-4000-8000-00000000000a', 'jec', '50008017520998090051', 'Sentença'),
  ('a5', 'b1400000-0000-4000-8000-00000000000a', null, '50008017520998090051', 'Sentença'),
  ('b1', 'b1400000-0000-4000-8000-00000000000b', 'beta', '50008034520998090051', 'Sentença'),
  ('b2', 'b1400000-0000-4000-8000-00000000000b', 'beta', '50008034520998090051', 'Sentença')
) as p (n, org, lawsuit, cnj, doc);

select ok(
  not has_function_privilege('authenticated', 'public.one_propose_judgment_deadlines(uuid)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.one_propose_judgment_deadlines(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.one_withdraw_judgment_deadlines(uuid)', 'EXECUTE')
  and pg_temp.got('jec', 'proceeding_id') is not null and pg_temp.got('civel', 'proceeding_id') is not null,
  'two lawsuits of firm A, one of each kind, and nobody of a firm calls ONE''s proposal of a judgment''s terms'
);

-- ---------- A judgment a person said is one ----------

insert into res values ('a1', pg_temp.person_judges('a1400000-0000-4000-8000-000000000001', 'a1', true));
select is(
  pg_temp.terms('a1'), 'embargos_declaracao:one:proposed,recurso_inominado:one:proposed',
  'a judgment of the small-claims court proposes embargos and the recurso inominado, as ONE''s'
);

select ok(
  (select bool_and(trigger = 'publication' and trigger_on = current_date and counting = 'business'
                   and proceeding_id = pg_temp.got('jec', 'proceeding_id')::uuid
                   and case_id = pg_temp.got('jec', 'case_id')::uuid
                   and days = case act when 'embargos_declaracao' then 5 else 10 end)
   from public.deadlines where publication_id = pg_temp.pub('a1'))
  and (select count(*) = 2 from public.audit_events a join public.deadlines d on d.id::text = a.entity_id
       where d.publication_id = pg_temp.pub('a1') and a.action = 'deadline.proposed' and a.actor_id is null
         and a.metadata ->> 'from' = 'judgment')
  and (select count(*) = 2 from public.case_events
       where case_id = pg_temp.got('jec', 'case_id')::uuid and kind = 'deadline_proposed' and actor_type = 'system'),
  'each term counts from the publication in the act''s days, on the record and in the case''s timeline as ONE''s'
);

-- ---------- A judgment ONE triaged, of the civil court ----------

insert into res values ('a2', pg_temp.one_judges('a2'));
select ok(
  pg_temp.got('a2', 'code') = 'saved'
  and pg_temp.terms('a2') = 'apelacao:one:proposed,embargos_declaracao:one:proposed'
  and (select days = 15 from public.deadlines where publication_id = pg_temp.pub('a2') and act = 'apelacao'),
  'a judgment ONE triaged in the civil court proposes embargos and the apelação'
);

-- ---------- An acórdão, a term a person wrote first, a judgment of no lawsuit yet ----------

insert into res values ('a3', pg_temp.person_judges('a1400000-0000-4000-8000-000000000001', 'a3', true));

select pg_temp.sign_in('a1400000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('a4-hand', public.propose_deadline(pg_temp.pub('a4'), null, 'Recurso inominado', 'recurso_inominado',
  'publication', null, 10, 'business'));
reset role;
insert into res values ('a4', pg_temp.person_judges('a1400000-0000-4000-8000-000000000001', 'a4', true));
insert into res values ('a5', pg_temp.person_judges('a1400000-0000-4000-8000-000000000001', 'a5', true));
select ok(
  pg_temp.terms('a3') = 'embargos_declaracao:one:proposed'
  and pg_temp.got('a4-hand', 'ok') = 'true'
  and pg_temp.terms('a4') = 'embargos_declaracao:one:proposed,recurso_inominado:person:proposed'
  and pg_temp.terms('a5') = 'embargos_declaracao:one:proposed',
  'an acórdão has no appeal of the lawsuit, a term a person wrote stays theirs, and a judgment of no lawsuit has only embargos'
);

update public.publications
set proceeding_id = pg_temp.got('jec', 'proceeding_id')::uuid, case_id = pg_temp.got('jec', 'case_id')::uuid
where id = pg_temp.pub('a5');
select is(
  pg_temp.terms('a5'), 'embargos_declaracao:one:proposed,recurso_inominado:one:proposed',
  'once the judgment has its lawsuit, its appeal is proposed too'
);

-- ---------- A publication that stops being the judgment ----------

update public.deadlines
set status = 'confirmed', due_on = current_date + 7, confirmed_at = now(),
    confirmed_by = 'a1400000-0000-4000-8000-000000000001'
where publication_id = pg_temp.pub('a1') and act = 'embargos_declaracao';
insert into res values ('a1-not', pg_temp.person_judges('a1400000-0000-4000-8000-000000000001', 'a1', false));
select ok(
  pg_temp.got('a1-not', 'code') = 'saved'
  and pg_temp.terms('a1') = 'embargos_declaracao:one:confirmed,recurso_inominado:one:dismissed'
  and (select dismiss_reason = 'A publicação não é a sentença.' and dismissed_by is null
       from public.deadlines where publication_id = pg_temp.pub('a1') and act = 'recurso_inominado')
  and (select count(*) = 1 from public.case_events
       where case_id = pg_temp.got('jec', 'case_id')::uuid and kind = 'deadline_dismissed' and actor_type = 'system'),
  'a publication that stops being the judgment takes back what ONE proposed, and what a person confirmed stays'
);

insert into res values ('a1-again', pg_temp.person_judges('a1400000-0000-4000-8000-000000000001', 'a1', true));
select is(
  pg_temp.terms('a1'), 'embargos_declaracao:one:confirmed,recurso_inominado:one:dismissed',
  'a judgment said again proposes nothing twice: each act is proposed once per publication'
);

-- ---------- Two firms, and a firm that keeps the deadlines to a person ----------

insert into res values ('b1', pg_temp.person_judges('a1400000-0000-4000-8000-000000000002', 'b1', true));
select ok(
  pg_temp.terms('b1') = 'embargos_declaracao:one:proposed,recurso_inominado:one:proposed'
  and (select bool_and(org_id = 'b1400000-0000-4000-8000-00000000000b') from public.deadlines
       where publication_id = pg_temp.pub('b1'))
  and (select count(*) = 0 from public.deadlines d join public.publications p on p.id = d.publication_id
       where d.org_id = 'b1400000-0000-4000-8000-00000000000b' and p.org_id = 'b1400000-0000-4000-8000-00000000000a'),
  'a judgment of firm B proposes its terms in firm B, and nothing of firm A reaches it'
);

insert into public.firm_autonomy (org_id, decision, mode)
values ('b1400000-0000-4000-8000-00000000000b', 'publication_deadline', 'approval');
insert into res values ('b2', pg_temp.person_judges('a1400000-0000-4000-8000-000000000002', 'b2', true));
select ok(
  pg_temp.got('b2', 'code') = 'saved' and pg_temp.terms('b2') = '',
  'a firm that keeps the deadlines of its publications to a person gets no term proposed by ONE'
);

select * from finish();
rollback;
