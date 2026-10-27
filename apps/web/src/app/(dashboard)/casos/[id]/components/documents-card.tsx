"use client";

import type { CaseDocument, CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import CheckSuggestion from "@/components/product/check-suggestion";
import CollapsibleCard from "@/components/product/collapsible-card";
import DialogHeader from "@/components/product/dialog-header";
import EmptyState from "@/components/product/empty-state";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import NiPaperclip from "@/icons/nexture/ni-paperclip";
import { decideCaseDocument, finishCaseUpload, openCaseFile, startCaseUpload } from "@/lib/cases/actions";
import {
  caseErrorKey,
  DOCUMENT_KIND_KEY,
  DOCUMENT_KINDS,
  DOCUMENT_STATUS_KEY,
  type DocumentKind,
  FILE_REFUSAL_KEY,
  isDocumentKind,
} from "@/lib/cases/cases";
import { processingErrorKey, readDataDiffers, type ReadDiffer } from "@/lib/cases/document-check";
import { PHOTO_PROBLEM_KEY } from "@/lib/cases/document-quality";
import { opensOnArrival } from "@/lib/cases/sections";
import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";

type Ready = Extract<CaseState, { kind: "ready" }>;

const STATUS_TONE: Record<CaseDocument["status"], StatusTone> = {
  received: "info",
  accepted: "positive",
  rejected: "attention",
};
const READ_DIFFER_KEY: Record<ReadDiffer, string> = {
  cpf: "read-item-cpf",
  birth_date: "read-item-birth-date",
  postal_code: "read-item-postal-code",
};
const SOURCE_KEY: Record<CaseDocument["source"], string> = {
  client: "case-document-source-client",
  firm: "case-document-source-firm",
  whatsapp: "case-document-source-whatsapp",
  signature: "case-document-source-signature",
};

/**
 * The documents of the case. What the client (or a colleague) added waits
 * here to be checked: open it, accept it, or refuse it with a reason the
 * client reads on their link. The firm adds its own files the same way the
 * client does: straight to storage, measured by the backend.
 *
 * The backend reads each one first (migration 0024): a photo becomes a PDF
 * for the court systems, and the AI suggests accepting or refusing it. The
 * suggestion is shown where the person decides; accepting or refusing here
 * is what decides it, the legs a ticket carries included.
 */
export default function DocumentsCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [refusing, setRefusing] = useState<CaseDocument | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [kind, setKind] = useState<DocumentKind>("evidence");
  const [party, setParty] = useState<string>("");
  const input = useRef<HTMLInputElement>(null);

  const personOf = (partyId: string | null) =>
    state.parties.find((candidate) => candidate.partyId === partyId)?.person.full_name ?? null;
  const list = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });
  // What a document of a person says otherwise than their record (migration 0063), never of a refused one.
  const differsOf = (document: CaseDocument) => {
    const person = state.parties.find((candidate) => candidate.partyId === document.partyId)?.person;
    return person && document.check && document.status !== "rejected"
      ? readDataDiffers(document.check.answer.data, person)
      : [];
  };
  const toReview = state.documents.filter((document) => document.status === "received");
  const decided = state.documents.filter((document) => document.status !== "received");

  const open = async (document: CaseDocument, fileId: string = document.fileId) => {
    setBusy(document.id);
    setProblem(null);
    const link = await openCaseFile(fileId);
    setBusy(null);
    if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
    else setProblem(link.code);
  };

  const accept = async (document: CaseDocument) => {
    setBusy(document.id);
    setProblem(null);
    const result = await decideCaseDocument(state.case.id, document.id, "accepted");
    setBusy(null);
    if (!result.ok) setProblem(result.code);
    else onChanged();
  };

  const send = async (file: File) => {
    setBusy("upload");
    setProblem(null);
    try {
      const mime = mimeOf(file);
      const started = await startCaseUpload({ name: file.name, mime, bytes: file.size });
      if (!started.ok) {
        setProblem(started.code);
        return;
      }
      const uploaded = await uploadToSignedUrl({
        storagePath: started.storagePath,
        uploadToken: started.uploadToken,
        file,
        contentType: mime,
      });
      if (!uploaded) {
        setProblem("not_uploaded");
        return;
      }
      const finished = await finishCaseUpload({
        caseId: state.case.id,
        fileId: started.fileId,
        kind,
        partyId: party || null,
      });
      if (!finished.ok) setProblem(finished.code);
      else onChanged();
    } catch {
      // A request that failed on the way (the network, the server): the button comes back.
      setProblem("not_uploaded");
    } finally {
      setBusy(null);
    }
  };

  const row = (document: CaseDocument) => (
    <Box key={document.id} className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
      <Box className="flex flex-wrap items-start justify-between gap-2">
        <Box className="flex min-w-0 flex-col">
          <Typography variant="body1" className="font-semibold">
            {isDocumentKind(document.kind) ? t(DOCUMENT_KIND_KEY[document.kind]) : document.kind}
            {personOf(document.partyId) ? ` · ${personOf(document.partyId)}` : ""}
          </Typography>
          <Typography variant="body2" className="text-text-secondary break-all">
            {document.name} · {t(SOURCE_KEY[document.source])}
          </Typography>
        </Box>
        <StatusChip tone={STATUS_TONE[document.status]} label={t(DOCUMENT_STATUS_KEY[document.status])} />
      </Box>
      {document.status === "received" && document.check?.waiting ? (
        <Box className="flex flex-col gap-1">
          <CheckSuggestion answer={document.check.answer} />
          <Typography variant="body2" className="text-text-secondary">
            {t("case-document-check-decides")}
          </Typography>
        </Box>
      ) : document.status === "received" && (document.processing === "pending" || document.processing === "working") ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("case-document-check-working")}
        </Typography>
      ) : document.status === "received" && document.processing === "failed" ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("case-document-check-failed", { reason: t(processingErrorKey(document.processingError)) })}
        </Typography>
      ) : null}
      {document.quality && document.quality.problems.length > 0 ? (
        // What the rule measured of the photo where it arrived: said to who decides, and deciding nothing.
        <Typography variant="body2" className="text-text-primary">
          {[
            t("case-document-photo-poor", {
              problems: document.quality.problems.map((item) => t(PHOTO_PROBLEM_KEY[item])).join(" · "),
            }),
            document.quality.insisted ? t("case-document-photo-insisted") : null,
          ]
            .filter(Boolean)
            .join(" ")}
        </Typography>
      ) : null}
      {differsOf(document).length > 0 && (
        // A fact of the record the document says otherwise: ONE changed nothing, and who decides looks at it.
        <Typography variant="body2" className="text-text-primary">
          {t("case-document-read-differs", {
            fields: list.format(differsOf(document).map((field) => t(READ_DIFFER_KEY[field]))),
          })}
        </Typography>
      )}
      {document.status === "rejected" && document.rejectedReason && (
        <Typography variant="body2" className="text-text-secondary">
          {t("client-document-rejected", {
            reason: FILE_REFUSAL_KEY[document.rejectedReason]
              ? t(FILE_REFUSAL_KEY[document.rejectedReason])
              : document.rejectedReason,
          })}
        </Typography>
      )}
      <Box className="flex flex-wrap gap-2 pt-1">
        <Button
          variant="outlined"
          color="grey"
          size="small"
          disabled={busy !== null}
          onClick={() => void open(document)}
        >
          {t("case-document-open")}
        </Button>
        {document.normalizedFileId && (
          <Button
            variant="outlined"
            color="grey"
            size="small"
            disabled={busy !== null}
            onClick={() => void open(document, document.normalizedFileId ?? document.fileId)}
          >
            {t("case-document-open-pdf")}
          </Button>
        )}
        {writable && document.status === "received" && (
          <>
            <Button variant="contained" size="small" disabled={busy !== null} onClick={() => void accept(document)}>
              {t("case-document-accept")}
            </Button>
            <Button
              variant="text"
              color="grey"
              size="small"
              disabled={busy !== null}
              onClick={() => setRefusing(document)}
            >
              {t("case-document-refuse")}
            </Button>
          </>
        )}
      </Box>
    </Box>
  );

  const accepted = state.documents.filter((document) => document.status === "accepted").length;
  const refused = state.documents.filter((document) => document.status === "rejected").length;

  return (
    <CollapsibleCard
      id="case-documents"
      title={t("case-documents-title")}
      summary={
        state.documents.length === 0
          ? t("case-documents-empty-title")
          : [
              t("case-documents-summary", { count: state.documents.length }),
              accepted > 0 ? t("case-documents-summary-accepted", { count: accepted }) : null,
              refused > 0 ? t("case-documents-summary-refused", { count: refused }) : null,
            ]
              .filter(Boolean)
              .join(" · ")
      }
      chip={
        toReview.length > 0 ? (
          <StatusChip tone="attention" label={t("case-documents-to-review", { count: toReview.length })} />
        ) : null
      }
      description={t("case-documents-body")}
      defaultOpen={opensOnArrival(state.case.status, "documents", toReview.length > 0, state.documents.length === 0)}
    >
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(caseErrorKey(problem))}
        </Alert>
      )}

      {state.documents.length === 0 && (
        <EmptyState
          titleAs="h3"
          icon={<NiPaperclip />}
          title={t("case-documents-empty-title")}
          description={t("case-documents-empty-body")}
        />
      )}

      {toReview.length > 0 && (
        <Box className="flex flex-col gap-2">
          <Typography variant="subtitle2" component="h3">
            {t("case-documents-to-review", { count: toReview.length })}
          </Typography>
          {toReview.map(row)}
        </Box>
      )}
      {decided.length > 0 && (
        <Box className="flex flex-col gap-2">
          <Typography variant="subtitle2" component="h3">
            {t("case-documents-decided")}
          </Typography>
          {decided.map(row)}
        </Box>
      )}

      {writable && (
        <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
          <Typography variant="body1" className="font-semibold">
            {t("case-documents-add")}
          </Typography>
          <Box className="flex flex-col gap-3 sm:flex-row">
            <TextField
              select
              size="small"
              fullWidth
              id="case-document-kind"
              label={t("client-documents-kind")}
              value={kind}
              onChange={(event) => setKind(event.target.value as DocumentKind)}
            >
              {DOCUMENT_KINDS.map((value) => (
                <MenuItem key={value} value={value}>
                  {t(DOCUMENT_KIND_KEY[value])}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              fullWidth
              id="case-document-person"
              label={t("client-documents-person")}
              value={party}
              onChange={(event) => setParty(event.target.value)}
            >
              <MenuItem value="">{t("case-documents-whole-case")}</MenuItem>
              {state.parties.map((candidate) => (
                <MenuItem key={candidate.partyId} value={candidate.partyId}>
                  {candidate.person.full_name}
                </MenuItem>
              ))}
            </TextField>
          </Box>
          <input
            ref={input}
            type="file"
            hidden
            accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void send(file);
            }}
          />
          <Box>
            <Button
              variant="outlined"
              color="grey"
              size="small"
              disabled={busy !== null}
              onClick={() => input.current?.click()}
            >
              {busy === "upload" ? t("client-documents-sending") : t("client-documents-choose")}
            </Button>
          </Box>
        </Box>
      )}

      {refusing && (
        <RefuseDialog
          caseId={state.case.id}
          document={refusing}
          onClose={() => setRefusing(null)}
          onDone={() => {
            setRefusing(null);
            onChanged();
          }}
        />
      )}
    </CollapsibleCard>
  );
}

function RefuseDialog({
  caseId,
  document,
  onClose,
  onDone,
}: {
  caseId: string;
  document: CaseDocument;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("product");
  // What the AI would tell the client, when it suggested refusing: a starting point the person may rewrite.
  const [reason, setReason] = useState(
    document.check?.waiting && document.check.answer.decision === "recusar" ? document.check.answer.reason : "",
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const explained = reason.trim().length >= 4;

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const result = await decideCaseDocument(caseId, document.id, "rejected", reason);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.code);
      return;
    }
    onDone();
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="xs" fullWidth aria-labelledby="case-refuse-dialog">
      <DialogHeader
        id="case-refuse-dialog"
        title={t("case-document-refuse-title")}
        onClose={onClose}
        closeLabel={t("cases-close")}
      />
      <DialogContent>
        <Box className="flex flex-col gap-3 pt-1">
          <TextField
            fullWidth
            multiline
            minRows={3}
            size="small"
            id="case-refuse-reason"
            label={t("case-document-refuse-reason")}
            helperText={t("case-document-refuse-help")}
            value={reason}
            disabled={busy}
            slotProps={{ htmlInput: { maxLength: 500 } }}
            onChange={(event) => setReason(event.target.value)}
          />
          {problem && (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t(caseErrorKey(problem))}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          {t("cases-cancel")}
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || !explained}>
          {busy ? t("cases-working") : t("case-document-refuse")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
