"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import { CurrencyField } from "@/components/product/fields";
import { readSettlementFloors, saveSettlementFloor } from "@/lib/firm/settlement-actions";
import type { CaseKind } from "@/lib/modules/types";

/**
 * The value the firm settles for at least, per kind of problem (migration 0187): what the brief of a hearing says to
 * who goes to it, two business days before. Said by who decides for the firm, with the second factor; a kind left
 * blank says the firm gave no value. Each module's settings show its own kinds of problem, and save only those.
 */
export default function SettlementFloorCard({ editable, kinds }: { editable: boolean; kinds: readonly CaseKind[] }) {
  const t = useTranslations("product");
  const [values, setValues] = useState<Record<string, string>>({});
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void readSettlementFloors().then((floors) => {
      setValues(Object.fromEntries(Object.entries(floors).map(([kind, cents]) => [kind, String(cents / 100)])));
      setLoaded(true);
    });
  }, []);

  const errorKey = problem === "second_factor" ? "settlement-floor-error-factor" : "settlement-floor-error";
  const save = async () => {
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      for (const { key: kind } of kinds) {
        const typed = values[kind]?.trim() ?? "";
        const cents = typed === "" ? null : Math.round(Number(typed) * 100);
        if (cents !== null && (!Number.isFinite(cents) || cents <= 0)) {
          setProblem("invalid_value");
          return;
        }
        const result = await saveSettlementFloor(kind, cents);
        if (!result.ok) {
          setProblem(result.code);
          return;
        }
      }
      setSaved(true);
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <CollapsibleCard
      id="valor-minimo-de-acordo"
      title={t("settlement-floor-title")}
      description={t("settlement-floor-body")}
      defaultOpen={false}
    >
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(errorKey)}
        </Alert>
      ) : saved ? (
        <Alert severity="success" className="neutral bg-background-paper/60!">
          {t("settlement-floor-saved")}
        </Alert>
      ) : null}
      <Box className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {kinds.map((kind) => (
          <CurrencyField
            key={kind.key}
            size="small"
            id={`settlement-floor-${kind.key}`}
            name={`settlement-floor-${kind.key}`}
            label={t(kind.labelKey)}
            currencySymbol="R$"
            value={values[kind.key] ?? ""}
            disabled={!editable || !loaded || busy}
            onChange={(event) => setValues((before) => ({ ...before, [kind.key]: event.target.value }))}
          />
        ))}
      </Box>
      {editable ? (
        <Box>
          <Button variant="contained" size="small" disabled={busy || !loaded} onClick={() => void save()}>
            {busy ? t("cases-working") : t("settlement-floor-save")}
          </Button>
        </Box>
      ) : (
        <Typography variant="body2" className="text-text-secondary">
          {t("settlement-floor-readonly")}
        </Typography>
      )}
    </CollapsibleCard>
  );
}
