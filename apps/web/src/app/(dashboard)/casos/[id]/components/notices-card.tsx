"use client";

import type { CaseState } from "../case-types";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  TextField,
  Typography,
} from "@mui/material";

import DialogHeader from "@/components/product/dialog-header";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import { recordNoticeOptin } from "@/lib/notices/actions";
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

/** A notice is called by its kind; one the screen does not know by its own word. */
function useKindLabel() {
  const t = useTranslations("product");
  return (kind: string) => (isNoticeKind(kind) ? t(KIND_KEY[kind].label) : kind);
}

/**
 * What the case's clients are told on WhatsApp by themselves. Somebody comes
 * here to know whether the client will hear of the hearing and of the
 * lawsuit, and to fix what keeps them from it: a WhatsApp missing, the
 * agreement not given (recorded here with how it was given, or given by the
 * client on their link). Below, what is due now and why it cannot go, and
 * what went, with what became of each message.
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
  const [asking, setAsking] = useState<{ person: CaseNoticePerson; agreed: boolean } | null>(null);
  const notices = state.notices;
  const names = new Map(notices.people.map((person) => [person.personId, person.name]));
  const off = notices.kindsOn.length === 0;

  return (
    <Card component="section" aria-labelledby="case-notices">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-wrap items-center gap-3">
          <Typography id="case-notices" variant="h5" component="h2" className="mb-0 min-w-0 flex-1">
            {t("case-notices-title")}
          </Typography>
          {state.managesFirm ? (
            <Button variant="text" color="grey" size="small" href="/settings/connections#avisos" LinkComponent={Link}>
              {t("case-notices-settings")}
            </Button>
          ) : null}
        </Box>
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
                <Box className="flex min-w-0 flex-1 flex-col">
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
                    person.blocker
                      ? t(blockerKey(person.blocker))
                      : person.optin?.source === "client"
                        ? t("case-notices-agreed-link", { day: person.optin.recordedLabel })
                        : t("case-notices-agreed-firm", { day: person.optin?.recordedLabel ?? "" })
                  }
                />
                {writable && person.phone && person.blocker === "no_optin" ? (
                  <Button
                    variant="outlined"
                    color="grey"
                    size="small"
                    onClick={() => setAsking({ person, agreed: true })}
                  >
                    {t("case-notices-record")}
                  </Button>
                ) : null}
                {writable && person.optin?.current ? (
                  <Button variant="text" color="grey" size="small" onClick={() => setAsking({ person, agreed: false })}>
                    {t("case-notices-withdraw")}
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
                        {[kindLabel(item.kind), names.get(item.personId), item.reservedLabel]
                          .filter(Boolean)
                          .join(" · ")}
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
      </CardContent>
      {asking ? (
        <OptinDialog
          caseId={state.case.id}
          person={asking.person}
          agreed={asking.agreed}
          onClose={() => setAsking(null)}
          onSaved={() => {
            setAsking(null);
            onChanged();
          }}
        />
      ) : null}
    </Card>
  );
}

const DIALOG_KEY = {
  agree: {
    title: "case-notices-record-title",
    intro: "case-notices-record-intro",
    submit: "case-notices-record",
  },
  withdraw: {
    title: "case-notices-withdraw-title",
    intro: "case-notices-withdraw-intro",
    submit: "case-notices-withdraw",
  },
} as const;

/** How the person agreed (in the contract, in a conversation), or why the agreement is taken back. */
function OptinDialog({
  caseId,
  person,
  agreed,
  onClose,
  onSaved,
}: {
  caseId: string;
  person: CaseNoticePerson;
  agreed: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const keys = DIALOG_KEY[agreed ? "agree" : "withdraw"];
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await recordNoticeOptin({ caseId, personId: person.personId, agreed, note });
      if (!result.ok) setProblem(result.code);
      else onSaved();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="notice-optin-dialog">
      <DialogHeader id="notice-optin-dialog" title={t(keys.title)} onClose={onClose} closeLabel={t("hearing-close")} />
      <DialogContent className="flex flex-col gap-3">
        <Typography variant="body2" className="text-text-secondary">
          {t(keys.intro, { name: person.name })}
        </Typography>
        <TextField
          size="small"
          id="notice-optin-note"
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
