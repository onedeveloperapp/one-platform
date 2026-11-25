"use client";

import type { CaseDocument, CasePerson, CaseState } from "../case-types";
import { sentence, useCaseAction } from "./case-action";
import { useClientAsked } from "./client-asked";
import { addressLine } from "./person-read-check";
import ResidenceLine from "./residence-line";
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
import ItemRows, { type ItemRow } from "@/components/product/item-rows";
import SectionTitle from "@/components/product/section-title";
import StateLine from "@/components/product/state-line";
import IllustrationDocumentation from "@/icons/illustrations/illustration-documentation";
import NiDocumentCross from "@/icons/nexture/ni-document-cross";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import {
  decideCaseDocument,
  finishCaseUpload,
  openCaseFile,
  saveCasePerson,
  startCaseUpload,
} from "@/lib/cases/actions";
import {
  caseErrorKey,
  caseMissing,
  DOCUMENT_KIND_KEY,
  DOCUMENT_KINDS,
  type DocumentKind,
  FILE_REFUSAL_KEY,
  isDocumentKind,
} from "@/lib/cases/cases";
import { processingErrorKey, readDataDiffers, type ReadDiffer } from "@/lib/cases/document-check";
import { recordDocumentNotHave } from "@/lib/cases/document-needs-actions";
import { PHOTO_PROBLEM_KEY } from "@/lib/cases/document-quality";
import { documentLine, orderDocuments } from "@/lib/cases/document-rows";
import { SECTION_ANCHOR } from "@/lib/cases/now";
import { opensOnArrival } from "@/lib/cases/sections";
import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";
import { formatCpf } from "@flyee/fields";
import { formatDayBr } from "@flyee/rules/person";

type Ready = Extract<CaseState, { kind: "ready" }>;

/** A day as a line says it, in Brasília: 07/11. */
const dayOf = (at: string) =>
  new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" }).format(
    new Date(at),
  );
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
  partner: "case-document-source-partner",
  reuse: "case-document-source-reuse",
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
/** Where a dispensable document stands, in words. */
const DISPENSABLE_STATE_KEY: Record<"sent" | "not_have" | "expired" | "asked" | "later", string> = {
  sent: "case-documents-dispensable-sent",
  later: "case-documents-dispensable-later",
  not_have: "case-documents-dispensable-not-have",
  expired: "case-documents-dispensable-expired",
  asked: "case-documents-dispensable-asked",
};

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
  // One action at a time on the case: while one runs, every control waits, and the result shows before they come back.
  const action = useCaseAction("documents");
  const words = {
    accept: {
      doing: t("case-action-document-accept-doing"),
      done: t("case-action-document-accept-done"),
      failed: t("case-action-document-accept-failed"),
    },
    upload: {
      doing: t("case-action-document-upload-doing"),
      done: t("case-action-document-upload-done"),
      failed: t("case-action-document-upload-failed"),
    },
    notHave: {
      doing: t("case-action-document-not-have-doing"),
      done: t("case-action-document-not-have-done"),
      failed: t("case-action-document-not-have-failed"),
    },
  };
  // Opening a file only reads: it stays free while an action runs.
  const [opening, setOpening] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [kind, setKind] = useState<DocumentKind>("evidence");
  // The form of a file the firm includes, opened by the card's foot.
  const [adding, setAdding] = useState(false);
  const [party, setParty] = useState<string>("");
  // A document ONE is still checking that the person chose to decide without waiting for it.
  const [early, setEarly] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const residenceOf = (document: CaseDocument) =>
    state.residence?.find((view) => view.documentId === document.id) ?? null;
  const personOf = (partyId: string | null) =>
    state.parties.find((candidate) => candidate.partyId === partyId)?.person.full_name ?? null;
  // What a document of a person says otherwise than their record (migration 0063), never of a refused one.
  const differsOf = (document: CaseDocument) => {
    const person = state.parties.find((candidate) => candidate.partyId === document.partyId)?.person;
    return person && document.check && document.status !== "rejected"
      ? readDataDiffers(document.check.answer.data, person)
      : [];
  };
  // What ONE is checking now is ONE's work, never the firm's task: only what waits for a person is to review.
  const checking = state.documents.filter(
    (document) =>
      document.status === "received" && (document.processing === "pending" || document.processing === "working"),
  );

  const open = async (document: CaseDocument, fileId: string = document.fileId) => {
    setOpening(document.id);
    setProblem(null);
    const link = await openCaseFile(fileId);
    setOpening(null);
    if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
    else setProblem(link.code);
  };

  const accept = (document: CaseDocument) =>
    action.run(`accept-${document.id}`, words.accept, async () => {
      setProblem(null);
      const result = await decideCaseDocument(state.case.id, document.id, "accepted");
      if (!result.ok) setProblem(result.code);
      return result.ok;
    });

  // The file goes straight to storage from the browser, and the backend measures it before the case keeps it.
  const upload = async (file: File) => {
    const mime = mimeOf(file);
    const started = await startCaseUpload({ name: file.name, mime, bytes: file.size });
    if (!started.ok) {
      setProblem(started.code);
      return false;
    }
    const uploaded = await uploadToSignedUrl({
      storagePath: started.storagePath,
      uploadToken: started.uploadToken,
      file,
      contentType: mime,
    });
    if (!uploaded) {
      setProblem("not_uploaded");
      return false;
    }
    const finished = await finishCaseUpload({
      caseId: state.case.id,
      fileId: started.fileId,
      kind,
      partyId: party || null,
    });
    if (!finished.ok) setProblem(finished.code);
    return finished.ok;
  };

  const send = (file: File) =>
    action.run("upload", words.upload, async () => {
      setProblem(null);
      try {
        return await upload(file);
      } catch {
        // A request that failed on the way (the network, the server): the button comes back.
        setProblem("not_uploaded");
        return false;
      }
    });

  // What opens in a document's line: the file, ONE's suggestion, what the photo measured, and the decision.
  const body = (document: CaseDocument) => (
    <Box className="flex flex-col gap-2">
      <Typography variant="body2" className="text-text-secondary break-all">
        {document.name} · {t(SOURCE_KEY[document.source])}
      </Typography>
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
        // A fact of the record the document says otherwise: ONE changed nothing, and who decides sees both values.
        <DiffersBlock
          caseId={state.case.id}
          document={document}
          person={state.parties.find((candidate) => candidate.partyId === document.partyId)?.person ?? null}
          fields={differsOf(document)}
          writable={writable}
          onChanged={onChanged}
        />
      )}
      {residenceOf(document) ? (
        // A bill in somebody else's name the firm accepted owes the client's declaration of residence (0123).
        <ResidenceLine
          caseId={state.case.id}
          view={residenceOf(document)!}
          recordAddress={(() => {
            const person = state.parties.find(
              (candidate) => candidate.person.person_id === residenceOf(document)!.personId,
            )?.person;
            return person ? addressLine(person) : null;
          })()}
          writable={writable}
          mayWaive={state.lawyer}
          onSendLink={() => {
            // The document of the client's link to the holder, sent by the firm for the client (0294).
            setKind("residence_link");
            setParty(
              state.parties.find((candidate) => candidate.person.person_id === residenceOf(document)!.personId)
                ?.partyId ?? "",
            );
            input.current?.click();
          }}
          onChanged={onChanged}
        />
      ) : null}
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
          component="span"
          disabled={opening !== null}
          onClick={() => void open(document)}
        >
          {t("case-document-open")}
        </Button>
        {document.normalizedFileId && (
          <Button
            variant="outlined"
            color="grey"
            size="small"
            component="span"
            disabled={opening !== null}
            onClick={() => void open(document, document.normalizedFileId ?? document.fileId)}
          >
            {t("case-document-open-pdf")}
          </Button>
        )}
        {writable && document.status === "received" && checking.includes(document) && early !== document.id && (
          <Button variant="text" color="grey" size="small" disabled={action.busy} onClick={() => setEarly(document.id)}>
            {t("case-document-decide-early")}
          </Button>
        )}
        {writable && document.status === "received" && (!checking.includes(document) || early === document.id) && (
          <>
            <Button
              variant="contained"
              size="small"
              disabled={action.busy}
              loading={action.pending(`accept-${document.id}`)}
              loadingPosition="start"
              onClick={() => void accept(document)}
            >
              {action.pending(`accept-${document.id}`) ? sentence(words.accept.doing) : t("case-document-accept")}
            </Button>
            <Button
              variant="text"
              color="grey"
              size="small"
              disabled={action.busy}
              onClick={() => setRefusing(document)}
            >
              {t("case-document-refuse")}
            </Button>
          </>
        )}
      </Box>
      {early === document.id && checking.includes(document) ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("case-document-decide-early-help")}
        </Typography>
      ) : null}
    </Box>
  );

  // One line per document (the owner's canvas, 2026-11-10): what asks the firm first, ONE's checks, then the rest.
  const lined = state.documents.map((document) => ({
    document,
    line: documentLine(document, residenceOf(document)),
  }));
  const ordered = orderDocuments(lined);
  const refusalWords = (reason: string | null) =>
    reason ? (FILE_REFUSAL_KEY[reason] ? t(FILE_REFUSAL_KEY[reason]) : reason) : "";
  const asLine = ({ document, line }: (typeof lined)[number]): ItemRow => {
    const kind = isDocumentKind(document.kind) ? t(DOCUMENT_KIND_KEY[document.kind]) : document.kind;
    const day = dayOf(document.createdAt);
    return {
      key: document.id,
      icon: document.status === "rejected" ? <NiDocumentCross size="small" /> : <NiDocumentFull size="small" />,
      tone: line.place === "working" ? "accent-4" : "secondary",
      tint: document.status === "rejected" ? "bg-error-light/10 text-error" : undefined,
      title: [kind, personOf(document.partyId)].filter(Boolean).join(" · "),
      detail: t("case-rows-doc-detail", { source: t(SOURCE_KEY[document.source]), day }),
      state: { tone: line.tone, text: t(line.key, { reason: refusalWords(line.reason) }) },
      opener: line.place === "ask" && writable ? t("case-rows-doc-open") : undefined,
      openLabel: t("case-rows-doc-open-label", { kind }),
      content: () => body(document),
    };
  };

  // What the case lacks of documents, by the one rule the top of the case reads (`caseMissing`).
  const owedDocuments = caseMissing({
    parties: state.parties,
    documents: state.documents.map((document) => ({
      kind: document.kind,
      party_id: document.partyId,
      status: document.status,
    })),
    segments: state.segments.length,
    trip: !state.case.area,
    required: state.required,
    today: state.today,
  }).flatMap((item) => (item.type === "document" ? [item] : []));
  const asked = useClientAsked(state);

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
      ask={
        ordered.ask.length > 0
          ? { tone: "firm", label: t("case-rows-ask-chip", { count: ordered.ask.length }) }
          : owedDocuments.length > 0
            ? { tone: "client", label: t("card-state-client") }
            : null
      }
      description={t("case-documents-body")}
      add={writable && !adding ? { label: t("case-documents-add"), onClick: () => setAdding(true) } : null}
      defaultOpen={opensOnArrival(state.case.status, "documents", ordered.ask.length > 0, state.documents.length === 0)}
    >
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(caseErrorKey(problem))}
        </Alert>
      )}

      {state.documents.length === 0 && (
        <EmptyState
          titleAs="h3"
          layout="row"
          framed={false}
          illustration={<IllustrationDocumentation />}
          title={t("case-documents-empty-title")}
          description={t("case-documents-empty-body")}
        />
      )}

      {owedDocuments.length > 0 ? (
        // The documents the case lacks are the client's to send on their link (`WAIT_PLACE.case_incomplete`): each
        // said with who sends it and since when, the firm's own sending as the exception it is.
        <Box className="flex flex-col gap-2">
          <SectionTitle
            id="case-documents-owed"
            as="h3"
            variant="subtitle2"
            title={t("case-documents-owed-title", { count: owedDocuments.length })}
          />
          {owedDocuments.map((item) => {
            const kindWords = isDocumentKind(item.kind) ? t(DOCUMENT_KIND_KEY[item.kind]) : item.kind;
            const what = item.name ? t("case-documents-owed-of", { kind: kindWords, name: item.name }) : kindWords;
            return (
              <StateLine
                key={`${item.kind}-${item.personId ?? "case"}`}
                tone="waiting"
                action={
                  writable ? (
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      disabled={action.busy}
                      onClick={() => {
                        if (isDocumentKind(item.kind)) setKind(item.kind);
                        setParty(
                          state.parties.find((candidate) => candidate.person.person_id === item.personId)?.partyId ??
                            "",
                        );
                        input.current?.click();
                      }}
                    >
                      {t("case-documents-owed-send")}
                    </Button>
                  ) : undefined
                }
              >
                {asked(item.personId, what)}
              </StateLine>
            );
          })}
        </Box>
      ) : null}

      {state.documents.length > 0 ? (
        <ItemRows
          arrival={[SECTION_ANCHOR.documents]}
          sections={[
            { key: "ask", title: t("item-rows-ask"), ask: true, rows: ordered.ask.map(asLine) },
            { key: "working", title: t("case-rows-doc-working"), rows: ordered.working.map(asLine) },
            { key: "done", title: t("case-documents-decided"), rows: ordered.done.map(asLine), shown: 3 },
          ]}
        />
      ) : null}

      {/* 0177: what helps the case and does not hold it, asked once of the client. */}
      {state.dispensables && state.dispensables.length > 0 ? (
        <Box className="flex flex-col gap-2">
          <SectionTitle
            id="case-documents-dispensable"
            as="h3"
            variant="subtitle2"
            title={t("case-documents-dispensable-title")}
            description={t("case-documents-dispensable-hint")}
          />
          {state.dispensables.map((item) => (
            <StateLine
              key={item.kind}
              tone={item.state === "sent" ? "done" : item.state === "asked" ? "waiting" : "info"}
              status={t(DISPENSABLE_STATE_KEY[item.state])}
              action={
                writable && item.state === "asked" ? (
                  <Button
                    variant="text"
                    color="grey"
                    size="small"
                    disabled={action.busy}
                    loading={action.pending(`not-have-${item.kind}`)}
                    onClick={() =>
                      action.run(`not-have-${item.kind}`, words.notHave, async () => {
                        setProblem(null);
                        const result = await recordDocumentNotHave(state.case.id, item.kind);
                        if (!result.ok) setProblem(result.code);
                        return result.ok;
                      })
                    }
                  >
                    {t("case-documents-not-have")}
                  </Button>
                ) : undefined
              }
            >
              {item.label.charAt(0).toUpperCase() + item.label.slice(1)}
            </StateLine>
          ))}
        </Box>
      ) : null}

      {/* Always there: "Enviar pelo cliente" opens it with the kind and the person it set. */}
      {writable ? (
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
      ) : null}
      {writable && adding && (
        // A file the firm includes by itself, opened by the card's "Incluir arquivo" (the owner, 2026-11-12: one way
        // of adding on every card); a form always open at the foot had been the card's largest part.
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
          <Box className="flex flex-wrap gap-2">
            <Button
              variant="outlined"
              color="grey"
              size="small"
              disabled={action.busy}
              loading={action.pending("upload")}
              loadingPosition="start"
              onClick={() => input.current?.click()}
            >
              {action.pending("upload") ? t("client-documents-sending") : t("client-documents-choose")}
            </Button>
            <Button variant="text" color="grey" size="small" disabled={action.busy} onClick={() => setAdding(false)}>
              {t("cases-cancel")}
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

/**
 * The facts of the record a document says otherwise (0063), each with both values (the owner, 2026-11-12: a line
 * that named the field and not the values asked the person to decide what they could not see): the record's and
 * the document's, and the document's taken into the record in one click. Keeping the record changes nothing.
 */
function DiffersBlock({
  caseId,
  document,
  person,
  fields,
  writable,
  onChanged,
}: {
  caseId: string;
  document: CaseDocument;
  person: CasePerson | null;
  fields: ReadDiffer[];
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const data = document.check?.answer.data ?? null;
  if (!person || !data) return null;
  const shown = (field: ReadDiffer, value: string | null): string => {
    if (!value) return "";
    if (field === "cpf") return formatCpf(value.replace(/\D/g, ""));
    if (field === "birth_date") return formatDayBr(value.slice(0, 10)) ?? value;
    const digits = value.replace(/\D/g, "");
    return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : value;
  };
  const read: Record<ReadDiffer, string> = {
    cpf: data.cpf,
    birth_date: data.birthDate ?? "",
    postal_code: data.postalCode,
  };
  const record: Record<ReadDiffer, string | null> = {
    cpf: person.cpf,
    birth_date: person.birth_date,
    postal_code: person.postal_code,
  };
  const take = async () => {
    setBusy(true);
    setProblem(null);
    const result = await saveCasePerson({
      caseId,
      personId: person.person_id,
      fields: Object.fromEntries(
        fields.map((field) => [field, field === "birth_date" ? read[field] : read[field].replace(/\D/g, "")]),
      ),
    });
    setBusy(false);
    if (!result.ok) setProblem(result.code);
    else onChanged();
  };
  return (
    <Box className="border-accent-3/30 bg-accent-3-light/10 flex flex-col gap-3 rounded-2xl border p-4">
      <Typography variant="body2" className="text-text-primary font-semibold">
        {t("case-document-differs-title")}
      </Typography>
      {fields.map((field) => (
        <Box
          key={field}
          className="grid grid-cols-1 gap-2 sm:grid-cols-[8rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-baseline"
        >
          <Typography variant="body2" className="font-semibold">
            {t(READ_DIFFER_KEY[field])}
          </Typography>
          <Typography variant="body2">
            <span className="text-text-secondary">{t("case-document-differs-record")} </span>
            {shown(field, record[field])}
          </Typography>
          <Typography variant="body2">
            <span className="text-text-secondary">{t("case-document-differs-read")} </span>
            {shown(field, read[field])}
          </Typography>
        </Box>
      ))}
      {problem ? (
        <Typography variant="body2" role="alert" className="text-text-primary">
          {t(caseErrorKey(problem))}
        </Typography>
      ) : null}
      {writable ? (
        <Box className="flex flex-wrap items-center gap-3">
          <Button
            variant="outlined"
            color="grey"
            size="small"
            disabled={busy}
            loading={busy}
            onClick={() => void take()}
          >
            {t("case-document-differs-take")}
          </Button>
          <Typography variant="caption" className="text-text-secondary">
            {t("case-document-differs-keep")}
          </Typography>
        </Box>
      ) : null}
    </Box>
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
