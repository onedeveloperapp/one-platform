"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Grid,
  Switch,
  TextField,
  Typography,
} from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import DialogHeader from "@/components/product/dialog-header";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import UsageMeter from "@/components/product/usage-meter";
import { setNoticeKind, submitNoticeTemplate } from "@/lib/notices/actions";
import type { FirmNoticeKind, FirmNotices } from "@/lib/notices/facts";
import {
  blockerKey,
  KIND_KEY,
  KIND_STATE_KEY,
  type KindState,
  kindState,
  noticeErrorKey,
  noticeTextFindings,
  noticeTextProblem,
  paramKey,
  pendingState,
} from "@/lib/notices/notices";
import { findingKey } from "@/lib/whatsapp/connections";
import { renderTemplate } from "@flyee/whatsapp/rules";

const STATE_TONE: Record<KindState, StatusTone> = {
  none: "neutral",
  pending: "info",
  refused: "attention",
  paused: "attention",
  not_utility: "attention",
  ready: "primary",
  on: "positive",
};

/** When a kind goes, in words: the reminders and the word on a lawsuit by the days the setting gives. */
function useWhen() {
  const t = useTranslations("product");
  return (kind: FirmNoticeKind, notices: FirmNotices): string => {
    if (kind.kind === "hearing_reminder") {
      const before = notices.hearingDays.filter((day) => day > 0);
      if (before.length === 0) return t("notice-kind-hearing-reminder-when-day");
      const days = new Intl.ListFormat("pt-BR", { type: "conjunction" }).format(before.map(String));
      return notices.hearingDays.includes(0)
        ? t("notice-kind-hearing-reminder-when", { days })
        : t("notice-kind-hearing-reminder-when-before", { days });
    }
    if (kind.kind === "lawsuit_update") return t("notice-kind-lawsuit-update-when", { days: notices.updateDays });
    return t(KIND_KEY[kind.kind].when);
  };
}

/** A kind's text as a client reads it, with the example of each value and the footer every one carries. */
const exampleOf = (body: string, kind: FirmNoticeKind): string =>
  `${renderTemplate(body, kind.examples)}\n\n${kind.footer}`;

/**
 * The notices the firm's clients get on WhatsApp by themselves. Who manages
 * the firm comes here to switch each one on: its text goes to the firm's
 * account at WhatsApp for approval (the platform's text, or the firm's own,
 * keeping the values the kind fills), and once approved it is switched on.
 * Each says when it goes, how a client reads it and how it stands; the
 * notices of the last day against the firm's ceiling are shown above them.
 */
export default function NoticesCard({
  notices,
  blocked,
  onChanged,
  embedded = false,
}: {
  notices: FirmNotices;
  /** A support visit, or a session without the second factor: nothing is submitted or switched. */
  blocked: boolean;
  onChanged: () => void;
  /** Inside another screen's flow (the firm's setup): the section without its card, its titles a level down. */
  embedded?: boolean;
}) {
  const t = useTranslations("product");
  const when = useWhen();
  const [editing, setEditing] = useState<FirmNoticeKind | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const used = Math.min(notices.lastDay, notices.dailyMax);
  const left = Math.max(notices.dailyMax - used, 0);

  const toggle = async (kind: FirmNoticeKind, on: boolean) => {
    setBusy(kind.kind);
    setProblem(null);
    try {
      const result = await setNoticeKind(kind.kind, on);
      if (!result.ok) setProblem(result.code);
      else onChanged();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(null);
    }
  };

  // How the kinds stand: how many are on, and how many keep a client from being told (refused, paused, not a
  // utility message, or on and still not going out). The closed card says it, and opens while some do.
  const states = notices.kinds.map((kind) => kindState(kind));
  const on = states.filter((state) => state === "on").length;
  const troubled = notices.kinds.filter(
    (kind, index) =>
      states[index] === "refused" ||
      states[index] === "paused" ||
      states[index] === "not_utility" ||
      (kind.enabled && Boolean(kind.blocker) && kind.blocker !== "kind_off"),
  ).length;

  // Inside another screen's flow the section carries its own heading; on this screen the card's header is it.
  const header = (
    <Box className="flex flex-col gap-1">
      <Typography id="connections-notices" variant="subtitle2" component="h3" className="mb-0">
        {t("notices-title")}
      </Typography>
      <Typography variant="body2" className="text-text-secondary max-w-3xl">
        {t("notices-body")}
      </Typography>
    </Box>
  );

  const content = (
    <>
      {notices.accounts === 0 ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("notices-no-number")}
        </Alert>
      ) : (
        <UsageMeter
          headline={t("notices-day-headline", { used, max: notices.dailyMax })}
          caption={t("notices-day-caption")}
          ariaLabel={t("notices-day-aria", { used, max: notices.dailyMax })}
          segments={[
            { key: "used", label: t("notices-day-used"), value: used, display: String(used), tone: "primary" },
            { key: "left", label: t("notices-day-left"), value: left, display: String(left), tone: "empty" },
          ]}
        />
      )}

      <Box component="ul" className="m-0 flex list-none flex-col p-0">
        {notices.kinds.map((kind) => {
          const state = kindState(kind);
          // Ready to go on, or on: and a kind that is on is always switched off, whatever became of its template.
          const canSwitch = state === "ready" || state === "on" || kind.enabled;
          // On, and still not going out: the reason is said where the switch is.
          const stuck = kind.enabled && kind.blocker && kind.blocker !== "kind_off" ? kind.blocker : null;
          // A new text with the vendor: what became of it, while the one above goes on.
          const waiting = pendingState(kind.pending);
          return (
            <Box
              component="li"
              key={kind.kind}
              className="border-grey-100 flex flex-col gap-2 border-b py-4 first:pt-0 last:border-b-0 last:pb-0"
            >
              <Box className="flex flex-wrap items-center gap-2">
                <Typography variant="subtitle2" component={embedded ? "h4" : "h3"} className="mb-0 min-w-0 flex-1">
                  {t(KIND_KEY[kind.kind].label)}
                </Typography>
                <StatusChip tone={STATE_TONE[state]} label={t(KIND_STATE_KEY[state])} />
              </Box>
              <Typography variant="body2" className="text-text-secondary">
                {when(kind, notices)}
              </Typography>
              <Box className="bg-grey-25 rounded-lg p-3">
                <Typography variant="caption" component="p" className="text-text-secondary mb-1">
                  {t("notices-example")}
                </Typography>
                <Typography variant="body2" className="break-words whitespace-pre-wrap">
                  {exampleOf(kind.body ?? kind.proposed, kind)}
                </Typography>
              </Box>
              {waiting ? (
                <Typography variant="body2" className="text-text-primary">
                  {t(waiting)}
                </Typography>
              ) : null}
              {stuck ? (
                <Typography variant="body2" className="text-text-primary">
                  {t("notices-stuck", { reason: t(blockerKey(stuck)) })}
                </Typography>
              ) : null}
              <Box className="flex flex-wrap items-center gap-3">
                <Button
                  variant={state === "none" ? "contained" : "outlined"}
                  color={state === "none" ? "primary" : "grey"}
                  size="small"
                  disabled={blocked || notices.accounts === 0 || busy !== null}
                  onClick={() => setEditing(kind)}
                >
                  {state === "none" ? t("notices-submit") : t("notices-resubmit")}
                </Button>
                {canSwitch ? (
                  <FormControlLabel
                    control={
                      <Switch
                        checked={kind.enabled}
                        disabled={blocked || busy !== null}
                        onChange={(event) => void toggle(kind, event.target.checked)}
                      />
                    }
                    label={t("notices-on")}
                  />
                ) : null}
              </Box>
            </Box>
          );
        })}
      </Box>

      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t(noticeErrorKey(problem))}
        </Alert>
      ) : null}
    </>
  );

  const dialog = editing ? (
    <TextDialog
      kind={editing}
      onClose={() => setEditing(null)}
      onSaved={() => {
        setEditing(null);
        onChanged();
      }}
    />
  ) : null;

  if (embedded) {
    return (
      <Box component="section" id="avisos" aria-labelledby="connections-notices" className="flex flex-col gap-4">
        {header}
        {content}
        {dialog}
      </Box>
    );
  }
  return (
    <Grid size={12}>
      <CollapsibleCard
        id="connections-notices"
        anchor="avisos"
        title={t("notices-title")}
        summary={on > 0 ? t("notices-summary", { on, total: notices.kinds.length }) : t("notices-summary-none")}
        chip={
          troubled > 0 ? (
            <StatusChip tone="attention" label={t("notices-summary-troubled", { count: troubled })} />
          ) : null
        }
        description={t("notices-body")}
        defaultOpen={troubled > 0}
      >
        {content}
      </CollapsibleCard>
      {dialog}
    </Grid>
  );
}

/** The text of a kind, the platform's or the firm's own, sent to WhatsApp for approval. */
function TextDialog({ kind, onClose, onSaved }: { kind: FirmNoticeKind; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("product");
  const [body, setBody] = useState(kind.pending?.body ?? kind.body ?? kind.proposed);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const textProblem = noticeTextProblem(body, kind.params.length);
  const findings = noticeTextFindings(body, kind.footer).flatMap((code) => {
    const key = findingKey(code);
    return key ? [key] : [];
  });
  const values = `{{1}} a {{${kind.params.length}}}`;

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await submitNoticeTemplate(kind.kind, body);
      if (!result.ok) setProblem(result.code);
      else onSaved();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="md" fullWidth aria-labelledby="notice-text-dialog">
      <DialogHeader
        id="notice-text-dialog"
        title={t(KIND_KEY[kind.kind].label)}
        onClose={onClose}
        closeLabel={t("hearing-close")}
      />
      <DialogContent className="flex flex-col gap-4">
        <Typography variant="body2" className="text-text-secondary">
          {t("notices-dialog-intro")}
        </Typography>
        <TextField
          id="notice-text"
          label={t("notices-dialog-text")}
          value={body}
          disabled={busy}
          multiline
          minRows={4}
          onChange={(event) => setBody(event.target.value.slice(0, 1024))}
          error={Boolean(textProblem)}
          helperText={
            textProblem
              ? t(noticeErrorKey(textProblem), { values })
              : t("notices-dialog-footer", { footer: kind.footer })
          }
        />
        <Box className="flex flex-col gap-1">
          <Typography variant="body2" className="font-semibold">
            {t("notices-dialog-values")}
          </Typography>
          <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
            {kind.params.map((param, index) => (
              <Typography key={param} component="li" variant="body2">
                {`{{${index + 1}}} · ${t(paramKey(param))}`}
              </Typography>
            ))}
          </Box>
        </Box>
        <Box className="bg-grey-25 rounded-lg p-3">
          <Typography variant="caption" component="p" className="text-text-secondary mb-1">
            {t("notices-example")}
          </Typography>
          <Typography variant="body2" className="break-words whitespace-pre-wrap">
            {exampleOf(body, kind)}
          </Typography>
        </Box>
        {findings.length > 0 ? (
          <Box className="flex flex-col gap-1">
            <Typography variant="body2" className="text-text-secondary">
              {t("connections-findings-intro")}
            </Typography>
            <Box className="flex flex-row flex-wrap gap-1.5">
              {findings.map((key) => (
                <StatusChip key={key} label={t(key)} tone="attention" />
              ))}
            </Box>
          </Box>
        ) : null}
        {kind.enabled ? (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("notices-dialog-keeps")}
          </Alert>
        ) : null}
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t(noticeErrorKey(problem), { values })}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          {t("hearing-cancel")}
        </Button>
        <Button variant="contained" disabled={busy || Boolean(textProblem)} onClick={() => void submit()}>
          {t("notices-dialog-submit")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
