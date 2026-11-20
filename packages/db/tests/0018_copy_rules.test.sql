begin;
create extension if not exists pgtap with schema extensions;
select plan(2);

-- ============================================================
-- The copy rules: no dash (— or –), no exclamation mark, no emoji and none of
-- the banned words in a text a person reads. Here: every text the migrations
-- seed, the texts in force among them (history tables and switched-off
-- versions are records, not pages).
-- The texts the app ships are checked by apps/web/src/lib/i18n/copy-rules.test.ts.
-- ============================================================

create function pg_temp.copy_rule_hits()
returns table (tbl text, col text, kind text, snippet text)
language plpgsql as $f$
declare
  r record;
begin
  for r in
    select c.table_name, c.column_name
    from information_schema.columns c
    join information_schema.tables t
      on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public'
      and c.table_name not in ('record_versions', 'audit_events', 'schema_migrations')
      and (c.data_type in ('text', 'jsonb', 'json', 'character varying') or c.udt_name = 'citext')
  loop
    return query execute format(
      $q$
        select %L::text, %L::text, h.kind, substring(s.v from h.ctx)
        from (select %I::text as v from public.%I %s) s
        cross join lateral (values
          ('dash', '[–—]', '.{0,60}[–—].{0,60}'),
          ('exclamation', '[[:alnum:]]!', '.{0,60}[[:alnum:]]!.{0,20}'),
          ('emoji', '[☀-➿⬀-⯿️\U0001F000-\U0001FAFF]',
                    '.{0,40}[☀-➿⬀-⯿️\U0001F000-\U0001FAFF].{0,40}'),
          ('word', '\m(desbloque|potencializ|sem esfor[cç]o|solu[cç](ão|ões) inovador|unlock|elevat|empower|seamless|robust|supercharg|game-changing|it.?s not just)',
                   '.{0,60}\m(?:desbloque|potencializ|sem esfor[cç]o|solu[cç](?:ão|ões) inovador|unlock|elevat|empower|seamless|robust|supercharg|game-changing|it.?s not just).{0,60}')
        ) as h(kind, pat, ctx)
        where s.v ~* h.pat
      $q$,
      r.table_name, r.column_name, r.column_name, r.table_name,
      case when r.table_name = 'consent_terms' then 'where is_active' else '' end
    );
  end loop;
end
$f$;

select is_empty(
  $$ select tbl, col, kind, snippet from pg_temp.copy_rule_hits() $$,
  'no seeded text in force has a dash, an exclamation mark, an emoji or a banned word'
);

select is(
  (select array_agg(slug || ':' || locale || ':' || version order by slug) from public.consent_terms where is_active),
  array['newsletter:pt-BR:1', 'protocolo-advogado:pt-BR:1', 'protocolo-escritorio:pt-BR:1'],
  'the texts in force are the sentence of the waitlist form and the acknowledgments of the filing ways (0263), in Portuguese'
);

select * from finish();
rollback;
