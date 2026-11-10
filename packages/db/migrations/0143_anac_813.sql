-- ============================================================
-- 0143_anac_813: the platform's library follows Resolução nº 813/2026 of
-- ANAC, which changed Resolução nº 400 (DOU of 25/09/2026, Seção 1, p. 59;
-- its art. 3 in the words of Resolução nº 819/2026, DOU of 26/10/2026).
--
-- Read in the Diário Oficial on 10/11/2026 (ANAC's own page refuses automatic
-- reading): arts. 26 and 27 are in their new words from 26/10/2026, and art.
-- 20 from 25/11/2026; art. 27, I (the means of communication after one hour)
-- is revoked; arts. 25-A, 25-B, 27-A and 27-B are new. What a lawsuit asks is
-- judged by the rule in force when the flight happened, so a source keeps the
-- words it had before (`quote_before`) beside the day its words now in force
-- began (`in_force_from`), and a piece is handed the words in force on the
-- day of its case's flight (`case_draft_to_work`, from 0091), said as such.
--
-- The platform's sources of arts. 20, 26 and 27 take their new words, keeping
-- the ones of 2016 for earlier flights; art. 27-B (the refund of what the
-- passenger spent when the assistance could not be given) joins them. A
-- firm's own source of the same key keeps its words, as the firm's.
-- ============================================================

alter table public.legal_sources add column quote_before text;
alter table public.legal_sources add column in_force_from date;
alter table public.legal_sources add constraint legal_sources_before_check
  check (quote_before is null or in_force_from is not null);

update public.legal_sources
set quote_before = quote, in_force_from = date '2026-11-25',
    quote = $q$Art. 20. O transportador deverá informar ao passageiro, de forma clara, acessível e tão logo tenha conhecimento da ocorrência, inclusive por meio de canais digitais, sobre atraso, cancelamento de voo, interrupção do serviço ou preterição de embarque, mantendo as informações atualizadas enquanto perdurar a ocorrência.
§ 1º As informações de que trata o caput deverão abranger, no mínimo:
I - a situação da ocorrência e a previsão atualizada de partida do voo, quando conhecida;
II - as alternativas disponíveis para reacomodação, bem como, quando cabíveis, as opções de reembolso ou de execução do serviço por outra modalidade de transporte; e
III - os procedimentos para obtenção da assistência material prevista nesta Resolução.
§ 2º A informação sobre o motivo do atraso, do cancelamento, da interrupção do serviço e da preterição deverá ser prestada por escrito pelo transportador, sempre que solicitada pelo passageiro.
§ 3º As informações disponibilizadas por meio de canais digitais deverão indicar a data e o horário da última atualização.$q$,
    source_url = $q$https://www.in.gov.br/web/dou/-/resolucao-n-813-de-23-de-setembro-de-2026-734428445$q$,
    note = $q$Redação da Resolução nº 813/2026 da ANAC (DOU de 25/09/2026), em vigor desde 25/11/2026 pela Resolução nº 819/2026; o § 2º segue o texto de 2016, que a Resolução nº 813 manteve. Conferido no Diário Oficial em 10/11/2026. Para voos anteriores a 25/11/2026, a peça recebe o texto de 2016.$q$,
    verified_at = now()
where org_id is null and key = public.legal_source_key('resolucao', 'ANAC', '400', '20');

update public.legal_sources
set quote_before = quote, in_force_from = date '2026-10-26',
    quote = $q$Art. 26. A assistência material ao passageiro deve ser oferecida nos seguintes casos:
I - atraso do voo;
II - cancelamento do voo;
III - interrupção de serviço; ou
IV - preterição de passageiro.
Parágrafo único. A obrigação prevista neste artigo não se confunde com o dever de reparação civil por eventual dano, e o seu cumprimento não implica reconhecimento de culpa ou responsabilidade pelo atraso ou pela interrupção do voo.$q$,
    title = $q$Resolução nº 400 da ANAC, art. 26: casos de assistência material, que não se confunde com a reparação do dano$q$,
    source_url = $q$https://www.in.gov.br/web/dou/-/resolucao-n-813-de-23-de-setembro-de-2026-734428445$q$,
    note = $q$Redação da Resolução nº 813/2026 da ANAC (DOU de 25/09/2026), em vigor desde 26/10/2026, que acrescentou o parágrafo único; o caput e os incisos seguem o texto de 2016. Conferido no Diário Oficial em 10/11/2026. Para voos anteriores a 26/10/2026, a peça recebe o texto de 2016.$q$,
    verified_at = now()
where org_id is null and key = public.legal_source_key('resolucao', 'ANAC', '400', '26');

update public.legal_sources
set quote_before = quote, in_force_from = date '2026-10-26',
    quote = $q$Art. 27. O transportador deverá assegurar ao passageiro, no território nacional, a prestação das seguintes assistências materiais:
I - (revogado);
II - alimentação adequada, por meio de crédito para alimentação, refeição ou solução equivalente, nos casos de espera superior a 2 (duas) horas; e
III - hospedagem, quando houver necessidade de pernoite, além do transporte de ida e volta entre o aeroporto e o local de hospedagem, nos casos de espera superior a 4 (quatro) horas.
§ 1º O transportador poderá deixar de oferecer hospedagem ao passageiro residente na localidade do aeroporto de origem, devendo assegurar, gratuitamente, o transporte de ida e volta entre o aeroporto e a residência do passageiro.
§ 2º No caso de passageiro com deficiência ou com mobilidade reduzida e de seus acompanhantes, a assistência prevista no inciso III do caput deverá ser fornecida independentemente da exigência de pernoite, salvo quando puder ser substituída por acomodação adequada às suas necessidades e houver concordância expressa do passageiro ou acompanhante.
§ 3º O transportador poderá deixar de oferecer assistência material quando o passageiro optar pela reacomodação em voo próprio do transportador a ser realizado em data e horário de conveniência do passageiro ou pelo reembolso integral da passagem aérea.$q$,
    source_url = $q$https://www.in.gov.br/web/dou/-/resolucao-n-813-de-23-de-setembro-de-2026-734428445$q$,
    note = $q$Redação da Resolução nº 813/2026 da ANAC (DOU de 25/09/2026), em vigor desde 26/10/2026: o inciso I (facilidades de comunicação) foi revogado; o § 3º segue o texto de 2016, que a Resolução nº 813 manteve. Conferido no Diário Oficial em 10/11/2026. Para voos anteriores a 26/10/2026, a peça recebe o texto de 2016.$q$,
    verified_at = now()
where org_id is null and key = public.legal_source_key('resolucao', 'ANAC', '400', '27');

insert into public.legal_sources (org_id, kind, issuer, number, article, title, quote, source_url, note, status, verified_at,
  in_force_from)
values (null, 'resolucao', 'ANAC', '400', '27B',
  $q$Resolução nº 400 da ANAC, art. 27-B: reembolso das despesas quando a assistência material não pôde ser prestada$q$,
  $q$Art. 27-B. Excepcionalmente, quando limitações da infraestrutura aeroportuária, indisponibilidade comprovada de fornecedores locais ou outras situações emergenciais imprevisíveis inviabilizarem o fornecimento da assistência material na forma prevista nesta Resolução, o transportador poderá adotar, como forma alternativa de cumprimento da obrigação, o reembolso das despesas necessárias, razoáveis e comprovadamente realizadas pelo passageiro com alimentação, transporte e hospedagem.
Parágrafo único. O reembolso deverá ser realizado em até 7 (sete) dias, contado da apresentação da comprovação das despesas.$q$,
  $q$https://www.in.gov.br/web/dou/-/resolucao-n-813-de-23-de-setembro-de-2026-734428445$q$,
  $q$Artigo acrescentado pela Resolução nº 813/2026 da ANAC (DOU de 25/09/2026), em vigor desde 26/10/2026. Conferido no Diário Oficial em 10/11/2026. Não vale para voos anteriores.$q$,
  'verified', now(), date '2026-10-26')
on conflict do nothing;

-- ONE's first word on a flight names what the airline owes (`flight-problem-v3` in the app): no means of
-- communication any longer. The example a template is submitted with says the same.
update public.notice_kinds
set examples = array['Mariana', 'Souza Advogados', 'LA 3456 de São Paulo (GRU) para Recife (REC), de 22/10/2099',
  'foi cancelado',
  'oferecer outro voo, o reembolso ou outro meio de transporte, e dar alimentação e, se for preciso passar a noite, hospedagem com o transporte até ela']
where kind = 'flight_problem';

-- ---------- What the piece reads ----------

/**
 * What a worker is handed of a draft it holds the claim of (0029), the
 * library being the firm's and the platform's (0045); the facts carry, for
 * each leg, what ANAC's record says of its flight, and what the documents
 * the firm accepted say of the purchase and of each expense (0091); each
 * source in the words in force on the day of the case's flight (0143).
 */
create or replace function public.case_draft_to_work(target_draft uuid, target_claim integer)
returns table (
  draft_id uuid, org_id uuid, case_id uuid, claim integer, work text, version integer, body text,
  template text, facts jsonb, library jsonb, run_key text, firm text, title text, requested_by uuid, note text,
  same jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  keyed jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into draft from public.case_drafts d
  where d.id = target_draft and d.work is not null and d.work_claimed_at is not null and d.work_claims = target_claim;
  if not found then
    return;
  end if;
  select * into lawsuit from public.proceedings where id = draft.proceeding_id;
  select * into current_case from public.cases where id = draft.case_id;

  draft_id := draft.id;
  org_id := draft.org_id;
  case_id := draft.case_id;
  claim := draft.work_claims;
  work := draft.work;
  version := draft.version;
  -- Who asked (the piece, or its rewriting), while they are still of the firm: a run is asked by a person
  -- of the firm or by nobody.
  requested_by := (
    select m.user_id from public.memberships m
    where m.org_id = draft.org_id
      and m.user_id = case when draft.work = 'revise' then draft.revision_by else draft.requested_by end
  );
  firm := (select o.name from public.organizations o where o.id = draft.org_id);
  title := draft.template_name || ', caso ' || current_case.seq
    || case lawsuit.kind when 'juizado' then ', juizado especial' else ', vara cível' end;
  body := case draft.work
    when 'issue' then draft.approved_body
    when 'check' then (select v.body from public.case_draft_versions v where v.draft_id = draft.id and v.version = draft.version)
  end;
  if draft.work = 'revise' then
    -- The list of the marks is written under the claim, with the draft held: a request given up and asked
    -- again meanwhile is another claim, and never reads under this one's list.
    select * into draft from public.case_drafts d
    where d.id = target_draft and d.work = 'revise' and d.work_claimed_at is not null and d.work_claims = target_claim
    for update;
    if not found then
      return;
    end if;
    -- A second look at the same work (its worker was cut) reads under the marks of the first.
    keyed := public.case_text_keyed(current_case.id,
      (select v.body from public.case_draft_versions v where v.draft_id = draft.id and v.version = draft.version),
      coalesce(draft.revision_keys, '{}'::jsonb));
    body := keyed ->> 'text';
    keyed := public.case_text_keyed(current_case.id, draft.revision_note, keyed -> 'keys');
    note := keyed ->> 'text';
    same := public.case_marks_same_name(current_case.id, keyed -> 'keys');
    update public.case_drafts d set revision_keys = keyed -> 'keys' where d.id = draft.id;
  end if;
  if draft.work in ('generate', 'revise') then
    if draft.work = 'generate' then
      -- The model of the firm goes as an account does: with what identifies a person taken out of it.
      template := public.case_text_for_ai(current_case.id, draft.template_body);
    end if;
    -- The runs that will never be this draft's text: the ones that failed, and the ones whose answer was no
    -- piece. Each rewriting asked for is a work of its own, with runs of its own.
    run_key := 'draft:' || draft.id::text
      || case when draft.work = 'revise' then ':r' || draft.revisions::text else '' end
      || ':' || (draft.unusable_runs + (
      select count(*) from public.ai_runs r
      where r.org_id = draft.org_id and r.task = 'caso.peca.minuta'
        and r.subject_type = 'case_draft' and r.subject_id = draft.id::text and r.status in ('failed', 'blocked')
    ))::text;
    facts := jsonb_build_object(
      'tipo_de_processo', case lawsuit.kind when 'juizado' then 'juizado especial cível' else 'vara cível, procedimento comum' end,
      'ocorrencia', current_case.incident,
      'companhia', (select a.name from public.airlines a where a.iata = current_case.airline_iata),
      'data_do_voo', current_case.flight_date,
      'causa_informada_pela_companhia', current_case.airline_stated_cause,
      'quantas_partes', (select count(*) from public.proceeding_parties pp where pp.proceeding_id = lawsuit.id),
      -- A minor as the piece itself tells one: not eighteen yet today; with no day of birth on record, one
      -- somebody answers for (`case_draft_filled`).
      'ha_menor_entre_as_partes', exists (
        select 1 from public.proceeding_parties pp
        join public.case_parties cp on cp.id = pp.party_id
        join public.people pe on pe.id = cp.person_id
        where pp.proceeding_id = lawsuit.id
          and case when pe.birth_date is null then cp.guardian_id is not null
                   else pe.birth_date > (now() at time zone 'America/Sao_Paulo')::date - interval '18 years' end
      ),
      'foro', jsonb_build_object('comarca', lawsuit.comarca, 'base', lawsuit.forum_basis,
        'motivo', public.case_text_for_ai(current_case.id, lawsuit.forum_reason)),
      'trechos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'voo', s.flight_number, 'origem', s.origin_iata, 'destino', s.destination_iata,
          'partida_prevista', s.scheduled_departure_local, 'chegada_prevista', s.scheduled_arrival_local,
          'partida_real', s.actual_departure_local, 'chegada_real', s.actual_arrival_local,
          'trecho_afetado', s.affected,
          'registro_oficial', (
            select jsonb_strip_nulls(jsonb_build_object(
              'situacao', c.record ->> 'state',
              'partida_real_horario_de_brasilia', c.record ->> 'actualDeparture',
              'chegada_real_horario_de_brasilia', case
                when coalesce(c.record ->> 'arrivalElsewhere', 'false') = 'true' then null
                else c.record ->> 'actualArrival' end,
              'motivo_informado_pela_companhia', nullif(btrim(coalesce(c.record ->> 'justification', '')), '')
            ))
            from public.flight_checks c
            where c.segment_id = s.id and c.source = 'vra' and c.status = 'found'
          )
        ) order by s.position)
        from public.flight_segments s where s.case_id = current_case.id
      ), '[]'::jsonb),
      -- What the client told, in the order of the facts the firm approved, and whether the client confirmed it.
      'relatos', coalesce((
        select jsonb_agg(jsonb_build_object(
          'confirmado_pelo_cliente', st.chronology_status = 'confirmed',
          'cronologia', public.case_text_for_ai(current_case.id, st.chronology)
        ) order by st.created_at)
        from public.case_statements st
        where st.case_id = current_case.id and st.chronology is not null and st.chronology_status in ('approved', 'confirmed')
      ), '[]'::jsonb),
      'reclamacoes_antes_da_acao', coalesce((
        select jsonb_agg(jsonb_build_object(
          'canal', ac.channel, 'protocolo', ac.protocol, 'feita_em', ac.filed_on, 'respondida_em', ac.answered_on,
          'resultado', ac.outcome
        ) order by ac.created_at)
        from public.admin_complaints ac where ac.case_id = current_case.id
      ), '[]'::jsonb),
      -- What the documents the firm accepted say of the purchase and of each expense (0091).
      'compras', coalesce(public.case_document_readings(current_case.id) -> 'compras', '[]'::jsonb),
      'gastos', coalesce(public.case_document_readings(current_case.id) -> 'gastos', '[]'::jsonb)
    );
    -- Every source with its key: the worker puts the ones the model itself cites first and fits the rest
    -- to what one request carries (`draftLibrary`). Only the start of what may be transcribed goes.
    library := coalesce((
      select jsonb_agg(jsonb_build_object(
        'chave', s.key, 'como_citar', s.citation, 'titulo', s.title,
        -- The words in force on the day of the flight (0143): a source whose words changed later hands the earlier ones.
        'trecho', left(case when s.quote_before is not null and current_case.flight_date < s.in_force_from
                            then s.quote_before else s.quote end, 1200),
        'redacao', case
          when s.in_force_from is null then null
          when s.quote_before is not null and current_case.flight_date < s.in_force_from
            then 'redação anterior a ' || to_char(s.in_force_from, 'DD/MM/YYYY') || ', a do dia do voo'
          else 'redação em vigor desde ' || to_char(s.in_force_from, 'DD/MM/YYYY')
        end
      ) order by s.verified_at desc, s.id)
      from (
        -- The firm's sources and the platform's (0045); where both have a key, the firm's.
        select * from (
          select distinct on (ls.key) ls.* from public.legal_sources ls
          where (ls.org_id = draft.org_id or ls.org_id is null) and ls.status = 'verified'
          order by ls.key, (ls.org_id is null), ls.verified_at desc
        ) both_libraries
        order by both_libraries.verified_at desc, both_libraries.id limit 1000
      ) s
    ), '[]'::jsonb);
  end if;
  return next;
end;
$$;

revoke all on function public.case_draft_to_work(uuid, integer) from public, anon, authenticated;
