-- ============================================================
-- 0061_test_court: the test court, where a test case goes on after its filing.
--
-- The end-to-end test stopped at the filing: what follows comes from the court (the number a lawsuit gets,
-- its course) and from the DJEN (what the court publishes to the firm's lawyers), and no court has a case
-- the test chat opened. The test court stands where they stand, for a firm's test cases only, as the test
-- chat (0047) stands where the passenger's phone and the airline stand:
--
--   cases.is_test        a case a trip of the test chat opened (0048): marked when it opens, and kept
--                        whatever the trip does afterwards (a trip started over lets go of its case);
--   proceeding_tracking  the lawsuits of a test case are the test court's (`source` `teste`): never read
--                        from a real source, whatever number they were given;
--   test_court_view      what the test court's page shows by the firm's test chat link: the packages of test
--                        cases ready to file, each with the number the test court gives its lawsuit, and the
--                        test lawsuits filed, with what the court did in each;
--   test_court_act       the court acting on a test lawsuit, step by step as a lawsuit of the small-claims
--                        court goes: its movements kept as a reading keeps them (0031), and what it publishes
--                        to the firm's lawyers kept as a capture of the DJEN keeps it (0028).
--
-- From there everything is ONE's own: the firm triages what was published, ONE reads the deadline and the
-- hearing (0040), the client is told (0038). Nothing leaves ONE, and the page acts only by the link's secret,
-- on the firm's own test cases.
-- ============================================================

-- ---------- A test case ----------

alter table public.cases add column is_test boolean not null default false;

/**
 * A case a trip of the test chat opened is a test case, for good: a trip started over lets go of its case
 * (0047), and the case stays a test.
 */
create or replace function public.tracked_trips_mark_test_case()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_test and new.case_id is not null then
    update public.cases set is_test = true where id = new.case_id and org_id = new.org_id and not is_test;
  end if;
  return new;
end;
$$;

revoke all on function public.tracked_trips_mark_test_case() from public, anon, authenticated;

create trigger tracked_trips_mark_test_case after insert or update of case_id on public.tracked_trips
  for each row execute function public.tracked_trips_mark_test_case();

-- The test cases opened already: the ones a test trip holds, and the ones a trip started over let go of, told by
-- the case the conversation of a test number says ONE opened (0048).
update public.cases c set is_test = true
where not c.is_test and (
  exists (select 1 from public.tracked_trips t where t.case_id = c.id and t.is_test)
  or exists (
    select 1 from public.wa_conversation_events e
    join public.wa_conversations wc on wc.id = e.conversation_id
    join public.wa_numbers n on n.id = wc.number_id
    where e.org_id = c.org_id and e.kind = 'case_opened' and e.data ->> 'case_id' = c.id::text and n.provider = 'test'
  )
);

-- ---------- Its lawsuits are the test court's ----------

alter table public.proceeding_tracking drop constraint proceeding_tracking_source_check;
alter table public.proceeding_tracking add constraint proceeding_tracking_source_check
  check (source in ('projudi', 'aggregator', 'teste'));
alter table public.movements drop constraint movements_source_check;
alter table public.movements add constraint movements_source_check
  check (source in ('projudi', 'aggregator', 'teste'));

/**
 * 0031's, with the test court: a lawsuit of a test case is the test court's, owed no reading from any source
 * (whatever number it was given, no real court is asked for it); the others are read as before, TJGO's from
 * its Projudi and any other from an aggregator.
 */
create or replace function public.proceedings_tracking()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_value text;
begin
  if tg_op = 'UPDATE' and new.cnj is not distinct from old.cnj and new.status is not distinct from old.status then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.cnj is distinct from new.cnj then
    delete from public.movements where proceeding_id = new.id;
    update public.proceeding_tracking
    set snapshot = null, vendor = null, movements_count = 0, last_movement_at = null, read_at = null, checked_at = null,
        seen_until = null, unseen_count = 0, work_claimed_at = null, work_attempts = 0, work_error = null
    where proceeding_id = new.id;
  end if;
  if new.cnj is not null and new.status = 'filed' then
    source_value := case
      when exists (select 1 from public.cases c where c.id = new.case_id and c.is_test) then 'teste'
      when substr(new.cnj, 14, 3) = '809' then 'projudi'
      else 'aggregator' end;
    insert into public.proceeding_tracking as held (org_id, case_id, proceeding_id, cnj, source, status, next_read_at)
    values (new.org_id, new.case_id, new.id, new.cnj, source_value, 'waiting',
            case when source_value = 'teste' then null else now() end)
    on conflict (proceeding_id) do update set
      cnj = excluded.cnj, source = excluded.source,
      status = case when held.cnj = excluded.cnj and held.status not in ('off', 'failed') then held.status else 'waiting' end,
      next_read_at = case
        when excluded.source = 'teste' then null
        when held.cnj = excluded.cnj and held.status not in ('off', 'failed') then held.next_read_at
        else now() end,
      work_claimed_at = case when held.cnj = excluded.cnj then held.work_claimed_at end,
      work_attempts = case when held.cnj = excluded.cnj and held.status <> 'failed' then held.work_attempts else 0 end;
  else
    -- Not read any more: what it had that nobody saw stops counting as news, since nobody could clear it.
    update public.proceeding_tracking
    set status = 'off', work_claimed_at = null, next_read_at = null, unseen_count = 0,
        seen_until = case when seen_until is null then null else now() end
    where proceeding_id = new.id;
    if new.cnj is null then
      delete from public.proceeding_tracking where proceeding_id = new.id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.proceedings_tracking() from public, anon, authenticated;

-- The lawsuits of test cases filed already are the test court's from now on.
update public.proceeding_tracking t
set source = 'teste', next_read_at = null, work_claimed_at = null, work_attempts = 0, work_error = null
from public.cases c
where c.id = t.case_id and c.is_test and t.source <> 'teste';

-- ---------- The test court ----------

/** The firm a test chat link opens, while the chat and its number are on; null otherwise. Internal. */
create or replace function public.test_court_org(target_token text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.org_id
  from public.test_chats c
  join public.wa_numbers n on n.id = c.number_id and n.status = 'active'
  where coalesce(target_token, '') ~ '^[A-Za-z0-9_-]{32,64}$' and c.token = target_token and c.status = 'active';
$$;

revoke all on function public.test_court_org(text) from public, anon, authenticated;

/**
 * The number the test court gives a lawsuit: of the year 2099, which no court has given (the fixtures of this
 * repository write theirs so), of the lawsuit's own court (the segment and the code `save_proceeding` checks),
 * from the comarca 0001, with its check digits. The same lawsuit always gets the same number; one the firm
 * already has under another lawsuit is passed over. Null for a lawsuit of no court. Internal.
 */
create or replace function public.test_court_number(target_proceeding uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  court_row public.courts%rowtype;
  seed bigint;
  sequence_part text;
  rest text;
  number text;
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found or lawsuit.court is null then
    return null;
  end if;
  select * into court_row from public.courts where acronym = lawsuit.court;
  if not found then
    return null;
  end if;
  seed := hashtext(lawsuit.id::text)::bigint + 2147483648;
  rest := '2099' || court_row.cnj_segment || court_row.cnj_code || '0001';
  for step in 0..20 loop
    sequence_part := lpad(((seed + step) % 9000000 + 1000000)::text, 7, '0');
    number := sequence_part || lpad((98 - ((sequence_part || rest || '00')::numeric % 97))::text, 2, '0') || rest;
    if not exists (
      select 1 from public.proceedings p where p.org_id = lawsuit.org_id and p.cnj = number and p.id <> lawsuit.id
    ) then
      return number;
    end if;
  end loop;
  return null;
end;
$$;

revoke all on function public.test_court_number(uuid) from public, anon, authenticated;

/** Who a lawsuit is of, as the test court's page names it: its first claimant. Internal. */
create or replace function public.test_court_client(target_proceeding uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.full_name
  from public.proceeding_parties pp
  join public.case_parties cp on cp.id = pp.party_id
  join public.people p on p.id = cp.person_id
  where pp.proceeding_id = target_proceeding
  order by cp.created_at, cp.id
  limit 1;
$$;

revoke all on function public.test_court_client(uuid) from public, anon, authenticated;

/**
 * What the test court's page shows, by the firm's test chat link: the firm, the filing packages of its test
 * cases ready to file (each with the number the test court gives its lawsuit, and how many files it has),
 * and the lawsuits of its test cases with a number, each with the court's steps done so far (`done`, the
 * names `test_court_act` takes) and the hearing it set. Service role only.
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
        )
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
 *                        half an hour ahead, in the hours a hearing is held at (from 7 to 19; later, nine in
 *                        the morning of the next weekday), and published to the firm's lawyers;
 *   audiencia_realizada  the hearing held, with no settlement (once it was set);
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
 * told in the case's timeline. Answers what was done, and the moment of a hearing set. Service role only.
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
  court_day date;
  unit_name text;
  done text[];
  moves jsonb := '[]'::jsonb;
  move jsonb;
  ordinal integer := 0;
  body text;
  document_type_value text;
  hearing_local timestamp;
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
    hearing_local := date_trunc('hour', local_now + interval '30 minutes')
      + make_interval(mins => (ceil(extract(minute from local_now + interval '30 minutes') / 5) * 5)::integer);
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
