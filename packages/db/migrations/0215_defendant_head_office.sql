-- ============================================================
-- 0215 · Where the airline sued is, in the petition.
--
-- From the review of 2026-11-11 against the CPC and the Lei 9.099/1995. A
-- petition names the defendant's domicile and seat (CPC, art. 319, II; in
-- the small-claims court, the address of the parties: Lei 9.099/1995, art.
-- 14, § 1º, I). ONE's piece named the airline by its legal name and its CNPJ
-- only (`[[RE]]`, 0058).
--
-- Each airline now keeps the address of its head office (`airlines.address`),
-- data the operator records as it records the legal name and the CNPJ, and
-- the piece writes it after the CNPJ where it is on record (`case_draft_filled`
-- redefined from 0178; every case reads it at once, since the mark is filled
-- by the database, not written in a model). An airline with none is named as
-- before: with its CNPJ the court cites it all the same, and the petition is
-- not refused for it (CPC, art. 319, § 2º). The power of attorney names who it
-- is against and needs no address of it, so it is unchanged.
--
-- Recorded here for the four Brazilian operators of 0058, each read on
-- 2026-11-11 in the Receita Federal's open CNPJ data (through BrasilAPI's
-- reading of it): active, at the head office below.
-- ============================================================

alter table public.airlines add column address text;
alter table public.airlines add constraint airlines_address_check
  check (address is null or (address = btrim(address) and char_length(address) between 10 and 300));

update public.airlines
set address = 'Rua Ática, nº 673, andar 6, sala 62, Jardim Brasil (Zona Sul), São Paulo/SP, CEP 04634-042', updated_at = now()
where iata = 'LA' and cnpj = '02012862000160';
update public.airlines
set address = 'Praça Senador Salgado Filho, s/nº, térreo, área pública entre os eixos 46-48 O-P, sala de gerência back office, Centro, Rio de Janeiro/RJ, CEP 20021-340',
    updated_at = now()
where iata = 'G3' and cnpj = '07575651000159';
update public.airlines
set address = 'Avenida Marcos Penteado de Ulhôa Rodrigues, nº 939, 9º andar, Edifício Jatobá, Condomínio Castelo Branco, Tamboré, Barueri/SP, CEP 06460-040',
    updated_at = now()
where iata = 'AD' and cnpj = '09296295000160';
update public.airlines
set address = 'Avenida Thomaz Alberto Whately, nº 2605, lote 14, Jardim Aeroporto, Ribeirão Preto/SP, CEP 14078-550', updated_at = now()
where iata = '2Z' and cnpj = '00512777000135';

/**
 * The text of a draft with the facts of its lawsuit written in (0029, 0064, 0125, 0178), with `[[RE]]` now naming
 * the airline's head office after its CNPJ where it is on record (0215). The other marks are filled as before.
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

  -- Free justice, as each claimant of a lawsuit of the civil court answered it (0125): who asks, by name. A lawsuit of
  -- the small-claims court asks nothing, and a request nobody makes leaves its place empty.
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
    if lawsuit.kind <> 'comum' then
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
