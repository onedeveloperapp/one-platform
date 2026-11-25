"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, MenuItem, TextField, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import QuickActions from "@/components/product/quick-actions";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import IllustrationAccounts from "@/icons/illustrations/illustration-accounts";
import NiMoney from "@/icons/nexture/ni-money";
import { caseLabel } from "@/lib/cases/cases";
import { openFinanceDocument } from "@/lib/finance/document-actions";
import { HOLD_KEY, MINOR_ORDER_KEY, type MoneyShare, SHARE_STATUS_KEY, shareLate } from "@/lib/finance/money";
import {
  decideMoneyHold,
  readMoneyShareList,
  recordMinorOrder,
  recordMoneyTransfer,
  requestMoneyStatement,
} from "@/lib/finance/money-actions";
import { formatCents } from "@flyee/rules/finance";
import { formatDayBr } from "@flyee/rules/person";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const day = (value: string | null) => (value ? (formatDayBr(value) ?? value) : "");
const ERROR_KEY: Record<string, string> = {
  not_allowed: "money-error-not-allowed",
  support_visit: "money-error-support",
  second_factor: "money-error-second-factor",
  not_owed: "money-error-not-owed",
  invalid_data: "money-error-invalid",
};
const errorKey = (code: string) => ERROR_KEY[code] ?? "money-error-failed";
const ACCOUNT_KEY = { pix: "money-account-pix", conta: "money-account-bank" } as const;
const DECISION_KEY = {
  lowered: "money-decide-lowered",
  paid_whole: "money-decide-paid-whole",
  resent: "money-decide-resent",
} as const;

/**
 * The clients' parts of what the courts released (migration 0135), for who reads the books: each person's part, what
 * the firm kept and why, what is passed on and by when (in red once late), what is held for a partner or for the judge,
 * and what the client confirmed. ONE never pays: the firm pays at its bank and records it here. Of one case or every
 * one; read again after each act.
 */
export default function MoneyShares({
  caseId,
  onLoaded,
  onChanged,
}: {
  caseId: string | null;
  onLoaded?: (shares: MoneyShare[]) => void;
  /** A part was written (a transfer, a statement asked, a hold decided): the screen around reads itself again now. */
  onChanged?: () => void;
}) {
  const t = useTranslations("product");
  const [shares, setShares] = useState<MoneyShare[] | null | "error">(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [paying, setPaying] = useState<MoneyShare | null>(null);
  const [deciding, setDeciding] = useState<MoneyShare | null>(null);

  const load = useCallback(async () => {
    try {
      const read = await readMoneyShareList(caseId);
      setShares(read ?? "error");
      if (read) onLoaded?.(read);
    } catch {
      setShares("error");
    }
  }, [caseId, onLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: () => Promise<{ ok: true } | { ok: false; code: string }>) => {
    setProblem(null);
    const result = await work();
    if (!result.ok) setProblem(t(errorKey(result.code)));
    await load();
    if (result.ok) onChanged?.();
    return result;
  };

  if (shares === null) return null;
  if (shares === "error") {
    return (
      <Alert severity="error" className="neutral bg-background-paper/60!">
        {t("money-load-error")}
      </Alert>
    );
  }
  if (shares.length === 0) {
    return caseId ? (
      <Typography variant="body2" className="text-text-secondary">
        {t("money-none-case")}
      </Typography>
    ) : (
      <EmptyState
        illustration={<IllustrationAccounts />}
        title={t("money-none-title")}
        description={t("money-none-body")}
      />
    );
  }
  const now = today();
  return (
    <Box className="flex flex-col gap-3">
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {problem}
        </Alert>
      ) : null}
      <Box component="ul" className="m-0 flex list-none flex-col p-0">
        {shares.map((share) => {
          const late = shareLate(share, now);
          return (
            <Box
              component="li"
              key={share.id}
              className="border-grey-100 flex items-start gap-3 border-b py-3 last:border-b-0"
            >
              <Box className="flex min-w-0 flex-1 flex-col gap-1">
                <Typography variant="body1" className="font-semibold">
                  {[
                    share.person ?? t("money-person-unknown"),
                    !caseId && share.caseSeq !== null ? caseLabel(share.caseSeq) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {t("money-line", {
                    gross: formatCents(share.grossCents),
                    fees: formatCents(share.feesCents),
                    costs: formatCents(share.costsCents),
                    payable: formatCents(share.payableCents),
                  })}
                </Typography>
                {share.held.map((hold) => (
                  <StateLine key={hold.reason} tone="attention">
                    {t(HOLD_KEY[hold.reason], { value: formatCents(hold.cents) })}
                  </StateLine>
                ))}
                {share.minorOrder ? <StateLine tone="info">{t(MINOR_ORDER_KEY[share.minorOrder])}</StateLine> : null}
                {share.status === "owed" && share.dueOn ? (
                  <StateLine tone={late ? "failed" : "waiting"}>
                    {t(late ? "money-due-late" : "money-due-on", { day: day(share.dueOn) })}
                  </StateLine>
                ) : null}
                {share.status === "paid" ? (
                  <StateLine tone="done">
                    {t(share.paidByOne ? "money-paid-on-by-one" : "money-paid-on", { day: day(share.paidOn) })}
                  </StateLine>
                ) : null}
                {share.receivedByOne ? (
                  <Typography variant="caption" className="text-text-secondary">
                    {t("money-received-by-one")}
                  </Typography>
                ) : null}
                {share.account ? (
                  <Typography variant="caption" className="text-text-secondary">
                    {t(ACCOUNT_KEY[share.account.kind], { ends: share.account.ends })}
                  </Typography>
                ) : share.status === "owed" ? (
                  <Typography variant="caption" className="text-text-secondary">
                    {t("money-account-missing")}
                  </Typography>
                ) : null}
                {share.confirmedAt ? <StateLine tone="done">{t("money-confirmed")}</StateLine> : null}
                {share.statement ? (
                  <StateLine
                    tone={
                      share.statement.status === "issued"
                        ? "done"
                        : share.statement.status === "failed"
                          ? "failed"
                          : share.statement.status === "waiting"
                            ? "attention"
                            : "waiting"
                    }
                  >
                    {t(`money-statement-${share.statement.status}`)}
                  </StateLine>
                ) : null}
              </Box>
              <Box className="flex shrink-0 flex-col items-end gap-2">
                <StatusChip
                  tone={
                    late
                      ? "danger"
                      : share.status === "paid" || share.status === "direct"
                        ? "positive"
                        : share.status === "owed"
                          ? "attention"
                          : "neutral"
                  }
                  label={t(SHARE_STATUS_KEY[share.status])}
                />
                {!caseId ? (
                  <Button size="small" variant="text" href={`/casos/${share.caseId}#dinheiro`} LinkComponent={Link}>
                    {t("money-open-case")}
                  </Button>
                ) : null}
                {share.status === "owed" ? (
                  <Button size="small" variant="outlined" color="grey" onClick={() => setPaying(share)}>
                    {t("money-record-transfer")}
                  </Button>
                ) : null}
                {share.statement?.status === "issued" && share.statement.fileId ? (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() =>
                      void openFinanceDocument(share.statement?.fileId as string).then((link) => {
                        if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
                      })
                    }
                  >
                    {t("money-statement-open")}
                  </Button>
                ) : share.statement?.status === "waiting" || share.statement?.status === "failed" ? (
                  <Button
                    size="small"
                    variant="outlined"
                    color="grey"
                    onClick={() => void act(() => requestMoneyStatement(share.id))}
                  >
                    {t("money-statement-ask")}
                  </Button>
                ) : null}
                {share.status === "held" ? (
                  <Button size="small" variant="outlined" color="grey" onClick={() => setDeciding(share)}>
                    {t("money-decide")}
                  </Button>
                ) : null}
                {share.status === "minor" ? (
                  <QuickActions
                    label={t("money-minor-actions")}
                    actions={(["deposited", "released", "accounts"] as const).map((order) => ({
                      key: order,
                      label: t(MINOR_ORDER_KEY[order]),
                      onClick: () => void act(() => recordMinorOrder(share.id, order)),
                    }))}
                  />
                ) : null}
              </Box>
            </Box>
          );
        })}
      </Box>

      {paying ? (
        <TransferPanel
          share={paying}
          onClose={() => setPaying(null)}
          onSave={async (paidOn) => {
            const result = await act(() => recordMoneyTransfer(paying.id, paidOn));
            if (result.ok) setPaying(null);
          }}
        />
      ) : null}
      {deciding ? (
        <DecisionPanel
          share={deciding}
          onClose={() => setDeciding(null)}
          onDecide={async (decision) => {
            setProblem(null);
            const result = await decideMoneyHold(deciding.id, decision);
            if (result.ok) {
              setDeciding(null);
              await load();
              onChanged?.();
            }
            return result;
          }}
        />
      ) : null}
    </Box>
  );
}

function TransferPanel({
  share,
  onClose,
  onSave,
}: {
  share: MoneyShare;
  onClose: () => void;
  onSave: (paidOn: string) => Promise<void>;
}) {
  const t = useTranslations("product");
  const [paidOn, setPaidOn] = useState(today());
  const [busy, setBusy] = useState(false);
  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("money-cancel")}
      icon={<NiMoney size="medium" />}
      tone="accent-2"
      busy={busy}
      title={t("money-record-transfer")}
      description={t("money-transfer-body", { value: formatCents(share.payableCents), person: share.person ?? "" })}
      onSubmit={() => {
        setBusy(true);
        void onSave(paidOn).finally(() => setBusy(false));
      }}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
            {t("money-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("money-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-4">
        <TextField
          type="date"
          label={t("money-paid-day")}
          value={paidOn}
          onChange={(event) => setPaidOn(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <StateLine tone="info">{t("money-transfer-note")}</StateLine>
      </Box>
    </SidePanel>
  );
}

function DecisionPanel({
  share,
  onClose,
  onDecide,
}: {
  share: MoneyShare;
  onClose: () => void;
  onDecide: (decision: "lowered" | "paid_whole" | "resent") => Promise<{ ok: true } | { ok: false; code: string }>;
}) {
  const t = useTranslations("product");
  const capped = share.held.some((hold) => hold.reason === "cap_art50");
  const choices = (capped ? ["lowered", "paid_whole", "resent"] : ["paid_whole", "resent"]) as (
    | "lowered"
    | "paid_whole"
    | "resent"
  )[];
  const [decision, setDecision] = useState(choices[0]!);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [factor, setFactor] = useState(false);
  const run = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await onDecide(decision);
      if (!result.ok) {
        if (result.code === "second_factor") setFactor(true);
        setProblem(t(errorKey(result.code)));
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("money-cancel")}
      icon={<NiMoney size="medium" />}
      tone="accent-2"
      busy={busy}
      title={t("money-decide-title")}
      description={t("money-decide-body", { value: formatCents(share.heldCents), person: share.person ?? "" })}
      onSubmit={() => void run()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
            {t("money-decide-confirm")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("money-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-4">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {problem}
          </Alert>
        ) : null}
        <TextField
          select
          label={t("money-decide-choice")}
          value={decision}
          onChange={(event) => setDecision(event.target.value as typeof decision)}
        >
          {choices.map((choice) => (
            <MenuItem key={choice} value={choice}>
              {t(DECISION_KEY[choice])}
            </MenuItem>
          ))}
        </TextField>
        {factor ? <SecondFactorPrompt state="challenge" onConfirmed={() => setFactor(false)} /> : null}
      </Box>
    </SidePanel>
  );
}
