"use client";

import type { CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import DialogHeader from "@/components/product/dialog-header";
import ItemRows, { type ItemRow } from "@/components/product/item-rows";
import type { StateTone } from "@/components/product/state-line";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiClock from "@/icons/nexture/ni-clock";
import NiMessages from "@/icons/nexture/ni-messages";
import { SECTION_ANCHOR } from "@/lib/cases/now";
import { opensOnArrival } from "@/lib/cases/sections";
import { recordNoticeStop } from "@/lib/notices/actions";
import type { CaseNoticePerson } from "@/lib/notices/facts";
import { blockerKey, isNoticeKind, isUnconfirmed, KIND_KEY, noticeErrorKey, sentKey } from "@/lib/notices/notices";
import { phoneLabel } from "@/lib/whatsapp/conversations";

type Ready = Extract<CaseState, { kind: "ready" }>;

/** Where a message that went stands, in its line's colour: on its way, delivered or read. */
const SENT_STATE: Record<string, StateTone> = {
  queued: "waiting",
  sending: "waiting",
  sent: "done",
  delivered: "done",
  read: "done",
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

  // A message whose fate is unknown, or that did not go, asks the firm to look; the rest went.
  const troubled = notices.sent.filter((item) => isUnconfirmed(item.status, item.error) || item.status === "failed");
  const delivered = notices.sent.filter((item) => !troubled.includes(item));
  const sentLine = (item: (typeof notices.sent)[number]): ItemRow => {
    const unconfirmed = isUnconfirmed(item.status, item.error);
    const failed = !unconfirmed && item.status === "failed";
    return {
      key: item.id,
      icon: <NiMessages size="small" />,
      tone: "accent-1",
      title: [kindLabel(item.kind), names.get(item.personId)].filter(Boolean).join(" · "),
      detail: item.reservedLabel,
      state: {
        tone: unconfirmed || failed ? "attention" : (SENT_STATE[item.status] ?? "info"),
        text: t(unconfirmed ? "notice-sent-unconfirmed" : sentKey(item.status)),
      },
      opener: unconfirmed || failed ? t("case-rows-notice-open") : undefined,
      openLabel: t("case-rows-notice-open-label", { kind: kindLabel(item.kind) }),
      content: () => (
        <Box className="flex flex-col gap-2">
          {unconfirmed || failed ? (
            // What a person does about it, before the message itself (the owner, 2026-11-12: "Ver" showed only the
            // text, and nothing said what to do).
            <StateLine tone="attention">
              {unconfirmed
                ? t("notice-unconfirmed-help")
                : t("notice-failed-help", { reason: t(noticeErrorKey(item.error)) })}
            </StateLine>
          ) : null}
          <Typography variant="body2" className="text-text-secondary break-words whitespace-pre-line">
            {item.body}
          </Typography>
        </Box>
      ),
    };
  };
  const dueLine = (item: (typeof notices.due)[number], index: number): ItemRow => ({
    key: `due-${index}-${item.kind}-${item.personId}`,
    icon: <NiClock size="small" />,
    tone: "accent-4",
    title: [kindLabel(item.kind), names.get(item.personId)].filter(Boolean).join(" · "),
    state: item.blocker
      ? { tone: "info", text: t(blockerKey(item.blocker)) }
      : { tone: "waiting", text: t("case-notices-due-going") },
  });

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
      ask={troubled.length > 0 ? { tone: "firm", label: t("case-rows-ask-chip", { count: troubled.length }) } : null}
      more={state.managesFirm ? { label: t("case-notices-settings"), href: "/settings/mensagens#avisos" } : null}
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

      {notices.due.length > 0 || notices.sent.length > 0 ? (
        // One line per notice (the owner's canvas, 2026-11-10): one whose sending nobody can confirm first, what ONE
        // will send, then what went, the latest first, its words opening in the line.
        <ItemRows
          arrival={[SECTION_ANCHOR.notices]}
          sections={[
            { key: "ask", title: t("item-rows-ask"), ask: true, rows: troubled.map(sentLine) },
            { key: "due", title: t("case-notices-due"), rows: notices.due.map(dueLine) },
            { key: "sent", title: t("case-notices-sent"), rows: delivered.map(sentLine), shown: 3 },
          ]}
        />
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
