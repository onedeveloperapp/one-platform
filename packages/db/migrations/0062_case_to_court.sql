-- 0062_case_to_court.sql
-- ============================================================
-- A case goes to court with its lawsuits, and the test court holds a hearing at its time.
--
-- A case follows its lawsuits: once a planned lawsuit leaves the plan (a receipt attached, or a person saying
-- it was filed) and none of the case's lawsuits is still planned while one of them was filed, a case still
-- being prepared (from `intake` to `ready`) is at the stage `filed`, told in its timeline as ONE's step, as ONE
-- already moves a case to `drafting` when it creates its lawsuits (0039). The rehearsal of 2026-10-27 found a
-- case whose receipt was attached, its lawsuit in court, still "Em preparo". A case written whole in one
-- transaction (an import: the case, its lawsuit as the court has it, and the stage, 0032) sets its stage
-- itself and is left to it. The cases already in court at a stage of their preparation go there now.
--
-- The test court (0061) sets a hearing about ten minutes ahead (the next five minutes at least ten minutes
-- away, in the hours a hearing is held at), so whoever presents ONE reaches it in a few minutes, and holds it
-- only from its moment, as the firm says what came of a hearing only from then (0037): before it, the court
-- answers `hearing_later` with the moment, and its page reads the moment (`hearing_at`) to open that step at
-- its time. A hearing minutes away has no reminder (the reminder of the day goes up to an hour before a
-- hearing, 0038): the client reads it on their link.
-- ============================================================

-- ---------- A case follows its lawsuits into court ----------

/**
 * A planned lawsuit that left the plan takes its case to court, when none of the case's lawsuits is still
 * planned and one of them was filed, from a stage of its preparation: the stage ONE writes, in the timeline.
 * A case written in the same transaction as its lawsuits (an import) is left to what wrote it. A new lawsuit
 * is written planned and then saved as what it is (0022), so one saved filed at once counts as one filed.
 */
create or replace function public.proceedings_case_to_court()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  if old.status <> 'planned' or new.status = 'planned' then
    return new;
  end if;
  select * into current_case from public.cases where id = new.case_id;
  if not found or current_case.created_at >= now()
     or current_case.status not in ('intake', 'documents', 'signature', 'drafting', 'ready')
     or exists (select 1 from public.proceedings p where p.case_id = new.case_id and p.status = 'planned')
     or not exists (select 1 from public.proceedings p where p.case_id = new.case_id and p.status = 'filed') then
    return new;
  end if;
  update public.cases set status = 'filed', status_changed_at = now() where id = current_case.id;
  perform public.record_case_event(current_case.org_id, current_case.id, 'status_changed', 'system',
    jsonb_build_object('from', current_case.status, 'to', 'filed'));
  return new;
end;
$$;

revoke all on function public.proceedings_case_to_court() from public, anon, authenticated;

create trigger proceedings_case_to_court after update of status on public.proceedings
  for each row execute function public.proceedings_case_to_court();

-- The cases already in court, at a stage of their preparation.
do $$
declare
  moved record;
begin
  for moved in
    select c.id, c.org_id, c.status from public.cases c
    where c.status in ('intake', 'documents', 'signature', 'drafting', 'ready')
      and exists (select 1 from public.proceedings p where p.case_id = c.id and p.status = 'filed')
      and not exists (select 1 from public.proceedings p where p.case_id = c.id and p.status = 'planned')
    for update
  loop
    update public.cases set status = 'filed', status_changed_at = now() where id = moved.id;
    perform public.record_case_event(moved.org_id, moved.id, 'status_changed', 'system',
      jsonb_build_object('from', moved.status, 'to', 'filed'));
  end loop;
end;
$$;

-- ---------- The test court holds a hearing at its time ----------

/** The moment of the hearing the test court set for a lawsuit, as its movement says it in the court's zone. */
create or replace function public.test_court_hearing_at(target_proceeding uuid)
returns timestamptz
language sql
stable
security definer
set search_path = public
as $$
  select (to_date(substring(m.detail from '^(\d{2}/\d{2}/\d{4}) às \d{2}:\d{2}'), 'DD/MM/YYYY')
          + substring(m.detail from '^\d{2}/\d{2}/\d{4} às (\d{2}:\d{2})')::time)
         at time zone coalesce(court.time_zone, 'America/Sao_Paulo')
  from public.movements m
  join public.proceedings pr on pr.id = m.proceeding_id
  left join public.courts court on court.acronym = pr.court
  where m.proceeding_id = target_proceeding and m.source = 'teste' and m.source_id = 'teste:audiencia:1';
$$;

revoke all on function public.test_court_hearing_at(uuid) from public, anon, authenticated;

/**
 * What the test court's page shows, by the firm's test chat link: the firm, the filing packages of its test
 * cases ready to file (each with the number the test court gives its lawsuit, and how many files it has),
 * and the lawsuits of its test cases with a number, each with the court's steps done so far (`done`, the
 * names `test_court_act` takes), the hearing it set and its moment (`hearing_at`, an instant in UTC).
 * Service role only.
 */
create or replace function public.test_court_view(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  org uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  org := public.test_court_org(target_token);
  if org is null then
    return jsonb_build_object('found', false);
  end if;
  return jsonb_build_object(
    'found', true,
    'firm', (select o.name from public.organizations o where o.id = org),
    'packages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', fp.id,
        'proceeding_id', pr.id,
        'case_seq', c.seq,
        'client', public.test_court_client(pr.id),
        'court', pr.court,
        'kind', pr.kind,
        'comarca', pr.comarca,
        'system', pr.system,
        'files', (select count(*) from public.filing_package_items i where i.package_id = fp.id),
        'number', public.test_court_number(pr.id)
      ) order by fp.requested_at, fp.id)
      from public.filing_packages fp
      join public.proceedings pr on pr.id = fp.proceeding_id
      join public.cases c on c.id = pr.case_id
      where fp.org_id = org and fp.status = 'ready' and pr.status = 'planned' and c.is_test
    ), '[]'::jsonb),
    'lawsuits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pr.id,
        'case_seq', c.seq,
        'client', public.test_court_client(pr.id),
        'cnj', pr.cnj,
        'court', pr.court,
        'kind', pr.kind,
        'comarca', pr.comarca,
        'status', pr.status,
        'case_status', c.status,
        'done', coalesce((
          select jsonb_agg(distinct split_part(m.source_id, ':', 2))
          from public.movements m where m.proceeding_id = pr.id and m.source = 'teste'
        ), '[]'::jsonb),
        'hearing', (
          select m.detail from public.movements m
          where m.proceeding_id = pr.id and m.source = 'teste' and m.source_id = 'teste:audiencia:1'
        ),
        'hearing_at', to_char(public.test_court_hearing_at(pr.id) at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ) order by c.seq, pr.created_at, pr.id)
      from public.proceedings pr
      join public.cases c on c.id = pr.case_id
      where pr.org_id = org and c.is_test and pr.cnj is not null and pr.status in ('filed', 'closed')
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.test_court_view(text) from public, anon, authenticated;

/**
 * The test court acts on a lawsuit of a test case of the firm the link opens, filed with a number, in the
 * order a lawsuit of the small-claims court goes, each step once:
 *
 *   distribuicao         distributed to its unit and the summons of the airline sent;
 *   audiencia            a conciliation hearing set, in person at the unit, at the next five minutes at least
 *                        ten minutes ahead, in the hours a hearing is held at (from 7 to 19; later, nine in
 *                        the morning of the next weekday), and published to the firm's lawyers;
 *   audiencia_realizada  the hearing held, with no settlement (once it was set, from its moment);
 *   manifestacao         the airline's defence joined, and the client told, through the lawyers, to answer it
 *                        and its documents within 15 days;
 *   sentenca             the claim upheld, the judgment published;
 *   transito             the judgment final (once it was given);
 *   alvara               the airline's deposit joined, and the order to release it to the client published
 *                        (once the judgment is final);
 *   arquivamento         the lawsuit archived, and its archiving published (once a judgment was given).
 *
 * Each movement is kept as a reading of the court keeps it (`source` `teste`), and is news to the firm, the
 * first included: the test court has no history before it. What is published is kept as a capture of the
 * DJEN keeps it, of the day of the court, addressed to the lawyers of the lawsuit and linked to it. Both are
 * told in the case's timeline. Answers what was done, and the moment of a hearing set (also of one not yet
 * come, `hearing_later`). Service role only.
 */
create or replace function public.test_court_act(target_token text, target_proceeding uuid, target_event text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org uuid;
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  held public.proceeding_tracking%rowtype;
  court_row public.courts%rowtype;
  zone text;
  local_now timestamp;
  ahead timestamp;
  court_day date;
  unit_name text;
  done text[];
  moves jsonb := '[]'::jsonb;
  move jsonb;
  ordinal integer := 0;
  body text;
  document_type_value text;
  hearing_local timestamp;
  hearing_moment timestamptz;
  claimed bigint;
  amount text;
  added integer := 0;
  published uuid;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  org := public.test_court_org(target_token);
  if org is null then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  if target_event is null or target_event not in (
    'distribuicao', 'audiencia', 'audiencia_realizada', 'manifestacao', 'sentenca', 'transito', 'alvara', 'arquivamento'
  ) then
    return jsonb_build_object('ok', false, 'code', 'invalid_event');
  end if;
  select * into lawsuit from public.proceedings where id = target_proceeding and org_id = org for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  select * into current_case from public.cases where id = lawsuit.case_id;
  if not current_case.is_test then
    return jsonb_build_object('ok', false, 'code', 'not_a_test_case');
  end if;
  if lawsuit.status <> 'filed' or lawsuit.cnj is null then
    return jsonb_build_object('ok', false, 'code', 'not_filed');
  end if;
  select * into held from public.proceeding_tracking where proceeding_id = lawsuit.id for update;
  if not found or held.source <> 'teste' then
    return jsonb_build_object('ok', false, 'code', 'not_a_test_case');
  end if;

  select coalesce(array_agg(distinct split_part(m.source_id, ':', 2)), '{}'::text[]) into done
  from public.movements m where m.proceeding_id = lawsuit.id and m.source = 'teste';
  if target_event = any (done) then
    return jsonb_build_object('ok', false, 'code', 'already');
  end if;
  if 'arquivamento' = any (done) then
    return jsonb_build_object('ok', false, 'code', 'archived');
  end if;
  if target_event <> 'distribuicao' and not ('distribuicao' = any (done)) then
    return jsonb_build_object('ok', false, 'code', 'not_distributed');
  end if;
  if target_event = 'audiencia_realizada' and not ('audiencia' = any (done)) then
    return jsonb_build_object('ok', false, 'code', 'no_hearing');
  end if;
  if target_event in ('transito', 'arquivamento') and not ('sentenca' = any (done)) then
    return jsonb_build_object('ok', false, 'code', 'no_judgment');
  end if;
  if target_event = 'alvara' and not ('transito' = any (done)) then
    return jsonb_build_object('ok', false, 'code', 'not_final');
  end if;

  select * into court_row from public.courts where acronym = lawsuit.court;
  zone := coalesce(court_row.time_zone, 'America/Sao_Paulo');
  local_now := now() at time zone zone;
  court_day := local_now::date;

  -- A hearing is held at its moment, never before it.
  if target_event = 'audiencia_realizada' then
    hearing_moment := public.test_court_hearing_at(lawsuit.id);
    if hearing_moment is not null and now() < hearing_moment then
      return jsonb_build_object('ok', false, 'code', 'hearing_later',
        'hearing_at', to_char(hearing_moment at time zone zone, 'YYYY-MM-DD"T"HH24:MI'));
    end if;
  end if;

  unit_name := coalesce(
    nullif(btrim(lawsuit.unit), ''),
    case when lawsuit.kind = 'juizado' then '1º Juizado Especial Cível' else '1ª Vara Cível' end
      || coalesce(' da Comarca de ' || nullif(btrim(lawsuit.comarca), ''), '')
  );

  if target_event = 'distribuicao' then
    moves := jsonb_build_array(
      jsonb_build_object('title', 'Processo distribuído por sorteio', 'detail', unit_name),
      jsonb_build_object('title', 'Expedida a carta de citação da ré'));
  elsif target_event = 'audiencia' then
    -- The next five minutes at least ten minutes away.
    ahead := local_now + interval '10 minutes';
    hearing_local := date_trunc('hour', ahead)
      + make_interval(mins => (ceil(extract(epoch from ahead - date_trunc('hour', ahead)) / 300) * 5)::integer);
    if extract(hour from hearing_local) < 7 or extract(hour from hearing_local) >= 20 then
      hearing_local := (local_now::date + 1) + time '09:00';
      while extract(isodow from hearing_local) > 5 loop
        hearing_local := hearing_local + interval '1 day';
      end loop;
    end if;
    body := 'Designo audiência de conciliação para o dia ' || to_char(hearing_local, 'DD/MM/YYYY') || ', às '
      || to_char(hearing_local, 'HH24:MI') || ', a ser realizada presencialmente na sala de audiências do '
      || unit_name || '. Intimem-se as partes.';
    document_type_value := 'Despacho';
    moves := jsonb_build_array(jsonb_build_object(
      'title', 'Audiência de conciliação designada',
      'detail', to_char(hearing_local, 'DD/MM/YYYY') || ' às ' || to_char(hearing_local, 'HH24:MI') || ', presencial'));
  elsif target_event = 'audiencia_realizada' then
    moves := jsonb_build_array(jsonb_build_object(
      'title', 'Audiência de conciliação realizada', 'detail', 'As partes não chegaram a um acordo.'));
  elsif target_event = 'manifestacao' then
    body := 'Intime-se a parte autora para, no prazo de 15 (quinze) dias, manifestar-se sobre a contestação '
      || 'e os documentos juntados pela ré.';
    document_type_value := 'Despacho';
    moves := jsonb_build_array(
      jsonb_build_object('title', 'Juntada a contestação da ré'),
      jsonb_build_object('title', 'Expedida a intimação da parte autora'));
  elsif target_event = 'sentenca' then
    select sum(cp.claim_cents) into claimed
    from public.proceeding_parties pp
    join public.case_parties cp on cp.id = pp.party_id
    where pp.proceeding_id = lawsuit.id;
    amount := case when claimed is null then 'no valor pedido na petição inicial'
      else 'de R$ ' || translate(to_char(claimed / 100.0, 'FM999,999,999,990.00'), ',.', '.,') end;
    body := 'SENTENÇA. Dispensado o relatório, nos termos do art. 38 da Lei 9.099/1995. A ré não demonstrou causa '
      || 'que afastasse a sua responsabilidade pelo ocorrido com o voo da parte autora. Ante o exposto, JULGO '
      || 'PROCEDENTE o pedido para condenar a ré a pagar à parte autora indenização por danos morais ' || amount
      || ', com correção monetária e juros de mora na forma da lei. Sem custas e honorários nesta fase, nos termos '
      || 'do art. 55 da Lei 9.099/1995. Publique-se. Registre-se. Intimem-se.';
    document_type_value := 'Sentença';
    moves := jsonb_build_array(jsonb_build_object('title', 'Julgado procedente o pedido', 'detail', 'Sentença registrada.'));
  elsif target_event = 'transito' then
    moves := jsonb_build_array(jsonb_build_object('title', 'Certificado o trânsito em julgado da sentença'));
  elsif target_event = 'alvara' then
    body := 'Expeça-se alvará eletrônico em favor da parte autora para levantamento do valor depositado pela ré, '
      || 'com os acréscimos legais. Intime-se.';
    document_type_value := 'Despacho';
    moves := jsonb_build_array(
      jsonb_build_object('title', 'Juntado o comprovante do depósito judicial feito pela ré'),
      jsonb_build_object('title', 'Expedido alvará eletrônico em favor da parte autora'));
  else
    body := 'Cumprida a obrigação e levantado o valor depositado, arquivem-se os autos com as baixas necessárias. '
      || 'Intimem-se.';
    document_type_value := 'Despacho';
    moves := jsonb_build_array(jsonb_build_object('title', 'Arquivado definitivamente', 'detail', 'Baixa do processo.'));
  end if;

  for move in select value from jsonb_array_elements(moves) loop
    ordinal := ordinal + 1;
    insert into public.movements (org_id, case_id, proceeding_id, source, source_id, occurred_at, title, detail, by_name)
    values (org, lawsuit.case_id, lawsuit.id, 'teste', 'teste:' || target_event || ':' || ordinal,
            now() + make_interval(secs => ordinal), move ->> 'title', nullif(move ->> 'detail', ''), 'Tribunal de teste')
    on conflict (proceeding_id, source, source_id) do nothing;
    if found then
      added := added + 1;
    end if;
  end loop;

  update public.proceeding_tracking t
  set status = 'tracked',
      snapshot = jsonb_build_object(
        'number', public.cnj_formatted(lawsuit.cnj), 'unit', unit_name,
        'status', case when target_event = 'arquivamento' then 'Arquivado' else 'Em andamento' end,
        'subjects', '[]'::jsonb, 'lawyers', '[]'::jsonb, 'responsibles', '[]'::jsonb, 'pending', '[]'::jsonb,
        'vendor', 'tribunal-teste'),
      vendor = 'tribunal-teste',
      movements_count = (select count(*) from public.movements m where m.proceeding_id = lawsuit.id),
      last_movement_at = (select max(m.occurred_at) from public.movements m where m.proceeding_id = lawsuit.id),
      read_at = now(), checked_at = now(), next_read_at = null,
      -- What the test court does is news to the firm, its first step included.
      seen_until = coalesce(t.seen_until, now() - interval '1 second'),
      unseen_count = t.unseen_count + added,
      requested_at = null, work_claimed_at = null, work_attempts = 0, work_error = null
  where t.id = held.id;
  if added > 0 then
    perform public.record_case_event(org, lawsuit.case_id, 'court_moved', 'system',
      jsonb_build_object('proceeding', lawsuit.id, 'source', 'teste', 'count', added));
  end if;

  if body is not null then
    insert into public.publications (
      org_id, hash, court, cnj, available_on, kind, document_type, body, truncated, head, tail, unit, class_name,
      active, lawyer_ids, proceeding_id, case_id
    ) values (
      org, 'teste-' || target_event || '-' || substr(md5(lawsuit.id::text), 1, 16), lawsuit.court, lawsuit.cnj, court_day,
      'Intimação', document_type_value, body, false, left(body, 1200), null, unit_name,
      case when lawsuit.kind = 'juizado' then 'Procedimento do Juizado Especial Cível' else 'Procedimento Comum Cível' end,
      true,
      coalesce((select array_agg(pl.user_id order by pl.user_id) from public.proceeding_lawyers pl where pl.proceeding_id = lawsuit.id),
               '{}'::uuid[]),
      lawsuit.id, lawsuit.case_id
    )
    on conflict (org_id, hash) do nothing
    returning id into published;
    if published is not null then
      perform public.record_case_event(org, lawsuit.case_id, 'publication_captured', 'system',
        jsonb_build_object('publication', published, 'proceeding', lawsuit.id));
    end if;
  end if;

  return jsonb_strip_nulls(jsonb_build_object(
    'ok', true, 'code', 'done', 'event', target_event, 'moved', added, 'published', published,
    'hearing_at', case when hearing_local is not null then to_char(hearing_local, 'YYYY-MM-DD"T"HH24:MI') end));
end;
$$;

revoke all on function public.test_court_act(text, uuid, text) from public, anon, authenticated;
