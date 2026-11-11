begin;
create extension if not exists pgtap with schema extensions;
select plan(13);

-- ============================================================
-- The privilege model, scanned from the catalog (every migration).
--
-- The project is secure by default: nothing in `public` is reachable by the
-- API roles unless a migration grants it. These assertions read the system
-- catalog, so a table or function added later is covered without anybody
-- remembering this file. A failure here means: decide on purpose, then update
-- the allowlist.
-- ============================================================

select is(
  (
    select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  ),
  '{}'::text[],
  'every table has row level security'
);

select is(
  (
    select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
      and has_any_column_privilege('anon', c.oid, 'SELECT')
  ),
  -- airlines, airports, courts: public reference data the client's link reads (0021).
  array[
    'airlines',
    'airports',
    'blog_comments',
    'blog_posts',
    'consent_terms',
    'courts',
    'help_articles',
    'help_categories',
    'platform_settings'
  ],
  'an anonymous visitor can read exactly the texts in force, the help center, the blog, the public settings and the reference tables'
);

select is(
  (
    select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('anon', c.oid, 'INSERT')
           or has_table_privilege('anon', c.oid, 'UPDATE')
           or has_table_privilege('anon', c.oid, 'DELETE')
           or has_any_column_privilege('anon', c.oid, 'INSERT')
           or has_any_column_privilege('anon', c.oid, 'UPDATE'))
  ),
  '{}'::text[],
  'and can write nothing'
);

select is(
  (
    select coalesce(array_agg(p.proname::text order by p.proname), '{}')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('anon', p.oid, 'EXECUTE')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      -- A function of an event trigger is called by no role (Supabase's own `rls_auto_enable`, which turns RLS on
      -- in every new table of public, is one): it is no way in.
      and p.prorettype <> 'event_trigger'::regtype
  ),
  -- The client_link_* functions are a client's way in, by the token of their link (0022, 0023, 0025, 0026, 0038,
  -- 0085, 0095);
  -- the pax_link_* ones a passenger's, by the link of the agency's partnership (0070).
  array[
    'client_link_add_dependent', 'client_link_agency', 'client_link_answer_chronology', 'client_link_assign_upload',
    'client_link_civil_court', 'client_link_complete_statement',
    'client_link_course',
    'client_link_discard_upload',
    'client_link_finish',
    'client_link_finish_statement', 'client_link_finish_upload', 'client_link_free_justice', 'client_link_interview', 'client_link_interview_answer', 'client_link_judgment_paths',
    'client_link_notices',
    'client_link_open', 'client_link_piece_facts', 'client_link_prior_complaint', 'client_link_publication_news', 'client_link_remove_segment', 'client_link_reserve_signed', 'client_link_reserve_statement',
    'client_link_reserve_upload', 'client_link_residence',
    'client_link_save_person', 'client_link_save_segment', 'client_link_signature_original', 'client_link_signatures',
    'client_link_statements', 'client_link_terms', 'client_link_write_statement',
    'current_consent_terms', 'firm_invitation_preview', 'partner_invitation_preview',
    'pax_link_answer', 'pax_link_export', 'pax_link_open', 'pax_link_reserve_upload', 'supported_locales',
    'verify_document'
  ],
  'an anonymous visitor can call exactly the texts in force, what an invitation link shows, the languages, the check of a document''s public code and what a client''s link lets them do'
);

select ok(
  not has_column_privilege('anon', 'public.firm_invitations', 'token_hash', 'SELECT')
  and not has_column_privilege('authenticated', 'public.firm_invitations', 'token_hash', 'SELECT')
  and not has_column_privilege('anon', 'public.partner_invitations', 'token_hash', 'SELECT')
  and not has_column_privilege('authenticated', 'public.partner_invitations', 'token_hash', 'SELECT')
  and not has_column_privilege('anon', 'public.pax_confirm_links', 'token_hash', 'SELECT')
  and not has_column_privilege('authenticated', 'public.pax_confirm_links', 'token_hash', 'SELECT'),
  'no session can read the hash of an invitation link, nor of a passenger''s link'
);

select is(
  (
    select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and c.relname in ('memberships', 'firm_invitations', 'oab_registrations', 'consent_acceptances', 'entitlement_grants')
      and (has_table_privilege('authenticated', c.oid, 'INSERT')
           or has_table_privilege('authenticated', c.oid, 'UPDATE')
           or has_table_privilege('authenticated', c.oid, 'DELETE')
           or has_any_column_privilege('authenticated', c.oid, 'INSERT')
           or has_any_column_privilege('authenticated', c.oid, 'UPDATE'))
  ),
  '{}'::text[],
  'who belongs to a firm, its invitations, the registrations at the bar, the consents and the grants are written by audited functions only'
);

select is(
  (
    select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and not has_table_privilege('authenticated', c.oid, 'SELECT')
      and not has_any_column_privilege('authenticated', c.oid, 'SELECT')
      -- The history of the migrations is the runner's (`scripts/remote-db-gate.mjs` on a hosted project), not the product's.
      and c.relname <> 'schema_migrations'
  ),
  array[
    'billing_webhook_events',
    'connection_secrets',
    -- Each court's channel to file by machine, the operator's data (0101): read through the backend's functions.
    'court_filing_channels',
    'djen_probes',
    'hearing_event_removals',
    'lead_submissions',
    -- What the market's reading plans, and the decisions it read (0190): read through their functions, in numbers.
    'market_captures',
    'market_decisions',
    'meta_attribution',
    'newsletter_deliveries',
    -- A passenger's link of an agency (0070): read through its functions, by the agency and by its token.
    'pax_confirm_links',
    -- The bytes of an agency's forgotten files the backend owes removing (0072).
    'pax_file_removals',
    -- How many documents the AI read for each partnership in a day (0074).
    'pax_reading_days',
    'proceeding_signers_seen'
  ],
  'the tables only the backend touches are not readable by any session'
);

select ok(
  not has_table_privilege('service_role', 'public.connection_secrets', 'SELECT')
  and not has_table_privilege('service_role', 'public.connection_secrets', 'INSERT')
  and not has_table_privilege('service_role', 'public.connection_secrets', 'UPDATE')
  and not has_table_privilege('service_role', 'public.connection_secrets', 'DELETE')
  and not has_any_column_privilege('service_role', 'public.connection_secrets', 'SELECT'),
  'the sealed tokens are not reachable even by the service role: the vault functions are the only door, so every read is audited'
);

-- A support visit is the operator inside somebody's session. A table of firm
-- data is fenced against it (guard_impersonation_readonly) unless it is on
-- this list, each one for a reason: written by the backend only, written by
-- the operator's own consoles, or written by a support visit on purpose (the
-- audit trail records what the visit did).
select is(
  (
    select coalesce(array_agg(c.relname::text order by c.relname), '{}')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
    where n.nspname = 'public' and c.relkind = 'r'
      and not exists (
        select 1 from pg_trigger t join pg_proc p on p.oid = t.tgfoid
        where t.tgrelid = c.oid and not t.tgisinternal and p.proname = 'guard_impersonation_readonly'
      )
  ),
  array[
    'ai_runs',               -- the backend
    'ai_spend',              -- the backend
    'audit_events',          -- what a support visit did is recorded here
    'billing_operations',    -- the billing functions, which a support visit may use
    'invoices',              -- the backend and the billing console
    'meta_attribution',      -- the backend
    'onboarding_state',      -- the person's own progress
    'product_events',        -- the server writer, which skips support visits
    'purchase_attributions', -- the backend
    'record_versions',       -- the versioning triggers
    'signup_attribution',    -- the backend
    'subscriptions'          -- the backend and the billing console
  ],
  'every table of firm data is fenced against a support visit, or named here with the reason it is not'
);

-- A lawyer's password, PIN, one-time code or its seed, certificate or private
-- key is never stored: no column may even be named for one.
select is(
  (
    select coalesce(array_agg(c.table_name || '.' || c.column_name order by c.table_name, c.column_name), '{}')
    from information_schema.columns c
    where c.table_schema = 'public' and public.is_credential_name(c.column_name)
  ),
  '{}'::text[],
  'no column is named for a lawyer''s own credential'
);

select is(
  (
    select coalesce(array_agg(p.proname::text order by p.proname), '{}')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) as setting where setting like 'search_path=%'
      )
  ),
  '{}'::text[],
  'every security definer function pins its search_path'
);

select is(
  (
    select coalesce(array_agg(p.proname::text order by p.proname), '{}')
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and has_function_privilege('public', p.oid, 'EXECUTE')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
      and p.prorettype <> 'event_trigger'::regtype
  ),
  '{}'::text[],
  'no function is left executable by PUBLIC'
);

-- A table a session can write must say who may write which row: a grant with
-- no policy for that command writes nothing, and a policy with no grant is a
-- promise the role cannot use. Either mismatch is a mistake worth a look.
select is(
  (
    select coalesce(array_agg(distinct c.relname::text order by c.relname::text), '{}')
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r'
      and (has_table_privilege('authenticated', c.oid, 'INSERT')
           or has_table_privilege('authenticated', c.oid, 'UPDATE')
           or has_table_privilege('authenticated', c.oid, 'DELETE')
           or has_any_column_privilege('authenticated', c.oid, 'INSERT')
           or has_any_column_privilege('authenticated', c.oid, 'UPDATE'))
      and not exists (
        select 1 from pg_policy pol
        where pol.polrelid = c.oid and pol.polcmd in ('a', 'w', 'd', '*')
      )
  ),
  '{}'::text[],
  'every table a session may write has a policy that says which rows'
);

select * from finish();
rollback;
