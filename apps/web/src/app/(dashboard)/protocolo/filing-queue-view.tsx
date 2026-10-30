"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import MetricBars from "@/components/product/metric-bars";
import ModuleScope from "@/components/product/module-scope";
import PageHeader from "@/components/product/page-header";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import NiScale from "@/icons/nexture/ni-scale";
import NiUsers from "@/icons/nexture/ni-users";
import { caseLabel } from "@/lib/cases/cases";
import { PACKAGE_STATUS_KEY, QUEUE_SHOWN } from "@/lib/cases/filing";
import type { QueuedFiling } from "@/lib/cases/filing-facts";
import { type PageScope, scopeCrumbs } from "@/lib/modules/offer";

export type FilingQueueState =
  | {
      kind: "ready";
      firm: string;
      rows: QueuedFiling[];
      /** True when more packages wait than the screen reads at once. */
      truncated: boolean;
      /** A lawyer can authorize ONE at some PSC here: otherwise no signature waits for an authorization. */
      cloudSigning: boolean;
      /** The person reading is a partner or a lawyer: who files. */
      lawyer: boolean;
      /** The modules of the firm, and the one the page is under (0078). */
      scope: PageScope;
    }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

const STATUS_TONE: Record<QueuedFiling["status"], StatusTone> = {
  ready: "attention",
  requested: "info",
  failed: "danger",
};

const SYSTEM_KEY: Record<string, string> = {
  projudi: "case-system-projudi",
  eproc: "case-system-eproc",
  pje: "case-system-pje",
  esaj: "case-system-esaj",
  outro: "case-system-outro",
};

const KIND_KEY: Record<"juizado" | "comum", string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};

/**
 * The firm's filing queue. A lawyer comes here to know what is ready to be
 * filed and where: the packages are grouped by court and system, because a
 * lawyer files a run of them in one system with one login, and each one
 * opens its case, where the files are downloaded in order and the receipt
 * is attached. Success is an empty queue. A handful of groups, each a short
 * list, so it is a column of cards and never a table.
 */
export default function FilingQueueView({ state }: { state: FilingQueueState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const ready = state.kind === "ready" ? state : null;

  // One group per court and system, the ones with something ready to file first.
  const groups = new Map<string, QueuedFiling[]>();
  for (const row of ready?.rows ?? []) {
    const key = `${row.court}|${row.system}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const ordered = [...groups.entries()].sort(
    ([, a], [, b]) =>
      Number(b.some((row) => row.status === "ready")) - Number(a.some((row) => row.status === "ready")) ||
      a[0].court.localeCompare(b[0].court),
  );
  const count = (status: QueuedFiling["status"]) => (ready?.rows ?? []).filter((row) => row.status === status).length;

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("filing-queue-title")}
        crumbs={scopeCrumbs(t("approvals-home"), t("filing-queue-title"), ready?.scope.current ?? null)}
        description={ready ? t("filing-queue-description") : undefined}
      />
      {ready ? (
        <ModuleScope path="/protocolo" modules={ready.scope.modules} current={ready.scope.current?.key ?? null} />
      ) : null}

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
            <Button color="inherit" size="small" onClick={() => router.refresh()}>
              {t("approvals-retry")}
            </Button>
          }
        >
          {t("filing-queue-load-error")}
        </Alert>
      ) : null}

      {state.kind === "no-firm" ? (
        <EmptyState
          icon={<NiUsers size="large" />}
          title={t("cases-no-firm-title")}
          description={t("cases-no-firm-body")}
          action={{ label: t("cases-no-firm-action"), href: "/admin" }}
        />
      ) : null}

      {ready && ready.rows.length === 0 ? (
        <EmptyState
          icon={<NiScale size="large" />}
          title={t("filing-queue-empty-title")}
          description={t("filing-queue-empty-body")}
          action={{ label: t("filing-queue-empty-action"), href: "/casos?ver=preparing" }}
        />
      ) : null}

      {ready && ready.rows.length > 0 ? (
        <>
          <Card component="section" aria-labelledby="filing-queue-counts">
            <CardContent className="flex flex-col gap-4">
              <Typography id="filing-queue-counts" variant="h5" component="h2" className="mb-0">
                {t("filing-queue-counts", { count: ready.rows.length })}
              </Typography>
              <MetricBars
                items={[
                  { key: "ready", label: t("filing-queue-count-ready"), value: count("ready"), tone: "attention" },
                  {
                    key: "requested",
                    label: t("filing-queue-count-requested"),
                    value: count("requested"),
                    tone: "primary",
                  },
                  { key: "failed", label: t("filing-queue-count-failed"), value: count("failed"), tone: "secondary" },
                ]}
              />
              {!ready.lawyer ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("filing-queue-not-lawyer")}
                </Typography>
              ) : null}
            </CardContent>
          </Card>

          {ready.truncated ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("filing-queue-truncated", { count: QUEUE_SHOWN })}
            </Alert>
          ) : null}

          {ordered.map(([key, rows]) => (
            <Card component="section" key={key} aria-labelledby={`filing-group-${key}`}>
              <CardContent className="flex flex-col gap-3">
                <Typography id={`filing-group-${key}`} variant="h5" component="h2" className="mb-0">
                  {[rows[0].court, t(SYSTEM_KEY[rows[0].system] ?? "case-system-outro")].join(" · ")}
                </Typography>
                <Box component="ul" className="m-0 flex list-none flex-col p-0">
                  {rows.map((row) => (
                    <Box
                      component="li"
                      key={row.id}
                      className="border-grey-100 flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0"
                    >
                      <Box className="flex min-w-0 flex-1 basis-full flex-col sm:basis-0">
                        <Typography variant="body1" className="font-semibold">
                          {[row.caseSeq !== null ? caseLabel(row.caseSeq) : null, row.client]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          {[
                            row.kind ? t(KIND_KEY[row.kind]) : null,
                            row.comarca,
                            row.status === "ready" ? t("filing-queue-files", { count: row.files }) : null,
                            t("filing-queue-asked", { when: row.requestedLabel }),
                            row.blocker ? t("filing-queue-blocked") : null,
                            // What the signature waits for is said only where a lawyer can give it, and of a
                            // package nothing keeps from being filed.
                            row.status !== "ready" || !row.signature || row.blocker
                              ? null
                              : row.signature === "signed"
                                ? t("filing-queue-signed")
                                : !ready?.cloudSigning
                                  ? null
                                  : row.signature === "waiting"
                                    ? t("filing-queue-signature-waiting")
                                    : row.signature === "failed"
                                      ? t("filing-queue-signature-failed")
                                      : t("filing-queue-signing"),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                      </Box>
                      <StatusChip tone={STATUS_TONE[row.status]} label={t(PACKAGE_STATUS_KEY[row.status])} />
                      <Button
                        variant={row.status === "ready" && !row.blocker ? "contained" : "outlined"}
                        color={row.status === "ready" && !row.blocker ? "primary" : "grey"}
                        size="small"
                        href={`/casos/${row.caseId}#case-filing`}
                        LinkComponent={Link}
                      >
                        {t("filing-queue-open")}
                      </Button>
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          ))}
        </>
      ) : null}
    </Box>
  );
}
