"use client";

import type { CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

type Ready = Extract<CaseState, { kind: "ready" }>;

const moment = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));

/**
 * What the client owes on their link, said with who answers it and since when (the owner, 2026-11-12: "não entendi
 * onde ser feito"): the person themself, or who answers for a minor; the link as the case holds it (asked on such a
 * day, opened on another, finished without it, or not sent yet, with the way to the card of the link). The cards
 * that list what the client owes (the people's data, the documents) say it the same way, so a wait of the client
 * (`WAIT_PLACE`) never reads as the firm's task.
 */
export function useClientAsked(state: Ready) {
  const t = useTranslations("product");
  return (personId: string | null, what: string): ReactNode => {
    const party = state.parties.find((candidate) => candidate.person.person_id === personId) ?? state.parties[0];
    const minorOf = state.parties.find(
      (candidate) => candidate.person.person_id === personId && candidate.guardianPartyId,
    );
    const guardian = minorOf ? state.parties.find((candidate) => candidate.partyId === minorOf.guardianPartyId) : null;
    const who = guardian?.person ?? party?.person ?? null;
    if (!who) return t("case-asked-no-link-anyone", { what });
    const name = who.full_name.split(" ")[0] || who.full_name;
    const link = state.links
      .filter(
        (item) => item.personId === who.person_id && !item.revokedAt && item.expiresAt.slice(0, 10) >= state.today,
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (link?.finishedAt) return t("case-asked-link-finished", { what, name });
    if (link) {
      return link.lastOpenedAt
        ? t("case-asked-link-opened", { what, name, when: moment(link.createdAt), opened: moment(link.lastOpenedAt) })
        : t("case-asked-link", { what, name, when: moment(link.createdAt) });
    }
    return t.rich("case-asked-no-link", {
      what,
      name,
      link: (chunks) => (
        <a href="#case-link" className="text-text-primary font-semibold underline">
          {chunks}
        </a>
      ),
    });
  };
}
