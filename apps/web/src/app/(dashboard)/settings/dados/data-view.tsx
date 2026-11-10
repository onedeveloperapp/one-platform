"use client";

import SettingsMenu from "../components/settings-menu";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Drawer, Grid, Tooltip, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import OutcomeDialog from "@/components/product/outcome-dialog";
import PageHeader from "@/components/product/page-header";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SectionTitle from "@/components/product/section-title";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import IllustrationStorage from "@/icons/illustrations/illustration-storage";
import NiCheck from "@/icons/nexture/ni-check";
import NiEraser from "@/icons/nexture/ni-eraser";
import NiInfoSquare from "@/icons/nexture/ni-info-square";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import NiUsers from "@/icons/nexture/ni-users";
import {
  CLEAR_COUNT_KEYS,
  type ClearCountKey,
  type ClearCounts,
  type ClearPreview,
  type ClearRefusal,
  clearsAnything,
  isClearWord,
} from "@/lib/firm/clear-data";
import { clearFirmData, readClearPreview } from "@/lib/firm/clear-data-actions";
import { countText } from "@/lib/numbers/compare";

export type DataState =
  | { kind: "unavailable" }
  | { kind: "no-firm" }
  | { kind: "error" }
  | {
      kind: "ready";
      preview: ClearPreview;
      supportVisit: boolean;
      /** Where the session's second factor stands, which the clearing asks. */
      factor: "ok" | "challenge" | "missing";
    };

/** The name of each count, as the card lists it. */
const COUNT_LABEL: Record<ClearCountKey, string> = {
  cases: "firm-clear-count-cases",
  people: "firm-clear-count-people",
  conversations: "firm-clear-count-conversations",
  publications: "firm-clear-count-publications",
  deadlines: "firm-clear-count-deadlines",
  hearings: "firm-clear-count-hearings",
  imports: "firm-clear-count-imports",
  agency_passengers: "firm-clear-count-agency-passengers",
};

/** What goes, one line a kind, in the confirmation. */
const CONSEQUENCE: Record<ClearCountKey, string> = {
  cases: "firm-clear-consequence-cases",
  people: "firm-clear-consequence-people",
  conversations: "firm-clear-consequence-conversations",
  publications: "firm-clear-consequence-publications",
  deadlines: "firm-clear-consequence-deadlines",
  hearings: "firm-clear-consequence-hearings",
  imports: "firm-clear-consequence-imports",
  agency_passengers: "firm-clear-consequence-agency-passengers",
};

/** What a refusal says, by the database's reason. The second factor is asked in place instead. */
const REFUSED: Record<Exclude<ClearRefusal, "second_factor">, string> = {
  not_allowed: "firm-clear-refused-not-allowed",
  support_visit: "firm-clear-refused-support-visit",
  confirm_missing: "firm-clear-refused-confirm",
  failed: "firm-clear-failed",
};

/** The key of a refusal's words; the second factor, asked in place elsewhere, reads as a failure here. */
const refusedKey = (code: ClearRefusal): string => REFUSED[code === "second_factor" ? "failed" : code];

const STAYS = [
  "firm-clear-stays-team",
  "firm-clear-stays-library",
  "firm-clear-stays-finance",
  "firm-clear-stays-partners",
  "firm-clear-stays-issued",
  "firm-clear-stays-audit",
] as const;

/**
 * "Dados do escritório": one card that clears the firm's cases, clients and conversations at once, with the agency's
 * test passengers, so the tests start again from nothing (the owner, 2026-11-10). It says what would go and what
 * stays before anything is asked; the confirmation counts again, asks the second factor in place and the word typed;
 * what came of it is said in front of the person.
 */
export default function DataView({ state }: { state: DataState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [openDrawer, setOpenDrawer] = useState(false);
  const ready = state.kind === "ready" ? state : null;
  const [preview, setPreview] = useState<ClearPreview | null>(ready?.preview ?? null);
  const [factor, setFactor] = useState(ready?.factor ?? "missing");
  const [confirming, setConfirming] = useState(false);
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<{ counts: ClearCounts; files: number } | null>(null);

  const counts = preview?.ok ? preview.counts : null;
  const allowed = Boolean(ready && !ready.supportVisit && preview?.ok);

  const open = async () => {
    if (opening) return;
    setOpening(true);
    setProblem(null);
    let fresh: ClearPreview;
    try {
      fresh = await readClearPreview();
    } catch {
      fresh = { ok: false, code: "failed" };
    }
    setOpening(false);
    if (!fresh.ok) {
      setProblem(t(refusedKey(fresh.code)));
      return;
    }
    // The confirmation counts what goes now, not what the page read when it opened.
    setPreview(fresh);
    if (clearsAnything(fresh.counts)) setConfirming(true);
  };

  const confirm = async (_reason: string, typed: string): Promise<string | null> => {
    let answer: Awaited<ReturnType<typeof clearFirmData>>;
    try {
      answer = await clearFirmData(typed);
    } catch {
      answer = { ok: false, code: "failed" };
    }
    if (answer.ok) {
      setDone({ counts: answer.counts, files: answer.files });
      return null;
    }
    if (answer.code === "second_factor") {
      setFactor("challenge");
      return t("firm-clear-factor-again");
    }
    return t(refusedKey(answer.code));
  };

  const finish = () => {
    setDone(null);
    router.refresh();
  };

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size={"auto"} className="hidden pr-8 lg:flex">
        <SettingsMenu active="data" />
      </Grid>
      <Grid size={"grow"} spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <PageHeader
              title={t("settings-data")}
              crumbs={[
                { label: t("settings-home"), href: "/inicio" },
                { label: t("settings-title"), href: "/settings" },
                { label: t("settings-data") },
              ]}
              description={t("firm-clear-page-description")}
            />
          </Grid>
          <Grid size={{ xs: 12, md: "auto" }} className="lg:hidden">
            <Tooltip title={t("settings-open-menu")}>
              <Button
                className="icon-only surface-standard"
                color="grey"
                variant="surface"
                onClick={() => setOpenDrawer(true)}
                aria-label={t("settings-open-menu")}
              >
                <NiListCircle size={"medium"} />
              </Button>
            </Tooltip>
          </Grid>
        </Grid>

        {state.kind === "unavailable" && (
          <Grid size={12}>
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("settings-unavailable")}
            </Alert>
          </Grid>
        )}
        {state.kind === "error" && (
          <Grid size={12}>
            <Alert
              severity="error"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" onClick={() => router.refresh()}>
                  {t("firm-clear-retry")}
                </Button>
              }
            >
              {t("firm-clear-load-error")}
            </Alert>
          </Grid>
        )}
        {state.kind === "no-firm" && (
          <Grid size={12}>
            <EmptyState
              icon={<NiUsers size="large" />}
              title={t("team-no-firm-title")}
              description={t("team-no-firm-body")}
              action={{ label: t("team-no-firm-action"), href: "/admin" }}
            />
          </Grid>
        )}

        {ready && (
          <Grid size={12}>
            <Card component="section" aria-labelledby="firm-clear-title">
              <CardContent className="flex flex-col gap-5">
                <CardTitle
                  id="firm-clear-title"
                  icon={<NiEraser size="medium" />}
                  tone="accent-3"
                  title={t("firm-clear-title")}
                  description={t("firm-clear-description")}
                  detail={t("firm-clear-detail")}
                  chip={
                    counts && !clearsAnything(counts) ? (
                      <StatusChip tone="positive" label={t("firm-clear-chip-empty")} />
                    ) : undefined
                  }
                />

                {ready.supportVisit ? (
                  <Alert severity="info" className="neutral bg-background-paper/60!">
                    {t("firm-clear-refused-support-visit")}
                  </Alert>
                ) : !preview?.ok ? (
                  <Alert severity="info" className="neutral bg-background-paper/60!">
                    {t(refusedKey(preview?.code === "support_visit" ? "support_visit" : "not_allowed"))}
                  </Alert>
                ) : null}

                {counts && !clearsAnything(counts) ? (
                  <EmptyState
                    illustration={<IllustrationStorage />}
                    title={t("firm-clear-empty-title")}
                    description={t("firm-clear-empty-body")}
                    titleAs="h3"
                    layout="row"
                    framed={false}
                  />
                ) : counts ? (
                  <Box className="flex flex-col gap-5">
                    <Box className="flex flex-col gap-2">
                      <SectionTitle
                        id="firm-clear-goes"
                        title={t("firm-clear-goes-title")}
                        description={t("firm-clear-goes-also")}
                        variant="subtitle2"
                        as="h3"
                      />
                      <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
                        {CLEAR_COUNT_KEYS.map((key) => (
                          <Box component="li" key={key} className="flex items-center justify-between gap-3">
                            <Typography variant="body2" component="span">
                              {t(COUNT_LABEL[key])}
                            </Typography>
                            <Typography variant="body2" component="span" className="font-semibold tabular-nums">
                              {countText(counts[key])}
                            </Typography>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                    <Box className="flex flex-col gap-2">
                      <SectionTitle
                        id="firm-clear-stays"
                        title={t("firm-clear-stays-title")}
                        variant="subtitle2"
                        as="h3"
                      />
                      <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
                        {STAYS.map((key) => (
                          <Box component="li" key={key}>
                            <StateLine tone="done">{t(key)}</StateLine>
                          </Box>
                        ))}
                      </Box>
                    </Box>
                    {problem ? (
                      <Alert
                        severity="error"
                        className="neutral bg-background-paper/60!"
                        onClose={() => setProblem(null)}
                      >
                        {problem}
                      </Alert>
                    ) : null}
                    <Box>
                      <Button
                        variant="outlined"
                        color="error"
                        startIcon={<NiEraser size="small" />}
                        disabled={!allowed || opening}
                        onClick={() => void open()}
                      >
                        {t("firm-clear-action")}
                      </Button>
                    </Box>
                  </Box>
                ) : null}
              </CardContent>
            </Card>
          </Grid>
        )}
      </Grid>

      {confirming && counts ? (
        <ConfirmActionDialog
          title={t("firm-clear-dialog-title")}
          intro={t("firm-clear-dialog-intro")}
          consequences={[
            ...CLEAR_COUNT_KEYS.filter((key) => counts[key] > 0).map((key) =>
              t(CONSEQUENCE[key], { count: counts[key] }),
            ),
            t("firm-clear-consequence-files"),
          ]}
          staysTitle={t("firm-clear-stays-title")}
          stays={STAYS.map((key) => t(key))}
          requireReason={false}
          typedWord={{
            label: t("firm-clear-word-label"),
            help: t("firm-clear-word-help"),
            matches: isClearWord,
          }}
          blocked={factor !== "ok"}
          confirmLabel={t("firm-clear-confirm")}
          cancelLabel={t("cancel")}
          busyLabel={t("firm-clear-busy")}
          tone="danger"
          onConfirm={confirm}
          onClose={() => setConfirming(false)}
        >
          {factor !== "ok" ? (
            <SecondFactorPrompt
              state={factor === "missing" ? "missing" : "challenge"}
              reason={t("firm-clear-factor-reason")}
              onConfirmed={() => setFactor("ok")}
            />
          ) : null}
        </ConfirmActionDialog>
      ) : null}

      <OutcomeDialog
        open={done !== null}
        title={t("firm-clear-done-title")}
        lines={
          done
            ? [
                {
                  key: "gone",
                  icon: <NiCheck size="medium" />,
                  text: t("firm-clear-done-gone", { cases: done.counts.cases, people: done.counts.people }),
                },
                { key: "next", icon: <NiInfoSquare size="medium" />, text: t("firm-clear-done-next") },
                { key: "files", icon: <NiInfoSquare size="medium" />, text: t("firm-clear-done-files") },
                { key: "record", icon: <NiInfoSquare size="medium" />, text: t("firm-clear-done-record") },
              ]
            : []
        }
        closeLabel={t("firm-clear-done-ok")}
        onClose={finish}
      />

      <Drawer open={openDrawer} anchor="right" onClose={() => setOpenDrawer(false)}>
        <Box className="min-w-80 p-7">
          <SettingsMenu active="data" />
        </Box>
      </Drawer>
    </Grid>
  );
}
