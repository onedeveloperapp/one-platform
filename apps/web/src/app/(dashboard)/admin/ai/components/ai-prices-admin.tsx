"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Chip, IconButton, TextField, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiMoney from "@/icons/nexture/ni-money";
import NiPlus from "@/icons/nexture/ni-plus";
import NiRefresh from "@/icons/nexture/ni-refresh";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

/**
 * The price list behind every cost figure of the platform
 * (`platform_settings`, key `ai_prices`; migration 0014).
 *
 * It ships EMPTY, and that is the point: provider list prices change, and a
 * number shipped in code would quietly become "what the AI costs" months
 * after it stopped being true. Until a model has a price here, its calls are
 * recorded as unpriced, and the console says how many calls it could not
 * price instead of reporting a cheap month.
 *
 * Prices are per MILLION tokens, in the currency of the provider's own price
 * list (dollars, for all of ours). The exchange rate is what lets a cost be
 * read in reais; with no rate every cost reads in dollars only, never mixed.
 */

type ModelPrice = {
  inPerMillion: string;
  outPerMillion: string;
};

type PriceRow = ModelPrice & { model: string };

const EMPTY: ModelPrice = { inPerMillion: "", outPerMillion: "" };

/**
 * These are RATES, not money in the product's currency: dollars per million
 * tokens, copied from a provider's price list with four decimal places.
 * `CurrencyField` exists for amounts in reais that a person types; it would
 * mask "0,30" into "R$ 0,30" and lose the unit the number actually has.
 */

/** "0,30" and "0.30" are the same number to an operator; only one is to JS. */
const toNumber = (value: string): number | null => {
  const clean = value.trim().replace(",", ".");
  if (!clean) return null;
  const parsed = Number(clean);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const toField = (value: unknown): string =>
  value === null || value === undefined || value === "" ? "" : String(value);

export default function AiPricesAdmin({ onSaved }: { onSaved?: () => void }) {
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [usdToBrl, setUsdToBrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Models the ledger has seen but the price list does not cover. */
  const [missing, setMissing] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { data, error: readError } = await supabase
      .from("platform_settings")
      .select("value")
      .eq("key", "ai_prices")
      .maybeSingle();
    if (readError) {
      setError(readError.message);
      setLoadFailed(true);
      setLoading(false);
      return;
    }
    const value = (data?.value ?? {}) as {
      usdToBrl?: number | null;
      models?: Record<string, Partial<ModelPrice>>;
    };
    setUsdToBrl(toField(value.usdToBrl));
    setRows(
      Object.entries(value.models ?? {})
        .map(([model, price]) => ({
          model,
          inPerMillion: toField(price?.inPerMillion),
          outPerMillion: toField(price?.outPerMillion),
        }))
        .sort((a, b) => a.model.localeCompare(b.model)),
    );

    // Which models actually billed the platform. Typing a model name from
    // memory is how a price list ends up covering "claude-opus-5-5 " and
    // pricing nothing.
    const { data: seen } = await supabase.rpc("admin_ai_spend_overview", { window_days: 365 });
    const byModel = ((seen as { byModel?: { model: string; priced: boolean }[] } | null)?.byModel ?? []).filter(
      (entry) => !entry.priced,
    );
    setMissing(byModel.map((entry) => entry.model));
    setLoadFailed(false);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const update = (index: number, field: keyof ModelPrice | "model", value: string) =>
    setRows((current) => current.map((row, at) => (at === index ? { ...row, [field]: value } : row)));

  const save = async () => {
    setSaving(true);
    setSaved(null);
    setError(null);

    const named = rows.filter((row) => row.model.trim());
    const duplicated = named.find(
      (row, index) => named.findIndex((other) => other.model.trim() === row.model.trim()) !== index,
    );
    if (duplicated) {
      setError(`O modelo "${duplicated.model.trim()}" está repetido: cada modelo tem uma linha só.`);
      setSaving(false);
      return;
    }
    for (const row of named) {
      for (const field of ["inPerMillion", "outPerMillion"] as const) {
        if (row[field].trim() && toNumber(row[field]) === null) {
          setError(`Preço inválido em ${row.model.trim()}: use um número, como 0,30.`);
          setSaving(false);
          return;
        }
      }
    }
    const rate = usdToBrl.trim() ? toNumber(usdToBrl) : null;
    if (usdToBrl.trim() && rate === null) {
      setError("Cotação inválida: use um número, como 5,40.");
      setSaving(false);
      return;
    }

    const models: Record<string, Record<string, number | null>> = {};
    for (const row of named) {
      models[row.model.trim()] = {
        inPerMillion: toNumber(row.inPerMillion),
        outPerMillion: toNumber(row.outPerMillion),
      };
    }

    const supabase = createClient();
    const { error: writeError } = await supabase
      .from("platform_settings")
      .upsert({ key: "ai_prices", value: { usdToBrl: rate, models } });
    if (writeError) {
      setError(writeError.message);
      setSaving(false);
      return;
    }

    // Every row already in the ledger is priced again against the new list:
    // otherwise the first weeks of measurement would stay at zero for ever,
    // priced by a list that did not exist when they were written.
    const { data: repriced, error: repriceError } = await supabase.rpc("reprice_ai_spend");
    if (repriceError) {
      setError(`Preços salvos, mas os lançamentos antigos não foram recalculados: ${repriceError.message}`);
      setSaving(false);
      return;
    }

    recordAudit(supabase, "admin.ai_prices.updated", {
      entityType: "platform_settings",
      entityId: "ai_prices",
      metadata: { models: Object.keys(models).length, hasRate: rate !== null, repriced },
    });
    setSaving(false);
    setSaved(
      `${Object.keys(models).length} modelo(s) salvos · ${Number(repriced ?? 0)} lançamento(s) recalculados com os novos preços.`,
    );
    load();
    onSaved?.();
  };

  if (loadFailed) {
    return (
      <Alert
        severity="error"
        className="neutral bg-background-paper/60!"
        action={<Button onClick={load}>Tentar de novo</Button>}
      >
        Não foi possível ler a tabela de preços. {error}
      </Alert>
    );
  }

  return (
    <Box className="flex flex-col gap-4">
      <Typography variant="body1" className="text-text-secondary">
        Quanto cada modelo cobra, por milhão de tokens, na moeda da tabela do provedor (dólar, no caso dos nossos).
        Enquanto um modelo não tiver preço aqui, as chamadas dele entram no livro como <strong>sem preço</strong>, e
        esta página diz quantas são em vez de mostrar um mês barato.
      </Typography>

      {missing.length > 0 && (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          Já houve chamadas a {missing.length === 1 ? "um modelo sem preço" : "modelos sem preço"}:{" "}
          {missing.map((model) => (
            <Chip
              key={model}
              label={model}
              size="small"
              variant="outlined"
              className="mr-1"
              onClick={() =>
                setRows((current) =>
                  current.some((row) => row.model.trim() === model) ? current : [...current, { ...EMPTY, model }],
                )
              }
            />
          ))}
          <br />
          Clique num deles para abrir a linha já com o nome certo.
        </Alert>
      )}

      <Box className="flex flex-row flex-wrap gap-4">
        <TextField
          label="Cotação do dólar (USD para BRL)"
          value={usdToBrl}
          onChange={(event) => setUsdToBrl(event.target.value)}
          disabled={loading || saving}
          helperText="Sem cotação, todo custo aparece só em dólar."
          className="min-w-72 flex-1"
        />
      </Box>

      <Box className="flex flex-col gap-3">
        {rows.map((row, index) => (
          <Box key={index} className="flex flex-row flex-wrap items-start gap-2">
            <TextField
              label="Modelo"
              value={row.model}
              onChange={(event) => update(index, "model", event.target.value)}
              disabled={saving}
              className="min-w-56 flex-1"
              placeholder="claude-opus-5-5"
            />
            <TextField
              label="Entrada por milhão"
              value={row.inPerMillion}
              onChange={(event) => update(index, "inPerMillion", event.target.value)}
              disabled={saving}
              className="w-44"
            />
            <TextField
              label="Saída por milhão"
              value={row.outPerMillion}
              onChange={(event) => update(index, "outPerMillion", event.target.value)}
              disabled={saving}
              className="w-44"
            />
            <IconButton
              aria-label={`Remover ${row.model || "modelo"}`}
              disabled={saving}
              onClick={() => setRows((current) => current.filter((_, at) => at !== index))}
            >
              <NiBinEmpty size="medium" />
            </IconButton>
          </Box>
        ))}

        {rows.length === 0 && !loading && (
          <EmptyState
            icon={<NiMoney size="large" />}
            title="Nenhum preço cadastrado"
            description="Enquanto esta tabela estiver vazia, toda chamada entra como sem preço e o custo de cada escritório aparece como zero. Um preço por modelo já faz os números existirem."
            action={{
              label: missing.length > 0 ? `Começar por ${missing[0]}` : "Adicionar o primeiro modelo",
              onClick: () => setRows([{ ...EMPTY, model: missing.length > 0 ? missing[0] : "" }]),
            }}
          />
        )}
      </Box>

      <Box className="flex flex-row flex-wrap items-center gap-2">
        <Button
          variant="outlined"
          color="grey"
          startIcon={<NiPlus size="medium" />}
          onClick={() => setRows((current) => [...current, { ...EMPTY, model: "" }])}
          disabled={saving}
        >
          Adicionar modelo
        </Button>
        <Button variant="contained" onClick={save} disabled={loading || saving}>
          {saving ? "Salvando…" : "Salvar e recalcular"}
        </Button>
        <Button variant="text" color="grey" startIcon={<NiRefresh size="medium" />} onClick={load} disabled={saving}>
          Recarregar
        </Button>
      </Box>

      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}
      {saved && (
        <Alert severity="success" className="neutral bg-background-paper/60!">
          {saved}
        </Alert>
      )}
    </Box>
  );
}
