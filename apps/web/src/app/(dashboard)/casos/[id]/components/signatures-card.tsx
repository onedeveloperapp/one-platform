"use client";

import type { CaseEnvelope, CaseState } from "../case-types";
import { sentence, useCaseAction } from "./case-action";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  FormGroup,
  FormLabel,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import DialogHeader from "@/components/product/dialog-header";
import EmptyState from "@/components/product/empty-state";
import ItemRows, { type ItemRow } from "@/components/product/item-rows";
import StateLine, { type StateTone } from "@/components/product/state-line";
import type { StatusTone } from "@/components/product/status-chip";
import IllustrationDocumentation from "@/icons/illustrations/illustration-documentation";
import NiPen from "@/icons/nexture/ni-pen";
import { openCaseFile } from "@/lib/cases/actions";
import { caseErrorKey, DOCUMENT_KIND_KEY, isDocumentKind } from "@/lib/cases/cases";
import { SECTION_ANCHOR } from "@/lib/cases/now";
import { opensOnArrival } from "@/lib/cases/sections";
import {
  cancelSignature,
  confirmSignature,
  refreshSignature,
  requestSignature,
  simulateTestSignature,
} from "@/lib/signatures/actions";
import { isMinorOn } from "@flyee/rules/person";

type Ready = Extract<CaseState, { kind: "ready" }>;
type Method = CaseEnvelope["method"];

const METHODS: readonly Method[] = ["zapsign", "govbr", "enotariado"];

const METHOD_KEY: Record<Method, string> = {
  zapsign: "case-signature-method-zapsign",
  govbr: "case-signature-method-govbr",
  enotariado: "case-signature-method-enotariado",
};

/**
 * The level of each way of signing (Lei 14.063/2020, art. 4º): a ZapSign signature is a simple electronic one, gov.br's
 * an advanced one, and an act of e-Notariado a qualified one, with an ICP-Brasil certificate. Said beside each paper,
 * since the CNJ's Recomendação 159/2024 names a signature with no ICP-Brasil certificate among the signs it watches.
 */
const LEVEL_KEY: Record<Method, string> = {
  zapsign: "case-signature-level-simple",
  govbr: "case-signature-level-advanced",
  enotariado: "case-signature-level-qualified",
};

const METHOD_HINT_KEY: Record<Method, string> = {
  zapsign: "case-signature-method-zapsign-hint",
  govbr: "case-signature-method-govbr-hint",
  enotariado: "case-signature-method-enotariado-hint",
};

const STATUS: Record<string, { key: string; tone: StatusTone }> = {
  reserved: { key: "case-signature-status-reserved", tone: "neutral" },
  opening: { key: "case-signature-status-opening", tone: "neutral" },
  pending: { key: "case-signature-status-pending", tone: "attention" },
  received: { key: "case-signature-status-received", tone: "info" },
  signed: { key: "case-signature-status-signed", tone: "positive" },
  refused: { key: "case-signature-status-refused", tone: "danger" },
  expired: { key: "case-signature-status-expired", tone: "neutral" },
  cancelled: { key: "case-signature-status-cancelled", tone: "neutral" },
  failed: { key: "case-signature-status-failed", tone: "danger" },
  uncertain: { key: "case-signature-status-uncertain", tone: "attention" },
};

const ENDED = ["signed", "refused", "expired", "cancelled"];
/** How a paper that ended stands, in its line's colour: signed, refused by the client, or let go. */
const ENDED_STATE: Record<string, StateTone> = {
  signed: "done",
  refused: "failed",
  expired: "info",
  cancelled: "info",
};
/** What waits for the firm: a file the client signed elsewhere and sent back, or an envelope ZapSign did not take. */
const NEEDS_PERSON = ["received", "failed", "uncertain"];
const SIGNABLE_KINDS = ["power_of_attorney", "contract", "other"];

/**
 * What the client signs: the power of attorney, the contract, a declaration.
 * The firm adds the PDF to the case's documents, sends it to be signed by
 * ZapSign, gov.br or e-Notariado, and follows it here; what ZapSign signs
 * comes back by itself, what was signed elsewhere a person confirms.
 */
export default function SignaturesCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [requesting, setRequesting] = useState(false);
  const [cancelling, setCancelling] = useState<CaseEnvelope | null>(null);
  const [confirming, setConfirming] = useState<CaseEnvelope | null>(null);
  // One action at a time on the case: while one runs, every control waits, and the result shows before they come back.
  const action = useCaseAction("signatures");
  const words = {
    refresh: { doing: t("case-action-signature-refresh-doing"), failed: t("case-action-signature-refresh-failed") },
    simulate: {
      doing: t("case-action-signature-simulate-doing"),
      done: t("case-action-signature-simulate-done"),
      failed: t("case-action-signature-simulate-failed"),
    },
  };
  const [problem, setProblem] = useState<string | null>(null);

  const documentOf = (id: string | null) => state.documents.find((document) => document.id === id) ?? null;
  const signable = state.documents.filter(
    (document) =>
      SIGNABLE_KINDS.includes(document.kind) && document.status !== "rejected" && document.source !== "signature",
  );

  const refresh = (envelope: CaseEnvelope) =>
    action.run(`refresh-${envelope.id}`, words.refresh, async () => {
      setProblem(null);
      const result = await refreshSignature(state.case.id, envelope.id);
      if (!result.ok) setProblem(result.code);
      return result.ok;
    });

  // A paper of a test case signed in one click (0138): the copy kept as signed says it was simulated.
  const simulate = (envelope: CaseEnvelope) =>
    action.run(`simulate-${envelope.id}`, words.simulate, async () => {
      setProblem(null);
      const result = await simulateTestSignature(state.case.id, envelope.id);
      if (!result.ok) setProblem(result.code);
      return result.ok;
    });

  const open = async (fileId: string) => {
    const link = await openCaseFile(fileId);
    if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
    else setProblem(link.code);
  };

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      setProblem("failed");
    }
  };

  const kindOf = (envelope: CaseEnvelope) => {
    const original = documentOf(envelope.documentId);
    return original && isDocumentKind(original.kind)
      ? t(DOCUMENT_KIND_KEY[original.kind])
      : t("case-signature-document");
  };
  const statusOf = (envelope: CaseEnvelope) => t((STATUS[envelope.status] ?? STATUS.pending).key);
  const needs = state.envelopes.find((envelope) => NEEDS_PERSON.includes(envelope.status)) ?? null;

  // What opens in a paper's line: the file, who signs it and how far, what went wrong, and what may be done.
  const envelopeBody = (envelope: CaseEnvelope) => {
    const original = documentOf(envelope.documentId);
    const signed = documentOf(envelope.signedDocumentId);
    const returned = state.documents.find(
      (document) => document.envelopeId === envelope.id && document.id !== envelope.signedDocumentId,
    );
    const ended = ENDED.includes(envelope.status);
    // What was signed outside ZapSign is signed once a person of the firm confirmed it: no provider says when
    // each signer signed, and the line says it was the firm that checked.
    const confirmedByFirm = envelope.status === "signed" && envelope.method !== "zapsign";
    return (
      <Box className="flex flex-col gap-2">
        {original && (
          <Typography variant="body2" className="text-text-secondary break-all">
            {original.name}
          </Typography>
        )}
        <Typography variant="caption" className="text-text-secondary">
          {t(LEVEL_KEY[envelope.method])}
        </Typography>

        {envelope.signers.map((signer) => (
          <Box key={signer.position} className="flex flex-wrap items-center gap-2">
            <Typography variant="body2">
              {signer.signedAt
                ? t("case-signature-signer-signed", { name: signer.name })
                : confirmedByFirm
                  ? t("case-signature-signer-confirmed", { name: signer.name })
                  : t("case-signature-signer-waiting", { name: signer.name })}
            </Typography>
            {writable && !signer.signedAt && envelope.status === "pending" && signer.signUrl && (
              <Button component="span" variant="text" size="small" onClick={() => void copy(signer.signUrl ?? "")}>
                {t("case-signature-copy-link")}
              </Button>
            )}
          </Box>
        ))}

        {envelope.lastError && (envelope.status === "failed" || envelope.status === "uncertain") && (
          <StateLine
            tone="attention"
            action={
              <Button
                variant="outlined"
                color="grey"
                size="small"
                href="https://app.zapsign.com.br"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("case-signature-open-zapsign")}
              </Button>
            }
          >
            {t("case-signature-failed-help")}
          </StateLine>
        )}
        {envelope.status === "pending" && envelope.lastError && (
          <Typography variant="body2" className="text-text-secondary">
            {t("case-signature-pending-problem")}
          </Typography>
        )}
        {envelope.endedReason && (
          <Typography variant="body2" className="text-text-secondary">
            {t("case-closed-reason", { reason: envelope.endedReason })}
          </Typography>
        )}

        <Box className="flex flex-wrap gap-2 pt-1">
          {signed && (
            <Button
              component="span"
              variant="outlined"
              color="grey"
              size="small"
              onClick={() => void open(signed.fileId)}
            >
              {t("case-signature-open-signed")}
            </Button>
          )}
          {returned && envelope.status === "received" && (
            <Button
              component="span"
              variant="outlined"
              color="grey"
              size="small"
              onClick={() => void open(returned.fileId)}
            >
              {t("case-signature-open-returned")}
            </Button>
          )}
          {writable && state.case.isTest && envelope.status === "pending" && (
            <Button
              variant="outlined"
              color="grey"
              size="small"
              disabled={action.busy}
              loading={action.pending(`simulate-${envelope.id}`)}
              loadingPosition="start"
              onClick={() => void simulate(envelope)}
            >
              {action.pending(`simulate-${envelope.id}`)
                ? sentence(words.simulate.doing)
                : t("case-signature-simulate")}
            </Button>
          )}
          {writable && envelope.method === "zapsign" && envelope.status === "pending" && (
            <Button
              variant="text"
              size="small"
              disabled={action.busy}
              loading={action.pending(`refresh-${envelope.id}`)}
              loadingPosition="start"
              onClick={() => void refresh(envelope)}
            >
              {action.pending(`refresh-${envelope.id}`) ? sentence(words.refresh.doing) : t("case-signature-refresh")}
            </Button>
          )}
          {writable &&
            envelope.method !== "zapsign" &&
            (envelope.status === "pending" || envelope.status === "received") && (
              <Button variant="contained" size="small" disabled={action.busy} onClick={() => setConfirming(envelope)}>
                {t("case-signature-confirm")}
              </Button>
            )}
          {writable && !ended && (
            <Button
              variant="text"
              color="grey"
              size="small"
              disabled={action.busy}
              onClick={() => setCancelling(envelope)}
            >
              {t("case-signature-cancel")}
            </Button>
          )}
        </Box>
      </Box>
    );
  };

  // One line per paper (the owner's canvas, 2026-11-10): what waits for the firm first, what waits for the client to
  // sign, then what ended, the latest first.
  const placeOf = (envelope: CaseEnvelope) =>
    NEEDS_PERSON.includes(envelope.status) ? "ask" : ENDED.includes(envelope.status) ? "done" : "waiting";
  const asLine = (envelope: CaseEnvelope): ItemRow => {
    const place = placeOf(envelope);
    return {
      key: envelope.id,
      icon: <NiPen size="small" />,
      tone: "accent-2",
      title: `${kindOf(envelope)} · ${t(METHOD_KEY[envelope.method])}`,
      detail: envelope.signers.map((signer) => signer.name).join(", ") || undefined,
      state: {
        tone:
          place === "ask" ? "attention" : place === "waiting" ? "waiting" : (ENDED_STATE[envelope.status] ?? "info"),
        text: statusOf(envelope),
      },
      opener: place === "ask" && writable ? t("case-rows-sig-open") : undefined,
      openLabel: t("case-rows-sig-open-label", { kind: kindOf(envelope) }),
      content: () => envelopeBody(envelope),
    };
  };
  const byPlace = (place: string) => state.envelopes.filter((envelope) => placeOf(envelope) === place);

  return (
    <CollapsibleCard
      id="case-signatures"
      title={t("case-signatures-title")}
      summary={
        state.envelopes.length === 0
          ? t("case-signatures-empty-title")
          : state.envelopes
              .slice(0, 3)
              .map((envelope) => `${kindOf(envelope)}: ${statusOf(envelope)}`)
              .join(" · ")
      }
      ask={needs ? { tone: "firm", label: statusOf(needs) } : null}
      description={t("case-signatures-body")}
      action={
        writable && state.envelopes.length > 0 ? (
          <Button variant="outlined" color="grey" size="small" onClick={() => setRequesting(true)}>
            {t("case-signatures-request")}
          </Button>
        ) : null
      }
      defaultOpen={opensOnArrival(state.case.status, "signatures", needs !== null, state.envelopes.length === 0)}
    >
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(caseErrorKey(problem))}
        </Alert>
      )}

      {state.envelopes.length === 0 && (
        <EmptyState
          titleAs="h3"
          layout="row"
          framed={false}
          illustration={<IllustrationDocumentation />}
          title={t("case-signatures-empty-title")}
          description={t("case-signatures-empty-body")}
          action={writable ? { label: t("case-signatures-request"), onClick: () => setRequesting(true) } : undefined}
        />
      )}

      {state.envelopes.length > 0 ? (
        <ItemRows
          arrival={[SECTION_ANCHOR.signatures]}
          sections={[
            { key: "ask", title: t("item-rows-ask"), ask: true, rows: byPlace("ask").map(asLine) },
            { key: "waiting", title: t("case-rows-sig-waiting"), rows: byPlace("waiting").map(asLine) },
            { key: "done", title: t("case-rows-sig-done"), rows: byPlace("done").map(asLine), shown: 3 },
          ]}
        />
      ) : null}

      {requesting && (
        <RequestDialog
          state={state}
          documents={signable}
          onClose={() => setRequesting(false)}
          onDone={() => {
            setRequesting(false);
            onChanged();
          }}
        />
      )}
      {cancelling && (
        <CancelDialog
          caseId={state.case.id}
          envelope={cancelling}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            onChanged();
          }}
        />
      )}
      {confirming && (
        <ConfirmDialog
          state={state}
          envelope={confirming}
          onClose={() => setConfirming(null)}
          onDone={() => {
            setConfirming(null);
            onChanged();
          }}
        />
      )}
    </CollapsibleCard>
  );
}

function RequestDialog({
  state,
  documents,
  onClose,
  onDone,
}: {
  state: Ready;
  documents: Ready["documents"];
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("product");
  const adults = state.parties
    .map((party) => party.person)
    .filter((person, index, all) => all.findIndex((other) => other.person_id === person.person_id) === index)
    .filter((person) => isMinorOn(person.birth_date, state.today) !== true);
  const [documentId, setDocumentId] = useState(documents[0]?.id ?? "");
  const [method, setMethod] = useState<Method>(state.zapsign ? "zapsign" : "govbr");
  const [signers, setSigners] = useState<string[]>(adults[0] ? [adults[0].person_id] : []);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field?: string | null } | null>(null);

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await requestSignature({
        caseId: state.case.id,
        documentId,
        method,
        signers,
        enotariadoUrl: method === "enotariado" ? url : null,
      });
      if (!result.ok) {
        setProblem({ code: result.code, field: result.field });
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  // By gov.br one person signs each document (each would sign the file in turn).
  const ready =
    Boolean(documentId) &&
    signers.length > 0 &&
    (method !== "govbr" || signers.length === 1) &&
    (method !== "enotariado" || url.trim().length > 0);

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="case-signature-dialog">
      <DialogHeader
        id="case-signature-dialog"
        title={t("case-signatures-request")}
        onClose={onClose}
        closeLabel={t("cases-close")}
      />
      <DialogContent>
        <Box className="flex flex-col gap-4 pt-1">
          {documents.length === 0 ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("case-signature-no-document")}
            </Alert>
          ) : (
            <TextField
              select
              fullWidth
              size="small"
              id="case-signature-document"
              label={t("case-signature-document")}
              value={documentId}
              disabled={busy}
              onChange={(event) => setDocumentId(event.target.value)}
            >
              {documents.map((document) => (
                <MenuItem key={document.id} value={document.id}>
                  {(isDocumentKind(document.kind) ? t(DOCUMENT_KIND_KEY[document.kind]) : document.kind) +
                    " · " +
                    document.name}
                </MenuItem>
              ))}
            </TextField>
          )}

          <Box>
            <FormLabel component="legend" className="mb-1">
              {t("case-signature-signers")}
            </FormLabel>
            <FormGroup>
              {adults.map((person) => (
                <FormControlLabel
                  key={person.person_id}
                  control={
                    <Checkbox
                      size="small"
                      checked={signers.includes(person.person_id)}
                      disabled={busy}
                      onChange={() =>
                        setSigners((current) =>
                          current.includes(person.person_id)
                            ? current.filter((id) => id !== person.person_id)
                            : [...current, person.person_id],
                        )
                      }
                    />
                  }
                  label={person.full_name}
                />
              ))}
            </FormGroup>
          </Box>

          <Box>
            <FormLabel component="legend" id="case-signature-method" className="mb-1">
              {t("case-signature-method")}
            </FormLabel>
            <RadioGroup
              aria-labelledby="case-signature-method"
              value={method}
              onChange={(event) => setMethod(event.target.value as Method)}
            >
              {METHODS.map((value) => (
                <FormControlLabel
                  key={value}
                  value={value}
                  disabled={busy || (value === "zapsign" && !state.zapsign)}
                  control={<Radio size="small" />}
                  label={
                    <Box className="flex flex-col pt-0.5">
                      <Typography variant="body1" component="span" className="font-semibold">
                        {t(METHOD_KEY[value])}
                      </Typography>
                      <Typography variant="body2" component="span" className="text-text-secondary">
                        {t(METHOD_HINT_KEY[value])}
                      </Typography>
                    </Box>
                  }
                  className="items-start py-1"
                />
              ))}
            </RadioGroup>
            {!state.zapsign && (
              <Typography variant="body2" className="text-text-secondary">
                {t("case-signature-zapsign-off")}{" "}
                <Link href="/settings/connections">{t("case-signature-zapsign-connect")}</Link>
              </Typography>
            )}
          </Box>

          {method === "govbr" && signers.length > 1 && (
            <Typography variant="body2" className="text-text-secondary">
              {t("case-error-single-signer")}
            </Typography>
          )}

          {method === "enotariado" && (
            <TextField
              fullWidth
              size="small"
              id="case-signature-url"
              label={t("case-signature-enotariado-url")}
              helperText={
                problem?.field === "enotariado_url"
                  ? t(caseErrorKey(problem.code))
                  : t("case-signature-enotariado-help")
              }
              error={problem?.field === "enotariado_url"}
              value={url}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
            />
          )}

          {problem && problem.field !== "enotariado_url" && (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t(caseErrorKey(problem.code))}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          {t("cases-cancel")}
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={busy || !ready}>
          {busy ? t("cases-working") : t("case-signature-send")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function CancelDialog({
  caseId,
  envelope,
  onClose,
  onDone,
}: {
  caseId: string;
  envelope: CaseEnvelope;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("product");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const explained = reason.trim().length >= 4;

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await cancelSignature(caseId, envelope.id, reason);
      if (!result.ok) setProblem(result.code);
      else onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      maxWidth="xs"
      fullWidth
      aria-labelledby="case-signature-cancel-dialog"
    >
      <DialogHeader
        id="case-signature-cancel-dialog"
        title={t("case-signature-cancel")}
        onClose={onClose}
        closeLabel={t("cases-close")}
      />
      <DialogContent>
        <Box className="flex flex-col gap-3 pt-1">
          <TextField
            fullWidth
            multiline
            minRows={2}
            size="small"
            id="case-signature-cancel-reason"
            label={t("case-stage-reason")}
            value={reason}
            disabled={busy}
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
          {busy ? t("cases-working") : t("case-signature-cancel")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ConfirmDialog({
  state,
  envelope,
  onClose,
  onDone,
}: {
  state: Ready;
  envelope: CaseEnvelope;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("product");
  // The file the client sent back for this envelope comes first; for e-Notariado, a file the firm added.
  // What the database accepts: for gov.br, the file sent back for this envelope; for e-Notariado, a
  // file the firm added that no other envelope holds or signed.
  const signedElsewhere = new Set(state.envelopes.map((other) => other.signedDocumentId).filter(Boolean));
  const candidates = state.documents.filter(
    (document) =>
      document.id !== envelope.documentId &&
      document.pdf &&
      document.status !== "rejected" &&
      !signedElsewhere.has(document.id) &&
      (envelope.method === "govbr"
        ? document.envelopeId === envelope.id
        : document.source === "firm" && (document.envelopeId === null || document.envelopeId === envelope.id)),
  );
  const [documentId, setDocumentId] = useState(candidates[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const openChosen = async () => {
    const chosen = candidates.find((document) => document.id === documentId);
    if (!chosen) return;
    setOpening(true);
    setProblem(null);
    const link = await openCaseFile(chosen.fileId);
    setOpening(false);
    if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
    else setProblem(link.code);
  };

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await confirmSignature(state.case.id, envelope.id, documentId);
      if (!result.ok) setProblem(result.code);
      else onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={busy ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="case-signature-confirm-dialog"
    >
      <DialogHeader
        id="case-signature-confirm-dialog"
        title={t("case-signature-confirm")}
        onClose={onClose}
        closeLabel={t("cases-close")}
      />
      <DialogContent>
        <Box className="flex flex-col gap-3 pt-1">
          <Typography variant="body2">
            {envelope.method === "govbr" ? t("case-signature-confirm-govbr") : t("case-signature-confirm-enotariado")}
          </Typography>
          {/* A paper an assisted minor signs beside the adult carries both gov.br signatures (0224). */}
          {envelope.method === "govbr" && envelope.signers.length > 1 ? (
            <Typography variant="body2">
              {t("case-signature-confirm-each", {
                names: envelope.signers.map((signer) => signer.name).join(", "),
              })}
            </Typography>
          ) : null}
          {candidates.length === 0 ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("case-signature-confirm-none")}
            </Alert>
          ) : (
            <TextField
              select
              fullWidth
              size="small"
              id="case-signature-confirm-document"
              label={t("case-signature-signed-file")}
              value={documentId}
              disabled={busy}
              onChange={(event) => setDocumentId(event.target.value)}
            >
              {candidates.map((document) => (
                <MenuItem key={document.id} value={document.id}>
                  {document.name}
                </MenuItem>
              ))}
            </TextField>
          )}
          {/* What the person checks, in front of them (the owner, 2026-11-12): the file and the place that validates it. */}
          <Box className="flex flex-wrap gap-2">
            {documentId ? (
              <Button
                variant="outlined"
                color="grey"
                size="small"
                disabled={busy || opening}
                loading={opening}
                onClick={() => void openChosen()}
              >
                {t("case-signature-confirm-open-file")}
              </Button>
            ) : null}
            {envelope.method === "govbr" ? (
              <Button
                variant="outlined"
                color="grey"
                size="small"
                href="https://validar.iti.gov.br"
                target="_blank"
                rel="noopener noreferrer"
              >
                {t("case-signature-confirm-open-iti")}
              </Button>
            ) : null}
          </Box>
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
        <Button variant="contained" onClick={() => void submit()} disabled={busy || !documentId}>
          {busy ? t("cases-working") : t("case-signature-confirm")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
