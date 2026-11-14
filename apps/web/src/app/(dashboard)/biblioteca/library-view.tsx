"use client";

import { refusalWords } from "./import-panel";
import TemplatePanel, { defaultSlot, DOCUMENT_KEY, KIND_KEY, Refusal } from "./template-panel";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Alert, Box, Button, Card, CardContent, MenuItem, TextField, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import FactGrid from "@/components/product/fact-grid";
import InfoHint from "@/components/product/info-hint";
import ListBar, { type ListChip, type ListView } from "@/components/product/list-bar";
import PageHeader from "@/components/product/page-header";
import QuickActions, { type QuickAction } from "@/components/product/quick-actions";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import IllustrationConfigure from "@/icons/illustrations/illustration-configure";
import IllustrationDocumentation from "@/icons/illustrations/illustration-documentation";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiDownloadCloud from "@/icons/nexture/ni-download-cloud";
import NiDuplicate from "@/icons/nexture/ni-duplicate";
import NiExclamationSquare from "@/icons/nexture/ni-exclamation-square";
import NiExternal from "@/icons/nexture/ni-external";
import NiPen from "@/icons/nexture/ni-pen";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import NiUsers from "@/icons/nexture/ni-users";
import type { ModelDocument } from "@/lib/cases/drafts";
import { isModelDocument, isPieceDocument, libraryErrorKey, MODEL_DOCUMENTS } from "@/lib/cases/drafts";
import { readDraftTemplate, removeDraftTemplate, retireLegalSource, saveLegalSource } from "@/lib/library/actions";
import type {
  LibraryData,
  LibrarySource,
  LibraryTemplate,
  MissingSource,
  ModelUse,
  ProcessPiece,
} from "@/lib/library/facts";
import { dismissModelFromDocument, watchModelImports } from "@/lib/library/import-actions";
import type { LibraryImport } from "@/lib/library/import-read";
import { IMPORT_ACCEPT, IMPORT_STATUS_KEY, IMPORT_WORKING, importFailureKey } from "@/lib/library/imports";
import {
  familyOf,
  firstView,
  importWaitsOnPerson,
  isLibrarySort,
  isLibraryView,
  LIBRARY_SORTS,
  LIBRARY_VIEWS,
  libraryCounts,
  type LibraryFamily,
  libraryRows,
  type LibrarySort,
  type LibraryView,
  waitingOnPerson,
} from "@/lib/library/list";
import { downloadWord } from "@/lib/library/word-download";
import { caseKindLabelKey } from "@/lib/modules/registry";
import { countText } from "@/lib/numbers/compare";
import { cn } from "@/lib/utils";

export type LibraryState =
  | {
      kind: "ready";
      data: LibraryData;
      /** The person reading may add to the library and write models. */ mayWrite: boolean;
    }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/** Why nobody can check a citation as a model writes it: the model is what changes, never the library. */
const GAP_KEY: Record<NonNullable<MissingSource["gap"]>, string> = {
  no_norm: "library-missing-unreadable",
  no_issuer: "library-missing-no-issuer",
  no_year: "library-missing-no-year",
  unreadable: "library-missing-not-read",
};

type SourceForm = { source: LibrarySource | null; citation: string };

/** How often the library looks again at what ONE prepares, while it prepares something. */
const WATCH_MS = 6_000;

/** The tone each state of a request is said in: the word is always there, the tint only adds to it. */
const IMPORT_TONE: Record<LibraryImport["status"], "info" | "positive" | "attention" | "danger"> = {
  reading: "info",
  marking: "info",
  asking: "attention",
  saving: "info",
  ready: "positive",
  saved: "positive",
  refused: "attention",
  failed: "danger",
};

/** What stays when a model leaves: the pieces written from it, or the papers sent to clients. */
const removeStaysKey = (template: LibraryTemplate): string =>
  isPieceDocument(template.documentKind) ? "library-template-remove-stays" : "library-template-remove-stays-paper";

/** What a failure nobody named says. */
const FAILED_KEY = libraryErrorKey("failed");

/** How many rows a view shows before a person asks for more. */
const ROWS_SHOWN = 60;

/** The four numbers above the list, each the view it counts. */
const CARD: Record<LibraryFamily, { icon: ReactNode; tone: TileTone }> = {
  faltam: { icon: <NiExclamationSquare size="medium" />, tone: "accent-3" },
  modelos: { icon: <NiDocumentFull size="medium" />, tone: "secondary" },
  fontes: { icon: <NiShieldCheck size="medium" />, tone: "primary" },
  enviados: { icon: <NiUploadCloud size="medium" />, tone: "accent-1" },
};

/** The group a view is listed under in the bar's menu. */
const VIEW_GROUP: Record<LibraryFamily, string> = {
  faltam: "attention",
  modelos: "models",
  enviados: "models",
  fontes: "sources",
};

/** What each order is called, as the family of the view reads it. */
const SORT_KEY: Record<"modelos" | "fontes", Record<LibrarySort, string>> = {
  modelos: { natural: "library-sort-models-natural", recent: "library-sort-models-recent" },
  fontes: { natural: "library-sort-sources-natural", recent: "library-sort-sources-recent" },
};

/** The words a view's card says of what it holds. */
const VIEW_BODY: Record<LibraryView, string> = {
  faltam: "library-missing-body",
  modelos: "library-templates-one",
  "do-escritorio": "library-templates-one",
  "do-one": "library-view-do-one-body",
  enviados: "library-imports-body",
  fontes: "library-card-fontes-hint",
  retiradas: "library-retired-body",
};

/**
 * The firm's library and its models of pieces. A lawyer comes here to say
 * "I checked this source where it is published" and to keep the firm's
 * models: a piece is approved only when every source it cites is here, so
 * success is a list of what the models cite with nothing left to check.
 *
 * It is a list of the screen pattern (2026-11-07): four cards of numbers
 * (what is missing, the models, the sources, the documents sent to ONE), each
 * the view it counts; the bar with its views, its search, the filter by what
 * a model writes, its order and "Novo" (a model from a document first, then a
 * model written here, then a source); every registration in the side panel; a
 * source that leaves is retired with its reason and comes back, a model leaves
 * only after the person read what that does. The screen opens on what keeps a
 * piece from being approved, then on what ONE asks of a person. `citation` is
 * a source somebody came to register from a piece that cites it: the panel
 * opens on it.
 */
export default function LibraryView({ state, citation }: { state: LibraryState; citation?: string | null }) {
  const t = useTranslations("product");
  const router = useRouter();
  const ready = state.kind === "ready" ? state : null;
  const data = ready?.data ?? null;
  const mayWrite = Boolean(ready?.mayWrite);
  const [sourceForm, setSourceForm] = useState<SourceForm | null>(
    citation && mayWrite ? { source: null, citation } : null,
  );
  const [retiring, setRetiring] = useState<LibrarySource | null>(null);
  const [templateForm, setTemplateForm] = useState<{
    template: LibraryTemplate | null;
    /** A model of the platform the firm starts its own from. */
    copyOf?: LibraryTemplate;
    /** A request ONE prepares or prepared a model for (0067). */
    importId?: string;
    /** A document the person just chose, for ONE to prepare the model from. */
    file?: File;
    /** What the document is sent as, from a use that has no model of the firm's: ONE refuses another thing. */
    expected?: ModelDocument;
  } | null>(null);
  const documentInput = useRef<HTMLInputElement>(null);
  const [dismissing, setDismissing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<LibraryTemplate | null>(null);

  const [view, setView] = useState<LibraryView>(() => (data ? firstView(data) : "modelos"));
  const [search, setSearch] = useState("");
  const [writes, setWrites] = useState<ModelDocument | null>(null);
  const [sort, setSort] = useState<LibrarySort>("natural");
  const [shown, setShown] = useState(ROWS_SHOWN);

  const family = familyOf(view);
  // The filter by what a model writes is of the models: elsewhere it narrows nothing.
  const query = { search, writes: family === "modelos" ? writes : null, sort };
  const counts = useMemo(
    () => (data ? libraryCounts(data, { search, writes: family === "modelos" ? writes : null }) : null),
    [data, search, writes, family],
  );
  const rows = data ? libraryRows(data, view, query) : null;
  const changed = () => router.refresh();
  const empty = data !== null && data.sources.length === 0 && data.templates.length === 0;
  // What a firm may keep counts only its own models: the platform's are every firm's.
  const full = data !== null && data.templates.filter((template) => !template.platform).length >= data.maxTemplates;
  const addSource = (typed: string) => setSourceForm({ source: null, citation: typed });
  // The file chooser opens in the person's own click: the panel opens once a document is chosen.
  const chooseDocument = () => documentInput.current?.click();
  // A use with no model of the firm's: the dialog opens on the upload, the document sent as that use's.
  const sendFor = (document: ModelDocument) => setTemplateForm({ template: null, expected: document });
  // A model opens to be edited; one of the platform opens the firm's copy of it.
  const openTemplate = (template: LibraryTemplate) =>
    setTemplateForm(template.platform ? { template: null, copyOf: template } : { template });
  const waiting = data ? waitingOnPerson(data) : null;
  // The model a citation is written in, the firm's first: where a citation nobody can check is put right.
  const citingOf = (source: MissingSource): LibraryTemplate | null => {
    const names = new Set(source.templates);
    const citing = (data?.templates ?? []).filter((template) => names.has(template.name));
    return citing.find((template) => !template.platform) ?? citing[0] ?? null;
  };
  const imports = data?.imports ?? [];
  const pick = (next: LibraryView) => {
    setView(next);
    setShown(ROWS_SHOWN);
  };

  // While ONE prepares a model, the library looks again by itself and reads anew when a state changed.
  const pendingKey = imports
    .filter((item) => IMPORT_WORKING.includes(item.status))
    .map((item) => `${item.id}:${item.status}`)
    .sort()
    .join(",");
  useEffect(() => {
    if (!pendingKey) return;
    let open = true;
    const timer = setInterval(() => {
      watchModelImports()
        .then((watched) => {
          if (!open || !watched.ok) return;
          const now = watched.pending
            .map((item) => `${item.id}:${item.status}`)
            .sort()
            .join(",");
          if (now !== pendingKey) router.refresh();
        })
        .catch(() => undefined);
    }, WATCH_MS);
    return () => {
      open = false;
      clearInterval(timer);
    };
  }, [pendingKey, router]);

  const dismissImport = async (item: LibraryImport) => {
    setDismissing(item.id);
    try {
      await dismissModelFromDocument(item.id);
      changed();
    } finally {
      setDismissing(null);
    }
  };

  const views: ListView[] = LIBRARY_VIEWS.map((key) => ({
    key,
    label: t(`library-view-${key}`),
    count: counts ? countText(counts[key]) : undefined,
    group: VIEW_GROUP[familyOf(key)],
  }));
  const chips: ListChip[] =
    family === "modelos" && writes !== null
      ? [{ key: "writes", label: t(DOCUMENT_KEY[writes].label), onRemove: () => setWrites(null) }]
      : [];
  // A new model opens on the upload, with "Escrever à mão" inside (the owner, 2026-11-13).
  const createActions: QuickAction[] = [
    {
      key: "template",
      label: t("library-new-template"),
      icon: <NiDocumentFull size="medium" />,
      onClick: () => setTemplateForm({ template: null }),
      disabled: full,
    },
    {
      key: "source",
      label: t("library-new-source"),
      icon: <NiShieldCheck size="medium" />,
      onClick: () => addSource(""),
    },
  ];
  const shownCount = rows ? rows.missing.length + rows.templates.length + rows.imports.length + rows.sources.length : 0;
  const narrowed = search.trim() !== "" || (family === "modelos" && writes !== null);
  const clearNarrowing = () => {
    setSearch("");
    setWrites(null);
  };

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("library-title")}
        crumbs={[{ label: t("approvals-home"), href: "/inicio" }, { label: t("library-title") }]}
        description={ready ? t("library-description") : undefined}
      />

      {state.kind === "unavailable" ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("settings-unavailable")}
        </Alert>
      ) : null}
      {state.kind === "error" ? (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={() => router.refresh()}>
              {t("approvals-retry")}
            </Button>
          }
        >
          {t("library-load-error")}
        </Alert>
      ) : null}
      {state.kind === "no-firm" ? (
        <EmptyState
          icon={<NiUsers size="large" />}
          title={t("cases-no-firm-title")}
          description={t("cases-no-firm-body")}
          action={{ label: t("cases-no-firm-action"), href: "/admin" }}
        />
      ) : null}

      {data && !mayWrite ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("library-read-only")}
        </Alert>
      ) : null}

      {data && empty ? (
        <EmptyState
          illustration={<IllustrationDocumentation />}
          title={t("library-first-title")}
          description={t(mayWrite ? "library-first-body" : "library-first-readonly")}
          action={mayWrite ? { label: t("library-import-start"), onClick: chooseDocument } : undefined}
          secondaryAction={
            mayWrite
              ? { label: t("library-template-new"), onClick: () => setTemplateForm({ template: null }) }
              : undefined
          }
        />
      ) : null}

      {mayWrite ? (
        <input
          ref={documentInput}
          type="file"
          hidden
          accept={IMPORT_ACCEPT}
          aria-label={t("library-import-start")}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) setTemplateForm({ template: null, file });
          }}
        />
      ) : null}

      {data && counts && rows && !empty ? (
        <>
          {waiting && (waiting.imports.length > 0 || waiting.missing > 0) ? (
            <WaitingCard
              imports={waiting.imports}
              missing={waiting.missing}
              mayWrite={mayWrite}
              full={full}
              busy={dismissing}
              onOpen={(item) => setTemplateForm({ template: null, importId: item.id })}
              onAgain={chooseDocument}
              onDismiss={(item) => void dismissImport(item)}
              onMissing={() => pick("faltam")}
            />
          ) : null}

          <UsesCard
            uses={data.uses}
            pieces={data.processPieces}
            templates={data.templates}
            mayWrite={mayWrite}
            full={full}
            onSend={sendFor}
            onOpen={openTemplate}
          />

          <Box className="flex flex-col gap-2">
            <ListBar
              label={t("library-bar-label")}
              viewsTitle={t("list-views-title")}
              views={views}
              view={view}
              onView={(key) => {
                if (isLibraryView(key)) pick(key);
              }}
              search={{
                label: t("library-search-label"),
                placeholder: t("list-bar-search"),
                value: search,
                onChange: (text) => {
                  setSearch(text);
                  setShown(ROWS_SHOWN);
                },
              }}
              filter={
                family === "modelos"
                  ? {
                      label: t("list-bar-filter"),
                      active: writes !== null ? 1 : 0,
                      clearLabel: t("list-bar-filter-clear"),
                      onClear: () => setWrites(null),
                      content: (
                        <TextField
                          select
                          fullWidth
                          size="small"
                          id="library-filter-writes"
                          label={t("library-filter-writes")}
                          value={writes ?? ""}
                          onChange={(event) => {
                            const next = event.target.value;
                            setWrites(isModelDocument(next) ? next : null);
                          }}
                          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                        >
                          <MenuItem value="">{t("library-filter-writes-any")}</MenuItem>
                          {MODEL_DOCUMENTS.map((key) => (
                            <MenuItem key={key} value={key}>
                              {t(DOCUMENT_KEY[key].label)}
                            </MenuItem>
                          ))}
                        </TextField>
                      ),
                    }
                  : undefined
              }
              sort={
                family === "modelos" || family === "fontes"
                  ? {
                      label: t("list-bar-sort"),
                      options: LIBRARY_SORTS.map((key) => ({ key, label: t(SORT_KEY[family][key]) })),
                      value: sort,
                      onChange: (key) => {
                        if (isLibrarySort(key)) setSort(key);
                      },
                    }
                  : undefined
              }
              create={mayWrite ? { label: t("library-new"), actions: createActions } : undefined}
              chips={chips}
            />
            {narrowed && shownCount > 0 ? (
              <Typography variant="body2" role="status" className="text-text-secondary px-1">
                {t("library-found", { count: shownCount })}
              </Typography>
            ) : null}
            {mayWrite && full && family === "modelos" ? (
              <Typography variant="body2" className="text-text-secondary px-1">
                {t("library-templates-full", { count: data.maxTemplates })}
              </Typography>
            ) : null}
          </Box>

          <Card component="section" aria-labelledby="library-list">
            <CardContent className="flex flex-col gap-3">
              <CardTitle
                id="library-list"
                icon={CARD[family].icon}
                tone={CARD[family].tone}
                title={t(`library-view-${view}`)}
                description={t(VIEW_BODY[view])}
              />
              {shownCount === 0 ? (
                narrowed ? (
                  <EmptyState
                    illustration={<IllustrationDocumentation />}
                    title={t("library-none-found-title")}
                    description={t("library-none-found-body")}
                    action={{ label: t("library-none-found-action"), onClick: clearNarrowing }}
                    titleAs="h3"
                    className="py-8"
                  />
                ) : (
                  <ViewEmpty
                    view={view}
                    mayWrite={mayWrite}
                    onDocument={chooseDocument}
                    onTemplate={() => setTemplateForm({ template: null })}
                    onSource={() => addSource("")}
                  />
                )
              ) : (
                <>
                  <Box component="ul" className="m-0 flex list-none flex-col p-0">
                    {rows.missing.slice(0, shown).map((source) => (
                      <MissingRow
                        key={source.key}
                        source={source}
                        mayWrite={mayWrite}
                        onAdd={() => addSource(source.label)}
                        onOpen={citingOf(source) ? () => openTemplate(citingOf(source)!) : undefined}
                      />
                    ))}
                    {rows.imports.slice(0, shown).map((item) => (
                      <ImportRow
                        key={item.id}
                        item={item}
                        busy={dismissing === item.id}
                        onOpen={() => setTemplateForm({ template: null, importId: item.id })}
                        onDismiss={() => void dismissImport(item)}
                        onAgain={mayWrite && !full ? chooseDocument : undefined}
                      />
                    ))}
                    {rows.templates.slice(0, shown).map((template) => (
                      <TemplateRow
                        key={template.id}
                        template={template}
                        mayWrite={mayWrite}
                        full={full}
                        onOpen={() => openTemplate(template)}
                        onRemove={() => setRemoving(template)}
                      />
                    ))}
                    {rows.sources.slice(0, shown).map((source) => (
                      <SourceRow
                        key={source.id}
                        source={source}
                        mayWrite={mayWrite}
                        onEdit={() => setSourceForm({ source, citation: source.citation })}
                        onRetire={() => setRetiring(source)}
                        onAgain={() => addSource(source.citation)}
                      />
                    ))}
                  </Box>
                  {shownCount > shown ? (
                    <Button
                      variant="text"
                      color="grey"
                      className="self-start"
                      onClick={() => setShown((current) => current + ROWS_SHOWN)}
                    >
                      {t("library-rows-more", { count: shownCount - shown })}
                    </Button>
                  ) : null}
                </>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}

      {sourceForm ? (
        <SourcePanel
          form={sourceForm}
          onClose={() => setSourceForm(null)}
          onSaved={() => {
            setSourceForm(null);
            changed();
          }}
        />
      ) : null}
      {retiring ? (
        <ConfirmActionDialog
          title={t("library-retire-title")}
          intro={retiring.citation}
          consequences={[t("library-retire-does"), t("library-retire-body")]}
          staysTitle={t("confirm-stays-title")}
          stays={[t("library-retire-stays-approved"), t("library-retire-stays-back")]}
          reasonLabel={t("library-retire-reason")}
          reasonHelp={t("library-retire-reason-help")}
          reasonMinLength={4}
          confirmLabel={t("library-retire-confirm")}
          cancelLabel={t("library-cancel")}
          busyLabel={t("library-retire-busy")}
          tone="danger"
          onConfirm={async (reason) => {
            try {
              const result = await retireLegalSource({ sourceId: retiring.id, reason });
              if (!result.ok) return t(libraryErrorKey(result.code));
              changed();
              return null;
            } catch {
              return t(FAILED_KEY);
            }
          }}
          onClose={() => setRetiring(null)}
        />
      ) : null}
      {templateForm ? (
        <TemplatePanel
          template={templateForm.template}
          copyOf={templateForm.copyOf ?? null}
          importId={templateForm.importId ?? null}
          initialFile={templateForm.file ?? null}
          expected={templateForm.expected ?? null}
          initialDocument={templateForm.expected}
          importLimits={data?.importLimits ?? null}
          pieceKinds={data?.processPieces ?? []}
          onImportRequested={changed}
          defaults={Object.fromEntries(
            (data?.templates ?? [])
              .filter(
                (template) => template.isDefault && !template.platform && template.id !== templateForm.template?.id,
              )
              .map((template) => [
                defaultSlot(template.documentKind, template.proceedingKind, template.problem, template.pieceKind),
                template.name,
              ]),
          )}
          onClose={() => setTemplateForm(null)}
          onSaved={() => {
            setTemplateForm(null);
            changed();
          }}
        />
      ) : null}
      {removing ? (
        <ConfirmActionDialog
          title={t("library-template-remove-title")}
          consequences={[
            t("library-template-remove-does", { name: removing.name }),
            ...(removing.usedByOne || removing.isDefault ? [t("library-template-remove-does-used")] : []),
          ]}
          staysTitle={t("confirm-stays-title")}
          stays={[t(removeStaysKey(removing))]}
          requireReason={false}
          confirmLabel={t("library-template-remove")}
          cancelLabel={t("library-cancel")}
          busyLabel={t("library-template-remove-busy")}
          tone="danger"
          onConfirm={async () => {
            try {
              const result = await removeDraftTemplate(removing.id);
              if (!result.ok) return t(libraryErrorKey(result.code));
              changed();
              return null;
            } catch {
              return t(FAILED_KEY);
            }
          }}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </Box>
  );
}

/** A view with nothing in it, said as what that means and the one way on. */
function ViewEmpty({
  view,
  mayWrite,
  onDocument,
  onTemplate,
  onSource,
}: {
  view: LibraryView;
  mayWrite: boolean;
  onDocument: () => void;
  onTemplate: () => void;
  onSource: () => void;
}) {
  const t = useTranslations("product");
  const family = familyOf(view);
  const action =
    !mayWrite || family === "faltam" || view === "retiradas" || view === "do-one"
      ? undefined
      : family === "fontes"
        ? { label: t("library-add-source"), onClick: onSource }
        : { label: t("library-import-start"), onClick: onDocument };
  return (
    <EmptyState
      illustration={family === "faltam" ? <IllustrationConfigure /> : <IllustrationDocumentation />}
      title={t(`library-view-${view}-empty`)}
      description={t(`library-view-${view}-empty-body`)}
      action={action}
      secondaryAction={
        mayWrite && family === "modelos" && view !== "do-one"
          ? { label: t("library-template-new"), onClick: onTemplate }
          : undefined
      }
      titleAs="h3"
      className="py-8"
    />
  );
}

/** A source the models cite and the library does not answer for: what to register, or what to put right in the model. */
function MissingRow({
  source,
  mayWrite,
  onAdd,
  onOpen,
}: {
  source: MissingSource;
  mayWrite: boolean;
  onAdd: () => void;
  /** Opens the model that writes it: where a citation nobody can check is put right. */
  onOpen?: () => void;
}) {
  const t = useTranslations("product");
  return (
    <Box component="li" className="border-grey-100 flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0">
      <Box className="flex min-w-0 flex-1 basis-60 flex-col">
        <Typography variant="body1" className="font-semibold break-words">
          {source.label}
        </Typography>
        <Typography variant="body2" className="text-text-secondary break-words">
          {[
            source.raw !== source.label ? t("library-missing-written", { raw: source.raw }) : null,
            t("library-missing-in", { templates: [...new Set(source.templates)].join(", ") }),
            source.gap !== null ? t(GAP_KEY[source.gap]) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Typography>
      </Box>
      {/* What nobody could check as it is written is put right in the model, never registered. */}
      {source.gap !== null ? (
        mayWrite && onOpen ? (
          <Button
            variant="outlined"
            color="grey"
            size="small"
            onClick={onOpen}
            aria-label={t("library-missing-open-label", { source: source.label })}
          >
            {t("library-missing-open")}
          </Button>
        ) : (
          <StatusChip tone="attention" label={t("library-missing-fix-chip")} />
        )
      ) : mayWrite ? (
        <Button
          variant="outlined"
          color="grey"
          size="small"
          onClick={onAdd}
          aria-label={t("library-missing-add-label", { source: source.label })}
        >
          {t("library-missing-add")}
        </Button>
      ) : (
        <StatusChip tone="attention" label={t("library-missing-chip")} />
      )}
    </Box>
  );
}

/**
 * A document the firm sent for a model (0067), while ONE prepares it, once
 * it asks what only the firm knows or has a model ready to check, or when
 * nothing could be prepared and why: its state on the right, and a button
 * only where something waits on the person.
 */
function ImportRow({
  item,
  busy,
  onOpen,
  onDismiss,
  onAgain,
}: {
  item: LibraryImport;
  busy: boolean;
  onOpen: () => void;
  onDismiss: () => void;
  /** Sending another document, for a request ONE refused or could not prepare. */
  onAgain?: () => void;
}) {
  const t = useTranslations("product");
  const working = IMPORT_WORKING.includes(item.status) || item.status === "asking";
  const waits = importWaitsOnPerson(item);
  const asking = item.status === "asking";
  const closed = item.status === "failed" || item.status === "refused";
  const actions: QuickAction[] = [
    ...(!closed && !waits
      ? [
          {
            key: "follow",
            label: t("library-import-follow"),
            icon: <NiDocumentFull size="medium" />,
            onClick: onOpen,
          },
        ]
      : []),
    {
      key: "dismiss",
      label: t(working ? "library-import-give-up" : "library-import-discard"),
      icon: <NiBinEmpty size="medium" />,
      onClick: onDismiss,
      disabled: busy,
    },
  ];
  return (
    <Box component="li" className="border-grey-100 flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0">
      <Box className="flex min-w-0 flex-1 basis-60 flex-col">
        <Typography variant="body1" className="font-semibold break-words">
          {item.fileName}
        </Typography>
        <Typography variant="body2" className="text-text-secondary break-words">
          {[
            item.requestedBy
              ? t("library-import-sent-by", { name: item.requestedBy, when: item.sentLabel })
              : t("library-import-sent-at", { when: item.sentLabel }),
            item.status === "failed" ? t(importFailureKey(item.failure)) : null,
            item.status === "refused" ? refusalWords(t, item.refusal, item.expected) : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </Typography>
      </Box>
      <StatusChip tone={IMPORT_TONE[item.status]} label={t(IMPORT_STATUS_KEY[item.status])} />
      {waits ? (
        <Button
          variant="contained"
          size="small"
          onClick={onOpen}
          aria-label={t(asking ? "library-import-answer-label" : "library-import-review-label", {
            file: item.fileName,
          })}
        >
          {t(asking ? "library-import-answer" : "library-import-review")}
        </Button>
      ) : closed && onAgain ? (
        <Button variant="outlined" color="grey" size="small" onClick={onAgain}>
          {t("library-import-again")}
        </Button>
      ) : null}
      <QuickActions label={t("library-row-actions", { name: item.fileName })} actions={actions} />
    </Box>
  );
}

/**
 * A model of the library: its name (which opens it, or for a model of the platform opens the copy the firm makes
 * of it), what it writes and who changed it last, and on the right whether ONE uses it and whether the library
 * answers for what it cites. The rest is one click away.
 */
function TemplateRow({
  template,
  mayWrite,
  full,
  onOpen,
  onRemove,
}: {
  template: LibraryTemplate;
  mayWrite: boolean;
  full: boolean;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const t = useTranslations("product");
  const opens = mayWrite && (!template.platform || !full);
  const word = async () => {
    const read = await readDraftTemplate(template.id);
    return read.ok ? read.body : null;
  };
  const actions: QuickAction[] = [
    ...(opens
      ? [
          template.platform
            ? {
                key: "copy",
                label: t("library-template-copy"),
                icon: <NiDuplicate size="medium" />,
                onClick: onOpen,
              }
            : { key: "edit", label: t("library-template-edit"), icon: <NiPen size="medium" />, onClick: onOpen },
        ]
      : []),
    {
      key: "word",
      label: t("word-download"),
      icon: <NiDownloadCloud size="medium" />,
      // Anybody who reads the library takes a model in Word, the platform's too.
      onClick: () => void downloadWord(template.name, word, t("word-download-fallback")),
    },
    ...(mayWrite && !template.platform
      ? [
          {
            key: "remove",
            label: t("library-template-remove"),
            icon: <NiBinEmpty size="medium" />,
            onClick: onRemove,
          },
        ]
      : []),
  ];
  const problemKey = template.problem ? caseKindLabelKey(template.problem) : null;
  const process = t(template.proceedingKind ? KIND_KEY[template.proceedingKind] : "library-template-kind-any");
  // One state, the most urgent: what keeps its pieces from being approved, then whether ONE takes it now.
  const state: { tone: StatusTone; label: string } | null =
    template.missing > 0
      ? { tone: "attention", label: t("library-template-missing", { count: template.missing }) }
      : template.usedByOne
        ? { tone: "info", label: t("library-template-used-chip") }
        : template.isDefault && !template.platform
          ? { tone: "info", label: t("library-template-default-chip") }
          : null;
  return (
    <Box component="li" className="border-grey-100 flex flex-col gap-2 border-b py-3 last:border-b-0">
      <Box className="flex items-start gap-2">
        <Box className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          {opens ? (
            <Button
              variant="text"
              color="inherit"
              onClick={onOpen}
              className="-mx-1 min-h-0 px-1 py-0 text-left font-semibold break-words hover:underline"
              aria-label={t(template.platform ? "library-template-copy-label" : "library-template-edit-label", {
                name: template.name,
              })}
            >
              {template.name}
            </Button>
          ) : (
            <Typography variant="body1" className="font-semibold break-words">
              {template.name}
            </Typography>
          )}
          {template.preparedByOne ? (
            // ONE made it from the firm's document and nobody saved it since: that it may err is behind the "i".
            <InfoHint label={t("library-template-prepared-by-one")} placement="bottom-start" className="self-center" />
          ) : null}
          {state ? <StatusChip tone={state.tone} label={state.label} /> : null}
        </Box>
        <QuickActions label={t("library-row-actions", { name: template.name })} actions={actions} />
      </Box>
      <FactGrid
        pairs
        facts={[
          // What it is written for, one fact so the row stays one row: a piece of the process says which piece and
          // for which lawsuit, a petition its lawsuit and the problem it was written for (0244), a paper what it is.
          template.documentKind === "peca_processo"
            ? {
                key: "piece",
                label: t("library-fact-piece"),
                value: [template.pieceKindName, process].filter(Boolean).join(" · "),
              }
            : isPieceDocument(template.documentKind)
              ? {
                  key: "process",
                  label: t(problemKey ? "library-fact-process-problem" : "library-fact-process"),
                  value: [process, problemKey ? t(problemKey) : null].filter(Boolean).join(" · "),
                }
              : { key: "type", label: t("library-fact-type"), value: t(DOCUMENT_KEY[template.documentKind].label) },
          {
            key: "origin",
            label: t("library-fact-origin"),
            value: t(
              template.platform
                ? template.provisional
                  ? "library-origin-provisional"
                  : "library-origin-platform"
                : "library-origin-firm",
            ),
          },
          {
            key: "cited",
            label: t("library-fact-cited"),
            value: isPieceDocument(template.documentKind) ? String(template.cited) : null,
          },
          {
            key: "updated",
            label: t("library-fact-updated"),
            value: template.updatedBy
              ? t("library-fact-updated-by", { name: template.updatedBy, when: template.updatedLabel })
              : template.updatedLabel,
          },
        ]}
      />
    </Box>
  );
}

/**
 * One source of the library: how it is cited, what it says, where it was checked, and by whom; "Abrir a fonte"
 * in view, since it is what a lawyer reads; a retired one with its reason and the way it comes back.
 */
function SourceRow({
  source,
  mayWrite,
  onEdit,
  onRetire,
  onAgain,
}: {
  source: LibrarySource;
  mayWrite: boolean;
  onEdit: () => void;
  onRetire: () => void;
  onAgain: () => void;
}) {
  const t = useTranslations("product");
  const retired = source.status === "retired";
  const ownWrite = mayWrite && !source.platform && !retired;
  const actions: QuickAction[] = ownWrite
    ? [
        { key: "edit", label: t("library-source-edit"), icon: <NiPen size="medium" />, onClick: onEdit },
        {
          key: "retire",
          label: t("library-source-retire"),
          icon: <NiBinEmpty size="medium" />,
          onClick: onRetire,
        },
      ]
    : [];
  return (
    <Box component="li" className="border-grey-100 flex flex-wrap items-start gap-3 border-b py-3 last:border-b-0">
      <Box className="flex min-w-0 flex-1 basis-60 flex-col items-start gap-0.5">
        {ownWrite ? (
          <Button
            variant="text"
            color="inherit"
            onClick={onEdit}
            className="-mx-1 min-h-0 px-1 py-0 text-left font-semibold break-words hover:underline"
            aria-label={t("library-source-edit-label", { source: source.citation })}
          >
            {source.citation}
          </Button>
        ) : (
          <Typography variant="body1" className="font-semibold break-words">
            {source.citation}
          </Typography>
        )}
        <Typography variant="body1" className="break-words">
          {source.title}
        </Typography>
        {source.quote && !retired ? (
          <Typography variant="body2" className="text-text-secondary break-words">
            {source.quote.length > 280 ? `${source.quote.slice(0, 280)}...` : source.quote}
          </Typography>
        ) : null}
        <Typography variant="body2" className="text-text-secondary">
          {retired
            ? t("library-source-retired", { when: source.retiredLabel ?? "", reason: source.retiredReason ?? "" })
            : [
                source.platform
                  ? t("library-source-verified-one", { when: source.verifiedLabel })
                  : source.verifiedBy
                    ? t("library-source-verified", { name: source.verifiedBy, when: source.verifiedLabel })
                    : t("library-source-verified-at", { when: source.verifiedLabel }),
                source.note,
              ]
                .filter(Boolean)
                .join(" · ")}
        </Typography>
      </Box>
      <Box className="flex flex-wrap items-center gap-1">
        {retired ? (
          mayWrite ? (
            <Button
              variant="outlined"
              color="grey"
              size="small"
              onClick={onAgain}
              aria-label={t("library-source-again-label", { source: source.citation })}
            >
              {t("library-source-again")}
            </Button>
          ) : null
        ) : (
          <Button
            variant="text"
            color="grey"
            size="small"
            href={source.sourceUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
            startIcon={<NiExternal size="small" />}
            aria-label={t("library-source-open-label", { source: source.citation })}
            title={t("library-source-open-label", { source: source.citation })}
          >
            {t("library-source-open")}
          </Button>
        )}
        <QuickActions label={t("library-row-actions", { name: source.citation })} actions={actions} />
      </Box>
    </Box>
  );
}

/** A source registered or corrected, in the side panel: how it is cited, what it is, where it was checked. */
function SourcePanel({ form, onClose, onSaved }: { form: SourceForm; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("product");
  const [pending, startTransition] = useTransition();
  const [citation, setCitation] = useState(form.citation);
  const [title, setTitle] = useState(form.source?.title ?? "");
  const [url, setUrl] = useState(form.source?.sourceUrl ?? "");
  const [quote, setQuote] = useState(form.source?.quote ?? "");
  const [note, setNote] = useState(form.source?.note ?? "");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const editing = form.source !== null;
  const complete =
    title.trim().length >= 3 && /^https:\/\/\S{4,}$/i.test(url.trim()) && (editing || citation.trim() !== "");
  // A transcription pasted in is work too: the panel never closes over it without asking, nor mid-save.
  const changed =
    citation !== form.citation ||
    title !== (form.source?.title ?? "") ||
    url !== (form.source?.sourceUrl ?? "") ||
    quote !== (form.source?.quote ?? "") ||
    note !== (form.source?.note ?? "");
  const close = () => {
    if (pending) return;
    if (changed) setLeaving(true);
    else onClose();
  };

  const save = () =>
    startTransition(async () => {
      setErrorCode(null);
      try {
        const result = await saveLegalSource({
          sourceId: form.source?.id ?? null,
          citation,
          title,
          sourceUrl: url,
          quote,
          note,
        });
        if (result.ok) onSaved();
        else setErrorCode(result.code);
      } catch {
        setErrorCode("failed");
      }
    });

  return (
    <SidePanel
      onClose={close}
      closeLabel={t("library-close")}
      icon={<NiShieldCheck size="medium" />}
      tone="primary"
      busy={pending}
      title={t(editing ? "library-source-dialog-edit" : "library-source-dialog-new")}
      description={t("library-source-panel-description")}
      onSubmit={() => {
        if (!pending && complete) save();
      }}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={pending || !complete}>
            {t(editing ? "library-save" : "library-source-confirm")}
          </Button>
          <Button variant="text" color="grey" disabled={pending} onClick={close}>
            {t("library-cancel")}
          </Button>
        </>
      }
    >
      <TextField
        label={t("library-source-citation")}
        helperText={t(editing ? "library-source-citation-fixed" : "library-source-citation-help")}
        value={citation}
        onChange={(event) => setCitation(event.target.value.slice(0, 300))}
        disabled={pending}
        fullWidth
        // What a source is does not change: its citation is read, never greyed out.
        slotProps={{ htmlInput: { readOnly: editing } }}
      />
      <TextField
        label={t("library-source-title")}
        value={title}
        onChange={(event) => setTitle(event.target.value.slice(0, 300))}
        disabled={pending}
        fullWidth
      />
      <TextField
        label={t("library-source-url")}
        helperText={t("library-source-url-help")}
        value={url}
        onChange={(event) => setUrl(event.target.value.slice(0, 500))}
        disabled={pending}
        fullWidth
        slotProps={{ htmlInput: { inputMode: "url", autoComplete: "off" } }}
      />
      <TextField
        label={t("library-source-quote")}
        helperText={t("library-source-quote-help")}
        value={quote}
        onChange={(event) => setQuote(event.target.value.slice(0, 6000))}
        disabled={pending}
        multiline
        minRows={3}
        fullWidth
      />
      <TextField
        label={t("library-source-note")}
        value={note}
        onChange={(event) => setNote(event.target.value.slice(0, 1000))}
        disabled={pending}
        fullWidth
      />
      <Refusal code={errorCode} />

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

/** The words of a use: what ONE writes or sends with its model. */
const USE_KEY: Record<ModelUse["key"], string> = {
  "piece-juizado": "library-use-piece-juizado",
  "piece-comum": "library-use-piece-comum",
  procuracao: "library-use-procuracao",
  contrato: "library-use-contrato",
  declaracao_residencia: "library-use-declaracao-residencia",
  declaracao_hipossuficiencia: "library-use-declaracao-hipossuficiencia",
};

/**
 * What waits on a person of the firm, first on the page (the owner, 2026-11-13: responding to ONE or checking a model it
 * had ready sat inside the fourth card): each thing on its line with its one button, the reason of a refusal beside
 * the way to send another. What ONE is still doing is not here: it is ONE's work, in "Enviados ao ONE".
 */
function WaitingCard({
  imports,
  missing,
  mayWrite,
  full,
  busy,
  onOpen,
  onAgain,
  onDismiss,
  onMissing,
}: {
  imports: LibraryImport[];
  missing: number;
  mayWrite: boolean;
  full: boolean;
  busy: string | null;
  onOpen: (item: LibraryImport) => void;
  onAgain: () => void;
  onDismiss: (item: LibraryImport) => void;
  onMissing: () => void;
}) {
  const t = useTranslations("product");
  const count = imports.length + (missing > 0 ? 1 : 0);
  return (
    <Card component="section" aria-labelledby="library-waiting">
      <CardContent className="flex flex-col gap-3">
        <CardTitle
          id="library-waiting"
          icon={<NiExclamationSquare size="medium" />}
          tone="accent-3"
          title={t("library-waiting-title")}
          chip={<StatusChip tone="attention" label={countText(count)} />}
        />
        {imports.map((item) => {
          const closed = item.status === "refused" || item.status === "failed";
          const asks = item.status === "asking";
          const words =
            item.status === "asking"
              ? t("library-waiting-asking", { file: item.fileName })
              : item.status === "ready"
                ? t("library-waiting-ready", { file: item.fileName })
                : item.status === "refused"
                  ? t("library-waiting-refused", {
                      file: item.fileName,
                      reason: refusalWords(t, item.refusal, item.expected),
                    })
                  : t("library-waiting-failed", { file: item.fileName, reason: t(importFailureKey(item.failure)) });
          return (
            <StateLine
              key={item.id}
              tone="attention"
              action={
                <Box className="flex flex-wrap items-center gap-1">
                  {closed ? (
                    <>
                      {mayWrite && !full ? (
                        <Button variant="contained" size="small" onClick={onAgain}>
                          {t("library-import-again")}
                        </Button>
                      ) : null}
                      <Button
                        variant="text"
                        color="grey"
                        size="small"
                        disabled={busy === item.id}
                        onClick={() => onDismiss(item)}
                        aria-label={t("library-import-discard-label", { file: item.fileName })}
                      >
                        {t("library-import-discard")}
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="contained"
                      size="small"
                      onClick={() => onOpen(item)}
                      aria-label={
                        asks
                          ? t("library-import-answer-label", { file: item.fileName })
                          : t("library-import-review-label", { file: item.fileName })
                      }
                    >
                      {asks ? t("library-import-answer") : t("library-import-review")}
                    </Button>
                  )}
                </Box>
              }
            >
              {words}
            </StateLine>
          );
        })}
        {missing > 0 ? (
          <StateLine
            tone="attention"
            action={
              <Button variant="outlined" color="grey" size="small" onClick={onMissing}>
                {t("library-waiting-missing-action")}
              </Button>
            }
          >
            {t("library-waiting-missing", { count: missing })}
          </StateLine>
        ) : null}
      </CardContent>
    </Card>
  );
}

/**
 * Which model ONE writes or sends with, one tile per use (the owner, 2026-11-13): the firm's own, or the platform's
 * while the firm has none, and the way to send the firm's own, the upload opened as that use's.
 */
function UsesCard({
  uses,
  pieces,
  templates,
  mayWrite,
  full,
  onSend,
  onOpen,
}: {
  uses: ModelUse[];
  pieces: ProcessPiece[];
  templates: LibraryTemplate[];
  mayWrite: boolean;
  full: boolean;
  onSend: (document: ModelDocument) => void;
  onOpen: (template: LibraryTemplate) => void;
}) {
  const t = useTranslations("product");
  const ownPieces = pieces.filter((piece) => piece.template !== null);
  return (
    <Card component="section" aria-labelledby="library-uses">
      <CardContent className="flex flex-col gap-3">
        <CardTitle
          id="library-uses"
          icon={<NiDocumentFull size="medium" />}
          tone="secondary"
          title={t("library-uses-title")}
          description={t("library-uses-hint")}
        />
        <Box component="ul" className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 lg:grid-cols-3">
          {uses.map((use) => {
            const model = use.template
              ? (templates.find((template) => template.id === use.template?.id) ?? null)
              : null;
            const own = use.template !== null && !use.template.platform;
            return (
              <Box
                component="li"
                key={use.key}
                className="border-grey-100 flex min-w-0 flex-col gap-1.5 rounded-xl border p-3"
              >
                <Typography variant="caption" className="text-text-secondary">
                  {t(USE_KEY[use.key])}
                </Typography>
                {use.template && model && mayWrite && (!model.platform || !full) ? (
                  <Button
                    variant="text"
                    color="inherit"
                    onClick={() => onOpen(model)}
                    className="-mx-1 min-h-0 justify-start px-1 py-0 text-left font-semibold break-words hover:underline"
                  >
                    {use.template.name}
                  </Button>
                ) : (
                  <Typography
                    variant="body2"
                    className={cn("font-semibold break-words", !use.template && "text-text-secondary")}
                  >
                    {use.template ? use.template.name : t("library-use-none")}
                  </Typography>
                )}
                {use.byProblem.length > 0 ? (
                  // The cases of these problems are written from the firm's model of each first (0244).
                  <Typography variant="caption" className="text-text-secondary break-words">
                    {t("library-use-by-problem", {
                      problems: use.byProblem
                        .map((item) => {
                          const key = caseKindLabelKey(item.problem);
                          return key ? t(key) : item.problem;
                        })
                        .join(", "),
                    })}
                  </Typography>
                ) : null}
                <Box className="flex flex-wrap items-center gap-2">
                  {use.template ? (
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-xs font-semibold",
                        own ? "bg-success/10 text-text-primary" : cn(TILE_TONE.primary.bg, "text-text-primary"),
                      )}
                    >
                      {t(own ? "library-use-firm" : "library-use-platform")}
                    </span>
                  ) : null}
                  {!own && mayWrite && !full ? (
                    <Button
                      variant="text"
                      size="small"
                      startIcon={<NiUploadCloud size="small" />}
                      onClick={() => onSend(use.documentKind)}
                      aria-label={t("library-use-send-label", { use: t(USE_KEY[use.key]) })}
                    >
                      {t("library-use-send")}
                    </Button>
                  ) : null}
                </Box>
              </Box>
            );
          })}
          {pieces.length > 0 ? (
            // The pieces of the process ONE writes: from the firm's model of each where it has one (0244).
            <Box component="li" className="border-grey-100 flex min-w-0 flex-col gap-1.5 rounded-xl border p-3">
              <Typography variant="caption" className="text-text-secondary">
                {t("library-use-peca-processo")}
              </Typography>
              <Typography
                variant="body2"
                className={cn("font-semibold break-words", ownPieces.length === 0 && "text-text-secondary")}
              >
                {ownPieces.length > 0
                  ? t("library-use-pieces-own", { count: ownPieces.length, total: pieces.length })
                  : t("library-use-pieces-none")}
              </Typography>
              {ownPieces.length > 0 ? (
                <Typography variant="caption" className="text-text-secondary break-words">
                  {ownPieces.map((piece) => piece.name).join(", ")}
                </Typography>
              ) : null}
              <Box className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    "rounded-md px-2 py-0.5 text-xs font-semibold",
                    ownPieces.length > 0
                      ? "bg-success/10 text-text-primary"
                      : cn(TILE_TONE.primary.bg, "text-text-primary"),
                  )}
                >
                  {t(ownPieces.length > 0 ? "library-use-firm" : "library-use-platform")}
                </span>
                {ownPieces.length < pieces.length && mayWrite && !full ? (
                  <Button
                    variant="text"
                    size="small"
                    startIcon={<NiUploadCloud size="small" />}
                    onClick={() => onSend("peca_processo")}
                    aria-label={t("library-use-send-label", { use: t("library-use-peca-processo") })}
                  >
                    {t("library-use-send")}
                  </Button>
                ) : null}
              </Box>
            </Box>
          ) : null}
        </Box>
      </CardContent>
    </Card>
  );
}
