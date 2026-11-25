"use client";

import type { CaseDraft, CaseProceeding, CaseState } from "../case-types";
import { type CaseActionWords, sentence, useCaseAction } from "./case-action";
import PieceFactsLine from "./piece-facts-line";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState, useTransition } from "react";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogContent,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import DialogHeader from "@/components/product/dialog-header";
import EmptyState from "@/components/product/empty-state";
import QuickActions, { type QuickAction } from "@/components/product/quick-actions";
import SectionTitle from "@/components/product/section-title";
import SidePanel from "@/components/product/side-panel";
import StateLine, { type StateTone } from "@/components/product/state-line";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import UsageMeter from "@/components/product/usage-meter";
import IllustrationConfigure from "@/icons/illustrations/illustration-configure";
import IllustrationDocumentation from "@/icons/illustrations/illustration-documentation";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiLoader from "@/icons/nexture/ni-loader";
import { caseLabel } from "@/lib/cases/cases";
import {
  approveCaseDraft,
  approveCaseDraftAsIs,
  cancelCaseDraft,
  previewCaseDraft,
  readCaseDraftText,
  rejectCaseDraft,
  reopenCaseDraft,
  requestCaseDraft,
  resumeCaseDraft,
  returnCaseDraft,
  saveDraftVersion,
  takeDraftSources,
  withdrawDraftRevision,
} from "@/lib/cases/draft-actions";
import {
  type CitedSource,
  COMPLETE_GAPS_REQUEST,
  DRAFT_MARK_KEY,
  DRAFT_MARKS,
  DRAFT_STATUS_KEY,
  draftBlockerKey,
  draftErrorKey,
  type DraftStatus,
  draftToShow,
  fillGaps,
  hasPersonMark,
  isDraftBlocker,
  personMarks,
  pieceGaps,
  startsLawsuit,
  unknownMarks,
} from "@/lib/cases/drafts";
import { opensOnArrival } from "@/lib/cases/sections";
import { type ChangeBlock, textChanges } from "@/lib/cases/text-changes";

type Ready = Extract<CaseState, { kind: "ready" }>;

/** The toggle of the earlier texts says what it does: shows them, or hides them once open. */
const EARLIER_TOGGLE_KEY = { closed: "draft-earlier-toggle", open: "draft-earlier-hide" } as const;

const KIND_KEY: Record<CaseProceeding["kind"], string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};

/** What ONE is doing with a text it carries, said in place of "to review" (0099, 0100). */
const ONE_REDO_KEY: Record<"asking" | "rewriting", string> = {
  asking: "draft-status-one-asking",
  rewriting: "draft-status-one-rewriting",
};

/** What ONE is doing with a text it carries, in a sentence. */
const ONE_REDO_LINE_KEY: Record<"asking" | "rewriting", string> = {
  asking: "draft-one-asking",
  rewriting: "draft-one-rewriting",
};

/** A piece's state in a word: what ONE does with it, when it carries it, else its status. */
const statusLabelKey = (draft: Pick<CaseDraft, "status" | "oneRedo">): string =>
  draft.status === "proposed" && draft.oneRedo ? ONE_REDO_KEY[draft.oneRedo] : DRAFT_STATUS_KEY[draft.status];

const STATUS_TONE: Record<DraftStatus, StatusTone> = {
  generating: "info",
  proposed: "attention",
  approved: "primary",
  issued: "positive",
  rejected: "neutral",
  failed: "danger",
  cancelled: "neutral",
};

/** Why nobody can check a citation as it is written: the text is what changes, never the library. */
const GAP_KEY: Record<NonNullable<CitedSource["gap"]>, string> = {
  no_norm: "draft-source-unreadable",
  no_issuer: "draft-source-no-issuer",
  no_year: "draft-source-no-year",
  unreadable: "draft-source-not-read",
};

/** How often the card asks again while the backend works on a draft, and once that work is late. */
/** The fewest characters that say what the AI is to change in a text. */
const REQUEST_MIN = 10;
/** What the gate answers for a text with a mark of a person left in it (`case_draft_text_blocker`). */
const MARK_LEFT = "placeholder_left";
/** How many of the texts given up or turned down before a lawsuit shows, the newest first, and their words. */
const EARLIER_SHOWN = 5;
const EARLIER_KEY: Partial<Record<DraftStatus, string>> = {
  cancelled: "draft-earlier-cancelled",
  rejected: "draft-earlier-rejected",
};

/**
 * What a lawyer typed on a draft and did not save, kept in this tab only (it goes when the tab closes): a
 * screen that went away by any path (the browser's Back, a session that had to be read again) does not take
 * the text with it, and the editor offers it back when the draft is opened again. A day at most.
 */
type Unsaved = { base: number; body: string; at: number };
const UNSAVED_KEY = (draftId: string) => `one:draft-unsaved:${draftId}`;
const UNSAVED_MS = 24 * 60 * 60 * 1000;

function readUnsaved(draftId: string): Unsaved | null {
  try {
    const kept = JSON.parse(window.sessionStorage.getItem(UNSAVED_KEY(draftId)) ?? "null") as Partial<Unsaved> | null;
    if (!kept || typeof kept.body !== "string" || !Number.isInteger(kept.base) || typeof kept.at !== "number")
      return null;
    return Date.now() - kept.at < UNSAVED_MS ? (kept as Unsaved) : null;
  } catch {
    return null;
  }
}

function keepUnsaved(draftId: string, kept: Unsaved | null): void {
  try {
    if (kept) window.sessionStorage.setItem(UNSAVED_KEY(draftId), JSON.stringify(kept));
    else window.sessionStorage.removeItem(UNSAVED_KEY(draftId));
  } catch {
    // A browser that keeps nothing: the question before leaving the editor still asks.
  }
}

/**
 * The piece of each lawsuit of the case. A lawyer comes here when the case
 * is ready to be written: to get a first text from a model of the firm (the
 * AI writes it from the model and the facts of the case, or the model is the
 * start), to correct it, to send it back to the AI with what to change, to
 * see what it cites and whether the firm's library answers for each source,
 * and to approve it, which makes it the petition of the case. The approval
 * is of the text as its document will say it, read on the screen first, and
 * it is refused while a citation is outside the library: the card says
 * which, so the way forward is one click away. One lawsuit at a time, each
 * with the one thing it needs next.
 */
export default function DraftsCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: (saved?: boolean) => void;
}) {
  const t = useTranslations("product");
  // The draft open in the editor, by its id: it stays open whatever the page reads meanwhile.
  const [editing, setEditing] = useState<string | null>(null);
  const [reading, setReading] = useState<{ draft: CaseDraft; title: string } | null>(null);
  // The initial alone: the pieces of a lawsuit the court has are the card of their own (0189).
  const drafts = state.pieces.drafts.filter((draft) => draft.pieceKind === "inicial");
  // A piece is written while its lawsuit is still to be filed: one the court already has is here only
  // when a piece was written for it.
  const lawsuits = state.proceedings.filter(
    (proceeding) => proceeding.status === "planned" || drafts.some((draft) => draft.proceedingId === proceeding.id),
  );
  // A draft the backend is working on is read again by the screen itself (its pulse, `useLiveRead` in the case's
  // view): often while the work is expected, and less often once it is late, when the card also offers to put its
  // work back; what a colleague did meanwhile shows when the person comes back to the tab.

  const titleOf = (proceeding: CaseProceeding): string =>
    [t(KIND_KEY[proceeding.kind]), proceeding.court, proceeding.comarca].filter(Boolean).join(" · ");
  const open = editing ? (drafts.find((draft) => draft.id === editing) ?? null) : null;
  const openLawsuit = open ? state.proceedings.find((proceeding) => proceeding.id === open.proceedingId) : undefined;

  // The piece each lawsuit has now, as its own block shows it, and whether one waits for a lawyer or failed.
  const pieces = lawsuits.map((proceeding) => ({
    proceeding,
    draft: draftToShow(drafts.filter((draft) => draft.proceedingId === proceeding.id)),
  }));
  const toRevise = pieces.some(({ draft }) => draft?.status === "proposed" && !draft.oneRedo);
  const oneAtWork = pieces.some(({ draft }) => draft?.status === "proposed" && draft.oneRedo !== null);
  const notWritten = pieces.some(({ draft }) => draft?.status === "failed");
  const noPiece = t("drafts-summary-none");

  return (
    <CollapsibleCard
      id="case-drafts"
      title={t("drafts-title")}
      summary={
        state.proceedings.length === 0
          ? t("drafts-empty-title")
          : lawsuits.length === 0
            ? t("drafts-filed-title")
            : pieces
                .map(
                  ({ proceeding, draft }) =>
                    `${t(KIND_KEY[proceeding.kind])}: ${draft ? t(statusLabelKey(draft)) : noPiece}`,
                )
                .join(" · ")
      }
      ask={
        notWritten
          ? { tone: "failed", label: t("draft-status-failed") }
          : toRevise
            ? { tone: "firm", label: t("draft-status-proposed") }
            : oneAtWork
              ? { tone: "working", label: t("drafts-one-at-work") }
              : null
      }
      description={t("drafts-body")}
      defaultOpen={opensOnArrival(state.case.status, "drafts", toRevise || notWritten, lawsuits.length === 0)}
    >
      {state.proceedings.length === 0 ? (
        <EmptyState
          titleAs="h3"
          layout="row"
          framed={false}
          illustration={<IllustrationDocumentation />}
          title={t("drafts-empty-title")}
          description={t("drafts-empty-body")}
        />
      ) : lawsuits.length === 0 ? (
        <EmptyState
          titleAs="h3"
          layout="row"
          framed={false}
          illustration={<IllustrationConfigure />}
          title={t("drafts-filed-title")}
          description={t("drafts-filed-body")}
        />
      ) : !state.pieces.templates.some((template) => template.documentKind === "piece") && drafts.length === 0 ? (
        <EmptyState
          titleAs="h3"
          layout="row"
          framed={false}
          illustration={<IllustrationDocumentation />}
          title={t("drafts-no-template-title")}
          description={t(state.lawyer ? "drafts-no-template-body-lawyer" : "drafts-no-template-body")}
          action={{ label: t("drafts-no-template-action"), href: "/biblioteca" }}
        />
      ) : (
        lawsuits.map((proceeding) => (
          // One lawsuit after another, a line between them: the wrapper is what follows its sibling.
          <Box
            key={proceeding.id}
            className="border-grey-100 flex flex-col gap-2 border-t pt-4 first:border-t-0 first:pt-0"
          >
            <Lawsuit
              state={state}
              proceeding={proceeding}
              title={titleOf(proceeding)}
              drafts={drafts.filter((draft) => draft.proceedingId === proceeding.id)}
              writable={writable}
              onChanged={onChanged}
              onEdit={setEditing}
              onRead={(draft) => setReading({ draft, title: titleOf(proceeding) })}
            />
            {/* The client's check of the facts of the piece (0182): the filing waits for it. */}
            <PieceFactsLine
              state={state}
              draftIds={drafts.filter((draft) => draft.proceedingId === proceeding.id).map((draft) => draft.id)}
              writable={writable}
            />
          </Box>
        ))
      )}

      {open ? (
        <DraftDialog
          state={state}
          draft={open}
          title={openLawsuit ? titleOf(openLawsuit) : ""}
          writable={writable}
          onClose={() => setEditing(null)}
          onChanged={onChanged}
        />
      ) : null}
      {reading ? (
        <DraftReader
          key={reading.draft.id}
          draft={reading.draft}
          title={reading.title}
          onClose={() => setReading(null)}
        />
      ) : null}
    </CollapsibleCard>
  );
}

/** What an action answered that keeps a person from going on, with the way forward when there is one. */
function Problem({ code, onClose }: { code: string | null; onClose: () => void }) {
  const t = useTranslations("product");
  if (!code) return null;
  return (
    <Alert
      // What keeps a piece from being approved is something missing, never something that went wrong.
      severity={isDraftBlocker(code) ? "warning" : "error"}
      className="neutral bg-background-paper/60!"
      onClose={onClose}
      closeText={t("draft-close")}
      action={
        code === "second_factor_required" ? (
          <Button color="inherit" size="small" href="/settings/security" LinkComponent={Link}>
            {t("approvals-second-factor-setup")}
          </Button>
        ) : undefined
      }
    >
      {t(draftErrorKey(code))}
    </Alert>
  );
}

/** How many of the sources a text cites the library answers for: the one ratio that says how far a piece is. */
function SourcesMeter({ sources }: { sources: readonly CitedSource[] }) {
  const t = useTranslations("product");
  const covered = sources.filter((source) => source.covered).length;
  return (
    <UsageMeter
      headline={t("draft-sources-headline", { covered, total: sources.length })}
      ariaLabel={t("draft-sources-meter-label")}
      segments={[
        { key: "covered", label: t("draft-source-covered"), value: covered, display: String(covered), tone: "primary" },
        {
          key: "missing",
          label: t("draft-source-missing"),
          value: sources.length - covered,
          display: String(sources.length - covered),
          tone: "attention",
        },
      ]}
    />
  );
}

function Lawsuit({
  state,
  proceeding,
  title,
  drafts,
  writable,
  onChanged,
  onEdit,
  onRead,
}: {
  state: Ready;
  proceeding: CaseProceeding;
  title: string;
  /** Every draft this lawsuit ever had, the latest first. */
  drafts: CaseDraft[];
  writable: boolean;
  onChanged: (saved?: boolean) => void;
  onEdit: (draftId: string) => void;
  onRead: (draft: CaseDraft) => void;
}) {
  const t = useTranslations("product");
  // One action at a time on the case: while one runs, every control waits, and the result shows before they come back.
  const action = useCaseAction("drafts");
  const pending = action.busy;
  const words = {
    ai: {
      doing: t("case-action-draft-ai-doing"),
      done: t("case-action-draft-ai-done"),
      failed: t("case-action-draft-failed"),
    },
    blank: {
      doing: t("case-action-draft-blank-doing"),
      done: t("case-action-draft-blank-done"),
      failed: t("case-action-draft-failed"),
    },
    reject: {
      doing: t("case-action-draft-reject-doing"),
      done: t("case-action-draft-reject-done"),
      failed: t("case-action-draft-failed"),
    },
    resume: {
      doing: t("case-action-draft-resume-doing"),
      done: t("case-action-draft-resume-done"),
      failed: t("case-action-draft-failed"),
    },
    withdraw: {
      doing: t("case-action-draft-withdraw-doing"),
      done: t("case-action-draft-withdraw-done"),
      failed: t("case-action-draft-failed"),
    },
    reopen: {
      doing: t("case-action-draft-reopen-doing"),
      done: t("case-action-draft-reopen-done"),
      failed: t("case-action-draft-failed"),
    },
    approve: {
      doing: t("case-action-draft-approve-doing"),
      done: t("case-action-draft-approve-done"),
      failed: t("case-action-draft-failed"),
      target: "filing",
    },
    discard: {
      doing: t("case-action-draft-discard-doing"),
      done: t("case-action-draft-discard-done"),
      failed: t("case-action-draft-failed"),
    },
  } satisfies Record<string, CaseActionWords>;
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [alreadyWorking, setAlreadyWorking] = useState(false);
  // The draft a refusal or a discard was opened on, and for a refusal the version that was read then: what a
  // refresh brings meanwhile never redirects it, and a text that changed since is not turned down unseen.
  const [rejectingOn, setRejectingOn] = useState<{ id: string; version: number } | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);
  // The draft an approval as it is was offered on, and the version offered: never another one approved unseen.
  const [approvingOn, setApprovingOn] = useState<{ id: string; version: number } | null>(null);
  const [note, setNote] = useState("");
  const [templateId, setTemplateId] = useState("");
  // The panel of another piece for this lawsuit, and the earlier texts shown under it.
  const [another, setAnother] = useState(false);
  const [showEarlier, setShowEarlier] = useState(false);

  const draft = draftToShow(drafts);
  const rejecting = draft !== null && rejectingOn?.id === draft.id;
  // The text changed since the refusal was opened: it is read again before anybody turns it down.
  const rejectStale =
    draft !== null && rejectingOn !== null && rejectingOn.id === draft.id && rejectingOn.version !== draft.version;
  const discarding = draft !== null && discardingId === draft.id;
  const approving = draft !== null && approvingOn !== null && approvingOn.id === draft.id;
  // Every text given up or turned down before keeps its words, one click away: the newest first.
  const earlier = drafts
    .filter(
      (other) =>
        other.id !== draft?.id && other.version > 0 && (other.status === "cancelled" || other.status === "rejected"),
    )
    .slice(0, EARLIER_SHOWN);
  // Only a petition's model writes the lawsuit's piece: the firm's contract and power of attorney are papers the client
  // signs, and the database refuses them here (the owner's test of 2026-11-23: the list offered them first, by name).
  const fits = state.pieces.templates.filter((template) => startsLawsuit(template, proceeding.kind));
  // The model chosen follows the list: one removed meanwhile is never the one asked for. Untouched, it is the one the
  // lawsuit's latest piece was written from, else the firm's default, else the first.
  const latestTemplate = drafts.find((one) => one.proceedingId === proceeding.id && one.templateId)?.templateId;
  const fallback =
    fits.find((template) => template.id === latestTemplate) ?? fits.find((template) => template.isDefault) ?? fits[0];
  const chosen = fits.some((template) => template.id === templateId) ? templateId : (fallback?.id ?? "");
  const caseId = state.case.id;
  const planned = proceeding.status === "planned";
  const lawyer = state.lawyer;

  const keyOf = (key: string) => `${proceeding.id}:${key}`;
  const doing = (key: keyof typeof words) => action.pending(keyOf(key));
  /** What a button of this lawsuit says: its verb while written, "Feito" once the write answered, its own name otherwise. */
  const said = (key: keyof typeof words, idle: string) => action.label(keyOf(key), sentence(words[key].doing), idle);
  const run = async (
    key: keyof typeof words,
    work: () => Promise<{ ok: boolean; code: string }>,
    after?: () => void,
  ) => {
    const refused = { now: false };
    await action.run(keyOf(key), words[key], async () => {
      setErrorCode(null);
      setAlreadyWorking(false);
      try {
        const result = await work();
        if (!result.ok) {
          setErrorCode(result.code);
          refused.now = true;
          return false;
        }
        if (result.code === "working") setAlreadyWorking(true);
        after?.();
        return true;
      } catch {
        setErrorCode("failed");
        return false;
      }
    });
    // What refused it may be what somebody else just did: the draft is read again.
    if (refused.now) onChanged(false);
  };

  const ask = (mode: "ai" | "blank") =>
    void run(
      mode,
      () => requestCaseDraft({ caseId, proceedingId: proceeding.id, templateId: chosen, mode }),
      () => setAnother(false),
    );
  const stopRejecting = () => {
    setRejectingOn(null);
    setNote("");
  };

  const status = draft?.status ?? null;
  // No work is owed and one should be: its work was given up, and a person puts it back.
  const stuck =
    draft !== null && draft.work === null && (status === "approved" || (status === "proposed" && !draft.checked));
  const late = draft !== null && (draft.slow || stuck);
  const mayAsk =
    writable && planned && (!draft || ["issued", "rejected", "failed", "cancelled"].includes(draft.status));
  // The text was sent back to the AI: it is rewriting it, or could not, and the request waits for a person.
  const revision = status === "proposed" ? (draft?.revision ?? null) : null;
  const revising = revision !== null && !revision.failed;
  // The text of the AI's that waits in the queue is the latest one: turning it down is turning this text down.
  const answer = draft?.aiAnswer ?? null;
  const rewritten = answer?.rewriting === true;
  // A rewriting a lawyer already wrote on from is no longer the text of the draft: turning it down would
  // change nothing here, so it is not offered, and the words about the queue say so.
  const answerIsText = draft !== null && (answer === null || !answer.rewriting || answer.version === draft.version);
  const mayReject =
    status === "proposed" &&
    writable &&
    lawyer &&
    draft !== null &&
    draft.aiWaits &&
    !revision &&
    answerIsText &&
    !draft.oneRedo;
  // A rewriting is put back to work by who may ask for one (while it is made the text is nobody's to edit):
  // one that could not be made, or one that waits its turn for too long.
  const mayResume =
    writable &&
    draft !== null &&
    (revision !== null ? lawyer && (revision.failed || draft.slow) : late || (status === "failed" && planned));
  const mayDiscard = writable && draft !== null && ["generating", "proposed", "failed"].includes(draft.status);
  // A partner or a lawyer approves the text as it is, without opening it, once what it cites was read and while
  // the AI rewrites nothing: the database's gate answers as for an approval from the preview.
  // ONE asks the client what the text lacks, or writes it again with the answers (0099, 0100): nothing is asked of
  // the firm meanwhile, and a lawyer who edits it takes it over.
  const oneRedo = status === "proposed" ? (draft?.oneRedo ?? null) : null;
  const mayApproveAsIs =
    status === "proposed" && writable && lawyer && draft !== null && draft.checked && !revision && !oneRedo;
  const hasText = draft !== null && draft.version > 0;

  const headingId = `lawsuit-${proceeding.id}`;
  // What is done once in a while sits in the piece's "⋯" (the owner's canvas of 2026-11-24): writing another piece
  // (a panel over the card) and discarding this one. The earlier texts open from the foot.
  const anotherOwed = mayAsk && draft !== null;
  const more: QuickAction[] = [
    ...(anotherOwed
      ? [{ key: "another", label: t("draft-another-title"), onClick: () => setAnother(true), disabled: pending }]
      : []),
    ...(mayDiscard && draft
      ? [{ key: "discard", label: t("draft-cancel"), onClick: () => setDiscardingId(draft.id), disabled: pending }]
      : []),
  ];
  const turning = <NiLoader size="medium" className="animate-spin motion-reduce:animate-none" />;
  /** One line of where the piece stands, its mark turning while ONE works. */
  const line = (tone: StateTone, text: string, working = false) => (
    <Box role={working || tone === "waiting" ? "status" : undefined}>
      <StateLine tone={tone} icon={working ? turning : undefined}>
        {text}
      </StateLine>
    </Box>
  );

  const modelChoice =
    fits.length === 0 ? (
      <StateLine
        tone="attention"
        action={
          <Button variant="text" color="grey" size="small" href="/biblioteca" LinkComponent={Link}>
            {t("drafts-no-template-action")}
          </Button>
        }
      >
        {t("draft-no-template-for-kind")}
      </StateLine>
    ) : (
      <TextField
        select
        size="small"
        label={t("draft-template-label")}
        value={chosen}
        onChange={(event) => setTemplateId(event.target.value)}
        disabled={pending}
        fullWidth
      >
        {fits.map((template) => (
          <MenuItem key={template.id} value={template.id}>
            {template.name}
          </MenuItem>
        ))}
      </TextField>
    );
  const askButtons = (primary: boolean) =>
    fits.length === 0 ? null : (
      <>
        <Button
          variant={primary ? "contained" : "outlined"}
          color={primary ? "primary" : "grey"}
          disabled={pending || !chosen}
          loading={doing("ai")}
          loadingPosition="start"
          onClick={() => ask("ai")}
        >
          {said("ai", t("draft-ask-ai"))}
        </Button>
        <Button
          variant="text"
          color="grey"
          disabled={pending || !chosen}
          loading={doing("blank")}
          loadingPosition="start"
          onClick={() => ask("blank")}
        >
          {said("blank", t("draft-ask-blank"))}
        </Button>
      </>
    );

  return (
    // A case often has two lawsuits with the same buttons: each is a region named by its lawsuit.
    <Box component="section" aria-labelledby={headingId} className="flex flex-col gap-3">
      <Box className="flex flex-wrap items-center gap-3">
        <Typography id={headingId} variant="subtitle2" component="h3" className="mb-0 min-w-0 flex-1">
          {title}
        </Typography>
        {draft ? (
          <StatusChip
            tone={status === "proposed" && oneRedo ? "info" : STATUS_TONE[draft.status]}
            label={t(statusLabelKey(draft))}
          />
        ) : null}
        <QuickActions label={t("draft-more", { lawsuit: title })} actions={more} />
      </Box>

      {/* Where the piece stands, one line each in its state's colour (2026-11-24): what is done in green, what ONE
          does turning, what asks the firm in its colour. */}
      {!planned ? line("info", t("draft-filed-note")) : null}

      {draft && status === "generating"
        ? line(
            draft.slow ? "attention" : "waiting",
            t(draft.slow ? "draft-slow" : "draft-generating-body"),
            !draft.slow,
          )
        : null}

      {draft && status === "proposed" ? (
        <Box className="flex flex-col gap-2">
          {oneRedo ? line("waiting", t(ONE_REDO_LINE_KEY[oneRedo]), true) : null}
          {line(
            oneRedo ? "info" : "attention",
            [
              t("draft-proposed-summary", { version: draft.version, template: draft.templateName }),
              draft.requestedAuto
                ? t("draft-requested-by-one", { when: draft.requestedLabel })
                : draft.requestedBy
                  ? t("draft-requested-by", { name: draft.requestedBy, when: draft.requestedLabel })
                  : t("draft-requested-at", { when: draft.requestedLabel }),
            ].join(" · "),
          )}
          {!draft.checked ? (
            line(late ? "attention" : "waiting", t(late ? "draft-check-late" : "draft-checking"), !late)
          ) : draft.sources.length === 0 ? (
            line("info", t("draft-sources-none"))
          ) : (
            <SourcesMeter sources={draft.sources} />
          )}
          {revision
            ? revision.failed
              ? line("failed", t("draft-revision-failed"))
              : line(
                  draft.slow ? "attention" : "waiting",
                  t(draft.slow ? "draft-revising-slow" : "draft-revising", {
                    name: revision.by ?? t("draft-somebody"),
                  }),
                  !draft.slow,
                )
            : draft.latest?.restored
              ? line("info", t("draft-latest-restored", { version: draft.latest.basedOn ?? draft.version }))
              : draft.latest?.author === "ai" && draft.latest.note
                ? line("info", t("draft-latest-rewritten", { name: draft.latest.askedBy ?? t("draft-somebody") }))
                : null}
          {draft.aiWaits && !revision
            ? line(
                "info",
                t(!rewritten ? "draft-ai-waits" : answerIsText ? "draft-ai-waits-rewritten" : "draft-ai-waits-edited"),
              )
            : null}
          {writable && !lawyer ? line("info", t("draft-readonly-function")) : null}
        </Box>
      ) : null}

      {draft && status === "approved" ? (
        <Box className="flex flex-col gap-2">
          {draft.approvedLabel
            ? line(
                "done",
                draft.approvedAuto
                  ? t("draft-approved-auto", { when: draft.approvedLabel })
                  : draft.approvedBy
                    ? t("draft-approved-by", { name: draft.approvedBy, when: draft.approvedLabel })
                    : t("draft-approved-at", { when: draft.approvedLabel }),
              )
            : null}
          {line(late ? "attention" : "waiting", t(late ? "draft-issue-late" : "draft-issuing"), !late)}
        </Box>
      ) : null}

      {status === "issued" ? line("done", t("draft-issued-body")) : null}
      {status === "failed" ? line("failed", t("draft-failed-body")) : null}
      {status === "rejected" ? line("info", t("draft-rejected-body")) : null}
      {draft && status === "cancelled"
        ? line("info", t(hasText ? "draft-cancelled-body" : "draft-cancelled-empty", { when: draft.updatedLabel }))
        : null}

      {alreadyWorking ? (
        <Alert
          severity="info"
          className="neutral bg-background-paper/60!"
          onClose={() => setAlreadyWorking(false)}
          closeText={t("draft-close")}
        >
          {t("draft-working-notice")}
        </Alert>
      ) : null}
      <Problem code={errorCode} onClose={() => setErrorCode(null)} />

      {rejecting && draft ? (
        <Box className="flex flex-col gap-2">
          <TextField
            size="small"
            label={t(rewritten ? "draft-reject-revision-note-label" : "draft-reject-note-label")}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 2000))}
            disabled={pending}
            multiline
            minRows={2}
            fullWidth
            autoFocus
            helperText={rewritten ? t("draft-reject-revision-help") : undefined}
          />
          {rejectStale ? (
            // What was typed stays: the person reads the text as it is now, and says so before turning it down.
            <Alert
              severity="warning"
              className="neutral bg-background-paper/60!"
              action={
                mayReject ? (
                  <Button
                    color="inherit"
                    size="small"
                    disabled={pending}
                    onClick={() => setRejectingOn({ id: draft.id, version: draft.version })}
                  >
                    {t("draft-reject-reaim", { version: draft.version })}
                  </Button>
                ) : undefined
              }
            >
              {mayReject
                ? t("draft-reject-stale", { version: draft.version })
                : t("draft-reject-gone", { version: draft.version })}
            </Alert>
          ) : null}
          <Box className="flex flex-wrap gap-2">
            <Button
              variant="contained"
              disabled={pending || note.trim().length < 3 || rejectStale}
              loading={doing("reject")}
              loadingPosition="start"
              onClick={() =>
                void run(
                  "reject",
                  () =>
                    rejectCaseDraft({
                      caseId,
                      draftId: draft.id,
                      note,
                      version: rejectingOn?.version ?? draft.version,
                    }),
                  stopRejecting,
                )
              }
            >
              {said("reject", t(rewritten ? "draft-reject-revision-confirm" : "draft-reject-confirm"))}
            </Button>
            <Button variant="text" color="grey" disabled={pending} onClick={stopRejecting}>
              {t("draft-keep")}
            </Button>
          </Box>
        </Box>
      ) : null}

      {draft && !rejecting ? (
        <Box className="flex flex-wrap gap-2">
          {status === "proposed" ? (
            // Reading a piece is for anybody of the firm, a support visit included; writing on it is a lawyer's.
            <Button variant={oneRedo ? "outlined" : "contained"} disabled={pending} onClick={() => onEdit(draft.id)}>
              {t(writable && lawyer && !revising && !oneRedo ? "draft-open" : "draft-read")}
            </Button>
          ) : null}
          {mayApproveAsIs ? (
            <Button
              variant="outlined"
              disabled={pending}
              onClick={() => {
                setErrorCode(null);
                setApprovingOn({ id: draft.id, version: draft.version });
              }}
            >
              {t("draft-approve-as-is")}
            </Button>
          ) : null}
          {mayReject ? (
            <Button
              variant="outlined"
              color="grey"
              disabled={pending}
              onClick={() => setRejectingOn({ id: draft.id, version: draft.version })}
            >
              {t(rewritten ? "draft-reject-revision" : "draft-reject")}
            </Button>
          ) : null}
          {mayResume ? (
            <Button
              variant={status === "failed" ? "contained" : "outlined"}
              color={status === "failed" ? "primary" : "grey"}
              disabled={pending}
              loading={doing("resume")}
              loadingPosition="start"
              onClick={() => void run("resume", () => resumeCaseDraft({ caseId, draftId: draft.id }))}
            >
              {said("resume", revision ? t("draft-revision-retry") : t("draft-resume"))}
            </Button>
          ) : null}
          {revision && writable && lawyer ? (
            // The lawyer wants the text back: what the AI answers of the request afterwards is nobody's.
            <Button
              variant="outlined"
              color="grey"
              disabled={pending}
              loading={doing("withdraw")}
              loadingPosition="start"
              onClick={() => void run("withdraw", () => withdrawDraftRevision({ caseId, draftId: draft.id }))}
            >
              {said("withdraw", t("draft-revision-withdraw"))}
            </Button>
          ) : null}
          {status === "approved" && late && writable && lawyer ? (
            // A text its document cannot be made from holds its lawsuit until a lawyer takes the approval back.
            <Button
              variant="outlined"
              color="grey"
              disabled={pending}
              loading={doing("reopen")}
              loadingPosition="start"
              onClick={() => void run("reopen", () => reopenCaseDraft({ caseId, draftId: draft.id }))}
            >
              {said("reopen", t("draft-reopen"))}
            </Button>
          ) : null}
          {hasText && (status === "approved" || status === "issued") ? (
            <Button variant="outlined" color="grey" disabled={pending} onClick={() => onRead(draft)}>
              {t("draft-read-approved")}
            </Button>
          ) : null}
          {hasText && (status === "rejected" || status === "cancelled") ? (
            <Button variant="outlined" color="grey" disabled={pending} onClick={() => onRead(draft)}>
              {t("draft-read")}
            </Button>
          ) : null}
          {earlier.length > 0 ? (
            <Button
              variant="text"
              color="grey"
              aria-expanded={showEarlier}
              endIcon={
                <NiChevronDownSmall
                  size="small"
                  className={showEarlier ? "rotate-180 transition-transform" : "transition-transform"}
                />
              }
              onClick={() => setShowEarlier(!showEarlier)}
            >
              {t(showEarlier ? EARLIER_TOGGLE_KEY.open : EARLIER_TOGGLE_KEY.closed, { count: earlier.length })}
            </Button>
          ) : null}
        </Box>
      ) : null}

      {earlier.length > 0 && showEarlier ? (
        <Box className="flex flex-col gap-1">
          <Typography variant="body2" className="text-text-secondary">
            {t("draft-earlier-title")}
          </Typography>
          <Box className="flex flex-wrap gap-1">
            {earlier.map((other) => (
              <Button
                key={other.id}
                variant="text"
                color="grey"
                size="small"
                disabled={pending}
                onClick={() => onRead(other)}
                className="-ml-2"
              >
                {t(EARLIER_KEY[other.status] ?? "draft-earlier-cancelled", { when: other.updatedLabel })}
              </Button>
            ))}
          </Box>
        </Box>
      ) : null}

      {mayAsk && !draft ? (
        // No piece yet: asking for it is what the lawsuit owes, in the card.
        <Box className="flex flex-col gap-2">
          {line("info", t("draft-none-line"))}
          <Box className="sm:max-w-md">{modelChoice}</Box>
          <Box className="flex flex-wrap items-center gap-2">{askButtons(true)}</Box>
        </Box>
      ) : null}

      {another && anotherOwed ? (
        // Another piece for a lawsuit that has one is the exception: a panel over the card, from its "⋯".
        <SidePanel
          onClose={() => setAnother(false)}
          closeLabel={t("draft-close")}
          title={t("draft-another-title")}
          description={title}
          busy={doing("ai") || doing("blank")}
          actions={askButtons(true)}
        >
          <Box className="flex flex-col gap-3">
            <Problem code={errorCode} onClose={() => setErrorCode(null)} />
            {modelChoice}
          </Box>
        </SidePanel>
      ) : null}

      {approving && draft && approvingOn ? (
        // Opened on this very draft and version: a refresh that shows another one closes it instead of aiming it there.
        <ConfirmActionDialog
          key={`${draft.id}:${approvingOn.version}`}
          title={t("draft-approve-as-is-title")}
          consequences={[
            t("draft-approve-as-is-does", { version: approvingOn.version }),
            t("draft-approve-as-is-petition"),
          ]}
          requireReason={false}
          confirmLabel={t("draft-approve-as-is-yes", { version: approvingOn.version })}
          cancelLabel={t("draft-approve-as-is-back")}
          busyLabel={t("draft-approve-as-is-busy")}
          onConfirm={async () => {
            // The dialog stays on until the case shows the piece approved, or says why not.
            const outcome: { message: string | null; refused: boolean } = { message: null, refused: false };
            await action.run(keyOf("approve"), words.approve, async () => {
              try {
                const result = await approveCaseDraftAsIs({ caseId, draftId: draft.id, version: approvingOn.version });
                if (result.ok) return true;
                outcome.refused = true;
                // What keeps it from being approved, or a newer version, is said on the card, where the text opens.
                if (isDraftBlocker(result.code) || result.code === "version_changed") setErrorCode(result.code);
                else outcome.message = t(draftErrorKey(result.code));
                return false;
              } catch {
                outcome.message = t("draft-error-failed");
                return false;
              }
            });
            if (outcome.refused) onChanged(false);
            return outcome.message;
          }}
          onClose={() => setApprovingOn(null)}
        />
      ) : null}

      {discarding && draft ? (
        // Opened on this very draft: a refresh that shows another one closes it instead of aiming it there.
        <ConfirmActionDialog
          key={draft.id}
          title={t("draft-cancel-title")}
          consequences={[
            t("draft-cancel-does"),
            ...(draft.aiWaits ? [rewritten ? t("draft-cancel-queue-rewritten") : t("draft-cancel-queue")] : []),
          ]}
          staysTitle={t("confirm-stays-title")}
          stays={hasText ? [t("draft-cancel-stays")] : undefined}
          requireReason={false}
          confirmLabel={t("draft-cancel-yes")}
          cancelLabel={t("draft-keep")}
          busyLabel={t("draft-cancel-busy")}
          onConfirm={async () => {
            const outcome: { message: string | null; refused: boolean } = { message: null, refused: false };
            await action.run(keyOf("discard"), words.discard, async () => {
              try {
                const result = await cancelCaseDraft({ caseId, draftId: draft.id });
                if (result.ok) return true;
                outcome.refused = true;
                outcome.message = t(draftErrorKey(result.code));
                return false;
              } catch {
                outcome.message = t("draft-error-failed");
                return false;
              }
            });
            if (outcome.refused) onChanged(false);
            return outcome.message;
          }}
          onClose={() => setDiscardingId(null)}
        />
      ) : null}
    </Box>
  );
}

type Preview = {
  text: string;
  version: number;
  hash: string;
  blocker: string | null;
  unwritable: string[];
  marks: string[];
};

/**
 * The text of a draft, where a lawyer works on it: the text itself, what the
 * AI asked them to look at, what this version cites (and what of it is
 * outside the library), how alike it is to the firm's other pieces, and how
 * it will read with the facts of the lawsuit written in. Saving is a new
 * version, written on the one that was read (a colleague's version is never
 * written over unseen). Approving happens on the text as its document will
 * say it: the screen shows it first, and the approval carries that very
 * text's mark. A lawyer who would rather say what to change than write it
 * sends the text back to the AI from here: while the AI rewrites it the text
 * is read only, and what comes back is the next version, shown beside what
 * changed from the one before. The dialog never closes over text nobody
 * saved without asking, and it stays open whatever happens to the draft
 * meanwhile, so that what was typed can always be copied.
 */
export function DraftDialog({
  state,
  draft,
  title,
  writable,
  onClose,
  onChanged,
}: {
  state: Ready;
  draft: CaseDraft;
  title: string;
  writable: boolean;
  onClose: () => void;
  onChanged: (saved?: boolean) => void;
}) {
  const t = useTranslations("product");
  const [pending, startTransition] = useTransition();
  // The version the text on screen was written on, and that version's text: what "changed" is measured against.
  const [base, setBase] = useState({ version: draft.version, body: draft.body ?? "" });
  const [body, setBody] = useState(draft.body ?? "");
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [leaving, setLeaving] = useState(false);
  // What the lawyer is asking the AI to change, and whether the box it is written in is open. The words stay
  // while the editor is open, also over a box closed and opened again: nothing typed goes with a click.
  const [request, setRequest] = useState("");
  const [asking, setAsking] = useState(false);
  // Whether the person tried to send it: what is missing in it is said from then on, never before.
  const [requestTouched, setRequestTouched] = useState(false);
  // A work the person asked to be put back that a worker already holds: said, as on the card.
  const [alreadyWorking, setAlreadyWorking] = useState(false);
  // Whether what the AI changed is in sight.
  const [showChanges, setShowChanges] = useState(true);
  // What the person answers for each mark of what the piece lacks, outside its text (2026-11-25).
  const [gapAnswers, setGapAnswers] = useState<Record<string, string>>({});
  // Whether the person is taking on the sources the library does not cover (0299).
  const [taking, setTaking] = useState(false);
  // What was typed here before and never saved, offered back once (only ever opened from a click, so the
  // tab's storage is there to read).
  const [recovered, setRecovered] = useState<Unsaved | null>(() => {
    const kept = typeof window === "undefined" ? null : readUnsaved(draft.id);
    return kept && kept.body !== (draft.body ?? "") ? kept : null;
  });
  const draftId = draft.id;
  const inReview = draft.status === "proposed";
  // The text was sent back to the AI: it is rewriting it (nobody edits meanwhile), or could not.
  const revision = inReview ? draft.revision : null;
  const revising = revision !== null && !revision.failed;
  const mayWrite = writable && state.lawyer && inReview;
  const mayEdit = mayWrite && !revising;
  const changed = body !== base.body;
  // Somebody saved another version while this one was open.
  const behind = draft.version > base.version && draft.body !== null;
  // What the preview shows is no longer the latest text, or its citations were read since: read it again.
  const previewStale = preview !== null && inReview && (draft.version !== preview.version || !draft.checked);
  const caseId = state.case.id;
  const titleId = `draft-${draft.id}`;
  const odd = unknownMarks(body);
  const stuck = inReview && !draft.checked && (draft.work === null || draft.slow);
  // What the AI changed when it rewrote the text on screen, read against the version it was written on.
  const latest = draft.latest;
  const rewrote = latest !== null && latest.author === "ai" && latest.note !== null && base.version === draft.version;
  const before = rewrote ? latest.before : null;
  const changes = useMemo(
    () => (before !== null && draft.body !== null ? textChanges(before, draft.body) : null),
    [before, draft.body],
  );
  // A mark of a person left in the text by an earlier rewriting, or written in the request: either would be
  // read as one of the marks the next rewriting is handed over under.
  const marksLeft = preview !== null && preview.marks.length > 0 ? preview.marks : personMarks(base.body);
  const markLeft = (preview !== null && preview.blocker === MARK_LEFT) || marksLeft.length > 0;
  const requestMarked = hasPersonMark(request);
  const requestShort = request.trim().length < REQUEST_MIN;
  const requestOk = !requestShort && !requestMarked;
  // The AI gives a text back whole: one longer than it does is changed by hand.
  const tooLong = base.body.length > state.pieces.maxRevisionChars;
  // A text is sent back as it is saved (what was typed and not saved would not be what the AI reads), and
  // once what it cites was read: the state a lawyer could have approved it from. Never while what was typed
  // before waits to be taken back or dropped: a request is about one text, the one on the screen.
  const mayAskAi =
    mayEdit &&
    !changed &&
    !behind &&
    recovered === null &&
    draft.checked &&
    draft.revisionsLeft > 0 &&
    !tooLong &&
    !markLeft;
  // The version on the screen is the one a request names. While its box is open nothing changes the text but
  // the person (it is read only, and a newer version waits to be loaded), so it is the version they read.
  const onScreen = preview ? preview.version : base.version;
  // Whether the text on the screen may be sent back now, whatever the words of the request.
  const textReady = mayAskAi && !previewStale;
  const maySend = requestOk && textReady;
  // What the piece lacks, said outside its text, each mark once (the owner, 2026-11-25: looking for each mark in the
  // text and writing in its place is bureaucracy): answered here, the text is completed by itself.
  const gaps = mayEdit && !preview ? pieceGaps(body) : [];
  const gapsAnswered = gaps.filter((gap) => (gapAnswers[gap.mark] ?? "").trim() !== "").length;
  // The sources the latest version cites that the library does not cover: a partner or a lawyer may take them on for
  // this very version (0299), which is the one on the screen, saved and read.
  const uncovered = draft.sources.filter((source) => !source.covered);
  const takenKeys = new Set(draft.sourcesTaken?.keys ?? []);
  const mayTake =
    mayEdit &&
    inReview &&
    draft.checked &&
    !changed &&
    !behind &&
    base.version === draft.version &&
    uncovered.length > 0;
  // A request somebody wrote and did not send is as much to lose as a text not saved, with its box open or
  // closed: nothing closes over it without asking, and the text it is about never changes unseen.
  const drafted = request.trim() !== "";

  const load = () => {
    setBase({ version: draft.version, body: draft.body ?? "" });
    setBody(draft.body ?? "");
    setPreview(null);
  };
  // With nothing typed on the older one, the newer version simply takes its place. Never under a request
  // written or being written: the text it is about does not change without the person seeing it.
  if (behind && !changed && recovered === null && !asking && !drafted) load();

  // A tab closed over text nobody saved, or over a request nobody sent, asks first, as the dialog does.
  useEffect(() => {
    if (!changed && !drafted) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [changed, drafted]);

  // What is typed is kept in the tab a moment after the last key, and let go once it is saved or given up.
  // Nothing is touched while an earlier text waits for the person to take it back or not.
  useEffect(() => {
    if (recovered !== null || !mayEdit) return;
    const timer = window.setTimeout(
      () => keepUnsaved(draftId, changed ? { base: base.version, body, at: Date.now() } : null),
      400,
    );
    return () => window.clearTimeout(timer);
  }, [recovered, mayEdit, changed, body, base.version, draftId]);

  const takeBack = () => {
    if (!recovered) return;
    // Written on the version still the latest, it is that version changed; written on an older one, it is
    // shown as such, and saving it waits until the person looked at what changed since.
    setBase(
      recovered.base === draft.version
        ? { version: draft.version, body: draft.body ?? "" }
        : { version: recovered.base, body: "" },
    );
    setBody(recovered.body);
    setPreview(null);
    setRecovered(null);
  };
  const dropRecovered = () => {
    keepUnsaved(draftId, null);
    setRecovered(null);
  };

  const refused = (code: string) => {
    setErrorCode(code);
    onChanged(false);
  };

  const save = (text: string = body) =>
    startTransition(async () => {
      setErrorCode(null);
      try {
        const result = await saveDraftVersion({ caseId, draftId: draft.id, body: text, baseVersion: base.version });
        if (!result.ok) {
          // A text too short to be a piece is said as such, never as a form with something wrong in it.
          return refused(result.code === "invalid_data" && result.field === "body" ? "body_too_short" : result.code);
        }
        // The text on screen is the version just saved: nothing is left to save, and the dialog stays open.
        setBase({ version: result.version, body: text });
        setPreview(null);
        keepUnsaved(draftId, null);
        onChanged();
      } catch {
        setErrorCode("failed");
      }
    });

  const see = () =>
    startTransition(async () => {
      setErrorCode(null);
      try {
        const result = await previewCaseDraft(draft.id);
        if (!result.ok) return refused(result.code);
        setPreview({
          text: result.text,
          version: result.version,
          hash: result.hash,
          blocker: result.blocker,
          unwritable: result.unwritable,
          marks: result.marks,
        });
      } catch {
        setErrorCode("failed");
      }
    });

  const approve = () =>
    startTransition(async () => {
      if (!preview) return;
      setErrorCode(null);
      try {
        const result = await approveCaseDraft({
          caseId,
          draftId: draft.id,
          version: preview.version,
          hash: preview.hash,
        });
        if (!result.ok) {
          // What was read is no longer what would be approved: it is read again before anybody approves.
          setPreview(null);
          return refused(result.code);
        }
        onChanged();
        onClose();
      } catch {
        setErrorCode("failed");
      }
    });

  const resume = () =>
    startTransition(async () => {
      setErrorCode(null);
      setAlreadyWorking(false);
      try {
        const result = await resumeCaseDraft({ caseId, draftId: draft.id });
        if (!result.ok) return refused(result.code);
        if (result.code === "working") setAlreadyWorking(true);
        onChanged();
      } catch {
        setErrorCode("failed");
      }
    });

  const sendBack = () => {
    // What is missing in the request is said once the person tries to send it.
    setRequestTouched(true);
    if (!maySend) return;
    startTransition(async () => {
      setErrorCode(null);
      try {
        const result = await returnCaseDraft({
          caseId,
          draftId: draft.id,
          // The version on the screen: a colleague's newer one is not sent back unseen.
          version: onScreen,
          note: request,
        });
        // Refused: the words typed stay in their box, to be sent once what refused them is put right.
        if (!result.ok) return refused(result.code);
        // The text is the AI's to rewrite now: the dialog stays open, read only, until the new version comes.
        setRequest("");
        setRequestTouched(false);
        setAsking(false);
        setPreview(null);
        setShowChanges(true);
        onChanged();
      } catch {
        setErrorCode("failed");
      }
    });
  };

  // The answers go into the text in place of their marks, every time each is written, and the text is saved: no mark
  // is looked for in it.
  const completeGaps = () => {
    const filled = fillGaps(body, gapAnswers);
    if (filled === body) return;
    setBody(filled);
    setGapAnswers({});
    save(filled);
  };

  // ONE completes what it can of the marks from the case, the client's account and the documents, as a lawyer's
  // request to rewrite the text: what nothing says stays marked, to be answered here.
  const askOneToComplete = () => {
    if (!textReady) return;
    startTransition(async () => {
      setErrorCode(null);
      try {
        const result = await returnCaseDraft({
          caseId,
          draftId: draft.id,
          version: onScreen,
          note: COMPLETE_GAPS_REQUEST,
        });
        if (!result.ok) return refused(result.code);
        setGapAnswers({});
        setPreview(null);
        setShowChanges(true);
        onChanged();
      } catch {
        setErrorCode("failed");
      }
    });
  };

  // A partner or a lawyer takes on, for the version on the screen, the sources the library does not cover (0299).
  const takeSources = async (): Promise<string | null> => {
    try {
      const result = await takeDraftSources({ caseId, draftId: draft.id, version: base.version });
      if (!result.ok) {
        // Said in the confirmation; the case is read again, since what refused it (a new version) may be there.
        onChanged(false);
        return t(draftErrorKey(result.code));
      }
      setTaking(false);
      setPreview(null);
      onChanged();
      return null;
    } catch {
      return t("draft-error-failed");
    }
  };

  const withdraw = () =>
    startTransition(async () => {
      setErrorCode(null);
      try {
        const result = await withdrawDraftRevision({ caseId, draftId: draft.id });
        if (!result.ok) return refused(result.code);
        onChanged();
      } catch {
        setErrorCode("failed");
      }
    });

  // Nothing closes the editor while a save or an approval is on its way, nor over text nobody saved, nor
  // over a request nobody sent.
  const close = () => {
    if (pending) return;
    if (changed || drafted) setLeaving(true);
    else onClose();
  };

  return (
    <Dialog open onClose={close} aria-labelledby={titleId} maxWidth="lg" fullWidth>
      {taking ? (
        <ConfirmActionDialog
          title={t("draft-sources-take-title")}
          intro={t("draft-sources-take-intro", {
            version: base.version,
            sources: uncovered.map((source) => source.label).join(" · "),
          })}
          consequences={[t("draft-sources-take-yours"), t("draft-sources-take-new-version")]}
          stays={[t("draft-sources-take-one")]}
          requireReason={false}
          confirmLabel={t("draft-sources-take-confirm")}
          busyLabel={t("draft-sources-take-busy")}
          onConfirm={takeSources}
          onClose={() => setTaking(false)}
        />
      ) : null}
      <DialogHeader
        id={titleId}
        title={t("draft-editor-title", { lawsuit: title })}
        onClose={close}
        closeLabel={t("draft-close")}
        trailing={
          <StatusChip
            tone="neutral"
            label={t("draft-version", { version: preview ? preview.version : base.version })}
          />
        }
      />
      <DialogContent className="flex flex-col gap-4">
        {recovered ? (
          <Alert
            severity="info"
            className="neutral bg-background-paper/60!"
            action={
              <Box className="flex flex-wrap gap-1">
                <Button color="inherit" size="small" onClick={takeBack}>
                  {t("draft-recover")}
                </Button>
                <Button color="inherit" size="small" onClick={dropRecovered}>
                  {t("draft-recover-drop")}
                </Button>
              </Box>
            }
          >
            {t(recovered.base === draft.version ? "draft-recover-body" : "draft-recover-older", {
              version: recovered.base,
            })}
          </Alert>
        ) : null}
        {!inReview ? (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("draft-not-in-review", { status: t(DRAFT_STATUS_KEY[draft.status]) })}
          </Alert>
        ) : !mayWrite ? (
          <Typography variant="body2" className="text-text-secondary">
            {t(writable ? "draft-readonly-function" : "draft-readonly-support")}
          </Typography>
        ) : null}

        {behind && (changed || asking || drafted) ? (
          <Alert
            severity="warning"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" onClick={load}>
                {t("draft-load-latest", { version: draft.version })}
              </Button>
            }
          >
            {changed
              ? t("draft-behind", { version: draft.version })
              : t("draft-behind-request", { version: draft.version })}
          </Alert>
        ) : null}

        {revision ? (
          <Alert
            severity={revision.failed ? "warning" : "info"}
            className="neutral bg-background-paper/60!"
            role={revision.failed ? undefined : "status"}
            action={
              mayWrite ? (
                <Box className="flex flex-wrap gap-1">
                  {revision.failed || draft.slow ? (
                    // One that could not be made, or that waits its turn for too long: tried again now.
                    <Button color="inherit" size="small" disabled={pending} onClick={resume}>
                      {t("draft-revision-retry")}
                    </Button>
                  ) : null}
                  <Button color="inherit" size="small" disabled={pending} onClick={withdraw}>
                    {t("draft-revision-withdraw")}
                  </Button>
                </Box>
              ) : undefined
            }
          >
            <Typography variant="body2" component="p" className="mb-1">
              {revision.failed
                ? t("draft-revision-failed-editor")
                : t(draft.slow ? "draft-revising-slow" : "draft-revising-editor", {
                    name: revision.by ?? t("draft-somebody"),
                    version: draft.version,
                  })}
            </Typography>
            <Typography variant="body2" component="p" className="break-words whitespace-pre-wrap">
              {revision.note}
            </Typography>
          </Alert>
        ) : null}

        {rewrote && latest && !preview ? (
          <Box component="section" aria-labelledby={`${titleId}-changes`} className="flex flex-col gap-2">
            <Box className="flex flex-wrap items-center gap-2">
              <Typography id={`${titleId}-changes`} variant="subtitle2" component="h3" className="mb-0 min-w-0 flex-1">
                {t("draft-changes-title", { version: draft.version })}
              </Typography>
              {changes && changes.changed > 0 ? (
                <Button
                  variant="text"
                  color="grey"
                  size="small"
                  aria-expanded={showChanges}
                  onClick={() => setShowChanges((shown) => !shown)}
                >
                  {t(showChanges ? "draft-changes-hide" : "draft-changes-show")}
                </Button>
              ) : null}
            </Box>
            <Typography variant="body2" className="text-text-secondary break-words whitespace-pre-wrap">
              {t("draft-changes-asked", { name: latest.askedBy ?? t("draft-somebody"), note: latest.note ?? "" })}
            </Typography>
            {changes === null ? null : changes.changed === 0 ? (
              <Typography variant="body2" className="text-text-primary">
                {changes.layout ? t("draft-changes-layout") : t("draft-changes-none")}
              </Typography>
            ) : (
              <>
                <Typography variant="body2" className="text-text-secondary">
                  {t("draft-changes-count", { count: changes.changed, version: latest.basedOn ?? 0 })}
                </Typography>
                {showChanges ? <Changes blocks={changes.blocks} /> : null}
              </>
            )}
          </Box>
        ) : null}

        {draft.notes.length > 0 && !preview ? (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            <Typography variant="subtitle2" component="h3" className="mb-1">
              {t("draft-notes-title")}
            </Typography>
            <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
              {draft.notes.map((item, index) => (
                <Typography key={index} component="li" variant="body2">
                  {item}
                </Typography>
              ))}
            </Box>
          </Alert>
        ) : null}

        {gaps.length > 0 ? (
          <Box component="section" aria-labelledby={`${titleId}-gaps`} className="flex flex-col gap-3">
            <SectionTitle
              id={`${titleId}-gaps`}
              as="h3"
              variant="subtitle2"
              title={t("draft-gaps-title")}
              description={t("draft-gaps-about")}
            />
            <StateLine tone="attention">{t("draft-gaps-lead", { count: gaps.length })}</StateLine>
            {gaps.map((gap, index) => (
              <TextField
                key={gap.mark}
                id={`${titleId}-gap-${index}`}
                label={gap.label || t("draft-gap-unnamed", { position: index + 1 })}
                value={gapAnswers[gap.mark] ?? ""}
                onChange={(event) => setGapAnswers((current) => ({ ...current, [gap.mark]: event.target.value }))}
                disabled={pending}
                multiline
                minRows={gap.label.length > 60 ? 3 : 1}
                fullWidth
                helperText={gap.times > 1 ? t("draft-gap-times", { count: gap.times }) : undefined}
              />
            ))}
            <Box className="flex flex-wrap items-center gap-2">
              <Button
                variant={gapsAnswered > 0 ? "contained" : "outlined"}
                color={gapsAnswered > 0 ? "primary" : "grey"}
                disabled={pending || gapsAnswered === 0}
                onClick={completeGaps}
              >
                {t("draft-gaps-complete")}
              </Button>
              <Button
                variant={gapsAnswered > 0 ? "outlined" : "contained"}
                color={gapsAnswered > 0 ? "grey" : "primary"}
                disabled={pending || !textReady}
                onClick={askOneToComplete}
              >
                {t("draft-gaps-ask-one")}
              </Button>
            </Box>
            {!textReady ? (
              <Typography variant="body2" className="text-text-secondary">
                {t(changed ? "draft-gaps-save-first" : "draft-gaps-one-later")}
              </Typography>
            ) : null}
          </Box>
        ) : null}

        {preview ? (
          <Box component="section" aria-labelledby={`${titleId}-preview`} className="flex flex-col gap-3">
            <Box className="flex flex-col gap-1">
              <SectionTitle
                id={`${titleId}-preview`}
                as="h3"
                variant="subtitle2"
                title={t("draft-preview-title")}
                description={t("draft-preview-about", { version: preview.version })}
              />
              <Typography variant="body2" className="text-text-secondary">
                {t("draft-preview-read")}
              </Typography>
            </Box>
            {previewStale ? (
              <Alert
                severity="warning"
                className="neutral bg-background-paper/60!"
                action={
                  <Button color="inherit" size="small" disabled={pending || !draft.checked} onClick={see}>
                    {t("draft-preview-again")}
                  </Button>
                }
              >
                {t(draft.checked ? "draft-preview-stale" : "draft-preview-checking", { version: draft.version })}
              </Alert>
            ) : preview.blocker ? (
              <Alert
                severity="warning"
                className="neutral bg-background-paper/60!"
                action={
                  // A source registered in another tab, a fact recorded in the case: what blocked may be gone.
                  <Button color="inherit" size="small" disabled={pending} onClick={see}>
                    {t("draft-preview-again")}
                  </Button>
                }
              >
                {t(draftBlockerKey(preview.blocker))}
                {preview.unwritable.length > 0 ? (
                  <Box component="span" className="block pt-1">
                    {t("draft-unwritable-list", { characters: preview.unwritable.join(" ") })}
                  </Box>
                ) : null}
                {preview.blocker === MARK_LEFT && preview.marks.length > 0 ? (
                  // As they are written in the text: the AI may have written one in a way no eye takes for a mark.
                  <Box component="span" className="block pt-1">
                    {t("draft-marks-list", { marks: preview.marks.join(" · ") })}
                  </Box>
                ) : null}
              </Alert>
            ) : null}
            <Typography variant="body1" component="div" className="break-words whitespace-pre-line">
              {preview.text}
            </Typography>
          </Box>
        ) : (
          <>
            <TextField
              label={t("draft-text-label")}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={pending && mayEdit}
              multiline
              minRows={18}
              maxRows={32}
              fullWidth
              helperText={!mayEdit ? undefined : asking ? t("draft-text-locked-request") : t("draft-editor-help")}
              // Who only reads still selects and copies the text: read only, never greyed out. So is the text
              // under a request being written: what is sent back is the text as it is saved.
              slotProps={{ htmlInput: { spellCheck: true, lang: "pt-BR", readOnly: !mayEdit || asking } }}
            />
            {mayEdit ? (
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
            ) : null}
            {odd.length > 0 ? (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {t("draft-unknown-marks", { marks: odd.map((mark) => `[[${mark}]]`).join(", ") })}
              </Alert>
            ) : null}

            {inReview ? (
              <Box component="section" aria-labelledby={`${titleId}-sources`} className="flex flex-col gap-3">
                <Typography id={`${titleId}-sources`} variant="subtitle2" component="h3" className="mb-0">
                  {t("draft-sources-title")}
                </Typography>
                {!draft.checked ? (
                  <Box className="flex flex-wrap items-center gap-2">
                    <Typography variant="body2" className="text-text-secondary" role="status">
                      {t(stuck ? "draft-check-late" : "draft-checking")}
                    </Typography>
                    {stuck && writable ? (
                      <Button variant="outlined" color="grey" size="small" disabled={pending} onClick={resume}>
                        {t("draft-resume")}
                      </Button>
                    ) : null}
                  </Box>
                ) : draft.sources.length === 0 ? (
                  <Typography variant="body2" className="text-text-secondary">
                    {t("draft-sources-none")}
                  </Typography>
                ) : (
                  <>
                    <SourcesMeter sources={draft.sources} />
                    <Box component="ul" className="m-0 flex list-none flex-col p-0">
                      {draft.sources.map((source) => (
                        <Box
                          component="li"
                          key={source.key}
                          className="border-grey-100 flex flex-wrap items-center gap-3 border-b py-2 last:border-b-0"
                        >
                          <Box className="flex min-w-0 flex-1 flex-col">
                            <Typography variant="body1" className="break-words">
                              {source.label}
                            </Typography>
                            <Typography variant="body2" className="text-text-secondary break-words">
                              {[
                                source.raw !== source.label ? t("draft-source-written", { raw: source.raw }) : null,
                                t("draft-source-times", { count: source.times }),
                                source.gap ? t(GAP_KEY[source.gap]) : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </Typography>
                          </Box>
                          <StatusChip
                            tone={source.covered ? "positive" : takenKeys.has(source.key) ? "neutral" : "attention"}
                            label={t(
                              source.covered
                                ? "draft-source-covered"
                                : takenKeys.has(source.key)
                                  ? "draft-source-taken"
                                  : "draft-source-missing",
                            )}
                          />
                          {!source.covered && source.gap === null && mayEdit ? (
                            <Button
                              variant="text"
                              color="grey"
                              size="small"
                              href={`/biblioteca?fonte=${encodeURIComponent(source.label)}`}
                              target="_blank"
                              rel="noopener"
                              aria-label={t("draft-source-register-label", { source: source.label })}
                            >
                              {t("draft-source-register")}
                            </Button>
                          ) : null}
                        </Box>
                      ))}
                    </Box>
                    {draft.sourcesTaken && uncovered.every((source) => takenKeys.has(source.key)) ? (
                      // Taken on for this version (0299): the piece goes on to its approval, the responsibility said.
                      <StateLine tone="done">
                        {t("draft-sources-taken", {
                          name: draft.sourcesTaken.by ?? t("draft-somebody"),
                          when: draft.sourcesTaken.atLabel,
                        })}
                      </StateLine>
                    ) : uncovered.length > 0 ? (
                      <StateLine
                        tone="attention"
                        action={
                          mayTake ? (
                            <Button
                              variant="outlined"
                              color="grey"
                              size="small"
                              disabled={pending}
                              onClick={() => setTaking(true)}
                            >
                              {t("draft-sources-take")}
                            </Button>
                          ) : undefined
                        }
                      >
                        {t("draft-blocker-not-verified")}
                      </StateLine>
                    ) : null}
                  </>
                )}
              </Box>
            ) : null}

            {draft.alike.length > 0 ? (
              <Box component="section" aria-labelledby={`${titleId}-alike`} className="flex flex-col gap-1">
                <Typography id={`${titleId}-alike`} variant="subtitle2" component="h3" className="mb-0">
                  {t("draft-alike-title")}
                </Typography>
                {draft.alike.map((piece) => (
                  <Typography key={piece.draftId} variant="body2" className="text-text-secondary">
                    {piece.caseSeq !== null
                      ? t("draft-alike-item", { percent: piece.percent, label: caseLabel(piece.caseSeq) })
                      : t("draft-alike-other-case", { percent: piece.percent })}
                  </Typography>
                ))}
                {draft.alike.some((piece) => piece.percent >= state.pieces.alikeAttention) ? (
                  <Typography variant="body2" className="text-text-primary">
                    {t("draft-alike-attention")}
                  </Typography>
                ) : null}
              </Box>
            ) : null}
          </>
        )}

        <Problem code={errorCode} onClose={() => setErrorCode(null)} />
        {alreadyWorking ? (
          <Alert
            severity="info"
            className="neutral bg-background-paper/60!"
            onClose={() => setAlreadyWorking(false)}
            closeText={t("draft-close")}
          >
            {t("draft-working-notice")}
          </Alert>
        ) : null}

        {asking ? (
          <Box className="flex flex-col gap-2">
            <TextField
              label={t("draft-request-label")}
              value={request}
              onChange={(event) => setRequest(event.target.value.slice(0, 2000))}
              disabled={pending}
              multiline
              minRows={3}
              fullWidth
              autoFocus
              error={requestMarked || (requestTouched && requestShort)}
              helperText={
                requestMarked
                  ? t("draft-error-request-has-mark")
                  : requestTouched && requestShort
                    ? t("draft-error-request-required")
                    : t("draft-request-help", { version: onScreen })
              }
            />
            <Box className="flex flex-wrap items-center gap-2">
              <Button variant="contained" disabled={pending || !textReady} onClick={sendBack}>
                {t("draft-request-send")}
              </Button>
              <Button variant="text" color="grey" disabled={pending} onClick={() => setAsking(false)}>
                {t("draft-request-close")}
              </Button>
              {!textReady ? (
                // The text is not one to send a request about now: said with why, never a dead button.
                <Typography variant="body2" className="text-text-secondary min-w-0 flex-1">
                  {!inReview
                    ? t("draft-request-over")
                    : revising
                      ? t("draft-request-busy")
                      : !draft.checked
                        ? t("draft-request-checking")
                        : t("draft-request-wait")}
                </Typography>
              ) : null}
            </Box>
          </Box>
        ) : null}

        <Box className="border-grey-100 flex flex-wrap items-center gap-2 border-t pt-3">
          {preview ? (
            <>
              {mayEdit ? (
                <Button
                  variant="contained"
                  disabled={pending || preview.blocker !== null || previewStale}
                  onClick={approve}
                >
                  {t("draft-approve")}
                </Button>
              ) : null}
              <Button variant="outlined" color="grey" disabled={pending} onClick={() => setPreview(null)}>
                {t("draft-back-to-text")}
              </Button>
              {mayAskAi && !asking && !previewStale ? (
                // Read as its document will say it, and not right yet: said to the AI instead of written by hand.
                // Never over a mark of a person an earlier rewriting left: the lawyer writes the words in first.
                <Button variant="outlined" color="grey" disabled={pending} onClick={() => setAsking(true)}>
                  {drafted ? t("draft-request-resume") : t("draft-request")}
                </Button>
              ) : null}
              {mayEdit ? (
                <Typography variant="body2" className="text-text-secondary min-w-0 flex-1">
                  {t(preview.blocker || previewStale ? "draft-approve-blocked" : "draft-approve-help")}
                </Typography>
              ) : null}
            </>
          ) : (
            <>
              {mayEdit ? (
                <Button
                  variant={changed ? "contained" : "outlined"}
                  color={changed ? "primary" : "grey"}
                  disabled={pending || !changed || (behind && changed)}
                  onClick={() => save()}
                >
                  {t("draft-save")}
                </Button>
              ) : null}
              {inReview && !revising ? (
                // The text is seen as its document will say it once what it cites was read: before that, the
                // preview could only say to wait. While the AI rewrites it, the text to see is the one to come.
                <Button
                  variant={changed || !mayEdit ? "outlined" : "contained"}
                  color={changed || !mayEdit ? "grey" : "primary"}
                  disabled={pending || changed || !draft.checked}
                  onClick={see}
                >
                  {t(mayEdit ? "draft-preview" : "draft-preview-reader")}
                </Button>
              ) : null}
              {mayEdit && !asking ? (
                <Button variant="outlined" color="grey" disabled={pending || !mayAskAi} onClick={() => setAsking(true)}>
                  {drafted ? t("draft-request-resume") : t("draft-request")}
                </Button>
              ) : null}
              <Typography variant="body2" className="text-text-secondary min-w-0 flex-1">
                {revising
                  ? t("draft-revising-wait")
                  : changed
                    ? t("draft-unsaved")
                    : mayEdit && recovered !== null
                      ? t("draft-request-recovered")
                      : inReview && !draft.checked
                        ? t("draft-checking")
                        : mayEdit && markLeft
                          ? [
                              t("draft-blocker-placeholder"),
                              marksLeft.length > 0 ? t("draft-marks-list", { marks: marksLeft.join(" · ") }) : null,
                            ]
                              .filter(Boolean)
                              .join(" ")
                          : mayEdit && tooLong
                            ? t("draft-error-too-long-to-rewrite")
                            : mayEdit && draft.revisionsLeft === 0
                              ? t("draft-request-no-more")
                              : mayEdit
                                ? t("draft-preview-help")
                                : ""}
              </Typography>
            </>
          )}
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
            // Given up on purpose: nothing of it is offered back later.
            keepUnsaved(draftId, null);
            onClose();
            return null;
          }}
          onClose={() => setLeaving(false)}
        />
      ) : null}
    </Dialog>
  );
}

/**
 * What the AI changed in a text it rewrote, paragraph by paragraph: the
 * paragraphs put in, the ones taken out, and the ones rewritten with what
 * went struck through and what came marked. The paragraphs that did not
 * change are counted, not repeated: the whole text is right below. What went
 * and what came are told by the mark (struck through; underlined on a tint)
 * and, for who hears the screen instead of seeing it, by a word before each
 * stretch and one after it: never by a colour alone. A paragraph put in or
 * taken out whole is named by the line above it.
 */
function Changes({ blocks }: { blocks: readonly ChangeBlock[] }) {
  const t = useTranslations("product");
  const removedWord = t("draft-changes-removed-word");
  const addedWord = t("draft-changes-added-word");
  const endWord = t("draft-changes-end-word");
  const addedTitle = t("draft-changes-added");
  const removedTitle = t("draft-changes-removed");
  return (
    <Box
      component="ol"
      aria-label={t("draft-changes-list-label")}
      className="border-grey-100 m-0 flex max-h-96 list-none flex-col gap-2 overflow-y-auto rounded-2xl border p-4"
      tabIndex={0}
    >
      {blocks.map((block, index) =>
        block.kind === "same" ? (
          <Typography component="li" key={index} variant="body2" className="text-text-secondary">
            {t("draft-changes-same", { count: block.count })}
          </Typography>
        ) : block.kind === "changed" ? (
          <Typography component="li" key={index} variant="body1" className="break-words">
            {block.parts.map((part, at) =>
              part.kind === "same" ? (
                <span key={at}>{`${part.text} `}</span>
              ) : part.kind === "removed" ? (
                <del key={at} className="text-text-secondary">
                  <span className="sr-only">{`${removedWord} `}</span>
                  {`${part.text} `}
                  <span className="sr-only">{`${endWord} `}</span>
                </del>
              ) : (
                <ins key={at} className="bg-primary-light/10 rounded-sm underline decoration-1 underline-offset-2">
                  <span className="sr-only">{`${addedWord} `}</span>
                  {`${part.text} `}
                  <span className="sr-only">{`${endWord} `}</span>
                </ins>
              ),
            )}
          </Typography>
        ) : (
          <Box component="li" key={index} className="flex flex-col gap-1">
            <Typography variant="body2" className="text-text-secondary">
              {block.kind === "added" ? addedTitle : removedTitle}
            </Typography>
            <Typography
              variant="body1"
              component={block.kind === "added" ? "ins" : "del"}
              className={
                block.kind === "added"
                  ? "bg-primary-light/10 rounded-sm break-words whitespace-pre-line no-underline"
                  : "text-text-secondary break-words whitespace-pre-line"
              }
            >
              {block.text}
            </Typography>
          </Box>
        ),
      )}
    </Box>
  );
}

/**
 * The text of a draft nobody edits anymore, read when a person opens it:
 * what a piece says as it was approved, or the last text of a draft that
 * was given up or turned down, kept so that what was written is not lost
 * with it.
 */
export function DraftReader({ draft, title, onClose }: { draft: CaseDraft; title: string; onClose: () => void }) {
  const t = useTranslations("product");
  const [read, setRead] = useState<{ text: string; version: number } | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const draftId = draft.id;
  const approved = draft.status === "approved" || draft.status === "issued";
  const titleId = `draft-reader-${draft.id}`;

  useEffect(() => {
    let open = true;
    readCaseDraftText(draftId)
      .then((result) => {
        if (!open) return;
        if (result.ok) setRead({ text: result.text, version: result.version });
        else setErrorCode(result.code);
      })
      .catch(() => {
        if (open) setErrorCode("failed");
      });
    return () => {
      open = false;
    };
  }, [draftId]);

  return (
    <Dialog open onClose={onClose} aria-labelledby={titleId} maxWidth="lg" fullWidth>
      <DialogHeader
        id={titleId}
        title={t("draft-editor-title", { lawsuit: title })}
        onClose={onClose}
        closeLabel={t("draft-close")}
        trailing={
          <>
            <StatusChip tone={STATUS_TONE[draft.status]} label={t(DRAFT_STATUS_KEY[draft.status])} />
            {read ? <StatusChip tone="neutral" label={t("draft-version", { version: read.version })} /> : null}
          </>
        }
      />
      <DialogContent className="flex flex-col gap-4">
        {errorCode ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t(draftErrorKey(errorCode))}
          </Alert>
        ) : read === null ? (
          <Box className="flex justify-center py-10">
            <CircularProgress aria-label={t("draft-reader-loading")} />
          </Box>
        ) : (
          <>
            <Typography variant="body2" className="text-text-secondary">
              {t(approved ? "draft-reader-approved" : "draft-reader-kept")}
            </Typography>
            <Typography variant="body1" component="div" className="break-words whitespace-pre-line">
              {read.text}
            </Typography>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
