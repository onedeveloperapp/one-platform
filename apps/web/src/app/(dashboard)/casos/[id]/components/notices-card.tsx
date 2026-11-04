"use client";

import type { CaseState } from "../case-types";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import DialogHeader from "@/components/product/dialog-header";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import { opensOnArrival } from "@/lib/cases/sections";
import { recordNoticeStop } from "@/lib/notices/actions";
import type { CaseNoticePerson } from "@/lib/notices/facts";
import { blockerKey, isNoticeKind, isUnconfirmed, KIND_KEY, noticeErrorKey, sentKey } from "@/lib/notices/notices";
import { phoneLabel } from "@/lib/whatsapp/conversations";

type Ready = Extract<CaseState, { kind: "ready" }>;

const SENT_TONE: Record<string, StatusTone> = {
  queued: "info",
  sending: "info",
  sent: "primary",
  delivered: "positive",
  read: "positive",
  failed: "attention",
};

/** Where a person asked to stop the notices: on their own link, or to a person of the firm, who recorded it. */
const STOPPED_KEY = { client: "case-notices-stopped-link", firm: "case-notices-stopped-firm" } as const;

/** A notice is called by its kind; one the screen does not know by its own word. */
function useKindLabel() {
  const t = useTranslations("product");
  return (kind: string) => (isNoticeKind(kind) ? t(KIND_KEY[kind].label) : kind);
}

/**
 * What the case's clients are told on WhatsApp by themselves. Somebody comes
 * here to know whether the client will hear of the hearing and of the
 * lawsuit, and to fix what keeps them from it: a WhatsApp missing, or a
 * request to stop (made on the client's link, or recorded here with how the
 * person asked). Nobody is asked to agree (0088): a person with a WhatsApp is
 * told. Below, what is due now and why it cannot go, and what went, with what
 * became of each message.
 */
export default function NoticesCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const kindLabel = useKindLabel();
  const [asking, setAsking] = useState<{ person: CaseNoticePerson; stopped: boolean } | null>(null);
  const notices = state.notices;
  const names = new Map(notices.people.map((person) => [person.personId, person.name]));
  const off = notices.kindsOn.length === 0;

  const unreached = notices.people.filter((person) => person.blocker).length;

  return (
    <CollapsibleCard
      id="case-notices"
      title={t("case-notices-title")}
      summary={
        off
          ? t("case-notices-summary-off")
          : notices.people.length === 0
            ? t("case-notices-summary-nobody")
            : unreached > 0
              ? t("case-notices-summary-unreached", { count: unreached })
              : t("case-notices-summary-reached")
      }
      action={
        state.managesFirm ? (
          <Button variant="outlined" color="grey" size="small" href="/settings/connections#avisos" LinkComponent={Link}>
            {t("case-notices-settings")}
          </Button>
        ) : null
      }
      defaultOpen={opensOnArrival(state.case.status, "notices", false)}
      bodyClassName="gap-3"
    >
      {off ? (
        <Typography variant="body2" className="text-text-secondary">
          {state.managesFirm ? t("case-notices-off-manager") : t("case-notices-off")}
        </Typography>
      ) : null}

      {notices.people.length > 0 ? (
        <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
          {notices.people.map((person) => (
            <Box
              component="li"
              key={person.personId}
              className="border-grey-100 flex flex-wrap items-center gap-2 border-b pb-2 last:border-b-0"
            >
              <Box className="flex min-w-0 flex-1 basis-40 flex-col">
                <Typography variant="subtitle2" component="p" className="mb-0 break-words">
                  {person.name}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {person.phone ? phoneLabel(person.phone) : t("case-notices-no-phone")}
                </Typography>
              </Box>
              <StatusChip
                tone={person.blocker ? "attention" : "positive"}
                label={
                  person.blocker === "stopped" && person.stop
                    ? t(STOPPED_KEY[person.stop.source], { day: person.stop.recordedLabel })
                    : person.blocker
                      ? t(blockerKey(person.blocker))
                      : t("case-notices-receiving")
                }
              />
              {writable && person.stop ? (
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  onClick={() => setAsking({ person, stopped: false })}
                >
                  {t("case-notices-resume")}
                </Button>
              ) : null}
              {writable && person.phone && !person.stop ? (
                <Button variant="text" color="grey" size="small" onClick={() => setAsking({ person, stopped: true })}>
                  {t("case-notices-stop")}
                </Button>
              ) : null}
            </Box>
          ))}
        </Box>
      ) : null}

      {notices.due.length > 0 ? (
        <Box className="flex flex-col gap-1">
          <Typography variant="body2" className="font-semibold">
            {t("case-notices-due")}
          </Typography>
          <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
            {notices.due.map((item, index) => (
              <Typography key={index} component="li" variant="body2">
                {t("case-notices-due-item", {
                  kind: kindLabel(item.kind),
                  name: names.get(item.personId) ?? "",
                  state: item.blocker ? t(blockerKey(item.blocker)) : t("case-notices-due-going"),
                })}
              </Typography>
            ))}
          </Box>
        </Box>
      ) : null}

      {notices.sent.length > 0 ? (
        <Box className="flex flex-col gap-2">
          <Typography variant="body2" className="font-semibold">
            {t("case-notices-sent")}
          </Typography>
          <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
            {notices.sent.map((item) => {
              const unconfirmed = isUnconfirmed(item.status, item.error);
              return (
                <Box component="li" key={item.id} className="flex flex-col gap-1">
                  <Box className="flex flex-wrap items-center gap-2">
                    <Typography variant="body2" className="min-w-0 flex-1">
                      {[kindLabel(item.kind), names.get(item.personId), item.reservedLabel].filter(Boolean).join(" · ")}
                    </Typography>
                    <StatusChip
                      tone={unconfirmed ? "attention" : (SENT_TONE[item.status] ?? "info")}
                      label={t(unconfirmed ? "notice-sent-unconfirmed" : sentKey(item.status))}
                    />
                  </Box>
                  <Typography variant="body2" className="text-text-secondary line-clamp-3 break-words">
                    {item.body}
                  </Typography>
                </Box>
              );
            })}
          </Box>
        </Box>
      ) : null}
      {asking ? (
        <StopDialog
          caseId={state.case.id}
          person={asking.person}
          stopped={asking.stopped}
          onClose={() => setAsking(null)}
          onSaved={() => {
            setAsking(null);
            onChanged();
          }}
        />
      ) : null}
    </CollapsibleCard>
  );
}

const DIALOG_KEY = {
  stop: {
    title: "case-notices-stop-title",
    intro: "case-notices-stop-intro",
    submit: "case-notices-stop",
  },
  resume: {
    title: "case-notices-resume-title",
    intro: "case-notices-resume-intro",
    submit: "case-notices-resume",
  },
} as const;

/** How the person asked the firm to stop the notices (by phone, in person), or to be told again. */
function StopDialog({
  caseId,
  person,
  stopped,
  onClose,
  onSaved,
}: {
  caseId: string;
  person: CaseNoticePerson;
  stopped: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const keys = DIALOG_KEY[stopped ? "stop" : "resume"];
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await recordNoticeStop({ caseId, personId: person.personId, stopped, note });
      if (!result.ok) setProblem(result.code);
      else onSaved();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="notice-stop-dialog">
      <DialogHeader id="notice-stop-dialog" title={t(keys.title)} onClose={onClose} closeLabel={t("hearing-close")} />
      <DialogContent className="flex flex-col gap-3">
        <Typography variant="body2" className="text-text-secondary">
          {t(keys.intro, { name: person.name })}
        </Typography>
        <TextField
          size="small"
          id="notice-stop-note"
          label={t("case-notices-note")}
          value={note}
          disabled={busy}
          multiline
          minRows={2}
          onChange={(event) => setNote(event.target.value.slice(0, 500))}
          helperText={t("case-notices-note-help")}
        />
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t(noticeErrorKey(problem))}
          </Alert>
        ) : null}
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          {t("hearing-cancel")}
        </Button>
        <Button variant="contained" disabled={busy || note.trim().length < 8} onClick={() => void submit()}>
          {t(keys.submit)}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
