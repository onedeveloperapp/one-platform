"use client";

import TemplateDialog, { defaultSlot, DOCUMENT_KEY, KIND_KEY, Refusal } from "./template-dialog";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogContent,
  Grid,
  TextField,
  Typography,
} from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import DialogHeader from "@/components/product/dialog-header";
import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import PageHeader from "@/components/product/page-header";
import StatusChip from "@/components/product/status-chip";
import NiBook from "@/icons/nexture/ni-book";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiUsers from "@/icons/nexture/ni-users";
import { removeDraftTemplate, retireLegalSource, saveLegalSource } from "@/lib/library/actions";
import type { LibraryData, LibrarySource, LibraryTemplate, MissingSource } from "@/lib/library/facts";

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

/** How many sources the list shows before a person asks for more, and from how many on it offers a search. */
const SOURCES_SHOWN = 60;
const SEARCH_FROM = 9;

const plain = (text: string): string => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/**
 * The firm's library and its models of pieces. A lawyer comes here to say
 * "I checked this source where it is published" and to keep the firm's
 * models: a piece is approved only when every source it cites is here, so
 * success is a list of what the models cite with nothing left to check. The
 * screen opens on exactly that list (what the models cite that the library
 * does not answer for yet), each one click from being added, and a firm that
 * has nothing yet starts from its own model of a petition. `citation` is a
 * source somebody came to register from a piece that cites it: the dialog
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
  } | null>(null);
  const [removing, setRemoving] = useState<LibraryTemplate | null>(null);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState(SOURCES_SHOWN);

  const verified = (data?.sources ?? []).filter((source) => source.status === "verified");
  const retired = (data?.sources ?? []).filter((source) => source.status === "retired");
  const wanted = plain(search.trim());
  const found = wanted
    ? verified.filter((source) => plain(`${source.citation} ${source.title}`).includes(wanted))
    : verified;
  const changed = () => router.refresh();
  const empty = data !== null && data.sources.length === 0 && data.templates.length === 0;
  // What a firm may keep counts only its own models: the platform's are every firm's.
  const full = data !== null && data.templates.filter((template) => !template.platform).length >= data.maxTemplates;
  const addSource = (typed: string) => setSourceForm({ source: null, citation: typed });

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("library-title")}
        crumbs={[{ label: t("approvals-home"), href: "/inicio" }, { label: t("library-title") }]}
        description={ready ? t("library-description") : undefined}
        action={
          mayWrite && !empty ? (
            <Button variant="contained" onClick={() => addSource("")}>
              {t("library-add-source")}
            </Button>
          ) : undefined
        }
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
          icon={<NiBook size="large" />}
          title={t("library-first-title")}
          description={t(mayWrite ? "library-first-body" : "library-first-readonly")}
          action={
            mayWrite
              ? { label: t("library-template-new"), onClick: () => setTemplateForm({ template: null }) }
              : undefined
          }
          secondaryAction={mayWrite ? { label: t("library-add-source"), onClick: () => addSource("") } : undefined}
        />
      ) : null}

      {data && !empty ? (
        <>
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 12, sm: 4 }}>
              <StatTile
                icon={<NiShieldCheck size="large" />}
                tone="primary"
                label={t("library-tile-sources")}
                hint={t("library-tile-sources-hint")}
                value={verified.length}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <StatTile
                icon={<NiDocumentFull size="large" />}
                tone="secondary"
                label={t("library-tile-templates")}
                hint={t("library-tile-templates-hint")}
                value={data.templates.length}
              />
            </Grid>
            <Grid size={{ xs: 12, sm: 4 }}>
              <StatTile
                icon={<NiBook size="large" />}
                tone="accent-3"
                label={t("library-tile-missing")}
                hint={t("library-tile-missing-hint")}
                value={data.missing.length}
              />
            </Grid>
          </Grid>

          {/* What stands between a model and a piece that can be approved comes first. */}
          {data.missing.length > 0 ? (
            <Card component="section" aria-labelledby="library-missing">
              <CardContent className="flex flex-col gap-3">
                <Box className="flex flex-col gap-1">
                  <Typography id="library-missing" variant="h5" component="h2" className="mb-0">
                    {t("library-missing-title")}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary">
                    {t("library-missing-body")}
                  </Typography>
                </Box>
                <Box component="ul" className="m-0 flex list-none flex-col p-0">
                  {data.missing.map((source) => (
                    <Box
                      component="li"
                      key={source.key}
                      className="border-grey-100 flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0"
                    >
                      <Box className="flex min-w-0 flex-1 basis-60 flex-col">
                        <Typography variant="body1" className="font-semibold break-words">
                          {source.label}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary break-words">
                          {[
                            source.raw !== source.label ? t("library-missing-written", { raw: source.raw }) : null,
                            t("library-missing-in", { templates: [...new Set(source.templates)].join(", ") }),
                            source.gap ? t(GAP_KEY[source.gap]) : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                      </Box>
                      {/* What nobody could check as it is written is put right in the model, never registered. */}
                      {mayWrite && source.gap === null ? (
                        <Button
                          variant="outlined"
                          color="grey"
                          size="small"
                          onClick={() => addSource(source.label)}
                          aria-label={t("library-missing-add-label", { source: source.label })}
                        >
                          {t("library-missing-add")}
                        </Button>
                      ) : null}
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          ) : null}

          <Card component="section" aria-labelledby="library-templates">
            <CardContent className="flex flex-col gap-3">
              <Box className="flex flex-wrap items-center gap-3">
                <Typography id="library-templates" variant="h5" component="h2" className="mb-0 min-w-0 flex-1">
                  {t("library-templates-title")}
                </Typography>
                {mayWrite && data.templates.length > 0 ? (
                  <Button
                    variant="outlined"
                    color="grey"
                    disabled={full}
                    onClick={() => setTemplateForm({ template: null })}
                  >
                    {t("library-template-new")}
                  </Button>
                ) : null}
              </Box>
              <Typography variant="body2" className="text-text-secondary">
                {t("library-templates-one")}
              </Typography>
              {mayWrite && full ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("library-templates-full", { count: data.maxTemplates })}
                </Typography>
              ) : null}
              {data.templates.length === 0 ? (
                <EmptyState
                  icon={<NiDocumentFull />}
                  title={t("library-templates-empty")}
                  description={t(mayWrite ? "library-templates-empty-body" : "library-first-readonly")}
                  action={
                    mayWrite
                      ? { label: t("library-template-new"), onClick: () => setTemplateForm({ template: null }) }
                      : undefined
                  }
                  className="py-8"
                />
              ) : (
                <Box component="ul" className="m-0 flex list-none flex-col p-0">
                  {data.templates.map((template) => (
                    <Box
                      component="li"
                      key={template.id}
                      className="border-grey-100 flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0"
                    >
                      <Box className="flex min-w-0 flex-1 basis-60 flex-col">
                        <Typography variant="body1" className="font-semibold break-words">
                          {template.name}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          {[
                            template.documentKind !== "piece"
                              ? t(DOCUMENT_KEY[template.documentKind].label)
                              : t(
                                  template.proceedingKind
                                    ? KIND_KEY[template.proceedingKind]
                                    : "library-template-kind-any",
                                ),
                            template.documentKind === "piece"
                              ? t("library-template-cited", { count: template.cited })
                              : null,
                            template.updatedBy
                              ? t("library-template-updated", { name: template.updatedBy, when: template.updatedLabel })
                              : t("library-template-updated-at", { when: template.updatedLabel }),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                      </Box>
                      {template.platform ? (
                        <StatusChip tone="neutral" label={t("library-template-platform-chip")} />
                      ) : null}
                      {template.provisional ? (
                        <StatusChip tone="attention" label={t("library-template-provisional-chip")} />
                      ) : null}
                      {template.usedByOne ? (
                        <StatusChip tone="info" label={t("library-template-used-chip")} />
                      ) : template.isDefault && !template.platform ? (
                        <StatusChip tone="info" label={t("library-template-default-chip")} />
                      ) : null}
                      {template.missing > 0 ? (
                        <StatusChip
                          tone="attention"
                          label={t("library-template-missing", { count: template.missing })}
                        />
                      ) : template.cited > 0 ? (
                        <StatusChip tone="positive" label={t("library-template-covered")} />
                      ) : null}
                      {mayWrite && template.platform ? (
                        <Button
                          variant="text"
                          color="grey"
                          size="small"
                          disabled={full}
                          onClick={() => setTemplateForm({ template: null, copyOf: template })}
                          aria-label={t("library-template-copy-label", { name: template.name })}
                        >
                          {t("library-template-copy")}
                        </Button>
                      ) : mayWrite ? (
                        <Box className="flex flex-wrap gap-1">
                          <Button
                            variant="text"
                            color="grey"
                            size="small"
                            onClick={() => setTemplateForm({ template })}
                            aria-label={t("library-template-edit-label", { name: template.name })}
                          >
                            {t("library-template-edit")}
                          </Button>
                          <Button
                            variant="text"
                            color="grey"
                            size="small"
                            onClick={() => setRemoving(template)}
                            aria-label={t("library-template-remove-label", { name: template.name })}
                          >
                            {t("library-template-remove")}
                          </Button>
                        </Box>
                      ) : null}
                    </Box>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>

          <Card component="section" aria-labelledby="library-sources">
            <CardContent className="flex flex-col gap-3">
              <Box className="flex flex-wrap items-center gap-3">
                <Typography id="library-sources" variant="h5" component="h2" className="mb-0 min-w-0 flex-1">
                  {t("library-sources-title")}
                </Typography>
                {/* Kept while it filters, however few the sources are now: a filter never hides its own box. */}
                {verified.length >= SEARCH_FROM || search !== "" ? (
                  <TextField
                    size="small"
                    label={t("library-sources-search")}
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value.slice(0, 80));
                      setShown(SOURCES_SHOWN);
                    }}
                    className="min-w-64"
                    slotProps={{ htmlInput: { autoComplete: "off" } }}
                  />
                ) : null}
              </Box>
              {verified.length === 0 ? (
                <EmptyState
                  icon={<NiShieldCheck />}
                  title={t("library-sources-empty")}
                  description={t(mayWrite ? "library-sources-empty-body" : "library-first-readonly")}
                  action={mayWrite ? { label: t("library-add-source"), onClick: () => addSource("") } : undefined}
                  className="py-8"
                />
              ) : found.length === 0 ? (
                <Typography variant="body2" className="text-text-secondary" role="status">
                  {t("library-sources-none-found")}
                </Typography>
              ) : (
                <>
                  <Box component="ul" className="m-0 flex list-none flex-col p-0">
                    {found.slice(0, shown).map((source) => (
                      <SourceRow
                        key={source.id}
                        source={source}
                        mayWrite={mayWrite}
                        onEdit={() => setSourceForm({ source, citation: source.citation })}
                        onRetire={() => setRetiring(source)}
                      />
                    ))}
                  </Box>
                  {found.length > shown ? (
                    <Button
                      variant="text"
                      color="grey"
                      className="self-start"
                      onClick={() => setShown((current) => current + SOURCES_SHOWN)}
                    >
                      {t("library-sources-more", { count: found.length - shown })}
                    </Button>
                  ) : null}
                </>
              )}
              {retired.length > 0 ? (
                <Box className="border-grey-100 flex flex-col gap-2 border-t pt-3">
                  <Typography variant="subtitle2" component="h3" className="mb-0">
                    {t("library-retired-title")}
                  </Typography>
                  <Box component="ul" className="m-0 flex list-none flex-col p-0">
                    {retired.map((source) => (
                      <Box component="li" key={source.id} className="flex flex-wrap items-center gap-3 py-2">
                        <Box className="flex min-w-0 flex-1 basis-60 flex-col">
                          <Typography variant="body1" className="break-words">
                            {source.citation}
                          </Typography>
                          <Typography variant="body2" className="text-text-secondary">
                            {t("library-source-retired", {
                              when: source.retiredLabel ?? "",
                              reason: source.retiredReason ?? "",
                            })}
                          </Typography>
                        </Box>
                        {mayWrite ? (
                          <Button
                            variant="text"
                            color="grey"
                            size="small"
                            onClick={() => addSource(source.citation)}
                            aria-label={t("library-source-again-label", { source: source.citation })}
                          >
                            {t("library-source-again")}
                          </Button>
                        ) : null}
                      </Box>
                    ))}
                  </Box>
                </Box>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}

      {sourceForm ? (
        <SourceDialog
          form={sourceForm}
          onClose={() => setSourceForm(null)}
          onSaved={() => {
            setSourceForm(null);
            changed();
          }}
        />
      ) : null}
      {retiring ? (
        <RetireDialog
          source={retiring}
          onClose={() => setRetiring(null)}
          onSaved={() => {
            setRetiring(null);
            changed();
          }}
        />
      ) : null}
      {templateForm ? (
        <TemplateDialog
          template={templateForm.template}
          copyOf={templateForm.copyOf ?? null}
          defaults={Object.fromEntries(
            (data?.templates ?? [])
              .filter(
                (template) => template.isDefault && !template.platform && template.id !== templateForm.template?.id,
              )
              .map((template) => [defaultSlot(template.documentKind, template.proceedingKind), template.name]),
          )}
          onClose={() => setTemplateForm(null)}
          onSaved={() => {
            setTemplateForm(null);
            changed();
          }}
        />
      ) : null}
      {removing ? (
        <RemoveDialog
          template={removing}
          onClose={() => setRemoving(null)}
          onSaved={() => {
            setRemoving(null);
            changed();
          }}
        />
      ) : null}
    </Box>
  );
}

/** One source of the library: how it is cited, what it says, where it was checked, and by whom. */
function SourceRow({
  source,
  mayWrite,
  onEdit,
  onRetire,
}: {
  source: LibrarySource;
  mayWrite: boolean;
  onEdit: () => void;
  onRetire: () => void;
}) {
  const t = useTranslations("product");
  return (
    <Box component="li" className="border-grey-100 flex flex-wrap items-start gap-3 border-b py-3 last:border-b-0">
      <Box className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
        <Typography variant="body1" className="font-semibold break-words">
          {source.citation}
        </Typography>
        <Typography variant="body1" className="break-words">
          {source.title}
        </Typography>
        {source.quote ? (
          <Typography variant="body2" className="text-text-secondary break-words">
            {source.quote.length > 280 ? `${source.quote.slice(0, 280)}...` : source.quote}
          </Typography>
        ) : null}
        <Typography variant="body2" className="text-text-secondary">
          {[
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
      <Box className="flex flex-wrap gap-1">
        <Button
          variant="text"
          color="grey"
          size="small"
          href={source.sourceUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          aria-label={t("library-source-open-label", { source: source.citation })}
          title={t("library-source-open-label", { source: source.citation })}
        >
          {t("library-source-open")}
        </Button>
        {mayWrite && !source.platform ? (
          <>
            <Button
              variant="text"
              color="grey"
              size="small"
              onClick={onEdit}
              aria-label={t("library-source-edit-label", { source: source.citation })}
            >
              {t("library-source-edit")}
            </Button>
            <Button
              variant="text"
              color="grey"
              size="small"
              onClick={onRetire}
              aria-label={t("library-source-retire-label", { source: source.citation })}
            >
              {t("library-source-retire")}
            </Button>
          </>
        ) : null}
      </Box>
    </Box>
  );
}

function SourceDialog({ form, onClose, onSaved }: { form: SourceForm; onClose: () => void; onSaved: () => void }) {
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
  // A transcription pasted in is work too: the dialog never closes over it without asking, nor mid-save.
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
    <Dialog open onClose={close} aria-labelledby="library-source-dialog" maxWidth="sm" fullWidth>
      <DialogHeader
        id="library-source-dialog"
        title={t(editing ? "library-source-dialog-edit" : "library-source-dialog-new")}
        onClose={close}
        closeLabel={t("library-close")}
      />
      <DialogContent className="flex flex-col gap-4 pt-2!">
        <TextField
          label={t("library-source-citation")}
          helperText={t(editing ? "library-source-citation-fixed" : "library-source-citation-help")}
          value={citation}
          onChange={(event) => setCitation(event.target.value.slice(0, 300))}
          disabled={pending}
          fullWidth
          autoFocus={!editing && form.citation === ""}
          // What a source is does not change: its citation is read, never greyed out.
          slotProps={{ htmlInput: { readOnly: editing } }}
        />
        <TextField
          label={t("library-source-title")}
          value={title}
          onChange={(event) => setTitle(event.target.value.slice(0, 300))}
          disabled={pending}
          fullWidth
          autoFocus={!editing && form.citation !== ""}
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
        <Box className="flex flex-wrap gap-2">
          <Button variant="contained" disabled={pending || !complete} onClick={save}>
            {t(editing ? "library-save" : "library-source-confirm")}
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

function RetireDialog({
  source,
  onClose,
  onSaved,
}: {
  source: LibrarySource;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [pending, startTransition] = useTransition();
  const [reason, setReason] = useState("");
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const retire = () =>
    startTransition(async () => {
      setErrorCode(null);
      try {
        const result = await retireLegalSource({ sourceId: source.id, reason });
        if (result.ok) onSaved();
        else setErrorCode(result.code);
      } catch {
        setErrorCode("failed");
      }
    });

  return (
    <Dialog open onClose={onClose} aria-labelledby="library-retire-dialog" maxWidth="sm" fullWidth>
      <DialogHeader
        id="library-retire-dialog"
        title={t("library-retire-title")}
        onClose={onClose}
        closeLabel={t("library-close")}
      />
      <DialogContent className="flex flex-col gap-4">
        <Typography variant="body1" className="font-semibold break-words">
          {source.citation}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {t("library-retire-body")}
        </Typography>
        <TextField
          label={t("library-retire-reason")}
          value={reason}
          onChange={(event) => setReason(event.target.value.slice(0, 500))}
          disabled={pending}
          fullWidth
          autoFocus
        />
        <Refusal code={errorCode} />
        <Box className="flex flex-wrap gap-2">
          <Button variant="contained" disabled={pending || reason.trim().length < 4} onClick={retire}>
            {t("library-retire-confirm")}
          </Button>
          <Button variant="text" color="grey" disabled={pending} onClick={onClose}>
            {t("library-cancel")}
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({
  template,
  onClose,
  onSaved,
}: {
  template: LibraryTemplate;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [pending, startTransition] = useTransition();
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // A paper the client signs, not a piece: what was sent of it stays.
  const paper = template.documentKind !== "piece";

  const remove = () =>
    startTransition(async () => {
      setErrorCode(null);
      try {
        const result = await removeDraftTemplate(template.id);
        if (result.ok) onSaved();
        else setErrorCode(result.code);
      } catch {
        setErrorCode("failed");
      }
    });

  return (
    <Dialog open onClose={onClose} aria-labelledby="library-remove-dialog" maxWidth="xs" fullWidth>
      <DialogHeader
        id="library-remove-dialog"
        title={t("library-template-remove-title")}
        onClose={onClose}
        closeLabel={t("library-close")}
      />
      <DialogContent className="flex flex-col gap-4">
        <Typography variant="body1">
          {t(paper ? "library-template-remove-body-paper" : "library-template-remove-body", {
            name: template.name,
          })}
        </Typography>
        <Refusal code={errorCode} />
        <Box className="flex flex-wrap gap-2">
          <Button variant="contained" disabled={pending} onClick={remove}>
            {t("library-template-remove")}
          </Button>
          <Button variant="text" color="grey" disabled={pending} onClick={onClose}>
            {t("library-cancel")}
          </Button>
        </Box>
      </DialogContent>
    </Dialog>
  );
}
