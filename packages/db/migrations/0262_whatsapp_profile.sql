-- ============================================================
-- 0262_whatsapp_profile: the firm's WhatsApp profile in its brand (the owner, 2026-11-20).
--
-- The second phase of the plan "o escritório preparado antes do primeiro atendimento": the business profile a client
-- sees of the firm's number (the line under its name, the description, the address, the e-mail) is written by ONE
-- from the firm's data and kept in step with it, by itself: the sweep `whatsapp-profile` reads every active number
-- with its firm's data (`wa_numbers_profile_due`), writes the profile through the number's provider where it differs
-- from the one last written, and records what came of it (`record_number_profile`). A provider that sets no profile
-- (the platform's OpenWA) is recorded once, and asked again only when the firm's data change.
-- ============================================================

alter table public.wa_numbers add column profile_hash text;
alter table public.wa_numbers add column profile_synced_at timestamptz;
alter table public.wa_numbers add column profile_code text;
alter table public.wa_numbers add constraint wa_numbers_profile_check check (
  (profile_hash is null or profile_hash ~ '^[0-9a-f]{64}$')
  and (profile_code is null or profile_code ~ '^[a-z0-9_]{1,40}$')
);

/**
 * The active numbers, with what the profile is written from: the firm's name, where it is, its e-mail, its areas
 * and its hours. The backend's; the profile itself is written by the app's rule (`businessProfileOf`).
 */
create or replace function public.wa_numbers_profile_due(target_limit integer default 20)
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
  return coalesce((
    select jsonb_agg(row order by row ->> 'number_id')
    from (
      select jsonb_build_object(
        'number_id', n.id,
        'org_id', n.org_id,
        'provider', n.provider,
        'connection_id', n.connection_id,
        'phone_number_id', n.phone_number_id,
        'waba_id', n.waba_id,
        'profile_hash', n.profile_hash,
        'firm', jsonb_strip_nulls(jsonb_build_object(
          'name', o.name,
          'street', o.office_street, 'number', o.office_number, 'complement', o.office_complement,
          'district', o.office_district, 'city', o.office_city, 'uf', o.office_uf, 'postal_code', o.office_postal_code,
          'email', o.office_email,
          'areas', (select jsonb_agg(a.name order by coalesce(l.position, 1000), a.name)
                    from public.firm_areas a left join public.law_areas l on l.key = a.law_area
                    where a.org_id = o.id and a.removed_at is null),
          'hours_from', to_char(f.hours_from, 'HH24:MI'), 'hours_to', to_char(f.hours_to, 'HH24:MI'),
          'saturdays', f.saturdays
        ))
      ) as row
      from public.wa_numbers n
      join public.organizations o on o.id = n.org_id
      left join public.firm_operations f on f.org_id = n.org_id
      where n.status = 'active'
      order by n.profile_synced_at nulls first, n.id
      limit greatest(1, least(coalesce(target_limit, 20), 100))
    ) due
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.wa_numbers_profile_due(integer) from public, anon, authenticated;
grant execute on function public.wa_numbers_profile_due(integer) to service_role;

/** What came of writing a number's profile: the profile's hash, and the provider's code (`ok`, or why not). */
create or replace function public.record_number_profile(target_number uuid, target_hash text, target_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_hash is null or target_hash !~ '^[0-9a-f]{64}$' or target_code is null or target_code !~ '^[a-z0-9_]{1,40}$' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  update public.wa_numbers set profile_hash = target_hash, profile_code = target_code, profile_synced_at = now()
  where id = target_number;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'code', 'recorded');
end;
$$;

revoke all on function public.record_number_profile(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_number_profile(uuid, text, text) to service_role;
