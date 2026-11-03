"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Collapse, LinearProgress, TextField, Typography } from "@mui/material";

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

/** How long the panel waits between two looks at what ONE does: often at first, then less, and for so long. */
const FIRST_LOOKS_MS = 3_000;
const LATER_LOOKS_MS = 6_000;
const OFTEN_FOR_MS = 60_000;
const WATCH_FOR_MS = 10 * 60_000;
/** The longest answer, as the setting says it. */
const MOST_ANSWER = 1000;

type Working = "reading" | "marking" | "saving";

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; fileName: string }
  | { kind: "waiting"; importId: string; fileName: string | null; work: Working }
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
  initialFile,
  limits,
  expected = null,
  makeDefault = false,
  disabled,
  onBusy,
  onPrepared,
  onSavedByOne,
  onCleared,
  onRequested,
}: {
  importId: string | null;
  initialFile: File | null;
  limits: ImportLimits | null;
  /** What the document is sent as: ONE refuses another thing. */
  expected?: ModelDocument | null;
  /** The model ONE saves takes the place of the firm's default of it. */
  makeDefault?: boolean;
  /** The dialog is saving: nothing is sent meanwhile. */
  disabled: boolean;
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
      setPhase({ kind: "sending", fileName: file.name });
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
        setPhase({ kind: "waiting", importId: asked.importId, fileName: file.name, work: "reading" });
        callbacks.current.onRequested?.();
      } catch {
        setPhase({ kind: "refused", code: "failed" });
      }
    },
    [expected, makeDefault],
  );

  // A file chosen before the dialog opened is sent once.
  const sentInitial = useRef(false);
  useEffect(() => {
    if (!initialFile || sentInitial.current) return;
    sentInitial.current = true;
    void send(initialFile);
  }, [initialFile, send]);

  // While ONE works, the panel looks again by itself: often at first, then less, and for ten minutes.
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
      if (open && elapsed < WATCH_FOR_MS) {
        timer = setTimeout(look, elapsed < OFTEN_FOR_MS ? FIRST_LOOKS_MS : LATER_LOOKS_MS);
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
    return (
      <Box component="section" aria-labelledby="library-import-intro" className="flex flex-col gap-2">
        {fileInput}
        <Typography id="library-import-intro" variant="subtitle2" component="h3" className="mb-0">
          {t("library-import-intro-title")}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {t("library-import-intro-body")}
        </Typography>
        <Box className="flex flex-wrap items-center gap-3">
          <Button
            variant="outlined"
            color="grey"
            startIcon={<NiUploadCloud size="medium" />}
            disabled={disabled}
            onClick={choose}
          >
            {t("library-import-choose")}
          </Button>
          <Typography variant="body2" className="text-text-secondary">
            {limits ? t("library-import-limits", limits) : t("library-import-formats")}
          </Typography>
        </Box>
        {phase.kind === "refused" ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t(importRefusalKey(phase.code), { most: phase.most ?? 0 })}
          </Alert>
        ) : null}
      </Box>
    );
  }

  if (phase.kind === "sending" || phase.kind === "waiting") {
    const name = phase.fileName ?? "";
    const titleKey =
      phase.kind === "sending"
        ? "library-import-sending"
        : phase.fileName === null
          ? "library-import-loading"
          : phase.work === "saving"
            ? "library-import-saving-title"
            : phase.work === "marking"
              ? "library-import-marking-title"
              : "library-import-reading-title";
    const title = t(titleKey, { file: name });
    return (
      <Box component="section" aria-labelledby="library-import-progress" className="flex flex-col gap-2">
        {fileInput}
        <Typography id="library-import-progress" variant="subtitle2" component="h3" className="mb-0" role="status">
          {title}
        </Typography>
        <LinearProgress aria-label={t("library-import-progress-label")} />
        {phase.kind === "waiting" ? (
          <Box className="flex flex-wrap items-center gap-3">
            <Typography variant="body2" className="text-text-secondary min-w-0 flex-1 basis-60">
              {t("library-import-reading-body")}
            </Typography>
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
          </Box>
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
        <Alert severity="info" className="neutral bg-background-paper/60!">
          <Typography id="library-import-asking" variant="body2" component="h3" className="mb-0 font-semibold">
            {t("library-import-asking-title", { file: phase.fileName })}
          </Typography>
          <Typography variant="body2">{t("library-import-asking-body")}</Typography>
        </Alert>
        <Box component="ol" className="m-0 flex list-none flex-col gap-4 p-0">
          {phase.questions.map((asked, index) => (
            <Box component="li" key={`${phase.round}:${index}`}>
              <TextField
                label={asked.question}
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
                    : asked.why || undefined
                }
                multiline
                minRows={1}
                maxRows={5}
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
    return (
      <Box component="section" className="flex flex-col gap-2">
        {fileInput}
        <Alert
          severity={rejected ? "warning" : "error"}
          className="neutral bg-background-paper/60!"
          action={
            <Box className="flex flex-wrap gap-1">
              <Button color="inherit" size="small" disabled={disabled} onClick={() => sendAnother(phase.importId)}>
                {t("library-import-again")}
              </Button>
              <Button
                color="inherit"
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
          <Typography variant="body2" className="font-semibold">
            {t(rejected ? "library-import-refusal-title" : "library-import-failed-title", { file: phase.fileName })}
          </Typography>
          <Typography variant="body2">
            {rejected ? refusalWords(t, phase.refusal, phase.expected) : t(importFailureKey(phase.failure))}
          </Typography>
        </Alert>
      </Box>
    );
  }

  if (phase.kind === "saved") {
    return (
      <Box component="section" aria-labelledby="library-import-saved" className="flex flex-col gap-3">
        <Alert severity="success" className="neutral bg-background-paper/60!">
          <Typography id="library-import-saved" variant="body2" component="h3" className="mb-0 font-semibold">
            {phase.saved
              ? t("library-import-saved-title", { name: phase.saved.name })
              : t("library-import-saved-gone", { file: phase.fileName })}
          </Typography>
          {phase.saved ? (
            <Typography variant="body2">
              {t(phase.saved.isDefault ? "library-import-saved-body-used" : "library-import-saved-body")}
            </Typography>
          ) : null}
        </Alert>
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
    <Box component="section" aria-labelledby="library-import-ready" className="flex flex-col gap-3">
      <Alert severity="info" className="neutral bg-background-paper/60!">
        <Typography id="library-import-ready" variant="body2" component="h3" className="mb-0 font-semibold">
          {t("library-import-ready-title", { file: phase.fileName })}
        </Typography>
        {phase.heldReason ? <Typography variant="body2">{t(HELD_KEY[phase.heldReason])}</Typography> : null}
        <Typography variant="body2">{t(readyBody)}</Typography>
      </Alert>
      <PreparedDetails
        prepared={prepared}
        showChanges={showChanges}
        onToggleChanges={() => setShowChanges((shown) => !shown)}
      />
    </Box>
  );
}

/** What ONE changed of the document, what still looks like the original case, and what it asks to check. */
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
      <Box className="flex flex-wrap items-center gap-2">
        <Typography variant="body2" className="min-w-0 flex-1 font-semibold">
          {t("library-import-changes-title", { count: prepared.changes.length })}
        </Typography>
        {prepared.changes.length > 0 ? (
          <Button
            variant="text"
            color="grey"
            size="small"
            aria-expanded={showChanges}
            aria-controls="library-import-changes"
            onClick={onToggleChanges}
          >
            {t(showChanges ? "library-import-changes-hide" : "library-import-changes-show")}
          </Button>
        ) : null}
      </Box>
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

      {prepared.checks.length > 0 ? (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          <Typography variant="body2" component="h3" className="mb-0 font-semibold">
            {t("library-import-checks-title")}
          </Typography>
          <Typography variant="body2">{t("library-import-checks-body")}</Typography>
          <Box component="ul" className="m-0 mt-1 flex flex-col gap-0.5 pl-5">
            {prepared.checks.map((check) => (
              <Typography component="li" variant="body2" key={checkKey(check)}>
                {checkWords(t, check)}
              </Typography>
            ))}
          </Box>
        </Alert>
      ) : null}

      {prepared.notes.length > 0 ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          <Typography variant="body2" component="h3" className="mb-0 font-semibold">
            {t("library-import-notes-title")}
          </Typography>
          <Box component="ul" className="m-0 mt-1 flex flex-col gap-0.5 pl-5">
            {prepared.notes.map((note) => (
              <Typography component="li" variant="body2" key={note}>
                {note}
              </Typography>
            ))}
          </Box>
        </Alert>
      ) : null}
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
