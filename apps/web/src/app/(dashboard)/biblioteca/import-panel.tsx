"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Collapse, LinearProgress, Typography } from "@mui/material";

import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";
import {
  dismissModelFromDocument,
  readModelFromDocument,
  requestModelFromDocument,
  startModelSource,
} from "@/lib/library/import-actions";
import type { ImportLimits, PreparedModel, TemplateImportView } from "@/lib/library/import-read";
import {
  DOCX_MIME,
  IDENTIFIER_KEY,
  IMPORT_ACCEPT,
  importFailureKey,
  importRefusalKey,
  isOtherTextFormat,
  type ModelCheck,
} from "@/lib/library/imports";

/** How long the panel waits between two looks at what ONE prepares: often at first, then less, and for so long. */
const FIRST_LOOKS_MS = 3_000;
const LATER_LOOKS_MS = 6_000;
const OFTEN_FOR_MS = 60_000;
const WATCH_FOR_MS = 10 * 60_000;

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; fileName: string }
  | { kind: "waiting"; importId: string; fileName: string | null; marking: boolean }
  | { kind: "ready"; importId: string; fileName: string; source: "docx" | "pdf"; prepared: PreparedModel }
  | { kind: "failed"; importId: string; fileName: string; failure: string | null }
  | { kind: "refused"; code: string; most?: number };

/** The type a file is reserved under: a Word file or a PDF by its name, whatever the browser says of it. */
const declaredMime = (file: File): string => {
  const name = file.name.toLowerCase();
  if (name.endsWith(".docx")) return DOCX_MIME;
  if (name.endsWith(".pdf")) return "application/pdf";
  return mimeOf(file);
};

/**
 * A model made from a document the firm already uses (migration 0067), as
 * the dialog of a new model offers it: the person sends a Word file or a
 * PDF, ONE reads it and prepares the model, and the dialog fills itself with
 * it (`onPrepared`) for the person to read, change and save. While ONE
 * works, the panel says what it is doing, looks again by itself, and may be
 * closed: what ONE prepares waits in the library. Once it is ready, the
 * panel says that ONE may err, what ONE changed of the document (each change
 * against what was there) and what still looks like the original case.
 *
 * `importId` opens it on a request already made (from the library's list);
 * `initialFile` on a file the person chose before the dialog opened.
 */
export default function ImportPanel({
  importId,
  initialFile,
  limits,
  disabled,
  onBusy,
  onPrepared,
  onCleared,
  onRequested,
}: {
  importId: string | null;
  initialFile: File | null;
  limits: ImportLimits | null;
  /** The dialog is saving: nothing is sent meanwhile. */
  disabled: boolean;
  /** ONE is being sent the document or works on it: the dialog's own fields wait. */
  onBusy: (busy: boolean) => void;
  /** What ONE prepared, for the dialog to fill itself with, the request it came from and the document's name. */
  onPrepared: (importId: string, prepared: PreparedModel, fileName: string) => void;
  /** The request went (given up): the dialog is a new model written by hand again. */
  onCleared: () => void;
  /** ONE was asked: the library lists the request, whether the dialog stays open or not. */
  onRequested?: () => void;
}) {
  const t = useTranslations("product");
  const input = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>(
    importId ? { kind: "waiting", importId, fileName: null, marking: false } : { kind: "idle" },
  );
  const [showChanges, setShowChanges] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const busy = phase.kind === "sending" || phase.kind === "waiting";
  // The dialog's callbacks as they are now: a look in course never starts over because the dialog drew again.
  const callbacks = useRef({ onPrepared, onCleared, onRequested });
  callbacks.current = { onPrepared, onCleared, onRequested };

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
      });
      callbacks.current.onPrepared(view.id, view.prepared, view.fileName);
    } else if (view.status === "failed") {
      setPhase({ kind: "failed", importId: view.id, fileName: view.fileName, failure: view.failure });
    } else {
      setPhase({ kind: "waiting", importId: view.id, fileName: view.fileName, marking: view.status === "marking" });
    }
  }, []);

  const send = useCallback(async (file: File) => {
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
      const asked = await requestModelFromDocument(started.fileId);
      if (!asked.ok) {
        setPhase({ kind: "refused", code: asked.code, most: asked.most });
        return;
      }
      setPhase({ kind: "waiting", importId: asked.importId, fileName: file.name, marking: false });
      callbacks.current.onRequested?.();
    } catch {
      setPhase({ kind: "refused", code: "failed" });
    }
  }, []);

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
          if (read.view.status === "ready" || read.view.status === "failed") return;
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
    return (
      <Box component="section" aria-labelledby="library-import-progress" className="flex flex-col gap-2">
        {fileInput}
        <Typography id="library-import-progress" variant="subtitle2" component="h3" className="mb-0" role="status">
          {phase.kind === "sending"
            ? t("library-import-sending", { file: name })
            : phase.fileName === null
              ? t("library-import-loading")
              : t(phase.marking ? "library-import-marking-title" : "library-import-reading-title", { file: name })}
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

  if (phase.kind === "failed") {
    return (
      <Box component="section" className="flex flex-col gap-2">
        {fileInput}
        <Alert
          severity="error"
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
            {t("library-import-failed-title", { file: phase.fileName })}
          </Typography>
          <Typography variant="body2">{t(importFailureKey(phase.failure))}</Typography>
        </Alert>
      </Box>
    );
  }

  const { prepared } = phase;
  // A PDF was transcribed by a model: its text may differ from the original in a word, and the panel says so.
  const readyBody = phase.source === "pdf" ? "library-import-ready-body-pdf" : "library-import-ready-body";
  const beforeWord = t("library-import-change-before");
  const afterWord = t("library-import-change-after");
  return (
    <Box component="section" aria-labelledby="library-import-ready" className="flex flex-col gap-3">
      <Alert severity="info" className="neutral bg-background-paper/60!">
        <Typography id="library-import-ready" variant="body2" component="h3" className="mb-0 font-semibold">
          {t("library-import-ready-title", { file: phase.fileName })}
        </Typography>
        <Typography variant="body2">{t(readyBody)}</Typography>
      </Alert>

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
            onClick={() => setShowChanges((shown) => !shown)}
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
    </Box>
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
