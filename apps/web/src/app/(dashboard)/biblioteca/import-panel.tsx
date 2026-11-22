"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Collapse, TextField, Typography } from "@mui/material";

import { AtWorkBody, type AtWorkStep } from "@/components/product/at-work-notice";
import InfoHint from "@/components/product/info-hint";
import StateLine from "@/components/product/state-line";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import type { ModelDocument } from "@/lib/cases/drafts";
import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";
import {
  answerModelQuestions,
  dismissModelFromDocument,
  readModelFromDocument,
  requestModelFromDocument,
  startModelSource,
} from "@/lib/library/import-actions";
import type { ImportLimits, PreparedModel, SavedModel, TemplateImportView } from "@/lib/library/import-read";
import {
  DOCUMENT_NAMED_KEY,
  DOCX_MIME,
  HELD_KEY,
  type HeldReason,
  IDENTIFIER_KEY,
  IMPORT_ACCEPT,
  importFailureKey,
  type ImportQuestion,
  type ImportRefusal,
  importRefusalKey,
  isOtherTextFormat,
  MISSING_KEY,
  type ModelCheck,
  REFUSED_KEY,
} from "@/lib/library/imports";

/**
 * How long the panel waits between two looks at what ONE does: often at first, then less, then seldom, for as long
 * as the panel is open. It stopped looking after ten minutes, and a panel left open then said "reading" for ever.
 */
const FIRST_LOOKS_MS = 3_000;
const LATER_LOOKS_MS = 6_000;
const SELDOM_LOOKS_MS = 20_000;
const OFTEN_FOR_MS = 60_000;
const WATCH_FOR_MS = 10 * 60_000;
/** A moment as the panel says it: the day and the hour in Brasília. */
const sinceLabel = (at: string): string =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(at));
/** The longest answer, as the setting says it. */
const MOST_ANSWER = 1000;
/** The hour a request was sent, as the panel's foot says it: the hour alone today, the day too before. */
const sentWords = (at: string): { today: boolean; words: string } => {
  const when = new Date(at);
  const day = (date: Date) =>
    new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
  const today = day(when) === day(new Date());
  return {
    today,
    words: today
      ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(
          when,
        )
      : sinceLabel(at),
  };
};
/** Where what ONE prepares waits once the panel is closed, as the panel says it. */
const MAY_CLOSE_KEY = { library: "library-import-may-close", setup: "library-import-may-close-setup" } as const;
/** The steps of ONE's work on a document, in order: what the panel draws while it is sent and while ONE works. */
const WORK_STEPS = [
  "library-import-step-send",
  "library-import-step-read",
  "library-import-step-marking",
  "library-import-step-ready",
] as const;

type Working = "reading" | "marking" | "saving";

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; fileName: string; sentAt: string }
  | {
      kind: "waiting";
      importId: string;
      fileName: string | null;
      work: Working;
      aiDownSince?: string | null;
      /** When the request was made; null until the panel read it. */
      sentAt?: string | null;
    }
  | { kind: "asking"; importId: string; fileName: string; questions: ImportQuestion[]; round: number }
  | {
      kind: "ready";
      importId: string;
      fileName: string;
      source: "docx" | "pdf";
      prepared: PreparedModel;
      heldReason: HeldReason | null;
    }
  | {
      kind: "saved";
      importId: string;
      fileName: string;
      source: "docx" | "pdf";
      prepared: PreparedModel | null;
      saved: SavedModel | null;
    }
  /** ONE refused the document, with why. */
  | {
      kind: "rejected";
      importId: string;
      fileName: string;
      refusal: ImportRefusal | null;
      expected: ModelDocument | null;
    }
  | { kind: "failed"; importId: string; fileName: string; failure: string | null }
  /** The file could not be sent, or ONE could not be asked. */
  | { kind: "refused"; code: string; most?: number };

/** The type a file is reserved under: a Word file or a PDF by its name, whatever the browser says of it. */
const declaredMime = (file: File): string => {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) return DOCX_MIME;
  if (name.endsWith(".pdf")) return "application/pdf";
  return mimeOf(file);
};

/** What a refusal of an answer says. */
const ANSWER_ERROR_KEY: Record<string, string> = {
  no_answer: "library-import-answer-none",
  too_long: "library-import-answer-too-long",
  not_allowed: "library-import-refused-not-allowed",
  not_allowed_in_support_session: "library-import-refused-support",
};

/**
 * The firm's own model made from a document it already uses (migrations
 * 0067 and 0079), as the dialog of a new model offers it: the person sends a
 * Word file or a PDF (in the setup's step, as a paper: `expected`), and ONE
 * reads it, checks it, asks what only the firm knows and, where the firm lets
 * it, saves the firm's model by itself. While ONE works, the panel says what
 * it is doing, looks again by itself, and may be closed: what ONE does waits
 * in the library. It says, in place: what ONE asks, each question with its
 * answer field; why ONE refused the document, with the way to send another;
 * the model ONE saved (`onSavedByOne`, the dialog then edits it); or what ONE
 * prepared for a person (`onPrepared`), with why it waits. Either way it says
 * that ONE may err, what ONE changed of the document (each change against
 * what was there) and what still looks like the original case.
 *
 * `importId` opens it on a request already made (from the library's list or
 * the setup's step); `initialFile` on a file the person chose before the
 * dialog opened.
 */
export default function ImportPanel({
  importId,
  initialView = null,
  initialFile,
  limits,
  expected = null,
  makeDefault = false,
  disabled,
  waitsIn = "library",
  onBusy,
  onPrepared,
  onSavedByOne,
  onCleared,
  onRequested,
}: {
  importId: string | null;
  /** A first read of the request, when the screen has one: drawn at once (also from fixtures, with no session). */
  initialView?: TemplateImportView | null;
  initialFile: File | null;
  limits: ImportLimits | null;
  /** What the document is sent as: ONE refuses another thing. */
  expected?: ModelDocument | null;
  /** The model ONE saves takes the place of the firm's default of it. */
  makeDefault?: boolean;
  /** The dialog is saving: nothing is sent meanwhile. */
  disabled: boolean;
  /** Where what ONE prepares waits once the panel is closed: the library's "Esperam você", or the setup's step. */
  waitsIn?: "library" | "setup";
  /** ONE is being sent the document or works on it: the dialog's own fields wait. */
  onBusy: (busy: boolean) => void;
  /** What ONE prepared for a person, for the dialog to fill itself with, the request it came from and the document's name. */
  onPrepared: (importId: string, prepared: PreparedModel, fileName: string) => void;
  /** The model ONE saved: the dialog edits it from then on. */
  onSavedByOne?: (saved: SavedModel) => void;
  /** The request went (given up): the dialog is a new model written by hand again. */
  onCleared: () => void;
  /** ONE was asked: the screen behind the dialog lists the request, whether the dialog stays open or not. */
  onRequested?: () => void;
}) {
  const t = useTranslations("product");
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>(
    importId ? { kind: "waiting", importId, fileName: null, work: "reading" } : { kind: "idle" },
  );
  const [showChanges, setShowChanges] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [answers, setAnswers] = useState<string[]>([]);
  const [answering, setAnswering] = useState(false);
  const [answerError, setAnswerError] = useState<string | null>(null);
  const busy = phase.kind === "sending" || phase.kind === "waiting";
  // The dialog's callbacks as they are now: a look in course never starts over because the dialog drew again.
  const callbacks = useRef({ onPrepared, onSavedByOne, onCleared, onRequested });
  callbacks.current = { onPrepared, onSavedByOne, onCleared, onRequested };

  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);

  /** What a look at the request found. */
  const settle = useCallback((view: TemplateImportView) => {
    if (view.status === "ready" && view.prepared) {
      setPhase({
        kind: "ready",
        importId: view.id,
        fileName: view.fileName,
        source: view.source,
        prepared: view.prepared,
        heldReason: view.heldReason,
      });
      callbacks.current.onPrepared(view.id, view.prepared, view.fileName);
    } else if (view.status === "saved") {
      setPhase({
        kind: "saved",
        importId: view.id,
        fileName: view.fileName,
        source: view.source,
        prepared: view.prepared,
        saved: view.saved,
      });
      if (view.saved) callbacks.current.onSavedByOne?.(view.saved);
    } else if (view.status === "asking") {
      setPhase({
        kind: "asking",
        importId: view.id,
        fileName: view.fileName,
        questions: view.questions,
        round: view.round,
      });
      // A new round of questions starts with its own blank answers.
      setAnswers((before) => (before.length === view.questions.length ? before : view.questions.map(() => "")));
    } else if (view.status === "refused") {
      setPhase({
        kind: "rejected",
        importId: view.id,
        fileName: view.fileName,
        refusal: view.refusal,
        expected: view.expected,
      });
    } else if (view.status === "failed") {
      setPhase({ kind: "failed", importId: view.id, fileName: view.fileName, failure: view.failure });
    } else {
      setPhase({
        kind: "waiting",
        importId: view.id,
        fileName: view.fileName,
        work: view.status === "saving" ? "saving" : view.status === "marking" ? "marking" : "reading",
        aiDownSince: view.aiDownSince,
        sentAt: view.sentAt,
      });
    }
  }, []);

  const send = useCallback(
    async (file: File) => {
      setShowChanges(false);
      if (isOtherTextFormat(file.name)) {
        setPhase({ kind: "refused", code: "type_not_allowed" });
        return;
      }
      const sentAt = new Date().toISOString();
      setPhase({ kind: "sending", fileName: file.name, sentAt });
      try {
        const mime = declaredMime(file);
        const started = await startModelSource({ name: file.name, mime, bytes: file.size });
        if (!started.ok) {
          setPhase({ kind: "refused", code: started.code });
          return;
        }
        const uploaded = await uploadToSignedUrl({
          storagePath: started.storagePath,
          uploadToken: started.uploadToken,
          file,
          contentType: mime,
        });
        if (!uploaded) {
          setPhase({ kind: "refused", code: "not_uploaded" });
          return;
        }
        const asked = await requestModelFromDocument(started.fileId, { expected, makeDefault });
        if (!asked.ok) {
          setPhase({ kind: "refused", code: asked.code, most: asked.most });
          return;
        }
        setAnswers([]);
        setPhase({ kind: "waiting", importId: asked.importId, fileName: file.name, work: "reading", sentAt });
        callbacks.current.onRequested?.();
      } catch {
        setPhase({ kind: "refused", code: "failed" });
      }
    },
    [expected, makeDefault],
  );

  // A first read handed by the screen is drawn at once; the panel looks again by itself only while ONE works.
  const drewInitial = useRef(false);
  useEffect(() => {
    if (!initialView || drewInitial.current) return;
    drewInitial.current = true;
    settle(initialView);
  }, [initialView, settle]);

  // A file chosen before the dialog opened is sent once.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (!initialFile || sentInitial.current) return;
    sentInitial.current = true;
    void send(initialFile);
  }, [initialFile, send]);

  // While ONE works, the panel looks again by itself: often at first, then less, then seldom while it is open.
  const waitingFor = phase.kind === "waiting" ? phase.importId : null;
  useEffect(() => {
    if (!waitingFor) return;
    let open = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const started = Date.now();
    const look = async () => {
      try {
        const read = await readModelFromDocument(waitingFor);
        if (!open) return;
        if (read.ok) {
          settle(read.view);
          if (!["reading", "marking", "saving"].includes(read.view.status)) return;
        } else if (read.code === "not_found") {
          // Somebody gave it up meanwhile.
          setPhase({ kind: "idle" });
          callbacks.current.onCleared();
          return;
        }
      } catch {
        // A look that failed is followed by the next one.
      }
      const elapsed = Date.now() - started;
      if (open) {
        timer = setTimeout(
          look,
          elapsed < OFTEN_FOR_MS ? FIRST_LOOKS_MS : elapsed < WATCH_FOR_MS ? LATER_LOOKS_MS : SELDOM_LOOKS_MS,
        );
      }
    };
    void look();
    return () => {
      open = false;
      if (timer) clearTimeout(timer);
    };
  }, [waitingFor, settle]);

  const choose = () => input.current?.click();

  const giveUp = async (id: string) => {
    setLeaving(true);
    try {
      const done = await dismissModelFromDocument(id);
      if (done.ok || done.code === "not_found") {
        setPhase({ kind: "idle" });
        callbacks.current.onCleared();
      }
    } finally {
      setLeaving(false);
    }
  };

  /** Another document in place of one that did not work: the chooser opens at once, and the one before goes. */
  const sendAnother = (id: string) => {
    choose();
    void dismissModelFromDocument(id);
  };

  const answer = async (id: string) => {
    setAnswering(true);
    setAnswerError(null);
    try {
      const done = await answerModelQuestions(id, answers);
      if (done.ok || done.code === "not_asking") {
        // Answered (or somebody of the firm answered first): what ONE does now is read again, and a next round of
        // questions starts with blank answers.
        setAnswers([]);
        setPhase((now) => ({
          kind: "waiting",
          importId: id,
          fileName: now.kind === "asking" ? now.fileName : null,
          work: "marking",
          sentAt: null,
        }));
        return;
      }
      setAnswerError(ANSWER_ERROR_KEY[done.code] ?? "library-import-answer-failed");
    } catch {
      setAnswerError("library-import-answer-failed");
    } finally {
      setAnswering(false);
    }
  };

  const fileInput = (
    <input
      ref={input}
      type="file"
      hidden
      accept={IMPORT_ACCEPT}
      onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) void send(file);
      }}
    />
  );

  if (phase.kind === "idle" || phase.kind === "refused") {
    // The dialog of a new model opens here (the owner, 2026-11-13): the document first, what ONE does behind the "i".
    return (
      <Box
        component="section"
        aria-labelledby="library-import-intro"
        className="border-grey-200 flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed px-4 py-8 text-center"
      >
        {fileInput}
        <Box aria-hidden className="text-primary flex">
          <NiUploadCloud size="large" />
        </Box>
        <Box className="flex items-center justify-center gap-1">
          <Typography id="library-import-intro" variant="subtitle1" component="h3" className="mb-0 font-semibold">
            {t("library-import-send-title")}
          </Typography>
          <InfoHint label={t("library-import-intro-body")} placement="bottom" className="self-center" />
        </Box>
        <Typography variant="body2" className="text-text-secondary">
          {expected
            ? t("library-import-send-expected", { document: t(DOCUMENT_NAMED_KEY[expected]) })
            : t("library-import-send-any")}
        </Typography>
        <Button variant="contained" startIcon={<NiUploadCloud size="small" />} disabled={disabled} onClick={choose}>
          {t("library-import-choose")}
        </Button>
        <Typography variant="caption" className="text-text-secondary">
          {limits ? t("library-import-limits", limits) : t("library-import-formats")}
        </Typography>
        {phase.kind === "refused" ? (
          <Alert severity="error" className="neutral bg-background-paper/60! w-full text-left">
            {t(importRefusalKey(phase.code), { most: phase.most ?? 0 })}
          </Alert>
        ) : null}
      </Box>
    );
  }

  if (phase.kind === "sending" || phase.kind === "waiting") {
    const name = phase.fileName ?? "";
    // The panel opened on a request before its first look came back: what ONE did is being read, no step said yet.
    const unread = phase.kind === "waiting" && phase.fileName === null;
    const titleKey =
      phase.kind === "sending"
        ? "library-import-sending"
        : unread
          ? "library-import-loading"
          : phase.work === "saving"
            ? "library-import-saving-title"
            : phase.work === "marking"
              ? "library-import-marking-title"
              : "library-import-reading-title";
    // Where the work is: the file sent, the document read, what changes in each case marked, the model left ready.
    const at = phase.kind === "sending" ? 0 : phase.work === "reading" ? 1 : phase.work === "marking" ? 2 : 3;
    const steps: AtWorkStep[] = unread
      ? []
      : WORK_STEPS.map((key, index) => ({
          key,
          label: t(key),
          state: index < at ? "done" : index === at ? "doing" : "next",
        }));
    const aiDownSince = phase.kind === "waiting" ? (phase.aiDownSince ?? null) : null;
    const sent = phase.sentAt ? sentWords(phase.sentAt) : null;
    return (
      <Box component="section" aria-labelledby="library-import-progress-title" className="flex flex-col gap-3">
        {fileInput}
        {/* What ONE is doing, said and drawn where the person is (2026-11-21): the ring turns while the work goes
            on, each step says where it stands, and the panel looks again by itself. A still list of steps under a
            sentence had left the owner unsure anything was happening. */}
        <Box role="status" className="border-grey-100 rounded-2xl border p-5">
          <AtWorkBody
            id="library-import-progress"
            compact
            headingAs="h3"
            long={Boolean(aiDownSince)}
            title={t(titleKey, { file: name })}
            text={
              unread
                ? undefined
                : phase.kind === "sending"
                  ? t("library-import-sending-body")
                  : t(MAY_CLOSE_KEY[waitsIn])
            }
            steps={steps}
            footer={
              sent ? t(sent.today ? "library-import-sent-today" : "library-import-sent-at", { when: sent.words }) : null
            }
            actions={
              phase.kind === "waiting" && !unread ? (
                <Button
                  variant="text"
                  color="grey"
                  size="small"
                  disabled={leaving}
                  onClick={() => void giveUp(phase.importId)}
                  aria-label={t("library-import-give-up-label", { file: name })}
                >
                  {t("library-import-give-up")}
                </Button>
              ) : null
            }
          />
        </Box>
        {aiDownSince ? (
          // The platform's AI is down (0255): the document waits with no try spent, and the platform was told.
          <StateLine tone="waiting" emphasis>
            {t("library-import-ai-down", { since: sinceLabel(aiDownSince) })}
          </StateLine>
        ) : null}
      </Box>
    );
  }

  if (phase.kind === "asking") {
    const tooLong = answers.some((written) => written.length > MOST_ANSWER);
    const said = answers.some((written) => written.trim() !== "");
    return (
      <Box component="section" aria-labelledby="library-import-asking" className="flex flex-col gap-3">
        {fileInput}
        <StateLine tone="attention" emphasis>
          <Box component="span" className="flex items-center gap-1">
            <span id="library-import-asking" className="font-semibold">
              {t("library-import-asking-title", { file: phase.fileName })}
            </span>
            <InfoHint label={t("library-import-asking-body")} className="self-center" />
          </Box>
        </StateLine>
        <Box component="ol" className="m-0 flex list-none flex-col gap-5 p-0">
          {phase.questions.map((asked, index) => (
            <Box component="li" key={`${phase.round}:${index}`} className="flex flex-col gap-1.5">
              {/* The question whole, as ONE wrote it: a field's label is one line, and cut a long question short. */}
              <Typography
                id={`library-import-question-${index}`}
                variant="body1"
                component="p"
                className="mb-0 font-medium"
              >
                {asked.question}
              </Typography>
              {asked.why ? (
                <Typography id={`library-import-why-${index}`} variant="body2" className="text-text-secondary">
                  {asked.why}
                </Typography>
              ) : null}
              <TextField
                placeholder={t("library-import-answer-placeholder")}
                slotProps={{
                  htmlInput: {
                    "aria-labelledby": `library-import-question-${index}`,
                    "aria-describedby": asked.why ? `library-import-why-${index}` : undefined,
                  },
                }}
                value={answers[index] ?? ""}
                onChange={(event) =>
                  setAnswers((before) => {
                    const next = phase.questions.map((_, at) => before[at] ?? "");
                    next[index] = event.target.value;
                    return next;
                  })
                }
                disabled={answering || disabled}
                error={(answers[index] ?? "").length > MOST_ANSWER}
                helperText={
                  (answers[index] ?? "").length > MOST_ANSWER
                    ? t("library-import-answer-too-long", { most: MOST_ANSWER })
                    : undefined
                }
                multiline
                minRows={3}
                maxRows={10}
                fullWidth
              />
            </Box>
          ))}
        </Box>
        {answerError ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {t(answerError, { most: MOST_ANSWER })}
          </Alert>
        ) : null}
        <Box className="flex flex-wrap gap-2">
          <Button
            variant="contained"
            disabled={answering || disabled || tooLong || !said}
            onClick={() => void answer(phase.importId)}
          >
            {t("library-import-answer-send")}
          </Button>
          <Button
            variant="text"
            color="grey"
            disabled={leaving || answering}
            onClick={() => void giveUp(phase.importId)}
            aria-label={t("library-import-give-up-label", { file: phase.fileName })}
          >
            {t("library-import-give-up")}
          </Button>
        </Box>
      </Box>
    );
  }

  if (phase.kind === "rejected" || phase.kind === "failed") {
    const rejected = phase.kind === "rejected";
    // Why, beside the way to send another (the owner, 2026-11-13).
    return (
      <Box component="section" className="flex flex-col gap-2">
        {fileInput}
        <StateLine
          tone={rejected ? "attention" : "failed"}
          emphasis
          action={
            <Box className="flex flex-wrap items-center gap-1">
              <Button variant="contained" size="small" disabled={disabled} onClick={() => sendAnother(phase.importId)}>
                {t("library-import-again")}
              </Button>
              <Button
                variant="text"
                color="grey"
                size="small"
                disabled={leaving}
                onClick={() => void giveUp(phase.importId)}
                aria-label={t("library-import-discard-label", { file: phase.fileName })}
              >
                {t("library-import-discard")}
              </Button>
            </Box>
          }
        >
          <Box component="span" className="flex flex-col gap-0.5">
            <span className="font-semibold">
              {t(rejected ? "library-import-refusal-title" : "library-import-failed-title", { file: phase.fileName })}
            </span>
            <span>
              {rejected ? refusalWords(t, phase.refusal, phase.expected) : t(importFailureKey(phase.failure))}
            </span>
          </Box>
        </StateLine>
      </Box>
    );
  }

  if (phase.kind === "saved") {
    return (
      <Box component="section" aria-labelledby="library-import-saved" className="flex flex-col gap-2">
        <StateLine tone="done" emphasis>
          <Box component="span" className="flex items-center gap-1">
            <span id="library-import-saved" className="font-semibold">
              {phase.saved
                ? t("library-import-saved-title", { name: phase.saved.name })
                : t("library-import-saved-gone", { file: phase.fileName })}
            </span>
            {phase.saved ? (
              <InfoHint
                label={t(phase.saved.isDefault ? "library-import-saved-body-used" : "library-import-saved-body")}
                className="self-center"
              />
            ) : null}
          </Box>
        </StateLine>
        {phase.prepared ? (
          <PreparedDetails
            prepared={phase.prepared}
            showChanges={showChanges}
            onToggleChanges={() => setShowChanges((shown) => !shown)}
          />
        ) : null}
      </Box>
    );
  }

  const { prepared } = phase;
  // A PDF was transcribed by a model: its text may differ from the original in a word, and the panel says so.
  const readyBody = phase.source === "pdf" ? "library-import-ready-body-pdf" : "library-import-ready-body";
  return (
    <Box component="section" aria-labelledby="library-import-ready" className="flex flex-col gap-2">
      <StateLine tone="attention" emphasis>
        <Box component="span" className="flex items-center gap-1">
          <span id="library-import-ready" className="font-semibold">
            {t("library-import-ready-title", { file: phase.fileName })}
          </span>
          <InfoHint label={t(readyBody)} className="self-center" />
        </Box>
      </StateLine>
      {phase.heldReason ? <StateLine tone="info">{t(HELD_KEY[phase.heldReason])}</StateLine> : null}
      <PreparedDetails
        prepared={prepared}
        showChanges={showChanges}
        onToggleChanges={() => setShowChanges((shown) => !shown)}
      />
    </Box>
  );
}

/**
 * What ONE changed of the document, one click away; what still looks like the original case and what it asks to
 * check, one line each in their tone (the owner, 2026-11-13: four coloured boxes, each with its title, one over the
 * other).
 */
function PreparedDetails({
  prepared,
  showChanges,
  onToggleChanges,
}: {
  prepared: PreparedModel;
  showChanges: boolean;
  onToggleChanges: () => void;
}) {
  const t = useTranslations("product");
  const beforeWord = t("library-import-change-before");
  const afterWord = t("library-import-change-after");
  return (
    <>
      {prepared.checks.map((check) => (
        <StateLine key={checkKey(check)} tone="attention">
          {checkWords(t, check)}
        </StateLine>
      ))}
      {prepared.notes.map((note) => (
        <StateLine key={note} tone="info">
          {note}
        </StateLine>
      ))}
      {prepared.changes.length > 0 ? (
        <Box>
          <Button
            variant="text"
            color="grey"
            size="small"
            aria-expanded={showChanges}
            aria-controls="library-import-changes"
            onClick={onToggleChanges}
            endIcon={
              <Box
                component="span"
                className={showChanges ? "flex rotate-90 transition-transform" : "flex transition-transform"}
              >
                <NiChevronRightSmall size="small" />
              </Box>
            }
          >
            {t("library-import-changes-title", { count: prepared.changes.length })}
          </Button>
        </Box>
      ) : (
        <StateLine tone="info">{t("library-import-changes-title", { count: 0 })}</StateLine>
      )}
      <Collapse in={showChanges} unmountOnExit>
        <Box
          component="ol"
          id="library-import-changes"
          aria-label={t("library-import-changes-title", { count: prepared.changes.length })}
          className="border-grey-100 m-0 flex max-h-96 list-none flex-col gap-4 overflow-y-auto rounded-2xl border p-4"
          tabIndex={0}
        >
          {prepared.changes.map((change) => (
            <Box component="li" key={change.from} className="flex flex-col gap-1">
              <Typography variant="body2" className="text-text-secondary">
                {[
                  change.from === change.to
                    ? t("library-import-change-one", { at: change.from })
                    : t("library-import-change-many", { from: change.from, to: change.to }),
                  change.reason,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Typography>
              <Typography
                variant="body2"
                component="del"
                className="text-text-secondary break-words whitespace-pre-line"
              >
                <span className="sr-only">{`${beforeWord}: `}</span>
                {change.before}
              </Typography>
              {change.after ? (
                <Typography
                  variant="body2"
                  component="ins"
                  className="bg-primary-light/10 rounded-sm break-words whitespace-pre-line no-underline"
                >
                  <span className="sr-only">{`${afterWord}: `}</span>
                  {change.after}
                </Typography>
              ) : (
                <Typography variant="body2">{t("library-import-change-removed")}</Typography>
              )}
            </Box>
          ))}
        </Box>
      </Collapse>
    </>
  );
}

const checkKey = (check: ModelCheck): string =>
  check.kind === "person"
    ? `person:${check.name}`
    : check.kind === "identifier"
      ? `identifier:${check.identifier}`
      : check.kind;

/** What a check says, in the screen's words. */
function checkWords(t: ReturnType<typeof useTranslations>, check: ModelCheck): string {
  switch (check.kind) {
    case "person":
      return t("library-import-check-person", { name: check.name, count: check.count });
    case "identifier":
      return t("library-import-check-identifier", {
        what: t(IDENTIFIER_KEY[check.identifier], { count: check.count }),
      });
    case "to_complete":
      return t("library-import-check-to-complete", { count: check.count });
    case "unwritable":
      return t("library-import-check-unwritable", { characters: check.characters.join(" ") });
  }
}

/** Items said as Portuguese lists them: "a, b e c". */
const listed = (items: string[], and: string): string =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} ${and} ${items.at(-1)}`;

/** Why ONE refused a document, in the screen's words. */
export function refusalWords(
  t: ReturnType<typeof useTranslations>,
  refusal: ImportRefusal | null,
  expected: ModelDocument | null,
): string {
  if (!refusal) return t("library-import-refusal-other-plain");
  if (refusal.code === "wrong_kind" && expected && refusal.found && refusal.found !== "outro") {
    return t(REFUSED_KEY.wrong_kind, {
      found: t(DOCUMENT_NAMED_KEY[refusal.found]),
      expected: t(DOCUMENT_NAMED_KEY[expected]),
    });
  }
  if (refusal.code === "missing" && refusal.missing.length > 0) {
    return t(REFUSED_KEY.missing, {
      missing: listed(
        refusal.missing.map((code) => t(MISSING_KEY[code])),
        t("library-import-and"),
      ),
    });
  }
  return refusal.what ? t(REFUSED_KEY.other_document, { what: refusal.what }) : t("library-import-refusal-other-plain");
}
