"use client";

import ApprovalCard, { type DecisionKind } from "./approval-card";
import DocumentCheckCard from "./document-check-card";
import DraftApprovalCard from "./draft-approval-card";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import PageHeader from "@/components/product/page-header";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiUsers from "@/icons/nexture/ni-users";
import { type ApprovalsState, type DecidedApproval, mayDecide } from "@/lib/ai/approvals";

/** The words said once a decision is recorded (`product` namespace). */
const DONE_KEY: Record<DecisionKind, string> = {
  approved: "approvals-done-approved",
  "approved-edited": "approvals-done-approved-edited",
  rejected: "approvals-done-rejected",
  returned: "approvals-done-returned",
};

const decidedChip = (decision: DecidedApproval): { key: string; tone: StatusTone } =>
  decision.status === "rejected"
    ? { key: "approvals-decided-rejected", tone: "attention" }
    : decision.status === "returned"
      ? { key: "approvals-decided-returned", tone: "info" }
      : decision.edited
        ? { key: "approvals-decided-approved-edited", tone: "info" }
        : { key: "approvals-decided-approved", tone: "positive" };

/**
 * The approval queue of the firm. Somebody comes here to decide what the AI
 * suggested: read each suggestion, correct it when it is almost right, approve
 * it, reject it with a reason, or send it back with what to change where the
 * task can be asked again. Success is an empty queue. It is a handful of
 * things to read one at a time, oldest first, so it is a column of cards and
 * never a table; under it, the last decisions, so a card that left the queue
 * is seen to have gone somewhere.
 */
export default function ApprovalsView({ state }: { state: ApprovalsState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [done, setDone] = useState<DecisionKind | null>(null);
  // What this person decided here, out of the list at once: the list the server reads again comes a moment
  // later, and a card still showing "Aprovar" after "Sugestão aprovada" invites a second click.
  const [decidedHere, setDecidedHere] = useState<string[]>([]);
  // The card a decision was made on leaves the screen: the focus goes to what says how it went.
  const doneRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (done) doneRef.current?.focus();
  }, [done, decidedHere]);

  const ready = state.kind === "ready" ? state : null;
  const refresh = () => router.refresh();
  const pending = ready ? ready.pending.filter((approval) => !decidedHere.includes(approval.id)) : [];
  const pendingTotal = ready
    ? Math.max(0, ready.pendingTotal - ready.pending.filter((approval) => decidedHere.includes(approval.id)).length)
    : 0;

  const decidesSomething = ready
    ? pending.some((approval) => mayDecide(ready.me.firmFunction, approval.approverFunctions))
    : false;
  const blocked = ready ? ready.supportVisit || ready.secondFactor !== "ok" : false;

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("approvals-title")}
        crumbs={[{ label: t("approvals-home"), href: "/inicio" }, { label: t("approvals-title") }]}
        description={ready ? t("approvals-description", { firm: ready.firm.name }) : undefined}
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
            <Button color="inherit" size="small" onClick={refresh}>
              {t("approvals-retry")}
            </Button>
          }
        >
          {t("approvals-load-error")}
        </Alert>
      ) : null}

      {state.kind === "no-firm" ? (
        <EmptyState
          icon={<NiUsers size="large" />}
          title={t("approvals-no-firm-title")}
          description={t("approvals-no-firm-body")}
          action={{ label: t("approvals-no-firm-action"), href: "/admin/ai" }}
        />
      ) : null}

      {ready ? (
        <>
          {ready.supportVisit ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("approvals-support-visit")}
            </Alert>
          ) : decidesSomething && ready.secondFactor === "missing" ? (
            <Alert
              severity="warning"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" href="/settings/security" LinkComponent={Link}>
                  {t("approvals-second-factor-setup")}
                </Button>
              }
            >
              {t("approvals-second-factor-missing")}
            </Alert>
          ) : decidesSomething && ready.secondFactor === "challenge" ? (
            <Alert
              severity="warning"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" href="/auth/two-factor?next=/aprovacoes" LinkComponent={Link}>
                  {t("approvals-second-factor-confirm")}
                </Button>
              }
            >
              {t("approvals-second-factor-challenge")}
            </Alert>
          ) : null}

          {done ? (
            <Alert
              ref={doneRef}
              tabIndex={-1}
              severity="success"
              role="status"
              className="neutral bg-background-paper/60!"
              onClose={() => setDone(null)}
            >
              {t(DONE_KEY[done])}
            </Alert>
          ) : null}

          {pendingTotal === 0 ? (
            <EmptyState
              icon={<NiListCheck size="large" />}
              title={t("approvals-empty-title")}
              description={t("approvals-empty-body")}
              action={{ label: t("approvals-empty-action"), href: "/inicio" }}
            />
          ) : (
            <Box component="section" aria-labelledby="approvals-waiting" className="flex flex-col gap-4">
              <Box className="flex flex-col gap-1">
                <Typography id="approvals-waiting" variant="h5" component="h2" className="mb-0">
                  {t("approvals-waiting", { count: pendingTotal })}
                </Typography>
                {pending.length > 0 && pendingTotal > pending.length ? (
                  <Typography variant="body2" className="text-text-secondary">
                    {t("approvals-more", { shown: pending.length, total: pendingTotal })}
                  </Typography>
                ) : null}
              </Box>
              {pending.map((approval) => {
                const decided = (kind: DecisionKind) => {
                  setDone(kind);
                  setDecidedHere((ids) => [...ids, approval.id]);
                  refresh();
                };
                const canDecide = mayDecide(ready.me.firmFunction, approval.approverFunctions);
                // A check of a document speaks of the document; every other task gets the generic card.
                return approval.document ? (
                  <DocumentCheckCard
                    key={approval.id}
                    approval={approval}
                    document={approval.document}
                    canDecide={canDecide}
                    blocked={blocked}
                    onDecided={decided}
                  />
                ) : approval.draft ? (
                  // A text the AI wrote for a piece is read and corrected on its case: its card leads there.
                  <DraftApprovalCard
                    key={approval.id}
                    approval={approval}
                    draft={approval.draft}
                    canDecide={canDecide}
                    blocked={blocked}
                    onDecided={decided}
                  />
                ) : (
                  <ApprovalCard
                    key={approval.id}
                    approval={approval}
                    canDecide={canDecide}
                    blocked={blocked}
                    onDecided={decided}
                  />
                );
              })}
            </Box>
          )}

          {ready.decided.length > 0 ? (
            <Card component="section" aria-labelledby="approvals-decided">
              <CardContent className="flex flex-col gap-4">
                <Box className="flex flex-col gap-1">
                  <Typography id="approvals-decided" variant="h5" component="h2" className="mb-0">
                    {t("approvals-decided-title")}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary">
                    {t("approvals-decided-body")}
                  </Typography>
                </Box>
                <Box component="ul" className="m-0 flex list-none flex-col p-0">
                  {ready.decided.map((decision) => {
                    const chip = decidedChip(decision);
                    return (
                      <Box
                        component="li"
                        key={decision.id}
                        className="border-grey-100 flex flex-col gap-1 border-b py-3 last:border-b-0"
                      >
                        <Box className="flex flex-row flex-wrap items-center gap-2">
                          <Typography variant="subtitle2" component="p" className="min-w-0 flex-1">
                            {decision.taskName}
                          </Typography>
                          <StatusChip label={t(chip.key)} tone={chip.tone} />
                        </Box>
                        <Typography variant="body2" className="text-text-secondary">
                          {decision.decidedAuto
                            ? t("approvals-decided-auto", { when: decision.decidedLabel })
                            : decision.decidedByName
                              ? t("approvals-decided-by", { name: decision.decidedByName, when: decision.decidedLabel })
                              : t("approvals-decided-by-unknown", { when: decision.decidedLabel })}
                        </Typography>
                        {decision.note ? (
                          <Typography variant="body2" className="text-text-primary whitespace-pre-wrap">
                            {decision.note}
                          </Typography>
                        ) : null}
                      </Box>
                    );
                  })}
                </Box>
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
