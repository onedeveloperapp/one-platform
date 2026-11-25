-- ============================================================
-- 0293_ticket_day_without_year: a ticket that prints the day of the flight without its year says that day, and the
-- person chooses the year (the owner, 2026-11-25).
--
-- "Mesmo analisando o bilhete do voo não está identificando a data do voo, se não tiver isso claro na análise, deve
-- ser perguntado dado as opções para selecionar a correta." The owner sent Azul's boarding pass, a screenshot of the
-- app: it prints "22 de out." and the times, never the year. The reading (`caso.documento.leitura`, 0085) writes a
-- departure only whole (AAAA-MM-DDTHH:MM) and leaves out what it does not see, so it wrote nothing of the day and the
-- panel "Abrir um caso" asked nothing. The second version of its instructions keeps the first's words and schema and
-- adds, to each leg, the day and the month of its departure as printed (`dia_mes_saida`, DD/MM), even with no year;
-- the year is never supposed, and the panel asks the person to choose among the days it can be
-- (`flightDayChoicesOf` of `lib/cases/document-prefill.ts`).
--
-- The reading is a task of the passenger module (0212): its new version reaches the panel and every new case through
-- a new published version of the module; the cases opened before keep theirs.
-- ============================================================

insert into public.prompt_versions (task, version, provider, model, effort, system_prompt, output_schema, max_tokens, is_active, note)
select
  v.task,
  (select max(w.version) + 1 from public.prompt_versions w where w.task = v.task),
  v.provider, v.model, v.effort,
  v.system_prompt || chr(10) || chr(10) ||
    $rule$Em cada trecho, dia_mes_saida é o dia e o mês da saída como impressos (DD/MM, por exemplo 22/10), mesmo quando o ano não aparece, ou vazio quando o documento não traz o dia. Quando o ano da saída não aparece no documento, deixe saida_prevista e chegada_prevista vazias e escreva só dia_mes_saida: nunca suponha o ano, que uma pessoa do escritório escolhe.$rule$,
  jsonb_set(
    jsonb_set(v.output_schema, '{properties,trechos,items,properties,dia_mes_saida}',
              '{"type": "string", "description": "DD/MM, ou vazio."}'::jsonb),
    '{properties,trechos,items,required}',
    (v.output_schema #> '{properties,trechos,items,required}') || '["dia_mes_saida"]'::jsonb),
  v.max_tokens, false,
  'Diz o dia e o mês da saída de cada trecho mesmo sem o ano, que nunca supõe: a pessoa escolhe o ano (0293).'
from public.prompt_versions v
where v.task = 'caso.documento.leitura' and v.is_active
  and not (v.output_schema #> '{properties,trechos,items,properties}') ? 'dia_mes_saida';

update public.prompt_versions as v set is_active = false
where v.task = 'caso.documento.leitura' and v.is_active
  and not (v.output_schema #> '{properties,trechos,items,properties}') ? 'dia_mes_saida'
  and exists (
    select 1 from public.prompt_versions w
    where w.task = v.task and w.version > v.version and (w.output_schema #> '{properties,trechos,items,properties}') ? 'dia_mes_saida'
  );
update public.prompt_versions as v set is_active = true
where v.task = 'caso.documento.leitura'
  and v.version = (select max(w.version) from public.prompt_versions w where w.task = v.task)
  and (v.output_schema #> '{properties,trechos,items,properties}') ? 'dia_mes_saida';

-- In the module's new version: the panel and every new case read the day without its year.
delete from public.module_versions v
where v.status = 'draft'
  and exists (select 1 from public.product_modules m where m.key = v.module and 'caso.documento.leitura' = any (m.version_tasks));

insert into public.module_versions (module, version, status, manifest, note, published_at)
select latest.module,
       (select max(o.version) from public.module_versions o where o.module = latest.module) + 1,
       'published',
       jsonb_set(latest.manifest, '{prompts,caso.documento.leitura}', to_jsonb(reading.version)),
       'A leitura de um bilhete diz o dia e o mês do voo mesmo sem o ano, e a pessoa escolhe o ano (0293).',
       now()
from (
  select distinct on (v.module) v.module, v.manifest
  from public.module_versions v
  join public.product_modules m on m.key = v.module and m.retired_at is null and 'caso.documento.leitura' = any (m.version_tasks)
  where v.status = 'published'
  order by v.module, v.version desc
) latest
cross join (select w.version from public.prompt_versions w where w.task = 'caso.documento.leitura' and w.is_active) reading
where (latest.manifest #>> '{prompts,caso.documento.leitura}')::integer is distinct from reading.version;
