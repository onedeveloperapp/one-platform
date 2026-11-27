-- ============================================================
-- 0310 · A previsão pelo lugar do caso
--
-- The owner asked on 2026-11-27, of the test case 19 (a cancellation by Azul,
-- a client of the Jardim Botânico, a juizado of the TJRJ), what the forecast
-- considered and whether it read the jurisdiction of the client's domicile.
-- It said "Todo o TJRJ · todas as companhias", 91%, 52 of 57, while the case
-- had the comarca of the domicile right. The owner said yes, the same day, to
-- the three fixes below.
--
--   1. A decision's comarca as each court writes its units. `market_comarca_of`
--      read only the TJGO's "Goiânia - 9ª UPJ ...": none of the TJRJ's 804
--      decisions had one ("6º Juizado Especial Cível da Comarca da Capital
--      Lagoa", "3º Juizado Especial Cível da Regional da Barra da Tijuca"), and
--      the TJSP's came out as "UPJ da 1ª a 6ª Varas Cíveis". It now reads the
--      city before the dash (TJGO, TJES), "Comarca de X", the Capital
--      (`courts.capital`), the regionals of the Capital (TJRJ, TJSP, TJPB), the
--      TJSP's Central, "Foro de X", "Termo Judiciário de X", the TJPI's "JECC X
--      Sede", and the city after the unit's kind ("4º Juizado Especial Cível de
--      Maringá"). Each court's forms are in the test.
--   2. The lawsuit's kind in every cut: a juizado's forecast reads juizados and
--      a civil court's the civil courts (`market_kind_of`; a court of appeal,
--      a family or criminal court is neither, and stays out of both). The 57
--      decisions of case 19 were 38 of civil courts, 95% won, and 19 of
--      juizados, 84%.
--   3. The place inside the comarca by the client's neighbourhood, from the
--      court's own list (`court_forum_areas`, 0309): a juizado of the Capital of
--      Rio de Janeiro takes the lawsuits of its neighbourhoods, so before the
--      lawsuit is distributed the lottery is only among the juizados of that
--      place (the Jardim Botânico's is the Lagoa's, one juizado). The cut
--      "place" goes between the unit and the comarca, the first claimant's
--      neighbourhood read as the filing reads it (`forumOfDistrict` of
--      `@flyee/rules/forum`, mirrored by `district_key`); the judge is still
--      read only of a lawsuit distributed (CPC, art. 285).
--
-- Each decision keeps its kind, comarca and place, written by a trigger and
-- read again here for every decision; the levels beside the forecast are each
-- level with the airline when it has the sample, the one used as it was used.
-- ============================================================

-- ---------- 1. The capital of each state's court ----------

alter table public.courts add column capital text;
alter table public.courts add constraint courts_capital_check check (capital is null or char_length(capital) between 2 and 80);

update public.courts as k
set capital = v.capital
from (values
  ('TJAC', 'Rio Branco'), ('TJAL', 'Maceió'), ('TJAP', 'Macapá'), ('TJAM', 'Manaus'), ('TJBA', 'Salvador'),
  ('TJCE', 'Fortaleza'), ('TJDFT', 'Brasília'), ('TJES', 'Vitória'), ('TJGO', 'Goiânia'), ('TJMA', 'São Luís'),
  ('TJMT', 'Cuiabá'), ('TJMS', 'Campo Grande'), ('TJMG', 'Belo Horizonte'), ('TJPA', 'Belém'),
  ('TJPB', 'João Pessoa'), ('TJPR', 'Curitiba'), ('TJPE', 'Recife'), ('TJPI', 'Teresina'),
  ('TJRJ', 'Rio de Janeiro'), ('TJRN', 'Natal'), ('TJRS', 'Porto Alegre'), ('TJRO', 'Porto Velho'),
  ('TJRR', 'Boa Vista'), ('TJSC', 'Florianópolis'), ('TJSP', 'São Paulo'), ('TJSE', 'Aracaju'), ('TJTO', 'Palmas')
) as v (acronym, capital)
where k.acronym = v.acronym;

-- ---------- 2. Names compared as the filing compares them ----------

/** A city or a place as `cityKey` of `@flyee/rules/forum` reads it: no accents, lower case, words only. */
create or replace function public.place_key(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(
    lower(translate(upper(coalesce(value, '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ', 'AAAAAEEEEIIIIOOOOOUUUUCN')),
    '[^a-z0-9]+', ' ', 'g'));
$$;

revoke all on function public.place_key(text) from public, anon, authenticated;

/**
 * A neighbourhood as `districtKey` of `@flyee/rules/forum` reads it: as a city, its short first word spelled out
 * ("Jd. Botânico" is "jardim botanico"). The same words in the same order, kept by the same examples in the test.
 */
create or replace function public.district_key(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select btrim(regexp_replace(
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(regexp_replace(public.place_key(value),
        '^jd\M', 'jardim'),
        '^pq\M', 'parque'),
        '^vl\M', 'vila'),
        '^sta\M', 'santa'),
        '^sto\M', 'santo'),
        '^s\M', 'sao'),
        '^(n sra|nsa sra|ns)\M', 'nossa senhora'),
        '^cid\M', 'cidade'),
        '^ilha do gov\M', 'ilha do governador'),
    '\s+', ' ', 'g'));
$$;

revoke all on function public.district_key(text) from public, anon, authenticated;

/** A place inside a comarca as it is compared: the court writes "Regional de Pavuna" and lists "Regional da Pavuna". */
create or replace function public.market_place_key(value text)
returns text
language sql
immutable
set search_path = public
as $$
  select public.place_key(regexp_replace(coalesce(value, ''), '^\s*regional\s+d[aeo]s?\s+', '', 'i'));
$$;

revoke all on function public.market_place_key(text) from public, anon, authenticated;

-- ---------- 3. A decision's kind, comarca and place, as each court writes its units ----------

/**
 * The kind of lawsuit a unit judges: 'juizado' (a juizado especial, a JEC, the TJMG's "Unidade Jurisdicional", a
 * vara of the JEC), 'comum' (a civil court, a sole or mixed one), or null (a court of appeal, read as first instance
 * by mistake, and a family, criminal or public treasury court: neither).
 */
create or replace function public.market_kind_of(target_unit text)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when u ~* '(recursa|\mturmas?\M|col[ée]gio|c[âa]mara|conselho|tribunal pleno|[óo]rg[ãa]o especial|presid[êe]ncia)' then null
    when u ~* '(juizado|\mjecc?s?\M|\mjesp\M|\mjd\M|unidade jurisdicional)' then 'juizado'
    when u ~* '\mvaras?\M'
         and (u ~* '(c[íi]ve(l|is)|[úu]nica|mista)'
              or u !~* '(fam[íi]lia|criminal|\mcrimes?\M|fazenda|inf[âa]ncia|juventude|registros?|sucess|execu[çc]|fal[êe]ncia|empresarial|[óo]rf[ãa]os|trabalho|viol[êe]ncia)')
      then 'comum'
  end
  from (select coalesce(target_unit, '') as u) as x;
$$;

revoke all on function public.market_kind_of(text) from public, anon, authenticated;

/**
 * The comarca a unit sits in, as each court writes it; null when the name does not say. The forms, each court's
 * examples in the test: "Goiânia - 2ª UPJ ..." and "Vila Velha - Comarca da Capital - ..." (the city before the dash),
 * "... da Comarca de Campinas", the Capital ("... da Comarca da Capital Lagoa", "6º Juizado Especial Cível da
 * Capital"), the regionals of the Capital (TJRJ, TJSP, TJPB), the TJSP's Central, the TJRJ's Região Oceânica
 * (Niterói), "Foro de Barueri", "Foro Regional de São José dos Pinhais", "Termo Judiciário de São José de Ribamar",
 * the TJPI's "JECC Pedro II Sede", and the city after the unit's kind ("4º Juizado Especial Cível de Maringá").
 */
create or replace function public.market_comarca_of(target_unit text, target_court text)
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  u text := btrim(regexp_replace(coalesce(target_unit, ''), '\s+', ' ', 'g'));
  c text := upper(btrim(coalesce(target_court, '')));
  head text;
  found text;
begin
  if u = '' then
    return null;
  end if;
  head := split_part(u, ' - ', 1);
  if position(' - ' in u) > 1
     and head !~* '(vara|juizado|\mjecc?\M|\mupj\M|of[íi]cio|unidade|\mforo\M|anexo|divis[ãa]o|regional|\mjd\M|\mjesp\M|central|turma|recursa|c[âa]mara|conselho|n[úu]cleo|cejusc|[0-9])' then
    found := head;
  elsif u ~* '\mcomarca d[eo] ' then
    found := (regexp_match(u, '\mcomarca d[eo] (.+)$', 'i'))[1];
  elsif u ~* '\mforo regional d[aeo]s? ' then
    found := regexp_replace((regexp_match(u, '\mforo regional d[aeo]s? (.+)$', 'i'))[1], ' da comarca\M.*$', '', 'i');
  elsif u ~* '\mjd (d[aeo] )?[^0-9 ]' then
    -- The TJMG's "1ª Unidade Jurisdicional - JESP - 1º JD Contagem".
    found := (regexp_match(u, '\mjd (?:d[aeo] )?([^-,(]+)$', 'i'))[1];
  elsif c = 'TJRJ' and u ~* '(regi[ãa]o oce[âa]nica|regional d[aeo]s? (alc[âa]ntara|itaipava|vila inhomirim|ino[ãa]))' then
    -- The TJRJ's regionals outside the Capital.
    found := case
      when u ~* 'alc[âa]ntara' then 'São Gonçalo'
      when u ~* 'itaipava' then 'Petrópolis'
      when u ~* 'vila inhomirim' then 'Magé'
      when u ~* 'ino[ãa]' then 'Maricá'
      else 'Niterói'
    end;
  elsif u ~* '\m(comarca )?da capital\M'
     or (c in ('TJRJ', 'TJSP', 'TJPB') and u ~* '\mregional\M')
     or (c = 'TJSP' and u ~* '\mcentral\M') then
    found := (select k.capital from public.courts k where k.acronym = c);
  elsif u ~* '\mforo (distrital )?de ' then
    found := (regexp_match(u, '\mforo (?:distrital )?de (.+)$', 'i'))[1];
  elsif u ~* '\mtermo judici[áa]rio de ' then
    found := (regexp_match(u, '\mtermo judici[áa]rio de (.+)$', 'i'))[1];
  elsif u ~* '^jecc ' then
    found := regexp_replace(substr(u, 6), ' (sede|anexo|norte|sul|leste|oeste|sudeste|nordeste|noroeste|sudoeste|centro)\M.*$', '', 'i');
  elsif u ~* '(juizado|\mjecc?\M|\mvaras?\M)' then
    found := regexp_replace(u,
      '^.*\m(juizados? especia(l|is)( (c[íi]ve(l|is)|misto|adjunto c[íi]vel))?( e criminal| criminal)?( e das rela[çc][õo]es de consumo)?( e da fazenda p[úu]blica)?|jecc?|varas?( (c[íi]ve(l|is)|[úu]nica|mista|descentralizada|regional c[íi]vel))?) (de|do|da|dos|das) ',
      '', 'i');
    if found = u then
      found := null;
    end if;
  end if;
  -- What follows the city: another part of the name, a parenthesis, a comma, a number ("Teresina 06").
  found := btrim(regexp_replace(regexp_replace(coalesce(found, ''), '(\s*-(\s|$)|\(|,).*$', ''), '\s+[0-9]+$', ''));
  return case when found = '' or char_length(found) > 80 then null else found end;
end;
$$;

revoke all on function public.market_comarca_of(text, text) from public, anon, authenticated;

/**
 * The place inside the comarca a unit sits in, as the court's system names it, where the court lists its places by
 * neighbourhood (`court_forum_areas`: the Capital of the TJRJ): "Regional da Barra da Tijuca", "Lagoa" of "... da
 * Comarca da Capital Lagoa", and "Central" of a unit of the "Comarca da Capital" with no place after it; null elsewhere.
 */
create or replace function public.market_place_of(target_unit text, target_court text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  u text := btrim(regexp_replace(coalesce(target_unit, ''), '\s+', ' ', 'g'));
  found text;
begin
  if upper(btrim(coalesce(target_court, ''))) <> 'TJRJ' then
    return null;
  end if;
  if u ~* '\mregional d[aeo]s? ' then
    found := (regexp_match(u, '\m(regional d[aeo]s? .+)$', 'i'))[1];
  elsif u ~* '\mcomarca da capital\M' then
    found := btrim(regexp_replace((regexp_match(u, '\mcomarca da capital\M(.*)$', 'i'))[1], '^[[:space:]-]+', ''));
    -- A unit of the Capital with nothing after it, or only its registry ("Cartório da 41ª Vara Cível"), is Central.
    if found = '' or found ~* '^cart[óo]rio' then
      found := 'Central';
    end if;
  end if;
  found := btrim(regexp_replace(coalesce(found, ''), '(\s*-(\s|$)|\(|,).*$', ''));
  return nullif(found, '');
end;
$$;

revoke all on function public.market_place_of(text, text) from public, anon, authenticated;

alter table public.market_decisions add column kind text;
alter table public.market_decisions add column comarca text;
alter table public.market_decisions add column place text;
alter table public.market_decisions add constraint market_decisions_kind_check check (kind is null or kind in ('juizado', 'comum'));

create or replace function public.market_decisions_where()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.kind := public.market_kind_of(new.unit);
  new.comarca := public.market_comarca_of(new.unit, new.court);
  new.place := public.market_place_of(new.unit, new.court);
  return new;
end;
$$;

revoke all on function public.market_decisions_where() from public, anon, authenticated;

create trigger market_decisions_where before insert or update of unit, court on public.market_decisions
  for each row execute function public.market_decisions_where();

update public.market_decisions
set kind = public.market_kind_of(unit),
    comarca = public.market_comarca_of(unit, court),
    place = public.market_place_of(unit, court);

create index market_decisions_forecast_idx on public.market_decisions (problem, kind, day) where instance = 'first';

-- ---------- 4. The place of a lawsuit ----------

/**
 * The place inside the comarca a lawsuit goes to (internal): the unit's own of a lawsuit distributed, else the place
 * that takes the first claimant's neighbourhood where the comarca is their city and the court lists its places
 * (`court_forum_areas`); null when the neighbourhood is not listed or names two places, as the filing reads it.
 */
create or replace function public.proceeding_place(target_proceeding uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    case when p.status <> 'planned' then public.market_place_of(p.unit, p.court) end,
    (select min(a.forum)
     from public.court_forum_areas a
     where a.court = p.court and a.kind = p.kind
       and public.place_key(a.comarca) = public.place_key(p.comarca)
       and public.place_key(claimant.city) = public.place_key(p.comarca)
       and public.district_key(a.district) = public.district_key(claimant.district)
       and public.district_key(claimant.district) <> ''
     having count(distinct a.forum) = 1)
  )
  from public.proceedings p
  left join lateral (
    select pe.district, pe.city
    from public.proceeding_parties pp
    join public.case_parties cp on cp.id = pp.party_id and cp.role = 'claimant'
    join public.people pe on pe.id = cp.person_id
    where pp.proceeding_id = p.id
    order by cp.created_at, cp.id
    limit 1
  ) as claimant on true
  where p.id = target_proceeding;
$$;

revoke all on function public.proceeding_place(uuid) from public, anon, authenticated;

-- ---------- 5. The forecast, by the place and the kind ----------

/**
 * The market's forecast of a problem (internal): the cut nearest the case with at least 30 decisions on the merits,
 * else the broadest with the setting's sample, else null. The cuts, nearest first: the judge, the unit, the place
 * inside the comarca, the comarca, the court and every court, each with the airline and then without; a cut needs
 * what it names. The lawsuit's kind is in every cut. `only_level` takes one cut alone (1 to 12, null under the
 * sample); `with_values` adds the moral damages set, in order, to place an offer among them. First instance, the
 * setting's months.
 */
create or replace function public.market_forecast_of(
  target_problem text,
  target_airline text,
  target_court text,
  target_comarca text,
  target_place text,
  target_unit text,
  target_judge text,
  target_kind text,
  only_level integer default null,
  with_values boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  months integer := public.jurimetry_setting('months', 24);
  least_sample integer := public.jurimetry_setting('min_sample', 5);
  since date := (current_date - make_interval(months => months))::date;
  v_court text := nullif(upper(btrim(coalesce(target_court, ''))), '');
  v_airline text := nullif(upper(btrim(coalesce(target_airline, ''))), '');
  v_comarca text := nullif(public.place_key(target_comarca), '');
  v_place text := nullif(public.market_place_key(target_place), '');
  v_unit text := nullif(public.plain_name(target_unit), '');
  v_judge text := nullif(public.plain_name(target_judge), '');
  v_kind text := case when target_kind in ('juizado', 'comum') then target_kind end;
  cut record;
  merits integer;
  c_n integer;
  c_level text;
  c_judge boolean;
  c_unit boolean;
  c_place boolean;
  c_comarca boolean;
  c_court boolean;
  c_airline boolean;
  f_n integer;
  f_level text;
  f_judge boolean;
  f_unit boolean;
  f_place boolean;
  f_comarca boolean;
  f_court boolean;
  f_airline boolean;
  ids uuid[];
  result jsonb;
begin
  if nullif(btrim(coalesce(target_problem, '')), '') is null then
    return null;
  end if;
  for cut in
    select v.n, v.level, v.by_judge, v.by_unit, v.by_place, v.by_comarca, v.by_court, v.by_airline from (values
      (1, 'judge', true, false, false, false, true, true),
      (2, 'judge', true, false, false, false, true, false),
      (3, 'unit', false, true, false, false, true, true),
      (4, 'unit', false, true, false, false, true, false),
      (5, 'place', false, false, true, true, true, true),
      (6, 'place', false, false, true, true, true, false),
      (7, 'comarca', false, false, false, true, true, true),
      (8, 'comarca', false, false, false, true, true, false),
      (9, 'court', false, false, false, false, true, true),
      (10, 'court', false, false, false, false, true, false),
      (11, 'all', false, false, false, false, false, true),
      (12, 'all', false, false, false, false, false, false)
    ) as v (n, level, by_judge, by_unit, by_place, by_comarca, by_court, by_airline)
    where (not v.by_judge or v_judge is not null) and (not v.by_unit or v_unit is not null)
      and (not v.by_place or v_place is not null)
      and (not v.by_comarca or v_comarca is not null) and (not v.by_court or v_court is not null)
      and (not v.by_airline or v_airline is not null)
      and (only_level is null or v.n = only_level)
    order by v.n
  loop
    select count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente')) into merits
    from public.market_decisions d
    where d.instance = 'first' and d.day >= since and d.problem = target_problem
      and (v_kind is null or d.kind = v_kind)
      and (not cut.by_court or d.court = v_court)
      and (not cut.by_judge or public.plain_name(d.judge) = v_judge)
      and (not cut.by_unit or public.plain_name(d.unit) = v_unit)
      and (not cut.by_place or public.market_place_key(d.place) = v_place)
      and (not cut.by_comarca or public.place_key(d.comarca) = v_comarca)
      and (not cut.by_airline or d.airline_iata = v_airline);
    if merits >= 30 and c_n is null then
      c_n := cut.n; c_level := cut.level; c_judge := cut.by_judge; c_unit := cut.by_unit; c_place := cut.by_place;
      c_comarca := cut.by_comarca; c_court := cut.by_court; c_airline := cut.by_airline;
    end if;
    if merits >= least_sample then
      f_n := cut.n; f_level := cut.level; f_judge := cut.by_judge; f_unit := cut.by_unit; f_place := cut.by_place;
      f_comarca := cut.by_comarca; f_court := cut.by_court; f_airline := cut.by_airline;
    end if;
  end loop;
  if c_n is null then
    c_n := f_n; c_level := f_level; c_judge := f_judge; c_unit := f_unit; c_place := f_place;
    c_comarca := f_comarca; c_court := f_court; c_airline := f_airline;
  end if;
  if c_n is null then
    return null;
  end if;

  select coalesce(array_agg(d.id), '{}') into ids
  from public.market_decisions d
  where d.instance = 'first' and d.day >= since and d.problem = target_problem
    and (v_kind is null or d.kind = v_kind)
    and (not c_court or d.court = v_court)
    and (not c_judge or public.plain_name(d.judge) = v_judge)
    and (not c_unit or public.plain_name(d.unit) = v_unit)
    and (not c_place or public.market_place_key(d.place) = v_place)
    and (not c_comarca or public.place_key(d.comarca) = v_comarca)
    and (not c_airline or d.airline_iata = v_airline);

  select jsonb_build_object(
    'cut', jsonb_build_object(
      'level', c_level, 'n', c_n,
      'court', case when c_court then v_court end,
      'comarca', case when c_comarca then target_comarca end,
      'place', case when c_place then target_place end,
      'unit', case when c_unit then target_unit end,
      'judge', case when c_judge then target_judge end,
      'airline', case when c_airline then v_airline end,
      'kind', v_kind,
      'problem', target_problem),
    'decisions', count(*),
    'merits', count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente')),
    'won', count(*) filter (where d.result in ('procedente', 'parcial')),
    'chance_percent', case when count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente')) >= least_sample
      then round(100.0 * count(*) filter (where d.result in ('procedente', 'parcial'))
                 / count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente'))) end,
    'outcomes', jsonb_build_object(
      'procedente', count(*) filter (where d.result = 'procedente'),
      'parcial', count(*) filter (where d.result = 'parcial'),
      'improcedente', count(*) filter (where d.result = 'improcedente'),
      'acordo', count(*) filter (where d.result = 'acordo'),
      'extinto', count(*) filter (where d.result = 'extinto')),
    'base', case
      when count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente')) < 30 then 'pequena'
      when count(*) filter (where d.result in ('procedente', 'parcial', 'improcedente')) < 100 then 'media'
      else 'solida' end,
    'from', min(d.day), 'to', max(d.day), 'min_sample', least_sample,
    -- The courts the decisions come from, so a forecast of every court still says where it was read.
    'courts', coalesce(jsonb_agg(distinct d.court), '[]'::jsonb)
  ) into result
  from public.market_decisions d
  where d.id = any (ids);

  return result || jsonb_build_object(
    'moral', (
      select jsonb_build_object(
        'n', count(*),
        'p25_cents', case when count(*) >= least_sample then (percentile_cont(0.25) within group (order by m.moral_cents))::bigint end,
        'median_cents', case when count(*) >= least_sample then (percentile_cont(0.5) within group (order by m.moral_cents))::bigint end,
        'p75_cents', case when count(*) >= least_sample then (percentile_cont(0.75) within group (order by m.moral_cents))::bigint end)
        || case when with_values then jsonb_build_object('values', case when count(*) >= least_sample
             then (select jsonb_agg(v order by v) from unnest(array_agg(m.moral_cents)) v) end) else '{}'::jsonb end
      from public.market_decisions m
      where m.id = any (ids) and m.moral_cents is not null and not m.per_claimant
    ),
    'extinctions', coalesce((
      select jsonb_object_agg(e.reason, e.n)
      from (
        select coalesce(m.extinction_reason, 'outro') as reason, count(*) as n
        from public.market_decisions m where m.id = any (ids) and m.result = 'extinto'
        group by 1
      ) e
    ), '{}'::jsonb),
    'months', coalesce((
      select jsonb_agg(jsonb_build_object('month', t.month, 'merits', t.merits, 'won', t.won) order by t.month)
      from (
        select to_char(date_trunc('month', m.day), 'YYYY-MM') as month,
               count(*) filter (where m.result in ('procedente', 'parcial', 'improcedente')) as merits,
               count(*) filter (where m.result in ('procedente', 'parcial')) as won
        from public.market_decisions m where m.id = any (ids)
        group by 1
      ) t
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.market_forecast_of(text, text, text, text, text, text, text, text, integer, boolean)
  from public, anon, authenticated;

drop function public.market_forecast_of(text, text, text, text, text, text, integer, boolean);

/**
 * The market's forecast of a problem (0249, the intake's answers), through the one rule: its signature, its keys and
 * its grant kept; a unit named gives its comarca and place as its court writes them, and no kind is cut.
 */
create or replace function public.market_forecast(
  target_problem text,
  target_airline text default null,
  target_court text default null,
  target_unit text default null,
  target_judge text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return public.market_forecast_of(target_problem, target_airline, target_court,
    public.market_comarca_of(target_unit, target_court), public.market_place_of(target_unit, target_court),
    target_unit, target_judge, null);
end;
$$;

revoke all on function public.market_forecast(text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.market_forecast(text, text, text, text, text) to service_role;

/**
 * A lawsuit's forecast (internal): the case's problem and airline; the lawsuit's kind, court, comarca, place inside
 * it, unit and judge (the unit and the judge only once distributed); its claimants; the forecast with the values set;
 * each level beside it, with the airline when it has the sample and the one used as it was used; what the claimants
 * may expect; and what the airline does at the nearest place with the sample (settlements and extinctions, every
 * problem, the lawsuit's kind).
 */
create or replace function public.proceeding_forecast(target_proceeding uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  claim public.cases%rowtype;
  problem text;
  judge text;
  place_unit text;
  place_comarca text;
  place_name text;
  claimants integer;
  forecast jsonb;
  months integer := public.jurimetry_setting('months', 24);
  least_sample integer := public.jurimetry_setting('min_sample', 5);
  since date;
  hearing jsonb;
  level_rows jsonb;
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return null;
  end if;
  select * into claim from public.cases where id = lawsuit.case_id;
  problem := public.market_problem_of(claim.incident);
  -- The unit and the judge only of a lawsuit already distributed (a lawsuit planned carries the unit its forum
  -- foresees, never the one the lottery gives): never to choose one. The place inside the comarca is the law's.
  place_unit := case when lawsuit.status <> 'planned' then lawsuit.unit end;
  place_comarca := coalesce(nullif(btrim(lawsuit.comarca), ''), public.market_comarca_of(place_unit, lawsuit.court));
  place_name := public.proceeding_place(lawsuit.id);
  judge := case when lawsuit.status <> 'planned' then public.proceeding_judge(lawsuit.id) end;
  select count(*) into claimants
  from public.proceeding_parties pp join public.case_parties cp on cp.id = pp.party_id
  where pp.proceeding_id = lawsuit.id and cp.role = 'claimant';
  forecast := public.market_forecast_of(problem, claim.airline_iata, lawsuit.court,
    place_comarca, place_name, place_unit, judge, lawsuit.kind, null, true);

  -- Each level beside the chosen one: the judge, the unit, the place, the comarca and the court, each with the
  -- airline when it has the sample, else without; the level used as it was used, every court only when used.
  select coalesce(jsonb_agg(x.row order by x.n), '[]'::jsonb) into level_rows
  from (
    select l.n, jsonb_build_object('level', f -> 'cut' ->> 'level', 'cut', f -> 'cut', 'merits', f -> 'merits',
      'won', f -> 'won', 'chance_percent', f -> 'chance_percent', 'median_cents', f -> 'moral' -> 'median_cents') as row
    from (values (1, 'judge'), (3, 'unit'), (5, 'place'), (7, 'comarca'), (9, 'court'), (11, 'all')) as l (n, level)
    cross join lateral (
      select case
        when forecast -> 'cut' ->> 'level' = l.level then forecast
        when l.level = 'all' then null
        else coalesce(
          public.market_forecast_of(problem, claim.airline_iata, lawsuit.court,
            place_comarca, place_name, place_unit, judge, lawsuit.kind, l.n),
          public.market_forecast_of(problem, claim.airline_iata, lawsuit.court,
            place_comarca, place_name, place_unit, judge, lawsuit.kind, l.n + 1))
      end as f
    ) g
    where g.f is not null
  ) x;

  -- What the airline does at the nearest place with the sample: settlements and extinctions, every problem.
  since := (current_date - make_interval(months => months))::date;
  select jsonb_build_object('level', h.level, 'decisions', h.decisions, 'acordo', h.acordo, 'extinto', h.extinto)
  into hearing
  from (
    select s.level, count(*) as decisions,
           count(*) filter (where d.result = 'acordo') as acordo,
           count(*) filter (where d.result = 'extinto') as extinto,
           s.n
    from (values
      (1, 'unit'),
      (2, 'place'),
      (3, 'comarca'),
      (4, 'court')
    ) as s (n, level)
    join public.market_decisions d
      on d.instance = 'first' and d.day >= since and d.court = upper(coalesce(lawsuit.court, ''))
     and (lawsuit.kind is null or d.kind = lawsuit.kind)
     and (claim.airline_iata is null or d.airline_iata = claim.airline_iata)
     and (s.level <> 'unit' or (place_unit is not null and public.plain_name(d.unit) = public.plain_name(place_unit)))
     and (s.level <> 'place' or (place_name is not null
          and public.market_place_key(d.place) = public.market_place_key(place_name)))
     and (s.level <> 'comarca' or (place_comarca is not null
          and public.place_key(d.comarca) = public.place_key(place_comarca)))
    group by s.n, s.level
    having count(*) >= least_sample
    order by s.n
    limit 1
  ) h;
  if hearing is not null then
    hearing := hearing || jsonb_build_object('reasons', coalesce((
      select jsonb_object_agg(r.reason, r.n) from (
        select coalesce(d.extinction_reason, 'outro') as reason, count(*) as n
        from public.market_decisions d
        where d.instance = 'first' and d.day >= since and d.court = upper(coalesce(lawsuit.court, ''))
          and d.result = 'extinto'
          and (lawsuit.kind is null or d.kind = lawsuit.kind)
          and (claim.airline_iata is null or d.airline_iata = claim.airline_iata)
          and (hearing ->> 'level' <> 'unit' or public.plain_name(d.unit) = public.plain_name(place_unit))
          and (hearing ->> 'level' <> 'place' or public.market_place_key(d.place) = public.market_place_key(place_name))
          and (hearing ->> 'level' <> 'comarca' or public.place_key(d.comarca) = public.place_key(place_comarca))
        group by 1
      ) r
    ), '{}'::jsonb));
  end if;

  return jsonb_build_object(
    'proceeding', lawsuit.id,
    'case', claim.id,
    'stage', case when lawsuit.status = 'planned' then 'before' else 'distributed' end,
    'problem', problem,
    'airline', claim.airline_iata,
    'kind', lawsuit.kind,
    'court', lawsuit.court,
    'comarca', place_comarca,
    'place', place_name,
    'unit', place_unit,
    'judge', judge,
    'claimants', claimants,
    'forecast', forecast,
    'expected_cents', public.market_expected_cents((forecast ->> 'chance_percent')::integer,
      (forecast -> 'moral' ->> 'median_cents')::bigint, claimants),
    'levels', level_rows,
    'hearing', hearing,
    'rule', public.jurimetry_rule()
  );
end;
$$;

revoke all on function public.proceeding_forecast(uuid) from public, anon, authenticated;

-- The comarca read by the TJGO's form alone is gone with its last caller.
drop function public.market_comarca_of(text);

-- Each open lawsuit's forecast is read again by the next sweep, the one it had when distributed kept.
update public.case_forecasts set refreshed_at = now() - interval '21 hours'
where refreshed_at > now() - interval '21 hours';
