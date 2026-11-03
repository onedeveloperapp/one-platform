"use client";

import { GROUP_TONE } from "../../cases-types";
import type { CaseState } from "../case-types";
import ClientLinkCard from "./client-link-card";
import ComplaintCard from "./complaint-card";
import DeadlinesCard from "./deadlines-card";
import DocumentsCard from "./documents-card";
import DossierCard from "./dossier-card";
import DraftsCard from "./drafts-card";
import FilingCard from "./filing-card";
import HearingsCard from "./hearings-card";
import JourneyCard from "./journey-card";
import NoticesCard from "./notices-card";
import PeopleCard from "./people-card";
import ProceedingsCard from "./proceedings-card";
import RulesCard from "./rules-card";
import SignaturesCard from "./signatures-card";
import StageDialog from "./stage-dialog";
import StatementsCard from "./statements-card";
import SummaryCard from "./summary-card";
import TimelineCard from "./timeline-card";
import TripCard from "./trip-card";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import { CollapsibleGroup, CollapsibleGroupToggle } from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import PageHeader from "@/components/product/page-header";
import StatusChip from "@/components/product/status-chip";
import NiFolder from "@/icons/nexture/ni-folder";
import NiUsers from "@/icons/nexture/ni-users";
import {
  caseHolder,
  caseLabel,
  caseMissing,
  CLIENT_STAGES,
  DOCUMENT_KIND_KEY,
  groupOf,
  PERSON_FIELD_KEY,
  STATUS_KEY,
} from "@/lib/cases/cases";
import { type CivilCourtNeed, civilCourtPending } from "@/lib/cases/family";
import { caseKindLabelKey } from "@/lib/modules/registry";

/** How a missing word on the civil court is said: none yet, the adult's "no", or the "no" of who answers for a minor. */
const civilMissingKey = (need: CivilCourtNeed): string =>
  need.accepted !== false
    ? "case-missing-civil"
    : need.minor
      ? "case-missing-civil-declined-minor"
      : "case-missing-civil-declined";

/**
 * One case. Somebody of the firm comes here to move the case forward: see
 * what it still lacks, get it from the client (their link), check what the
 * client sent, and record the lawsuits. So it opens with what is missing and
 * where the case stands, and keeps the story (the timeline) beside it.
 */
export default function CaseView({ state: read }: { state: CaseState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [staging, setStaging] = useState(false);
  const refresh = useCallback(() => router.refresh(), [router]);
  // The case as it was last read whole. A card of this screen asks again by itself while the backend works
  // (a piece being written, a document being checked): one of those reads that fails must not take the
  // screen away from a person who is in the middle of a text.
  const [lastReady, setLastReady] = useState(read.kind === "ready" ? read : null);
  if (read.kind === "ready" && read !== lastReady) setLastReady(read);
  // A read that failed (the database, or the session read again) is no answer about the case: what the
  // person had stays. A case that is not there, or a person no longer of a firm, is an answer, and shows.
  const failed = read.kind === "error" || read.kind === "unavailable";
  const stale = failed && lastReady !== null;
  const state: CaseState = failed && lastReady ? lastReady : read;

  if (state.kind !== "ready") {
    return (
      <Box className="flex flex-col gap-6">
        <PageHeader
          title={t("cases-title")}
          crumbs={[
            { label: t("cases-home"), href: "/inicio" },
            { label: t("cases-title"), href: "/casos" },
          ]}
        />
        {state.kind === "unavailable" && (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("settings-unavailable")}
          </Alert>
        )}
        {state.kind === "error" && (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" onClick={refresh}>
                {t("cases-retry")}
              </Button>
            }
          >
            {t("case-load-error")}
          </Alert>
        )}
        {state.kind === "not-found" && (
          <EmptyState
            icon={<NiFolder size="large" />}
            title={t("case-not-found-title")}
            description={t("case-not-found-body")}
            action={{ label: t("case-back-to-list"), href: "/casos" }}
          />
        )}
        {state.kind === "no-firm" && (
          <EmptyState
            icon={<NiUsers size="large" />}
            title={t("cases-no-firm-title")}
            description={t("cases-no-firm-body")}
            action={{ label: t("cases-no-firm-action"), href: "/admin" }}
          />
        )}
      </Box>
    );
  }

  const current = state.case;
  const kindKey = caseKindLabelKey(current.incident);
  const writable = !state.supportVisit;
  // Whoever answers for the case: the first adult claimant, or else a guardian of the minors, never a minor.
  const holderParty = caseHolder(state.parties, state.today);
  const missing = caseMissing({
    parties: state.parties,
    documents: state.documents.map((document) => ({
      kind: document.kind,
      party_id: document.partyId,
      status: document.status,
    })),
    segments: state.segments.length,
    required: state.required,
    today: state.today,
  });
  // The claimants of a lawsuit planned in the civil court whose word on it is missing, or a "no" (0025).
  const civilMissing = civilCourtPending(state.civilCourt);
  // What the case lacks is shown while it is gathered, and later while something is missing, until the case is
  // with the court or ended (a case brought from a spreadsheet lacks what nothing will ask of it).
  const showMissing =
    CLIENT_STAGES.includes(current.status) ||
    (!["filed", "closed", "declined"].includes(current.status) && (missing.length > 0 || civilMissing.length > 0));
  const nameOfParty = (partyId: string) =>
    state.parties.find((party) => party.partyId === partyId)?.person.full_name ?? "";

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("case-title", { label: caseLabel(current.seq), name: holderParty?.person.full_name ?? "" })}
        crumbs={[
          { label: t("cases-home"), href: "/inicio" },
          { label: t("cases-title"), href: "/casos" },
          { label: caseLabel(current.seq) },
        ]}
        description={kindKey ? t(kindKey) : undefined}
        action={
          <Box className="flex flex-wrap items-center gap-2">
            <StatusChip tone={GROUP_TONE[groupOf(current.status)]} label={t(STATUS_KEY[current.status])} />
            {writable && (
              <Button variant="outlined" color="grey" size="small" onClick={() => setStaging(true)}>
                {t("case-stage-change")}
              </Button>
            )}
          </Box>
        }
      />

      {stale && (
        <Alert
          severity="warning"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={refresh}>
              {t("cases-retry")}
            </Button>
          }
        >
          {t("case-stale")}
        </Alert>
      )}
      {state.supportVisit && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("cases-support-visit")}
        </Alert>
      )}
      {current.closeReason && (current.status === "closed" || current.status === "declined") && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("case-closed-reason", { reason: current.closeReason })}
        </Alert>
      )}
      {/* Where the case stands along its way, what happens now and who it is with; what ONE waits for is said
          there too. What the case lacks is listed in its own card below. */}
      <JourneyCard state={state} missing={showMissing ? missing.length + civilMissing.length : 0} />

      {/* Each card opens by itself when the case's stage is about it or something in it waits for a person; the
          person may open or close every one at once to read the whole case. */}
      <CollapsibleGroup>
        <CollapsibleGroupToggle className="-mb-3" />
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, lg: 8 }} className="flex flex-col gap-3">
            {showMissing && (
              <Card component="section" aria-labelledby="case-missing">
                <CardContent className="flex flex-col gap-3">
                  <Typography id="case-missing" variant="h5" component="h2" className="mb-0">
                    {t("case-missing-title")}
                  </Typography>
                  {missing.length === 0 && civilMissing.length === 0 ? (
                    <Alert severity="success" className="neutral bg-background-paper/60!">
                      {t("case-missing-none")}
                    </Alert>
                  ) : (
                    <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
                      {missing.map((item, index) => (
                        <Typography key={index} component="li" variant="body1">
                          {item.type === "fields"
                            ? t("case-missing-fields", {
                                name: item.name,
                                fields: item.fields
                                  .map((field) => t(PERSON_FIELD_KEY[field as keyof typeof PERSON_FIELD_KEY]))
                                  .join(", "),
                              })
                            : item.type === "flight"
                              ? t("client-missing-flight")
                              : item.name
                                ? t("client-missing-document", {
                                    document: t(DOCUMENT_KIND_KEY[item.kind]),
                                    name: item.name,
                                  })
                                : t(DOCUMENT_KIND_KEY[item.kind])}
                        </Typography>
                      ))}
                      {civilMissing.map((need) => (
                        <Typography key={`civil-${need.partyId}`} component="li" variant="body1">
                          {t(civilMissingKey(need), { name: nameOfParty(need.partyId) })}
                        </Typography>
                      ))}
                    </Box>
                  )}
                </CardContent>
              </Card>
            )}

            <PeopleCard state={state} writable={writable} onChanged={refresh} />
            <TripCard state={state} writable={writable} onChanged={refresh} />
            <StatementsCard state={state} writable={writable} onChanged={refresh} />
            <DocumentsCard state={state} writable={writable} onChanged={refresh} />
            <ComplaintCard state={state} writable={writable} onChanged={refresh} />
            <SignaturesCard state={state} writable={writable} onChanged={refresh} />
            <RulesCard state={state} writable={writable} onChanged={refresh} />
            <ProceedingsCard state={state} writable={writable} onChanged={refresh} />
            <DeadlinesCard state={state} writable={writable} onChanged={refresh} />
            <HearingsCard state={state} writable={writable} onChanged={refresh} />
            <DraftsCard state={state} writable={writable} onChanged={refresh} />
            <FilingCard state={state} writable={writable} onChanged={refresh} />
          </Grid>

          <Grid size={{ xs: 12, lg: 4 }} className="flex flex-col gap-3">
            <ClientLinkCard
              state={state}
              holderPersonId={holderParty?.person.person_id ?? null}
              writable={writable}
              onChanged={refresh}
            />
            <NoticesCard state={state} writable={writable} onChanged={refresh} />
            <SummaryCard state={state} writable={writable} onChanged={refresh} />
            <DossierCard state={state} writable={writable} onChanged={refresh} />
            <TimelineCard state={state} />
          </Grid>
        </Grid>
      </CollapsibleGroup>

      {staging && (
        <StageDialog
          caseId={current.id}
          status={current.status}
          onClose={() => setStaging(false)}
          onChanged={() => {
            setStaging(false);
            refresh();
          }}
        />
      )}
    </Box>
  );
}
