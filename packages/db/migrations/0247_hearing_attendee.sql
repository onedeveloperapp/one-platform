-- ============================================================
-- Who goes to a hearing, and who reports it (0247). The owner's test of
-- 2026-11-13: the lawyer wrote to the firm's WhatsApp that the hearing had
-- no settlement and goes to judgment, and ONE called a person instead of
-- recording it: nobody had been chosen to go, so ONE knew of no one whose
-- report to take (0187). Now:
--
--   * a hearing nobody was chosen for has the lawsuit's lawyer as who goes,
--     ONE's choice on the record, which the firm changes as before (a
--     trigger on a hearing written; the hearings to come of today too);
--   * a person of the firm writing from the WhatsApp of their profile reports
--     the hearings they go to and the ones nobody goes to
--     (`conversation_hearing_report`, redefined from 0187).
-- ============================================================

/** The lawyer of a lawsuit ONE names to go to its hearing: one who signs it and is still of the firm. Internal. */
create or replace function public.lawsuit_attendee(target_proceeding uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select pl.user_id from public.proceeding_lawyers pl
  join public.proceedings p on p.id = pl.proceeding_id
  join public.memberships m on m.user_id = pl.user_id and m.org_id = p.org_id
  where pl.proceeding_id = target_proceeding
  order by pl.user_id
  limit 1;
$$;

revoke all on function public.lawsuit_attendee(uuid) from public, anon, authenticated;

/** A hearing written with nobody to go has the lawsuit's lawyer, as ONE's choice (0247). Internal. */
create or replace function public.hearings_default_attendee()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.attendee_user_id is null and new.attendee_name is null and new.attendee_phone is null
     and new.proceeding_id is not null and new.status = 'scheduled' then
    new.attendee_user_id := public.lawsuit_attendee(new.proceeding_id);
  end if;
  return new;
end;
$$;

revoke all on function public.hearings_default_attendee() from public, anon, authenticated;

create trigger hearings_default_attendee before insert on public.hearings
  for each row execute function public.hearings_default_attendee();

/** ONE's choice of who goes is on the case's record (0247). Internal. */
create or replace function public.hearings_attendee_told()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.attendee_user_id is not null and new.case_id is not null then
    perform public.record_case_event(new.org_id, new.case_id, 'hearing_attendee_by_one', 'system',
      jsonb_build_object('hearing', new.id, 'attendee', new.attendee_user_id));
  end if;
  return null;
end;
$$;

revoke all on function public.hearings_attendee_told() from public, anon, authenticated;

create trigger hearings_attendee_told after insert on public.hearings
  for each row when (new.attendee_user_id is not null and new.created_by is distinct from new.attendee_user_id)
  execute function public.hearings_attendee_told();

-- The hearings to come with nobody to go have the lawsuit's lawyer now, on the record.
with chosen as (
  update public.hearings h set attendee_user_id = public.lawsuit_attendee(h.proceeding_id)
  where h.status = 'scheduled' and h.starts_at > now() - interval '3 days'
    and h.attendee_user_id is null and h.attendee_name is null and h.attendee_phone is null
    and public.lawsuit_attendee(h.proceeding_id) is not null
  returning h.id, h.org_id, h.case_id, h.attendee_user_id
)
select public.record_case_event(c.org_id, c.case_id, 'hearing_attendee_by_one', 'system',
  jsonb_build_object('hearing', c.id, 'attendee', c.attendee_user_id))
from chosen c where c.case_id is not null;

/**
 * Whether the person writing in a conversation reports a hearing (replaces 0187's): a member of the firm by the
 * WhatsApp of their profile, for the hearings they go to and the ones nobody goes to (0247), or an attendee from
 * outside by the one on a hearing; the hearings from three days ago to two hours ahead with nothing said of them.
 * `none` for anybody else, who is answered as usual. Service role, for the conversation the backend holds.
 */
create or replace function public.conversation_hearing_report(target_conversation uuid, target_claim integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  conversation public.wa_conversations%rowtype;
  member uuid;
  found jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  select * into conversation from public.conversation_held(target_conversation, target_claim);
  if conversation.id is null then
    return jsonb_build_object('ok', false, 'code', 'not_working');
  end if;
  select m.user_id into member from public.memberships m
  join public.profiles p on p.id = m.user_id
  where m.org_id = conversation.org_id and p.whatsapp is not null
    and p.whatsapp = any (public.wa_phone_variants(conversation.contact_wa_id))
  limit 1;
  select coalesce(jsonb_agg(jsonb_build_object('hearing_id', h.id, 'case_id', h.case_id, 'starts_at', h.starts_at,
                                               'time_zone', h.time_zone, 'case_seq', c.seq)
                            order by abs(extract(epoch from (h.starts_at - now())))), '[]'::jsonb)
  into found
  from public.hearings h
  join public.cases c on c.id = h.case_id
  where h.org_id = conversation.org_id and h.status = 'scheduled'
    and h.starts_at between now() - interval '3 days' and now() + interval '2 hours'
    and ((member is not null
          and (h.attendee_user_id = member
               or (h.attendee_user_id is null and h.attendee_name is null and h.attendee_phone is null)))
         or (h.attendee_phone is not null and h.attendee_phone = any (public.wa_phone_variants(conversation.contact_wa_id))));
  if member is null and jsonb_array_length(found) = 0 then
    return jsonb_build_object('ok', true, 'code', 'none');
  end if;
  if jsonb_array_length(found) = 0 then
    return jsonb_build_object('ok', true, 'code', 'no_hearing', 'member', member);
  end if;
  return jsonb_build_object('ok', true, 'code', case when jsonb_array_length(found) = 1 then 'one' else 'many' end,
    'member', member, 'hearings', found);
end;
$$;

revoke all on function public.conversation_hearing_report(uuid, integer) from public, anon, authenticated;
grant execute on function public.conversation_hearing_report(uuid, integer) to service_role;
