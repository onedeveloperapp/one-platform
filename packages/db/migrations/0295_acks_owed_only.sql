-- 0295: the bell of the awareness of ONE's triage asks the database only for what is still owed.
--
-- `publication_acks_owed` (0104) answered every publication ONE triaged that nobody acknowledged, the oldest 200,
-- with everybody it is told to, and the backend's round (`lib/publications/ack-notices.ts`, the sweep
-- `publication-acks`, every five minutes and while ONE is used) wrote each notice again, leaving the unique key of
-- the bell to refuse it: a read of the profiles and a write per person, for every publication, on every round. On
-- the development project, 63 publications owed of one firm took about 35 s of the clock's beat (2026-11-25, 02:26
-- UTC), most of it, while nothing new was owed. And a publication past the oldest 200 was never told, not even
-- right after its triage, whose round looked for it among those 200.
--
-- Redefined to answer only what is still owed: for each publication, who has not had its notice yet and, once it
-- is late, who has not had the day's reminder, with the keys of both, so the backend writes the very keys the
-- database looked for (`notifyUsers` appends `:<person>` to a key, as below). The limit is taken after that, so
-- a round with nothing new reads one answer and writes nothing; a round may ask for one publication (the one
-- ONE has just triaged). Who is told is as in 0104.

drop function if exists public.publication_acks_owed(integer);

/**
 * What the backend's bell still owes of the awareness of ONE's triage, across
 * the firms: each publication ONE triaged that no person acknowledged with
 * somebody still to tell, the oldest first. `to_tell` are who have not had its
 * notice (`told_key`); `to_remind`, once it is late, who have not had the
 * day's reminder (`reminder_key`, the day in Brasília). Who is told: the
 * lawyers it was addressed to who still sign; none, who signs or runs the
 * firm's deadlines. Service role only.
 */
create function public.publication_acks_owed(target_limit integer default 200, target_publication uuid default null)
returns table (
  publication_id uuid,
  org_id uuid,
  case_id uuid,
  seq integer,
  category text,
  triaged_at timestamptz,
  told_key text,
  to_tell uuid[],
  reminder_key text,
  to_remind uuid[]
)
language sql
stable
security definer
set search_path = public
as $$
  with owed as (
    select p.id, p.org_id, p.case_id, k.seq, p.category, p.triaged_at,
           p.triaged_at <= now() - make_interval(hours => greatest(public.publications_setting('ack_late_hours', 4), 1))
             as late,
           'pub-ack:' || p.id::text as told_key,
           'pub-ack-late:' || p.id::text || ':' || to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD')
             as reminder_key,
           coalesce(
             nullif(public.publication_ack_lawyers(p.org_id, p.lawyer_ids), '{}'::uuid[]),
             (select coalesce(array_agg(m.user_id order by m.user_id), '{}'::uuid[]) from public.memberships m
              where m.org_id = p.org_id and m.firm_function in ('socio', 'advogado', 'controladoria'))
           ) as recipients
    from public.publications p
    left join public.cases k on k.id = p.case_id
    where p.ack_owed and p.active and auth.role() = 'service_role'
      and (target_publication is null or p.id = target_publication)
  ),
  due as (
    select o.id, o.org_id, o.case_id, o.seq, o.category, o.triaged_at, o.told_key, o.reminder_key,
           array(select r from unnest(o.recipients) as r
                 where not exists (select 1 from public.notifications n
                                   where n.source_key = o.told_key || ':' || r::text)
                 order by r) as to_tell,
           case when o.late then
             array(select r from unnest(o.recipients) as r
                   where not exists (select 1 from public.notifications n
                                     where n.source_key = o.reminder_key || ':' || r::text)
                   order by r)
           else '{}'::uuid[] end as to_remind
    from owed o
  )
  select d.id, d.org_id, d.case_id, d.seq, d.category, d.triaged_at, d.told_key, d.to_tell, d.reminder_key,
         d.to_remind
  from due d
  where cardinality(d.to_tell) > 0 or cardinality(d.to_remind) > 0
  order by d.triaged_at, d.id
  limit greatest(least(coalesce(target_limit, 200), 1000), 1);
$$;

revoke all on function public.publication_acks_owed(integer, uuid) from public, anon, authenticated;
grant execute on function public.publication_acks_owed(integer, uuid) to service_role;
