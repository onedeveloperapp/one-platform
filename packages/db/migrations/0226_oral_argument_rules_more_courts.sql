-- ============================================================
-- 0226 · As regras de sustentação oral do TJSP, do TJRJ e do TJMG.
--
-- 0219 kept the TJGO's rule of registration for oral argument as data. The
-- user asked on 2026-11-12 for the courts with most passengers' lawsuits,
-- read in their own acts that day. Two limits the TJGO does not use:
--
--   hours_before            some hours before the session starts, or before
--                           its day starts: the 48 hours of the CNJ's
--                           virtual sessions (Resolução CNJ nº 591/2024,
--                           arts. 8º, II, and 9º), the 24 of a presencial
--                           session of the TJSP and of a hybrid one of the
--                           TJMG;
--   days_after_publication  some days counted as a term from the
--                           publication of the pauta (the turmas recursais
--                           of the TJMG: 5 business days).
--
-- Seeded only what each court's own act says: the TJSP's chambers and
-- Colégio Recursal, the TJRJ's chambers, the TJMG's chambers and its turmas
-- recursais in a virtual session. The TJRJ's turmas recursais (whose acts
-- could not be read) and a presencial session of the TJMG's turmas (no
-- written term) have no rule: ONE says so on the case. Where a court allows a
-- later registration in person, the basis says it, and the limit is the
-- earlier one. The backend counts with `sustentacao-v2`, the pauta's day of
-- availability given for a count from its publication (`sessions_to_count`,
-- redefined from 0219).
-- ============================================================

alter table public.oral_argument_rules
  add column until_hours integer,
  add column until_anchor text,
  add column until_days integer,
  add column until_counting text;

alter table public.oral_argument_rules drop constraint oral_argument_rules_until_check;
alter table public.oral_argument_rules add constraint oral_argument_rules_until_check check (
  (until_kind = 'previous_business_day' and until_hour is not null
     and until_hours is null and until_anchor is null and until_days is null and until_counting is null)
  or (until_kind = 'session_start' and until_hour is null
     and until_hours is null and until_anchor is null and until_days is null and until_counting is null)
  or (until_kind = 'hours_before' and until_hour is null
     and until_hours is not null and until_hours between 1 and 240
     and until_anchor is not null and until_anchor in ('session', 'day')
     and until_days is null and until_counting is null)
  or (until_kind = 'days_after_publication' and until_hour is null
     and until_hours is null and until_anchor is null
     and until_days is not null and until_days between 1 and 60
     and until_counting is not null and until_counting in ('business', 'calendar'))
);

insert into public.oral_argument_rules
  (court, body, session_kind, until_kind, until_hour, until_hours, until_anchor, until_days, until_counting, basis)
values
  ('TJSP', 'tribunal', 'virtual', 'hours_before', null, 48, 'session', null, null,
   'Resolução nº 984/2025 do Órgão Especial do TJSP, arts. 11, II, e 12: destaque ou sustentação gravada até 48 horas antes do início'),
  ('TJSP', 'tribunal', 'presencial', 'hours_before', null, 24, 'session', null, null,
   'Regimento Interno do TJSP, art. 146, II: inscrição prévia 24 horas antes; depois, só no local, até o início da sessão'),
  ('TJSP', 'turma_recursal', 'virtual', 'hours_before', null, 48, 'session', null, null,
   'Resolução nº 984/2025 do TJSP, arts. 11, II, e 12, no Colégio Recursal pelo Comunicado nº 594/2025: até 48 horas antes do início'),
  ('TJSP', 'turma_recursal', 'presencial', 'previous_business_day', '18:00', null, null, null, null,
   'Normas da Corregedoria Geral da Justiça de SP, Tomo I, art. 714, § 1º: inscrição até as 18h do dia útil anterior; sem ela, até o início da sessão'),
  ('TJRJ', 'tribunal', 'virtual', 'hours_before', null, 48, 'session', null, null,
   'Regimento Interno do TJRJ, arts. 97, II, e 98-A (Resolução TJ/OE nº 38/2025): destaque ou sustentação gravada até 48 horas antes'),
  ('TJRJ', 'tribunal', 'presencial', 'hours_before', null, 48, 'day', null, null,
   'Regimento Interno do TJRJ, art. 108: por videoconferência, inscrição até 48 horas antes do dia da sessão; presencialmente, até o início'),
  ('TJMG', 'tribunal', 'virtual', 'hours_before', null, 48, 'session', null, null,
   'Resolução CNJ nº 591/2024, arts. 8º, II, e 9º, aplicada pelo Aviso Conjunto nº 160/PR/2025 do TJMG: até 48 horas antes do início'),
  ('TJMG', 'tribunal', 'presencial', 'hours_before', null, 24, 'session', null, null,
   'Portaria Conjunta nº 1.521/PR/2024 do TJMG, arts. 3º e 5º: sessão híbrida, 24 horas antes; presencialmente, até o início (Regimento, art. 104)'),
  ('TJMG', 'turma_recursal', 'virtual', 'days_after_publication', null, null, null, 5, 'business',
   'Código de Normas dos Juizados Especiais do TJMG (Portaria Conjunta nº 1.103/PR/2020), art. 176, § 1º: 5 dias da intimação da pauta')
on conflict (court, body, session_kind) do nothing;

-- A session of these courts counted before with no rule is counted again.
update public.judgment_sessions set limit_revision = null
where status = 'scheduled' and limit_error = 'no_rule';

/**
 * The sessions whose limit to register is to be counted (0219, redefined): with each kind of limit's own numbers and
 * the day the pauta was made available (0226). Service role.
 */
drop function public.sessions_to_count(integer);
create function public.sessions_to_count(target_limit integer default 20)
returns table (
  session_id uuid,
  revision integer,
  kind text,
  starts_on date,
  starts_at time,
  court text,
  proceeding_kind text,
  system text,
  comarca text,
  until_kind text,
  until_hour time,
  basis text,
  until_hours integer,
  until_anchor text,
  until_days integer,
  until_counting text,
  published_on date
)
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
  select s.id, s.revision, s.kind, s.starts_on, s.starts_at, p.court, p.kind, p.system, p.comarca,
         r.until_kind, r.until_hour, r.basis, r.until_hours, r.until_anchor, r.until_days, r.until_counting,
         pub.available_on
  from public.judgment_sessions s
  join public.proceedings p on p.id = s.proceeding_id
  left join public.publications pub on pub.id = s.publication_id
  left join public.oral_argument_rules r
    on r.court = p.court and r.session_kind = s.kind
   and r.body = case p.kind when 'juizado' then 'turma_recursal' else 'tribunal' end
  where s.status = 'scheduled' and s.limit_revision is distinct from s.revision
    and s.starts_on >= (now() at time zone 'America/Sao_Paulo')::date - 1
  order by s.starts_on, s.id
  limit greatest(least(coalesce(target_limit, 20), 100), 1);
end;
$$;

revoke all on function public.sessions_to_count(integer) from public, anon, authenticated;
grant execute on function public.sessions_to_count(integer) to service_role;
