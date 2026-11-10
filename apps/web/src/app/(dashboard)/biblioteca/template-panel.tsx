"use client";

import ImportPanel from "./import-panel";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import SidePanel from "@/components/product/side-panel";
import WordDownloadButton from "@/components/product/word-download-button";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import {
  DRAFT_MARK_KEY,
  DRAFT_MARKS,
  FREE_JUSTICE_MARKS,
  isModelDocument,
  libraryErrorKey,
  type ModelDocument,
  modelMarks,
  PAPER_MARK_KEY,
  PAPER_MARKS,
  RESIDENCE_MARKS,
  unknownMarks,
} from "@/lib/cases/drafts";
import { readDraftTemplate, saveDraftTemplate } from "@/lib/library/actions";
import type { LibraryTemplate } from "@/lib/library/facts";
import type { ImportLimits, PreparedModel, SavedModel } from "@/lib/library/import-read";

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
  declaracao_residencia: {
    label: "library-document-declaracao-residencia",
    help: "library-document-declaracao-residencia-help",
  },
  declaracao_hipossuficiencia: {
    label: "library-document-declaracao-hipossuficiencia",
    help: "library-document-declaracao-hipossuficiencia-help",
  },
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
  if (writes === "declaracao_residencia") return "library-template-default-declaracao";
  if (writes === "declaracao_hipossuficiencia") return "library-template-default-hipossuficiencia";
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
 * read when the panel opens, and the panel never closes over what nobody
 * saved without asking. A model made the default of a kind says which one
 * stops being it. Opened by the library and by the firm's setup, which asks
 * for a paper by name (a fee contract, the firm's own power of attorney) and
 * makes it the default the firm sends. It is the side panel every registration
 * opens in (the screen pattern after ADVBox, 2026-11-07), in its wide form: a
 * model's text is read and written as a page, not as a column.
 *
 * A new model may start from a document the firm already uses (0067,
 * 0079): the person sends it from the top of the dialog (or chose it before
 * the dialog opened, `initialFile`; the setup's step sends it as a paper,
 * `expected`), and ONE checks it, asks what only the firm knows and, where
 * the firm lets it, saves the firm's model by itself: the dialog then edits
 * that model, already saved, so the person reads it and changes it or not.
 * What ONE prepared for a person fills the dialog to be read, changed and
 * saved; saving closes the request. `importId` opens the dialog on a request
 * made before. What ONE prepared, untouched, is no work to lose: the dialog
 * closes over it without asking, and it waits in the library.
 */
export default function TemplatePanel({
  template,
  copyOf,
  defaults,
  initialDocument,
  initialDefault = false,
  importId = null,
  initialFile = null,
  importLimits = null,
  expected = null,
  makeDefault = false,
  onImportRequested,
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
  /** A request ONE prepares or prepared a model for, from a document the firm sent. */
  importId?: string | null;
  /** A document the person chose before the dialog opened: sent at once. */
  initialFile?: File | null;
  /** What may be sent for a model, as the setting says. */
  importLimits?: ImportLimits | null;
  /** What a document sent here is sent as (the setup's step of a paper): ONE refuses another thing. */
  expected?: ModelDocument | null;
  /** The model ONE saves from it takes the place of the firm's default of it. */
  makeDefault?: boolean;
  /** ONE was asked for a model of a document: the screen behind the dialog lists the request. */
  onImportRequested?: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [pending, startTransition] = useTransition();
  // The model being edited: the one the dialog opened on, or the one ONE saved from a document sent here.
  const [own, setOwn] = useState<{ id: string; name: string; kind: Kind } | null>(
    template ? { id: template.id, name: template.name, kind: template.proceedingKind } : null,
  );
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
  // A model ONE prepared from a document: the request it came from, and what it filled the dialog with.
  const [imported, setImported] = useState<{
    id: string;
    name: string;
    writes: ModelDocument;
    kind: Kind;
    body: string;
  } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const templateId = own?.id ?? null;
  // What is read when the dialog opens: the model being edited, or the platform's one a copy starts from.
  const readId = templateId ?? copyOf?.id ?? null;
  const copying = templateId === null && copyOf !== null;
  // What the dialog opened as: the model read, or a new one of the paper and default it was asked for.
  const [startDocument, setStartDocument] = useState<ModelDocument>(
    template?.documentKind ?? initialDocument ?? "piece",
  );
  const startDefault = own ? savedDefault : initialDefault;

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
      : [
          ...PAPER_MARKS,
          ...(writes === "declaracao_residencia" ? RESIDENCE_MARKS : []),
          ...(writes === "declaracao_hipossuficiencia" ? FREE_JUSTICE_MARKS : []),
        ].map((mark) => ({
          mark,
          key: PAPER_MARK_KEY[mark],
        }));
  const complete = name.trim().length >= 2 && (body ?? "").trim().length >= 20;
  // What "changed" is measured against: the model read, a new one, or what ONE prepared from a document.
  const base = imported ?? {
    name: own?.name ?? "",
    writes: startDocument,
    kind: own?.kind ?? null,
    body: saved ?? "",
  };
  const changed =
    name !== base.name ||
    writes !== base.writes ||
    kind !== base.kind ||
    isDefault !== startDefault ||
    (body ?? "") !== base.body;
  // A new model that may start from a document: neither a model being edited nor a copy of the platform's.
  // Once open on a document, the panel stays: what ONE saved from it is said there while the model is edited.
  const [mayImport] = useState(templateId === null && !copying);
  // While ONE is sent the document or works on it, the fields wait: what it prepares fills them.
  const locked = pending || importBusy;

  // The name on screen, for what ONE prepared to keep one the person already typed.
  const typedName = useRef(name);
  typedName.current = name;

  /** What ONE prepared fills the dialog; a name already typed stays the person's. */
  const prepared = useCallback((id: string, model: PreparedModel, fileName: string) => {
    const typed = typedName.current;
    const named = typed.trim() ? typed : (model.name || fileName.replace(/\.(docx|pdf)$/i, "").trim()).slice(0, 120);
    setName(named);
    setWrites(model.documentKind);
    setKind(model.proceedingKind);
    setBody(model.body);
    setImported({ id, name: named, writes: model.documentKind, kind: model.proceedingKind, body: model.body });
  }, []);

  /** The model ONE saved from the document: the dialog edits it from now on, as it is saved. */
  const savedByOne = useCallback((model: SavedModel) => {
    setOwn({ id: model.templateId, name: model.name, kind: model.proceedingKind });
    setName(model.name);
    setWrites(model.documentKind);
    setStartDocument(model.documentKind);
    setKind(model.proceedingKind);
    setBody(model.body);
    setSaved(model.body);
    setSavedDefault(model.isDefault);
    setIsDefault(model.isDefault);
    setImported(null);
  }, []);
  // The default of one document or kind is not the default of another: said again for a new one, by the person;
  // back to its own, the model is what it was.
  const defaultFor = (nextDocument: ModelDocument, nextKind: Kind) =>
    nextDocument === startDocument && nextKind === (own?.kind ?? null) ? startDefault : false;
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
          importId: imported?.id ?? null,
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
    <SidePanel
      wide
      onClose={close}
      closeLabel={t("library-close")}
      icon={<NiDocumentFull size="medium" />}
      tone="secondary"
      busy={pending}
      title={t(
        template
          ? "library-template-dialog-edit"
          : copying
            ? "library-template-dialog-copy"
            : importId || imported || initialFile
              ? "library-template-dialog-import"
              : "library-template-dialog-new",
      )}
      description={t(paper ? "library-template-panel-paper" : "library-template-panel-piece")}
      actions={
        <>
          {/* What ONE prepared is saved as it came, too: reading it is the person's part. */}
          <Button variant="contained" disabled={locked || !complete || !(changed || imported)} onClick={save}>
            {t("library-save")}
          </Button>
          <Button variant="text" color="grey" disabled={pending} onClick={close}>
            {t("library-cancel")}
          </Button>
          {/* The text as it is on the screen, saved or not: what ONE prepared included, to be read in Word. */}
          <WordDownloadButton
            name={name.trim() || t("word-download-fallback")}
            text={body ?? ""}
            disabled={locked || !(body ?? "").trim()}
          />
        </>
      }
    >
      <>
        {mayImport ? (
          <ImportPanel
            importId={importId}
            initialFile={initialFile}
            limits={importLimits}
            disabled={pending}
            onBusy={setImportBusy}
            expected={expected}
            makeDefault={makeDefault}
            onPrepared={prepared}
            onSavedByOne={savedByOne}
            onCleared={() => setImported(null)}
            onRequested={onImportRequested}
          />
        ) : null}
        <Box className="flex flex-wrap gap-3">
          <TextField
            label={t("library-template-name")}
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 120))}
            disabled={locked}
            className="min-w-64 flex-1"
          />
          <TextField
            select
            label={t("library-template-document")}
            value={writes}
            // Chosen once the model is read: what it is now is what the choice starts from.
            onChange={(event) => {
              const next: ModelDocument = isModelDocument(event.target.value) ? event.target.value : "piece";
              // A paper serves every lawsuit: it names no kind of lawsuit.
              const nextKind = next === "piece" ? kind : null;
              setWrites(next);
              setKind(nextKind);
              setIsDefault(defaultFor(next, nextKind));
            }}
            disabled={locked || body === null}
            helperText={t(DOCUMENT_KEY[writes].help)}
            className="min-w-56 flex-1"
          >
            <MenuItem value="piece">{t(DOCUMENT_KEY.piece.label)}</MenuItem>
            <MenuItem value="procuracao">{t(DOCUMENT_KEY.procuracao.label)}</MenuItem>
            <MenuItem value="contrato">{t(DOCUMENT_KEY.contrato.label)}</MenuItem>
            <MenuItem value="declaracao_residencia">{t(DOCUMENT_KEY.declaracao_residencia.label)}</MenuItem>
            <MenuItem value="declaracao_hipossuficiencia">{t(DOCUMENT_KEY.declaracao_hipossuficiencia.label)}</MenuItem>
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
              disabled={locked || body === null}
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
                disabled={locked || body === null}
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
              disabled={locked}
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
      </>

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
    </SidePanel>
  );
}
