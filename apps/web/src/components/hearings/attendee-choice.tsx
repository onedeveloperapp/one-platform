"use client";

import HearingContactPanel from "./hearing-contact-panel";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import { ListSubheader, MenuItem, TextField } from "@mui/material";

import { chooseHearingAttendee } from "@/lib/hearings/actions";
import { type HearingContact, hearingContacts } from "@/lib/hearings/contacts";
import type { Colleague } from "@/lib/hearings/facts";
import { hearingErrorKey } from "@/lib/hearings/hearings";
import { formatPhoneBr } from "@flyee/fields";

const NOBODY = "";
const CONTACT = "contato:";
const NEW = "novo";
/** Somebody from outside written on the hearing before the list, with no entry in it. */
const KEPT = "atual";

/** A WhatsApp as the list shows it: the number without the country's 55, masked. */
const phoneWords = (digits: string): string => formatPhoneBr(digits.startsWith("55") ? digits.slice(2) : digits);

/**
 * Who goes to a hearing, said where the firm takes notice of it (migration 0251, the owner, 2026-11-14): a colleague,
 * an attendee from outside of the firm's list, or one added there by name and WhatsApp, who joins the list for the
 * next hearings. Each choice is kept at once. ONE sends who goes the hearing's guide and records the result they send
 * to the firm's WhatsApp.
 */
export default function AttendeeChoice({
  hearingId,
  colleagues,
  current,
  disabled = false,
}: {
  hearingId: string;
  colleagues: readonly Colleague[];
  current: { userId: string | null; contactId: string | null; name: string | null };
  disabled?: boolean;
}) {
  const t = useTranslations("product");
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState<string>(
    current.userId ?? (current.contactId ? `${CONTACT}${current.contactId}` : current.name ? KEPT : NOBODY),
  );
  /** Who the hearing has, kept as a choice while it is not in the lists (until something else is chosen). */
  const [kept, setKept] = useState<string | null>(
    current.userId || !current.name ? null : current.contactId ? `${CONTACT}${current.contactId}` : KEPT,
  );
  const [contacts, setContacts] = useState<HearingContact[]>([]);
  const [adding, setAdding] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void hearingContacts()
      .then((read) => {
        if (alive && read.ok) setContacts(read.contacts);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const choose = (next: string) => {
    const before = value;
    const keptBefore = kept;
    setValue(next);
    setKept(null);
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await chooseHearingAttendee({
        hearingId,
        userId: next && !next.startsWith(CONTACT) ? next : null,
        contactId: next.startsWith(CONTACT) ? next.slice(CONTACT.length) : null,
      }).catch(() => ({ ok: false as const, code: "failed" }));
      if (result.ok) {
        setSaved(true);
        return;
      }
      setValue(before);
      setKept(keptBefore);
      setError(t(hearingErrorKey(result.code)));
    });
  };

  // The name on the hearing that is in no list (written before the list, or taken out of it) stays a choice.
  const keptShown = kept !== null && !contacts.some((contact) => `${CONTACT}${contact.id}` === kept);

  return (
    <>
      <TextField
        select
        size="small"
        id={`attendee-${hearingId}`}
        label={t("hearing-attendee-choice-label")}
        value={value}
        disabled={disabled || pending}
        onChange={(event) => {
          const next = String(event.target.value);
          if (next === NEW) setAdding(true);
          else if (next !== value && next !== KEPT) choose(next);
        }}
        error={Boolean(error)}
        helperText={error ?? (saved ? t("hearing-attendee-choice-saved") : t("hearing-attendee-choice-help"))}
        className="w-full max-w-md"
      >
        <MenuItem value={NOBODY}>{t("hearing-attendee-nobody")}</MenuItem>
        {colleagues.map((person) => (
          <MenuItem key={person.id} value={person.id}>
            {person.name}
          </MenuItem>
        ))}
        {contacts.length > 0 ? <ListSubheader>{t("hearing-attendee-contacts")}</ListSubheader> : null}
        {contacts.map((contact) => (
          <MenuItem key={contact.id} value={`${CONTACT}${contact.id}`}>
            {t("hearing-attendee-contact", { name: contact.name, phone: phoneWords(contact.phone) })}
          </MenuItem>
        ))}
        {keptShown && kept ? <MenuItem value={kept}>{current.name}</MenuItem> : null}
        <MenuItem value={NEW}>{t("hearing-attendee-add")}</MenuItem>
      </TextField>
      {adding ? (
        <HearingContactPanel
          onClose={() => setAdding(false)}
          onSaved={(contact) => {
            setAdding(false);
            setContacts((list) =>
              [...list.filter((item) => item.id !== contact.id), contact].sort((a, b) =>
                a.name.localeCompare(b.name, "pt-BR"),
              ),
            );
            choose(`${CONTACT}${contact.id}`);
          }}
        />
      ) : null}
    </>
  );
}
