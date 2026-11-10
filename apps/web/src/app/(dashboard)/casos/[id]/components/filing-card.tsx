"use client";

import type { CaseFiling, CaseProceeding, CaseState } from "../case-types";
import CourtSystem from "./court-system";
import FilingByOne, { filedWithoutNumber, oneFilesIt } from "./filing-by-one";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Checkbox, FormControlLabel, Grid, MenuItem, TextField, Typography } from "@mui/material";

import DocumentSlot, { type SlotState } from "@/components/cases/document-slot";
import CollapsibleCard from "@/components/product/collapsible-card";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import StateLine from "@/components/product/state-line";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiScale from "@/icons/nexture/ni-scale";
import { caseErrorKey, DOCUMENT_KIND_KEY, isDocumentKind } from "@/lib/cases/cases";
import { prefillErrorKey, type ReceiptReading, receiptReadingOf } from "@/lib/cases/document-prefill";
import {
  currentFiling,
  defaultFilingDocuments,
  DESCRIBES_FILES,
  fileDescription,
  FILING_LABEL,
  filingErrorKey,
  type FilingFiles,
  filingOutdated,
  filingProblemKey,
  filingStepsOf,
  PACKAGE_STATUS_KEY,
  type PackageStatus,
  sizeLabel,
} from "@/lib/cases/filing";
import {
  attachFilingReceipt,
  cancelFilingPackage,
  openFilingFile,
  openFilingReceipt,
  requestFilingByOne,
  requestFilingPackage,
  requestPackageSignature,
  retryFilingByOne,
} from "@/lib/cases/filing-actions";
import { dropUnsaved, sendForReading } from "@/lib/cases/prefill-browser";
import { opensOnArrival } from "@/lib/cases/sections";
import { signatureErrorKey, signatureErrorSaid } from "@/lib/psc/signature";
import { filingKindOf } from "@flyee/courts/filing";
import { formatCnj, isValidCnj } from "@flyee/rules/cnj";
import { formatDayBr } from "@flyee/rules/person";

type Ready = Extract<CaseState, { kind: "ready" }>;

const KIND_KEY: Record<CaseProceeding["kind"], string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};

const SYSTEM_KEY: Record<string, string> = {
  projudi: "case-system-projudi",
  eproc: "case-system-eproc",
  pje: "case-system-pje",
  esaj: "case-system-esaj",
  outro: "case-system-outro",
};

const STATUS_TONE: Record<PackageStatus, StatusTone> = {
  requested: "info",
  ready: "attention",
  failed: "danger",
  filed: "positive",
  cancelled: "neutral",
};

/**
 * The filing of each lawsuit of the case. Somebody comes here when the case
 * is ready to go to court: to get the package built (the petition and the
 * documents in the order of a filing, named, cut under the limit of the
 * court's system), to download its files in that order while filing in the
 * court's own system, and to attach the receipt, which marks the lawsuit as
 * filed. ONE files nothing: the lawyer does, with their own login. One
 * lawsuit at a time, each with the one thing it needs next.
 */
export default function FilingCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const lawsuits = state.proceedings.filter((proceeding) => proceeding.status !== "closed");
  // A package being built or signed is read again by the screen itself (its pulse, `useLiveRead` in the case's
  // view), however long it takes: the person does not have to ask. A request the person just made reads it again at
  // once (`onChanged`), and makes the screen ask often for a while.
  const restartPolling = onChanged;

  // The package each lawsuit has now, and whether one is ready to be filed or could not be built.
  const packages = lawsuits.map((proceeding) => ({ proceeding, filing: currentFiling(state.filings, proceeding) }));
  // Ready for the lawyer only once nothing of ONE's is left on it: a package ONE still signs, or whose signature
  // waits or failed, is not yet to be filed (the top of the case says what it waits for).
  const readyToFile = packages.some(
    ({ filing }) =>
      filing?.status === "ready" &&
      !filing.blocker &&
      !(filing.signature.takesSigned && filing.signature.status !== null && filing.signature.status !== "signed"),
  );
  const notBuilt = packages.some(({ filing }) => filing?.status === "failed");
  // A lawsuit of the person's whose files ONE will sign in the cloud waits on their authorization before its package
  // exists (0102): the card opens for them, and says it on that lawsuit.
  const authorizeAhead =
    state.lawyer &&
    packages.some(
      ({ proceeding, filing }) =>
        (!filing || filing.status === "requested") &&
        state.signatureAhead.some((ahead) => ahead.proceedingId === proceeding.id && ahead.viewerSigns),
    );
  const noPackage = t("filing-summary-none");

  return (
    <CollapsibleCard
      id="case-filing"
      title={t("filing-title")}
      summary={
        lawsuits.length === 0
          ? t("filing-empty-title")
          : packages
              .map(
                ({ proceeding, filing }) =>
                  `${t(KIND_KEY[proceeding.kind])}: ${filing ? t(PACKAGE_STATUS_KEY[filing.status]) : noPackage}`,
              )
              .join(" · ")
      }
      chip={
        notBuilt ? (
          <StatusChip tone="danger" label={t("filing-status-failed")} />
        ) : readyToFile ? (
          <StatusChip tone="attention" label={t("filing-status-ready")} />
        ) : authorizeAhead ? (
          <StatusChip tone="attention" label={t("filing-chip-authorize")} />
        ) : null
      }
      description={t("filing-body")}
      defaultOpen={opensOnArrival(
        state.case.status,
        "filing",
        readyToFile || notBuilt || authorizeAhead,
        lawsuits.length === 0,
      )}
    >
      {lawsuits.length === 0 ? (
        <EmptyState
          icon={<NiScale />}
          titleAs="h3"
          title={t("filing-empty-title")}
          description={t("filing-empty-body")}
          className="py-8"
        />
      ) : (
        lawsuits.map((proceeding) => (
          <Lawsuit
            key={proceeding.id}
            state={state}
            proceeding={proceeding}
            // The package that means something for this lawsuit now: the one in course, or the one filed.
            filing={currentFiling(state.filings, proceeding)}
            writable={writable}
            onChanged={onChanged}
            onStarted={restartPolling}
          />
        ))
      )}
    </CollapsibleCard>
  );
}

/** A request for the signature refused because the case changed since it was read: the card reads it again. */
const SIGNATURE_STALE = new Set([
  "no_signature",
  "not_a_signer",
  "not_built",
  "system_signs",
  "package_outdated",
  "family_split_unchosen",
  "civil_court_unanswered",
  "power_of_attorney_unsigned",
  "residence_relation_missing",
  "residence_address_conflict",
  "residence_declaration_unsigned",
  "free_justice_unanswered",
  "free_justice_unsigned",
  "system_unapproved",
  "system_refused",
]);

function Lawsuit({
  state,
  proceeding,
  filing,
  writable,
  onChanged,
  onStarted,
}: {
  state: Ready;
  proceeding: CaseProceeding;
  filing: CaseFiling | null;
  writable: boolean;
  onChanged: () => void;
  /** A package asked for or a signature asked: the card asks again by itself for a while. */
  onStarted: () => void;
}) {
  const t = useTranslations("product");
  const accepted = state.documents.filter((document) => document.status === "accepted");
  const petitions = accepted.filter(
    (document) => document.kind === "petition" && (document.pdf || document.normalizedFileId),
  );
  const others = accepted.filter((document) => document.kind !== "petition");

  // What the form proposes follows the case as it is now (the newest petition accepted, every accepted
  // document that goes by default), also when another package is asked for: a corrected petition or a
  // document accepted since is in it. Once the person chooses, the choice is theirs.
  const [pickedPetition, setPickedPetition] = useState<string | null>(null);
  const [pickedDocuments, setPickedDocuments] = useState<string[] | null>(null);
  const isPetition = (id: string | null | undefined) => petitions.some((document) => document.id === id);
  const petition = isPetition(pickedPetition) ? (pickedPetition as string) : (petitions.at(-1)?.id ?? "");
  const chosen = (pickedDocuments ?? defaultFilingDocuments(state.documents)).filter((id) =>
    others.some((document) => document.id === id),
  );
  // Asking for another package brings the form back over the one there is.
  const [again, setAgain] = useState(false);
  // Cancelling a package is said before it is done: its files go, and ONE asks for no other by itself.
  const [cancelling, setCancelling] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // Which action a problem answers: one of the signature is said beside it.
  const [problemFor, setProblemFor] = useState<string | null>(null);

  const [cnj, setCnj] = useState("");
  const [filedOn, setFiledOn] = useState(state.today);
  // The receipt is sent first and ONE reads the lawsuit's number and the day into the fields (0085); the lawyer
  // confirms them. The file is kept also when ONE could not read it: the lawyer then types what it says.
  const [receipt, setReceipt] = useState<{ fileId: string | null; name: string } | null>(null);
  const [receiptSlot, setReceiptSlot] = useState<SlotState>({ kind: "empty" });
  const [receiptRead, setReceiptRead] = useState<ReceiptReading | null>(null);

  // What a court's system asks of each file, beyond its name: the type the lawyer picks there, and in a
  // system that asks for one, its description (0036).
  const courtSystem = filing
    ? (state.courtSystems.find(
        (row) => row.court === filing.court && row.kind === proceeding.kind && row.system === filing.system,
      ) ?? null)
    : null;
  const typedSystem = filing ? filing.system === "eproc" || filing.system === "pje" : false;
  const fileHints = (documentId: string | null, part: number, parts: number): string[] => {
    const document = state.documents.find((candidate) => candidate.id === documentId);
    if (!filing || !document) return [];
    const kind = filingKindOf(document.kind);
    const label = FILING_LABEL[kind];
    const known = courtSystem?.fileTypes[kind];
    const person = state.parties.find((party) => party.partyId === document.partyId)?.person.full_name ?? null;
    const description = `${fileDescription(label, person)}${parts > 1 ? ` (${part}/${parts})` : ""}`;
    return [
      known ? t("filing-file-type", { type: known }) : typedSystem ? t("filing-file-type-pick", { label }) : null,
      DESCRIBES_FILES.has(filing.system) ? t("filing-file-description", { description }) : null,
    ].filter((hint): hint is string => hint !== null);
  };

  const documentWords = (documentId: string | null): string => {
    const document = state.documents.find((candidate) => candidate.id === documentId);
    if (!document) return t("filing-document-gone");
    const person = state.parties.find((party) => party.partyId === document.partyId)?.person.full_name;
    return [isDocumentKind(document.kind) ? t(DOCUMENT_KIND_KEY[document.kind]) : document.kind, person, document.name]
      .filter(Boolean)
      .join(" · ");
  };

  const run = async (key: string, work: () => Promise<{ ok: boolean; code: string }>, after?: () => void) => {
    if (busy) return;
    setBusy(key);
    setProblem(null);
    setProblemFor(key);
    try {
      const result = await work();
      if (!result.ok) {
        setProblem(result.code);
        if (key === "sign" && SIGNATURE_STALE.has(result.code)) onChanged();
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

  /** The signature asked over a colleague's, from the confirmation: an error in words, or null. */
  const askOver = async (): Promise<string | null> => {
    if (!filing) return null;
    try {
      const result = await requestPackageSignature(state.case.id, filing.id);
      if (!result.ok) {
        if (SIGNATURE_STALE.has(result.code)) onChanged();
        return t(caseErrorKey(result.code));
      }
      onStarted();
      onChanged();
      return null;
    } catch {
      // A request that failed on the way: the dialog stays, with the button back.
      const failed = caseErrorKey("unavailable");
      return t(failed);
    }
  };

  const open = async (key: string, link: () => Promise<{ ok: true; url: string } | { ok: false; code: string }>) => {
    if (busy) return;
    setBusy(key);
    setProblem(null);
    try {
      const result = await link();
      if (result.ok) window.open(result.url, "_blank", "noopener,noreferrer");
      else setProblem(result.code);
    } catch {
      setProblem("unavailable");
    } finally {
      setBusy(null);
    }
  };

  const ask = () =>
    run(
      "ask",
      () =>
        requestFilingPackage({
          caseId: state.case.id,
          proceedingId: proceeding.id,
          petitionId: petition,
          documentIds: chosen,
        }),
      () => {
        setAgain(false);
        setPickedPetition(null);
        setPickedDocuments(null);
        onStarted();
      },
    );

  const readReceipt = async (file: File) => {
    const before = receipt?.fileId ?? null;
    setReceipt({ fileId: null, name: file.name });
    setReceiptRead(null);
    setReceiptSlot({ kind: "reading" });
    const sent = await sendForReading(file, "filing_receipt");
    if (before) dropUnsaved([before]);
    setReceipt({ fileId: sent.fileId, name: file.name });
    if (!sent.ok) {
      setReceiptSlot({ kind: "failed", sentence: t(prefillErrorKey(sent.code)) });
      return;
    }
    const read = receiptReadingOf(sent.output, state.today);
    setReceiptRead(read);
    if (read.cnj) setCnj(read.cnj);
    if (read.filedOn) setFiledOn(read.filedOn);
    const sentence = !read.matches
      ? [t("filing-receipt-read-other"), read.note].filter(Boolean).join(" ")
      : read.cnj
        ? [
            read.filedOn
              ? t("filing-receipt-read-ok", { cnj: read.cnj, day: formatDayBr(read.filedOn) ?? read.filedOn })
              : t("filing-receipt-read-ok-no-day", { cnj: read.cnj }),
            read.note,
          ]
            .filter(Boolean)
            .join(" ")
        : read.cnjRead
          ? t("filing-receipt-read-bad-number", { number: read.cnjRead })
          : [t("filing-receipt-read-no-number"), read.note].filter(Boolean).join(" ");
    setReceiptSlot({ kind: "read", tone: read.matches && read.cnj ? "positive" : "attention", sentence });
  };

  const attach = () =>
    run(
      "receipt",
      async () => {
        if (!filing || !receipt?.fileId) return { ok: false, code: "file_not_found" };
        return attachFilingReceipt({
          caseId: state.case.id,
          packageId: filing.id,
          fileId: receipt.fileId,
          cnj,
          filedOn,
        });
      },
      () => {
        setReceipt(null);
        setReceiptRead(null);
        setReceiptSlot({ kind: "empty" });
        setCnj("");
      },
    );

  const where = [
    t(KIND_KEY[proceeding.kind]),
    proceeding.court,
    proceeding.comarca,
    proceeding.system ? t(SYSTEM_KEY[proceeding.system] ?? "case-system-outro") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const status: PackageStatus | null = proceeding.status === "filed" && !filing ? null : (filing?.status ?? null);
  // A package can be asked for a lawsuit not filed yet that names its court and system, with a petition to lead it.
  const canBuild =
    writable &&
    proceeding.status === "planned" &&
    Boolean(proceeding.court && proceeding.system) &&
    petitions.length > 0;
  // The form shows when there is no package, or over the one there is once the person asked for another.
  const formOpen = canBuild && (!filing || again);
  // The package there is stays in sight unless the form took its place.
  const showPackage = Boolean(filing) && !formOpen;
  // The system ONE named for the lawsuit still waits for the firm's word (0066): no package is built before it.
  const systemWaits = proceeding.status === "planned" && proceeding.system !== null && !proceeding.systemApproval;
  // Built for the lawsuit as it was: one that moved, or whose documents changed, is built again before it is filed.
  const outdated =
    filing !== null &&
    (filing.status === "ready" || filing.status === "requested") &&
    proceeding.status === "planned" &&
    filingOutdated(filing, proceeding, state.documents);
  // A petition ONE approved alone, where the firm lets it: no lawyer read it before it went into the package.
  const petitionByOne =
    filing !== null &&
    state.pieces.drafts.some((draft) => draft.approvedAuto && draft.documentId === filing.petitionDocumentId);
  // Something changed since the package was built that keeps the lawsuit from being filed now (a claimant's word
  // on the civil court, a minor beside a small-claims lawsuit): the receipt would be refused, so nothing is filed.
  const blocked =
    filing !== null &&
    filing.blocker !== null &&
    (filing.status === "ready" || filing.status === "requested") &&
    proceeding.status === "planned";
  const cnjOk = isValidCnj(cnj);
  // The files go signed by ONE with a lawyer's certificate in the cloud where the court's system takes them so (0042).
  const signature = filing?.signature ?? null;
  const signedFiles = signature?.takesSigned === true && signature.status === "signed";
  const nameOf = (id: string | null): string =>
    id ? (state.team.find((member) => member.userId === id)?.name ?? "") : "";
  const systemName = filing ? t(SYSTEM_KEY[filing.system] ?? "case-system-outro") : "";
  // Who signs the lawsuit, as the database counts it: named on it, and a partner or a lawyer of the firm.
  const viewerSigns = signature?.viewerSigns === true && state.lawyer;
  const viewerSigned = signature?.viewerSigned === true && viewerSigns;
  // Files to be built again, or that nothing may file now, are neither signed nor sent.
  const held = outdated || blocked;
  // Only the lawyer whose certificate signed the files takes the .p7s out of ONE, to file them.
  const ownSignedFiles = signedFiles && viewerSigned && writable && !held;
  const stepsFiles: FilingFiles = !signature?.takesSigned ? "court" : ownSignedFiles ? "signed" : "sign_first";
  // ONE files the lawsuit itself through the court's channel, or is about to (0101): the lawyer's own steps step back.
  const oneFiles = !held && oneFilesIt(filing);
  // The court took it from ONE and gave no number to read: what is left of the lawyer's way is the receipt.
  const unnumbered = filedWithoutNumber(filing);
  // Its files will be signed in the cloud and no lawyer of it covers them yet (0102): asked before the package is
  // built, so ONE does not stop there. Who signs it is shown the way to authorize; anybody else, whose it is.
  const ahead =
    proceeding.status === "planned" && (!filing || filing.status === "requested") && !held
      ? (state.signatureAhead.find((item) => item.proceedingId === proceeding.id) ?? null)
      : null;
  const aheadMine = ahead !== null && ahead.viewerSigns && state.lawyer;

  return (
    <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
      <Box className="flex flex-wrap items-start justify-between gap-2">
        <Typography variant="body1" className="min-w-0 font-semibold">
          {where}
        </Typography>
        {status ? <StatusChip tone={STATUS_TONE[status]} label={t(PACKAGE_STATUS_KEY[status])} /> : null}
      </Box>

      {problem && problemFor !== "sign" && (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          onClose={() => setProblem(null)}
          action={
            problem === "second_factor_required" ? (
              <Button color="inherit" size="small" href="/settings/security" LinkComponent={Link}>
                {t("approvals-second-factor-setup")}
              </Button>
            ) : undefined
          }
        >
          {t(caseErrorKey(problem))}
        </Alert>
      )}

      {proceeding.status === "filed" && !filing?.receipt ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("filing-filed-by-hand", {
            cnj: formatCnj(proceeding.cnj) ?? proceeding.cnj ?? "",
            day: formatDayBr(proceeding.filedAt) ?? "",
          })}
        </Typography>
      ) : null}

      {filing?.receipt ? (
        <Box className="flex flex-wrap items-center justify-between gap-2">
          <Typography variant="body1">
            {t("filing-filed-line", {
              cnj: formatCnj(filing.receipt.cnj) ?? filing.receipt.cnj,
              day: formatDayBr(filing.receipt.filedOn) ?? "",
            })}
          </Typography>
          <Button
            variant="outlined"
            color="grey"
            size="small"
            disabled={busy !== null}
            onClick={() => void open("open-receipt", () => openFilingReceipt(filing.receipt?.id as string))}
          >
            {t("filing-receipt-open")}
          </Button>
        </Box>
      ) : null}

      {filing?.byOne && showPackage && !(held && filing.status === "ready") ? (
        <FilingByOne
          filing={filing}
          systemName={systemName}
          mayAct={writable && state.lawyer}
          busy={busy !== null}
          onRequest={() => void run("file", () => requestFilingByOne(state.case.id, filing.id), onStarted)}
          onRetry={(notInCourt) =>
            void run(
              "file",
              () =>
                retryFilingByOne({
                  caseId: state.case.id,
                  packageId: filing.id,
                  submissionId: filing.byOne?.submission?.id ?? "",
                  notInCourt,
                }),
              onStarted,
            )
          }
        />
      ) : null}

      {proceeding.status === "planned" && (!proceeding.court || !proceeding.system) ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("filing-needs-forum")}
        </Typography>
      ) : null}

      {ahead ? (
        <StateLine
          tone={aheadMine ? "attention" : "info"}
          action={
            aheadMine && writable ? (
              <Button
                variant="outlined"
                color="grey"
                size="small"
                href={`/settings/team?voltar=${state.case.id}#team-cloud-signature`}
                LinkComponent={Link}
              >
                {t("filing-signature-authorize")}
              </Button>
            ) : undefined
          }
        >
          {aheadMine
            ? t(ahead.viewerCpf ? "filing-signature-ahead-mine" : "filing-signature-ahead-mine-cpf")
            : t("filing-signature-ahead")}
        </StateLine>
      ) : null}

      {outdated && showPackage ? (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          {t("filing-outdated")}
        </Alert>
      ) : null}
      {petitionByOne && showPackage && filing?.status !== "filed" ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {signedFiles
            ? viewerSigned
              ? t("filing-petition-by-one-signed-mine")
              : t("filing-petition-by-one-signed", {
                  name: nameOf(signature?.signedBy ?? null) || t("filing-signer-someone"),
                })
            : signature?.takesSigned && signature.cloudSigning
              ? t("filing-petition-by-one-to-sign")
              : t("filing-petition-by-one")}
        </Alert>
      ) : null}
      {blocked && showPackage && filing?.blocker ? (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          {t("filing-blocked", { reason: t(caseErrorKey(filing.blocker)) })}
        </Alert>
      ) : null}

      {filing?.status === "requested" && showPackage ? (
        <Typography variant="body2" className="text-text-secondary" role="status">
          {filing.slow ? t("filing-building-slow") : t("filing-building")}
        </Typography>
      ) : null}

      {filing?.status === "failed" && showPackage ? (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          <Typography variant="body2" component="p" className="mb-1 font-semibold">
            {t(filingErrorKey(filing.error))}
          </Typography>
          {filing.problems.length > 0 ? (
            <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
              {filing.problems.map((item) => (
                <Typography component="li" variant="body2" key={`${item.documentId}-${item.code}`}>
                  {t("filing-problem-line", {
                    document: documentWords(item.documentId),
                    reason: t(filingProblemKey(item.code)),
                  })}
                </Typography>
              ))}
            </Box>
          ) : null}
        </Alert>
      ) : null}

      {filing?.status === "ready" && showPackage ? (
        <>
          <Typography variant="body2" className="text-text-secondary">
            {filing.limitBytes
              ? t("filing-ready-limit", { count: filing.items.length, limit: sizeLabel(filing.limitBytes) })
              : t("filing-ready-no-limit", { count: filing.items.length })}
          </Typography>
          {filing.petitionLimitBytes ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("filing-petition-limit", { size: sizeLabel(filing.petitionLimitBytes) })}
            </Typography>
          ) : null}
          {(filing.limitBytes || filing.petitionLimitBytes) && !filing.limitConfirmed ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("filing-limit-unconfirmed")}
            </Alert>
          ) : null}
          {signature?.takesSigned ? (
            <SignatureBlock
              signature={signature}
              systemName={systemName}
              nameOf={nameOf}
              viewerSigns={viewerSigns}
              viewerSigned={viewerSigned}
              held={held}
              writable={writable}
              busy={busy}
              caseId={state.case.id}
              problem={problemFor === "sign" ? problem : null}
              onCloseProblem={() => setProblem(null)}
              onAsk={() => void run("sign", () => requestPackageSignature(state.case.id, filing.id), onStarted)}
              onAskOver={askOver}
            />
          ) : null}
          <Box component="ol" className="m-0 flex list-none flex-col gap-2 p-0">
            {filing.items.map((item) => (
              <Box component="li" key={item.id} className="flex flex-wrap items-center gap-2">
                <Box className="flex min-w-0 flex-1 basis-full flex-col sm:basis-0">
                  <Typography variant="body1" className="break-all">
                    {item.name}
                  </Typography>
                  {fileHints(item.documentId, item.part, item.parts).map((hint) => (
                    <Typography key={hint} variant="body2" className="text-text-secondary">
                      {hint}
                    </Typography>
                  ))}
                </Box>
                <Typography variant="body2" className="text-text-secondary flex-none">
                  {[sizeLabel(item.bytes), item.pages ? t("filing-item-pages", { count: item.pages }) : null]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography>
                {ownSignedFiles && item.signed ? (
                  <Button
                    variant="outlined"
                    color="grey"
                    size="small"
                    disabled={busy !== null}
                    aria-label={t("filing-item-download-signed-aria", { name: item.name })}
                    onClick={() => void open(`${item.id}-p7s`, () => openFilingFile(item.id, true))}
                  >
                    {t("filing-item-download-signed")}
                  </Button>
                ) : null}
                <Button
                  variant={ownSignedFiles && item.signed ? "text" : "outlined"}
                  color="grey"
                  size="small"
                  disabled={busy !== null}
                  aria-label={
                    ownSignedFiles && item.signed
                      ? t("filing-item-download-pdf-aria", { name: item.name })
                      : t("filing-item-download-aria", { name: item.name })
                  }
                  onClick={() => void open(item.id, () => openFilingFile(item.id))}
                >
                  {ownSignedFiles && item.signed ? t("filing-item-download-pdf") : t("filing-item-download")}
                </Button>
              </Box>
            ))}
          </Box>

          {oneFiles || unnumbered ? null : (
            <Box className="flex flex-col gap-1">
              <Typography variant="body2" className="text-text-secondary">
                {t("filing-steps-title")}
              </Typography>
              <Box component="ol" className="m-0 flex list-decimal flex-col gap-1 pl-5">
                {filingStepsOf(filing.system, stepsFiles).map((step) => (
                  <Typography component="li" variant="body1" key={step}>
                    {t(step)}
                  </Typography>
                ))}
              </Box>
            </Box>
          )}

          {outdated || blocked || oneFiles ? null : writable && state.lawyer ? (
            <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
              <Typography variant="body1" className="font-semibold">
                {t("filing-receipt-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("filing-receipt-read-intro")}
              </Typography>
              <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                <DocumentSlot
                  id={`filing-receipt-${proceeding.id}`}
                  icon={<NiDocumentCheck size="medium" className={TILE_TONE.primary.text} />}
                  title={t("filing-receipt-slot")}
                  hint={t("filing-receipt-slot-hint")}
                  state={receiptSlot}
                  fileName={receipt?.name}
                  primary
                  disabled={busy !== null}
                  labels={{
                    send: t("prefill-send"),
                    again: t("prefill-again"),
                    sending: t("prefill-sending"),
                    reading: t("prefill-reading"),
                    read: t("prefill-read"),
                    failed: t("prefill-failed"),
                  }}
                  onFile={(file) => void readReceipt(file)}
                />
              </Box>
              {receipt?.fileId && receiptSlot.kind !== "reading" && (
                <>
                  <Grid container spacing={2}>
                    <Grid size={{ xs: 12, sm: 7 }}>
                      <TextField
                        fullWidth
                        size="small"
                        id={`filing-cnj-${proceeding.id}`}
                        label={t("filing-receipt-cnj")}
                        value={cnj}
                        disabled={busy !== null}
                        error={cnj.trim() !== "" && !cnjOk}
                        helperText={
                          cnj.trim() !== "" && !cnjOk
                            ? t("case-error-cnj")
                            : receiptRead?.cnj && cnj === receiptRead.cnj
                              ? t("filing-receipt-cnj-read")
                              : t("filing-receipt-cnj-help")
                        }
                        slotProps={{ htmlInput: { maxLength: 30, inputMode: "numeric" } }}
                        onChange={(event) => setCnj(event.target.value)}
                        onBlur={() => setCnj((current) => formatCnj(current) ?? current)}
                      />
                    </Grid>
                    <Grid size={{ xs: 12, sm: 5 }}>
                      <TextField
                        fullWidth
                        size="small"
                        type="date"
                        id={`filing-day-${proceeding.id}`}
                        label={t("filing-receipt-day")}
                        value={filedOn}
                        disabled={busy !== null}
                        slotProps={{ inputLabel: { shrink: true }, htmlInput: { max: state.today } }}
                        onChange={(event) => setFiledOn(event.target.value)}
                      />
                    </Grid>
                  </Grid>
                  {receiptRead?.court && proceeding.court && receiptRead.court !== proceeding.court && (
                    <Alert severity="warning">
                      {t("filing-receipt-read-court", { read: receiptRead.court, court: proceeding.court })}
                    </Alert>
                  )}
                  <Typography variant="body2" className="text-text-secondary">
                    {t("filing-receipt-read-check")}
                  </Typography>
                  <Box>
                    <Button
                      variant="contained"
                      size="small"
                      disabled={busy !== null || !cnjOk || !filedOn}
                      onClick={() => void attach()}
                    >
                      {busy === "receipt" ? t("cases-working") : t("filing-receipt-attach")}
                    </Button>
                  </Box>
                </>
              )}
            </Box>
          ) : (
            <Typography variant="body2" className="text-text-secondary">
              {t("filing-receipt-lawyer")}
            </Typography>
          )}
        </>
      ) : null}

      {writable && proceeding.status === "planned" && petitions.length === 0 ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("filing-needs-petition")}
        </Typography>
      ) : null}

      {formOpen ? (
        <Box className="flex flex-col gap-3">
          {/* The package is built for the system ONE named, once the firm approved it (0066): the approval is here
              too, where the package is asked for. */}
          {systemWaits ? (
            <CourtSystem state={state} proceeding={proceeding} writable={writable} onChanged={onChanged} />
          ) : null}
          <TextField
            select
            fullWidth
            size="small"
            className="sm:max-w-xl"
            id={`filing-petition-${proceeding.id}`}
            label={t("filing-petition")}
            value={petition}
            disabled={busy !== null}
            onChange={(event) => setPickedPetition(event.target.value)}
          >
            {petitions.map((document) => (
              <MenuItem key={document.id} value={document.id}>
                {document.name}
              </MenuItem>
            ))}
          </TextField>
          <Box component="fieldset" className="m-0 flex flex-col border-0 p-0">
            <Typography component="legend" variant="body2" className="text-text-secondary mb-1 p-0">
              {others.length > 0 ? t("filing-documents") : t("filing-documents-none")}
            </Typography>
            {others.map((document) => (
              <FormControlLabel
                key={document.id}
                label={documentWords(document.id)}
                control={
                  <Checkbox
                    size="small"
                    checked={chosen.includes(document.id)}
                    disabled={busy !== null}
                    onChange={(event) =>
                      setPickedDocuments(
                        event.target.checked ? [...chosen, document.id] : chosen.filter((id) => id !== document.id),
                      )
                    }
                  />
                }
              />
            ))}
          </Box>
          <Box className="flex flex-row flex-wrap gap-2">
            <Button
              variant="contained"
              size="small"
              disabled={busy !== null || !petition || systemWaits}
              onClick={() => void ask()}
            >
              {busy === "ask" ? t("cases-working") : t("filing-build")}
            </Button>
            {again ? (
              <Button variant="text" color="grey" size="small" disabled={busy !== null} onClick={() => setAgain(false)}>
                {t("cases-cancel")}
              </Button>
            ) : null}
          </Box>
        </Box>
      ) : null}

      {writable && filing && showPackage && (filing.status === "ready" || filing.status === "failed" || filing.slow) ? (
        <Box className="flex flex-row flex-wrap gap-2">
          {canBuild ? (
            <Button
              variant="outlined"
              color="grey"
              size="small"
              disabled={busy !== null}
              onClick={() => setAgain(true)}
            >
              {t("filing-build-again")}
            </Button>
          ) : null}
          <Button variant="text" color="grey" size="small" disabled={busy !== null} onClick={() => setCancelling(true)}>
            {busy === "cancel" ? t("cases-working") : t("filing-cancel")}
          </Button>
        </Box>
      ) : null}
      {cancelling && filing ? (
        <ConfirmActionDialog
          title={t("filing-cancel-title")}
          consequences={[t("filing-cancel-consequence"), t("filing-cancel-consequence-one")]}
          staysTitle={t("confirm-stays")}
          stays={[t("filing-cancel-stays")]}
          requireReason={false}
          confirmLabel={t("filing-cancel")}
          cancelLabel={t("cases-cancel")}
          busyLabel={t("cases-working")}
          tone="danger"
          onConfirm={async () => {
            await run("cancel", () => cancelFilingPackage(state.case.id, filing.id));
            return null;
          }}
          onClose={() => setCancelling(false)}
        />
      ) : null}
    </Box>
  );
}

/**
 * How a package's files stand with their signature where the court's system
 * takes them signed (0042): who signs or signed them, what it waits for, and
 * what the person reading may do about it. A lawyer of the lawsuit asks ONE
 * to sign with their own authorization and nobody else's; asking over a
 * colleague's signature or request takes it from them, so it is confirmed
 * first. Where no PSC can be used here, or the package must be built again
 * or may not be filed now, nothing is offered: the lawyer signs the PDFs with
 * the signer they use in the court.
 */
function SignatureBlock({
  signature,
  systemName,
  nameOf,
  viewerSigns,
  viewerSigned,
  held,
  writable,
  busy,
  caseId,
  problem,
  onCloseProblem,
  onAsk,
  onAskOver,
}: {
  signature: CaseFiling["signature"];
  systemName: string;
  nameOf: (id: string | null) => string;
  viewerSigns: boolean;
  viewerSigned: boolean;
  held: boolean;
  writable: boolean;
  busy: string | null;
  caseId: string;
  problem: string | null;
  onCloseProblem: () => void;
  onAsk: () => void;
  onAskOver: () => Promise<string | null>;
}) {
  const t = useTranslations("product");
  const [confirming, setConfirming] = useState(false);
  const signer = nameOf(signature.signedBy);
  const requester = nameOf(signature.requestedBy);
  const when = signature.signedLabel ?? "";
  const status = signature.status;
  const signed = status === "signed";
  // A file that changed after the package was built is signed again by nobody: the package is built again.
  const fileChanged = signature.error === "file_changed" || signature.error === "files_changed";
  const offered = signature.cloudSigning && !held && !fileChanged;
  const mayAsk =
    offered &&
    writable &&
    viewerSigns &&
    signature.viewerAuthorized &&
    !viewerSigned &&
    !(status === "due" && signature.viewerRequested);
  const mayAuthorize = offered && writable && viewerSigns && !signature.viewerAuthorized && !viewerSigned;
  // What asking takes from a colleague: their signed files, or the request they made that is still owed.
  const takesFrom: { kind: "signed" | "request"; name: string } | null =
    signed && !viewerSigned
      ? { kind: "signed", name: signer }
      : (status === "due" || status === "waiting") && signature.requestedBy && !signature.viewerRequested
        ? { kind: "request", name: requester }
        : null;
  const authorizeHref = `/settings/team?voltar=${caseId}#team-cloud-signature`;

  const line = held
    ? t("filing-signature-held")
    : signed
      ? viewerSigned
        ? t("filing-signed-mine", { when, system: systemName })
        : signer
          ? t("filing-signed-by", { name: signer, when })
          : t("filing-signed", { when })
      : !signature.cloudSigning
        ? t("filing-signature-unavailable")
        : status === "due"
          ? signature.viewerRequested
            ? t("filing-signing-mine")
            : requester
              ? t("filing-signing-for", { name: requester })
              : t("filing-signing")
          : status === "waiting"
            ? signature.viewerRequested
              ? t("filing-signature-waiting-mine")
              : requester
                ? t("filing-signature-waiting-for", { name: requester })
                : t("filing-signature-waiting")
            : status === "failed"
              ? t("filing-signature-failed")
              : t("filing-signature-offered");

  // Why, in its own words only: a code with none is never said twice as a plain failure.
  const reason = signature.error && signatureErrorSaid(signature.error) ? t(signatureErrorKey(signature.error)) : null;
  const detail =
    held || (!signature.cloudSigning && !signed)
      ? null
      : status === "due" && signature.error
        ? reason
          ? t("filing-signature-retrying-why", { reason })
          : t("filing-signature-retrying")
        : status === "waiting" && signature.error !== "no_signature"
          ? reason
          : status === "failed"
            ? fileChanged
              ? t("filing-signature-file-changed")
              : [reason, t("filing-signature-failed-way")].filter(Boolean).join(" ")
            : signed && !viewerSigned && viewerSigns && signature.cloudSigning
              ? t("filing-signed-again-hint")
              : null;

  return (
    <Box className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
      <Box className="flex flex-wrap items-center justify-between gap-2">
        <Typography variant="body1" className="min-w-0 flex-1 basis-full sm:basis-0" role="status">
          {line}
        </Typography>
        {signed && !held ? <StatusChip tone="positive" label={t("filing-signature-chip")} /> : null}
      </Box>
      {detail ? (
        <Typography variant="body2" className="text-text-secondary">
          {detail}
        </Typography>
      ) : null}
      {signed && viewerSigned && writable && !held && !signature.formatConfirmed ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("filing-signed-unconfirmed", { system: systemName })}
        </Typography>
      ) : null}
      {problem ? (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          onClose={onCloseProblem}
          action={
            problem === "second_factor_required" ? (
              <Button color="inherit" size="small" href="/settings/security" LinkComponent={Link}>
                {t("approvals-second-factor-setup")}
              </Button>
            ) : problem === "no_signature" ? (
              <Button color="inherit" size="small" href={authorizeHref} LinkComponent={Link}>
                {t("filing-signature-authorize")}
              </Button>
            ) : undefined
          }
        >
          {t(caseErrorKey(problem))}
        </Alert>
      ) : null}
      {mayAsk || mayAuthorize ? (
        <Box className="flex flex-wrap items-center gap-2">
          {mayAsk ? (
            <Button
              variant="outlined"
              color="grey"
              size="small"
              disabled={busy !== null}
              onClick={() => (takesFrom ? setConfirming(true) : onAsk())}
            >
              {busy === "sign"
                ? t("filing-signature-requesting")
                : signed
                  ? t("filing-signature-request-again")
                  : t("filing-signature-request")}
            </Button>
          ) : null}
          {mayAuthorize ? (
            <Button variant="text" color="grey" size="small" href={authorizeHref} LinkComponent={Link}>
              {t("filing-signature-authorize")}
            </Button>
          ) : null}
        </Box>
      ) : null}
      {confirming && takesFrom ? (
        <ConfirmActionDialog
          title={t("filing-signature-takeover-title")}
          consequences={[
            takesFrom.kind === "signed"
              ? takesFrom.name
                ? t("filing-signature-takeover-signed", { name: takesFrom.name })
                : t("filing-signature-takeover-signed-someone")
              : takesFrom.name
                ? t("filing-signature-takeover-request", { name: takesFrom.name })
                : t("filing-signature-takeover-request-someone"),
            t("filing-signature-takeover-mine"),
          ]}
          staysTitle={t("psc-end-dialog-stays-title")}
          stays={[t("filing-signature-takeover-stays")]}
          requireReason={false}
          confirmLabel={t("filing-signature-request")}
          cancelLabel={t("cases-cancel")}
          busyLabel={t("filing-signature-requesting")}
          onConfirm={onAskOver}
          onClose={() => setConfirming(false)}
        />
      ) : null}
    </Box>
  );
}
