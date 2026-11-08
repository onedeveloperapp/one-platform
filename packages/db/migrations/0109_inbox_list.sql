-- ============================================================
-- 0109_inbox_list: the firm's conversations in the screen pattern of phase
-- 0 (the plan of the controladoria, the outcome of the cases and the firm's
-- finance, agreed by the owner on 2026-11-07; the drawings of the canvas
-- "ONE · Padrão de tela", approved the same day).
--
-- `/atendimento` read the 60 latest conversations of the firm and nothing
-- else, so a view of what waits, or a search for a client, could only look
-- among them: a conversation whose person wrote and nobody answered, older
-- than the 60 latest, was in no view at all. `firm_inbox` reads the
-- conversations of a view over all of the firm's (of one module, as 0078
-- reads it), searched by the name the firm or WhatsApp has for the person,
-- by the name of somebody of the firm with that number, or by the number's
-- digits, in the order the person chose, and counts every view over all of
-- them, so a view's count is what its list holds. Its views:
--
--   todas       every conversation;
--   esperando   the person wrote last, through the platform, and nobody
--               answered (the rule `firm_today` counts by, 0020);
--   fechando    of those, the ones whose 24 hours close within the
--               setting's hours (`closing_soon_hours`, as `firm_today`);
--   chamou      ONE called a person and none took it yet (0048);
--   resposta    an answer of ONE waits for a person's "Enviar" (0048);
--   com-pessoa  a person of the firm answers it;
--   nao-lidas   messages nobody read;
--   falhou      a message of the last 24 hours did not go out, or nobody
--               could tell whether it did (as `firm_today`'s
--               `sends_failed`, which counts the messages);
--   pararam     the person asked the firm to stop writing (0019).
--
-- It answers the ids of the list (at most the setting's 200), which the page
-- reads under the person's own session as before, with the total of the
-- list and the counts of every view. Counts are of the scope (the module),
-- never narrowed by the search, as `firm_cases` counts.
-- ============================================================

create or replace function public.firm_inbox(
  target_org uuid,
  target_view text default null,
  target_search text default null,
  target_module text default null,
  target_sort text default null,
  target_limit integer default 60
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  wanted text := coalesce(nullif(btrim(coalesce(target_view, '')), ''), 'todas');
  sort_by text := coalesce(nullif(btrim(coalesce(target_sort, '')), ''), 'recent');
  size integer := least(greatest(coalesce(target_limit, 60), 1), 200);
  closing_hours integer := greatest(coalesce((public.wa_setting('closing_soon_hours') #>> '{}')::integer, 4), 1);
  typed text := left(btrim(coalesce(target_search, '')), 120);
  digits text := regexp_replace(typed, '\D', '', 'g');
  -- What was typed with a letter in it is a name: its words as `slugify` writes them (no accent, no case).
  name_words text[] := case when typed ~ '[[:alpha:]]' then
    array(select w from regexp_split_to_table(public.slugify(typed), '-') as w where w <> '') end;
  searching boolean;
  answer jsonb;
begin
  if auth.uid() is null or not public.is_org_member(target_org) then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if wanted not in ('todas', 'esperando', 'fechando', 'chamou', 'resposta', 'com-pessoa', 'nao-lidas', 'falhou', 'pararam') then
    raise exception 'invalid_view' using errcode = '22023';
  end if;
  if sort_by not in ('recent', 'oldest') then
    raise exception 'invalid_sort' using errcode = '22023';
  end if;
  -- What was typed with no letter is a number, by its digits; a name with no word left (only marks) searches
  -- nothing, and the list is the view's.
  searching := coalesce(cardinality(name_words), 0) > 0 or (name_words is null and digits <> '');

  with replies as (
    -- The answers of ONE that wait for a person's "Enviar", by the conversation they are of.
    select distinct r.subject_id::uuid as conversation_id
    from public.approvals a
    join public.ai_runs r on r.id = a.run_id
    where a.org_id = target_org and a.status = 'pending' and a.task = 'atendimento.conversa'
      and r.subject_type = 'wa_conversation'
      and r.subject_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), failed as (
    select distinct m.conversation_id from public.wa_messages m
    where m.org_id = target_org and m.direction = 'out' and m.status = 'failed'
      and m.created_at > now() - interval '24 hours'
  ), flagged as (
    select c.id, c.contact_wa_id, c.saved_name, c.contact_name, c.last_message_at,
           w.waiting,
           (w.waiting and public.wa_window_open(c.last_inbound_at)
             and public.wa_window_closes_at(c.last_inbound_at) < now() + make_interval(hours => closing_hours)) as closing,
           (c.called_reason is not null) as called,
           (rp.conversation_id is not null) as reply,
           (c.agent = 'person') as with_person,
           (c.unread_count > 0) as unread,
           (fl.conversation_id is not null) as send_failed,
           (o.contact_wa_id is not null) as stopped
    from public.wa_conversations c
    left join public.wa_numbers n on n.id = c.number_id
    cross join lateral (
      select (c.status = 'open' and c.last_message_direction = 'in' and n.status = 'active'
        and c.last_inbound_at is not null and c.last_inbound_at >= c.last_message_at) as waiting
    ) w
    left join replies rp on rp.conversation_id = c.id
    left join failed fl on fl.conversation_id = c.id
    left join public.wa_optouts o on o.org_id = c.org_id and o.contact_wa_id = c.contact_wa_id
    where c.org_id = target_org
      and (target_module is null or public.conversation_in_module(c.org_id, c.contact_wa_id, target_module))
  ), matched as (
    select f.* from flagged f
    where (
      case wanted
        when 'todas' then true
        when 'esperando' then f.waiting
        when 'fechando' then f.closing
        when 'chamou' then f.called
        when 'resposta' then f.reply
        when 'com-pessoa' then f.with_person
        when 'nao-lidas' then f.unread
        when 'falhou' then f.send_failed
        else f.stopped
      end
    ) and (
      not searching
      -- A name: every word in the name the firm's phone or WhatsApp has, or in the name of somebody of the firm
      -- with this number (with or without its ninth digit).
      or (name_words is not null and (
        not exists (
          select 1 from unnest(name_words) as word
          where position(word in public.slugify(coalesce(f.saved_name, '') || ' ' || coalesce(f.contact_name, ''))) = 0
        )
        or exists (
          select 1 from public.people p
          where p.org_id = target_org and p.phone is not null
            and p.phone = any (public.wa_phone_variants(f.contact_wa_id))
            and not exists (
              select 1 from unnest(name_words) as word where position(word in public.slugify(p.full_name)) = 0
            )
        )
      ))
      -- A number: its digits anywhere in the person's number.
      or (name_words is null and position(digits in f.contact_wa_id) > 0)
    )
  ), ordered as (
    -- The latest message first, as before, or the oldest first (who waits the longest, in a view of what waits).
    select mt.id, row_number() over (
      order by
        case when sort_by = 'oldest' then mt.last_message_at end asc nulls last,
        mt.last_message_at desc nulls last,
        mt.id
    ) as pos
    from matched mt
  )
  select jsonb_build_object(
    'counts', (
      select jsonb_build_object(
        'todas', count(*),
        'esperando', count(*) filter (where waiting),
        'fechando', count(*) filter (where closing),
        'chamou', count(*) filter (where called),
        'resposta', count(*) filter (where reply),
        'com-pessoa', count(*) filter (where with_person),
        'nao-lidas', count(*) filter (where unread),
        'falhou', count(*) filter (where send_failed),
        'pararam', count(*) filter (where stopped))
      from flagged
    ),
    'total', (select count(*) from matched),
    'ids', coalesce((
      select jsonb_agg(p.id order by p.pos)
      from (select o.id, o.pos from ordered o order by o.pos limit size) p
    ), '[]'::jsonb)
  ) into answer;
  return answer;
end;
$$;

comment on function public.firm_inbox(uuid, text, text, text, text, integer) is
  'The conversations of a view of the firm''s inbox (of one module, or every one), searched and ordered, with the total of the list and the count of every view (0109).';

revoke all on function public.firm_inbox(uuid, text, text, text, text, integer) from public, anon;
grant execute on function public.firm_inbox(uuid, text, text, text, text, integer) to authenticated;
