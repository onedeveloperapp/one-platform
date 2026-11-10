"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Box, MenuItem, TextField } from "@mui/material";

import StateLine from "@/components/product/state-line";
import {
  type CaseMoneyPath,
  type MoneyPath as Path,
  readCaseMoneyPath,
  readFirmMoneyPath,
  setCaseMoneyPath,
  setFirmMoneyPath,
} from "@/lib/finance/money-actions";

const FIRM_WAY_KEY: Record<Path, string> = { firm: "money-path-firm", direct: "money-path-direct" };
const ERROR_KEY: Record<string, string> = {
  not_allowed: "money-error-not-allowed",
  support_visit: "money-error-support",
  second_factor: "money-error-second-factor",
};

/**
 * The way the money a court releases takes (migration 0158): the firm's account by default, the court paying the
 * client directly where the firm or the case chose it and the court accepts it. Of the firm (the books'
 * configuration) or of one case (its money card), read where it is shown and changed in place by who may.
 */
export default function MoneyPath({ caseId, writes }: { caseId: string | null; writes: boolean }) {
  const t = useTranslations("product");
  const [firm, setFirm] = useState<Path | null>(null);
  const [ofCase, setOfCase] = useState<CaseMoneyPath | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const read = caseId
      ? readCaseMoneyPath(caseId).then((answer) => live && setOfCase(answer))
      : readFirmMoneyPath().then((answer) => live && setFirm(answer));
    void read.catch(() => undefined);
    return () => {
      live = false;
    };
  }, [caseId]);

  const save = async (value: string) => {
    setBusy(true);
    setProblem(null);
    const chosen = value === "firm" || value === "direct" ? value : null;
    const result = caseId
      ? await setCaseMoneyPath(caseId, chosen).catch(() => ({ ok: false as const, code: "failed" }))
      : await setFirmMoneyPath(chosen ?? "firm").catch(() => ({ ok: false as const, code: "failed" }));
    setBusy(false);
    if (!result.ok) {
      setProblem(t(ERROR_KEY[result.code] ?? "money-error-failed"));
      return;
    }
    if (caseId) setOfCase(await readCaseMoneyPath(caseId).catch(() => ofCase));
    else setFirm(chosen ?? "firm");
  };

  if (caseId) {
    if (!ofCase) return null;
    const way = ofCase.case ?? ofCase.firm;
    const direct = way === "direct" && ofCase.accepts === true;
    return (
      <Box className="flex flex-col gap-2">
        <StateLine tone="info">{direct ? t("money-path-case-direct") : t("money-path-case-firm")}</StateLine>
        {way === "direct" && ofCase.accepts !== true ? (
          <StateLine tone="attention">{t("money-path-court-no")}</StateLine>
        ) : null}
        {writes ? (
          <TextField
            select
            size="small"
            label={t("money-path-case-label")}
            value={ofCase.case ?? "follow"}
            disabled={busy}
            onChange={(event) => void save(event.target.value)}
            className="max-w-sm"
          >
            <MenuItem value="follow">{t("money-path-follow", { way: t(FIRM_WAY_KEY[ofCase.firm]) })}</MenuItem>
            <MenuItem value="firm">{t("money-path-firm")}</MenuItem>
            <MenuItem value="direct" disabled={ofCase.accepts !== true}>
              {t("money-path-direct")}
            </MenuItem>
          </TextField>
        ) : null}
        {problem ? <StateLine tone="failed">{problem}</StateLine> : null}
      </Box>
    );
  }

  if (!firm) return null;
  return (
    <Box className="flex flex-col gap-2">
      <TextField
        select
        size="small"
        label={t("money-path-firm-label")}
        value={firm}
        disabled={busy || !writes}
        onChange={(event) => void save(event.target.value)}
        className="max-w-sm"
        helperText={firm === "direct" ? t("money-path-direct-help") : t("money-path-firm-help")}
      >
        <MenuItem value="firm">{t("money-path-firm")}</MenuItem>
        <MenuItem value="direct">{t("money-path-direct")}</MenuItem>
      </TextField>
      {problem ? <StateLine tone="failed">{problem}</StateLine> : null}
    </Box>
  );
}
