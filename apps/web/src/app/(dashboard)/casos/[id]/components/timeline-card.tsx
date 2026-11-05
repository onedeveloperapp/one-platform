"use client";

import { type CaseState, EVENTS_SHOWN } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import { eventKeyOf, isCaseStatus, STATUS_KEY } from "@/lib/cases/cases";
import { opensOnArrival } from "@/lib/cases/sections";

type Ready = Extract<CaseState, { kind: "ready" }>;

const ACTOR_KEY: Record<string, string> = {
  client: "case-actor-client",
  support: "case-actor-support",
  system: "case-actor-system",
  ai: "case-actor-ai",
};

/** How many of the latest events the card shows before the person asks for the rest. */
const RECENT_SHOWN = 6;

const moment = (iso: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));

/**
 * What happened to the case, the newest first: who did what and when, the
 * client's steps on their link among the firm's. The events name what
 * changed, never the values typed (migration 0022). The latest few show; the
 * rest of the story is one click away.
 */
export default function TimelineCard({ state }: { state: Ready }) {
  const t = useTranslations("product");
  const [all, setAll] = useState(false);
  const shown = all ? state.events : state.events.slice(0, RECENT_SHOWN);
  const latest = state.events[0] ?? null;

  const label = (event: Ready["events"][number]) => {
    if (event.kind === "status_changed" && isCaseStatus(event.data.to)) {
      return t("case-event-status-to", { status: t(STATUS_KEY[event.data.to]) });
    }
    const key = eventKeyOf(event);
    return key ? t(key) : event.kind;
  };
  const actor = (event: Ready["events"][number]) =>
    event.actorType === "person"
      ? (event.actorName ?? t("case-actor-person"))
      : t(ACTOR_KEY[event.actorType] ?? "case-actor-system");

  return (
    <CollapsibleCard
      id="case-timeline"
      title={t("case-timeline-title")}
      summary={latest ? t("case-timeline-summary-latest", { what: label(latest), when: moment(latest.at) }) : null}
      summaryClosedOnly
      defaultOpen={opensOnArrival(state.case.status, "timeline", false)}
      bodyClassName="gap-3"
    >
      <Box component="ol" className="m-0 flex list-none flex-col gap-3 p-0">
        {shown.map((event) => (
          <Box component="li" key={event.id} className="border-grey-100 flex flex-col border-l-2 pl-3">
            <Typography variant="body2" className="font-semibold">
              {label(event)}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {actor(event)} · {moment(event.at)}
            </Typography>
          </Box>
        ))}
      </Box>
      {state.events.length > RECENT_SHOWN ? (
        <Box>
          <Button variant="text" color="grey" size="small" className="-ml-2" onClick={() => setAll((now) => !now)}>
            {all
              ? t("case-timeline-show-recent")
              : t("case-timeline-show-all", { count: state.events.length - RECENT_SHOWN })}
          </Button>
        </Box>
      ) : null}
      {all && state.events.length >= EVENTS_SHOWN && (
        <Typography variant="body2" className="text-text-secondary">
          {t("case-timeline-more", { count: EVENTS_SHOWN })}
        </Typography>
      )}
    </CollapsibleCard>
  );
}
