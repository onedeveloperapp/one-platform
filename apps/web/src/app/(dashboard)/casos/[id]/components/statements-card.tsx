"use client";

import type { CaseState, CaseStatement } from "../case-types";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";

import { Alert, Box, Button, MenuItem, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import StateLine from "@/components/product/state-line";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import { ACCOUNT_TOPIC_SHORT_KEY } from "@/lib/cases/account";
import { openCaseFile } from "@/lib/cases/actions";
import { opensOnArrival } from "@/lib/cases/sections";
import {
  addCaseStatement,
  closeAccountGaps,
  finishStatementUpload,
  removeCaseStatement,
  requestStatementChronology,
  requestStatementTranscription,
  resumeStatementWork,
  startStatementUpload,
  writeStatementText,
} from "@/lib/cases/statement-actions";
import {
  chronologyLines,
  STAGE_KEY,
  STATEMENT_AUDIO_ACCEPT,
  statementAudioMime,
  statementErrorKey,
  type StatementStage,
  statementStage,
} from "@/lib/cases/statements";
import { uploadToSignedUrl } from "@/lib/files/browser-upload";
import { isMinorOn } from "@flyee/rules/person";

type Ready = Extract<CaseState, { kind: "ready" }>;

const STAGE_TONE: Record<StatementStage, StatusTone> = {
  uploading: "neutral",
  transcribing: "info",
  transcript_waits: "attention",
  not_transcribed: "attention",
  proposing: "info",
  not_proposed: "attention",
  waiting_firm: "attention",
  waiting_client: "info",
  confirmed: "positive",
  contested: "attention",
};

const SOURCE_KEY: Record<CaseStatement["source"], string> = {
  client: "case-statement-source-client",
  firm: "case-statement-source-firm",
  whatsapp: "case-statement-source-whatsapp",
};

const MIN_TEXT = 40;

/**
 * What the client told about the trip, in their own words: an audio they
 * sent over WhatsApp or through their link, or what somebody wrote down.
 * The person who works the case comes here to bring the account in and to
 * see where its chronology stands: transcribed, proposed, waiting in the
 * firm's queue, with the client, confirmed or contested. Approving the
 * chronology happens in the approval queue; the client confirms on their
 * link. Every state has its way forward here: an audio that could not be
 * transcribed is tried again or written down, a chronology that failed, was
 * turned down, was contested or still waits for the client is asked again,
 * and a statement nobody confirmed can be removed. It is a handful of
 * accounts read one at a time, never a table.
 */
export default function StatementsCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  // Who tells an account: an adult of the case, never a child (their guardian speaks for them).
  const tellers = state.parties.filter(
    (party) => party.role === "guardian" || isMinorOn(party.person.birth_date, state.today) !== true,
  );
  const [party, setParty] = useState<string>(tellers[0]?.partyId ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // The statement whose audio a person is writing down, with what they typed; and the one being removed.
  const [writing, setWriting] = useState<string | null>(null);
  const [heard, setHeard] = useState("");
  const [removing, setRemoving] = useState<string | null>(null);
  // The statement whose missing answers a lawyer is about to go on without (0094).
  const [closing, setClosing] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const nameOf = (partyId: string | null) =>
    state.parties.find((candidate) => candidate.partyId === partyId)?.person.full_name ?? null;

  const run = async (key: string, work: () => Promise<{ ok: boolean; code: string }>, after?: () => void) => {
    setBusy(key);
    setProblem(null);
    try {
      const result = await work();
      if (!result.ok) {
        setProblem(result.code);
        return;
      }
      after?.();
      onChanged();
    } catch {
      // A request that failed on the way (the network, the server): the button comes back.
      setProblem("unavailable");
    } finally {
      setBusy(null);
    }
  };

  const sendText = () =>
    run(
      "text",
      () => addCaseStatement({ caseId: state.case.id, partyId: party || null, text }),
      () => setText(""),
    );

  const sendAudio = (file: File) =>
    run("audio", async () => {
      const mime = statementAudioMime(file);
      const started = await startStatementUpload({ name: file.name, mime, bytes: file.size });
      if (!started.ok) return started;
      const uploaded = await uploadToSignedUrl({
        storagePath: started.storagePath,
        uploadToken: started.uploadToken,
        file,
        contentType: mime,
      });
      if (!uploaded) return { ok: false, code: "not_uploaded" };
      return finishStatementUpload({ caseId: state.case.id, partyId: party || null, fileId: started.fileId });
    });

  const listen = async (fileId: string) => {
    setBusy(fileId);
    setProblem(null);
    try {
      const link = await openCaseFile(fileId);
      if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
      else setProblem(link.code);
    } catch {
      setProblem("unavailable");
    } finally {
      setBusy(null);
    }
  };

  const list = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });

  const row = (statement: CaseStatement) => {
    const stage = statementStage(statement);
    const lines = chronologyLines(statement.chronology);
    const previous = chronologyLines(statement.previousChronology);
    const expanded = open === statement.id;
    // A chronology may be asked again whenever none is being made or waits in the queue, and the client has
    // not confirmed one: it failed, was turned down, was contested, or the firm takes back what it approved.
    const mayAskAgain = stage === "not_proposed" || stage === "contested" || stage === "waiting_client";
    // The client is still asked what the account lacks, and ONE waits for the answers.
    const gapsOpen =
      statement.missingTopics.length > 0 && Boolean(statement.chronology) && statement.rounds < state.accountMaxRounds;
    return (
      <Box key={statement.id} className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
        <Box className="flex flex-wrap items-start justify-between gap-2">
          <Box className="flex min-w-0 flex-col">
            <Typography variant="body1" className="font-semibold">
              {nameOf(statement.partyId) ?? t("case-statement-unnamed")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {[
                statement.spoken ? t("case-statement-spoken") : t("case-statement-written"),
                t(SOURCE_KEY[statement.source]),
                statement.receivedLabel,
              ].join(" · ")}
            </Typography>
          </Box>
          <StatusChip tone={STAGE_TONE[stage]} label={t(STAGE_KEY[stage])} />
        </Box>

        {stage === "not_transcribed" ? (
          <Typography variant="body2" className="text-text-secondary">
            {statement.workError === "audio_too_large"
              ? t("case-statement-too-large-help")
              : t("case-statement-not-transcribed-help")}
          </Typography>
        ) : null}
        {stage === "not_proposed" ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("case-statement-not-proposed-help")}
          </Typography>
        ) : null}

        {lines.length > 0 ? (
          <Box className="flex flex-col gap-1">
            <Typography variant="body2" className="text-text-secondary">
              {t("case-statement-chronology")}
            </Typography>
            <Box component="ol" className="m-0 flex list-decimal flex-col gap-1 pl-5">
              {lines.map((line, index) => (
                <Typography component="li" variant="body1" key={`${index}-${line.slice(0, 24)}`}>
                  {line}
                </Typography>
              ))}
            </Box>
          </Box>
        ) : null}

        {statement.missingTopics.length > 0 && statement.chronology ? (
          // What the order of the facts says the account lacks, and what the client is asked on their link (0090)
          // and in the conversation (0092). While they are asked, ONE waits for the answers before the lawsuits; a
          // partner or a lawyer may go on without them (0094).
          <StateLine
            tone={gapsOpen ? "waiting" : "info"}
            action={
              writable && state.lawyer && gapsOpen && closing !== statement.id ? (
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  disabled={busy !== null}
                  onClick={() => setClosing(statement.id)}
                >
                  {t("case-statement-gaps-close")}
                </Button>
              ) : undefined
            }
          >
            {t("case-statement-gaps", {
              topics: list.format(statement.missingTopics.map((topic) => t(ACCOUNT_TOPIC_SHORT_KEY[topic]))),
            })}{" "}
            {!gapsOpen
              ? t("case-statement-gaps-done")
              : statement.askedInChat
                ? t("case-statement-gaps-asked-chat", { count: statement.questions.length })
                : t("case-statement-gaps-asked", { count: statement.questions.length })}
            {gapsOpen ? " " : null}
            {gapsOpen ? t("case-statement-gaps-wait") : null}
          </StateLine>
        ) : statement.gapsClosed.length > 0 ? (
          <StateLine tone="done">
            {t("case-statement-gaps-closed", {
              topics: list.format(statement.gapsClosed.map((topic) => t(ACCOUNT_TOPIC_SHORT_KEY[topic]))),
            })}
          </StateLine>
        ) : null}
        {closing === statement.id ? (
          <Box className="flex flex-row flex-wrap items-center gap-2 pt-1">
            <Typography variant="body2" className="text-text-primary">
              {t("case-statement-gaps-close-confirm")}
            </Typography>
            <Button
              variant="contained"
              size="small"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  statement.id,
                  () => closeAccountGaps(state.case.id, statement.id),
                  () => setClosing(null),
                )
              }
            >
              {busy === statement.id ? t("cases-working") : t("case-statement-gaps-close-yes")}
            </Button>
            <Button variant="text" color="grey" size="small" disabled={busy !== null} onClick={() => setClosing(null)}>
              {t("cases-cancel")}
            </Button>
          </Box>
        ) : null}
        {statement.clientAdded ? (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("case-statement-client-added", { answers: statement.clientAdded })}
          </Alert>
        ) : null}
        {statement.clientNote ? (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {t("case-statement-client-note", { note: statement.clientNote })}
          </Alert>
        ) : null}
        {statement.firmNote ? (
          // A proposal the firm sent back: what was asked stays in sight until a proposal that read it is decided.
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("case-statement-firm-note", { note: statement.firmNote })}
          </Alert>
        ) : null}
        {previous.length > 0 ? (
          <Box className="flex flex-col gap-1">
            <Typography variant="body2" className="text-text-secondary">
              {t("case-statement-previous")}
            </Typography>
            <Box component="ol" className="text-text-secondary m-0 flex list-decimal flex-col gap-1 pl-5">
              {previous.map((line, index) => (
                <Typography component="li" variant="body2" key={`${index}-${line.slice(0, 24)}`}>
                  {line}
                </Typography>
              ))}
            </Box>
          </Box>
        ) : null}

        {expanded && statement.transcript ? (
          <Box className="flex flex-col gap-1">
            <Typography variant="body2" className="text-text-secondary">
              {statement.spoken ? t("case-statement-transcript-spoken") : t("case-statement-transcript-written")}
            </Typography>
            <Typography variant="body1" className="text-text-primary whitespace-pre-wrap">
              {statement.transcript}
            </Typography>
          </Box>
        ) : null}

        {writing === statement.id ? (
          <Box className="flex flex-col gap-3 pt-1">
            <TextField
              fullWidth
              multiline
              minRows={3}
              maxRows={12}
              size="small"
              id={`case-statement-heard-${statement.id}`}
              label={t("case-statement-write-label")}
              helperText={t("case-statement-write-help")}
              value={heard}
              disabled={busy !== null}
              autoFocus
              slotProps={{ htmlInput: { maxLength: 20000 } }}
              onChange={(event) => setHeard(event.target.value)}
            />
            <Box className="flex flex-row flex-wrap gap-2">
              <Button
                variant="contained"
                size="small"
                disabled={busy !== null || heard.trim().length < MIN_TEXT}
                onClick={() =>
                  void run(
                    statement.id,
                    () => writeStatementText(state.case.id, statement.id, heard),
                    () => {
                      setWriting(null);
                      setHeard("");
                    },
                  )
                }
              >
                {busy === statement.id ? t("cases-working") : t("case-statement-write-save")}
              </Button>
              <Button
                variant="text"
                color="grey"
                size="small"
                disabled={busy !== null}
                onClick={() => setWriting(null)}
              >
                {t("cases-cancel")}
              </Button>
            </Box>
          </Box>
        ) : null}

        {removing === statement.id ? (
          <Box className="flex flex-row flex-wrap items-center gap-2 pt-1">
            <Typography variant="body2" className="text-text-primary">
              {t("case-statement-remove-confirm")}
            </Typography>
            <Button
              variant="contained"
              size="small"
              disabled={busy !== null}
              onClick={() =>
                void run(
                  statement.id,
                  () => removeCaseStatement(state.case.id, statement.id),
                  () => setRemoving(null),
                )
              }
            >
              {busy === statement.id ? t("cases-working") : t("case-statement-remove-yes")}
            </Button>
            <Button variant="text" color="grey" size="small" disabled={busy !== null} onClick={() => setRemoving(null)}>
              {t("cases-cancel")}
            </Button>
          </Box>
        ) : (
          <Box className="flex flex-wrap gap-2 pt-1">
            {statement.transcript ? (
              <Button
                variant="outlined"
                color="grey"
                size="small"
                aria-expanded={expanded}
                onClick={() => setOpen(expanded ? null : statement.id)}
              >
                {expanded ? t("case-statement-hide") : t("case-statement-read")}
              </Button>
            ) : null}
            {statement.audioFileId ? (
              <Button
                variant="outlined"
                color="grey"
                size="small"
                disabled={busy !== null}
                onClick={() => void listen(statement.audioFileId as string)}
              >
                {t("case-statement-listen")}
              </Button>
            ) : null}
            {writable && statement.stalled ? (
              <Button
                variant="outlined"
                color="grey"
                size="small"
                disabled={busy !== null}
                onClick={() => void run(statement.id, () => resumeStatementWork(state.case.id, statement.id))}
              >
                {busy === statement.id ? t("cases-working") : t("case-statement-resume")}
              </Button>
            ) : null}
            {stage === "waiting_firm" || stage === "transcript_waits" ? (
              <Button variant="text" color="grey" size="small" href="/aprovacoes" LinkComponent={Link}>
                {t("case-statement-open-queue")}
              </Button>
            ) : null}
            {writable && stage === "not_transcribed" && writing !== statement.id ? (
              <>
                {statement.workError !== "audio_too_large" ? (
                  <Button
                    variant="outlined"
                    color="grey"
                    size="small"
                    disabled={busy !== null}
                    onClick={() =>
                      void run(statement.id, () => requestStatementTranscription(state.case.id, statement.id))
                    }
                  >
                    {busy === statement.id ? t("cases-working") : t("case-statement-retry-transcription")}
                  </Button>
                ) : null}
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  disabled={busy !== null}
                  onClick={() => {
                    setWriting(statement.id);
                    setHeard("");
                  }}
                >
                  {t("case-statement-write")}
                </Button>
              </>
            ) : null}
            {writable && mayAskAgain ? (
              <Button
                variant="text"
                color="grey"
                size="small"
                disabled={busy !== null}
                onClick={() => void run(statement.id, () => requestStatementChronology(state.case.id, statement.id))}
              >
                {busy === statement.id
                  ? t("cases-working")
                  : stage === "waiting_client"
                    ? t("case-statement-take-back")
                    : t("case-statement-propose-again")}
              </Button>
            ) : null}
            {writable && stage !== "confirmed" ? (
              <Button
                variant="text"
                color="grey"
                size="small"
                disabled={busy !== null}
                onClick={() => setRemoving(statement.id)}
              >
                {t("case-statement-remove")}
              </Button>
            ) : null}
          </Box>
        )}
      </Box>
    );
  };

  // Where the accounts stand, and what in them waits for a person: a client who said the chronology is wrong,
  // an audio of the case's people not used yet, or work that stopped.
  const stages = state.statements.map(statementStage);
  const contested = stages.includes("contested");
  const stopped = state.statements.some(
    (statement, index) => statement.stalled || stages[index] === "not_transcribed" || stages[index] === "not_proposed",
  );
  const unused = writable ? state.audios.length : 0;
  const waitChip = contested ? (
    <StatusChip tone="attention" label={t(STAGE_KEY.contested)} />
  ) : unused > 0 ? (
    <StatusChip tone="attention" label={t("case-statements-summary-audios", { count: unused })} />
  ) : stopped ? (
    <StatusChip tone="attention" label={t("case-statements-summary-stalled")} />
  ) : null;

  return (
    <CollapsibleCard
      id="case-statements"
      title={t("case-statements-title")}
      summary={
        state.statements.length === 0
          ? t("case-statements-empty-title")
          : state.statements.length === 1
            ? [t("case-statements-summary", { count: 1 }), t(STAGE_KEY[stages[0]])].join(" · ")
            : t("case-statements-summary", { count: state.statements.length })
      }
      chip={waitChip}
      description={t("case-statements-body")}
      defaultOpen={opensOnArrival(
        state.case.status,
        "statements",
        waitChip !== null,
        state.statements.length === 0 && state.audios.length === 0,
      )}
    >
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(statementErrorKey(problem))}
        </Alert>
      )}

      {state.statements.length === 0 ? (
        <EmptyState
          titleAs="h3"
          icon={<NiMicrophone />}
          title={t("case-statements-empty-title")}
          description={t("case-statements-empty-body")}
          className="py-8"
        />
      ) : (
        <Box className="flex flex-col gap-2">{state.statements.map(row)}</Box>
      )}

      {writable && state.audios.length > 0 && (
        <Box className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
          <Typography variant="body1" className="font-semibold">
            {t("case-statements-audios-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("case-statements-audios-body")}
          </Typography>
          <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
            {state.audios.map((audio) => (
              <Box component="li" key={audio.fileId} className="flex flex-wrap items-center gap-2">
                <Typography variant="body1" className="min-w-0 flex-1">
                  {t("case-statements-audio-line", { name: audio.contactName, when: audio.receivedLabel })}
                </Typography>
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  disabled={busy !== null}
                  onClick={() => void listen(audio.fileId)}
                >
                  {t("case-statement-listen")}
                </Button>
                <Button
                  variant="contained"
                  size="small"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(audio.fileId, () =>
                      addCaseStatement({ caseId: state.case.id, partyId: audio.partyId, fileId: audio.fileId }),
                    )
                  }
                >
                  {t("case-statements-audio-use")}
                </Button>
              </Box>
            ))}
          </Box>
        </Box>
      )}

      {writable && tellers.length > 0 && (
        <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
          <Typography variant="body1" className="font-semibold">
            {t("case-statements-add")}
          </Typography>
          {tellers.length > 1 && (
            <TextField
              select
              size="small"
              className="sm:max-w-md"
              fullWidth
              id="case-statement-party"
              label={t("case-statements-who")}
              value={party}
              disabled={busy !== null}
              onChange={(event) => setParty(event.target.value)}
            >
              {tellers.map((candidate) => (
                <MenuItem key={candidate.partyId} value={candidate.partyId}>
                  {candidate.person.full_name}
                </MenuItem>
              ))}
            </TextField>
          )}
          <TextField
            fullWidth
            multiline
            minRows={3}
            maxRows={12}
            size="small"
            id="case-statement-text"
            label={t("case-statements-text")}
            helperText={t("case-statements-text-help")}
            value={text}
            disabled={busy !== null}
            slotProps={{ htmlInput: { maxLength: 20000 } }}
            onChange={(event) => setText(event.target.value)}
          />
          <input
            ref={input}
            type="file"
            hidden
            accept={STATEMENT_AUDIO_ACCEPT}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void sendAudio(file);
            }}
          />
          <Box className="flex flex-row flex-wrap gap-2">
            <Button
              variant="contained"
              size="small"
              disabled={busy !== null || text.trim().length < MIN_TEXT}
              onClick={() => void sendText()}
            >
              {busy === "text" ? t("cases-working") : t("case-statements-save-text")}
            </Button>
            <Button
              variant="outlined"
              color="grey"
              size="small"
              disabled={busy !== null}
              onClick={() => input.current?.click()}
            >
              {busy === "audio" ? t("client-documents-sending") : t("case-statements-upload-audio")}
            </Button>
          </Box>
        </Box>
      )}
    </CollapsibleCard>
  );
}
