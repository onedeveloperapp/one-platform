"use client";

import type { CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Input,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import StatusChip from "@/components/product/status-chip";
import { createClientLink, type LinkDelivery, revokeClientLink } from "@/lib/cases/actions";
import { caseErrorKey, CLIENT_STAGES, LINK_OWED_KEY } from "@/lib/cases/cases";
import { opensOnArrival } from "@/lib/cases/sections";
import { isMinorOn } from "@flyee/rules/person";

type Ready = Extract<CaseState, { kind: "ready" }>;

const DELIVERY_KEY: Record<LinkDelivery, string> = {
  sent: "case-link-whatsapp-sent",
  queued: "case-link-whatsapp-queued",
  unconfirmed: "case-link-whatsapp-unconfirmed",
  not_sent: "case-link-whatsapp-not-sent",
  window_closed: "case-link-whatsapp-window-closed",
  opted_out: "case-link-whatsapp-opted-out",
  no_conversation: "case-link-whatsapp-no-conversation",
};

const moment = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));

/**
 * The client's way in: a link by token for one adult of the case, which ends
 * on its own after the configured days or when the firm ends it. The token
 * is shown once, when the link is made (the database keeps only its hash),
 * and can go straight into the WhatsApp conversation with the client. While
 * the case is gathered, ONE sends it by itself to who wrote to the firm's
 * WhatsApp (0046); the card says, for each adult with no link, whether ONE
 * is sending it or why it cannot.
 */
export default function ClientLinkCard({
  state,
  holderPersonId,
  writable,
  onChanged,
}: {
  state: Ready;
  holderPersonId: string | null;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const adults = state.parties
    .map((party) => party.person)
    .filter((person, index, all) => all.findIndex((other) => other.person_id === person.person_id) === index)
    .filter((person) => isMinorOn(person.birth_date, state.today) !== true);
  const [chosen, setPersonId] = useState(holderPersonId ?? "");
  // Always an adult of the case as it is now: the one chosen, else who answers for the case, else the first.
  const personId = adults.some((person) => person.person_id === chosen)
    ? chosen
    : (adults.find((person) => person.person_id === holderPersonId)?.person_id ?? adults[0]?.person_id ?? "");
  const [sendOnWhatsApp, setSendOnWhatsApp] = useState(true);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<{ url: string; whatsapp: LinkDelivery | null } | null>(null);
  const [copied, setCopied] = useState(false);

  const now = Date.now();
  const open = state.links.filter((link) => !link.revokedAt && Date.parse(link.expiresAt) > now);
  const nameOf = (id: string) => adults.find((person) => person.person_id === id)?.full_name ?? "";
  const ended = state.case.status === "closed" || state.case.status === "declined";

  const create = async () => {
    setBusy(true);
    setProblem(null);
    setMade(null);
    setCopied(false);
    const result = await createClientLink({ caseId: state.case.id, personId, sendOnWhatsApp });
    setBusy(false);
    if (!result.ok) {
      setProblem(result.code);
      return;
    }
    setMade({ url: result.url, whatsapp: result.whatsapp });
    onChanged();
  };

  // Ending a link is said before it is done: the client loses the way in, and a new one goes in its place.
  const [revoking, setRevoking] = useState<string | null>(null);

  const revoke = async (linkId: string) => {
    setBusy(true);
    setProblem(null);
    const result = await revokeClientLink(state.case.id, linkId);
    setBusy(false);
    if (!result.ok) setProblem(result.code);
    else onChanged();
  };

  const copy = async () => {
    if (!made) return;
    try {
      await navigator.clipboard.writeText(made.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  // Each link in force by where its person stands, and whether somebody of the case is owed one ONE cannot send.
  const linkState = (link: (typeof open)[number]) =>
    link.finishedAt ? t("case-link-finished") : link.visits > 0 ? t("case-link-opened") : t("case-link-not-opened");
  const unsent = state.linksOwed.some((owed) => owed.reason !== "sending");

  return (
    <CollapsibleCard
      id="case-link"
      title={t("case-link-title")}
      summary={
        open.length > 0
          ? open.map((link) => `${nameOf(link.personId)}: ${linkState(link)}`).join(" · ")
          : t("case-link-summary-none")
      }
      chip={unsent ? <StatusChip tone="attention" label={t("case-link-summary-owed")} /> : null}
      description={t("case-link-body")}
      defaultOpen={opensOnArrival(state.case.status, "link", unsent)}
      bodyClassName="gap-3"
    >
      {open.map((link) => (
        <Box key={link.id} className="border-grey-100 flex flex-col gap-1 rounded-2xl border p-3">
          <Box className="flex flex-wrap items-center justify-between gap-2">
            <Typography variant="body1" className="font-semibold break-words">
              {nameOf(link.personId)}
            </Typography>
            <StatusChip
              tone={link.finishedAt ? "positive" : link.visits > 0 ? "info" : "neutral"}
              label={
                link.finishedAt
                  ? t("case-link-finished")
                  : link.visits > 0
                    ? t("case-link-opened")
                    : t("case-link-not-opened")
              }
            />
          </Box>
          <Typography variant="body2" className="text-text-secondary">
            {[
              t("case-link-made", { when: moment(link.createdAt) }),
              t("case-link-until", { when: moment(link.expiresAt) }),
            ].join(" · ")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {[
              t("case-link-visits", { count: link.visits }),
              link.lastOpenedAt ? t("case-link-last", { when: moment(link.lastOpenedAt) }) : null,
              t("case-link-files", { count: link.uploads }),
            ]
              .filter(Boolean)
              .join(" · ")}
          </Typography>
          {writable && (
            <Box className="pt-1">
              <Button variant="text" color="grey" size="small" disabled={busy} onClick={() => setRevoking(link.id)}>
                {t("case-link-revoke")}
              </Button>
            </Box>
          )}
        </Box>
      ))}

      {state.linksOwed.length > 0 && (
        <Box className="flex flex-col gap-1">
          {state.linksOwed.map((owed) => (
            <Typography key={owed.personId} variant="body2" className="text-text-secondary">
              {t(LINK_OWED_KEY[owed.reason], { name: nameOf(owed.personId) })}
            </Typography>
          ))}
        </Box>
      )}

      {state.consents.length > 0 && (
        <Box className="flex flex-col gap-1">
          <Typography variant="body2" className="font-semibold">
            {t("case-link-consents")}
          </Typography>
          {state.consents.map((consent) => (
            <Typography
              key={`${consent.personId}-${consent.title}-${consent.version}`}
              variant="body2"
              className="text-text-secondary"
            >
              {t("case-link-consent", {
                title: consent.title,
                version: consent.version,
                name: nameOf(consent.personId),
                when: moment(consent.acceptedAt),
              })}
            </Typography>
          ))}
        </Box>
      )}

      {made && (
        <Box className="flex flex-col gap-2">
          <FormControl className="outlined" variant="standard">
            <FormLabel htmlFor="case-link-url">{t("case-link-url")}</FormLabel>
            <Input id="case-link-url" value={made.url} readOnly aria-describedby="case-link-url-help" />
            <FormHelperText id="case-link-url-help">
              {copied ? t("case-link-copied") : t("case-link-once")}
            </FormHelperText>
          </FormControl>
          <Box>
            <Button variant="outlined" color="grey" size="small" onClick={() => void copy()}>
              {t("case-link-copy")}
            </Button>
          </Box>
          {made.whatsapp && (
            <Alert
              severity={made.whatsapp === "sent" || made.whatsapp === "queued" ? "success" : "warning"}
              className="neutral bg-background-paper/60!"
            >
              {t(DELIVERY_KEY[made.whatsapp])}
            </Alert>
          )}
        </Box>
      )}

      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(caseErrorKey(problem))}
        </Alert>
      )}

      {writable && !ended && (
        <Box className="flex flex-col gap-3">
          {adults.length === 0 ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("case-link-no-adult")}
            </Typography>
          ) : (
            <>
              {adults.length > 1 && (
                <TextField
                  select
                  size="small"
                  fullWidth
                  id="case-link-person"
                  label={t("case-link-person")}
                  value={personId}
                  disabled={busy}
                  onChange={(event) => setPersonId(event.target.value)}
                >
                  {adults.map((person) => (
                    <MenuItem key={person.person_id} value={person.person_id}>
                      {person.full_name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              <FormControlLabel
                control={
                  <Checkbox
                    size="small"
                    checked={sendOnWhatsApp}
                    disabled={busy}
                    onChange={(event) => setSendOnWhatsApp(event.target.checked)}
                  />
                }
                label={t("case-link-send-whatsapp")}
              />
              <Box>
                <Button
                  variant={open.length > 0 ? "outlined" : "contained"}
                  color={open.length > 0 ? "grey" : "primary"}
                  disabled={busy || !personId}
                  onClick={() => void create()}
                >
                  {busy
                    ? t("cases-working")
                    : open.some((link) => link.personId === personId)
                      ? t("case-link-new")
                      : t("case-link-create")}
                </Button>
              </Box>
              {open.some((link) => link.personId === personId) && (
                <Typography variant="body2" className="text-text-secondary">
                  {t("case-link-replaces")}
                </Typography>
              )}
            </>
          )}
          {!CLIENT_STAGES.includes(state.case.status) && (
            <Typography variant="body2" className="text-text-secondary">
              {t("case-link-read-only")}
            </Typography>
          )}
        </Box>
      )}
      {revoking ? (
        <ConfirmActionDialog
          title={t("case-link-revoke-title")}
          consequences={[t("case-link-revoke-consequence"), t("case-link-revoke-consequence-new")]}
          staysTitle={t("confirm-stays")}
          stays={[t("case-link-revoke-stays")]}
          requireReason={false}
          confirmLabel={t("case-link-revoke")}
          cancelLabel={t("cases-cancel")}
          busyLabel={t("cases-working")}
          tone="danger"
          onConfirm={async () => {
            await revoke(revoking);
            return null;
          }}
          onClose={() => setRevoking(null)}
        />
      ) : null}
    </CollapsibleCard>
  );
}
