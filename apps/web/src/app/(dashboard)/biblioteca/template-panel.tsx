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

import { useViewer } from "@/components/layout/viewer-context";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import SidePanel from "@/components/product/side-panel";
import WordDownloadButton from "@/components/product/word-download-button";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import {
  DRAFT_MARK_KEY,
  DRAFT_MARKS,
  FREE_JUSTICE_MARKS,
  isModelDocument,
  isPieceDocument,
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
import { caseKindLabelKey, firmCaseKinds } from "@/lib/modules/registry";

export type Kind = "juizado" | "comum" | null;
export const KIND_KEY: Record<"juizado" | "comum", string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};

/** What a model writes (0054), in the screen's words, and what ONE does with it. */
export const DOCUMENT_KEY: Record<ModelDocument, { label: string; help: string }> = {
  piece: { label: "library-document-piece", help: "library-document-piece-help" },
  peca_processo: { label: "library-document-peca-processo", help: "library-document-peca-processo-help" },
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

/**
 * Which default a model would take the place of: a petition's is of its kind of lawsuit and its problem (0244), a
 * piece of the process's of its kind of piece and of lawsuit, a paper's of the paper.
 */
export const defaultSlot = (
  writes: ModelDocument,
  kind: Kind,
  problem: string | null = null,
  piece: string | null = null,
): string =>
  writes === "piece"
    ? `${kind ?? "any"}${problem ? `:${problem}` : ""}`
    : writes === "peca_processo"
      ? `peca:${piece ?? ""}:${kind ?? "any"}`
      : writes;

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
function defaultKey(writes: ModelDocument, kind: Kind, problem: string | null, piece: string | null): string {
  if (writes === "peca_processo") return piece ? "library-template-default-peca" : "library-template-default-peca-any";
  if (writes === "piece" && problem) return "library-template-default-problem";
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
  waitsIn = "library",
  pieceKinds = [],
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
  /** Where what ONE prepares waits once the panel is closed: the library's "Esperam você", or the setup's step. */
  waitsIn?: "library" | "setup";
  /** The pieces of the process ONE writes (0189), for a model of one of them (0244). */
  pieceKinds?: readonly { slug: string; name: string }[];
  /** ONE was asked for a model of a document: the screen behind the dialog lists the request. */
  onImportRequested?: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  // The problems of the modules the firm uses, for a petition written for one of them (0244).
  const problems = firmCaseKinds(useViewer()?.modules);
  const [pending, startTransition] = useTransition();
  // The model being edited: the one the dialog opened on, or the one ONE saved from a document sent here.
  const [own, setOwn] = useState<{
    id: string;
    name: string;
    kind: Kind;
    problem: string | null;
    piece: string | null;
  } | null>(
    template
      ? {
          id: template.id,
          name: template.name,
          kind: template.proceedingKind,
          problem: template.problem,
          piece: template.pieceKind,
        }
      : null,
  );
  const [name, setName] = useState(template?.name ?? (copyOf ? copyName(copyOf.name) : ""));
  const [writes, setWrites] = useState<ModelDocument>(
    template?.documentKind ?? copyOf?.documentKind ?? initialDocument ?? "piece",
  );
  const [kind, setKind] = useState<Kind>(template?.proceedingKind ?? copyOf?.proceedingKind ?? null);
  // The problem a petition is written for, and the kind of a piece of the process (0244).
  const [problem, setProblem] = useState<string | null>(template?.problem ?? null);
  const [piece, setPiece] = useState<string | null>(template?.pieceKind ?? null);
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
    problem: string | null;
    piece: string | null;
    body: string;
  } | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  // A new model opens on the upload (the owner, 2026-11-13); writing it by hand is the exception the person asks for.
  const [manual, setManual] = useState(false);
  // "Modelo padrão" ticked by ONE: the firm had no model of its own for this use.
  const [autoDefault, setAutoDefault] = useState(false);
  const defaultsNow = useRef(defaults);
  defaultsNow.current = defaults;
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
  const paper = !isPieceDocument(writes);
  const odd = unknownMarks(body ?? "", modelMarks(writes));
  // The marks this document is written with, each with what the platform writes in its place.
  const marks: { mark: string; key: string }[] = !paper
    ? DRAFT_MARKS.map((mark) => ({ mark, key: DRAFT_MARK_KEY[mark] }))
    : [
        ...PAPER_MARKS,
        ...(writes === "declaracao_residencia" ? RESIDENCE_MARKS : []),
        ...(writes === "declaracao_hipossuficiencia" ? FREE_JUSTICE_MARKS : []),
      ].map((mark) => ({
        mark,
        key: PAPER_MARK_KEY[mark],
      }));
  const complete =
    name.trim().length >= 2 && (body ?? "").trim().length >= 20 && (writes !== "peca_processo" || piece !== null);
  // What "changed" is measured against: the model read, a new one, or what ONE prepared from a document.
  const base = imported ?? {
    name: own?.name ?? "",
    writes: startDocument,
    kind: own?.kind ?? null,
    problem: own?.problem ?? null,
    piece: own?.piece ?? null,
    body: saved ?? "",
  };
  const changed =
    name !== base.name ||
    writes !== base.writes ||
    kind !== base.kind ||
    problem !== base.problem ||
    piece !== base.piece ||
    isDefault !== startDefault ||
    (body ?? "") !== base.body;
  // A new model that may start from a document: neither a model being edited nor a copy of the platform's.
  // Once open on a document, the panel stays: what ONE saved from it is said there while the model is edited.
  const [mayImport] = useState(templateId === null && !copying);
  // The fields show once there is something to read in them: a model, what ONE prepared, or the person's own hand.
  const fieldsShown = !mayImport || manual || imported !== null || own !== null;
  // What ONE read is marked so, until the person changes it.
  const read = (same: boolean) => (imported !== null && same ? t("library-template-read") : null);
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
    setProblem(model.problem);
    setPiece(model.pieceKind);
    setBody(model.body);
    setImported({
      id,
      name: named,
      writes: model.documentKind,
      kind: model.proceedingKind,
      problem: model.problem,
      piece: model.pieceKind,
      body: model.body,
    });
    // With no model of its own for this use, the firm's document becomes what ONE writes with: ticked, and said.
    const none =
      !defaultsNow.current[defaultSlot(model.documentKind, model.proceedingKind, model.problem, model.pieceKind)];
    setIsDefault(none);
    setAutoDefault(none);
  }, []);

  /** The model ONE saved from the document: the dialog edits it from now on, as it is saved. */
  const savedByOne = useCallback((model: SavedModel) => {
    setOwn({
      id: model.templateId,
      name: model.name,
      kind: model.proceedingKind,
      problem: model.problem,
      piece: model.pieceKind,
    });
    setName(model.name);
    setWrites(model.documentKind);
    setStartDocument(model.documentKind);
    setKind(model.proceedingKind);
    setProblem(model.problem);
    setPiece(model.pieceKind);
    setBody(model.body);
    setSaved(model.body);
    setSavedDefault(model.isDefault);
    setIsDefault(model.isDefault);
    setImported(null);
  }, []);
  // The default of one document or kind is not the default of another: said again for a new one, by the person;
  // back to its own, the model is what it was.
  const defaultFor = (
    nextDocument: ModelDocument,
    nextKind: Kind,
    nextProblem: string | null,
    nextPiece: string | null,
  ) =>
    nextDocument === startDocument &&
    nextKind === (own?.kind ?? null) &&
    nextProblem === (own?.problem ?? null) &&
    nextPiece === (own?.piece ?? null)
      ? startDefault
      : false;
  const slot = defaultSlot(writes, kind, problem, piece);
  const pieceName = pieceKinds.find((item) => item.slug === piece)?.name ?? "";
  const problemKey = problem ? caseKindLabelKey(problem) : null;
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
          proceedingKind: isPieceDocument(writes) ? kind : null,
          problem: writes === "piece" ? problem : null,
          pieceKind: writes === "peca_processo" ? piece : null,
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
          {fieldsShown ? (
            <>
              {/* What ONE prepared is saved as it came, too: reading it is the person's part. */}
              <Button variant="contained" disabled={locked || !complete || !(changed || imported)} onClick={save}>
                {t("library-save")}
              </Button>
            </>
          ) : null}
          {/* While ONE works on a document, closing leaves the work going: the button says "Fechar", never "Cancelar". */}
          <Button variant="text" color="grey" disabled={pending} onClick={close}>
            {t(importBusy && !fieldsShown ? "library-close" : "library-cancel")}
          </Button>
          {fieldsShown ? (
            <>
              {/* The text as it is on the screen, saved or not: what ONE prepared included, to be read in Word. */}
              <WordDownloadButton
                name={name.trim() || t("word-download-fallback")}
                text={body ?? ""}
                letterhead
                disabled={locked || !(body ?? "").trim()}
              />
            </>
          ) : null}
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
            waitsIn={waitsIn}
            onPrepared={prepared}
            onSavedByOne={savedByOne}
            onCleared={() => setImported(null)}
            onRequested={onImportRequested}
          />
        ) : null}
        {/* Writing by hand is the way out of a document, offered only while ONE is not working on one: a disabled
            button under the work in course read as a broken screen (2026-11-21); "Desistir" gives the way back. */}
        {!fieldsShown && !importBusy ? (
          <Box>
            <Button variant="text" color="grey" onClick={() => setManual(true)}>
              {t("library-template-by-hand")}
            </Button>
          </Box>
        ) : null}
        {fieldsShown ? (
          <>
            <Box className="flex flex-wrap gap-3">
              <TextField
                label={t("library-template-name")}
                value={name}
                onChange={(event) => setName(event.target.value.slice(0, 120))}
                disabled={locked}
                helperText={read(name === imported?.name)}
                className="min-w-64 flex-1"
              />
              <TextField
                select
                label={t("library-template-document")}
                value={writes}
                // Chosen once the model is read: what it is now is what the choice starts from.
                onChange={(event) => {
                  const next: ModelDocument = isModelDocument(event.target.value) ? event.target.value : "piece";
                  // A paper serves every lawsuit: it names no kind of lawsuit; only a petition says a problem.
                  const nextKind = isPieceDocument(next) ? kind : null;
                  const nextProblem = next === "piece" ? problem : null;
                  const nextPiece = next === "peca_processo" ? piece : null;
                  setWrites(next);
                  setKind(nextKind);
                  setProblem(nextProblem);
                  setPiece(nextPiece);
                  setIsDefault(defaultFor(next, nextKind, nextProblem, nextPiece));
                }}
                disabled={locked || body === null}
                helperText={read(writes === imported?.writes) ?? t(DOCUMENT_KEY[writes].help)}
                className="min-w-56 flex-1"
              >
                <MenuItem value="piece">{t(DOCUMENT_KEY.piece.label)}</MenuItem>
                <MenuItem value="peca_processo">{t(DOCUMENT_KEY.peca_processo.label)}</MenuItem>
                <MenuItem value="procuracao">{t(DOCUMENT_KEY.procuracao.label)}</MenuItem>
                <MenuItem value="contrato">{t(DOCUMENT_KEY.contrato.label)}</MenuItem>
                <MenuItem value="declaracao_residencia">{t(DOCUMENT_KEY.declaracao_residencia.label)}</MenuItem>
                <MenuItem value="declaracao_hipossuficiencia">
                  {t(DOCUMENT_KEY.declaracao_hipossuficiencia.label)}
                </MenuItem>
              </TextField>
            </Box>
            {/* What a piece is written for, on a row of its own: the kind of piece, of lawsuit and the problem. */}
            {isPieceDocument(writes) ? (
              <Box className="flex flex-wrap gap-3">
                {writes === "peca_processo" ? (
                  <TextField
                    select
                    required
                    label={t("library-template-piece-kind")}
                    value={piece ?? ""}
                    onChange={(event) => {
                      const next = pieceKinds.some((item) => item.slug === event.target.value)
                        ? event.target.value
                        : null;
                      setPiece(next);
                      setIsDefault(defaultFor(writes, kind, null, next));
                    }}
                    disabled={locked || body === null}
                    helperText={read(piece === imported?.piece)}
                    className="min-w-56 flex-1"
                  >
                    {pieceKinds.map((item) => (
                      <MenuItem key={item.slug} value={item.slug}>
                        {item.name}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
                {isPieceDocument(writes) ? (
                  <TextField
                    select
                    label={t("library-template-kind")}
                    value={kind ?? "any"}
                    onChange={(event) => {
                      const next: Kind =
                        event.target.value === "juizado" || event.target.value === "comum" ? event.target.value : null;
                      setKind(next);
                      setIsDefault(defaultFor(writes, next, problem, piece));
                    }}
                    disabled={locked || body === null}
                    helperText={read(kind === imported?.kind)}
                    className="min-w-56 flex-1"
                  >
                    <MenuItem value="any">{t("library-template-kind-any")}</MenuItem>
                    <MenuItem value="juizado">{t(KIND_KEY.juizado)}</MenuItem>
                    <MenuItem value="comum">{t(KIND_KEY.comum)}</MenuItem>
                  </TextField>
                ) : null}
                {writes === "piece" && problems.length > 0 ? (
                  <TextField
                    select
                    label={t("library-template-problem")}
                    value={problem ?? "any"}
                    onChange={(event) => {
                      const next = problems.some((item) => item.key === event.target.value) ? event.target.value : null;
                      setProblem(next);
                      setIsDefault(defaultFor(writes, kind, next, null));
                    }}
                    disabled={locked || body === null}
                    helperText={read(problem === imported?.problem) ?? t("library-template-problem-help")}
                    className="min-w-56 flex-1"
                  >
                    <MenuItem value="any">{t("library-template-problem-any")}</MenuItem>
                    {problems.map((item) => (
                      <MenuItem key={item.key} value={item.key}>
                        {t(item.labelKey)}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
              </Box>
            ) : null}
            <Box className="flex flex-col">
              <FormControlLabel
                control={
                  <Checkbox
                    checked={isDefault}
                    onChange={(event) => {
                      setIsDefault(event.target.checked);
                      setAutoDefault(false);
                    }}
                    disabled={locked || body === null}
                  />
                }
                label={t(defaultKey(writes, kind, problem, piece), {
                  problem: problemKey ? t(problemKey).toLocaleLowerCase("pt-BR") : "",
                  piece: pieceName.toLocaleLowerCase("pt-BR"),
                })}
              />
              {isDefault && defaults[slot] ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("library-template-default-replaces", { name: defaults[slot] })}
                </Typography>
              ) : isDefault && autoDefault ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("library-template-default-auto")}
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
