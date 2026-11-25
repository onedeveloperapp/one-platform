-- ============================================================
-- 0290_triage_room_to_think: the triage of a publication has room for the model's thinking and its answer.
--
-- The owner, 2026-11-24, after 3 publications were left with no triage (one of the test case's history, a despacho of
-- 22/01/2026): "pode aumentar o limite da triagem". The second instructions of `publicacao.triagem` (0104) answer in
-- 600 tokens. Their answer is short (a sentence, a category, a certainty, whether it is urgent), but Claude Haiku 5.5
-- thinks by default when the call configures no thinking (the adapter never does), and that thinking counts within the
-- limit: in the 30 days before, 28 of 241 triages stopped at exactly 600 tokens with nothing written
-- (`output_truncated`), and the ones that answered spent 329 tokens on average, 591 at the 99th percentile. A
-- publication cut three times is left for a person to triage.
--
-- 1. A third version of the instructions, the second's words, model and schema, with 4096 tokens: the most the
--    adapter still asks for in one plain call (`LONG_ANSWER_TOKENS` of `packages/ai`), never streamed. In force in
--    place of the second, one version per task; each run keeps the version it used.
-- 2. The publications whose triage was given up for a cut answer, still untriaged, are put back in front of ONE's
--    triage, as 0105 did (`reopen_cut_triage`, the backend's, run once here): the next sweep asks again under the
--    third version, within the days the triage reads.
-- ============================================================

-- ---------- 1. A third version, with room to think ----------

insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  'publicacao.triagem',
  (select max(w.version) + 1 from public.prompt_versions w where w.task = 'publicacao.triagem'),
  v.provider, v.model, v.effort, v.system_prompt, v.output_schema, 4096, false,
  'As mesmas instruções da versão anterior, com 4096 tokens: o modelo pensa antes de responder, e o pensamento conta no limite de 600, que cortava a resposta.'
from public.prompt_versions v
where v.task = 'publicacao.triagem' and v.is_active and v.max_tokens < 4096;

-- In force: one version per task, so the one in force leaves before the new one comes in.
update public.prompt_versions as v set is_active = false
where v.task = 'publicacao.triagem' and v.is_active and v.max_tokens < 4096
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version and w.max_tokens = 4096
  );
update public.prompt_versions set is_active = true
where task = 'publicacao.triagem'
  and version = (select max(w.version) from public.prompt_versions w where w.task = 'publicacao.triagem' and w.max_tokens = 4096)
  and not exists (select 1 from public.prompt_versions w where w.task = 'publicacao.triagem' and w.is_active);

-- ---------- 2. The triages given up for a cut answer, asked again ----------

/** Puts back in front of ONE's triage each publication nobody triaged whose answer was cut every time (service role). */
create or replace function public.reopen_cut_triage()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  reopened integer;
begin
  update public.publications p
  set ai_attempts = 0, ai_error = null, ai_retry_after = null
  where p.ai_error = 'output_truncated' and p.ai_category is null and p.category is null and p.active
    and p.ai_claimed_at is null;
  get diagnostics reopened = row_count;
  return reopened;
end;
$$;

revoke all on function public.reopen_cut_triage() from public, anon, authenticated;
grant execute on function public.reopen_cut_triage() to service_role;

select public.reopen_cut_triage();
