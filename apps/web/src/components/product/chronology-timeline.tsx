"use client";

import Timeline from "@mui/lab/Timeline";
import TimelineConnector from "@mui/lab/TimelineConnector";
import TimelineContent from "@mui/lab/TimelineContent";
import TimelineDot from "@mui/lab/TimelineDot";
import TimelineItem from "@mui/lab/TimelineItem";
import TimelineOppositeContent, { timelineOppositeContentClasses } from "@mui/lab/TimelineOppositeContent";
import TimelineSeparator from "@mui/lab/TimelineSeparator";
import { Box, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import { type ChronologyDay, moneyParts } from "@/lib/cases/chronology";
import { cn } from "@/lib/utils";

/**
 * A chronology as a timeline (the owner's canvas of 2026-11-24, "Cartões do caso, antes e depois"): the day as a
 * heading, the moment in its own column (in a narrow card, at the start of the fact, so the text keeps its width), a
 * point on the line for each fact that says its moment and a smaller one, in the same place, for a fact that does
 * not, what came from the official record marked, and an amount of money stressed. The facts are
 * `chronologyTimeline` of `lib/cases/chronology.ts`, which only reads what each line opens with: nothing is reordered
 * or dropped. The catalog's template "Timeline de atividade" (@mui/lab Timeline), packaged.
 *
 * Closest catalog entries: `ProgressSteps`, which tells the few steps that mark a way, never every fact; and the case's
 * "Linha do tempo", the events of ONE's work, a list of its own.
 */
export default function ChronologyTimeline({
  days,
  recordLabel,
  label,
  muted = false,
}: {
  days: ChronologyDay[];
  /** The words of the mark of a fact from the official record ("Registro da ANAC"). */
  recordLabel: string;
  /** What the timeline is, for assistive technology ("Cronologia"). */
  label: string;
  /** Drawn quieter: a chronology that no longer holds (the one the client contested). */
  muted?: boolean;
}) {
  return (
    <Box
      role="group"
      aria-label={label}
      className={cn("@container flex flex-col gap-1", muted && "text-text-secondary")}
    >
      {days.map((day, dayIndex) => (
        <Box key={`${day.day ?? "sem-dia"}-${dayIndex}`} className="flex flex-col">
          {day.day ? (
            <Typography
              variant="subtitle2"
              component="h4"
              className="bg-grey-50 text-text-primary mt-2 mb-0 self-start rounded-full px-3 py-0.5"
            >
              {day.day}
            </Typography>
          ) : null}
          <Timeline
            className="m-0"
            sx={{ [`& .${timelineOppositeContentClasses.root}`]: { flex: "0 0 7rem", maxWidth: "7rem" } }}
          >
            {day.events.map((event, index) => (
              <TimelineItem key={`${index}-${event.text.slice(0, 24)}`} className="min-h-0">
                {/* The moment's own column, where the card has room for it; in a narrow one it opens the fact. */}
                <TimelineOppositeContent className="hidden pt-2.5 pl-0 text-right @md:block">
                  {event.time ? (
                    <Typography
                      variant="body2"
                      component="span"
                      className="text-text-primary font-semibold tabular-nums"
                    >
                      {event.time}
                    </Typography>
                  ) : null}
                </TimelineOppositeContent>
                <TimelineSeparator>
                  {/* A fact with no moment of its own is a smaller point in the same place: its text lines up. */}
                  <TimelineDot
                    variant="outlined"
                    color={event.marked && !muted ? "primary" : "grey"}
                    className={cn(!event.marked && "scale-60")}
                  />
                  {index < day.events.length - 1 ? <TimelineConnector /> : null}
                </TimelineSeparator>
                <TimelineContent className="pb-3">
                  {event.time ? (
                    <Typography
                      variant="body1"
                      component="span"
                      className="text-text-primary mr-2 font-semibold tabular-nums @md:hidden"
                    >
                      {event.time}
                    </Typography>
                  ) : null}
                  <Typography variant="body1" component="span" className={cn(muted && "text-text-secondary")}>
                    {moneyParts(event.text).map((part, partIndex) =>
                      part.money ? (
                        <Box component="strong" key={partIndex} className="font-semibold">
                          {part.text}
                        </Box>
                      ) : (
                        <span key={partIndex}>{part.text}</span>
                      ),
                    )}
                  </Typography>
                  {event.record ? (
                    <StatusChip tone="primary" label={recordLabel} className="ml-2 align-middle" />
                  ) : null}
                </TimelineContent>
              </TimelineItem>
            ))}
          </Timeline>
        </Box>
      ))}
    </Box>
  );
}
