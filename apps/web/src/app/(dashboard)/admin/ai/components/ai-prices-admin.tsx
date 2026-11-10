"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Chip, IconButton, TextField, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import IllustrationAnalytics from "@/icons/illustrations/illustration-analytics";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import NiPlus from "@/icons/nexture/ni-plus";
import NiRefresh from "@/icons/nexture/ni-refresh";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

/**
 * The price list behind every cost figure of the platform
 * (`platform_settings`, key `ai_prices`; migrations 0014 and 0043).
 *
 * Until a model has a price here, its calls are recorded as unpriced, and the
 * console says how many calls it could not price instead of reporting a cheap
 * month. Prices are per MILLION tokens, in the currency of the provider's own
 * price list (dollars, for all of ours). The exchange rate is what lets a cost
 * be read in reais; with no rate every cost reads in dollars only, never mixed.
 *
 * A model's entry says what the vendor bills (0043): the audio rate where the
 * vendor prices what a model hears apart, the rates of a request over a number
 * of input tokens (all of it, as Anthropic bills Claude Haiku 5.5), and rates
 * that take effect on a day, so a price announced ahead is written once. Saving
 * keeps whatever else the book holds, for each model and at the top.
 */

type ChangeRow = { from: string; inPerMillion: string; outPerMillion: string };

type PriceRow = {
  model: string;
  inPerMillion: string;
  outPerMillion: string;
  audioInPerMillion: string;
  longAbove: string;
  longIn: string;
  longOut: string;
  changes: ChangeRow[];
  source: string;
  checkedOn: string;
  /** What else the book holds for this model, kept as it was. */
  rest: Record<string, unknown>;
  open: boolean;
};

const KNOWN_KEYS = new Set([
  "inPerMillion",
  "outPerMillion",
  "audioInPerMillion",
  "longContext",
  "changes",
  "source",
  "checkedOn",
]);

const emptyRow = (model = ""): PriceRow => ({
  model,
  inPerMillion: "",
  outPerMillion: "",
  audioInPerMillion: "",
  longAbove: "",
  longIn: "",
  longOut: "",
  changes: [],
  source: "",
  checkedOn: "",
  rest: {},
  open: false,
});

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A day as the book writes it, and a real one: 2027-02-30 is not. */
const isDay = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
};

const dayLabel = (value: string): string => (isDay(value) ? value.split("-").reverse().join("/") : value);

const rateLabel = (value: string): string => value.trim().replace(".", ",");

function rowOf(model: string, price: unknown): PriceRow {
  const entry = isRecord(price) ? price : {};
  const long = isRecord(entry.longContext) ? entry.longContext : {};
  const changes = Array.isArray(entry.changes) ? entry.changes.filter(isRecord) : [];
  return {
    model,
    inPerMillion: toField(entry.inPerMillion),
    outPerMillion: toField(entry.outPerMillion),
    audioInPerMillion: toField(entry.audioInPerMillion),
    longAbove: toField(long.aboveTokensIn),
    longIn: toField(long.inPerMillion),
    longOut: toField(long.outPerMillion),
    changes: changes.map((change) => ({
      from: toField(change.from),
      inPerMillion: toField(change.inPerMillion),
      outPerMillion: toField(change.outPerMillion),
    })),
    source: toField(entry.source),
    checkedOn: toField(entry.checkedOn),
    rest: Object.fromEntries(Object.entries(entry).filter(([key]) => !KNOWN_KEYS.has(key))),
    open: false,
  };
}

/** The first thing wrong with a row, in words for the operator; null when it can be saved. */
function rowProblem(row: PriceRow): string | null {
  const name = row.model.trim();
  const rates: [string, string][] = [
    [row.inPerMillion, "entrada"],
    [row.outPerMillion, "saída"],
    [row.audioInPerMillion, "áudio"],
    [row.longIn, "entrada da faixa longa"],
    [row.longOut, "saída da faixa longa"],
  ];
  for (const [value, what] of rates) {
    if (value.trim() && toNumber(value) === null)
      return `Preço de ${what} inválido em ${name}: use um número, como 0,30.`;
  }
  const hasLong = Boolean(row.longIn.trim() || row.longOut.trim());
  if (hasLong || row.longAbove.trim()) {
    const above = Number(row.longAbove.trim().replace(/\./g, ""));
    if (!Number.isInteger(above) || above <= 0) {
      return `Em ${name}, a faixa longa precisa do número de tokens de entrada a partir do qual vale, como 100000.`;
    }
    if (!hasLong) return `Em ${name}, a faixa longa precisa de ao menos um preço.`;
  }
  const days = new Set<string>();
  for (const change of row.changes) {
    if (!isDay(change.from.trim())) return `Em ${name}, cada mudança precisa de uma data válida.`;
    if (days.has(change.from.trim())) return `Em ${name}, há duas mudanças no mesmo dia.`;
    days.add(change.from.trim());
    for (const value of [change.inPerMillion, change.outPerMillion]) {
      if (value.trim() && toNumber(value) === null) return `Preço inválido numa mudança de ${name}: use um número.`;
    }
    if (!change.inPerMillion.trim() && !change.outPerMillion.trim()) {
      return `Em ${name}, a mudança de ${dayLabel(change.from)} precisa de ao menos um preço.`;
    }
  }
  if (row.checkedOn.trim() && !isDay(row.checkedOn.trim())) return `Em ${name}, a data da conferência é inválida.`;
  return null;
}

/** The model's entry as the book keeps it: what was there and is not edited here stays. */
function entryOf(row: PriceRow): Record<string, unknown> {
  const entry: Record<string, unknown> = {
    ...row.rest,
    inPerMillion: toNumber(row.inPerMillion),
    outPerMillion: toNumber(row.outPerMillion),
  };
  if (row.audioInPerMillion.trim()) entry.audioInPerMillion = toNumber(row.audioInPerMillion);
  if (row.longAbove.trim()) {
    entry.longContext = {
      aboveTokensIn: Number(row.longAbove.trim().replace(/\./g, "")),
      inPerMillion: toNumber(row.longIn),
      outPerMillion: toNumber(row.longOut),
    };
  }
  if (row.changes.length > 0) {
    entry.changes = [...row.changes]
      .sort((a, b) => a.from.trim().localeCompare(b.from.trim()))
      .map((change) => ({
        from: change.from.trim(),
        ...(change.inPerMillion.trim() ? { inPerMillion: toNumber(change.inPerMillion) } : {}),
        ...(change.outPerMillion.trim() ? { outPerMillion: toNumber(change.outPerMillion) } : {}),
      }));
  }
  if (row.source.trim()) entry.source = row.source.trim();
  if (row.checkedOn.trim()) entry.checkedOn = row.checkedOn.trim();
  return entry;
}

/** One line that says what a closed row holds beyond its two rates. */
function rowSummary(row: PriceRow): string | null {
  const parts: string[] = [];
  if (row.audioInPerMillion.trim()) parts.push(`áudio ${rateLabel(row.audioInPerMillion)}`);
  if (row.longAbove.trim()) {
    const above = Number(row.longAbove.trim().replace(/\./g, ""));
    parts.push(
      `acima de ${Number.isFinite(above) ? above.toLocaleString("pt-BR") : row.longAbove} tokens: ${rateLabel(row.longIn) || "igual"} / ${rateLabel(row.longOut) || "igual"}`,
    );
  }
  for (const change of row.changes) {
    parts.push(
      `a partir de ${dayLabel(change.from)}: ${rateLabel(change.inPerMillion) || "igual"} / ${rateLabel(change.outPerMillion) || "igual"}`,
    );
  }
  if (row.checkedOn.trim()) parts.push(`conferido em ${dayLabel(row.checkedOn)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export default function AiPricesAdmin({ onSaved }: { onSaved?: () => void }) {
  const [rows, setRows] = useState<PriceRow[]>([]);
  const [usdToBrl, setUsdToBrl] = useState("");
  /** What else the book holds at the top, kept as it was. */
  const [bookRest, setBookRest] = useState<Record<string, unknown>>({});
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
    const value = isRecord(data?.value) ? data.value : {};
    const models = isRecord(value.models) ? value.models : {};
    setUsdToBrl(toField(value.usdToBrl));
    setBookRest(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "usdToBrl" && key !== "models")));
    setRows(
      Object.entries(models)
        .map(([model, price]) => rowOf(model, price))
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

  const update = (index: number, change: Partial<PriceRow>) =>
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...change } : row)));

  const updateChange = (index: number, changeIndex: number, change: Partial<ChangeRow>) =>
    setRows((current) =>
      current.map((row, at) =>
        at === index
          ? {
              ...row,
              changes: row.changes.map((entry, which) => (which === changeIndex ? { ...entry, ...change } : entry)),
            }
          : row,
      ),
    );

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
      const problem = rowProblem(row);
      if (problem) {
        setError(problem);
        setRows((current) => current.map((entry) => (entry === row ? { ...entry, open: true } : entry)));
        setSaving(false);
        return;
      }
    }
    const rate = usdToBrl.trim() ? toNumber(usdToBrl) : null;
    if (usdToBrl.trim() && rate === null) {
      setError("Cotação inválida: use um número, como 5,40.");
      setSaving(false);
      return;
    }

    const models: Record<string, Record<string, unknown>> = {};
    for (const row of named) models[row.model.trim()] = entryOf(row);

    const supabase = createClient();
    const { error: writeError } = await supabase
      .from("platform_settings")
      .upsert({ key: "ai_prices", value: { ...bookRest, usdToBrl: rate, models } });
    if (writeError) {
      setError(writeError.message);
      setSaving(false);
      return;
    }

    // Every row already in the ledger is priced again against the new list, as
    // of the moment it happened: otherwise the first weeks of measurement would
    // stay at zero for ever, priced by a list that did not exist then.
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
        esta página diz quantas são em vez de mostrar um mês barato. Cada chamada é calculada com o preço do dia em que
        aconteceu.
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
                  current.some((row) => row.model.trim() === model) ? current : [...current, emptyRow(model)],
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
        {rows.map((row, index) => {
          const summary = rowSummary(row);
          return (
            <Box key={index} className="border-grey-100 flex flex-col gap-2 rounded-lg border p-3">
              <Box className="flex flex-row flex-wrap items-start gap-2">
                <IconButton
                  aria-label={
                    row.open
                      ? `Fechar os detalhes de ${row.model || "modelo"}`
                      : `Abrir os detalhes de ${row.model || "modelo"}`
                  }
                  aria-expanded={row.open}
                  onClick={() => update(index, { open: !row.open })}
                  className="mt-2"
                >
                  {row.open ? <NiChevronDownSmall size="medium" /> : <NiChevronRightSmall size="medium" />}
                </IconButton>
                <TextField
                  label="Modelo"
                  value={row.model}
                  onChange={(event) => update(index, { model: event.target.value })}
                  disabled={saving}
                  className="min-w-56 flex-1"
                  placeholder="claude-opus-5-5"
                />
                <TextField
                  label="Entrada por milhão"
                  value={row.inPerMillion}
                  onChange={(event) => update(index, { inPerMillion: event.target.value })}
                  disabled={saving}
                  className="w-44"
                />
                <TextField
                  label="Saída por milhão"
                  value={row.outPerMillion}
                  onChange={(event) => update(index, { outPerMillion: event.target.value })}
                  disabled={saving}
                  className="w-44"
                />
                <IconButton
                  aria-label={`Remover ${row.model || "modelo"}`}
                  disabled={saving}
                  onClick={() => setRows((current) => current.filter((_, at) => at !== index))}
                  className="mt-2"
                >
                  <NiBinEmpty size="medium" />
                </IconButton>
              </Box>

              {!row.open && summary && (
                <Typography variant="body2" className="text-text-secondary pl-12">
                  {summary}
                </Typography>
              )}

              {row.open && (
                <Box className="flex flex-col gap-3 pl-12">
                  <TextField
                    label="Áudio por milhão"
                    value={row.audioInPerMillion}
                    onChange={(event) => update(index, { audioInPerMillion: event.target.value })}
                    disabled={saving}
                    helperText="Só quando o provedor cobra o áudio à parte. Vazio: o áudio custa como a entrada."
                    className="max-w-sm"
                  />

                  <Typography variant="subtitle2">Pedido longo</Typography>
                  <Box className="flex flex-row flex-wrap items-start gap-2">
                    <TextField
                      label="Acima de quantos tokens de entrada"
                      value={row.longAbove}
                      onChange={(event) => update(index, { longAbove: event.target.value })}
                      disabled={saving}
                      helperText="O pedido inteiro passa a pagar os preços ao lado."
                      className="min-w-64 flex-1"
                    />
                    <TextField
                      label="Entrada por milhão"
                      value={row.longIn}
                      onChange={(event) => update(index, { longIn: event.target.value })}
                      disabled={saving}
                      className="w-44"
                    />
                    <TextField
                      label="Saída por milhão"
                      value={row.longOut}
                      onChange={(event) => update(index, { longOut: event.target.value })}
                      disabled={saving}
                      className="w-44"
                    />
                  </Box>

                  <Typography variant="subtitle2">Mudanças de preço anunciadas</Typography>
                  {row.changes.map((change, changeIndex) => (
                    <Box key={changeIndex} className="flex flex-row flex-wrap items-start gap-2">
                      <TextField
                        label="A partir de"
                        type="date"
                        value={change.from}
                        onChange={(event) => updateChange(index, changeIndex, { from: event.target.value })}
                        disabled={saving}
                        slotProps={{ inputLabel: { shrink: true } }}
                        className="w-44"
                      />
                      <TextField
                        label="Entrada por milhão"
                        value={change.inPerMillion}
                        onChange={(event) => updateChange(index, changeIndex, { inPerMillion: event.target.value })}
                        disabled={saving}
                        className="w-44"
                      />
                      <TextField
                        label="Saída por milhão"
                        value={change.outPerMillion}
                        onChange={(event) => updateChange(index, changeIndex, { outPerMillion: event.target.value })}
                        disabled={saving}
                        className="w-44"
                      />
                      <IconButton
                        aria-label={`Remover a mudança de ${dayLabel(change.from) || "preço"}`}
                        disabled={saving}
                        onClick={() =>
                          update(index, { changes: row.changes.filter((_, which) => which !== changeIndex) })
                        }
                        className="mt-2"
                      >
                        <NiBinEmpty size="medium" />
                      </IconButton>
                    </Box>
                  ))}
                  <Box>
                    <Button
                      variant="text"
                      color="grey"
                      startIcon={<NiPlus size="medium" />}
                      disabled={saving}
                      onClick={() =>
                        update(index, { changes: [...row.changes, { from: "", inPerMillion: "", outPerMillion: "" }] })
                      }
                    >
                      Adicionar mudança
                    </Button>
                  </Box>

                  <Typography variant="subtitle2">De onde vem o preço</Typography>
                  <Box className="flex flex-row flex-wrap items-start gap-2">
                    <TextField
                      label="Página da tabela do provedor"
                      value={row.source}
                      onChange={(event) => update(index, { source: event.target.value })}
                      disabled={saving}
                      className="min-w-72 flex-1"
                    />
                    <TextField
                      label="Conferido em"
                      type="date"
                      value={row.checkedOn}
                      onChange={(event) => update(index, { checkedOn: event.target.value })}
                      disabled={saving}
                      slotProps={{ inputLabel: { shrink: true } }}
                      className="w-44"
                    />
                  </Box>
                </Box>
              )}
            </Box>
          );
        })}

        {rows.length === 0 && !loading && (
          <EmptyState
            illustration={<IllustrationAnalytics />}
            title="Nenhum preço cadastrado"
            description="Enquanto esta tabela estiver vazia, toda chamada entra como sem preço e o custo de cada escritório aparece como zero. Um preço por modelo já faz os números existirem."
            action={{
              label: missing.length > 0 ? `Começar por ${missing[0]}` : "Adicionar o primeiro modelo",
              onClick: () => setRows([emptyRow(missing.length > 0 ? missing[0] : "")]),
            }}
          />
        )}
      </Box>

      <Box className="flex flex-row flex-wrap items-center gap-2">
        <Button
          variant="outlined"
          color="grey"
          startIcon={<NiPlus size="medium" />}
          onClick={() => setRows((current) => [...current, { ...emptyRow(), open: true }])}
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
