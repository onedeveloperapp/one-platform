"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogContent,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import DialogHeader from "@/components/product/dialog-header";
import {
  DRAFT_MARK_KEY,
  DRAFT_MARKS,
  libraryErrorKey,
  type ModelDocument,
  modelMarks,
  PAPER_MARK_KEY,
  PAPER_MARKS,
  unknownMarks,
} from "@/lib/cases/drafts";
import { readDraftTemplate, saveDraftTemplate } from "@/lib/library/actions";
import type { LibraryTemplate } from "@/lib/library/facts";

export type Kind = "juizado" | "comum" | null;
export const KIND_KEY: Record<"juizado" | "comum", string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};

/** What a model writes (0054), in the screen's words, and what ONE does with it. */
export const DOCUMENT_KEY: Record<ModelDocument, { label: string; help: string }> = {
  piece: { label: "library-document-piece", help: "library-document-piece-help" },
  procuracao: { label: "library-document-procuracao", help: "library-document-procuracao-help" },
  contrato: { label: "library-document-contrato", help: "library-document-contrato-help" },
};

/** Which default a model would take the place of: a piece's is of its kind of lawsuit, a paper's of the paper. */
export const defaultSlot = (writes: ModelDocument, kind: Kind): string =>
  writes === "piece" ? (kind ?? "any") : writes;

/** What an action's refusal says. */
export function Refusal({ code }: { code: string | null }) {
  const t = useTranslations("product");
  return code ? (
    <Alert severity="error" className="neutral bg-background-paper/60!">
      {t(libraryErrorKey(code))}
    </Alert>
  ) : null;
}

/** The name a copy of a model of the platform starts with: the firm's own, without the platform's mark. */
function copyName(name: string): string {
  return name
    .replace(/\s*\(modelo do ONE\)\s*$/u, "")
    .trim()
    .slice(0, 120);
}

/** What saying a model is the default means, for what it writes and the kind it is written for. */
function defaultKey(writes: ModelDocument, kind: Kind): string {
  if (writes === "procuracao") return "library-template-default-procuracao";
  if (writes === "contrato") return "library-template-default-contrato";
  if (kind === null) return "library-template-default-any";
  return kind === "comum" ? "library-template-default-comum" : "library-template-default-juizado";
}

/**
 * A model of the firm: its name, what it writes (the piece of a lawsuit, a
 * power of attorney or a fee contract, 0054), the kind of proceeding a piece
 * is written for, whether it is the default ONE writes from (the pieces of
 * that kind, or the paper it sends clients to sign), and its text, with the
 * marks the platform fills in with the facts of a lawsuit or of a client.
 * The text of a model already there, and whether it is the default now, are
 * read when the dialog opens, and the dialog never closes over what nobody
 * saved without asking. A model made the default of a kind says which one
 * stops being it. Opened by the library and by the firm's setup, which asks
 * for a paper by name (a fee contract, the firm's own power of attorney) and
 * makes it the default the firm sends.
 */
export default function TemplateDialog({
  template,
  copyOf,
  defaults,
  initialDocument,
  initialDefault = false,
  onClose,
  onSaved,
}: {
  template: LibraryTemplate | null;
  /** A model of the platform this new model starts from: its text, its kind and its name, the firm's from then on. */
  copyOf: LibraryTemplate | null;
  /** The other models that are a default now, by the kind they are for ("any" for both). */
  defaults: Record<string, string>;
  /** What a new model writes when the dialog opens on it: the paper somebody asked for by name. */
  initialDocument?: ModelDocument;
  /** A new model opens as the default of what it writes, the one ONE then uses. */
  initialDefault?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(template?.name ?? (copyOf ? copyName(copyOf.name) : ""));
  const [writes, setWrites] = useState<ModelDocument>(
    template?.documentKind ?? copyOf?.documentKind ?? initialDocument ?? "piece",
  );
  const [kind, setKind] = useState<Kind>(template?.proceedingKind ?? copyOf?.proceedingKind ?? null);
  // Whether it is the default as it was read when the dialog opened, and as it is on screen.
  const [savedDefault, setSavedDefault] = useState(template?.isDefault ?? false);
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? initialDefault);
  // The text as it was read, and the text on screen: what "changed" is measured against.
  const [saved, setSaved] = useState<string | null>(template ? null : "");
  const [body, setBody] = useState<string | null>(template || copyOf ? null : "");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const templateId = template?.id ?? null;
  // What is read when the dialog opens: the model being edited, or the platform's one a copy starts from.
  const readId = templateId ?? copyOf?.id ?? null;
  const copying = templateId === null && copyOf !== null;
  // What the dialog opened as: the model read, or a new one of the paper and default it was asked for.
  const startDocument = template?.documentKind ?? initialDocument ?? "piece";
  const startDefault = template ? savedDefault : initialDefault;

  useEffect(() => {
    if (!readId) return;
    let open = true;
    readDraftTemplate(readId)
      .then((read) => {
        if (!open) return;
        if (read.ok) {
          setBody(read.body);
          // A copy is a new model: nothing of it is saved yet.
          if (!copying) {
            setSaved(read.body);
            setSavedDefault(read.isDefault);
            setIsDefault(read.isDefault);
          }
        } else setErrorCode(read.code);
      })
      .catch(() => {
        if (open) setErrorCode("failed");
      });
    return () => {
      open = false;
    };
  }, [readId, copying]);

  // A power of attorney or a contract, which a client signs: written with the client's facts, never a lawsuit's.
  const paper = writes !== "piece";
  const odd = unknownMarks(body ?? "", modelMarks(writes));
  // The marks this document is written with, each with what the platform writes in its place.
  const marks: { mark: string; key: string }[] =
    writes === "piece"
      ? DRAFT_MARKS.map((mark) => ({ mark, key: DRAFT_MARK_KEY[mark] }))
      : PAPER_MARKS.map((mark) => ({ mark, key: PAPER_MARK_KEY[mark] }));
  const complete = name.trim().length >= 2 && (body ?? "").trim().length >= 20;
  const changed =
    name !== (template?.name ?? "") ||
    writes !== startDocument ||
    kind !== (template?.proceedingKind ?? null) ||
    isDefault !== startDefault ||
    (body ?? "") !== (saved ?? "");
  // The default of one document or kind is not the default of another: said again for a new one, by the person;
  // back to its own, the model is what it was.
  const defaultFor = (nextDocument: ModelDocument, nextKind: Kind) =>
    nextDocument === startDocument && nextKind === (template?.proceedingKind ?? null) ? startDefault : false;
  // Nothing closes the dialog while a save is on its way (a refusal must find it open), nor over unsaved text.
  const close = () => {
    if (pending) return;
    if (changed) setLeaving(true);
    else onClose();
  };

  // A tab closed over text nobody saved asks first, as the dialog does.
  useEffect(() => {
    if (!changed) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed]);

  const save = () =>
    startTransition(async () => {
      setErrorCode(null);
      try {
        const result = await saveDraftTemplate({
          templateId,
          name,
          documentKind: writes,
          proceedingKind: writes === "piece" ? kind : null,
          isDefault,
          body: body ?? "",
        });
        if (result.ok) onSaved();
        else setErrorCode(result.code);
      } catch {
        setErrorCode("failed");
      }
    });

  return (
    <Dialog open onClose={close} aria-labelledby="library-template-dialog" maxWidth="lg" fullWidth>
      <DialogHeader
        id="library-template-dialog"
        title={t(
          template
            ? "library-template-dialog-edit"
            : copying
              ? "library-template-dialog-copy"
              : "library-template-dialog-new",
        )}
        onClose={close}
        closeLabel={t("library-close")}
      />
      <DialogContent className="flex flex-col gap-4 pt-2!">
        <Box className="flex flex-wrap gap-3">
          <TextField
            label={t("library-template-name")}
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 120))}
            disabled={pending}
            className="min-w-64 flex-1"
            autoFocus={!template}
          />
          <TextField
            select
            label={t("library-template-document")}
            value={writes}
            // Chosen once the model is read: what it is now is what the choice starts from.
            onChange={(event) => {
              const next: ModelDocument =
                event.target.value === "procuracao" || event.target.value === "contrato" ? event.target.value : "piece";
              // A paper serves every lawsuit: it names no kind of lawsuit.
              const nextKind = next === "piece" ? kind : null;
              setWrites(next);
              setKind(nextKind);
              setIsDefault(defaultFor(next, nextKind));
            }}
            disabled={pending || body === null}
            helperText={t(DOCUMENT_KEY[writes].help)}
            className="min-w-56 flex-1"
          >
            <MenuItem value="piece">{t(DOCUMENT_KEY.piece.label)}</MenuItem>
            <MenuItem value="procuracao">{t(DOCUMENT_KEY.procuracao.label)}</MenuItem>
            <MenuItem value="contrato">{t(DOCUMENT_KEY.contrato.label)}</MenuItem>
          </TextField>
          {writes === "piece" ? (
            <TextField
              select
              label={t("library-template-kind")}
              value={kind ?? "any"}
              onChange={(event) => {
                const next: Kind =
                  event.target.value === "juizado" || event.target.value === "comum" ? event.target.value : null;
                setKind(next);
                setIsDefault(defaultFor(writes, next));
              }}
              disabled={pending || body === null}
              className="min-w-56"
            >
              <MenuItem value="any">{t("library-template-kind-any")}</MenuItem>
              <MenuItem value="juizado">{t(KIND_KEY.juizado)}</MenuItem>
              <MenuItem value="comum">{t(KIND_KEY.comum)}</MenuItem>
            </TextField>
          ) : null}
        </Box>
        <Box className="flex flex-col">
          <FormControlLabel
            control={
              <Checkbox
                checked={isDefault}
                onChange={(event) => setIsDefault(event.target.checked)}
                disabled={pending || body === null}
              />
            }
            label={t(defaultKey(writes, kind))}
          />
          {isDefault && defaults[defaultSlot(writes, kind)] ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("library-template-default-replaces", { name: defaults[defaultSlot(writes, kind)] })}
            </Typography>
          ) : null}
        </Box>
        {body === null && !errorCode ? (
          <Box className="flex justify-center py-10">
            <CircularProgress aria-label={t("library-loading")} />
          </Box>
        ) : body !== null ? (
          <>
            <TextField
              label={t("library-template-body")}
              helperText={t(paper ? "library-template-body-help-paper" : "library-template-body-help")}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={pending}
              multiline
              minRows={16}
              maxRows={30}
              fullWidth
              slotProps={{ htmlInput: { spellCheck: true, lang: "pt-BR" } }}
            />
            <Box component="dl" className="m-0 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              {marks.map(({ mark, key }) => (
                <Box key={mark} className="flex flex-wrap gap-x-1">
                  <Typography component="dt" variant="body2" className="font-semibold">
                    {`[[${mark}]]`}
                  </Typography>
                  <Typography component="dd" variant="body2" className="text-text-secondary m-0">
                    {t(key)}
                  </Typography>
                </Box>
              ))}
            </Box>
            {odd.length > 0 ? (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {t(paper ? "paper-unknown-marks" : "draft-unknown-marks", {
                  marks: odd.map((mark) => `[[${mark}]]`).join(", "),
                })}
              </Alert>
            ) : null}
          </>
        ) : null}
        <Refusal code={errorCode} />
        <Box className="flex flex-wrap gap-2">
          <Button variant="contained" disabled={pending || !complete || !changed} onClick={save}>
            {t("library-save")}
          </Button>
          <Button variant="text" color="grey" disabled={pending} onClick={close}>
            {t("library-cancel")}
          </Button>
        </Box>
      </DialogContent>

      {leaving ? (
        <ConfirmActionDialog
          title={t("unsaved-title")}
          consequences={[t("unsaved-does")]}
          staysTitle={t("confirm-stays-title")}
          stays={[t("unsaved-stays")]}
          requireReason={false}
          confirmLabel={t("unsaved-yes")}
          cancelLabel={t("unsaved-no")}
          busyLabel={t("unsaved-yes")}
          onConfirm={async () => {
            onClose();
            return null;
          }}
          onClose={() => setLeaving(false)}
        />
      ) : null}
    </Dialog>
  );
}
