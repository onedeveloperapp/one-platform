"use client";

import type { CaseState } from "../case-types";
import { DraftDialog } from "./drafts-card";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Alert, Box, Button, MenuItem, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import QuickActions from "@/components/product/quick-actions";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import IllustrationDocumentation from "@/icons/illustrations/illustration-documentation";
import NiDocument from "@/icons/nexture/ni-document-full";
import { openCaseFile, startCaseUpload } from "@/lib/cases/actions";
import type { CaseDraft } from "@/lib/cases/draft-facts";
import { attachDefense, decidePiece, recordPieceFiled, requestPiece } from "@/lib/cases/piece-actions";
import { PIECE_BLOCKER_KEY, pieceLine } from "@/lib/cases/pieces";
import { opensOnArrival } from "@/lib/cases/sections";
import { mimeOf, uploadToSignedUrl } from "@/lib/files/browser-upload";
import { formatCnj } from "@flyee/rules/cnj";

type Ready = Extract<CaseState, { kind: "ready" }>;

const RECOMMEND_KEY: Record<"file" | "hold", string> = {
  file: "pieces-recommend-file",
  hold: "pieces-recommend-hold",
};
const DECIDE_KEY: Record<"file" | "hold", { title: string; consequence: string; label: string }> = {
  file: {
    title: "pieces-decide-file-title",
    consequence: "pieces-decide-file-consequence",
    label: "pieces-decide-file",
  },
  hold: {
    title: "pieces-decide-hold-title",
    consequence: "pieces-decide-hold-consequence",
    label: "pieces-decide-hold",
  },
};
const problemKey = (code: string) => (code === "second_factor" ? "pieces-error-factor" : "pieces-error");
const askProblemKey = (code: string) => (code === "draft_in_course" ? "pieces-ask-in-course" : "pieces-error");

/**
 * The pieces of a lawsuit the court has (migration 0189): each of its kind, written by ONE from what asked for it
 * (a publication, a condemnation's next step, a person), with ONE's recommendation to file it or not. A partner or a
 * lawyer reviews the text in the piece's editor, decides with the second factor, and ONE files what was decided
 * through the court's channel where it can; otherwise the lawyer files it in the court's system and says so. A
 * réplica waits for the airline's defence, sent here.
 */
export default function IntermediatePiecesCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const filed = state.proceedings.filter((proceeding) => proceeding.status === "filed" && proceeding.cnj);
  const pieces = state.pieces.drafts.filter((draft) => draft.pieceKind !== "inicial");
  const kindName = new Map(state.pieces.pieceKinds.map((kind) => [kind.slug, kind.name]));
  const [editing, setEditing] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [deciding, setDeciding] = useState<{ draft: CaseDraft; decision: "file" | "hold" } | null>(null);
  const [recording, setRecording] = useState<CaseDraft | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const lawyer = state.lawyer && !state.supportVisit;

  if (filed.length === 0 && pieces.length === 0) return null;
  const open = editing ? (pieces.find((draft) => draft.id === editing) ?? null) : null;
  const lines = pieces.map((draft) => ({ draft, line: pieceLine(draft, state.pieces.pieceFilings[draft.id]) }));
  const asks = lines.some(({ line }) => line.tone === "attention");
  const failed = lines.some(({ line }) => line.tone === "failed");
  const lawsuitOf = (draft: CaseDraft) => state.proceedings.find((proceeding) => proceeding.id === draft.proceedingId);
  const titleOf = (draft: CaseDraft) => {
    const lawsuit = lawsuitOf(draft);
    return [kindName.get(draft.pieceKind) ?? draft.templateName, lawsuit?.cnj ? formatCnj(lawsuit.cnj) : null]
      .filter(Boolean)
      .join(" · ");
  };

  const run = async (work: () => Promise<{ ok: boolean; code?: string }>): Promise<string | null> => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await work();
      if (!result.ok) {
        setProblem(result.code ?? "failed");
        return result.code ?? "failed";
      }
      onChanged();
      return null;
    } catch {
      setProblem("failed");
      return "failed";
    } finally {
      setBusy(false);
    }
  };

  const sendDefense = async (file: File) => {
    await run(async () => {
      const mime = mimeOf(file);
      const started = await startCaseUpload({ name: file.name, mime, bytes: file.size });
      if (!started.ok) return started;
      const uploaded = await uploadToSignedUrl({
        storagePath: started.storagePath,
        uploadToken: started.uploadToken,
        file,
        contentType: mime,
      });
      if (!uploaded) return { ok: false, code: "not_uploaded" };
      return attachDefense(state.case.id, started.fileId);
    });
  };

  const openFile = async (fileId: string) => {
    const link = await openCaseFile(fileId);
    if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
    else setProblem(link.code);
  };

  const waitsDefense = pieces.some((draft) => draft.piece?.waitsFor === "defense" && draft.status === "generating");

  return (
    <CollapsibleCard
      id="case-pieces"
      title={t("pieces-title")}
      summary={pieces.length === 0 ? t("pieces-summary-none") : t("pieces-summary", { count: pieces.length })}
      chip={
        failed ? (
          <StatusChip tone="danger" label={t("pieces-chip-failed")} />
        ) : asks ? (
          <StatusChip tone="attention" label={t("pieces-chip-asks")} />
        ) : null
      }
      description={t("pieces-body")}
      defaultOpen={opensOnArrival(state.case.status, "pieces", asks || failed, pieces.length === 0)}
    >
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(problemKey(problem))}
        </Alert>
      ) : null}
      {pieces.length === 0 ? (
        <EmptyState
          titleAs="h3"
          layout="row"
          framed={false}
          illustration={<IllustrationDocumentation />}
          title={t("pieces-empty-title")}
          description={t("pieces-empty-body")}
          action={
            writable && !state.supportVisit ? { label: t("pieces-ask"), onClick: () => setAsking(true) } : undefined
          }
        />
      ) : (
        <Box className="flex flex-col gap-3">
          {lines.map(({ draft, line }) => (
            <Box key={draft.id} className="flex flex-col gap-1">
              <Typography variant="subtitle2" component="h3">
                {titleOf(draft)}
              </Typography>
              <StateLine
                tone={line.tone}
                action={
                  <QuickActions
                    label={t("pieces-actions")}
                    actions={[
                      ...(draft.status === "proposed" && writable
                        ? [{ key: "review", label: t("pieces-review"), onClick: () => setEditing(draft.id) }]
                        : []),
                      ...(lawyer && writable && draft.piece?.decision === null && draft.status !== "cancelled"
                        ? [
                            {
                              key: "file",
                              label: t("pieces-decide-file"),
                              disabled: busy,
                              onClick: () => setDeciding({ draft, decision: "file" }),
                            },
                            {
                              key: "hold",
                              label: t("pieces-decide-hold"),
                              disabled: busy,
                              onClick: () => setDeciding({ draft, decision: "hold" }),
                            },
                          ]
                        : []),
                      ...(draft.status === "issued" && draft.documentId
                        ? [{ key: "pdf", label: t("pieces-open-pdf"), onClick: () => void openPieceDocument(draft) }]
                        : []),
                      ...(draft.piece?.receiptFileId
                        ? [
                            {
                              key: "receipt",
                              label: t("pieces-open-receipt"),
                              onClick: () => void openFile(draft.piece?.receiptFileId ?? ""),
                            },
                          ]
                        : []),
                      ...(writable && line.lawyerFiles
                        ? [{ key: "filed", label: t("pieces-record-filed"), onClick: () => setRecording(draft) }]
                        : []),
                    ]}
                  />
                }
              >
                {t(line.key, line.values)}
              </StateLine>
              {draft.piece?.recommendation && draft.piece.decision === null && draft.status !== "cancelled" ? (
                <StateLine tone="info">
                  {t(RECOMMEND_KEY[draft.piece.recommendation], {
                    reason: draft.piece.recommendationReason ?? t("pieces-recommend-asked"),
                  })}
                </StateLine>
              ) : null}
              {draft.piece?.decision === "hold" && draft.piece.decisionReason ? (
                <StateLine tone="info">{t("pieces-held-next", { next: draft.piece.decisionReason })}</StateLine>
              ) : null}
              {draft.piece?.filingMessage && draft.piece.filingStatus !== "filed" ? (
                <Typography variant="caption" className="text-text-secondary">
                  {t("pieces-court-said", { message: draft.piece.filingMessage })}
                </Typography>
              ) : null}
            </Box>
          ))}
          {writable && !state.supportVisit ? (
            <Box className="flex flex-wrap gap-2">
              {waitsDefense ? (
                <Button variant="contained" size="small" disabled={busy} onClick={() => fileInput.current?.click()}>
                  {t("pieces-send-defense")}
                </Button>
              ) : null}
              {filed.length > 0 ? (
                <Button variant="text" size="small" disabled={busy} onClick={() => setAsking(true)}>
                  {t("pieces-ask")}
                </Button>
              ) : null}
            </Box>
          ) : null}
          <Typography variant="caption" className="text-text-secondary">
            {t("pieces-may-err")}
          </Typography>
        </Box>
      )}
      <input
        ref={fileInput}
        type="file"
        hidden
        accept="application/pdf"
        aria-label={t("pieces-send-defense")}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void sendDefense(file);
        }}
      />

      {open ? (
        <DraftDialog
          state={state}
          draft={open}
          title={titleOf(open)}
          writable={writable}
          onClose={() => setEditing(null)}
          onChanged={onChanged}
        />
      ) : null}
      {asking ? (
        <AskPiece
          state={state}
          onClose={() => setAsking(false)}
          onAsked={() => {
            setAsking(false);
            onChanged();
          }}
        />
      ) : null}
      {deciding ? (
        <ConfirmActionDialog
          title={t(DECIDE_KEY[deciding.decision].title)}
          consequences={[t(DECIDE_KEY[deciding.decision].consequence), t("pieces-second-factor")]}
          requireReason={deciding.decision === "hold"}
          reasonLabel={t("pieces-hold-reason")}
          reasonMinLength={3}
          confirmLabel={t(DECIDE_KEY[deciding.decision].label)}
          cancelLabel={t("cases-cancel")}
          busyLabel={t("cases-working")}
          onConfirm={async (reason) => {
            const refused = await run(() => decidePiece(state.case.id, deciding.draft.id, deciding.decision, reason));
            return refused ? t(problemKey(refused)) : null;
          }}
          onClose={() => setDeciding(null)}
        />
      ) : null}
      {recording ? (
        <RecordFiled
          caseId={state.case.id}
          draft={recording}
          onClose={() => setRecording(null)}
          onDone={() => {
            setRecording(null);
            onChanged();
          }}
        />
      ) : null}
    </CollapsibleCard>
  );

  async function openPieceDocument(draft: CaseDraft) {
    const document = state.documents.find((item) => item.id === draft.documentId);
    if (document?.fileId) await openFile(document.fileId);
  }
}

/** A person asks for a piece of a lawsuit the court has: the lawsuit and the kind. */
function AskPiece({ state, onClose, onAsked }: { state: Ready; onClose: () => void; onAsked: () => void }) {
  const t = useTranslations("product");
  const filed = state.proceedings.filter((proceeding) => proceeding.status === "filed" && proceeding.cnj);
  const [lawsuit, setLawsuit] = useState(filed[0]?.id ?? "");
  const [kind, setKind] = useState(state.pieces.pieceKinds[0]?.slug ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    if (!lawsuit || !kind) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await requestPiece(state.case.id, lawsuit, kind);
      if (result.ok) onAsked();
      else setProblem(result.code);
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("cases-cancel")}
      title={t("pieces-ask-title")}
      description={t("pieces-ask-intro")}
      icon={<NiDocument size="medium" />}
      busy={busy}
      onSubmit={() => void submit()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || !lawsuit || !kind}>
            {t("pieces-ask-submit")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("cases-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-3">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t(askProblemKey(problem))}
          </Alert>
        ) : null}
        <TextField
          select
          fullWidth
          size="small"
          id="piece-lawsuit"
          label={t("pieces-ask-lawsuit")}
          value={lawsuit}
          onChange={(event) => setLawsuit(event.target.value)}
        >
          {filed.map((proceeding) => (
            <MenuItem key={proceeding.id} value={proceeding.id}>
              {formatCnj(proceeding.cnj ?? "")}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          fullWidth
          size="small"
          id="piece-kind"
          label={t("pieces-ask-kind")}
          value={kind}
          onChange={(event) => setKind(event.target.value)}
        >
          {state.pieces.pieceKinds.map((item) => (
            <MenuItem key={item.slug} value={item.slug}>
              {item.name}
            </MenuItem>
          ))}
        </TextField>
      </Box>
    </SidePanel>
  );
}

/** A lawyer says they filed the piece in the court's system: the protocol and the day. */
function RecordFiled({
  caseId,
  draft,
  onClose,
  onDone,
}: {
  caseId: string;
  draft: CaseDraft;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("product");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const [protocol, setProtocol] = useState("");
  const [day, setDay] = useState(today);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await recordPieceFiled(caseId, draft.id, protocol, day);
      if (result.ok) onDone();
      else setProblem(result.code);
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("cases-cancel")}
      title={t("pieces-filed-title")}
      description={t("pieces-filed-intro")}
      icon={<NiDocument size="medium" />}
      busy={busy}
      onSubmit={() => void submit()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || !day}>
            {t("pieces-filed-submit")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("cases-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-3">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t("pieces-error")}
          </Alert>
        ) : null}
        <TextField
          fullWidth
          size="small"
          id="piece-protocol"
          label={t("pieces-filed-protocol")}
          value={protocol}
          onChange={(event) => setProtocol(event.target.value.slice(0, 120))}
        />
        <TextField
          fullWidth
          size="small"
          type="date"
          id="piece-filed-on"
          label={t("pieces-filed-day")}
          value={day}
          slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: today } }}
          onChange={(event) => setDay(event.target.value)}
        />
      </Box>
    </SidePanel>
  );
}

export { PIECE_BLOCKER_KEY };
