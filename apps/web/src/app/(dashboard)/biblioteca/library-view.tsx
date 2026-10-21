"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogContent,
  FormControlLabel,
  Grid,
  MenuItem,
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
import { DRAFT_MARK_KEY, DRAFT_MARKS, libraryErrorKey, unknownMarks } from "@/lib/cases/drafts";
import {
  readDraftTemplate,
  removeDraftTemplate,
  retireLegalSource,
  saveDraftTemplate,
  saveLegalSource,
} from "@/lib/library/actions";
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

type Kind = "juizado" | "comum" | null;
const KIND_KEY: Record<"juizado" | "comum", string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};

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
  const [templateForm, setTemplateForm] = useState<{ template: LibraryTemplate | null } | null>(null);
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
  const full = data !== null && data.templates.length >= data.maxTemplates;
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
                      <Box className="flex min-w-0 flex-1 flex-col">
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
                      <Box className="flex min-w-0 flex-1 flex-col">
                        <Typography variant="body1" className="font-semibold break-words">
                          {template.name}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          {[
                            t(
                              template.proceedingKind ? KIND_KEY[template.proceedingKind] : "library-template-kind-any",
                            ),
                            t("library-template-cited", { count: template.cited }),
                            template.updatedBy
                              ? t("library-template-updated", { name: template.updatedBy, when: template.updatedLabel })
                              : t("library-template-updated-at", { when: template.updatedLabel }),
                          ].join(" · ")}
                        </Typography>
                      </Box>
                      {template.isDefault ? (
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
                      {mayWrite ? (
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
                        <Box className="flex min-w-0 flex-1 flex-col">
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
          defaults={Object.fromEntries(
            (data?.templates ?? [])
              .filter((template) => template.isDefault && template.id !== templateForm.template?.id)
              .map((template) => [template.proceedingKind ?? "any", template.name]),
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
      <Box className="flex min-w-0 flex-1 flex-col gap-0.5">
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
            source.verifiedBy
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
        {mayWrite ? (
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

/** What an action's refusal says. */
function Refusal({ code }: { code: string | null }) {
  const t = useTranslations("product");
  return code ? (
    <Alert severity="error" className="neutral bg-background-paper/60!">
      {t(libraryErrorKey(code))}
    </Alert>
  ) : null;
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
      <DialogContent className="flex flex-col gap-4">
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
        <Typography variant="body1">{t("library-template-remove-body", { name: template.name })}</Typography>
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

/** What saying a model is the default means, for the kind it is written for. */
function defaultKey(kind: Kind): string {
  if (kind === null) return "library-template-default-any";
  return kind === "comum" ? "library-template-default-comum" : "library-template-default-juizado";
}

/**
 * A model of the firm: its name, the kind of proceeding it is written for,
 * whether it is the default ONE writes the pieces of that kind from, and its
 * text, with the marks the platform fills in with the facts of a lawsuit.
 * The text of a model already there, and whether it is the default now, are
 * read when the dialog opens, and the dialog never closes over what nobody
 * saved without asking. A model made the default of a kind says which one
 * stops being it.
 */
function TemplateDialog({
  template,
  defaults,
  onClose,
  onSaved,
}: {
  template: LibraryTemplate | null;
  /** The other models that are a default now, by the kind they are for ("any" for both). */
  defaults: Record<string, string>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [pending, startTransition] = useTransition();
  const [name, setName] = useState(template?.name ?? "");
  const [kind, setKind] = useState<Kind>(template?.proceedingKind ?? null);
  // Whether it is the default as it was read when the dialog opened, and as it is on screen.
  const [savedDefault, setSavedDefault] = useState(template?.isDefault ?? false);
  const [isDefault, setIsDefault] = useState(template?.isDefault ?? false);
  // The text as it was read, and the text on screen: what "changed" is measured against.
  const [saved, setSaved] = useState<string | null>(template ? null : "");
  const [body, setBody] = useState<string | null>(template ? null : "");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const templateId = template?.id ?? null;

  useEffect(() => {
    if (!templateId) return;
    let open = true;
    readDraftTemplate(templateId)
      .then((read) => {
        if (!open) return;
        if (read.ok) {
          setSaved(read.body);
          setBody(read.body);
          setSavedDefault(read.isDefault);
          setIsDefault(read.isDefault);
        } else setErrorCode(read.code);
      })
      .catch(() => {
        if (open) setErrorCode("failed");
      });
    return () => {
      open = false;
    };
  }, [templateId]);

  const odd = unknownMarks(body ?? "");
  const complete = name.trim().length >= 2 && (body ?? "").trim().length >= 20;
  const changed =
    name !== (template?.name ?? "") ||
    kind !== (template?.proceedingKind ?? null) ||
    isDefault !== savedDefault ||
    (body ?? "") !== (saved ?? "");
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
          proceedingKind: kind,
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
        title={t(template ? "library-template-dialog-edit" : "library-template-dialog-new")}
        onClose={close}
        closeLabel={t("library-close")}
      />
      <DialogContent className="flex flex-col gap-4">
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
            label={t("library-template-kind")}
            value={kind ?? "any"}
            // Chosen once the model is read: what it is now is what the choice starts from.
            onChange={(event) => {
              const next: Kind =
                event.target.value === "juizado" || event.target.value === "comum" ? event.target.value : null;
              setKind(next);
              // The default of one kind is not the default of another: said again for a new kind, by the person; back
              // to its own kind, the model is what it was.
              setIsDefault(next === (template?.proceedingKind ?? null) ? savedDefault : false);
            }}
            disabled={pending || body === null}
            className="min-w-56"
          >
            <MenuItem value="any">{t("library-template-kind-any")}</MenuItem>
            <MenuItem value="juizado">{t(KIND_KEY.juizado)}</MenuItem>
            <MenuItem value="comum">{t(KIND_KEY.comum)}</MenuItem>
          </TextField>
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
            label={t(defaultKey(kind))}
          />
          {isDefault && defaults[kind ?? "any"] ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("library-template-default-replaces", { name: defaults[kind ?? "any"] })}
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
              helperText={t("library-template-body-help")}
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
              {DRAFT_MARKS.map((mark) => (
                <Box key={mark} className="flex flex-wrap gap-x-1">
                  <Typography component="dt" variant="body2" className="font-semibold">
                    {`[[${mark}]]`}
                  </Typography>
                  <Typography component="dd" variant="body2" className="text-text-secondary m-0">
                    {t(DRAFT_MARK_KEY[mark])}
                  </Typography>
                </Box>
              ))}
            </Box>
            {odd.length > 0 ? (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {t("draft-unknown-marks", { marks: odd.map((mark) => `[[${mark}]]`).join(", ") })}
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
