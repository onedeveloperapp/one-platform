-- 0066_court_system_by_one.sql
-- ============================================================
-- The court system of a lawsuit is ONE's to name, and the firm's to approve or not.
--
-- The owner, on 2026-10-27: choosing the court's system on a lawsuit is no task a firm can take on; ONE names it,
-- the firm only approves it or not, and the approval is the firm's decision, said as such; and whatever ONE
-- generates, the lawsuits included, says that ONE may have erred. Until now ONE named a lawsuit's system only
-- when the platform had confirmed its court's row of `court_systems` (0039), no row was confirmed, and the firm
-- was asked to pick a system from a list (0022), the table's guess beside it. So:
--
--   * a planned lawsuit with its court and kind has the system the platform's table gives for them, confirmed or
--     not, as ONE's (`proceedings.system_by_one`), whoever wrote the lawsuit and whatever system was sent; with no
--     row for its court and kind it has none, and waits for the platform (`system_unknown`, 0039); a lawsuit the
--     court has (filed or closed) keeps the system it has;
--   * a partner, a lawyer or the controladoria approves it (`decide_court_system`), on the record as their
--     decision (`system_approved_by`, `system_approved_at`), or does not, saying why (`system_refused_*`), which
--     the platform reads to check the court's acts (`admin_court_system_refusals`); never ONE, never a support
--     visit;
--   * a filing package waits for that approval (`filing_blocker`: `system_unapproved`, `system_refused`), and a
--     package in course is given up when the system it was built for is refused or changes (ONE asks for it
--     again once the new system is approved);
--   * when the platform adds, changes or confirms a row, the planned lawsuits of that court and kind have it again:
--     an approval stays only for the same system, and a refusal counts as answered, so the firm is asked again;
--   * a lawsuit ONE created is marked so (`proceedings.created_by_one`), for the screens to say ONE may have erred.
--
-- The systems a person had chosen for lawsuits still planned are the firm's decision already: they are kept, and
-- recorded as approved (by nobody named: who chose them was not kept). The planned lawsuits with no system have
-- ONE's now, and the lawsuits ONE created are found by the first word their timeline has of them.
-- ============================================================

-- ---------- What the lawsuit keeps of its system ----------

alter table public.proceedings add column system_by_one boolean not null default false;
alter table public.proceedings add column system_approved_by uuid references public.profiles (id) on delete set null;
alter table public.proceedings add column system_approved_at timestamptz;
alter table public.proceedings add column system_refused_by uuid references public.profiles (id) on delete set null;
alter table public.proceedings add column system_refused_at timestamptz;
alter table public.proceedings add column system_refused_reason text;
alter table public.proceedings add column created_by_one boolean not null default false;
alter table public.proceedings add constraint proceedings_system_decision_check check (
  not (system_approved_at is not null and system_refused_at is not null)
  and (system_refused_at is null) = (system_refused_reason is null)
  and (system_refused_reason is null
       or (char_length(system_refused_reason) between 8 and 500 and system_refused_reason !~ '[[:cntrl:]]'))
);

-- ---------- ONE names it ----------

/**
 * The system of a planned lawsuit is the one the platform's table gives for its court and kind, named by ONE
 * whoever wrote the lawsuit and whatever system was sent: none when the table has no row for them. What was
 * decided of another system, court or kind is no decision of this one. A lawsuit the court has keeps its system.
 * A lawsuit written by ONE itself (`case_system_writer`) is marked as created by ONE.
 */
create or replace function public.proceedings_court_system()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  named text;
begin
  if tg_op = 'INSERT' then
    new.created_by_one := public.case_system_writer(new.case_id);
  end if;
  if new.status <> 'planned' then
    return new;
  end if;
  select cs.system into named from public.court_systems cs
  where cs.court = new.court and cs.proceeding_kind = new.kind;
  new.system := named;
  new.system_by_one := named is not null;
  if tg_op = 'INSERT'
     or new.system is distinct from old.system
     or new.court is distinct from old.court
     or new.kind is distinct from old.kind then
    new.system_approved_by := null;
    new.system_approved_at := null;
    new.system_refused_by := null;
    new.system_refused_at := null;
    new.system_refused_reason := null;
  end if;
  return new;
end;
$$;

revoke all on function public.proceedings_court_system() from public, anon, authenticated;

create trigger proceedings_court_system before insert or update of court, kind, status, system on public.proceedings
  for each row execute function public.proceedings_court_system();

/** A lawsuit's packages in course, given up: they were built for another system, or for one the firm refused. */
create or replace function public.give_up_lawsuit_packages(target_proceeding uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  closed uuid;
  given integer := 0;
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return 0;
  end if;
  for closed in
    update public.filing_packages set status = 'cancelled', claimed_at = null
    where proceeding_id = target_proceeding and status in ('requested', 'ready', 'failed')
    returning id
  loop
    perform public.drop_filing_package_files(closed);
    perform public.record_case_event(lawsuit.org_id, lawsuit.case_id, 'filing_package_cancelled', 'system',
      jsonb_build_object('package', closed, 'proceeding', lawsuit.id));
    given := given + 1;
  end loop;
  return given;
end;
$$;

revoke all on function public.give_up_lawsuit_packages(uuid) from public, anon, authenticated;

/** A planned lawsuit whose system changed: what was built for the one before goes, and the timeline says it. */
create or replace function public.proceedings_system_changed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'planned' and old.system is distinct from new.system then
    perform public.give_up_lawsuit_packages(new.id);
    if old.system is not null then
      perform public.record_case_event(new.org_id, new.case_id, 'court_system_changed', 'system',
        jsonb_strip_nulls(jsonb_build_object('proceeding', new.id, 'from', old.system, 'to', new.system)));
    end if;
  end if;
  return null;
end;
$$;

revoke all on function public.proceedings_system_changed() from public, anon, authenticated;

create trigger proceedings_system_changed after update of system on public.proceedings
  for each row execute function public.proceedings_system_changed();

/**
 * The platform added, changed or confirmed a court's system: the planned lawsuits of that court and kind have it
 * again (an approval stays only for the same system, `proceedings_court_system`), what the firm refused counts as
 * answered, so the firm is asked again, and their cases are looked at again.
 */
create or replace function public.court_systems_repropose()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  touched uuid;
begin
  for touched in
    with updated as (
      update public.proceedings p
      set system = new.system,
          system_refused_by = null, system_refused_at = null, system_refused_reason = null
      where p.court = new.court and p.kind = new.proceeding_kind and p.status = 'planned'
      returning p.case_id
    )
    select distinct u.case_id from updated u order by u.case_id
  loop
    perform public.wake_case_advance(touched);
  end loop;
  return null;
end;
$$;

revoke all on function public.court_systems_repropose() from public, anon, authenticated;

create trigger court_systems_repropose after insert or update of system, confirmed on public.court_systems
  for each row execute function public.court_systems_repropose();

-- ---------- The firm approves it or not ----------

/**
 * A partner, a lawyer or the controladoria approves the system ONE named for a planned lawsuit, as the firm's
 * decision on the record, or does not, saying why (8 to 500 characters): the platform reads it to check the
 * court's acts, and the lawsuit's package waits; what was built of it goes. Never ONE, never a support visit
 * (`case_for_writer`). The case is looked at again, so ONE asks for the package once the system is approved.
 */
create or replace function public.decide_court_system(
  target_proceeding uuid,
  target_approve boolean,
  target_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  reason text := nullif(regexp_replace(btrim(coalesce(target_reason, '')), '\s+', ' ', 'g'), '');
begin
  select * into lawsuit from public.proceedings where id = target_proceeding;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'proceeding_not_found');
  end if;
  current_case := public.case_for_writer(lawsuit.case_id);
  if public.case_system_writer(current_case.id)
     or not public.has_firm_function(current_case.org_id, array['socio', 'advogado', 'controladoria']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  select * into lawsuit from public.proceedings where id = target_proceeding for update;
  if lawsuit.status <> 'planned' then
    return jsonb_build_object('ok', false, 'code', 'proceeding_not_planned');
  end if;
  if lawsuit.system is null then
    return jsonb_build_object('ok', false, 'code', 'system_unknown');
  end if;

  if coalesce(target_approve, false) then
    if lawsuit.system_approved_at is not null then
      return jsonb_build_object('ok', true, 'code', 'unchanged');
    end if;
    update public.proceedings
    set system_approved_by = auth.uid(), system_approved_at = now(),
        system_refused_by = null, system_refused_at = null, system_refused_reason = null
    where id = lawsuit.id;
    perform public.record_case_event(current_case.org_id, current_case.id, 'court_system_approved', 'person',
      jsonb_build_object('proceeding', lawsuit.id, 'system', lawsuit.system));
  else
    if reason is null or char_length(reason) not between 8 and 500 or reason ~ '[[:cntrl:]]' then
      return jsonb_build_object('ok', false, 'code', 'reason_required', 'field', 'reason');
    end if;
    update public.proceedings
    set system_refused_by = auth.uid(), system_refused_at = now(), system_refused_reason = reason,
        system_approved_by = null, system_approved_at = null
    where id = lawsuit.id;
    perform public.give_up_lawsuit_packages(lawsuit.id);
    perform public.record_case_event(current_case.org_id, current_case.id, 'court_system_refused', 'person',
      jsonb_build_object('proceeding', lawsuit.id, 'system', lawsuit.system));
  end if;
  perform public.wake_case_advance(current_case.id);
  return jsonb_build_object('ok', true, 'code', case when coalesce(target_approve, false) then 'approved' else 'refused' end);
end;
$$;

revoke all on function public.decide_court_system(uuid, boolean, text) from public, anon;
grant execute on function public.decide_court_system(uuid, boolean, text) to authenticated;

/**
 * What the firms did not approve of the systems the platform's table gives, by court and kind, for the operator to
 * check in the court's acts: the system, whether it is confirmed, how many planned lawsuits refused it and how many
 * still wait for a firm's word, and the last reasons given (never which firm or whose case). Operator only.
 */
create or replace function public.admin_court_system_refusals()
returns table (
  court text,
  proceeding_kind text,
  system text,
  confirmed boolean,
  refused integer,
  waiting integer,
  last_refused_at timestamptz,
  reasons text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_superadmin() or public.is_impersonated() then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  return query
  select cs.court, cs.proceeding_kind, cs.system, cs.confirmed,
         (count(*) filter (where p.system_refused_at is not null))::integer,
         (count(*) filter (where p.system_refused_at is null and p.system_approved_at is null))::integer,
         max(p.system_refused_at),
         (array_agg(p.system_refused_reason order by p.system_refused_at desc)
            filter (where p.system_refused_at is not null))[1:5]
  from public.court_systems cs
  join public.proceedings p on p.court = cs.court and p.kind = cs.proceeding_kind and p.status = 'planned'
  group by cs.court, cs.proceeding_kind, cs.system, cs.confirmed
  having count(*) filter (where p.system_refused_at is not null) > 0
  order by max(p.system_refused_at) desc;
end;
$$;

revoke all on function public.admin_court_system_refusals() from public, anon;
grant execute on function public.admin_court_system_refusals() to authenticated;

-- ---------- A filing waits for the firm's approval ----------

/**
 * What keeps a lawsuit from being filed (0054, redefined): as before, and first a planned lawsuit whose system the
 * firm refused (`system_refused`, it waits for the platform) or has not approved yet (`system_unapproved`).
 */
create or replace function public.filing_blocker(target_proceeding uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p.status = 'planned' and p.system is not null and p.system_refused_at is not null then 'system_refused'
    when p.status = 'planned' and p.system is not null and p.system_approved_at is null then 'system_unapproved'
    when p.kind = 'juizado' and c.family_choice = 'together' and public.case_has_minor_claimant(c.id)
      then 'family_split_unchosen'
    when p.kind = 'comum' and exists (
      select 1 from public.proceeding_parties pp
      where pp.proceeding_id = p.id
        and coalesce((public.civil_court_answer_in_force(pp.party_id)).accepted, false) is not true
    ) then 'civil_court_unanswered'
    -- A power of attorney ONE sent a person of the lawsuit to sign, and nobody of the firm has confirmed signed yet:
    -- a filing without it would go without the mandate (0054).
    when exists (
      select 1 from public.case_papers paper
      join public.signature_envelopes e on e.id = paper.envelope_id
      where paper.case_id = c.id and paper.kind = 'procuracao'
        and e.status in ('reserved', 'opening', 'pending', 'received', 'uncertain')
        and paper.person_id in (
          select cp.person_id from public.proceeding_parties pp
          join public.case_parties cp on cp.id = pp.party_id
          where pp.proceeding_id = p.id
          union
          select g.person_id from public.proceeding_parties pp
          join public.case_parties cp on cp.id = pp.party_id
          join public.case_parties g on g.id = cp.guardian_id
          where pp.proceeding_id = p.id
        )
    ) then 'power_of_attorney_unsigned'
  end
  from public.proceedings p
  join public.cases c on c.id = p.case_id
  where p.id = target_proceeding;
$$;

revoke all on function public.filing_blocker(uuid) from public, anon, authenticated;

-- ---------- What there was ----------

-- The lawsuits ONE created: the first word their timeline has of each is ONE's.
update public.proceedings p set created_by_one = true
where (
  select e.actor_type from public.case_events e
  where e.case_id = p.case_id and e.kind = 'proceeding_saved' and e.data ->> 'proceeding' = p.id::text
  order by e.at, e.id
  limit 1
) = 'system';

-- A system a person chose for a lawsuit still planned is the firm's decision already.
update public.proceedings set system_approved_at = updated_at where status = 'planned' and system is not null;

-- A planned lawsuit with no system has ONE's now (`proceedings_court_system`).
update public.proceedings set system = null where status = 'planned' and system is null;
