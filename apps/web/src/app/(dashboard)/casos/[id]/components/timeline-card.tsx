"use client";

import { type CaseState, EVENTS_SHOWN } from "../case-types";
import { useTranslations } from "next-intl";

import { Box, Card, CardContent, Typography } from "@mui/material";

import { EVENT_KEY, isCaseStatus, STATUS_KEY } from "@/lib/cases/cases";

type Ready = Extract<CaseState, { kind: "ready" }>;

const ACTOR_KEY: Record<string, string> = {
  client: "case-actor-client",
  support: "case-actor-support",
  system: "case-actor-system",
  ai: "case-actor-ai",
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
 * What happened to the case, the newest first: who did what and when, the
 * client's steps on their link among the firm's. The events name what
 * changed, never the values typed (migration 0022).
 */
export default function TimelineCard({ state }: { state: Ready }) {
  const t = useTranslations("product");

  const label = (event: Ready["events"][number]) => {
    if (event.kind === "status_changed" && isCaseStatus(event.data.to)) {
      return t("case-event-status-to", { status: t(STATUS_KEY[event.data.to]) });
    }
    return EVENT_KEY[event.kind] ? t(EVENT_KEY[event.kind]) : event.kind;
  };
  const actor = (event: Ready["events"][number]) =>
    event.actorType === "person"
      ? (event.actorName ?? t("case-actor-person"))
      : t(ACTOR_KEY[event.actorType] ?? "case-actor-system");

  return (
    <Card component="section" aria-labelledby="case-timeline">
      <CardContent className="flex flex-col gap-3">
        <Typography id="case-timeline" variant="h5" component="h2" className="mb-0">
          {t("case-timeline-title")}
        </Typography>
        <Box component="ol" className="m-0 flex list-none flex-col gap-3 p-0">
          {state.events.map((event) => (
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
        {state.events.length >= EVENTS_SHOWN && (
          <Typography variant="body2" className="text-text-secondary">
            {t("case-timeline-more", { count: EVENTS_SHOWN })}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
