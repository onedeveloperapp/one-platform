-- ============================================================
-- 0209 · The evidence kit (M4, sprint S12): the link that records the date
-- and the hour of each proof.
--
-- What a passenger sends of the moment of the problem (a photo of the board,
-- of the queue, of the airline's notice, a receipt of what they spent, the
-- boarding pass) is worth more the nearer it is to the flight. The firm's
-- link already takes it (`evidence`, `receipt`, `boarding_pass`, 0022 and
-- 0177); what it did not keep was the hour. Each file already has the moment
-- the backend received and measured its bytes (`files.confirmed_at`, the
-- platform's clock) and their fingerprint (`files.sha256`); this migration
-- adds what the photo says of itself: the moment its camera wrote in its EXIF
-- (`case_documents.taken_local`, the device's local time, and its offset when
-- the camera wrote one), read once by the backend where the photo arrives
-- (`keep_document_taken`), never typed by anybody and never in place of the
-- platform's moment.
--
-- `case_evidence_moments` gives a case's kit in one answer: its legs, each
-- with its scheduled departure and arrival as instants (the airport's offset,
-- 0025 and 0173), the arrival ANAC's record gave when it was checked (0030);
-- the words ONE sent the passenger about the flight (0047 and 0172); and each
-- proof the case holds that was not refused, with who sent it and how, the
-- moment ONE received it, the moment it says it was taken and its
-- fingerprint. The dossier (the case's document of record) lays them out in
-- the order they happened. Anybody of the firm reads it, as the case.
-- ============================================================

alter table public.case_documents add column taken_local timestamp;
alter table public.case_documents add column taken_offset text;
alter table public.case_documents add constraint case_documents_taken_check check (
  (taken_local is not null or taken_offset is null)
  and (taken_offset is null or taken_offset ~ '^[+-][0-9]{2}:[0-9]{2}$')
);

/**
 * The backend keeps the moment a photo says it was taken, once: a moment on
 * record is never written over, and only a proof of the moment of the
 * problem takes one. Called by the backend only, where the photo arrives.
 */
create or replace function public.keep_document_taken(
  target_document uuid,
  target_local timestamp,
  target_offset text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  kept integer;
begin
  if target_local is null then
    return false;
  end if;
  update public.case_documents d
  set taken_local = target_local,
      taken_offset = case when target_offset ~ '^[+-][0-9]{2}:[0-9]{2}$' then target_offset end
  where d.id = target_document
    and d.taken_local is null
    and d.kind in ('evidence', 'receipt', 'boarding_pass');
  get diagnostics kept = row_count;
  return kept > 0;
end;
$$;

revoke all on function public.keep_document_taken(uuid, timestamp, text) from public, anon, authenticated;
grant execute on function public.keep_document_taken(uuid, timestamp, text) to service_role;

/** The evidence kit of a case: its legs, ONE's words about the flight and its proofs, each with its moments. */
create or replace function public.case_evidence_moments(target_org uuid, target_case uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if not exists (select 1 from public.cases c where c.id = target_case and c.org_id = target_org) then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object(
    'ok', true,
    'legs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'position', s.position,
        'flight', s.flight_number,
        'origin', s.origin_iata,
        'destination', s.destination_iata,
        'affected', s.affected,
        'departure_at', case when s.scheduled_departure_local is not null and s.origin_iata is not null
          then public.leg_instant(s.scheduled_departure_local, s.origin_iata) end,
        'arrival_at', case when s.scheduled_arrival_local is not null and s.destination_iata is not null
          then public.leg_instant(s.scheduled_arrival_local, s.destination_iata) end,
        'actual_arrival_at', case when s.actual_arrival_local is not null and s.destination_iata is not null
          then public.leg_instant(s.actual_arrival_local, s.destination_iata) end
      ) order by s.position)
      from public.flight_segments s
      where s.org_id = target_org and s.case_id = target_case
    ), '[]'::jsonb),
    'alerts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'kind', a.kind,
        'delay_minutes', a.delay_minutes,
        'sent_at', a.sent_at
      ) order by a.sent_at)
      from public.flight_alerts a
      where a.org_id = target_org and a.case_id = target_case and a.status = 'sent' and a.sent_at is not null
    ), '[]'::jsonb),
    'proofs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id,
        'kind', d.kind,
        'source', d.source,
        'status', d.status,
        'person', p.full_name,
        'received_at', coalesce(f.confirmed_at, d.created_at),
        'taken_local', d.taken_local,
        'taken_offset', d.taken_offset,
        'sha256', f.sha256
      ) order by coalesce(f.confirmed_at, d.created_at), d.id)
      from public.case_documents d
      join public.files f on f.id = d.file_id and f.org_id = d.org_id
      left join public.case_parties cp on cp.id = d.party_id and cp.org_id = d.org_id
      left join public.people p on p.id = cp.person_id and p.org_id = cp.org_id
      where d.org_id = target_org and d.case_id = target_case
        and d.kind in ('evidence', 'receipt', 'boarding_pass')
        and d.status in ('received', 'accepted')
        and f.status = 'stored'
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.case_evidence_moments(uuid, uuid) from public, anon;
grant execute on function public.case_evidence_moments(uuid, uuid) to authenticated;
