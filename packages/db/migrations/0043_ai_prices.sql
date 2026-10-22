-- ============================================================
-- 0043_ai_prices: what each model costs, priced the way its vendor bills it.
--
-- The price book (`platform_settings` key `ai_prices`, 0014) held one pair of
-- rates per model, and it shipped empty, so no run of the first walk had a
-- cost. The vendors price more than one pair, and the book now says it:
--
-- - `longContext`: a request whose input goes over `aboveTokensIn` tokens pays
--   other rates for all of it. Anthropic prices Claude Haiku 5.5 this way: "a
--   request whose prompt is over 100,000 tokens pays higher prices", the whole
--   request, every input token counted.
-- - `changes`: rates that take effect on a day (`from`, a date read in UTC),
--   each laid over the ones before it, so a price announced ahead is written
--   once and a call is priced as of the moment it happened. Google doubles the
--   price of Gemini 3.6 Flash on 1 January 2027.
-- - `audioInPerMillion`: the rate of the audio a model hears, where a vendor
--   prices it apart; with none, audio is an input token like the others.
--
-- The audio was not counted at all before: the providers report it apart
-- (`audioTokensIn`) and the run store dropped it, so the transcription of a
-- client's account cost nothing on record. It is now a column of the run and
-- of the ledger, and priced.
--
-- A rate that is not a number prices nothing on its side and never stops a run
-- from being finished: a typo in the book is a cost left unpriced, which the
-- reports count, not an answer lost.
--
-- The book is seeded with the four models the tasks pin (0016 to 0040), each
-- with the page it was read on and the day (2026-10-22), and every call on
-- record is priced again. Pricing again now reaches the run as well as the
-- ledger, so the two never disagree.
-- ============================================================

alter table public.ai_runs add column audio_tokens_in bigint not null default 0;
alter table public.ai_runs add constraint ai_runs_audio_tokens_check check (audio_tokens_in >= 0);

alter table public.ai_spend add column audio_tokens_in bigint not null default 0;
alter table public.ai_spend add constraint ai_spend_audio_tokens_check check (audio_tokens_in >= 0);

/**
 * A rate of the price book as a number, or nothing when it is not one: a
 * negative number, a word, "0,30" typed by hand. Whoever reads the book never
 * breaks on what somebody wrote in it.
 */
create or replace function public.ai_price_rate(rate jsonb)
returns numeric
language sql
immutable
set search_path = public
as $$
  select case
    when jsonb_typeof(rate) = 'number' and (rate #>> '{}')::numeric >= 0 then (rate #>> '{}')::numeric
    when jsonb_typeof(rate) = 'string' and btrim(rate #>> '{}') ~ '^[0-9]+([.][0-9]+)?$' then btrim(rate #>> '{}')::numeric
  end;
$$;

revoke all on function public.ai_price_rate(jsonb) from public, anon, authenticated;

/**
 * The rates of a model at a moment: its entry in the price book with every
 * change whose day has come laid over it, oldest first. Null for a model the
 * book does not name. Days are compared as the text of an ISO date, so a day
 * written wrong never raises.
 */
create or replace function public.ai_model_price(target_model text, target_at timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  entry jsonb := public.ai_price_book() -> 'models' -> target_model;
  price jsonb;
  change jsonb;
  on_day text := to_char((coalesce(target_at, now()) at time zone 'UTC')::date, 'YYYY-MM-DD');
begin
  if entry is null or jsonb_typeof(entry) <> 'object' then
    return null;
  end if;
  price := entry - 'changes';
  if jsonb_typeof(entry -> 'changes') = 'array' then
    for change in
      select c.value
      from jsonb_array_elements(entry -> 'changes') c
      where jsonb_typeof(c.value) = 'object'
        and coalesce(c.value ->> 'from', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
        and c.value ->> 'from' <= on_day
      order by c.value ->> 'from'
    loop
      price := price || (change - 'from');
    end loop;
  end if;
  return price;
end;
$$;

revoke all on function public.ai_model_price(text, timestamptz) from public, anon, authenticated;

-- The new arguments change the function's identity: the old one goes, and the
-- calls with three arguments (record_ai_spend, the tests) reach the new one.
drop function public.ai_spend_cost(text, bigint, bigint);

create function public.ai_spend_cost(
  target_model text,
  target_tokens_in bigint,
  target_tokens_out bigint,
  target_audio_tokens_in bigint default 0,
  target_at timestamptz default now()
)
returns table (cost_usd_micros bigint, priced boolean)
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  price jsonb := public.ai_model_price(target_model, target_at);
  tier jsonb;
  used_in bigint := greatest(coalesce(target_tokens_in, 0), 0);
  used_out bigint := greatest(coalesce(target_tokens_out, 0), 0);
  used_audio bigint := greatest(coalesce(target_audio_tokens_in, 0), 0);
  in_rate numeric;
  out_rate numeric;
  audio_rate numeric;
  above numeric;
begin
  if price is null then
    return query select 0::bigint, false;
    return;
  end if;

  in_rate := public.ai_price_rate(price -> 'inPerMillion');
  out_rate := public.ai_price_rate(price -> 'outPerMillion');
  audio_rate := public.ai_price_rate(price -> 'audioInPerMillion');

  -- Over the threshold, the whole request pays the other rates, as the vendor
  -- bills it; what it sent is every input token, the audio included.
  tier := price -> 'longContext';
  if jsonb_typeof(tier) = 'object' then
    above := public.ai_price_rate(tier -> 'aboveTokensIn');
    if above is not null and used_in + used_audio > above then
      in_rate := coalesce(public.ai_price_rate(tier -> 'inPerMillion'), in_rate);
      out_rate := coalesce(public.ai_price_rate(tier -> 'outPerMillion'), out_rate);
      audio_rate := coalesce(public.ai_price_rate(tier -> 'audioInPerMillion'), audio_rate);
    end if;
  end if;

  if in_rate is null and out_rate is null then
    return query select 0::bigint, false;
    return;
  end if;

  -- A price per million tokens, in dollars, IS the price per token in micros.
  return query select
    round(
      used_in * coalesce(in_rate, 0)
      + used_audio * coalesce(audio_rate, in_rate, 0)
      + used_out * coalesce(out_rate, 0)
    )::bigint,
    true;
end;
$$;

revoke all on function public.ai_spend_cost(text, bigint, bigint, bigint, timestamptz) from public, anon, authenticated;

-- The audio a model heard is one more argument at the end: the calls that name
-- seven arguments, or fewer, mean what they meant.
drop function public.finish_ai_run(uuid, text, jsonb, bigint, bigint, text, text);

/**
 * Closes a run: records what it consumed in the cost ledger of its firm and,
 * when it succeeded and the task asks for it, puts the answer in the firm's
 * approval queue. Service role only; a run is finished once, and the answer
 * always says the status the record has, which is not the one asked for when
 * the run was already closed.
 *
 * `sampled` decides from the run's own id, so the same run always gives the
 * same answer and nothing is left to chance at a retry. As in 0016, with the
 * audio the model heard counted and priced (0043).
 */
create function public.finish_ai_run(
  target_run uuid,
  target_status text,
  target_output jsonb default null,
  target_tokens_in bigint default 0,
  target_tokens_out bigint default 0,
  target_model text default null,
  target_error_code text default null,
  target_audio_tokens_in bigint default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  run public.ai_runs%rowtype;
  task_row public.ai_tasks%rowtype;
  served_model text;
  used_in bigint := greatest(coalesce(target_tokens_in, 0), 0);
  used_out bigint := greatest(coalesce(target_tokens_out, 0), 0);
  used_audio bigint := greatest(coalesce(target_audio_tokens_in, 0), 0);
  cost_micros bigint := 0;
  cost_priced boolean := false;
  spend uuid;
  approval uuid;
  waits boolean := false;
  decision_key text;
  firm_mode text;
  share integer;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'not_authorized' using errcode = '42501';
  end if;
  if target_status not in ('succeeded', 'failed', 'blocked') then
    raise exception 'invalid_status' using errcode = '22023';
  end if;
  if target_status = 'succeeded' and (target_output is null or jsonb_typeof(target_output) <> 'object') then
    raise exception 'output_required' using errcode = '22023';
  end if;

  select * into run from public.ai_runs where id = target_run for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'run_not_found');
  end if;

  served_model := coalesce(nullif(btrim(target_model), ''), run.model);

  -- A call that reached the provider cost something whatever came of it. That
  -- includes the call that lands after the sweep gave its run up as abandoned:
  -- the answer is discarded then, what it consumed is still the firm's cost.
  if (used_in > 0 or used_out > 0 or used_audio > 0) and run.spend_id is null
     and (run.status = 'running' or run.error_code = 'abandoned') then
    select c.cost_usd_micros, c.priced into cost_micros, cost_priced
    from public.ai_spend_cost(served_model, used_in, used_out, used_audio) c;

    insert into public.ai_spend (
      org_id, feature, provider, model, tokens_in, tokens_out, audio_tokens_in, cost_usd_micros, priced, ref_id, created_by
    ) values (
      run.org_id, run.task, run.provider, served_model, used_in, used_out, used_audio,
      cost_micros, cost_priced, run.id, run.requested_by
    )
    returning id into spend;
  end if;

  if run.status <> 'running' then
    if spend is not null then
      update public.ai_runs set
        model = served_model,
        tokens_in = used_in,
        tokens_out = used_out,
        audio_tokens_in = used_audio,
        cost_usd_micros = cost_micros,
        priced = cost_priced,
        spend_id = spend
      where id = run.id;
    else
      cost_micros := run.cost_usd_micros;
      cost_priced := run.priced;
    end if;
    return jsonb_build_object(
      'ok', true, 'code', 'already_finished', 'status', run.status,
      'approval_id', (select a.id from public.approvals a where a.run_id = run.id),
      'cost_usd_micros', cost_micros,
      'priced', cost_priced
    );
  end if;

  update public.ai_runs set
    status = target_status,
    model = served_model,
    output = case when target_status = 'succeeded' then target_output end,
    error_code = case when target_status <> 'succeeded' then left(coalesce(nullif(btrim(target_error_code), ''), 'failed'), 80) end,
    tokens_in = used_in,
    tokens_out = used_out,
    audio_tokens_in = used_audio,
    cost_usd_micros = cost_micros,
    priced = cost_priced,
    spend_id = spend,
    finished_at = now()
  where id = run.id;

  if target_status = 'succeeded' then
    select * into task_row from public.ai_tasks where slug = run.task;
    -- What the firm lets ONE decide alone, for a task that takes one of those decisions.
    select d.key into decision_key from public.autonomy_decisions d where d.task = run.task;
    firm_mode := case when decision_key is not null then public.firm_autonomy_mode(run.org_id, decision_key) end;
    -- The share of answers checked: the larger of the firm's and the operator's, where each samples.
    share := greatest(
      case when firm_mode = 'sampled' then public.firm_autonomy_sample(run.org_id, decision_key) else 0 end,
      case when task_row.autonomy = 'sampled' then task_row.sample_percent else 0 end
    );
    waits := case
      -- A task in shadow mode asks nobody anything, whatever its autonomy is set to.
      when task_row.shadow then false
      -- The operator holds the task for every firm, or the firm wants a person to decide.
      when task_row.autonomy = 'approval' or firm_mode = 'approval' then true
      -- A hash can be negative: the remainder is brought into 0..99 first.
      when share > 0 then mod(mod(hashtextextended(run.id::text, 0), 100) + 100, 100) < share
      else false
    end;
    if waits then
      insert into public.approvals (org_id, run_id, task, approver_functions)
      values (run.org_id, run.id, run.task, task_row.approver_functions)
      returning id into approval;
      -- A trigger of a task may enter the answer already withdrawn (0024: its document was decided, or
      -- another check of it waits): it waits for nobody.
      waits := exists (select 1 from public.approvals a where a.id = approval and a.status = 'pending');
      if not waits then
        approval := null;
      end if;
    end if;
  end if;

  insert into public.audit_events (org_id, actor_id, actor_type, action, entity_type, entity_id, metadata)
  values (
    run.org_id, run.requested_by, 'ai', 'ai.run.' || target_status, 'ai_run', run.id::text,
    jsonb_strip_nulls(jsonb_build_object(
      'task', run.task,
      'model', served_model,
      'awaits_approval', waits,
      'error_code', case when target_status <> 'succeeded' then left(coalesce(nullif(btrim(target_error_code), ''), 'failed'), 80) end
    ))
  );

  return jsonb_build_object(
    'ok', true,
    'code', 'finished',
    'status', target_status,
    'approval_id', approval,
    'cost_usd_micros', cost_micros,
    'priced', cost_priced
  );
end;
$$;

revoke all on function public.finish_ai_run(uuid, text, jsonb, bigint, bigint, text, text, bigint)
  from public, anon, authenticated;

-- Saving the price list prices the ledger again, each call as of the moment it
-- happened, and the run follows its line of the ledger.
create or replace function public.reprice_ai_spend(since timestamptz default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  touched integer;
begin
  if not (public.is_superadmin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'not_authorized';
  end if;

  with priced as (
    select s.id, c.cost_usd_micros, c.priced
    from public.ai_spend s
    cross join lateral public.ai_spend_cost(s.model, s.tokens_in, s.tokens_out, s.audio_tokens_in, s.occurred_at) c
    where since is null or s.occurred_at >= since
  )
  update public.ai_spend s
  set cost_usd_micros = p.cost_usd_micros,
      priced = p.priced
  from priced p
  where p.id = s.id
    and (s.cost_usd_micros is distinct from p.cost_usd_micros or s.priced is distinct from p.priced);

  get diagnostics touched = row_count;

  update public.ai_runs r
  set cost_usd_micros = s.cost_usd_micros,
      priced = s.priced
  from public.ai_spend s
  where r.spend_id = s.id
    and (since is null or s.occurred_at >= since)
    and (r.cost_usd_micros is distinct from s.cost_usd_micros or r.priced is distinct from s.priced);

  return touched;
end;
$$;

revoke all on function public.reprice_ai_spend(timestamptz) from public, anon;
grant execute on function public.reprice_ai_spend(timestamptz) to authenticated;

-- ---------- The book ----------

-- Each model with the page its prices were read on. A model the operator
-- already priced is priced again by these, the vendors' own figures.
update public.platform_settings
set value = jsonb_set(
  coalesce(value, '{}'::jsonb),
  '{models}',
  coalesce(value -> 'models', '{}'::jsonb) || $book${
    "claude-opus-5-5": {
      "inPerMillion": 4,
      "outPerMillion": 20,
      "source": "https://platform.claude.com/docs/en/about-claude/pricing",
      "checkedOn": "2026-10-22"
    },
    "claude-sonnet-5-5": {
      "inPerMillion": 2,
      "outPerMillion": 10,
      "source": "https://platform.claude.com/docs/en/about-claude/pricing",
      "checkedOn": "2026-10-22"
    },
    "claude-haiku-5-5": {
      "inPerMillion": 0.10,
      "outPerMillion": 0.50,
      "longContext": {"aboveTokensIn": 100000, "inPerMillion": 0.50, "outPerMillion": 2.50},
      "source": "https://platform.claude.com/docs/en/about-claude/pricing",
      "checkedOn": "2026-10-22"
    },
    "gemini-3.6-flash": {
      "inPerMillion": 0.75,
      "outPerMillion": 3.75,
      "changes": [{"from": "2027-01-01", "inPerMillion": 1.50, "outPerMillion": 7.50}],
      "source": "https://ai.google.dev/gemini-api/docs/pricing",
      "checkedOn": "2026-10-22"
    }
  }$book$::jsonb
)
where key = 'ai_prices';

-- Every call on record, priced again as of the moment it happened.
with priced as (
  select s.id, c.cost_usd_micros, c.priced
  from public.ai_spend s
  cross join lateral public.ai_spend_cost(s.model, s.tokens_in, s.tokens_out, s.audio_tokens_in, s.occurred_at) c
)
update public.ai_spend s
set cost_usd_micros = p.cost_usd_micros,
    priced = p.priced
from priced p
where p.id = s.id
  and (s.cost_usd_micros is distinct from p.cost_usd_micros or s.priced is distinct from p.priced);

update public.ai_runs r
set cost_usd_micros = s.cost_usd_micros,
    priced = s.priced
from public.ai_spend s
where r.spend_id = s.id
  and (r.cost_usd_micros is distinct from s.cost_usd_micros or r.priced is distinct from s.priced);
