"use client";

import type { CaseProceeding, CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, TextField, Typography } from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import type { Fact } from "@/components/product/fact-grid";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiExternal from "@/icons/nexture/ni-external";
import { decideCourtSystem } from "@/lib/cases/actions";
import { caseErrorKey } from "@/lib/cases/cases";
import type { CourtSystemSignal } from "@/lib/publications/djen-watch";
import { readSystemSignal } from "@/lib/publications/djen-watch-actions";

type Ready = Extract<CaseState, { kind: "ready" }>;
type T = ReturnType<typeof useTranslations<"product">>;

const SYSTEM_KEY: Record<string, string> = {
  projudi: "case-system-projudi",
  eproc: "case-system-eproc",
  pje: "case-system-pje",
  esaj: "case-system-esaj",
  outro: "case-system-outro",
};

const day = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));

const systemName = (t: T, system: string | null) =>
  system ? (SYSTEM_KEY[system] ? t(SYSTEM_KEY[system]) : system) : null;

const nameIn = (state: Ready, userId: string | null) =>
  (userId ? state.team.find((member) => member.userId === userId)?.name : null) || null;

/** Whether this person may approve the system of this lawsuit, and whether it waits for that. */
export function systemWaits(state: Ready, proceeding: CaseProceeding, writable: boolean) {
  const waits = proceeding.status === "planned" && proceeding.system !== null && !proceeding.systemApproval;
  return { waits, mayDecide: writable && state.decidesCourtSystem && proceeding.system !== null };
}

/**
 * The system of a lawsuit as one of its facts (the owner, 2026-11-13, who found the lawsuit's card disordered: the
 * system sat in a box of its own inside the lawsuit, with two lines of ONE's reasons): its name, the firm's word on
 * it under the name once given, and how ONE chose it behind the "i". A planned lawsuit whose court the platform has
 * not mapped yet says so in its place.
 */
export function courtSystemFact(t: T, state: Ready, proceeding: CaseProceeding): Fact {
  const label = systemName(t, proceeding.system);
  const base = { key: "system", label: t("case-proceeding-fact-system") };
  if (proceeding.status !== "planned") return { ...base, value: label };
  if (!label) {
    return {
      ...base,
      owed: <StatusChip tone="neutral" label={t("case-proceeding-system-platform")} />,
      hint: t("case-proceeding-system-none"),
    };
  }
  const row = state.courtSystems.find((item) => item.court === proceeding.court && item.kind === proceeding.kind);
  const approval = proceeding.systemApproval;
  const how = proceeding.systemByOne
    ? [
        t(row?.confirmed ? "case-proceeding-system-one-confirmed" : "case-proceeding-system-one"),
        row?.source ? t("case-proceeding-system-source", { source: row.source }) : t("case-proceeding-system-may-err"),
      ].join(" ")
    : t("case-proceeding-system-firm");
  return {
    ...base,
    value: (
      <Box component="span" className="flex flex-col">
        <span>{label}</span>
        {approval ? (
          <Typography variant="caption" component="span" className="text-text-secondary">
            {nameIn(state, approval.by)
              ? t("case-proceeding-system-approved-short", {
                  name: nameIn(state, approval.by) ?? "",
                  date: day(approval.at),
                })
              : t("case-proceeding-system-approved-firm", { date: day(approval.at) })}
          </Typography>
        ) : null}
      </Box>
    ),
    hint: how,
  };
}

/**
 * What the system of a planned lawsuit (migration 0066) still asks of the firm, and nothing else: ONE names it from
 * the platform's table of each court's systems, and the firm approves it or not. Waiting, it is one line on the
 * attention tint with the system to open and the two answers beside it; not approved, why and that the package
 * waits; approved, nothing here (the fact says who and when). A sign in the DJEN that the court changed system is
 * its own line above. The firm never picks a system.
 */
export default function CourtSystem({
  state,
  proceeding,
  writable,
  onChanged,
}: {
  state: Ready;
  proceeding: CaseProceeding;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [refusing, setRefusing] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The DJEN's recent links of the lawsuit's court and kind (0201), read while its system waits for the firm's word.
  const [signal, setSignal] = useState<CourtSystemSignal | null>(null);
  const asksSignal = proceeding.status === "planned" && !proceeding.systemApproval && Boolean(proceeding.court);
  useEffect(() => {
    if (!asksSignal || !proceeding.court) return;
    let live = true;
    void readSystemSignal(proceeding.court, proceeding.kind)
      .then((answer) => {
        if (live) setSignal(answer);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [asksSignal, proceeding.court, proceeding.kind]);

  const label = systemName(t, proceeding.system);
  if (proceeding.status !== "planned" || !label || proceeding.systemApproval) return null;

  const row = state.courtSystems.find((item) => item.court === proceeding.court && item.kind === proceeding.kind);
  const { mayDecide } = systemWaits(state, proceeding, writable);
  const refusal = proceeding.systemRefusal;

  const decide = async (approve: boolean) => {
    setBusy(true);
    setProblem(null);
    const result = await decideCourtSystem({
      caseId: state.case.id,
      proceedingId: proceeding.id,
      approve,
      reason: approve ? null : reason,
    });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.code);
      return;
    }
    setRefusing(false);
    setReason("");
    onChanged();
  };

  const open = row?.host ? (
    <Button
      variant="text"
      color="grey"
      size="small"
      className="-ml-1 self-start px-1"
      href={`https://${row.host}`}
      target="_blank"
      rel="noopener noreferrer"
      endIcon={<NiExternal size="small" />}
    >
      {t("case-proceeding-system-open-named", { system: label })}
    </Button>
  ) : null;

  return (
    <>
      {signal && signal.seenSystem !== proceeding.system ? (
        <StateLine tone="attention">
          {t("case-proceeding-system-signal", {
            system: SYSTEM_KEY[signal.seenSystem] ? t(SYSTEM_KEY[signal.seenSystem]) : signal.seenSystem,
            percent: signal.percent,
            total: signal.total,
          })}
        </StateLine>
      ) : null}

      <StateLine
        tone={mayDecide ? "attention" : "waiting"}
        emphasis={mayDecide}
        action={
          mayDecide ? (
            <Box className="flex flex-wrap items-center gap-2">
              {!refusal ? (
                <Button variant="text" color="grey" size="small" disabled={busy} onClick={() => setRefusing(true)}>
                  {t("case-proceeding-system-refuse")}
                </Button>
              ) : null}
              <Button variant="contained" size="small" disabled={busy} onClick={() => void decide(true)}>
                {busy && !refusing ? t("cases-working") : t("case-proceeding-system-approve")}
              </Button>
            </Box>
          ) : undefined
        }
      >
        <Box component="span" className="flex flex-col gap-0.5">
          <span>
            {refusal
              ? nameIn(state, refusal.by)
                ? t("case-proceeding-system-refused", {
                    name: nameIn(state, refusal.by) ?? "",
                    date: day(refusal.at),
                    reason: refusal.reason,
                  })
                : t("case-proceeding-system-refused-firm", { date: day(refusal.at), reason: refusal.reason })
              : mayDecide
                ? t("case-proceeding-system-ask", { system: label })
                : t("case-proceeding-system-who")}
          </span>
          {refusal ? (
            <Typography variant="body2" component="span" className="text-text-secondary">
              {t("case-proceeding-system-refused-wait")}
            </Typography>
          ) : null}
          {open}
        </Box>
      </StateLine>

      {problem && !refusing ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(caseErrorKey(problem))}
        </Alert>
      ) : null}

      <Dialog
        open={refusing}
        onClose={busy ? undefined : () => setRefusing(false)}
        maxWidth="xs"
        fullWidth
        aria-labelledby={`court-system-refuse-${proceeding.id}`}
      >
        <DialogHeader
          id={`court-system-refuse-${proceeding.id}`}
          title={t("case-proceeding-system-refuse-title")}
          onClose={() => setRefusing(false)}
          closeLabel={t("cases-close")}
        />
        <DialogContent>
          <Box className="flex flex-col gap-3 pt-1">
            <Typography variant="body2">{t("case-proceeding-system-refuse-body", { system: label })}</Typography>
            <TextField
              fullWidth
              multiline
              minRows={3}
              size="small"
              id={`court-system-reason-${proceeding.id}`}
              label={t("case-proceeding-system-refuse-reason")}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
              error={problem === "reason_required"}
              helperText={
                problem === "reason_required" ? t(caseErrorKey(problem)) : t("case-proceeding-system-refuse-help")
              }
              slotProps={{ htmlInput: { maxLength: 500 } }}
            />
            {problem && problem !== "reason_required" && (
              <Alert severity="error" className="neutral bg-background-paper/60!">
                {t(caseErrorKey(problem))}
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={() => setRefusing(false)} disabled={busy}>
            {t("cases-cancel")}
          </Button>
          <Button variant="contained" onClick={() => void decide(false)} disabled={busy}>
            {busy ? t("cases-working") : t("case-proceeding-system-refuse-submit")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
