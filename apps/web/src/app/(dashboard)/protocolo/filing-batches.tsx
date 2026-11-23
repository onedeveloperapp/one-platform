"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
  Typography,
} from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import OutcomeDialog, { type OutcomeLine } from "@/components/product/outcome-dialog";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import StateLine from "@/components/product/state-line";
import { useLiveRead } from "@/components/product/use-live-read";
import NiCheck from "@/icons/nexture/ni-check";
import NiClock from "@/icons/nexture/ni-clock";
import NiExclamationSquare from "@/icons/nexture/ni-exclamation-square";
import { caseLabel } from "@/lib/cases/cases";
import {
  approveFilingBatch,
  confirmFilingSubmission,
  giveBatchCode,
  openBatchSummary,
  stopFilingBatch,
} from "@/lib/filing-ways/actions";
import {
  batchCounts,
  type BatchTurn,
  batchTurn,
  type BatchView,
  type EligibleGroup,
  heldSubmission,
  stopFixedInWays,
  type StoppedBatch,
  stopReason,
} from "@/lib/filing-ways/batches";
import type { FilingBatchesState } from "@/lib/filing-ways/batches-read";
import { readBatchesPulse } from "@/lib/filing-ways/pulse-read";

const WAY_KEY = { browser: "filing-batches-way-browser", extension: "filing-batches-way-extension" } as const;
const CODE_KIND_KEY = { app: "filing-batches-code-app", email: "filing-batches-code-email" } as const;
const DONE_KEY = { browser: "filing-batches-done-browser", extension: "filing-batches-done-extension" } as const;
const APPROVE_KEY = {
  browser: "filing-batches-approve-browser",
  extension: "filing-batches-approve-extension",
} as const;

/** Each turn of a batch: the words of its line and its tone. */
const TURN: Record<BatchTurn, { key: string; tone: "done" | "waiting" | "attention" }> = {
  code_mine: { key: "filing-batches-turn-code-mine", tone: "attention" },
  code_theirs: { key: "filing-batches-turn-code-theirs", tone: "waiting" },
  confirm_mine: { key: "filing-batches-turn-confirm-mine", tone: "attention" },
  confirm_theirs: { key: "filing-batches-turn-confirm-theirs", tone: "waiting" },
  extension_mine: { key: "filing-batches-turn-extension-mine", tone: "attention" },
  extension_theirs: { key: "filing-batches-turn-extension-theirs", tone: "waiting" },
  one_waits_browser: { key: "filing-batches-turn-one-waits-browser", tone: "waiting" },
  one_files: { key: "filing-batches-turn-one-files", tone: "waiting" },
};

const ERROR_KEYS = new Set([
  "second_factor_required",
  "not_allowed_in_support_session",
  "way_not_automated",
  "no_court_login",
  "nothing_to_file",
  "not_asked",
  "not_confirming",
  "invalid_code",
  "vault_not_configured",
]);
const errorKey = (code: string): string =>
  ERROR_KEYS.has(code) ? `filing-batches-error-${code}` : "filing-batches-error";

/**
 * What ONE files on the courts' screens, on /protocolo (the owner, 2026-11-20; migration 0264): the batches in course,
 * each saying whose turn it is (the court's code and the confirmation of ONE's first filing in a system are asked here
 * of the batch's lawyer), and, for a lawyer, the packages ready that they may hand ONE, by system, approved in one act
 * with the second factor. It follows the database while it is open, so a code the court asks shows by itself.
 */
export default function FilingBatches({ state, firmId }: { state: FilingBatchesState; firmId: string }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [approving, setApproving] = useState<EligibleGroup | null>(null);

  useLiveRead({
    stamp: state.pulse,
    read: useCallback(() => readBatchesPulse(firmId), [firmId]),
    busy: state.batches.length > 0,
    onChange: () => router.refresh(),
  });

  if (
    state.batches.length === 0 &&
    state.stopped.length === 0 &&
    state.eligible.length === 0 &&
    state.unchosen.length === 0
  ) {
    return null;
  }

  return (
    <CollapsibleCard
      id="filing-batches"
      title={t("filing-batches-title")}
      description={t("filing-batches-description")}
      defaultOpen
      bodyClassName="gap-5"
    >
      {state.eligible.map((group) => (
        <StateLine
          key={group.system.key}
          tone="attention"
          action={
            <Button size="small" variant="contained" onClick={() => setApproving(group)}>
              {t("filing-batches-file")}
            </Button>
          }
        >
          {t("filing-batches-ready", { count: group.packages.length, system: group.system.name })}
        </StateLine>
      ))}

      {/* Where the lawyer never chose a way, the firm's way offering one: ONE files there once they choose. */}
      {state.unchosen.map((group) => (
        <StateLine
          key={`choose-${group.system.key}`}
          tone="info"
          action={
            <Button size="small" variant="outlined" href="/settings/atuacao#team-filing-ways">
              {t("filing-batches-choose")}
            </Button>
          }
        >
          {t("filing-batches-unchosen", { count: group.count, system: group.system.name })}
        </StateLine>
      ))}

      {state.batches.map((batch) => (
        <BatchLine key={batch.id} batch={batch} viewerId={state.viewerId} onChanged={() => router.refresh()} />
      ))}

      {/* Why ONE's browser or a lawyer's extension stopped a batch lately; what never went is back above to approve. */}
      {state.stopped.map((batch) => (
        <StoppedLine key={batch.id} batch={batch} mine={batch.personId === state.viewerId} />
      ))}

      {approving ? (
        <ApproveDialog group={approving} onClose={() => setApproving(null)} onApproved={() => router.refresh()} />
      ) : null}
    </CollapsibleCard>
  );
}

function StoppedLine({ batch, mine }: { batch: StoppedBatch; mine: boolean }) {
  const t = useTranslations("product");
  return (
    <StateLine
      tone={mine ? "attention" : "info"}
      action={
        mine && stopFixedInWays(batch.why) ? (
          <Button size="small" variant="outlined" href="/settings/atuacao#team-filing-ways">
            {t("filing-batches-why-fix")}
          </Button>
        ) : undefined
      }
    >
      {t("filing-batches-stopped", { system: batch.systemName, why: t(`filing-batches-why-${stopReason(batch.why)}`) })}
    </StateLine>
  );
}

function BatchLine({ batch, viewerId, onChanged }: { batch: BatchView; viewerId: string; onChanged: () => void }) {
  const t = useTranslations("product");
  const turn = batchTurn(batch, viewerId);
  const counts = batchCounts(batch);
  const held = heldSubmission(batch);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const [screen, setScreen] = useState<string | null>(null);

  const words = TURN[turn];
  const kindKey = CODE_KIND_KEY[batch.codeKind === "email" ? "email" : "app"];
  const head = t("filing-batches-head", {
    system: batch.systemName,
    count: counts.total,
    way: t(WAY_KEY[batch.way]),
    person: batch.personName,
  });

  async function sendCode() {
    setError(null);
    setBusy(true);
    try {
      const given = await giveBatchCode(batch.id, code);
      setCode("");
      if (!given.ok) return setError(t(errorKey(given.code)));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function confirmFiling() {
    if (!held) return;
    setError(null);
    setBusy(true);
    try {
      const confirmed = await confirmFilingSubmission(held.id);
      if (!confirmed.ok) return setError(t(errorKey(confirmed.code)));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function showScreen() {
    if (!held) return;
    const link = await openBatchSummary(held.id);
    if (link.ok && link.value) setScreen(link.value);
    else setError(t("filing-batches-error-no_screen"));
  }

  return (
    <Box className="border-grey-100 flex flex-col gap-2 rounded-lg border p-4">
      <Typography variant="subtitle2">{head}</Typography>

      <StateLine tone={words.tone}>
        {t(words.key, {
          system: batch.systemName,
          person: batch.personName,
          filed: counts.filed,
          total: counts.total,
          kind: t(kindKey),
        })}
      </StateLine>

      {turn === "code_mine" ? (
        <Box className="flex flex-row flex-wrap items-end gap-3">
          <TextField
            variant="standard"
            label={t("filing-batches-code-label")}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\s+/g, "").slice(0, 12))}
            slotProps={{ htmlInput: { inputMode: "numeric", autoComplete: "one-time-code" } }}
            disabled={busy}
          />
          <Button variant="contained" onClick={() => void sendCode()} disabled={busy || code.length < 4}>
            {t("filing-batches-code-send")}
          </Button>
        </Box>
      ) : null}

      {turn === "confirm_mine" ? (
        <Box className="flex flex-row flex-wrap items-center gap-2">
          {held?.summaryFileId ? (
            <Button variant="text" onClick={() => void showScreen()} disabled={busy}>
              {t("filing-batches-see-screen")}
            </Button>
          ) : null}
          <Button variant="contained" onClick={() => void confirmFiling()} disabled={busy}>
            {t("filing-batches-confirm")}
          </Button>
        </Box>
      ) : null}

      {counts.unknown > 0 ? (
        <StateLine tone="attention">
          {t("filing-batches-unknown", { count: counts.unknown, system: batch.systemName })}
        </StateLine>
      ) : null}
      {counts.filed > 0 && turn === "one_files" ? null : counts.filed > 0 ? (
        <StateLine tone="done">{t("filing-batches-filed", { count: counts.filed })}</StateLine>
      ) : null}

      <Box className="flex flex-row flex-wrap gap-1">
        <Button size="small" variant="text" color="grey" onClick={() => setStopping(true)} disabled={busy}>
          {t("filing-batches-stop")}
        </Button>
      </Box>

      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      {stopping ? (
        <ConfirmActionDialog
          title={t("filing-batches-stop-title", { system: batch.systemName })}
          consequences={[t("filing-batches-stop-consequence-1"), t("filing-batches-stop-consequence-2")]}
          confirmLabel={t("filing-batches-stop")}
          tone="warning"
          onConfirm={async () => {
            const stopped = await stopFilingBatch(batch.id);
            if (!stopped.ok) return t(errorKey(stopped.code));
            onChanged();
            return null;
          }}
          onClose={() => setStopping(false)}
        />
      ) : null}

      <Dialog open={screen !== null} onClose={() => setScreen(null)} maxWidth="lg" fullWidth>
        <DialogTitle>{t("filing-batches-screen-title", { system: batch.systemName })}</DialogTitle>
        <DialogContent>
          {screen ? (
            <img src={screen} alt={t("filing-batches-screen-alt", { system: batch.systemName })} className="w-full" />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setScreen(null)}>{t("filing-ways-term-close")}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function ApproveDialog({
  group,
  onClose,
  onApproved,
}: {
  group: EligibleGroup;
  onClose: () => void;
  onApproved: () => void;
}) {
  const t = useTranslations("product");
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(group.packages.map((item) => item.id)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [factor, setFactor] = useState(false);
  const [outcome, setOutcome] = useState<{ count: number; learning: boolean } | null>(null);

  async function approve() {
    setError(null);
    setBusy(true);
    try {
      const approved = await approveFilingBatch(group.system.key, [...chosen]);
      if (!approved.ok) {
        if (approved.code === "second_factor_required") return setFactor(true);
        return setError(t(errorKey(approved.code)));
      }
      setOutcome({ count: chosen.size - (approved.skipped?.length ?? 0), learning: approved.learning === true });
    } finally {
      setBusy(false);
    }
  }

  if (outcome) {
    const lines: OutcomeLine[] = [
      {
        key: "files",
        icon: <NiClock size="medium" />,
        text: t(DONE_KEY[group.way], {
          system: group.system.name,
        }),
      },
      { key: "number", icon: <NiCheck size="medium" />, text: t("filing-batches-done-number") },
      ...(outcome.learning
        ? [
            {
              key: "learning",
              icon: <NiExclamationSquare size="medium" />,
              text: t("filing-batches-done-learning", { system: group.system.name }),
            },
          ]
        : []),
    ];
    return (
      <OutcomeDialog
        open
        title={t("filing-batches-done-title", { count: outcome.count })}
        lines={lines}
        closeLabel={t("filing-batches-done-close")}
        onClose={() => {
          onApproved();
          onClose();
        }}
      />
    );
  }

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("filing-batches-approve-title", { system: group.system.name })}</DialogTitle>
      <DialogContent className="flex flex-col gap-4">
        <Typography variant="body2">
          {t(APPROVE_KEY[group.way], {
            system: group.system.name,
          })}
        </Typography>
        <Box className="flex flex-col">
          {group.packages.map((item) => (
            <FormControlLabel
              key={item.id}
              control={
                <Checkbox
                  checked={chosen.has(item.id)}
                  onChange={(event) => {
                    const next = new Set(chosen);
                    if (event.target.checked) next.add(item.id);
                    else next.delete(item.id);
                    setChosen(next);
                  }}
                />
              }
              label={[item.caseSeq !== null ? caseLabel(item.caseSeq) : null, item.client].filter(Boolean).join(" · ")}
            />
          ))}
        </Box>
        {factor ? (
          <SecondFactorPrompt
            state="challenge"
            reason={t("filing-batches-factor-reason")}
            onConfirmed={() => {
              setFactor(false);
              void approve();
            }}
          />
        ) : null}
        {error ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setError(null)}>
            {error}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button color="grey" onClick={onClose} disabled={busy}>
          {t("filing-batches-cancel")}
        </Button>
        <Button variant="contained" onClick={() => void approve()} disabled={busy || chosen.size === 0}>
          {busy ? t("saving") : t("filing-batches-approve", { count: chosen.size })}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
