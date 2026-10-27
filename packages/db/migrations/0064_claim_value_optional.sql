-- ============================================================
-- 0064_claim_value_optional: the Valor da Causa Pedido is the firm's to give or not.
--
-- What each claimant asks (`case_parties.claim_cents`, 0025) was something a case could not do without: ONE
-- wrote the firm's value for the case's kind of problem for a claimant with none (0052), and where the firm had
-- none the case waited for a person (`claims_missing`); a piece with a claimant with no value could not be
-- approved (`[COMPLETAR: valor da causa]`). The owner decided on 2026-10-27 that the firm chooses whether to
-- give the value at all, named on every screen as the "Valor da Causa Pedido": where it gives none, the lawsuit
-- goes with no value defined and the judge defines it. So:
--
--   - a claimant with no value asks what the court arbitrates, which the piece says beside their name, and a
--     lawsuit none of whose claimants asks a value gives the cause the value the court arbitrates
--     ("Dá-se à causa o valor que este Juízo arbitrar"); a lawsuit with no claimant is still incomplete;
--   - ONE no longer waits for a value (the app stops answering `claims_missing`), and the cases it set aside
--     waiting for one are looked at again now;
--   - the test court arbitrates the indemnity of a petition that asked no value.
--
-- The firm's value for a kind of problem (0052) is unchanged: written for a claimant with none when the lawsuits
-- are created, by ONE or by a person, and never over a value somebody wrote.
-- ============================================================

-- ---------- The piece ----------

/**
 * The text of a draft with the facts of its lawsuit written in (0029), with
 * the Valor da Causa Pedido the firm's to give or not:
 *
 *   [[VALOR_DA_CAUSA]]    the sum of the values the claimants of the lawsuit ask; when none of them asks one,
 *                         the value the court arbitrates ("o valor que este Juízo arbitrar" where the text says
 *                         "valor de [[VALOR_DA_CAUSA]]", "a ser arbitrado por este Juízo" anywhere else);
 *   [[PEDIDO_POR_PARTE]]  what each one asks: their value, or "o valor que este Juízo arbitrar".
 *
 * The other marks are filled as before. A fact that is not on record is
 * written as "[COMPLETAR: ...]", which keeps the piece from being approved;
 * a claimant with no value is no such fact.
 */
create or replace function public.case_draft_filled(target_draft uuid, target_body text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  airline public.airlines%rowtype;
  today date := (now() at time zone 'America/Sao_Paulo')::date;
  court_uf text;
  parties text;
  names text;
  per_party text;
  total bigint;
  claimants integer;
  lawyers text;
  addressed text;
  defendant text;
  filled text := coalesce(target_body, '');
begin
  select * into draft from public.case_drafts where id = target_draft;
  if not found then
    return filled;
  end if;
  select * into lawsuit from public.proceedings where id = draft.proceeding_id;
  select * into current_case from public.cases where id = draft.case_id;
  select * into airline from public.airlines a where a.iata = current_case.airline_iata;
  select c.uf into court_uf from public.courts c where c.acronym = lawsuit.court;

  select
    string_agg(
      public.person_qualification(cp.person_id, own.minor)
        || case when own.minor then
             -- Under sixteen somebody stands in for the person; from sixteen on, beside them.
             case when pe.birth_date is not null and pe.birth_date <= today - interval '16 years'
               then ', neste ato com a assistência de ' else ', neste ato com a representação de ' end
             || case when g.person_id is null then '[COMPLETAR: quem responde por ' || pe.full_name || ']'
                  else public.person_qualification(g.person_id, false) end
           else '' end,
      E';\n' order by cp.created_at, cp.id),
    string_agg(upper(pe.full_name), ', ' order by cp.created_at, cp.id),
    -- A claimant with no Valor da Causa Pedido asks what the court arbitrates.
    string_agg(pe.full_name || ': ' || coalesce(public.brl_from_cents(cp.claim_cents), 'o valor que este Juízo arbitrar'),
      '; ' order by cp.created_at, cp.id),
    sum(cp.claim_cents),
    count(*)
  into parties, names, per_party, total, claimants
  from public.proceeding_parties pp
  join public.case_parties cp on cp.id = pp.party_id
  join public.people pe on pe.id = cp.person_id
  left join public.case_parties g on g.id = cp.guardian_id
  cross join lateral (
    -- A minor: not eighteen yet on this day; with no day of birth on record, one somebody answers for.
    select case when pe.birth_date is null then cp.guardian_id is not null
                else pe.birth_date > today - interval '18 years' end as minor
  ) own
  where pp.proceeding_id = lawsuit.id;

  select string_agg(
    coalesce(nullif(btrim(pr.display_name), ''), '[COMPLETAR: nome de quem assina]')
      || coalesce(', OAB/' || r.uf || ' ' || r.number, ', [COMPLETAR: inscrição na OAB]'),
    E'\n' order by pr.display_name, pr.id)
  into lawyers
  from public.proceeding_lawyers pl
  join public.profiles pr on pr.id = pl.user_id
  -- Who is on record in the lawsuit and still of the firm: nobody who left signs a new piece.
  join public.memberships mb on mb.user_id = pl.user_id and mb.org_id = draft.org_id
  left join lateral (
    -- The registration in the state of the court when there is one, else the main one.
    select o.uf, o.number from public.oab_registrations o
    where o.user_id = pl.user_id
    order by (o.uf = court_uf) desc, (o.kind = 'principal') desc, o.uf
    limit 1
  ) r on true
  where pl.proceeding_id = lawsuit.id;

  addressed := case
    when nullif(btrim(lawsuit.unit), '') is null then
      case lawsuit.kind when 'juizado' then 'Juizado Especial Cível' else 'Vara Cível' end
        || ' da Comarca de ' || coalesce(nullif(btrim(lawsuit.comarca), ''), '[COMPLETAR: comarca]')
    -- The unit as the firm wrote it, with its comarca when the unit does not name it already.
    when nullif(btrim(lawsuit.comarca), '') is null
      or position(lower(btrim(lawsuit.comarca)) in lower(lawsuit.unit)) > 0 then btrim(lawsuit.unit)
    else btrim(lawsuit.unit) || ' da Comarca de ' || btrim(lawsuit.comarca)
  end;

  -- The company that answers in court is what the operator recorded of the airline: never guessed.
  defendant := coalesce(nullif(btrim(airline.legal_name), ''), '[COMPLETAR: razão social da companhia]')
    || ', CNPJ nº ' || coalesce(
      regexp_replace(airline.cnpj, '^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$', '\1.\2.\3/\4-\5'),
      '[COMPLETAR: CNPJ da companhia]');

  filled := replace(filled, '[[PARTES]]', coalesce(parties, '[COMPLETAR: quem pede neste processo]'));
  filled := replace(filled, '[[NOMES_DAS_PARTES]]', coalesce(names, '[COMPLETAR: quem pede neste processo]'));
  filled := replace(filled, '[[RE]]', defendant);
  filled := replace(filled, '[[JUIZO]]', addressed);
  if claimants = 0 then
    filled := replace(filled, '[[VALOR_DA_CAUSA]]', '[COMPLETAR: valor da causa]');
  elsif total is null then
    -- Nobody of the lawsuit asks a value: the cause has the value the court arbitrates (CPC, art. 292, § 3º),
    -- said so where the text gives the cause "o valor de" it, and as what the court arbitrates elsewhere.
    filled := regexp_replace(filled, '(valor)\s+de\s+\[\[VALOR_DA_CAUSA\]\]', '\1 que este Juízo arbitrar', 'gi');
    filled := replace(filled, '[[VALOR_DA_CAUSA]]', 'a ser arbitrado por este Juízo');
  else
    -- The values the claimants ask; one with none asks what the court arbitrates, said beside their name.
    filled := replace(filled, '[[VALOR_DA_CAUSA]]', public.brl_from_cents(total));
  end if;
  filled := replace(filled, '[[PEDIDO_POR_PARTE]]', coalesce(per_party, '[COMPLETAR: pedido de cada parte]'));
  filled := replace(filled, '[[ADVOGADOS]]', coalesce(lawyers, '[COMPLETAR: quem assina]'));
  return filled;
end;
$$;

revoke all on function public.case_draft_filled(uuid, text) from public, anon, authenticated;

-- ---------- The test court ----------

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
 *   sentenca             the claim upheld, the judgment published: the value each claimant asked, or, where
 *                        the petition asked none, the indemnity the court arbitrates;
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
    -- A petition that asked no value leaves the indemnity to the court, which arbitrates it.
    amount := case when claimed is null then 'que arbitro em R$ 5.000,00 (cinco mil reais) por autor'
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

-- ---------- What ONE waited for ----------

-- A case ONE set aside waiting for a value goes on now, its lawsuits created with the values the firm gives.
update public.case_advances a
set after = null, woken_at = clock_timestamp()
where a.waiting = 'claims_missing' and a.after is distinct from 'infinity'::timestamptz;
