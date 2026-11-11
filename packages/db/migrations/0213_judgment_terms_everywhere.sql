-- ============================================================
-- 0213 · The terms after a judgment, wherever the judgment comes from.
--
-- From the review of 2026-11-11 against the Código de Processo Civil (Lei
-- 13.105/2015) and the Lei 9.099/1995. ONE proposed the terms of a judgment
-- only from a publication said to be one (0141), and four of the law's terms
-- were missed:
--
--   * A judgment given at the hearing. The parties are intimated there (Lei
--     9.099/1995, art. 19, § 1º; CPC, art. 1.003, § 1º), and the gazette may
--     never publish it. When who went reports a judgment (0187), ONE proposes
--     the embargos de declaração and the appeal of the lawsuit's kind from the
--     hearing's day. A publication of the same judgment later proposes no
--     second term of an act already counted from a day in the 30 days before
--     it.
--   * A judgment that homologates the parties' settlement. No recurso
--     inominado (Lei 9.099/1995, art. 41) and no apelação (whoever settled
--     accepted it: CPC, art. 1.000): only the embargos, for a material error.
--   * The decision of the embargos de declaração. It interrupts the term to
--     appeal, which runs whole again from it (Lei 9.099/1995, art. 50; CPC,
--     art. 1.026). A decision triaged in force that rules on embargos, of a
--     lawsuit whose last judgment is a sentença with no final judgment after
--     it, proposes the appeal again from itself; what ONE proposed of the
--     appeal before, and nobody of the firm confirmed, is taken back with why.
--   * The preparo of the recurso inominado. It is due within the 48 hours
--     after the recurso is filed, with no intimation, or the appeal is
--     deserted (Lei 9.099/1995, art. 42, § 1º). A recurso of a lawsuit of the
--     small-claims court marked filed (0189) proposes it: two calendar days
--     from the filing, a last day with no business moving to the next.
--
-- Each term is ONE's (no `created_by`, `proposed_auto`), on the record and in
-- the case's timeline, only where the firm lets ONE propose the deadlines of
-- its publications (`publication_deadline`, 0040), and the backend counts and
-- confirms it as any other (0034). The words are read by the same forms as
-- `@flyee/rules/judgment` (`acordo-v1`, `embargos-v1`).
-- ============================================================

-- ---------- The act of the preparo ----------

insert into public.deadline_acts (slug, name, days, counting, proceeding_kinds, basis, position)
values ('preparo_recurso_inominado', 'Preparo do recurso inominado (48 horas)', 2, 'calendar', '{juizado}',
        'Lei nº 9.099/1995, art. 42, § 1º', 65)
on conflict (slug) do nothing;

-- ---------- What the words of a decision say ----------

/**
 * Whether a court's text homologates the parties' settlement (`acordo-v1` of `@flyee/rules/judgment`): "homologo"
 * and the settlement before the sentence ends, never a "projeto de sentença" of the juiz leigo; or the settlement
 * said homologated.
 */
create or replace function public.reading_homologates_settlement(body text)
returns boolean
language sql
immutable
set search_path = public
as $$
  with t as (select public.reading_light(public.reading_unmarked(body)) as words)
  select exists (
           select 1 from t, regexp_matches(t.words, '\yhomologo\y([^.;]{0,160})', 'g') as m
           where m[1] ~ '\y(o acordo|a transacao|a conciliacao|a composicao|o termo de acordo)\y'
             and m[1] !~ '\y(projeto de sentenca|juiz leigo)\y'
         )
      or (select t.words ~ '\yhomologad[oa],? (por sentenca,? )?(o |a )?(acordo|transacao|conciliacao|composicao)\y'
              or t.words ~ '\y(acordo|transacao|conciliacao|composicao) (celebrad[oa] |firmad[oa] |entabulad[oa] )?(entre as partes )?(fica |foi )?homologad[oa]\y'
          from t);
$$;

revoke all on function public.reading_homologates_settlement(text) from public, anon, authenticated;

/**
 * Whether a court's text rules on embargos de declaração (`embargos-v1` of `@flyee/rules/judgment`): the embargos
 * decided, never an order on their course.
 */
create or replace function public.reading_decides_embargos(body text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select t.words ~ '\y(acolho|rejeito|desacolho|conheco|nao conheco|deixo de conhecer|deixo de acolher|dou (parcial )?provimento|nego provimento|julgo (im)?procedentes)( em parte| parcialmente)?,? (os |aos |dos )?(presentes |referidos )?embargos\y'
      or t.words ~ '\yembargos (de declaracao|declaratorios)\y[^.;]{0,80}\y(acolhidos|rejeitados|conhecidos|providos|improvidos|desprovidos)\y'
      or t.words ~ '\yembargos (de declaracao|declaratorios)\y.{0,200}(\yrejeito-os\y|\yacolho-os\y|\yos rejeito\y|\yos acolho\y|\ynego-lhes provimento\y|\ydou-lhes (parcial )?provimento\y)'
  from (select public.reading_light(public.reading_unmarked(body)) as words) t;
$$;

revoke all on function public.reading_decides_embargos(text) from public, anon, authenticated;

-- ---------- ONE proposes one term ----------

/**
 * ONE proposes the term of one act of a lawsuit the court has: from a publication of it, or from a day. Once per act
 * and publication, or per act, lawsuit and day, whatever became of it; never past the firm's ceiling of open terms.
 * Written as ONE's, on the record (`from` says why) and in the case's timeline. Answers the new term, or null.
 * Internal: the callers check what the firm lets ONE do.
 */
create or replace function public.one_propose_term(
  target_proceeding uuid,
  target_publication uuid,
  target_act text,
  target_on date,
  target_from text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  act_row public.deadline_acts%rowtype;
  publication public.publications%rowtype;
  trigger_kind text := case when target_publication is null then 'day' else 'publication' end;
  from_day date := target_on;
  open_count integer;
  new_id uuid;
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found or lawsuit.status = 'planned' or lawsuit.cnj is null or lawsuit.court is null then
    return null;
  end if;
  select * into act_row from public.deadline_acts a where a.slug = target_act and a.active;
  if not found then
    return null;
  end if;
  if target_publication is not null then
    select * into publication from public.publications p
    where p.id = target_publication and p.org_id = lawsuit.org_id and p.proceeding_id = lawsuit.id and p.active;
    if not found then
      return null;
    end if;
    from_day := publication.available_on;
    if exists (select 1 from public.deadlines d where d.publication_id = publication.id and d.act = act_row.slug) then
      return null;
    end if;
  elsif exists (
    select 1 from public.deadlines d
    where d.proceeding_id = lawsuit.id and d.publication_id is null and d.act = act_row.slug
      and d.trigger = 'day' and d.trigger_on = from_day
  ) then
    return null;
  end if;
  if public.deadline_input_refusal(public.deadline_text(act_row.name), act_row.slug, trigger_kind, from_day,
       act_row.days, act_row.counting) is not null then
    return null;
  end if;
  select count(*) into open_count from public.deadlines d
  where d.org_id = lawsuit.org_id and d.status in ('proposed', 'confirmed')
    and (case when target_publication is not null then d.publication_id = target_publication
              else d.proceeding_id = lawsuit.id and d.publication_id is null end);
  if open_count >= greatest(public.deadlines_setting('max_open', 20), 1) then
    return null;
  end if;

  insert into public.deadlines (
    org_id, cnj, court, case_id, proceeding_id, publication_id, title, act, trigger, trigger_on, days, counting,
    created_by, proposed_auto
  ) values (
    lawsuit.org_id, coalesce(publication.cnj, lawsuit.cnj), coalesce(publication.court, lawsuit.court),
    lawsuit.case_id, lawsuit.id, target_publication, public.deadline_text(act_row.name), act_row.slug, trigger_kind,
    from_day, act_row.days, act_row.counting, null, true
  )
  returning id into new_id;

  insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (lawsuit.org_id, null, 'system', 'deadline.proposed', 'deadline', new_id::text, jsonb_strip_nulls(jsonb_build_object(
    'publication', target_publication, 'proceeding', lawsuit.id, 'act', act_row.slug, 'days', act_row.days,
    'counting', act_row.counting, 'trigger', trigger_kind, 'auto', true, 'from', target_from
  )));
  if lawsuit.case_id is not null then
    perform public.record_case_event(lawsuit.org_id, lawsuit.case_id, 'deadline_proposed', 'system',
      jsonb_build_object('deadline', new_id));
  end if;
  return new_id;
end;
$$;

revoke all on function public.one_propose_term(uuid, uuid, text, date, text) from public, anon, authenticated;

-- ---------- A judgment's terms (0141, redefined) ----------

/**
 * ONE proposes the terms of a judgment (0141): the embargos de declaração, and the appeal of its lawsuit's kind (none
 * of an acórdão, nor of a publication of no lawsuit of the firm). Now (0213) no appeal of a judgment that homologates
 * the parties' settlement (Lei 9.099/1995, art. 41; CPC, art. 1.000), and no term of an act already counted from a
 * day in the 30 days before the publication (the judgment given at the hearing, or one a person counted from the day
 * it was read), unless the publication rules on embargos, which start the appeal's term again. Each act once per
 * publication, whoever wrote it; the firm's ceiling of open deadlines per publication holds. Internal.
 */
create or replace function public.one_propose_judgment_deadlines(target_publication uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  publication public.publications%rowtype;
  lawsuit_kind text;
  wanted text[] := array['embargos_declaracao'];
  act_row public.deadline_acts%rowtype;
  open_count integer;
  new_id uuid;
  made integer := 0;
  embargos boolean;
begin
  select * into publication from public.publications where id = target_publication;
  if not found or not publication.active or publication.judgment is not true
     or publication.category is distinct from 'decisao' then
    return 0;
  end if;
  if public.firm_autonomy_mode(publication.org_id, 'publication_deadline') is distinct from 'auto' then
    return 0;
  end if;
  if publication.proceeding_id is not null then
    select p.kind into lawsuit_kind from public.proceedings p
    where p.id = publication.proceeding_id and p.org_id = publication.org_id;
  end if;
  -- An acórdão is the appeal's own judgment, and a settlement homologated is accepted by whoever settled: no
  -- recurso inominado nor apelação of either.
  if lower(coalesce(publication.document_type, '')) !~ 'ac[oó]rd[aã]o'
     and not public.reading_homologates_settlement(publication.body) then
    wanted := wanted || case lawsuit_kind
      when 'juizado' then array['recurso_inominado']
      when 'comum' then array['apelacao']
      else array[]::text[]
    end;
  end if;
  embargos := public.reading_decides_embargos(publication.body);

  for act_row in
    select * from public.deadline_acts a where a.slug = any (wanted) and a.active order by a.position
  loop
    continue when exists (
      select 1 from public.deadlines d where d.publication_id = publication.id and d.act = act_row.slug
    );
    -- The same judgment, already counted from the day it was given or read.
    continue when not embargos and publication.proceeding_id is not null and exists (
      select 1 from public.deadlines d
      where d.proceeding_id = publication.proceeding_id and d.publication_id is null and d.act = act_row.slug
        and d.trigger = 'day' and d.status <> 'dismissed'
        and d.trigger_on between publication.available_on - 30 and publication.available_on
    );
    continue when public.deadline_input_refusal(public.deadline_text(act_row.name), act_row.slug, 'publication',
      publication.available_on, act_row.days, act_row.counting) is not null;
    select count(*) into open_count from public.deadlines d
    where d.org_id = publication.org_id and d.publication_id = publication.id and d.status in ('proposed', 'confirmed');
    exit when open_count >= greatest(public.deadlines_setting('max_open', 20), 1);

    insert into public.deadlines (
      org_id, cnj, court, case_id, proceeding_id, publication_id, title, act, trigger, trigger_on, days, counting,
      created_by, proposed_auto
    ) values (
      publication.org_id, publication.cnj, publication.court, publication.case_id, publication.proceeding_id,
      publication.id, public.deadline_text(act_row.name), act_row.slug, 'publication', publication.available_on,
      act_row.days, act_row.counting, null, true
    )
    returning id into new_id;

    insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
    values (publication.org_id, null, 'system', 'deadline.proposed', 'deadline', new_id::text, jsonb_strip_nulls(jsonb_build_object(
      'publication', publication.id, 'proceeding', publication.proceeding_id, 'act', act_row.slug, 'days', act_row.days,
      'counting', act_row.counting, 'trigger', 'publication', 'auto', true, 'from', 'judgment'
    )));
    if publication.case_id is not null then
      perform public.record_case_event(publication.org_id, publication.case_id, 'deadline_proposed', 'system',
        jsonb_build_object('deadline', new_id));
    end if;
    made := made + 1;
  end loop;
  return made;
end;
$$;

revoke all on function public.one_propose_judgment_deadlines(uuid) from public, anon, authenticated;

-- ---------- The decision of the embargos starts the appeal's term again ----------

/**
 * A decision that rules on embargos de declaração of the lawsuit's last judgment, a sentença with no final judgment
 * recorded after it, starts the term to appeal again (Lei 9.099/1995, art. 50; CPC, art. 1.026): ONE takes back what
 * it proposed of the appeal before and nobody of the firm confirmed (still proposed, or confirmed by ONE itself), and
 * proposes the appeal from the decision. Only of a decision in force of the last 30 days, in a firm that lets ONE
 * propose the deadlines of its publications. Answers how many terms it proposed. Internal.
 */
create or replace function public.one_reopen_appeal_after_embargos(target_publication uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  publication public.publications%rowtype;
  lawsuit public.proceedings%rowtype;
  earlier public.publications%rowtype;
  appeal text;
  taken record;
  made uuid;
begin
  select * into publication from public.publications where id = target_publication;
  if not found or not publication.active or publication.category is distinct from 'decisao'
     or publication.proceeding_id is null
     or publication.available_on < (now() at time zone 'America/Sao_Paulo')::date - 30
     or lower(coalesce(publication.document_type, '')) ~ 'ac[oó]rd[aã]o'
     or not public.reading_decides_embargos(publication.body) then
    return 0;
  end if;
  if public.firm_autonomy_mode(publication.org_id, 'publication_deadline') is distinct from 'auto' then
    return 0;
  end if;
  select * into lawsuit from public.proceedings p where p.id = publication.proceeding_id and p.org_id = publication.org_id;
  if not found or lawsuit.kind not in ('juizado', 'comum') then
    return 0;
  end if;
  -- The judgment the embargos were of: the lawsuit's last before the decision, published, or given at a hearing.
  select * into earlier from public.publications p
  where p.proceeding_id = lawsuit.id and p.org_id = lawsuit.org_id and p.id <> publication.id and p.active
    and p.judgment is true and p.available_on <= publication.available_on
  order by p.available_on desc, p.captured_at desc
  limit 1;
  if earlier.id is not null then
    if lower(coalesce(earlier.document_type, '')) ~ 'ac[oó]rd[aã]o' then
      return 0;
    end if;
  elsif not exists (
    select 1 from public.hearing_reports r join public.hearings h on h.id = r.hearing_id
    where h.proceeding_id = lawsuit.id and r.result = 'sentenca'
      and (h.starts_at at time zone h.time_zone)::date <= publication.available_on
  ) then
    return 0;
  end if;
  if exists (
    select 1 from public.lawsuit_facts f
    where f.proceeding_id = lawsuit.id and f.kind = 'transito' and f.corrected_at is null
  ) then
    return 0;
  end if;
  appeal := case lawsuit.kind when 'juizado' then 'recurso_inominado' else 'apelacao' end;

  for taken in
    select d.id, d.org_id, d.case_id, d.status, d.due_on from public.deadlines d
    where d.proceeding_id = lawsuit.id and d.act = appeal
      and d.publication_id is distinct from publication.id
      and d.proposed_auto and d.created_by is null
      and (d.status = 'proposed' or (d.status = 'confirmed' and d.confirmed_auto))
    for update
  loop
    update public.deadlines
    set status = 'dismissed',
        dismiss_reason = 'Os embargos de declaração interromperam o prazo do recurso, que corre de novo da decisão dos embargos.',
        dismissed_by = null, dismissed_at = now()
    where id = taken.id;
    insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
    values (taken.org_id, null, 'system', 'deadline.dismissed', 'deadline', taken.id::text, jsonb_strip_nulls(jsonb_build_object(
      'was', taken.status, 'due_on', taken.due_on, 'auto', true, 'reason', 'embargos'
    )));
    if taken.case_id is not null then
      perform public.record_case_event(taken.org_id, taken.case_id, 'deadline_dismissed', 'system',
        jsonb_build_object('deadline', taken.id));
    end if;
  end loop;
  made := public.one_propose_term(lawsuit.id, publication.id, appeal, null, 'embargos');
  return case when made is null then 0 else 1 end;
end;
$$;

revoke all on function public.one_reopen_appeal_after_embargos(uuid) from public, anon, authenticated;

create or replace function public.publications_embargos_reopen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.one_reopen_appeal_after_embargos(new.id);
  return null;
end;
$$;

revoke all on function public.publications_embargos_reopen() from public, anon, authenticated;

create trigger publications_embargos_reopen after update of category, proceeding_id on public.publications
  for each row
  when (new.category = 'decisao' and new.active and new.proceeding_id is not null
        and (old.category is distinct from new.category or old.proceeding_id is distinct from new.proceeding_id))
  execute function public.publications_embargos_reopen();

-- ---------- The preparo of a recurso inominado filed ----------

/**
 * A recurso of a lawsuit of the small-claims court marked filed proposes its preparo, due in the 48 hours after,
 * with no intimation (Lei 9.099/1995, art. 42, § 1º): two calendar days from the day it was filed, in a firm that
 * lets ONE propose the deadlines of its publications. A recurso that asks free justice is exempt until the court
 * decides it: the person dismisses the term then.
 */
create or replace function public.case_drafts_preparo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
begin
  select * into lawsuit from public.proceedings where id = new.proceeding_id and org_id = new.org_id;
  if not found or lawsuit.kind is distinct from 'juizado' then
    return null;
  end if;
  if public.firm_autonomy_mode(lawsuit.org_id, 'publication_deadline') is distinct from 'auto' then
    return null;
  end if;
  perform public.one_propose_term(lawsuit.id, null, 'preparo_recurso_inominado',
    (new.filed_at at time zone 'America/Sao_Paulo')::date, 'recurso_filed');
  return null;
end;
$$;

revoke all on function public.case_drafts_preparo() from public, anon, authenticated;

create trigger case_drafts_preparo after update of filed_at on public.case_drafts
  for each row
  when (old.filed_at is null and new.filed_at is not null and new.piece_kind = 'recurso')
  execute function public.case_drafts_preparo();

-- ---------- A judgment given at the hearing (0187, redefined) ----------

/**
 * What came of a hearing, as ONE read it from who went (0187). Now (0213) a judgment given there proposes its terms
 * from the hearing's day, where the parties were intimated (Lei 9.099/1995, art. 19, § 1º; CPC, art. 1.003, § 1º):
 * the embargos de declaração and the appeal of the lawsuit's kind, as ONE's, in a firm that lets ONE propose the
 * deadlines of its publications. The rest as before: the settlement a fact of the lawsuit and its payment a deadline
 * to follow; a hearing that did not take place, or a message that says nothing of it, changes nothing.
 */
create or replace function public.record_hearing_report(target_conversation uuid, target_claim integer, target_hearing uuid, target_run uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  hearing public.hearings%rowtype;
  lawsuit public.proceedings%rowtype;
  answer jsonb;
  result text;
  cents bigint;
  days integer;
  report uuid;
  reporter uuid;
  status_answer jsonb;
  deadline_answer jsonb;
  heard_on date;
  terms integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select * into hearing from public.hearings where id = target_hearing and org_id = conversation.org_id for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select m.user_id into reporter from public.memberships m join public.profiles p on p.id = m.user_id
  where m.org_id = conversation.org_id and p.whatsapp = any (public.wa_phone_variants(conversation.contact_wa_id)) limit 1;
  if not ((reporter is not null and hearing.attendee_user_id = reporter)
          or (hearing.attendee_phone is not null and hearing.attendee_phone = any (public.wa_phone_variants(conversation.contact_wa_id)))) then
    return jsonb_build_object('ok', false, 'code', 'not_attendee');
  end if;
  select r.output into answer from public.ai_runs r
  where r.id = target_run and r.org_id = conversation.org_id and r.task = 'audiencia.resultado' and r.status = 'succeeded';
  result := answer ->> 'resultado';
  if result is null or result not in ('acordo', 'sem_acordo', 'instrucao', 'sentenca', 'nao_realizada', 'nao_sei') then
    return jsonb_build_object('ok', false, 'code', 'unread');
  end if;
  begin
    cents := case when result = 'acordo' and (answer ->> 'valor_reais') ~ '^[0-9]{1,9}([.,][0-9]{1,2})?$'
                  then round(replace(answer ->> 'valor_reais', ',', '.')::numeric * 100)::bigint end;
    days := case when result = 'acordo' and (answer ->> 'pagamento_dias') ~ '^[0-9]{1,3}$'
                 then nullif((answer ->> 'pagamento_dias')::integer, 0) end;
  exception when others then
    cents := null;
    days := null;
  end;
  insert into public.hearing_reports (org_id, case_id, hearing_id, conversation_id, reporter_user_id, run_id, result, cents,
                                      pay_days, summary)
  values (hearing.org_id, hearing.case_id, hearing.id, conversation.id, reporter, target_run, result, cents,
          case when days between 1 and 365 then days end, nullif(left(btrim(answer ->> 'resumo'), 400), ''))
  returning id into report;
  if result in ('nao_realizada', 'nao_sei') or hearing.starts_at > now() + interval '1 hour' then
    perform public.record_case_event(hearing.org_id, hearing.case_id, 'hearing_reported', 'ai',
      jsonb_build_object('hearing', hearing.id, 'result', result));
    return jsonb_build_object('ok', true, 'code', 'kept', 'result', result);
  end if;
  select * into lawsuit from public.proceedings where id = hearing.proceeding_id;
  heard_on := (hearing.starts_at at time zone hearing.time_zone)::date;
  -- The hearing held with what came of it, as setting its status writes it, by ONE.
  update public.hearings set
    status = 'held',
    outcome = case result when 'acordo' then 'acordo' when 'sem_acordo' then 'sem_acordo' else 'outro' end,
    outcome_note = public.hearing_text(answer ->> 'resumo', 1000),
    revision = revision + 1, sync_attempts = 0, sync_error = null, sync_retry_after = null
  where id = hearing.id;
  insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (hearing.org_id, null, 'system', 'hearing.held', 'hearing', hearing.id::text,
    jsonb_build_object('was', hearing.status, 'outcome', result, 'auto', true));
  perform public.record_case_event(hearing.org_id, hearing.case_id, 'hearing_held', 'system',
    jsonb_build_object('hearing', hearing.id, 'outcome', result));
  status_answer := jsonb_build_object('code', 'held');
  perform set_config('one.system_case', hearing.case_id::text, true);
  if result = 'acordo' and cents is not null then
    insert into public.lawsuit_facts (org_id, case_id, proceeding_id, kind, cents, happened_on, source, by_one, confirmed, words)
    values (hearing.org_id, hearing.case_id, hearing.proceeding_id, 'acordo', cents,
            heard_on, 'rule', true,
            public.firm_autonomy_mode(hearing.org_id, 'record_outcome') = 'auto',
            left(nullif(btrim(answer ->> 'resumo'), ''), 600));
  end if;
  if result = 'acordo' and days is not null and lawsuit.cnj is not null then
    deadline_answer := public.propose_deadline(null, hearing.proceeding_id, 'Pagamento do acordo pela companhia',
      'pagamento_acordo', 'day', heard_on, days, 'calendar');
  end if;
  -- A judgment given at the hearing: the parties were intimated there, and its terms run from that day.
  if result = 'sentenca' and lawsuit.kind in ('juizado', 'comum')
     and public.firm_autonomy_mode(hearing.org_id, 'publication_deadline') = 'auto' then
    if public.one_propose_term(lawsuit.id, null, 'embargos_declaracao', heard_on, 'hearing') is not null then
      terms := terms + 1;
    end if;
    if public.one_propose_term(lawsuit.id, null,
         case lawsuit.kind when 'juizado' then 'recurso_inominado' else 'apelacao' end, heard_on, 'hearing') is not null then
      terms := terms + 1;
    end if;
  end if;
  perform set_config('one.system_case', '', true);
  perform public.record_case_event(hearing.org_id, hearing.case_id, 'hearing_reported', 'ai',
    jsonb_build_object('hearing', hearing.id, 'result', result));
  return jsonb_build_object('ok', true, 'code', 'recorded', 'result', result, 'cents', cents, 'pay_days', days,
    'deadline_id', deadline_answer ->> 'deadline_id', 'terms', terms, 'status', status_answer ->> 'code');
end;
$$;

revoke all on function public.record_hearing_report(uuid, integer, uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_hearing_report(uuid, integer, uuid, uuid) to service_role;
