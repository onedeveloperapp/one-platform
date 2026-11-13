-- ============================================================
-- The arrival asked with its options (0242). The owner, 2026-11-13: the
-- question of the arrival is "O cancelamento gerou quanto tempo de atraso
-- até chegar no destino final?" with three answers: less than four hours,
-- more than four hours, did not travel. The intake keeps the band chosen
-- (`atraso_faixa`: `menos_4`, `mais_4`), which the rule reads as the
-- arrival's delay (the backend's); the times or the hours told in words
-- are still read by the task as before (0239).
-- ============================================================

/**
 * The facts of an intake as the database keeps them (replaces 0239's): also the band of the arrival's delay the
 * person chose (`atraso_faixa`, 0242). Internal.
 */
create or replace function public.intake_facts_clean(target_facts jsonb)
returns jsonb
language sql
immutable
set search_path = public
as $$
  select coalesce(jsonb_object_agg(f.key, f.value), '{}'::jsonb)
  from (
    select key, to_jsonb(left(btrim(regexp_replace(value, '\s+', ' ', 'g')), 120)) as value
    from jsonb_each_text(case when jsonb_typeof(target_facts) = 'object' then target_facts else '{}'::jsonb end)
    where key in ('problema', 'companhia', 'voo', 'data', 'origem', 'destino', 'atraso_horas', 'chegada_prevista',
                  'chegada_real', 'viajou', 'atraso_faixa', 'aviso', 'nome', 'indicado_por', 'acompanhantes', 'etapa')
      and nullif(btrim(value), '') is not null
      and case key
        when 'problema' then value in ('cancellation', 'change', 'delay', 'missed_connection', 'overbooking',
                                       'baggage_lost', 'baggage_damaged', 'baggage_delayed', 'downgrade', 'other')
        when 'data' then value ~ '^\d{4}-\d{2}-\d{2}$'
        when 'atraso_horas' then value ~ '^\d{1,3}(\.\d)?$'
        when 'chegada_prevista' then btrim(value) ~ '^(\d{4}-\d{2}-\d{2}T)?\d{1,2}:\d{2}$'
        when 'chegada_real' then btrim(value) ~ '^(\d{4}-\d{2}-\d{2}T)?\d{1,2}:\d{2}$'
        when 'viajou' then value in ('sim', 'nao')
        when 'atraso_faixa' then value in ('menos_4', 'mais_4')
        when 'aviso' then value in ('at_airport', 'late', 'early')
        when 'origem' then upper(btrim(value)) ~ '^[A-Z]{3}$'
        when 'destino' then upper(btrim(value)) ~ '^[A-Z]{3}$'
        when 'nome' then char_length(btrim(value)) between 2 and 120 and value ~ '[[:alpha:]]'
        when 'indicado_por' then char_length(btrim(value)) between 2 and 120 and value ~ '[[:alpha:]]'
        when 'acompanhantes' then char_length(btrim(value)) between 2 and 120 and value ~ '[[:alpha:]]'
        when 'etapa' then value in ('resumo', 'corrigir', 'oferta', 'duvidas', 'recusou', 'seguir')
        else true
      end
  ) f;
$$;

revoke all on function public.intake_facts_clean(jsonb) from public, anon, authenticated;
