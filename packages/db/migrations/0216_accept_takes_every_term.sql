-- ============================================================
-- 0216 · Accepting a judgment takes back every term ONE proposed of it.
--
-- From the review of 2026-11-11. Accepting a judgment took back the terms of
-- the embargos and of the appeal ONE proposed from the judgment's own
-- publication (0185). Since 0213 ONE also proposes them from the day of a
-- judgment given at the hearing (Lei 9.099/1995, art. 19, § 1º; CPC, art.
-- 1.003, § 1º) and proposes the appeal again from the decision of the
-- embargos (art. 50; CPC, art. 1.026): accepting the judgment now takes
-- those back too, with the same reason, while what a person wrote or
-- confirmed stays theirs.
-- ============================================================

/**
 * A partner or a lawyer decides what follows a judgment, with the second factor (0185): accepting it takes back the
 * deadlines of the embargos and of the appeal ONE proposed of it and nobody confirmed, from its publication, from the
 * day it was given at a hearing, or from the decision of its embargos (0216); an appeal keeps them. Never a support
 * visit; on the record and in the case's timeline.
 */
create or replace function public.decide_judgment_path(target_path uuid, target_decision text, target_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  path public.judgment_paths%rowtype;
  fact public.lawsuit_facts%rowtype;
  lawsuit public.proceedings%rowtype;
  current_case public.cases%rowtype;
  reason text := nullif(btrim(regexp_replace(coalesce(target_reason, ''), '\s+', ' ', 'g')), '');
  taken record;
begin
  select * into path from public.judgment_paths where id = target_path;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  current_case := public.case_for_writer(path.case_id);
  if not public.has_firm_function(current_case.org_id, array['socio', 'advogado']::public.firm_function[]) then
    return jsonb_build_object('ok', false, 'code', 'not_allowed');
  end if;
  if not public.is_aal2() then
    return jsonb_build_object('ok', false, 'code', 'second_factor');
  end if;
  select * into lawsuit from public.proceedings where id = path.proceeding_id;
  if target_decision is null or not (target_decision = any (public.judgment_path_options(lawsuit.kind))) then
    return jsonb_build_object('ok', false, 'code', 'invalid_decision');
  end if;
  if reason is not null and char_length(reason) not between 8 and 500 then
    return jsonb_build_object('ok', false, 'code', 'reason');
  end if;
  select * into fact from public.lawsuit_facts where id = path.fact_id;
  update public.judgment_paths
  set decision = target_decision, decision_reason = reason, decided_by = auth.uid(), decided_at = now()
  where id = path.id;
  if target_decision = 'aceitar' then
    for taken in
      select d.id from public.deadlines d
      where d.proceeding_id = path.proceeding_id and d.act = any (public.judgment_deadline_acts())
        and d.proposed_auto and d.created_by is null
        and (d.status = 'proposed' or (d.status = 'confirmed' and d.confirmed_auto))
        and (
          -- Of the judgment's own publication.
          (fact.publication_id is not null and d.publication_id = fact.publication_id)
          -- Of the judgment given at a hearing, counted from its day (0213).
          or (d.publication_id is null and d.trigger = 'day'
              and d.trigger_on between fact.happened_on - 30 and fact.happened_on + 30)
          -- Of the decision of its embargos, which started the appeal's term again (0213).
          or (d.publication_id is not null and d.act <> 'embargos_declaracao' and exists (
                select 1 from public.publications p
                where p.id = d.publication_id and p.available_on >= fact.happened_on
                  and public.reading_decides_embargos(p.body)))
        )
      for update
    loop
      update public.deadlines
      set status = 'dismissed', dismiss_reason = 'O escritório decidiu aceitar a sentença.', dismissed_by = auth.uid(),
          dismissed_at = now()
      where id = taken.id;
      perform public.record_case_event(current_case.org_id, current_case.id, 'deadline_dismissed', 'person',
        jsonb_build_object('deadline', taken.id));
    end loop;
  end if;
  perform public.record_case_event(current_case.org_id, current_case.id, 'judgment_path_decided', 'person',
    jsonb_build_object('proceeding', path.proceeding_id, 'decision', target_decision));
  insert into public.audit_events (org_id, actor_id, action, entity_type, entity_id, metadata)
  values (current_case.org_id, auth.uid(), 'judgment_path.decided', 'judgment_path', path.id::text,
          jsonb_build_object('decision', target_decision));
  return jsonb_build_object('ok', true, 'code', 'decided');
end;
$$;

revoke all on function public.decide_judgment_path(uuid, text, text) from public, anon;
grant execute on function public.decide_judgment_path(uuid, text, text) to authenticated;
