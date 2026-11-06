-- ============================================================
-- 0105_triage_again: ONE triages again what the AI answered in the shadow
-- before it said how sure it is (the owner's test of 2026-11-05).
--
-- ONE triages a publication by itself where the AI is sure of it (0104),
-- and only an answer of the second instructions says so. A publication
-- captured before 0104 reached a project had been answered already in the
-- shadow (0028), with no word on certainty: it is never asked again, and it
-- waited for a person while a publication captured a minute later was
-- triaged by ONE. The owner met it on the test court's hearing.
--
--   - `reopen_unsure_triage`: puts back in front of ONE's triage each
--     publication nobody triaged yet whose answer says nothing of certainty,
--     of a whole text in force, captured within the days ONE reads, in a firm
--     that lets ONE triage. The next sweep asks the AI again under the
--     instructions in force. Run once here; the backend's, never a person's.
-- ============================================================

create or replace function public.reopen_unsure_triage()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  days integer := greatest(public.publications_setting('triage_days', 7), 1);
  reopened integer;
begin
  update public.publications p
  set ai_category = null, ai_urgent = null, ai_run_id = null, ai_attempts = 0, ai_error = null,
      ai_claimed_at = null, ai_retry_after = null
  where p.category is null and p.active and not p.truncated and p.ai_category is not null
    and p.ai_claimed_at is null
    and p.captured_at > now() - make_interval(days => days)
    and public.firm_autonomy_mode(p.org_id, 'publication_triage') = 'auto'
    and not exists (select 1 from public.ai_runs r where r.id = p.ai_run_id and r.output ? 'certeza');
  get diagnostics reopened = row_count;
  return reopened;
end;
$$;

revoke all on function public.reopen_unsure_triage() from public, anon, authenticated;
grant execute on function public.reopen_unsure_triage() to service_role;

select public.reopen_unsure_triage();
