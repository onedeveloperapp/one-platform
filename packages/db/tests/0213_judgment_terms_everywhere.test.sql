begin;
create extension if not exists pgtap;
select plan(12);

-- ============================================================
-- The terms after a judgment, wherever it comes from (0213): a judgment
-- given at the hearing proposes its terms from the hearing's day, and its
-- publication later proposes them again only where nothing was counted; a
-- settlement homologated has no appeal; the decision of the embargos starts
-- the appeal's term again, taking back what ONE proposed before (what a
-- person confirmed stays), never after an acórdão; a recurso inominado filed
-- proposes its preparo in 48 hours; nothing where the firm keeps the
-- deadlines to a person. Two firms: nothing of one reaches the other.
--
-- Every person, firm and number here is invented: the lawsuits are of 2099.
-- ============================================================

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('a2130000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'ana@termosone.invalid', '', now(), '{}', '{"display_name":"Ana Souza"}', now(), now()),
  ('a2130000-0000-4000-8000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'caio@termosone.invalid', '', now(), '{}', '{"display_name":"Caio Rocha"}', now(), now());
insert into public.organizations (id, name, slug, created_by) values
  ('b2130000-0000-4000-8000-00000000000a', 'Souza Advogados', 'souza-termosone', 'a2130000-0000-4000-8000-000000000001'),
  ('b2130000-0000-4000-8000-00000000000b', 'Rocha Advocacia', 'rocha-termosone', 'a2130000-0000-4000-8000-000000000002');
insert into public.memberships (org_id, user_id, role, firm_function) values
  ('b2130000-0000-4000-8000-00000000000a', 'a2130000-0000-4000-8000-000000000001', 'owner', 'socio'),
  ('b2130000-0000-4000-8000-00000000000b', 'a2130000-0000-4000-8000-000000000002', 'owner', 'socio');
insert into public.connections (id, org_id, provider, external_id, label, status, connected_by, connected_at) values
  ('c2130000-0000-4000-8000-00000000000a', 'b2130000-0000-4000-8000-00000000000a', 'whatsapp', 'termos-waba-a', 'Chat de teste',
   'connected', 'a2130000-0000-4000-8000-000000000001', now());
update public.platform_settings set value = value || '{"debounce_seconds": 0}'::jsonb where key = 'conversation_agent';
-- Firm B keeps the deadlines of its publications to a person.
insert into public.firm_autonomy (org_id, decision, mode)
values ('b2130000-0000-4000-8000-00000000000b', 'publication_deadline', 'approval');

create temporary table res (name text primary key, payload jsonb);
grant select, insert on res to anon, authenticated, service_role;

create function pg_temp.sign_in(who uuid) returns void language sql as
$$ select set_config('request.jwt.claims', jsonb_build_object('sub', who, 'role', 'authenticated', 'aal', 'aal2')::text, true); $$;
create function pg_temp.got(name text, field text) returns text language sql as
$$ select payload ->> got.field from res where res.name = got.name; $$;
create function pg_temp.pub(n text) returns uuid language sql as
$$ select ('ce213000-0000-4000-8000-0000000000' || n)::uuid; $$;
create function pg_temp.lawsuit_id(name text) returns uuid language sql as
$$ select pg_temp.got(name, 'proceeding_id')::uuid; $$;

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

-- What the DJEN brought of a lawsuit, today or some days ago.
create function pg_temp.publish(n text, lawsuit text, doc text, body text, ago integer default 0) returns void language sql as $$
  insert into public.publications (id, org_id, hash, court, cnj, available_on, kind, document_type, body, proceeding_id, case_id)
  select pg_temp.pub(n), c.org_id, 'termosone0000' || n, 'TJGO', p.cnj, current_date - ago, 'Intimação', doc, body, p.id, p.case_id
  from public.proceedings p join public.cases c on c.id = p.case_id
  where p.id = pg_temp.lawsuit_id(lawsuit);
$$;

-- A person of the firm triages a publication as a decision, and says whether it is the judgment when asked.
create function pg_temp.person_triages(who uuid, n text, judgment boolean) returns jsonb language plpgsql as $$
declare
  answer jsonb := '{}'::jsonb;
begin
  perform pg_temp.sign_in(who);
  set local role authenticated;
  if (select category is null from public.publications where id = pg_temp.pub(n)) then
    perform public.triage_publication(pg_temp.pub(n), 'decisao', null);
  end if;
  if judgment is not null then
    answer := public.set_publication_judgment(pg_temp.pub(n), judgment, 'person');
  end if;
  reset role;
  return answer;
end;
$$;

-- The terms of one publication, or of a lawsuit's days, as act:who:status.
create function pg_temp.terms(n text) returns text language sql as
$$ select coalesce(string_agg(act || ':' || case when proposed_auto and created_by is null then 'one' else 'person' end
     || ':' || status, ',' order by act), '')
   from public.deadlines where publication_id = pg_temp.pub(n); $$;
create function pg_temp.day_terms(lawsuit text) returns text language sql as
$$ select coalesce(string_agg(act || ':' || case when proposed_auto and created_by is null then 'one' else 'person' end
     || ':' || status, ',' order by act), '')
   from public.deadlines where proceeding_id = pg_temp.lawsuit_id(lawsuit) and publication_id is null; $$;

-- A recurso of a lawsuit, issued, as a lawyer marks it filed.
create function pg_temp.recurso_filed(lawsuit text) returns void language plpgsql as $$
declare
  made uuid := gen_random_uuid();
begin
  insert into public.case_drafts (id, org_id, case_id, proceeding_id, template_name, template_body, mode, status, version,
                                  piece_kind, approved_version, approved_body, approved_at)
  select made, p.org_id, p.case_id, p.id, 'Recurso', 'Modelo de teste, com o texto de um recurso.', 'blank', 'issued', 1,
         'recurso', 1, 'Texto do recurso.', now()
  from public.proceedings p where p.id = pg_temp.lawsuit_id(lawsuit);
  update public.case_drafts set filed_at = now(), filed_how = 'lawyer', filing_status = 'filed' where id = made;
end;
$$;

select pg_temp.lawsuit('jec', 'a2130000-0000-4000-8000-000000000001', 'b2130000-0000-4000-8000-00000000000a',
  'juizado', '5000801-75.2099.8.09.0051');
select pg_temp.lawsuit('civel', 'a2130000-0000-4000-8000-000000000001', 'b2130000-0000-4000-8000-00000000000a',
  'comum', '5000802-60.2099.8.09.0051');
select pg_temp.lawsuit('acordo', 'a2130000-0000-4000-8000-000000000001', 'b2130000-0000-4000-8000-00000000000a',
  'juizado', '5000803-45.2099.8.09.0051');
select pg_temp.lawsuit('beta', 'a2130000-0000-4000-8000-000000000002', 'b2130000-0000-4000-8000-00000000000b',
  'juizado', '5000804-30.2099.8.09.0051');

-- ---------- The words ----------

select ok(
  public.reading_homologates_settlement('Homologo o acordo celebrado entre as partes, para que produza seus efeitos.')
  and public.reading_homologates_settlement('HOMOLOGO, por sentença, para que produza seus jurídicos e legais efeitos, a transação entabulada.')
  and public.reading_homologates_settlement('Vistos. Homologado o acordo entre as partes, julgo extinto o processo.')
  and public.reading_homologates_settlement('O acordo firmado entre as partes fica homologado. P.R.I.')
  and not public.reading_homologates_settlement('Homologo o projeto de sentença do juiz leigo, para que produza seus efeitos.')
  and not public.reading_homologates_settlement('Homologo o projeto de sentença do juiz leigo, que reconheceu não haver o acordo alegado.')
  and not public.reading_homologates_settlement('Julgo procedente o pedido. As partes não chegaram a acordo na audiência.')
  and not public.reading_homologates_settlement('Homologo os cálculos. Intime-se a ré para pagar.'),
  'a settlement homologated is read in the words the rule of the app reads it in, and the juiz leigo''s project is none'
);

select ok(
  public.reading_decides_embargos('Conheço dos embargos de declaração e, no mérito, rejeito-os.')
  and public.reading_decides_embargos('Ante o exposto, REJEITO os embargos de declaração opostos pela ré.')
  and public.reading_decides_embargos('Acolho parcialmente os embargos para sanar a omissão apontada.')
  and public.reading_decides_embargos('Dou provimento aos embargos declaratórios, com efeitos infringentes.')
  and public.reading_decides_embargos('Embargos de declaração rejeitados. Mantenho a sentença por seus próprios fundamentos.')
  and public.reading_decides_embargos('Recebo os embargos de declaração, pois tempestivos. No mérito, nego-lhes provimento.')
  and not public.reading_decides_embargos('Opostos embargos de declaração, intime-se a parte embargada para, querendo, manifestar-se em 5 dias.')
  and not public.reading_decides_embargos('Julgo procedente o pedido. Nego provimento ao recurso.')
  and not public.reading_decides_embargos('Recebo os embargos de declaração. Conclusos.'),
  'a decision of the embargos is read in the same words, and an order on their course is none'
);

-- ---------- A settlement homologated ----------

select pg_temp.publish('a1', 'acordo', 'Sentença', 'Vistos. Homologo o acordo celebrado entre as partes, para que produza seus efeitos. P.R.I.');
insert into res values ('a1', pg_temp.person_triages('a2130000-0000-4000-8000-000000000001', 'a1', true));
select is(
  pg_temp.terms('a1'), 'embargos_declaracao:one:proposed',
  'a judgment that homologates the settlement proposes the embargos and no recurso inominado'
);

-- ---------- A judgment given at the hearing ----------

insert into public.hearings (id, org_id, case_id, proceeding_id, kind, starts_at, time_zone, mode, attendee_user_id)
select 'a7213000-0000-4000-8000-000000000001', p.org_id, p.case_id, p.id, 'instrucao', now() - interval '1 hour',
       'America/Sao_Paulo', 'videoconferencia', 'a2130000-0000-4000-8000-000000000001'
from public.proceedings p where p.id = pg_temp.lawsuit_id('jec');

select pg_temp.sign_in('a2130000-0000-4000-8000-000000000001');
set local role authenticated;
insert into res values ('phone', public.set_my_whatsapp('(00) 98888-0213'));
reset role;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('number_a', public.register_wa_number('b2130000-0000-4000-8000-00000000000a',
  'c2130000-0000-4000-8000-00000000000a', 'test', 'termos-number-a', 'termos-waba-a', '5500900000213', 'Souza Advogados', 'cloud'));
insert into res values ('ana', jsonb_build_object('conversation', (public.wa_ingest_inbound('b2130000-0000-4000-8000-00000000000a',
  (select n.id from public.wa_numbers n where n.org_id = 'b2130000-0000-4000-8000-00000000000a' and n.provider = 'test'),
  '5500988880213', 'Ana', 'test.in.' || gen_random_uuid(), 'text', 'A juíza deu a sentença na audiência, procedente.')
  ->> 'conversation_id')));
insert into res values ('ana_claim', jsonb_build_object('claim',
  ((public.claim_conversation_turns(1, pg_temp.got('ana', 'conversation')::uuid) -> 0) ->> 'claim')::integer));
reset role;

insert into res values ('run', jsonb_build_object('id', gen_random_uuid()));
insert into public.ai_runs (id, org_id, task, prompt_version_id, provider, model, input_hash, status, output, finished_at)
select pg_temp.got('run', 'id')::uuid, 'b2130000-0000-4000-8000-00000000000a', 'audiencia.resultado', v.id, 'fake', 'fake',
       repeat('a', 64), 'succeeded',
       jsonb_build_object('resultado', 'sentenca', 'valor_reais', '', 'pagamento_dias', '', 'resumo', 'Sentença de procedência dada na audiência.'),
       now()
from public.prompt_versions v where v.task = 'audiencia.resultado' and v.is_active;

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
set local role service_role;
insert into res values ('recorded', public.record_hearing_report(pg_temp.got('ana', 'conversation')::uuid,
  pg_temp.got('ana_claim', 'claim')::integer, 'a7213000-0000-4000-8000-000000000001', pg_temp.got('run', 'id')::uuid));
reset role;

select ok(
  pg_temp.got('recorded', 'code') = 'recorded' and pg_temp.got('recorded', 'terms') = '2'
  and pg_temp.day_terms('jec') = 'embargos_declaracao:one:proposed,recurso_inominado:one:proposed'
  and (select bool_and(trigger = 'day' and counting = 'business'
                       and trigger_on = ((now() - interval '1 hour') at time zone 'America/Sao_Paulo')::date
                       and days = case act when 'embargos_declaracao' then 5 else 10 end)
       from public.deadlines where proceeding_id = pg_temp.lawsuit_id('jec') and publication_id is null)
  and (select count(*) = 2 from public.audit_events a join public.deadlines d on d.id::text = a.entity_id
       where d.proceeding_id = pg_temp.lawsuit_id('jec') and a.action = 'deadline.proposed' and a.metadata ->> 'from' = 'hearing'),
  'a judgment given at the hearing proposes the embargos and the recurso inominado from the hearing''s day, as ONE''s'
);

-- The same judgment published afterwards.
select pg_temp.publish('d1', 'jec', 'Sentença', 'SENTENÇA. Dispensado o relatório. Julgo procedente o pedido.');
insert into res values ('d1', pg_temp.person_triages('a2130000-0000-4000-8000-000000000001', 'd1', true));
select is(
  pg_temp.terms('d1'), '',
  'its publication proposes no second term of an act already counted from the hearing''s day'
);

-- ---------- The decision of the embargos ----------

select pg_temp.publish('c1', 'civel', 'Sentença', 'SENTENÇA. Julgo parcialmente procedente o pedido. P.R.I.', 6);
insert into res values ('c1', pg_temp.person_triages('a2130000-0000-4000-8000-000000000001', 'c1', true));
select pg_temp.publish('c2', 'civel', 'Decisão', 'Vistos. Conheço dos embargos de declaração e, no mérito, rejeito-os. Intimem-se.', 4);
insert into res values ('c2', pg_temp.person_triages('a2130000-0000-4000-8000-000000000001', 'c2', null));
select ok(
  pg_temp.terms('c1') = 'apelacao:one:dismissed,embargos_declaracao:one:proposed'
  and (select dismiss_reason = 'Os embargos de declaração interromperam o prazo do recurso, que corre de novo da decisão dos embargos.'
              and dismissed_by is null
       from public.deadlines where publication_id = pg_temp.pub('c1') and act = 'apelacao')
  and pg_temp.terms('c2') = 'apelacao:one:proposed'
  and (select days = 15 and trigger = 'publication' from public.deadlines where publication_id = pg_temp.pub('c2')),
  'the decision of the embargos takes back the apelação ONE proposed of the judgment and proposes it again from itself'
);

-- A term a person confirmed stays theirs; the decision still proposes the appeal from itself.
update public.deadlines
set status = 'confirmed', due_on = current_date + 7, confirmed_at = now(),
    confirmed_by = 'a2130000-0000-4000-8000-000000000001'
where proceeding_id = pg_temp.lawsuit_id('jec') and publication_id is null and act = 'recurso_inominado';
select pg_temp.publish('d2', 'jec', 'Decisão', 'Ante o exposto, REJEITO os embargos de declaração opostos pela ré.');
insert into res values ('d2', pg_temp.person_triages('a2130000-0000-4000-8000-000000000001', 'd2', null));
select ok(
  pg_temp.day_terms('jec') = 'embargos_declaracao:one:proposed,recurso_inominado:one:confirmed'
  and pg_temp.terms('d2') = 'recurso_inominado:one:proposed',
  'a term a person confirmed stays, and the decision of the embargos proposes the recurso inominado from itself'
);

-- After an acórdão, the embargos are of the acórdão: no appeal of the lawsuit is proposed.
select pg_temp.publish('c3', 'civel', 'Acórdão', 'ACÓRDÃO. Nego provimento ao recurso.', 2);
insert into res values ('c3', pg_temp.person_triages('a2130000-0000-4000-8000-000000000001', 'c3', true));
select pg_temp.publish('c4', 'civel', 'Decisão', 'Rejeito os embargos de declaração. Intimem-se.');
insert into res values ('c4', pg_temp.person_triages('a2130000-0000-4000-8000-000000000001', 'c4', null));
select ok(
  pg_temp.terms('c4') = ''
  and (select status = 'proposed' from public.deadlines where publication_id = pg_temp.pub('c2') and act = 'apelacao'),
  'the decision of embargos against an acórdão proposes no appeal of the lawsuit, and takes nothing back'
);

-- ---------- The preparo of a recurso inominado filed ----------

select pg_temp.recurso_filed('jec');
select pg_temp.recurso_filed('civel');
select ok(
  (select count(*) = 1 from public.deadlines d
   where d.proceeding_id = pg_temp.lawsuit_id('jec') and d.act = 'preparo_recurso_inominado' and d.trigger = 'day'
     and d.trigger_on = (now() at time zone 'America/Sao_Paulo')::date and d.days = 2 and d.counting = 'calendar'
     and d.proposed_auto and d.created_by is null)
  and not exists (select 1 from public.deadlines d
                  where d.proceeding_id = pg_temp.lawsuit_id('civel') and d.act = 'preparo_recurso_inominado'),
  'a recurso inominado filed proposes its preparo in 48 hours, and an apelação none'
);

-- ---------- A firm that keeps the deadlines to a person, and two firms ----------

select pg_temp.publish('b1', 'beta', 'Sentença', 'SENTENÇA. Julgo procedente o pedido.');
insert into res values ('b1', pg_temp.person_triages('a2130000-0000-4000-8000-000000000002', 'b1', true));
select pg_temp.publish('b2', 'beta', 'Decisão', 'Rejeito os embargos de declaração.');
insert into res values ('b2', pg_temp.person_triages('a2130000-0000-4000-8000-000000000002', 'b2', null));
select pg_temp.recurso_filed('beta');
select ok(
  not exists (select 1 from public.deadlines where org_id = 'b2130000-0000-4000-8000-00000000000b'),
  'a firm that keeps the deadlines of its publications to a person gets no term proposed by ONE'
);

select pg_temp.sign_in('a2130000-0000-4000-8000-000000000002');
set local role authenticated;
select ok(
  (select count(*) from public.deadlines) = 0,
  'firm B reads none of firm A''s terms'
);
reset role;

select ok(
  not has_function_privilege('authenticated', 'public.one_propose_term(uuid, uuid, text, date, text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.one_propose_term(uuid, uuid, text, date, text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.one_reopen_appeal_after_embargos(uuid)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.reading_decides_embargos(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.reading_homologates_settlement(text)', 'EXECUTE')
  and exists (select 1 from public.deadline_acts where slug = 'preparo_recurso_inominado' and days = 2
              and counting = 'calendar' and proceeding_kinds = '{juizado}'),
  'nobody of a firm calls ONE''s proposals, and the preparo is an act of the list'
);

select * from finish();
rollback;
