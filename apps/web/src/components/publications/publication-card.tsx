"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type ElementType, useEffect, useRef, useState, useTransition } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogContent,
  TextField,
  Typography,
} from "@mui/material";

import DeadlinePanel from "@/components/deadlines/deadline-panel";
import HearingPanel from "@/components/hearings/hearing-panel";
import DialogHeader from "@/components/product/dialog-header";
import QuickActions, { type QuickAction } from "@/components/product/quick-actions";
import StateLine from "@/components/product/state-line";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiClock from "@/icons/nexture/ni-clock";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiDocumentCross from "@/icons/nexture/ni-document-cross";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiExternal from "@/icons/nexture/ni-external";
import NiFolder from "@/icons/nexture/ni-folder";
import NiInbox from "@/icons/nexture/ni-inbox";
import NiMoney from "@/icons/nexture/ni-money";
import NiScale from "@/icons/nexture/ni-scale";
import NiUser from "@/icons/nexture/ni-user";
import { caseLabel } from "@/lib/cases/cases";
import { STATUS_KEY as DEADLINE_STATUS_KEY } from "@/lib/deadlines/deadlines";
import type { DeadlineAct } from "@/lib/deadlines/facts";
import type { Colleague } from "@/lib/hearings/facts";
import {
  type CourtZones,
  isHearingZone,
  momentIn,
  STATUS_KEY as HEARING_STATUS_KEY,
  ZONE_KEY,
} from "@/lib/hearings/hearings";
import {
  acknowledgePublication,
  acknowledgePublicationCancel,
  readPublication,
  setPublicationJudgment,
  triagePublication,
} from "@/lib/publications/actions";
import type { PublicationProgress, PublicationRow } from "@/lib/publications/facts";
import type { Said } from "@/lib/publications/list-state";
import {
  CATEGORY_KEY,
  PUBLICATION_CATEGORIES,
  type PublicationCategory,
  publicationErrorKey,
} from "@/lib/publications/publications";
import { readingAdviceKey, readingOnCard, readingReasonKey, readingStatusKey } from "@/lib/publications/reading-words";
import { cn } from "@/lib/utils";
import { formatDayBr } from "@flyee/rules/person";

/*
 * One publication of the DJEN as a card, shared by every screen that works publications (`/publicacoes`, and a
 * case's own publications): what it is and where it comes from, the court's words, what ONE read of it, the six
 * answers, and at its foot the case, to whom, and what is kept one click away. Moved out of the publications screen
 * on 2026-11-05 so the case shows the same card; everything it needs comes by props.
 */

/**
 * The icon and the tint of a publication's card head, by what it is: what a person tells the cards of the list apart
 * by at a glance. One nobody said what it is yet takes the accent of "look at this".
 */
export const CATEGORY_LOOK: Record<PublicationCategory, { icon: React.ReactNode; tone: TileTone }> = {
  prazo: { icon: <NiClock size="medium" />, tone: "accent-3" },
  audiencia: { icon: <NiCalendar size="medium" />, tone: "accent-2" },
  decisao: { icon: <NiScale size="medium" />, tone: "primary" },
  pagamento: { icon: <NiMoney size="medium" />, tone: "secondary" },
  ciencia: { icon: <NiCheckSquare size="medium" />, tone: "accent-1" },
  outro: { icon: <NiDocumentFull size="medium" />, tone: "accent-4" },
};

/** A deadline is what nobody may miss: it takes the accent the app uses for "look at this". */
/** Of one nobody triaged yet, what ONE does with it (0104), in words. */
const TRIAGE_STATE_KEY: Record<"working" | "left", string> = {
  working: "publication-triage-working",
  left: "publication-triage-left",
};

export const CATEGORY_TONE: Record<PublicationCategory, StatusTone> = {
  prazo: "attention",
  audiencia: "attention",
  decisao: "primary",
  pagamento: "positive",
  ciencia: "neutral",
  outro: "neutral",
};

/**
 * One publication: where it comes from, the case it belongs to, the start
 * and the end of its text, and the six answers. The text is a court's: it is
 * rendered as plain text, never as markup. What the person says of it shows
 * on the spot and stays there, so a wrong click is one more click to undo.
 */
export default function PublicationCard({
  row,
  progress,
  acts,
  colleagues,
  courtZones,
  mayTriage,
  said,
  seen,
  onSaid,
  onSeen,
  onAcknowledged,
  inline = false,
}: {
  row: PublicationRow;
  /** What ONE recorded of it since the list was read, while ONE reads it. */
  progress: PublicationProgress | null;
  acts: readonly DeadlineAct[];
  colleagues: readonly Colleague[];
  courtZones: Readonly<Record<string, CourtZones>>;
  mayTriage: boolean;
  /** What the person said of it since the list was read: kept by the screen, so it is one word wherever it shows. */
  said: Said | null;
  /** The person said they saw its cancelling since the list was read. */
  seen: boolean;
  onSaid: (said: Said) => void;
  onSeen: () => void;
  /** The person said they are aware of ONE's triage (0104): what the list or the case does with it. */
  onAcknowledged?: () => void;
  /**
   * Drawn inside a line of its case's list (`ItemRows`): the line says what it is and where it stands, and gives the
   * awareness of ONE's triage, so the card leaves out its head, the way to the case and that awareness.
   */
  inline?: boolean;
}) {
  const t = useTranslations("product");
  const [pending, startTransition] = useTransition();
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState((said ? said.note : row.note) ?? "");
  const [noteOpen, setNoteOpen] = useState(Boolean(said ? said.note : row.note));
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState<{ text: string | null; truncated: boolean; failed: boolean } | null>(null);
  /** The form of a deadline counted from this publication, open; and what came of the last one sent. */
  const [counting, setCounting] = useState(false);
  const [counted, setCounted] = useState<string | null>(null);
  /** The form of a hearing written from this publication, open; and whether one was written since the list was read. */
  const [scheduling, setScheduling] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  /** The reading in course of the whole text: one that was closed meanwhile shows nothing when it arrives. */
  const reading = useRef(0);
  const changeButton = useRef<HTMLButtonElement | null>(null);
  const moveFocus = useRef(false);
  /**
   * Of a decision, whether it is the lawsuit's judgment (0096): what was read with the list, then what the triage
   * answered (the app's reading of its words) or the person said; `asking` while the person corrects it.
   */
  const [judgment, setJudgment] = useState(row.judgment);
  const [judgmentAsked, setJudgmentAsked] = useState(false);
  /** The person said here that they are aware of ONE's triage (0104). */
  const [acked, setAcked] = useState(false);

  const category = said ? said.category : row.category;
  const savedNote = said ? said.note : row.note;
  const deadlines = progress?.deadlines ?? row.deadlines;
  const hearings = progress?.hearings ?? row.hearings;
  /** What ONE read of what the publication set, or is reading now. */
  const readingNow = row.active
    ? readingOnCard(category, progress?.readings ?? row.readings, said?.reading ?? null, said?.at, progress?.readAt)
    : null;
  const leftToPerson = readingNow?.status === "unread" || readingNow?.status === "failed";
  /** What ONE left to a person was done since (a deadline, whatever became of it; a hearing, or its word): nothing more is asked. */
  const doneSince =
    readingNow?.kind === "deadline"
      ? deadlines.length > 0 || (progress?.anyDeadline ?? row.anyDeadline) || Boolean(counted)
      : hearings.length > 0 || (progress?.hearingSettled ?? row.hearingSettled) || scheduled;
  const readingWords =
    readingNow && !(leftToPerson && doneSince)
      ? t(readingStatusKey(readingNow), {
          reason: t(readingReasonKey(readingNow.reason)),
          advice: t(readingAdviceKey(readingNow.kind, readingNow.reason)),
        })
      : null;
  /** What ONE recorded from the publication stays where it is after its triage changed, and the card says so. */
  const staysWords = [
    category !== "prazo" && deadlines.some((deadline) => deadline.auto) ? t("publication-deadline-stays") : null,
    category !== "audiencia" && hearings.some((hearing) => hearing.auto && hearing.status === "scheduled")
      ? t("publication-hearing-stays")
      : null,
  ].filter(Boolean);
  const controls = mayTriage && row.active && (category === null || changing);

  // The answers leave the screen once one is given: the focus goes to what stands in their place.
  useEffect(() => {
    if (moveFocus.current && !controls) {
      moveFocus.current = false;
      changeButton.current?.focus();
    }
  }, [controls, category]);

  const triage = (chosen: PublicationCategory) =>
    startTransition(async () => {
      setError(null);
      try {
        const kept = note.trim() || null;
        const result = await triagePublication({ publicationId: row.id, category: chosen, note: kept });
        if (!result.ok) {
          setError(t(publicationErrorKey(result.code)));
          return;
        }
        moveFocus.current = true;
        onSaid({ category: chosen, note: kept, reading: result.reading ?? null, at: Date.now() });
        setChanging(false);
        // A decision: the app read its words, and asks the person only when they say nothing clear.
        if (chosen === "decisao") {
          setJudgment(typeof result.judgment === "boolean" ? { value: result.judgment, source: "rule" } : null);
          setJudgmentAsked(result.judgment === null);
        }
        // ONE reads what the publication set (0040): the card says so, and the form stays one click away.
        if (result.reading) return;
        // A publication that sets a time is counted right away, unless one of its deadlines already is.
        if (chosen === "prazo" && deadlines.length === 0 && !counted) setCounting(true);
        // One that sets a hearing of a lawsuit of the firm is written in the agenda right away, the same way.
        if (chosen === "audiencia" && row.proceedingId && hearings.length === 0 && !scheduled) setScheduling(true);
      } catch {
        setError(t("publication-error-failed"));
      }
    });

  /** The lawyer, or who triages, says they are aware of what ONE triaged it as (0104). */
  const acknowledgeTriage = () =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await acknowledgePublication(row.id, row.caseId);
        if (!result.ok) {
          setError(t(publicationErrorKey(result.code)));
          return;
        }
        setAcked(true);
        onAcknowledged?.();
      } catch {
        setError(t("publication-error-failed"));
      }
    });

  const sayJudgment = (value: boolean) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await setPublicationJudgment(row.id, value);
        if (!result.ok) {
          setError(t(publicationErrorKey(result.code)));
          return;
        }
        setJudgment({ value, source: "person" });
        setJudgmentAsked(false);
      } catch {
        setError(t("publication-error-failed"));
      }
    });

  const acknowledge = () =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await acknowledgePublicationCancel(row.id);
        if (result.ok) onSeen();
        else setError(t(publicationErrorKey(result.code)));
      } catch {
        setError(t("publication-error-failed"));
      }
    });

  const readAll = async () => {
    const mine = reading.current + 1;
    reading.current = mine;
    setFull({ text: null, truncated: false, failed: false });
    let next: { text: string | null; truncated: boolean; failed: boolean };
    try {
      const result = await readPublication(row.id);
      next = result.ok
        ? { text: result.text, truncated: result.truncated, failed: false }
        : { text: null, truncated: false, failed: true };
    } catch {
      next = { text: null, truncated: false, failed: true };
    }
    // Closed, or asked again, while it was on its way: this answer is nobody's.
    if (reading.current === mine) setFull(next);
  };
  const closeFull = () => {
    reading.current += 1;
    setFull(null);
  };

  const headline = [row.court, row.kind, row.documentType].filter(Boolean).join(" · ");
  /** What it is, in the words the court gave it (an intimation, an order); the court when it gave none. */
  const what = [row.kind, row.documentType].filter(Boolean).join(" · ") || row.court;
  const look = !row.active
    ? { icon: <NiDocumentCross size="medium" />, tint: "bg-error-light/10 text-error" }
    : category
      ? {
          icon: CATEGORY_LOOK[category].icon,
          tint: cn(TILE_TONE[CATEGORY_LOOK[category].tone].bg, TILE_TONE[CATEGORY_LOOK[category].tone].text),
        }
      : { icon: <NiInbox size="medium" />, tint: cn(TILE_TONE["accent-3"].bg, TILE_TONE["accent-3"].text) };
  const titleId = `publication-${row.id}`;
  const open = (url: string) => window.open(url, "_blank", "noopener,noreferrer");
  /** What the card keeps one click away: what a person seldom needs on every publication. */
  const offered: (QuickAction | null)[] = [
    mayTriage && row.active && category !== "prazo"
      ? {
          key: "deadline",
          label: t("publication-deadline-action"),
          icon: <NiClock size="small" />,
          onClick: () => setCounting(true),
        }
      : null,
    row.link
      ? {
          key: "court",
          label: t("publication-open-court"),
          icon: <NiExternal size="small" />,
          onClick: () => open(row.link as string),
        }
      : null,
    {
      key: "certificate",
      label: t("publication-certificate"),
      icon: <NiDocumentCheck size="small" />,
      onClick: () => open(row.certificateUrl),
    },
  ];
  const more = offered.filter((action): action is QuickAction => action !== null);
  const answers = (
    <TriageAnswers
      current={category}
      pending={pending}
      note={note}
      noteOpen={noteOpen}
      noteChanged={(note.trim() || null) !== (savedNote ?? null)}
      onNote={setNote}
      onOpenNote={() => setNoteOpen(true)}
      onChoose={triage}
      onKeep={category !== null ? () => setChanging(false) : undefined}
      error={error}
    />
  );

  // Inside a line, the card is the line's body: no surface, no head of its own.
  const Outer: ElementType = inline ? Box : Card;
  const Inner: ElementType = inline ? Box : CardContent;

  return (
    <Outer component="article" {...(inline ? { "aria-label": what } : { "aria-labelledby": titleId })}>
      <Inner className="flex flex-col gap-4">
        {/* What it is, where it comes from, and where it stands. */}
        {inline ? null : (
          <Box className="flex flex-row items-start gap-3">
            <Box
              aria-hidden
              className={cn("flex h-10 w-10 flex-none items-center justify-center rounded-xl", look.tint)}
            >
              {look.icon}
            </Box>
            <Box className="flex min-w-0 flex-1 flex-col gap-0.5">
              <Typography id={titleId} variant="body1" component="h3" className="mb-0 font-semibold">
                {what}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {[row.court, row.unit].filter(Boolean).join(" · ")}
              </Typography>
            </Box>
            <Box className="flex flex-none flex-wrap justify-end gap-1">
              {!row.active ? <StatusChip tone="danger" label={t("publication-cancelled")} /> : null}
              {category ? (
                <StatusChip tone={CATEGORY_TONE[category]} label={t(CATEGORY_KEY[category])} />
              ) : row.active ? (
                <StatusChip tone="attention" label={t("publications-view-untriaged")} />
              ) : null}
            </Box>
          </Box>
        )}

        <Typography variant="body2" className={cn("text-text-secondary", !inline && "-mt-2")}>
          {[
            inline ? [row.court, row.unit].filter(Boolean).join(" · ") : null,
            t("publication-case-number", { number: row.cnj }),
            t("publication-available-on", { day: formatDayBr(row.availableOn) ?? row.availableOn }),
            row.className,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Typography>

        {!row.active ? (
          <Alert
            severity="warning"
            className="neutral bg-background-paper/60!"
            action={
              row.cancelUnseen && !seen && mayTriage ? (
                <Button color="inherit" size="small" onClick={acknowledge} disabled={pending}>
                  {t("publication-cancel-seen-action")}
                </Button>
              ) : undefined
            }
          >
            {[
              row.cancelUnseen && !seen && category
                ? t("publication-cancel-unseen", { category: t(CATEGORY_KEY[category]) })
                : null,
              row.cancelReason ? t("publication-cancel-reason", { reason: row.cancelReason }) : null,
              row.cancelledLabel ? t("publication-cancelled-at", { when: row.cancelledLabel }) : null,
            ]
              .filter(Boolean)
              .join(" ") || t("publication-cancelled")}
          </Alert>
        ) : null}

        {/* The court's own words: what the person reads before saying what it is. */}
        <Box className="bg-grey-25 flex flex-col gap-1 rounded-2xl p-4">
          <Typography variant="body1" className="break-words">
            {row.head || t("publication-no-text")}
          </Typography>
          {row.tail ? (
            <>
              <Typography variant="body2" className="text-text-secondary" aria-hidden>
                {t("publication-text-gap")}
              </Typography>
              <Typography variant="body1" className="break-words">
                {row.tail}
              </Typography>
            </>
          ) : null}
          {row.truncated ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("publication-truncated")}
            </Typography>
          ) : null}
          {row.tail || row.truncated ? (
            <Box className="-ml-2 pt-1">
              <Button variant="text" color="primary" size="small" onClick={readAll}>
                {t("publication-read-all")}
              </Button>
            </Box>
          ) : null}
        </Box>

        {readingWords && leftToPerson ? (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {readingWords}
          </Alert>
        ) : readingWords ? (
          <Typography variant="body2" className="text-text-secondary" role="status">
            {readingWords}
          </Typography>
        ) : null}
        {staysWords.length > 0 ? (
          <Typography variant="body2" className="text-text-secondary">
            {staysWords.join(" ")}
          </Typography>
        ) : null}

        {category === "decisao" && row.active ? (
          judgment && !judgmentAsked ? (
            <StateLine
              tone={judgment.source === "person" ? "done" : "info"}
              action={
                mayTriage ? (
                  <Button
                    variant="text"
                    color="grey"
                    size="small"
                    disabled={pending}
                    onClick={() => setJudgmentAsked(true)}
                  >
                    {t("publication-judgment-change")}
                  </Button>
                ) : undefined
              }
            >
              {t(judgmentWordsKey(judgment))}
            </StateLine>
          ) : (
            <StateLine
              tone="attention"
              action={
                mayTriage ? (
                  <Box className="flex flex-wrap gap-2">
                    <Button
                      variant="outlined"
                      color="grey"
                      size="small"
                      disabled={pending}
                      onClick={() => sayJudgment(true)}
                    >
                      {t("publication-judgment-yes")}
                    </Button>
                    <Button
                      variant="outlined"
                      color="grey"
                      size="small"
                      disabled={pending}
                      onClick={() => sayJudgment(false)}
                    >
                      {t("publication-judgment-no")}
                    </Button>
                  </Box>
                ) : undefined
              }
            >
              {t("publication-judgment-ask")}
            </StateLine>
          )
        ) : null}

        {hearings.length > 0 || scheduled ? (
          <Box className="flex flex-col gap-1" role="status">
            {hearings.map((hearing) => {
              const when = momentIn(hearing.startsAt, hearing.timeZone);
              // Brasília goes unsaid, as on the hearing's own card.
              const zoneWords =
                hearing.timeZone !== "America/Sao_Paulo" && isHearingZone(hearing.timeZone)
                  ? t(ZONE_KEY[hearing.timeZone])
                  : null;
              return (
                <Typography key={hearing.id} variant="body2">
                  {t("publication-hearing", {
                    day: when.day,
                    time: when.time,
                    status: t(HEARING_STATUS_KEY[hearing.status]),
                  })}
                  {zoneWords ? ` · ${zoneWords}` : ""}
                </Typography>
              );
            })}
            {scheduled && hearings.length === 0 ? (
              <Typography variant="body2">{t("hearing-scheduled-notice")}</Typography>
            ) : null}
          </Box>
        ) : null}

        {deadlines.length > 0 || counted ? (
          <Box className="flex flex-col gap-1" role="status">
            {deadlines.map((deadline) => (
              <Typography key={deadline.id} variant="body2">
                {deadline.urgentOn
                  ? t("publication-deadline", {
                      title: deadline.title,
                      day: formatDayBr(deadline.urgentOn) ?? deadline.urgentOn,
                      status: t(DEADLINE_STATUS_KEY[deadline.status]),
                    })
                  : t("publication-deadline-counting", { title: deadline.title })}
              </Typography>
            ))}
            {counted ? <Typography variant="body2">{counted}</Typography> : null}
          </Box>
        ) : null}

        {row.byAi && row.reviewDue && !said && category && !controls && row.active ? (
          <Alert
            severity="info"
            className="neutral bg-background-paper/60!"
            action={
              mayTriage ? (
                <Button color="inherit" size="small" disabled={pending} onClick={() => triage(category)}>
                  {t("publication-by-ai-confirm")}
                </Button>
              ) : undefined
            }
          >
            {t("publication-by-ai-review", { category: t(CATEGORY_KEY[category]) })}
          </Alert>
        ) : null}

        {!inline && row.ackOwed && !acked && !said && category && !controls && row.active ? (
          <StateLine
            tone="attention"
            emphasis
            action={
              mayTriage ? (
                <Button variant="contained" size="small" disabled={pending} onClick={acknowledgeTriage}>
                  {t("publication-ack")}
                </Button>
              ) : undefined
            }
          >
            {row.lawyers.length > 0
              ? t("publication-ack-owed", { category: t(CATEGORY_KEY[category]), names: row.lawyers.join(", ") })
              : t("publication-ack-owed-anyone", { category: t(CATEGORY_KEY[category]) })}
          </StateLine>
        ) : null}

        {category && !controls ? (
          <Box className="flex flex-wrap items-center gap-3">
            {" "}
            <Typography variant="body2" className="text-text-secondary min-w-0 flex-1" role="status">
              {[
                said
                  ? t("publication-triage-done", { category: t(CATEGORY_KEY[category]) })
                  : row.byAi && row.triagedLabel
                    ? // What ONE classified may be wrong, until a person checked it.
                      row.reviewedBy
                      ? t("publication-by-ai", { when: row.triagedLabel })
                      : [t("publication-by-ai", { when: row.triagedLabel }), t("publication-one-may-err")].join(" · ")
                    : row.triagedBy && row.triagedLabel
                      ? t("publication-triaged-by", { name: row.triagedBy, when: row.triagedLabel })
                      : row.triagedLabel
                        ? t("publication-triaged-at", { when: row.triagedLabel })
                        : null,
                !said && row.reviewedBy && row.reviewedLabel
                  ? t("publication-reviewed-by", { name: row.reviewedBy, when: row.reviewedLabel })
                  : null,
                // The awareness of ONE's triage (0104), once given.
                !said && acked
                  ? t("publication-acked-now")
                  : !said && row.ackedBy && row.ackedLabel
                    ? t("publication-acked-by", { name: row.ackedBy, when: row.ackedLabel })
                    : null,
                savedNote,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Typography>
            {mayTriage && row.active ? (
              <Button ref={changeButton} variant="text" color="grey" size="small" onClick={() => setChanging(true)}>
                {t(row.ackOwed && !acked && !said ? "publication-correct" : "publication-change")}
              </Button>
            ) : null}
          </Box>
        ) : null}

        {category === null && row.triageState && row.active ? (
          <StateLine tone={row.triageState === "working" ? "waiting" : "info"}>
            {t(TRIAGE_STATE_KEY[row.triageState])}
          </StateLine>
        ) : null}
        {controls && !full ? answers : null}
        {!controls && error ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {error}
          </Alert>
        ) : null}

        {/* Of which case, to whom, what the publication set in motion, and what is kept one click away. */}
        <Box className="border-grey-100 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <Box className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
            {inline ? null : row.caseId ? (
              <Button
                variant="text"
                color="primary"
                size="small"
                href={`/casos/${row.caseId}`}
                LinkComponent={Link}
                startIcon={<NiFolder size="small" />}
                className="-ml-2"
              >
                {row.caseSeq !== null
                  ? t("publication-open-case", { label: caseLabel(row.caseSeq) })
                  : t("publication-open-case-plain")}
              </Button>
            ) : (
              <Typography variant="body2" className="text-text-secondary">
                {t("publication-no-case")}
              </Typography>
            )}
            {row.lawyers.length > 0 ? (
              <Box className="flex flex-row items-center gap-1.5">
                <NiUser size="small" className="text-text-secondary" />
                <Typography variant="body2" className="text-text-secondary">
                  {t("publication-addressed-to", { names: row.lawyers.join(", ") })}
                </Typography>
              </Box>
            ) : null}
          </Box>
          <Box className="flex flex-wrap items-center gap-2">
            {mayTriage && row.active && category === "prazo" ? (
              <Button variant="outlined" color="grey" size="small" onClick={() => setCounting(true)}>
                {t("publication-deadline-action")}
              </Button>
            ) : null}
            {deadlines.length > 0 ? (
              <Button variant="text" color="grey" size="small" href="/prazos" LinkComponent={Link}>
                {t("publication-deadline-see")}
              </Button>
            ) : null}
            {mayTriage && row.active && row.proceedingId && category === "audiencia" ? (
              <Button variant="outlined" color="grey" size="small" onClick={() => setScheduling(true)}>
                {t("publication-hearing-action")}
              </Button>
            ) : null}
            {hearings.length > 0 || scheduled ? (
              <Button variant="text" color="grey" size="small" href="/agenda" LinkComponent={Link}>
                {t("publication-hearing-see")}
              </Button>
            ) : null}
            <QuickActions label={t("publication-more-actions")} actions={more} />
          </Box>
        </Box>
      </Inner>

      {scheduling && row.proceedingId ? (
        <HearingPanel
          subject={{
            proceedingId: row.proceedingId,
            lawsuitLabel: [row.caseSeq !== null ? caseLabel(row.caseSeq) : null, row.cnj, row.court]
              .filter(Boolean)
              .join(" · "),
            publicationId: row.id,
            zones: row.court ? (courtZones[row.court] ?? null) : null,
          }}
          colleagues={colleagues}
          onClose={() => setScheduling(false)}
          onSaved={() => {
            setScheduling(false);
            setScheduled(true);
          }}
        />
      ) : null}

      {counting ? (
        <DeadlinePanel
          subject={{
            kind: "publication",
            publicationId: row.id,
            availableOn: row.availableOn,
            proceedingKind: row.proceedingKind,
          }}
          existing={deadlines.map((deadline) => deadline.title)}
          acts={acts}
          onClose={() => setCounting(false)}
          onSaved={(saved) => {
            setCounting(false);
            setCounted(
              saved.dueOn
                ? t("deadline-proposed-notice", { day: formatDayBr(saved.dueOn) ?? saved.dueOn })
                : t("deadline-proposed-notice-counting"),
            );
          }}
        />
      ) : null}

      {full ? (
        <Dialog open onClose={closeFull} aria-labelledby={`${titleId}-full`} maxWidth="md" fullWidth>
          <DialogHeader
            id={`${titleId}-full`}
            title={headline}
            onClose={closeFull}
            closeLabel={t("publication-close")}
          />
          <DialogContent className="flex flex-col gap-4">
            {full.failed ? (
              <Alert severity="error" className="neutral bg-background-paper/60!">
                {t("publication-read-all-error")}
              </Alert>
            ) : full.text === null ? (
              <Box className="flex justify-center py-10">
                <CircularProgress aria-label={t("publication-read-all-loading")} />
              </Box>
            ) : (
              <>
                {full.truncated ? (
                  <Alert severity="info" className="neutral bg-background-paper/60!">
                    {t("publication-truncated")}
                  </Alert>
                ) : null}
                <Typography variant="body1" component="div" className="break-words whitespace-pre-line">
                  {full.text}
                </Typography>
              </>
            )}
            {/* Who read the whole text says what it is right there. */}
            {controls ? <Box className="border-grey-100 border-t pt-3">{answers}</Box> : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </Outer>
  );
}

/**
 * The six answers, with the note that may go with one. The note is written
 * before the answer is chosen, because choosing is what saves; on a
 * publication already triaged, the note alone is saved with the word it has.
 */
function TriageAnswers({
  current,
  pending,
  note,
  noteOpen,
  noteChanged,
  onNote,
  onOpenNote,
  onChoose,
  onKeep,
  error,
}: {
  current: PublicationCategory | null;
  pending: boolean;
  note: string;
  noteOpen: boolean;
  noteChanged: boolean;
  onNote: (value: string) => void;
  onOpenNote: () => void;
  onChoose: (category: PublicationCategory) => void;
  /** Leaves the publication as it is: only when it already has a word. */
  onKeep?: () => void;
  error: string | null;
}) {
  const t = useTranslations("product");
  return (
    <Box className="flex flex-col gap-3">
      {noteOpen ? (
        <TextField
          size="small"
          label={t("publication-note-label")}
          helperText={t("publication-note-help")}
          value={note}
          onChange={(event) => onNote(event.target.value.slice(0, 1000))}
          disabled={pending}
          fullWidth
        />
      ) : null}
      <Typography variant="subtitle2" component="p" className="mb-0">
        {t("publication-triage-question")}
      </Typography>
      <Box className="flex flex-wrap gap-2" role="group" aria-label={t("publication-triage-question")}>
        {PUBLICATION_CATEGORIES.map((category) => (
          <Button
            key={category}
            variant={current === category ? "contained" : "outlined"}
            color={current === category ? "primary" : "grey"}
            size="small"
            aria-pressed={current === category}
            disabled={pending}
            onClick={() => onChoose(category)}
          >
            {t(CATEGORY_KEY[category])}
          </Button>
        ))}
      </Box>
      <Box className="flex flex-wrap gap-2">
        {!noteOpen ? (
          <Button variant="text" color="grey" size="small" disabled={pending} onClick={onOpenNote}>
            {t("publication-note-add")}
          </Button>
        ) : null}
        {current !== null && noteOpen && noteChanged ? (
          <Button variant="outlined" color="grey" size="small" disabled={pending} onClick={() => onChoose(current)}>
            {t("publication-note-save")}
          </Button>
        ) : null}
        {onKeep ? (
          <Button variant="text" color="grey" size="small" disabled={pending} onClick={onKeep}>
            {t("publication-change-cancel")}
          </Button>
        ) : null}
      </Box>
      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      ) : null}
    </Box>
  );
}

/** What a card says of the word on a decision being the judgment (0096): the app's reading, or a person's answer. */
function judgmentWordsKey(judgment: { value: boolean; source: "rule" | "person" }): string {
  if (judgment.source === "person") {
    return judgment.value ? "publication-judgment-person-yes" : "publication-judgment-person-no";
  }
  return judgment.value ? "publication-judgment-rule-yes" : "publication-judgment-rule-no";
}
