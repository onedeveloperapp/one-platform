-- ============================================================
-- 0218 · A justiça gratuita no recurso do juizado.
--
-- From the review of 2026-11-11 against the CPC and the Lei 9.099/1995. The
-- small-claims court has no costs in the first instance (Lei 9.099/1995,
-- art. 54), so ONE asked nothing of free justice there (0125). Its recurso
-- inominado has: the preparo is every cost of the lawsuit, those spared in
-- the first instance included, save for who has free justice (art. 54,
-- parágrafo único), and it is due in the 48 hours after the recurso, or the
-- appeal is deserted (art. 42, § 1º). A claimant who cannot pay asks it in
-- the recurso itself, and is spared proving the preparo until the court
-- decides the request (CPC, art. 99, § 7º).
--
-- The claimants of a lawsuit of the small-claims court appeal once the firm
-- decided the recurso inominado on its judgment (0185), or a recurso of
-- theirs is in course (0189), and until it is filed (`lawsuit_appeal_open`).
-- Each says then whether they ask for free justice, as the claimants of the
-- civil court do (`free_justice_needs`, redefined from 0125): on their link,
-- where the question shows whatever the case's stage, or through the firm,
-- saying how. Who asks signs the declaration of economic hardship (the same
-- paper as 0125): a case still before its filing issues it as before, and a
-- case already with the court through its own line (`appeal_papers_due`,
-- `appeal_paper_to_issue`, `record_appeal_paper`, `appeal_papers_owed`), so
-- ONE's carrying on of a case before its filing (0039) is never woken for a
-- case with the court.
--
-- The recurso writes the request where its model puts `[[GRATUIDADE]]` and
-- `[[PEDIDO_GRATUIDADE]]` (`case_draft_filled`, redefined from 0215): who
-- asks, by name, under the art. 54, parágrafo único, and the art. 99, § 7º.
-- The platform's model of the recurso takes the marks, published as a new
-- version of each module that has it (0212): a case opened from now on
-- reads it; a case in course keeps its version, and its recurso, while
-- somebody asks, waits for a lawyer to put the mark (`free_justice_mark_missing`),
-- as an initial without it does. A recurso is not approved while a
-- claimant has not answered (`free_justice_piece_blocker`, redefined). ONE
-- files a piece alone with no attachment (0189), so a recurso that asks free
-- justice is the lawyer's to file in the court's system, with the declaration
-- (`piece_filing_blocker`, redefined: `free_justice_declaration`). The 48
-- hours of the preparo are proposed only when somebody of the lawsuit does
-- not ask (`case_drafts_preparo`, redefined from 0213).
-- ============================================================

-- ---------- When the claimants of the small-claims court appeal ----------

/**
 * Whether the claimants of a lawsuit of the small-claims court appeal its judgment now (0218): the firm decided the
 * recurso inominado on a judgment in force (0185) and no recurso of the lawsuit was filed since, or a recurso of
 * theirs is in course (0189) and not filed. Internal.
 */
create or replace function public.lawsuit_appeal_open(target_proceeding uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select p.kind = 'juizado' and p.status = 'filed' and (
      exists (
        select 1 from public.judgment_paths jp
        join public.lawsuit_facts f on f.id = jp.fact_id and f.corrected_at is null
        where jp.proceeding_id = p.id and jp.decision = 'recurso_inominado'
          and not exists (
            select 1 from public.case_drafts d
            where d.proceeding_id = p.id and d.piece_kind = 'recurso' and d.filed_at is not null
              and d.filed_at >= jp.decided_at
          )
      )
      or exists (
        select 1 from public.case_drafts d
        where d.proceeding_id = p.id and d.piece_kind = 'recurso' and d.filed_at is null
          and d.status in ('generating', 'proposed', 'approved', 'issued')
          and d.decision is distinct from 'hold'
      )
    )
    from public.proceedings p
    where p.id = target_proceeding
  ), false);
$$;

revoke all on function public.lawsuit_appeal_open(uuid) from public, anon, authenticated;

/**
 * Whose word on free justice a case needs (0125, redefined): each claimant of a lawsuit planned in the civil court,
 * and each claimant of a lawsuit of the small-claims court while they appeal (0218), with who gives it today and the
 * answer in force of that person, if any. Internal.
 */
create or replace function public.free_justice_needs(target_case uuid)
returns table (
  party_id uuid,
  proceeding_id uuid,
  minor boolean,
  answerer_id uuid,
  answer_id uuid,
  asks boolean,
  source text,
  recorded_at timestamptz,
  note text
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (cp.id)
    cp.id, p.id, public.case_party_is_minor(cp.id), public.civil_court_answerer(cp.id),
    a.id, a.asks, a.source, a.recorded_at, a.note
  from public.proceedings p
  join public.proceeding_parties pp on pp.proceeding_id = p.id
  join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
  left join lateral (select * from public.free_justice_answer_in_force(cp.id)) a on a.id is not null
  where p.case_id = target_case
    and ((p.kind = 'comum' and p.status = 'planned') or public.lawsuit_appeal_open(p.id))
  order by cp.id, p.created_at, p.id;
$$;

revoke all on function public.free_justice_needs(uuid) from public, anon, authenticated;

-- ---------- What the firm and the link read ----------

/** What a case needs and had of its claimants' word on free justice, for the firm's screen (0125): of an appeal too. */
create or replace function public.case_free_justice(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
begin
  select * into current_case from public.cases where id = target_case;
  if not found or not public.is_org_member(current_case.org_id) then
    return jsonb_build_object('ok', false, 'code', 'case_not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'needs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'party_id', n.party_id, 'proceeding_id', n.proceeding_id, 'minor', n.minor, 'name', pe.full_name,
        'answerer_id', n.answerer_id, 'answerer_name', ans.full_name, 'answer_id', n.answer_id, 'asks', n.asks,
        'source', n.source, 'recorded_at', n.recorded_at, 'note', n.note,
        -- Asked for the recurso of the small-claims court (0218), not for the start of a lawsuit of the civil court.
        'appeal', pr.kind = 'juizado',
        'paper', (
          select e.status from public.case_papers paper
          join public.signature_envelopes e on e.id = paper.envelope_id
          where paper.case_id = current_case.id and paper.person_id = n.answerer_id
            and paper.kind = 'declaracao_hipossuficiencia'
        ),
        'income', exists (
          select 1 from public.case_documents d
          join public.case_parties dp on dp.id = d.party_id
          where d.case_id = current_case.id and d.kind = 'income_proof' and dp.person_id = n.answerer_id
            and d.status in ('received', 'accepted')
        )
      ) order by n.minor, pe.full_name, n.party_id)
      from public.free_justice_needs(current_case.id) n
      join public.proceedings pr on pr.id = n.proceeding_id
      join public.case_parties cp on cp.id = n.party_id
      join public.people pe on pe.id = cp.person_id
      left join public.people ans on ans.id = n.answerer_id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.case_free_justice(uuid) from public, anon;
grant execute on function public.case_free_justice(uuid) to authenticated;

/**
 * What a link asks its person about free justice (0125, redefined): their own claim and the claims of the minors they
 * answer for, each saying whether it is asked for the recurso of the small-claims court (0218).
 */
create or replace function public.client_link_free_justice(target_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  link public.client_links%rowtype := public.client_link_by_token(target_token);
begin
  if link.id is null or link.revoked_at is not null or link.expires_at <= now()
     or not exists (select 1 from public.case_parties cp where cp.case_id = link.case_id and cp.person_id = link.person_id) then
    return jsonb_build_object('ok', false, 'code', 'link_not_open');
  end if;
  return jsonb_build_object(
    'ok', true,
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'party_id', n.party_id, 'name', pe.full_name, 'minor', n.minor, 'asks', n.asks, 'recorded_at', n.recorded_at,
        'source', n.source, 'appeal', pr.kind = 'juizado'
      ) order by n.minor, pe.full_name, n.party_id)
      from public.free_justice_needs(link.case_id) n
      join public.proceedings pr on pr.id = n.proceeding_id
      join public.case_parties cp on cp.id = n.party_id
      join public.people pe on pe.id = cp.person_id
      where n.answerer_id = link.person_id
    ), '[]'::jsonb),
    'issued', exists (
      select 1 from public.case_papers paper
      where paper.case_id = link.case_id and paper.person_id = link.person_id
        and paper.kind = 'declaracao_hipossuficiencia'
    ),
    'income', exists (
      select 1 from public.case_documents d
      join public.case_parties dp on dp.id = d.party_id
      where d.case_id = link.case_id and d.kind = 'income_proof' and dp.person_id = link.person_id
        and d.status in ('uploading', 'received', 'accepted')
    ),
    'own_party', (
      select cp.id from public.case_parties cp
      where cp.case_id = link.case_id and cp.person_id = link.person_id
      order by (cp.role = 'claimant') desc, cp.created_at
      limit 1
    )
  );
end;
$$;

revoke all on function public.client_link_free_justice(text) from public;
grant execute on function public.client_link_free_justice(text) to anon, authenticated;

-- ---------- The recurso asks for it ----------

/**
 * Why a piece may not be approved for free justice (0125, redefined), or null: of the initial of the civil court, as
 * before; of a recurso of the small-claims court while its claimants appeal (0218), a claimant who has not answered
 * (`free_justice_unanswered`), or somebody who asks while the latest version has no `[[GRATUIDADE]]`
 * (`free_justice_mark_missing`: a lawyer puts it). Internal.
 */
create or replace function public.free_justice_piece_blocker(target_draft uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when d.piece_kind = 'recurso' and p.kind = 'juizado' then
      case
        when not public.lawsuit_appeal_open(p.id) then null
        when exists (
          select 1 from public.proceeding_parties pp
          join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
          where pp.proceeding_id = p.id and (public.free_justice_answer_in_force(cp.id)).id is null
        ) then 'free_justice_unanswered'
        when exists (
          select 1 from public.proceeding_parties pp
          join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
          where pp.proceeding_id = p.id and (public.free_justice_answer_in_force(cp.id)).asks
        ) and strpos(coalesce(v.body, ''), '[[GRATUIDADE]]') = 0 then 'free_justice_mark_missing'
      end
    when p.kind <> 'comum' or p.status <> 'planned' then null
    when exists (
      select 1 from public.proceeding_parties pp
      join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
      where pp.proceeding_id = p.id and (public.free_justice_answer_in_force(cp.id)).id is null
    ) then 'free_justice_unanswered'
    when exists (
      select 1 from public.proceeding_parties pp
      join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
      where pp.proceeding_id = p.id and (public.free_justice_answer_in_force(cp.id)).asks
    ) and strpos(coalesce(v.body, ''), '[[GRATUIDADE]]') = 0 then 'free_justice_mark_missing'
  end
  from public.case_drafts d
  join public.proceedings p on p.id = d.proceeding_id
  left join public.case_draft_versions v on v.draft_id = d.id and v.version = d.version
  where d.id = target_draft;
$$;

revoke all on function public.free_justice_piece_blocker(uuid) from public, anon, authenticated;

/**
 * The text of a draft with the facts of its lawsuit written in (0029, 0064, 0125, 0178, 0215, redefined): the request
 * for free justice of a recurso of the small-claims court too (0218). The other marks are filled as before.
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
  asking text;
  asked integer;
  unanswered integer;
  priority jsonb;
  elders text;
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
      '[COMPLETAR: CNPJ da companhia]')
    -- Its head office, where it is on record (0215): a petition names where the defendant is (CPC, art. 319, II;
    -- Lei 9.099/1995, art. 14, § 1º, I). With none, the CNPJ is how the court cites it (CPC, art. 319, § 2º).
    || coalesce(', com sede em ' || nullif(btrim(airline.address), ''), '');

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

  -- Free justice, as each claimant answered it: of a lawsuit of the civil court at its start (0125), of a recurso of
  -- the small-claims court (0218). Who asks, by name; a request nobody makes leaves its place empty, and so does a
  -- lawsuit of the small-claims court at its start, which has no costs, or another piece.
  if strpos(filled, '[[GRATUIDADE]]') > 0 or strpos(filled, '[[PEDIDO_GRATUIDADE]]') > 0 then
    select
      regexp_replace(string_agg(pe.full_name, ', ' order by cp.created_at, cp.id) filter (where a.asks),
        ', ([^,]*)$', ' e \1'),
      count(*) filter (where a.asks),
      count(*) filter (where a.id is null)
    into asking, asked, unanswered
    from public.proceeding_parties pp
    join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
    join public.people pe on pe.id = cp.person_id
    left join lateral (select * from public.free_justice_answer_in_force(cp.id)) a on a.id is not null
    where pp.proceeding_id = lawsuit.id;
    if lawsuit.kind = 'juizado' and draft.piece_kind = 'recurso' then
      if coalesce(unanswered, 0) > 0 then
        filled := replace(filled, '[[GRATUIDADE]]',
          '[COMPLETAR: a resposta de cada parte recorrente sobre a gratuidade da justiça]');
        filled := replace(filled, '[[PEDIDO_GRATUIDADE]]', '');
      elsif coalesce(asked, 0) = 0 then
        filled := replace(replace(filled, '[[GRATUIDADE]]', ''), '[[PEDIDO_GRATUIDADE]]', '');
      elsif asked = 1 then
        filled := replace(filled, '[[GRATUIDADE]]', E'DA GRATUIDADE DA JUSTIÇA\n\nA parte recorrente ' || asking
          || ' não tem condições de arcar com o preparo deste recurso e com as demais despesas do processo sem prejuízo'
          || ' do próprio sustento e do sustento da família, e pede a gratuidade da justiça, nos termos dos arts. 98 e 99'
          || ' da Lei nº 13.105 e do art. 54, parágrafo único, da Lei nº 9.099, conforme a declaração que acompanha este'
          || ' recurso. Requerida a gratuidade no recurso, fica dispensada de comprovar o recolhimento do preparo até a'
          || ' decisão do pedido (art. 99, § 7º, da Lei nº 13.105).');
        filled := replace(filled, '[[PEDIDO_GRATUIDADE]]',
          case when claimants = 1 then 'Requer' else 'Requerem' end || ', ainda, a concessão da gratuidade da justiça a '
          || asking || ', nos termos do art. 99, § 7º, da Lei nº 13.105.');
      else
        filled := replace(filled, '[[GRATUIDADE]]', E'DA GRATUIDADE DA JUSTIÇA\n\nAs partes recorrentes ' || asking
          || ' não têm condições de arcar com o preparo deste recurso e com as demais despesas do processo sem prejuízo'
          || ' do próprio sustento e do sustento da família, e pedem a gratuidade da justiça, nos termos dos arts. 98 e 99'
          || ' da Lei nº 13.105 e do art. 54, parágrafo único, da Lei nº 9.099, conforme as declarações que acompanham'
          || ' este recurso. Requerida a gratuidade no recurso, ficam dispensadas de comprovar o recolhimento do preparo'
          || ' até a decisão do pedido (art. 99, § 7º, da Lei nº 13.105).');
        filled := replace(filled, '[[PEDIDO_GRATUIDADE]]', 'Requerem, ainda, a concessão da gratuidade da justiça a '
          || asking || ', nos termos do art. 99, § 7º, da Lei nº 13.105.');
      end if;
    elsif lawsuit.kind <> 'comum' or draft.piece_kind <> 'inicial' then
      filled := replace(replace(filled, '[[GRATUIDADE]]', ''), '[[PEDIDO_GRATUIDADE]]', '');
    elsif coalesce(unanswered, 0) > 0 then
      filled := replace(filled, '[[GRATUIDADE]]',
        '[COMPLETAR: a resposta de cada parte autora sobre a gratuidade da justiça]');
      filled := replace(filled, '[[PEDIDO_GRATUIDADE]]', '');
    elsif coalesce(asked, 0) = 0 then
      filled := replace(filled, '[[GRATUIDADE]]', 'Nenhuma parte autora pede a gratuidade da justiça.');
      filled := replace(filled, '[[PEDIDO_GRATUIDADE]]', '');
    elsif asked = 1 then
      filled := replace(filled, '[[GRATUIDADE]]', 'A parte autora ' || asking
        || ' não tem condições de arcar com as custas e as despesas do processo sem prejuízo do próprio sustento e do'
        || ' sustento da família, e pede a gratuidade da justiça, nos termos do art. 98 da Lei nº 13.105, conforme'
        || ' a declaração que acompanha esta inicial.');
      filled := replace(filled, '[[PEDIDO_GRATUIDADE]]', 'Requer, por fim, a concessão da gratuidade da justiça a '
        || asking || ', nos termos do art. 98 da Lei nº 13.105.');
    else
      filled := replace(filled, '[[GRATUIDADE]]', 'As partes autoras ' || asking
        || ' não têm condições de arcar com as custas e as despesas do processo sem prejuízo do próprio sustento e do'
        || ' sustento da família, e pedem a gratuidade da justiça, nos termos do art. 98 da Lei nº 13.105, conforme'
        || ' as declarações que acompanham esta inicial.');
      filled := replace(filled, '[[PEDIDO_GRATUIDADE]]', 'Requer, por fim, a concessão da gratuidade da justiça a '
        || asking || ', nos termos do art. 98 da Lei nº 13.105.');
    end if;
    -- A place left empty takes no blank lines with it.
    filled := regexp_replace(filled, E'(\r?\n)(\r?\n)(\r?\n)+', E'\\1\\2', 'g');
  end if;
  -- The priority of processing of an elderly claimant (0178, `especificidades-v1`): by name and age, the special one
  -- from 80; a lawsuit with nobody of that age leaves the place empty.
  if strpos(filled, '[[PRIORIDADE]]') > 0 then
    priority := public.lawsuit_priority(lawsuit.id);
    select regexp_replace(
             string_agg(p ->> 'name' || ', com ' || (p ->> 'age') || ' anos', '; ' order by (p ->> 'age')::integer desc),
             '; ([^;]*)$', ' e \1')
    into elders
    from jsonb_array_elements(priority -> 'people') p;
    filled := replace(filled, '[[PRIORIDADE]]', case
      when priority ->> 'priority' in ('elderly', 'elderly_80') then
        E'DA PRIORIDADE DE TRAMITAÇÃO\n\n'
        || case when jsonb_array_length(priority -> 'people') = 1 then 'A parte autora ' else 'As partes autoras ' end
        || elders
        || case when jsonb_array_length(priority -> 'people') = 1 then ', é pessoa idosa' else ', são pessoas idosas' end
        || ' e requer a prioridade de tramitação deste processo, nos termos do art. 71 da Lei nº 10.741 e do art. 1.048,'
        || ' I, da Lei nº 13.105'
        || case when priority ->> 'priority' = 'elderly_80'
                then ', com a prioridade especial do § 5º do art. 71 da Lei nº 10.741, por ter oitenta anos ou mais.'
                else '.' end
      else '' end);
    -- A place left empty takes no blank lines with it.
    filled := regexp_replace(filled, E'(\r?\n)(\r?\n)(\r?\n)+', E'\\1\\2', 'g');
  end if;
  return filled;
end;
$$;

revoke all on function public.case_draft_filled(uuid, text) from public, anon, authenticated;

-- ---------- The platform's recurso takes the marks, in a new version of the module ----------

update public.piece_kinds
set model = $m$[[JUIZO]]

Processo nº [COMPLETAR: número do processo]

[[NOMES_DAS_PARTES]], já qualificados nos autos da ação que movem contra [[RE]], vêm, por seus advogados, interpor

RECURSO

[COMPLETAR: os pontos em que a sentença deve ser reformada e por quê]

[[GRATUIDADE]]

Diante do exposto, pedem que o recurso seja recebido e provido.

[[PEDIDO_GRATUIDADE]]

Nestes termos, pedem deferimento.

[[ADVOGADOS]]$m$
where slug = 'recurso' and strpos(model, '[[GRATUIDADE]]') = 0;

-- The version each module publishes: its latest published, with this recurso and nothing else changed. A draft the
-- operator had prepared is discarded (`admin_draft_module_version` replaces one the same way): prepared again, it
-- holds what is in force now, this model included.
delete from public.module_versions v
where v.status = 'draft'
  and exists (select 1 from public.module_versions o where o.module = v.module and o.status = 'published'
              and o.manifest #> '{pieces,kinds,recurso}' is not null
              and strpos(coalesce(o.manifest #>> '{pieces,kinds,recurso,model}', ''), '[[GRATUIDADE]]') = 0);

insert into public.module_versions (module, version, status, manifest, note, published_at)
select latest.module,
       (select max(o.version) from public.module_versions o where o.module = latest.module) + 1,
       'published',
       jsonb_set(latest.manifest, '{pieces,kinds,recurso,model}', to_jsonb(k.model)),
       'O recurso pede a justiça gratuita de quem pede no recurso do juizado (Lei nº 9.099/1995, art. 54, parágrafo único; CPC, art. 99, § 7º).',
       now()
from (
  select distinct on (v.module) v.module, v.manifest
  from public.module_versions v
  join public.product_modules m on m.key = v.module and m.retired_at is null
  where v.status = 'published'
  order by v.module, v.version desc
) latest
cross join public.piece_kinds k
where k.slug = 'recurso'
  and latest.manifest #> '{pieces,kinds,recurso}' is not null
  and strpos(coalesce(latest.manifest #>> '{pieces,kinds,recurso,model}', ''), '[[GRATUIDADE]]') = 0;

-- ---------- The preparo, and who files ----------

/**
 * A recurso of a lawsuit of the small-claims court marked filed proposes its preparo (0213, redefined), due in the 48
 * hours after (Lei 9.099/1995, art. 42, § 1º), unless every claimant of the lawsuit asks free justice in it: they are
 * spared proving the preparo until the court decides the request (CPC, art. 99, § 7º), and the term the court gives
 * if it refuses is read from its publication.
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
  if exists (
    select 1 from public.proceeding_parties pp
    join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
    where pp.proceeding_id = lawsuit.id
  ) and not exists (
    select 1 from public.proceeding_parties pp
    join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
    where pp.proceeding_id = lawsuit.id and not coalesce((public.free_justice_answer_in_force(cp.id)).asks, false)
  ) then
    return null;
  end if;
  perform public.one_propose_term(lawsuit.id, null, 'preparo_recurso_inominado',
    (new.filed_at at time zone 'America/Sao_Paulo')::date, 'recurso_filed');
  return null;
end;
$$;

revoke all on function public.case_drafts_preparo() from public, anon, authenticated;

/**
 * What keeps ONE from filing an intermediate piece itself (0189, redefined), or null: a recurso of the small-claims
 * court that asks free justice goes with the declaration of who asks, and ONE files a piece with no attachment
 * (`free_justice_declaration`: the lawyer files it in the court's system with the declaration); then the court's
 * channel, its fixed address, its code of the document, and a court that takes files signed. A test case is filed in
 * the test court.
 */
create or replace function public.piece_filing_blocker(target_draft uuid)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  draft public.case_drafts%rowtype;
  lawsuit public.proceedings%rowtype;
  channel public.court_filing_channels%rowtype;
begin
  select * into draft from public.case_drafts where id = target_draft;
  if not found or draft.piece_kind = 'inicial' then
    return 'not_found';
  end if;
  if draft.status <> 'issued' or draft.document_id is null then
    return 'not_issued';
  end if;
  if draft.decision is distinct from 'file' then
    return 'not_decided';
  end if;
  select * into lawsuit from public.proceedings where id = draft.proceeding_id;
  if draft.piece_kind = 'recurso' and lawsuit.kind = 'juizado' and exists (
    select 1 from public.proceeding_parties pp
    join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
    where pp.proceeding_id = lawsuit.id and coalesce((public.free_justice_answer_in_force(cp.id)).asks, false)
  ) then
    return 'free_justice_declaration';
  end if;
  if exists (select 1 from public.cases c where c.id = draft.case_id and c.is_test) then
    return null;
  end if;
  select * into channel from public.court_filing_channels ch
  where ch.court = lawsuit.court and ch.system = lawsuit.system;
  if not found or not channel.enabled then
    return 'no_channel';
  end if;
  if channel.fixed_ip and not coalesce((
    select (s.value ->> 'egress_fixed_ip')::boolean from public.platform_settings s where s.key = 'filing_submit'
  ), false) then
    return 'fixed_ip';
  end if;
  if coalesce(channel.codes #>> '{document_types,intermediate_petition}', '') !~ '^[0-9]+$' then
    return 'code_missing';
  end if;
  if exists (select 1 from public.court_systems cs
             where cs.court = lawsuit.court and cs.system = lawsuit.system and cs.signed_files is not null) then
    return 'signature_needed';
  end if;
  return null;
end;
$$;

revoke all on function public.piece_filing_blocker(uuid) from public, anon, authenticated;

-- ---------- The declaration of a case already with the court ----------

/**
 * The declarations of hardship a case already with the court owes now (0218): of each adult of the case whose link is
 * open, once everybody they answer for in an appeal answered and somebody asks, where the firm lets ONE send the
 * papers to sign and has a model of it, and none was issued to them in the case. A case before its filing owes it
 * through `case_papers_due` (0125). Internal.
 */
create or replace function public.appeal_papers_due(target_case uuid)
returns table (person_id uuid, template_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select l.person_id, public.paper_template_for(c.org_id, 'declaracao_hipossuficiencia')
  from public.cases c
  join public.client_links l on l.case_id = c.id
  where c.id = target_case and c.status = 'filed'
    and l.revoked_at is null and l.expires_at > now()
    and public.firm_autonomy_mode(c.org_id, 'send_signature_papers') = 'auto'
    and public.paper_template_for(c.org_id, 'declaracao_hipossuficiencia') is not null
    and exists (select 1 from public.case_parties cp where cp.case_id = c.id and cp.person_id = l.person_id)
    and not exists (
      select 1 from public.people p
      where p.id = l.person_id and p.birth_date is not null
        and p.birth_date > (now() at time zone 'America/Sao_Paulo')::date - interval '18 years'
    )
    and not exists (
      select 1 from public.case_papers paper
      where paper.case_id = c.id and paper.person_id = l.person_id and paper.kind = 'declaracao_hipossuficiencia'
    )
    and exists (select 1 from public.free_justice_needs(c.id) n where n.answerer_id = l.person_id and n.asks)
    and not exists (select 1 from public.free_justice_needs(c.id) n where n.answerer_id = l.person_id and n.answer_id is null)
  group by l.person_id, c.org_id
  order by l.person_id;
$$;

revoke all on function public.appeal_papers_due(uuid) from public, anon, authenticated;

/** The cases with the court that owe a declaration of an appeal now (service role), the oldest answer first. */
create or replace function public.appeal_papers_owed(target_limit integer default 10)
returns table (case_id uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select a.case_id from public.free_justice_answers a
  join public.cases c on c.id = a.case_id and c.status = 'filed'
  where a.replaced_at is null and a.asks
    and not exists (
      select 1 from public.case_papers paper
      where paper.case_id = a.case_id and paper.person_id = a.person_id and paper.kind = 'declaracao_hipossuficiencia'
    )
    and exists (select 1 from public.appeal_papers_due(a.case_id))
  group by a.case_id
  order by min(a.recorded_at), a.case_id
  limit greatest(least(coalesce(target_limit, 10), 50), 1);
end;
$$;

revoke all on function public.appeal_papers_owed(integer) from public, anon, authenticated;
grant execute on function public.appeal_papers_owed(integer) to service_role;

/**
 * The next declaration of an appeal a case with the court owes (service role), with the text of the person's facts,
 * as `advance_paper_to_issue` writes it (0125): `due`, `incomplete` or `unwritable` (held: the case waits for the
 * facts), or `none`.
 */
create or replace function public.appeal_paper_to_issue(target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  due record;
  template public.draft_templates%rowtype;
  person public.people%rowtype;
  filled text;
  missing text[];
  unwritable text[];
  held jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into current_case from public.cases where id = target_case;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'case_not_found');
  end if;
  for due in select * from public.appeal_papers_due(target_case) loop
    select * into template from public.draft_templates where id = due.template_id;
    select * into person from public.people where id = due.person_id;
    filled := public.free_justice_marks_filled(target_case, due.person_id, template.body);
    filled := public.case_paper_filled(target_case, due.person_id, filled);
    select coalesce(array_agg(distinct m[1]), '{}') into missing
    from regexp_matches(filled, '\[COMPLETAR:\s*([^\]]+)\]', 'g') as m;
    if cardinality(missing) > 0 or filled ~ '\[\[[A-Z_]+\]\]' then
      held := coalesce(held, jsonb_build_object('ok', true, 'code', 'incomplete', 'person_id', due.person_id,
        'missing', to_jsonb(missing), 'unknown_mark', filled ~ '\[\[[A-Z_]+\]\]'));
      continue;
    end if;
    unwritable := public.unwritable_characters(filled);
    if cardinality(unwritable) > 0 then
      held := coalesce(held, jsonb_build_object('ok', true, 'code', 'unwritable', 'person_id', due.person_id,
        'characters', to_jsonb(unwritable)));
      continue;
    end if;
    return jsonb_build_object(
      'ok', true,
      'code', 'due',
      'org_id', current_case.org_id,
      'person_id', due.person_id,
      'kind', 'declaracao_hipossuficiencia',
      'template_id', due.template_id,
      'title', 'Declaração de hipossuficiência econômica',
      'person', person.full_name,
      'firm', (select o.name from public.organizations o where o.id = current_case.org_id),
      'body', filled
    );
  end loop;
  return coalesce(held, jsonb_build_object('ok', true, 'code', 'none'));
end;
$$;

revoke all on function public.appeal_paper_to_issue(uuid) from public, anon, authenticated;
grant execute on function public.appeal_paper_to_issue(uuid) to service_role;

/**
 * ONE issues the declaration of an appeal (service role), as `advance_record_paper` issues a paper (0125): checked
 * again under the case's own lock, the PDF the backend made is kept as a document of the case and sent to the person
 * to sign, by the firm's ZapSign account where it connected one, else by gov.br on the link.
 */
create or replace function public.record_appeal_paper(
  target_case uuid,
  target_person uuid,
  target_template uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_case public.cases%rowtype;
  person public.people%rowtype;
  file public.files%rowtype;
  kept jsonb;
  document uuid;
  envelope uuid;
  account uuid;
  method text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  perform set_config('one.system_case', target_case::text, true);
  -- The case's own lock: two workers issuing at once take turns, and the second finds the paper of the first.
  current_case := public.case_for_writer(target_case);
  if not exists (
    select 1 from public.appeal_papers_due(target_case) d
    where d.person_id = target_person and d.template_id is not distinct from target_template
  ) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'not_due');
  end if;
  if coalesce(payload ->> 'file_id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     or coalesce(payload ->> 'sha256', '') !~ '^[0-9a-f]{64}$'
     or coalesce(payload ->> 'bytes', '') !~ '^[0-9]{1,12}$'
     or coalesce(payload ->> 'pages', '1') !~ '^[0-9]{1,6}$' then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'invalid_payload');
  end if;
  select * into file from public.files f
  where f.id = (payload ->> 'file_id')::uuid and f.org_id = current_case.org_id and f.purpose = 'paper' for update;
  if not found then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'file_not_found');
  end if;
  kept := public.confirm_file(file.id, payload ->> 'sha256', (payload ->> 'bytes')::bigint, 'application/pdf',
    coalesce((payload ->> 'pages')::integer, 1));
  if not coalesce((kept ->> 'ok')::boolean, false) then
    perform set_config('one.system_case', '', true);
    return jsonb_build_object('ok', false, 'code', 'file_refused');
  end if;
  select * into person from public.people where id = target_person;

  insert into public.case_documents (org_id, case_id, file_id, kind, source, status, decided_at)
  values (current_case.org_id, current_case.id, file.id, 'free_justice_declaration', 'firm', 'accepted', now())
  returning id into document;

  select c.id into account from public.connections c
  where c.org_id = current_case.org_id and c.provider = 'zapsign' and c.status = 'connected'
  order by c.connected_at desc nulls last
  limit 1;
  method := case when account is null then 'govbr' else 'zapsign' end;
  insert into public.signature_envelopes (org_id, case_id, document_id, method, status, signers, connection_id)
  values (current_case.org_id, current_case.id, document, method,
    case when method = 'zapsign' then 'reserved' else 'pending' end,
    jsonb_build_array(jsonb_build_object(
      'position', 1, 'person_id', person.id, 'name', person.full_name, 'sign_url', null, 'signed_at', null)),
    account)
  returning id into envelope;

  insert into public.case_papers (org_id, case_id, person_id, kind, template_id, document_id, envelope_id)
  values (current_case.org_id, current_case.id, target_person, 'declaracao_hipossuficiencia', target_template, document,
          envelope);

  perform public.record_case_event(current_case.org_id, current_case.id, 'paper_issued', 'system',
    jsonb_build_object('document', document, 'kind', 'declaracao_hipossuficiencia', 'person', target_person));
  perform public.record_case_event(current_case.org_id, current_case.id, 'signature_requested', 'system',
    jsonb_build_object('envelope', envelope, 'method', method, 'document', document));
  perform set_config('one.system_case', '', true);
  return jsonb_build_object('ok', true, 'code', 'issued', 'document_id', document, 'envelope_id', envelope,
    'method', method);
end;
$$;

revoke all on function public.record_appeal_paper(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_appeal_paper(uuid, uuid, uuid, jsonb) to service_role;
