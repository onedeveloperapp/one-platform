"use client";

import EstimatesPanel from "./estimates-panel";
import type { OneWorkState } from "./load-one-work";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, MenuItem, TextField, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import CollapsibleCard from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import ModuleScope from "@/components/product/module-scope";
import NumberCard, { type NumberComparison } from "@/components/product/number-card";
import PageHeader from "@/components/product/page-header";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import type { TileTone } from "@/components/product/tile-tone";
import NiArrowInDown from "@/icons/nexture/ni-arrow-in-down";
import NiBell from "@/icons/nexture/ni-bell";
import NiBook from "@/icons/nexture/ni-book";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiClock from "@/icons/nexture/ni-clock";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiFolderCheck from "@/icons/nexture/ni-folder-check";
import NiInbox from "@/icons/nexture/ni-inbox";
import NiMessages from "@/icons/nexture/ni-messages";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiMoney from "@/icons/nexture/ni-money";
import NiPen from "@/icons/nexture/ni-pen";
import NiRobot from "@/icons/nexture/ni-robot";
import NiScale from "@/icons/nexture/ni-scale";
import NiSettings from "@/icons/nexture/ni-settings";
import NiUsers from "@/icons/nexture/ni-users";
import { writeWorkbook, XLSX_TYPE } from "@/lib/export/xlsx-write";
import { savedFileName, saveFile } from "@/lib/files/save-file";
import { scopedHref } from "@/lib/modules/offer";
import { compared, countText, deltaText } from "@/lib/numbers/compare";
import {
  durationOf,
  familyLabelKey,
  familyLines,
  kindLabelKey,
  moneyOf,
  monthLabel,
  monthsBetween,
  monthShift,
  monthTotals,
  type OneWorkFamily,
  oneWorkSheet,
  reaisText,
} from "@/lib/one-work/work";

/** Each family with the icon of what it is and its tint. */
const FAMILY: Record<OneWorkFamily, { icon: ReactNode; tone: TileTone }> = {
  atendimento: { icon: <NiMessages size="medium" />, tone: "primary" },
  documentos: { icon: <NiDocumentCheck size="medium" />, tone: "accent-1" },
  relato: { icon: <NiMicrophone size="medium" />, tone: "accent-2" },
  acoes: { icon: <NiScale size="medium" />, tone: "accent-4" },
  pecas: { icon: <NiPen size="medium" />, tone: "secondary" },
  protocolo: { icon: <NiFolderCheck size="medium" />, tone: "primary" },
  tribunal: { icon: <NiInbox size="medium" />, tone: "accent-1" },
  prazos: { icon: <NiCalendarClock size="medium" />, tone: "accent-3" },
  avisos: { icon: <NiBell size="medium" />, tone: "accent-2" },
  biblioteca: { icon: <NiBook size="medium" />, tone: "accent-4" },
  financeiro: { icon: <NiMoney size="medium" />, tone: "secondary" },
};

/**
 * What ONE did for the firm in a month (phase 2 of the plan of the controladoria): how many tasks, about how many hours
 * a person would have taken by the firm's own estimates and, for who decides for the firm, what those hours are worth;
 * the pieces ONE approved on a line of their own, beside the OAB's recommendation; what a person approved after
 * reading and the test cases said apart; a card per family with each kind of task; how the count is made; the
 * spreadsheet of the twelve months read; and, for who decides, the estimates to adjust. It never measures a person.
 */
export default function OneWorkView({ state }: { state: OneWorkState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [adjusting, setAdjusting] = useState(false);

  const ready = state.kind === "ready" ? state : null;
  const say = (key: string, values?: Record<string, string | number>) => t(key, values);
  const durationText = (minutes: number) => {
    const duration = durationOf(minutes);
    return duration.unit === "hours"
      ? t("one-work-hours-short", { count: duration.value })
      : t("one-work-minutes-short", { count: duration.value });
  };

  const download = () => {
    if (!ready) return;
    const bytes = writeWorkbook([oneWorkSheet(ready.work, say)]);
    saveFile(
      bytes,
      savedFileName(t("one-work-file", { firm: ready.firmName, month: ready.current }), "xlsx", t("one-work-title")),
      XLSX_TYPE,
    );
  };

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("one-work-title")}
        crumbs={[{ label: t("cases-home"), href: "/inicio" }, { label: t("one-work-title") }]}
        description={t("one-work-description")}
        action={
          ready ? (
            <Box className="flex flex-wrap justify-end gap-2">
              {ready.work.rows.length > 0 ? (
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  startIcon={<NiArrowInDown size="small" />}
                  onClick={download}
                >
                  {t("one-work-download")}
                </Button>
              ) : null}
              {ready.adjusts ? (
                <Button
                  variant="outlined"
                  color="grey"
                  size="small"
                  startIcon={<NiSettings size="small" />}
                  onClick={() => setAdjusting(true)}
                >
                  {t("one-work-adjust")}
                </Button>
              ) : null}
            </Box>
          ) : undefined
        }
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
            <Button color="inherit" size="small" onClick={() => router.refresh()}>
              {t("cases-retry")}
            </Button>
          }
        >
          {t("one-work-load-error")}
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

      {ready ? <OneWorkMonth ready={ready} durationText={durationText} onAdjust={() => setAdjusting(true)} /> : null}

      {ready && adjusting ? (
        <EstimatesPanel
          kinds={ready.work.kinds}
          hourCents={ready.work.hourCents}
          onClose={() => setAdjusting(false)}
          onSaved={() => {
            setAdjusting(false);
            router.refresh();
          }}
        />
      ) : null}
    </Box>
  );
}

function OneWorkMonth({
  ready,
  durationText,
  onAdjust,
}: {
  ready: Extract<OneWorkState, { kind: "ready" }>;
  durationText: (minutes: number) => string;
  onAdjust: () => void;
}) {
  const t = useTranslations("product");
  const router = useRouter();
  const { work, month, current } = ready;
  const module = ready.module?.key ?? null;
  const totals = monthTotals(work, month);
  // A month is compared only with a whole month before it: the month going on is said alone.
  const before = month !== current && month > work.from ? monthTotals(work, monthShift(month, -1)) : null;
  const comparison = (now: number, then: number, said: string): NumberComparison => {
    const move = compared(now, then);
    return { delta: deltaText(move), same: t("one-work-same"), hoped: false, text: said };
  };
  // The hours move in hours, never in the minutes they are counted in.
  const hoursComparison = (now: number, then: number, said: string): NumberComparison => {
    const move = compared(now, then);
    const delta =
      move.move === "same"
        ? null
        : move.percent !== null
          ? `${move.difference > 0 ? "+" : "-"}${Math.abs(move.percent)}%`
          : `${move.difference > 0 ? "+" : "-"}${durationText(Math.abs(move.difference))}`;
    return { delta, same: t("one-work-same"), hoped: false, text: said };
  };
  const money = work.decides ? moneyOf(totals.minutes, work.hourCents) : null;
  const families = familyLines(work, month);
  const nothing = totals.tasks === 0 && totals.test === 0;
  const months = monthsBetween(work.from, current);
  const previousLabel = monthLabel(monthShift(month, -1));

  return (
    <>
      <Box className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <ModuleScope path="/trabalho-do-one" modules={ready.modules} current={module} keep={{ mes: month }} />
        <TextField
          select
          size="small"
          label={t("one-work-month")}
          value={month}
          className="sm:min-w-72"
          onChange={(event) => router.push(scopedHref("/trabalho-do-one", module, { mes: event.target.value }))}
        >
          {months.map((option) => (
            <MenuItem key={option} value={option}>
              {option === current ? t("one-work-month-current", { month: monthLabel(option) }) : monthLabel(option)}
            </MenuItem>
          ))}
        </TextField>
      </Box>

      {/* A month with nothing done is said once, by the empty state below, never by cards of zero beside it. */}
      {nothing ? null : (
        <Grid container spacing={2.5}>
          <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
            <NumberCard
              icon={<NiRobot size="medium" />}
              tone="primary"
              label={t("one-work-number-tasks")}
              hint={t("one-work-number-tasks-hint")}
              value={countText(totals.tasks)}
              comparison={
                before
                  ? comparison(
                      totals.tasks,
                      before.tasks,
                      t("one-work-vs", { month: previousLabel, value: countText(before.tasks) }),
                    )
                  : null
              }
            />
          </Grid>
          <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
            <NumberCard
              icon={<NiClock size="medium" />}
              tone="accent-1"
              label={t("one-work-number-hours")}
              hint={t("one-work-number-hours-hint")}
              value={durationText(totals.minutes)}
              comparison={
                before
                  ? hoursComparison(
                      totals.minutes,
                      before.minutes,
                      t("one-work-vs", { month: previousLabel, value: durationText(before.minutes) }),
                    )
                  : null
              }
            />
          </Grid>
          {money !== null ? (
            <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
              <NumberCard
                icon={<NiMoney size="medium" />}
                tone="secondary"
                label={t("one-work-number-money")}
                hint={t("one-work-number-money-hint")}
                value={reaisText(money)}
              />
            </Grid>
          ) : null}
        </Grid>
      )}

      <Box className="flex flex-col gap-2">
        {month === current && !nothing ? <StateLine tone="info">{t("one-work-month-going")}</StateLine> : null}
        {totals.assisted > 0 ? (
          <StateLine tone="info">{t("one-work-assisted-line", { count: totals.assisted })}</StateLine>
        ) : null}
        {totals.test > 0 ? <StateLine tone="info">{t("one-work-test-line", { count: totals.test })}</StateLine> : null}
        {work.decides && work.hourCents === null && ready.adjusts ? (
          <StateLine
            tone="attention"
            action={
              <Button size="small" variant="text" onClick={onAdjust}>
                {t("one-work-cost-action")}
              </Button>
            }
          >
            {t("one-work-cost-missing")}
          </StateLine>
        ) : null}
      </Box>

      {totals.piecesApproved > 0 ? (
        <Card id="one-work-pieces">
          <CardContent className="flex flex-col gap-3">
            <CardTitle
              id="one-work-pieces-title"
              icon={<NiPen size="medium" />}
              tone="secondary"
              title={t("one-work-pieces-title")}
              chip={<StatusChip tone="attention" label={countText(totals.piecesApproved)} />}
            />
            <Typography variant="body2">{t("one-work-pieces-body", { count: totals.piecesApproved })}</Typography>
            <Typography variant="caption" className="text-text-secondary">
              {t("one-work-pieces-hours", { duration: durationText(totals.piecesMinutes) })}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("autonomy-privative")}
            </Typography>
          </CardContent>
        </Card>
      ) : null}

      {nothing ? (
        <EmptyState
          icon={<NiRobot size="large" />}
          title={t("one-work-empty-title")}
          description={t("one-work-empty-body", { month: monthLabel(month) })}
          action={{ label: t("one-work-empty-action"), href: "/settings/autonomia" }}
        />
      ) : (
        <Grid container spacing={2.5}>
          {families.map((group) => (
            <Grid key={group.family} size={{ xs: 12, lg: 6 }}>
              <Card className="h-full">
                <CardContent className="flex flex-col gap-3">
                  <CardTitle
                    id={`one-work-${group.family}`}
                    icon={FAMILY[group.family].icon}
                    tone={FAMILY[group.family].tone}
                    title={t(familyLabelKey(group.family))}
                    chip={
                      group.tasks > 0 ? (
                        <StatusChip tone="positive" label={t("one-work-family-tasks", { count: group.tasks })} />
                      ) : (
                        <StatusChip tone="neutral" label={t("one-work-family-none")} />
                      )
                    }
                  />
                  <Box component="ul" className="m-0 flex list-none flex-col p-0">
                    {group.lines.map((line) => {
                      const done = line.alone + line.assisted;
                      return (
                        <Box
                          component="li"
                          key={line.kind.key}
                          className="border-grey-100 flex items-start justify-between gap-3 border-t py-2 first:border-t-0"
                        >
                          <Box className="flex min-w-0 flex-col">
                            <Typography variant="body2" className={done > 0 ? undefined : "text-text-secondary"}>
                              {t(kindLabelKey(line.kind.key))}
                            </Typography>
                            {line.assisted > 0 ? (
                              <Typography variant="caption" className="text-text-secondary">
                                {t("one-work-kind-assisted", { count: line.assisted })}
                              </Typography>
                            ) : null}
                          </Box>
                          <Box className="flex shrink-0 flex-col items-end">
                            <Typography
                              variant="body2"
                              className={`font-semibold tabular-nums ${done > 0 ? "" : "text-text-secondary"}`}
                            >
                              {countText(done)}
                            </Typography>
                            {done > 0 ? (
                              <Typography variant="caption" className="text-text-secondary tabular-nums">
                                {durationText(line.minutes)}
                              </Typography>
                            ) : null}
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}

      <CollapsibleCard id="one-work-how" title={t("one-work-how-title")} titleAs="h2">
        <Box component="ul" className="m-0 flex list-disc flex-col gap-2 pl-5">
          {["counts", "stands", "assisted", "tests", "month", "minutes", "money", "out", "person"].map((key) => (
            <Typography key={key} component="li" variant="body2">
              {t(`one-work-how-${key}`)}
            </Typography>
          ))}
        </Box>
      </CollapsibleCard>

      <Typography variant="caption" role="status" className="text-text-secondary">
        {t("one-work-read-at", { when: ready.readLabel })}
      </Typography>
    </>
  );
}
