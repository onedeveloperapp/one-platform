"use client";

import FinanceGate from "../finance-gate";
import type { FinanceState } from "../load-finance";
import { BillPanel, RenegotiatePanel, SettlePanel, SplitPanel } from "./bill-panels";
import ImportPanel from "./import-panel";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Alert, Box, Card, CardContent, Grid, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import ListBar, { type ListView } from "@/components/product/list-bar";
import MetricBars from "@/components/product/metric-bars";
import NumberCard from "@/components/product/number-card";
import PageHeader from "@/components/product/page-header";
import QuickActions, { type QuickAction } from "@/components/product/quick-actions";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import IllustrationAnalytics from "@/icons/illustrations/illustration-analytics";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiChartBar from "@/icons/nexture/ni-chart-bar";
import NiMoney from "@/icons/nexture/ni-money";
import NiMoneyBag from "@/icons/nexture/ni-money-bag";
import NiReceipt from "@/icons/nexture/ni-receipt";
import NiRefresh from "@/icons/nexture/ni-refresh";
import { lateCharge } from "@/lib/cases/fees";
import { closeFinanceBill, requestFinanceReceipt, stopFinanceSeries } from "@/lib/finance/actions";
import {
  type AgingBand,
  BILL_VIEWS,
  type BillDirection,
  billInView,
  billNumbers,
  billOrder,
  billRest,
  billStanding,
  type BillView,
  type FinanceBill,
  type FinanceSeries,
  lateChargesOf,
  receivableAging,
} from "@/lib/finance/bills";
import { configuresBooks, dayLabel, financeErrorKey, money, operatesBooks } from "@/lib/finance/books";
import { openFinanceDocument } from "@/lib/finance/document-actions";
import { type FinanceReceipt, receiptOfBill } from "@/lib/finance/receipts";

const VIEW_KEY: Record<BillView, string> = {
  pagar: "finance-bills-view-pagar",
  receber: "finance-bills-view-receber",
  vencidas: "finance-bills-view-vencidas",
  cobrar: "finance-bills-view-cobrar",
  pagas: "finance-bills-view-pagas",
  fechadas: "finance-bills-view-fechadas",
};
const CLOSED_KEY: Record<"cancelled" | "renegotiated" | "written_off", string> = {
  cancelled: "finance-bill-closed-cancelled",
  renegotiated: "finance-bill-closed-renegotiated",
  written_off: "finance-bill-closed-written-off",
};

/** The words of each way of a bill. */
const WAY_KEY: Record<BillDirection, { late: string; kind: string; settle: string }> = {
  pay: { late: "finance-bill-late-pay", kind: "finance-bill-to-pay", settle: "finance-bill-settle-pay-short" },
  receive: {
    late: "finance-bill-late-receive",
    kind: "finance-bill-to-receive",
    settle: "finance-bill-settle-receive-short",
  },
};
/** The words of each way of closing a bill. */
const CLOSE_KEY: Record<"cancelled" | "written_off", { title: string; kept: string; confirm: string }> = {
  cancelled: { title: "finance-bill-cancel-title", kept: "finance-bill-cancel-kept", confirm: "finance-bill-cancel" },
  written_off: {
    title: "finance-bill-write-off-title",
    kept: "finance-bill-write-off-kept",
    confirm: "finance-bill-write-off",
  },
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** The words of each band of default. */
const BAND_KEY: Record<AgingBand, string> = {
  "1-30": "finance-aging-1-30",
  "31-60": "finance-aging-31-60",
  "61-90": "finance-aging-61-90",
  "91-180": "finance-aging-91-180",
  "180+": "finance-aging-180",
};

type Writing = { kind: "new"; direction: BillDirection } | { kind: "edit"; bill: FinanceBill };
type Closing = { bill: FinanceBill; how: "cancelled" | "written_off" };

/**
 * `/financeiro/contas`: what the firm has to pay and to receive (migration 0129), in the screen pattern: the numbers of
 * the month, the views (to pay, to receive, late, to charge, paid, closed), "Nova conta" with the typed line first,
 * and each bill with where it stands and its actions. The person pays at the bank; ONE settles the bill when the
 * statement shows it, and never charges anybody: "Para cobrar ou informar" is the firm's people's to act on.
 */
export default function BillsView({ state }: { state: FinanceState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const params = useSearchParams();
  const asked = params.get("ver");
  const [view, setView] = useState<BillView>(BILL_VIEWS.includes(asked as BillView) ? (asked as BillView) : "pagar");
  const [search, setSearch] = useState("");
  const [writing, setWriting] = useState<Writing | null>(null);
  const [settling, setSettling] = useState<FinanceBill | null>(null);
  const [renegotiating, setRenegotiating] = useState<FinanceBill | null>(null);
  const [splitting, setSplitting] = useState<FinanceBill | null>(null);
  const [closing, setClosing] = useState<Closing | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [stopping, setStopping] = useState<FinanceSeries | null>(null);
  const [importing, setImporting] = useState(false);
  const day = today();
  const bills = useMemo(() => (state.kind === "ready" ? (state.bills ?? []) : []), [state]);
  const shown = useMemo(() => {
    const words = plain(search.trim());
    return bills
      .filter(
        (bill) =>
          billInView(bill, view, day) &&
          (!words ||
            plain([bill.counterparty, bill.description, bill.category].filter(Boolean).join(" ")).includes(words)),
      )
      .sort(billOrder);
  }, [bills, view, search, day]);
  if (state.kind !== "ready") return <FinanceGate state={state} title={t("finance-bills-title")} />;
  const writes = operatesBooks(state.level) && !state.supportVisit;
  const configures = configuresBooks(state.level) && !state.supportVisit;
  const numbers = billNumbers(bills, day);
  const series = state.series ?? [];
  const receipts = state.receipts ?? [];
  const aging = receivableAging(bills, day);

  const views: ListView[] = BILL_VIEWS.map((key) => ({
    key,
    label: t(VIEW_KEY[key]),
    count: String(bills.filter((bill) => billInView(bill, key, day)).length),
    group: key === "pagas" || key === "fechadas" ? t("finance-views-other") : t("finance-bills-views-open"),
  }));

  const standingLine = (bill: FinanceBill) => {
    const standing = billStanding(bill, day);
    switch (standing.kind) {
      case "paid":
        return (
          <StateLine tone="done">
            {bill.byOne
              ? t("finance-bill-paid-by-one", { day: dayLabel(standing.on) })
              : t("finance-bill-paid", { day: dayLabel(standing.on) })}
          </StateLine>
        );
      case "closed":
        return <StateLine tone="info">{t(CLOSED_KEY[standing.status], { reason: bill.closedReason ?? "" })}</StateLine>;
      case "late": {
        const charge = bill.lateTerms
          ? lateCharge(
              bill.cents - bill.paidCents,
              bill.dueOn,
              day,
              bill.lateTerms.finePercent,
              bill.lateTerms.interestPercent,
            )
          : null;
        return (
          <>
            <StateLine tone="attention">
              {t(WAY_KEY[bill.direction].late, {
                count: standing.days,
              })}
            </StateLine>
            {charge && charge.totalCents > bill.cents - bill.paidCents ? (
              <StateLine tone="info">
                {t("finance-bill-late-charge", {
                  value: money(charge.totalCents),
                  fine: money(charge.fineCents),
                  interest: money(charge.interestCents),
                })}
              </StateLine>
            ) : null}
          </>
        );
      }
      case "today":
        return <StateLine tone="attention">{t("finance-bill-today")}</StateLine>;
      case "soon":
        return <StateLine tone="waiting">{t("finance-bill-soon", { count: standing.days })}</StateLine>;
      default:
        return <StateLine tone="info">{t("finance-bill-due", { day: dayLabel(bill.dueOn) })}</StateLine>;
    }
  };

  // The document a bill was read from opens in a new tab, by a link of a minute (0140).
  const openDocument = async (fileId: string) => {
    const link = await openFinanceDocument(fileId);
    if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
  };
  const documentAction = (bill: FinanceBill): QuickAction[] =>
    bill.fileId
      ? [{ key: "document", label: t("finance-doc-open"), onClick: () => void openDocument(bill.fileId as string) }]
      : [];

  // The receipt ONE issues to the client of a receivable received (0152): seen once issued, asked for by who operates
  // the books where the firm keeps it to a person or it failed.
  const askReceipt = async (bill: FinanceBill) => {
    setNote(null);
    const result = await requestFinanceReceipt(bill.id);
    setNote(result.ok ? t("finance-receipt-asked") : t(financeErrorKey(result.code)));
    if (result.ok) router.refresh();
  };
  const receiptAction = (bill: FinanceBill): QuickAction[] => {
    const receipt = receiptOfBill(receipts, bill.id);
    if (!receipt) return [];
    if (receipt.status === "issued" && receipt.fileId) {
      return [
        {
          key: "receipt",
          label: t("finance-receipt-open"),
          onClick: () => void openDocument(receipt.fileId as string),
        },
      ];
    }
    if (writes && (receipt.status === "waiting" || receipt.status === "failed")) {
      return [{ key: "receipt-ask", label: t("finance-receipt-ask"), onClick: () => void askReceipt(bill) }];
    }
    return [];
  };
  const receiptLine = (receipt: FinanceReceipt | null) => {
    if (!receipt) return null;
    switch (receipt.status) {
      case "issued":
        return (
          <StateLine tone="done">
            {t("finance-receipt-issued", { day: dayLabel(receipt.issuedAt?.slice(0, 10) ?? receipt.paidOn) })}
          </StateLine>
        );
      case "owed":
        return <StateLine tone="waiting">{t("finance-receipt-owed")}</StateLine>;
      case "waiting":
        return <StateLine tone="attention">{t("finance-receipt-waiting")}</StateLine>;
      case "failed":
        return <StateLine tone="failed">{t("finance-receipt-failed")}</StateLine>;
      default:
        return <StateLine tone="info">{t("finance-receipt-void")}</StateLine>;
    }
  };

  // What a payment paid above its bill is split into its fine and its interest by who operates the books (0192).
  const splitAction = (bill: FinanceBill): QuickAction[] =>
    writes && bill.latePayments.length > 0
      ? [{ key: "split", label: t("finance-bill-split"), onClick: () => setSplitting(bill) }]
      : [];
  const lateLine = (bill: FinanceBill) => {
    const late = lateChargesOf(bill);
    const parts = [
      late.fineCents > 0 ? t("finance-bill-fine", { value: money(late.fineCents) }) : null,
      late.interestCents > 0 ? t("finance-bill-interest", { value: money(late.interestCents) }) : null,
      late.unsplitCents > 0 ? t("finance-bill-extra-unsplit", { value: money(late.unsplitCents) }) : null,
    ].filter(Boolean);
    if (parts.length === 0) return null;
    return (
      <>
        <Typography variant="body2" className="text-text-secondary">
          {parts.join(" · ")}
        </Typography>
        {late.byContract ? (
          <Typography variant="caption" className="text-text-secondary">
            {t("finance-bill-split-contract")}
          </Typography>
        ) : null}
      </>
    );
  };

  const actionsOf = (bill: FinanceBill): QuickAction[] =>
    bill.status !== "open"
      ? [...documentAction(bill), ...receiptAction(bill), ...splitAction(bill)]
      : [
          ...documentAction(bill),
          ...receiptAction(bill),
          ...splitAction(bill),
          ...(bill.paidCents === 0
            ? [{ key: "edit", label: t("finance-bill-edit"), onClick: () => setWriting({ kind: "edit", bill }) }]
            : []),
          { key: "renegotiate", label: t("finance-bill-renegotiate"), onClick: () => setRenegotiating(bill) },
          { key: "cancel", label: t("finance-bill-cancel"), onClick: () => setClosing({ bill, how: "cancelled" }) },
          ...(bill.direction === "receive" && configures
            ? [
                {
                  key: "off",
                  label: t("finance-bill-write-off"),
                  onClick: () => setClosing({ bill, how: "written_off" }),
                },
              ]
            : []),
        ];

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("finance-bills-title")}
        crumbs={[{ label: t("finance-crumb"), href: "/financeiro" }, { label: t("finance-bills-title") }]}
        description={t("finance-bills-description")}
      />
      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <NumberCard
            icon={<NiMoney size="medium" />}
            tone="secondary"
            label={t("finance-bills-number-receive")}
            value={money(numbers.receiveMonth)}
            onClick={() => setView("receber")}
            pressed={view === "receber"}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <NumberCard
            icon={<NiReceipt size="medium" />}
            tone="accent-2"
            label={t("finance-bills-number-pay")}
            value={money(numbers.payMonth)}
            onClick={() => setView("pagar")}
            pressed={view === "pagar"}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <NumberCard
            icon={<NiCalendarClock size="medium" />}
            tone="accent-3"
            label={t("finance-bills-number-late")}
            value={money(numbers.late)}
            hint={t("finance-bills-number-late-hint", { count: numbers.lateCount })}
            onClick={() => setView("vencidas")}
            pressed={view === "vencidas"}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <NumberCard
            icon={<NiMoneyBag size="medium" />}
            tone="primary"
            label={t("finance-bills-number-received")}
            value={money(numbers.receivedMonth)}
            onClick={() => setView("pagas")}
            pressed={view === "pagas"}
          />
        </Grid>
      </Grid>
      <ListBar
        label={t("finance-bills-title")}
        viewsTitle={t("list-views-title")}
        views={views}
        view={view}
        onView={(key) => setView(key as BillView)}
        search={{
          label: t("list-bar-search"),
          placeholder: t("finance-bills-search"),
          value: search,
          onChange: setSearch,
        }}
        create={
          writes
            ? {
                label: t("finance-bill-new"),
                actions: [
                  {
                    key: "pay",
                    label: t("finance-bill-new-pay"),
                    onClick: () => setWriting({ kind: "new", direction: "pay" }),
                  },
                  {
                    key: "receive",
                    label: t("finance-bill-new-receive"),
                    onClick: () => setWriting({ kind: "new", direction: "receive" }),
                  },
                ],
              }
            : undefined
        }
        more={
          writes
            ? {
                label: t("list-bar-more"),
                actions: [{ key: "import", label: t("finance-legacy-title"), onClick: () => setImporting(true) }],
              }
            : undefined
        }
      />
      <ImportPanel open={importing} onClose={() => setImporting(false)} />
      {view === "cobrar" ? <StateLine tone="info">{t("finance-bills-charge-note")}</StateLine> : null}
      {view === "cobrar" && aging.count > 0 ? (
        <Card>
          <CardContent className="flex flex-col gap-4">
            <CardTitle
              id="finance-aging"
              icon={<NiChartBar size="medium" />}
              tone="accent-3"
              title={t("finance-aging-title")}
              description={t("finance-aging-hint")}
              detail={t("finance-aging-detail", { count: aging.count, value: money(aging.cents) })}
            />
            <Grid container spacing={4}>
              <Grid size={{ xs: 12, md: 6 }}>
                <MetricBars
                  items={aging.bands.map((band) => ({
                    key: band.band,
                    label: t(BAND_KEY[band.band]),
                    value: band.count,
                    tone: band.band === "1-30" ? "secondary" : "attention",
                    hint: band.count > 0 ? money(band.cents) : undefined,
                  }))}
                />
              </Grid>
              <Grid size={{ xs: 12, md: 6 }}>
                <Typography variant="subtitle2" component="h3" className="mb-2">
                  {t("finance-aging-clients")}
                </Typography>
                <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
                  {aging.clients.map((client) => (
                    <Box component="li" key={client.name} className="flex items-baseline justify-between gap-3">
                      <Typography variant="body2" className="min-w-0 truncate">
                        {client.name || t("finance-bill-untitled")}
                      </Typography>
                      <Typography variant="body2" className="tabular-nums">
                        {money(client.cents)}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      ) : null}
      {series.length > 0 && (view === "pagar" || view === "receber") ? (
        <Card>
          <CardContent className="flex flex-col gap-3">
            <CardTitle
              id="finance-series"
              icon={<NiRefresh size="medium" />}
              tone="primary"
              title={t("finance-series-title")}
              description={t("finance-series-hint")}
            />
            <Box component="ul" className="m-0 flex list-none flex-col p-0">
              {series.map((item) => (
                <Box
                  component="li"
                  key={item.id}
                  className="border-grey-100 flex items-start justify-between gap-3 border-b py-3 last:border-b-0"
                >
                  <Box className="flex min-w-0 flex-col gap-1">
                    <Typography variant="body1">{item.counterparty ?? t("finance-bill-untitled")}</Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {[t(WAY_KEY[item.direction].kind), item.category, t("finance-series-every", { day: item.day })]
                        .filter(Boolean)
                        .join(" · ")}
                    </Typography>
                    {item.status === "stopped" ? (
                      <StateLine tone="info">
                        {t("finance-series-stopped", { reason: item.stoppedReason ?? "" })}
                      </StateLine>
                    ) : item.nextDueOn ? (
                      <StateLine tone="waiting">
                        {t("finance-series-next", { day: dayLabel(item.nextDueOn) })}
                      </StateLine>
                    ) : (
                      <StateLine tone="info">{t("finance-series-waiting")}</StateLine>
                    )}
                  </Box>
                  <Box className="flex shrink-0 items-start gap-2">
                    <Typography variant="body1" className="tabular-nums">
                      {money(item.cents)}
                    </Typography>
                    {writes && item.status === "active" ? (
                      <QuickActions
                        label={t("finance-series-actions")}
                        actions={[{ key: "stop", label: t("finance-series-stop"), onClick: () => setStopping(item) }]}
                      />
                    ) : null}
                  </Box>
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>
      ) : null}
      {note ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
          {note}
        </Alert>
      ) : null}
      <Card>
        <CardContent>
          {shown.length === 0 ? (
            <EmptyState
              icon={<NiReceipt size="large" />}
              illustration={<IllustrationAnalytics />}
              title={bills.length === 0 ? t("finance-bills-empty") : t("finance-bills-none-here")}
              description={bills.length === 0 ? t("finance-bills-empty-body") : undefined}
              titleAs="h2"
              framed={false}
            />
          ) : (
            <Box component="ul" className="m-0 flex list-none flex-col p-0">
              {shown.map((bill) => (
                <Box
                  component="li"
                  key={bill.id}
                  className="border-grey-100 flex items-start justify-between gap-3 border-b py-3 last:border-b-0"
                >
                  <Box className="flex min-w-0 flex-col gap-1">
                    <Typography variant="body1">
                      {bill.counterparty ?? bill.description ?? bill.category ?? t("finance-bill-untitled")}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {[
                        t(WAY_KEY[bill.direction].kind),
                        bill.category,
                        bill.seriesTotal
                          ? t("finance-bill-series", { index: bill.seriesIndex ?? 1, total: bill.seriesTotal })
                          : null,
                        bill.paidCents > 0 && bill.status === "open"
                          ? t("finance-bill-paid-part", { value: money(bill.paidCents) })
                          : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Typography>
                    {standingLine(bill)}
                    {bill.extraCents > 0 ? lateLine(bill) : null}
                    {bill.discountCents > 0 ? (
                      <Typography variant="body2" className="text-text-secondary">
                        {t("finance-bill-discount", { value: money(bill.discountCents) })}
                      </Typography>
                    ) : null}
                    {bill.direction === "receive" ? receiptLine(receiptOfBill(receipts, bill.id)) : null}
                    {bill.seriesByOne && bill.status === "open" ? (
                      <Box>
                        <StatusChip tone="neutral" label={t("finance-series-chip")} />
                      </Box>
                    ) : null}
                    {bill.byOne && bill.status === "paid" ? (
                      <Box>
                        <StatusChip tone="neutral" label={t("finance-by-one")} />
                      </Box>
                    ) : null}
                  </Box>
                  <Box className="flex shrink-0 items-start gap-2">
                    <Box className="flex flex-col items-end gap-1">
                      <Typography variant="body1" className="tabular-nums">
                        {money(bill.status === "open" ? billRest(bill) : bill.cents)}
                      </Typography>
                      {writes && bill.status === "open" ? (
                        <Box
                          component="button"
                          type="button"
                          onClick={() => setSettling(bill)}
                          className="text-primary cursor-pointer border-0 bg-transparent p-0 text-sm font-semibold"
                        >
                          {t(WAY_KEY[bill.direction].settle)}
                        </Box>
                      ) : null}
                    </Box>
                    {writes && actionsOf(bill).length > 0 ? (
                      <QuickActions label={t("finance-bill-actions")} actions={actionsOf(bill)} />
                    ) : null}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>

      {writing ? (
        <BillPanel
          direction={writing.kind === "new" ? writing.direction : writing.bill.direction}
          bill={writing.kind === "edit" ? writing.bill : null}
          registrations={state.registrations}
          onClose={() => setWriting(null)}
          onSaved={() => {
            setWriting(null);
            router.refresh();
          }}
        />
      ) : null}
      {settling ? (
        <SettlePanel
          bill={settling}
          registrations={state.registrations}
          onClose={() => setSettling(null)}
          onSaved={() => {
            setSettling(null);
            router.refresh();
          }}
        />
      ) : null}
      {splitting ? (
        <SplitPanel
          bill={splitting}
          onClose={() => setSplitting(null)}
          onSaved={() => {
            setSplitting(null);
            setNote(t("finance-bill-split-saved"));
            router.refresh();
          }}
        />
      ) : null}
      {renegotiating ? (
        <RenegotiatePanel
          bill={renegotiating}
          onClose={() => setRenegotiating(null)}
          onSaved={() => {
            setRenegotiating(null);
            router.refresh();
          }}
        />
      ) : null}
      {stopping ? (
        <ConfirmActionDialog
          title={t("finance-series-stop-title")}
          intro={t("finance-series-stop-intro", { who: stopping.counterparty ?? t("finance-bill-untitled") })}
          consequences={[t("finance-series-stop-bills"), t("finance-series-stop-never")]}
          reasonLabel={t("finance-field-reason")}
          reasonMinLength={3}
          requireReason
          confirmLabel={t("finance-series-stop")}
          cancelLabel={t("finance-cancel")}
          tone="warning"
          onClose={() => setStopping(null)}
          onConfirm={async (reason) => {
            const result = await stopFinanceSeries(stopping.id, reason);
            if (!result.ok) return t(financeErrorKey(result.code));
            setStopping(null);
            router.refresh();
            return null;
          }}
        />
      ) : null}
      {closing ? (
        <ConfirmActionDialog
          title={t(CLOSE_KEY[closing.how].title)}
          intro={t("finance-bill-close-intro", { value: money(billRest(closing.bill)) })}
          consequences={[
            t(CLOSE_KEY[closing.how].kept),
            ...(closing.how === "written_off" ? [t("finance-bill-write-off-charge")] : []),
          ]}
          reasonLabel={t("finance-field-reason")}
          reasonMinLength={3}
          requireReason
          confirmLabel={t(CLOSE_KEY[closing.how].confirm)}
          cancelLabel={t("finance-cancel")}
          tone="warning"
          onClose={() => setClosing(null)}
          onConfirm={async (reason) => {
            setNote(null);
            const result = await closeFinanceBill(closing.bill.id, closing.how, reason);
            if (!result.ok) return t(financeErrorKey(result.code));
            setClosing(null);
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </Box>
  );
}
