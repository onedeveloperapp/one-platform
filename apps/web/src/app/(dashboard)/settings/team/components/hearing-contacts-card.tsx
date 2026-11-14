"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Typography } from "@mui/material";

import HearingContactPanel from "@/components/hearings/hearing-contact-panel";
import CollapsibleCard from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import IllustrationAccounts from "@/icons/illustrations/illustration-accounts";
import { type HearingContact, hearingContacts, removeHearingContact } from "@/lib/hearings/contacts";
import { formatPhoneBr } from "@flyee/fields";

/** A WhatsApp as the list shows it: the number without the country's 55, masked. */
const phoneWords = (digits: string): string => formatPhoneBr(digits.startsWith("55") ? digits.slice(2) : digits);

/**
 * The firm's attendees from outside (migration 0251, the owner, 2026-11-14): who goes to hearings for the firm with no
 * account in ONE, by name and WhatsApp. They are added where the firm takes notice of a hearing and chosen for the
 * next ones; here the list is read, one is added, and one is taken out (the hearings they were chosen for keep them).
 */
export default function HearingContactsCard() {
  const t = useTranslations("product");
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "error" } | { kind: "ready"; contacts: HearingContact[] }
  >({ kind: "loading" });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const load = () =>
    hearingContacts()
      .then((read) => setState(read.ok ? { kind: "ready", contacts: read.contacts } : { kind: "error" }))
      .catch(() => setState({ kind: "error" }));

  useEffect(() => {
    void load();
  }, []);

  const remove = async (contact: HearingContact) => {
    setBusy(contact.id);
    setFailed(false);
    const done = await removeHearingContact(contact.id).catch(() => ({ ok: false }));
    setBusy(null);
    if (!done.ok) {
      setFailed(true);
      return;
    }
    setState((current) =>
      current.kind === "ready"
        ? { kind: "ready", contacts: current.contacts.filter((item) => item.id !== contact.id) }
        : current,
    );
  };

  const contacts = state.kind === "ready" ? state.contacts : [];

  return (
    <CollapsibleCard
      id="team-hearing-contacts"
      title={t("team-hearing-contacts-title")}
      description={t("team-hearing-contacts-body")}
      summary={
        state.kind === "ready"
          ? contacts.length === 0
            ? t("team-hearing-contacts-empty-title")
            : t("team-hearing-contacts-count", { count: contacts.length })
          : undefined
      }
      add={state.kind === "ready" ? { label: t("team-hearing-contacts-add"), onClick: () => setAdding(true) } : null}
      bodyClassName="gap-4"
    >
      {state.kind === "error" ? (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={() => void load()}>
              {t("team-hearing-contacts-retry")}
            </Button>
          }
        >
          {t("team-hearing-contacts-error")}
        </Alert>
      ) : state.kind === "loading" ? null : contacts.length === 0 ? (
        <EmptyState
          titleAs="h3"
          illustration={<IllustrationAccounts />}
          title={t("team-hearing-contacts-empty-title")}
          description={t("team-hearing-contacts-empty-body")}
          layout="row"
          framed={false}
        />
      ) : (
        <Box component="ul" className="m-0 flex list-none flex-col p-0">
          {contacts.map((contact) => (
            <Box
              component="li"
              key={contact.id}
              className="border-grey-100 flex flex-row flex-wrap items-center gap-3 border-b py-3 last:border-b-0"
            >
              <Box className="min-w-0 flex-1">
                <Typography variant="subtitle2" component="p">
                  {contact.name}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {phoneWords(contact.phone)}
                </Typography>
              </Box>
              <Button
                variant="text"
                color="grey"
                size="small"
                onClick={() => void remove(contact)}
                disabled={busy !== null}
              >
                {t("team-hearing-contacts-remove")}
              </Button>
            </Box>
          ))}
        </Box>
      )}
      {failed ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
          {t("team-hearing-contacts-remove-failed")}
        </Alert>
      ) : null}
      {adding ? (
        <HearingContactPanel
          onClose={() => setAdding(false)}
          onSaved={(contact) => {
            setAdding(false);
            setState((current) =>
              current.kind === "ready"
                ? {
                    kind: "ready",
                    contacts: [...current.contacts.filter((item) => item.id !== contact.id), contact].sort((a, b) =>
                      a.name.localeCompare(b.name, "pt-BR"),
                    ),
                  }
                : current,
            );
          }}
        />
      ) : null}
    </CollapsibleCard>
  );
}
