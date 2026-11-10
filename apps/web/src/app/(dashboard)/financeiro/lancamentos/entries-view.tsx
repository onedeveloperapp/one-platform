"use client";

import EntryPanel, { type ManualKind, NEW_KEY } from "../entry-panel";
import FinanceGate from "../finance-gate";
import type { FinanceState } from "../load-finance";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Alert, Box, Card, CardContent, Typography } from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import ListBar, { type ListView } from "@/components/product/list-bar";
import PageHeader from "@/components/product/page-header";
import QuickActions, { type QuickAction } from "@/components/product/quick-actions";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import IllustrationAnalytics from "@/icons/illustrations/illustration-analytics";
import NiMoney from "@/icons/nexture/ni-money";
import { writeXlsx, XLSX_TYPE } from "@/lib/export/xlsx-write";
import { savedFileName, saveFile } from "@/lib/files/save-file";
import { beginFinanceExport, cancelFinanceEntry, setFinanceMoneyApart } from "@/lib/finance/actions";
import { dayLabel, ENTRY_KIND_KEY, financeErrorKey, money, operatesBooks } from "@/lib/finance/books";
import {
  entryExportColumns,
  entryExportLine,
  type EntryExportWords,
  entryPdfColumns,
  entryPdfLine,
} from "@/lib/finance/export";
import type { FinanceEntryRow } from "@/lib/finance/read";

const VIEWS = [
  "todos",
  "receitas",
  "despesas",
  "cliente",
  "separar",
  "socios",
  "transferencias",
  "one",
  "cancelados",
] as const;
type View = (typeof VIEWS)[number];
const VIEW_KEY: Record<View, string> = {
  todos: "finance-view-todos",
  receitas: "finance-view-receitas",
  despesas: "finance-view-despesas",
  cliente: "finance-view-cliente",
  separar: "finance-view-separar",
  socios: "finance-view-socios",
  transferencias: "finance-view-transferencias",
  one: "finance-view-one",
  cancelados: "finance-view-cancelados",
};

const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

/** Which entries a view holds: the ones in force by kind, a client's money to set apart, those ONE wrote, the cancelled. */
function inView(entry: FinanceEntryRow, view: View): boolean {
  if (view === "cancelados") return entry.cancelled;
  if (entry.cancelled) return false;
  switch (view) {
    case "receitas":
      return entry.kind === "income";
    case "despesas":
      return entry.kind === "expense";
    case "cliente":
      return entry.kind === "client_money";
    case "separar":
      return entry.apart === "owed";
    case "socios":
      return entry.kind === "partner";
    case "transferencias":
      return entry.kind === "transfer";
    case "one":
      return entry.byOne;
    default:
      return true;
  }
}

/**
 * `/financeiro/lancamentos`: every entry of the books, the latest first (migrations 0126 and 0127), in the screen
 * pattern: the views by kind, the search, "Novo" for who operates, "Exportar" to Excel or PDF for who reads, an entry
 * cancelled with its reason, never deleted, and a client's money said apart once somebody set it apart. What ONE
 * wrote says so, and that ONE may err.
 */
export default function EntriesView({ state }: { state: FinanceState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const params = useSearchParams();
  const asked = params.get("ver");
  const [view, setView] = useState<View>(VIEWS.includes(asked as View) ? (asked as View) : "todos");
  const [search, setSearch] = useState("");
  const [writing, setWriting] = useState<ManualKind | null>(null);
  const [cancelling, setCancelling] = useState<FinanceEntryRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [note, setNote] = useState<{ severity: "error" | "success"; text: string } | null>(null);
  const entries = useMemo(() => (state.kind === "ready" ? (state.entries ?? []) : []), [state]);
  const shown = useMemo(() => {
    const words = plain(search.trim());
    return entries.filter(
      (entry) =>
        inView(entry, view) &&
        (!words ||
          plain(
            [entry.counterparty, entry.description, entry.category, entry.account].filter(Boolean).join(" "),
          ).includes(words)),
    );
  }, [entries, view, search]);
  if (state.kind !== "ready") return <FinanceGate state={state} title={t("finance-entries-title")} />;
  const writes = operatesBooks(state.level) && !state.supportVisit;

  const views: ListView[] = VIEWS.map((key) => ({
    key,
    label: t(VIEW_KEY[key]),
    count: String(entries.filter((entry) => inView(entry, key)).length),
    group: key === "one" || key === "cancelados" ? t("finance-views-other") : t("finance-views-kind"),
  }));

  const words: EntryExportWords = {
    columns: {
      day: t("finance-export-day"),
      kind: t("finance-export-kind"),
      account: t("finance-field-account"),
      category: t("finance-field-category"),
      counterparty: t("finance-field-counterparty"),
      description: t("finance-field-description"),
      value: t("finance-export-value"),
      madeBy: t("finance-export-made-by"),
      state: t("finance-export-state"),
    },
    kind: {
      income: t(ENTRY_KIND_KEY.income),
      expense: t(ENTRY_KIND_KEY.expense),
      client_money: t(ENTRY_KIND_KEY.client_money),
      partner: t(ENTRY_KIND_KEY.partner),
      transfer: t(ENTRY_KIND_KEY.transfer),
    },
    byOne: t("finance-export-by-one"),
    byPerson: t("finance-export-by-person"),
    inForce: t("finance-export-in-force"),
    cancelled: (reason) => (reason ? t("finance-export-cancelled-reason", { reason }) : t("finance-export-cancelled")),
  };

  const exportAs = async (format: "xlsx" | "pdf") => {
    setNote(null);
    setExporting(true);
    try {
      const begun = await beginFinanceExport(format, shown.length);
      if (!begun.ok) {
        setNote({ severity: "error", text: t(financeErrorKey(begun.code)) });
        return;
      }
      const name = `${t("finance-entries-title")} ${state.firmName}`;
      if (format === "pdf") {
        const { writeTablePdf } = await import("@flyee/documents/table-pdf");
        const bytes = await writeTablePdf({
          title: t("finance-entries-title"),
          author: state.firmName,
          facts: [
            state.firmName,
            t("finance-export-fact-view", { view: t(VIEW_KEY[view]), count: shown.length }),
            ...(search.trim() ? [t("finance-export-fact-search")] : []),
          ],
          columns: entryPdfColumns(words),
          rows: shown.map((entry) => entryPdfLine(entry, words)),
          madeAt: new Date(),
        });
        saveFile(bytes, savedFileName(name, "pdf", t("finance-entries-title")), "application/pdf");
      } else {
        const bytes = writeXlsx({
          sheet: t("finance-entries-title"),
          columns: entryExportColumns(words),
          rows: shown.map((entry) => entryExportLine(entry, words)),
        });
        saveFile(bytes, savedFileName(name, "xlsx", t("finance-entries-title")), XLSX_TYPE);
      }
      setNote({ severity: "success", text: t("finance-export-done", { count: shown.length }) });
    } catch {
      setNote({ severity: "error", text: t("finance-error-failed") });
    } finally {
      setExporting(false);
    }
  };

  const markApart = async (entry: FinanceEntryRow, apart: boolean) => {
    setNote(null);
    const result = await setFinanceMoneyApart(entry.id, apart);
    if (!result.ok) setNote({ severity: "error", text: t(financeErrorKey(result.code)) });
    else router.refresh();
  };

  const actionsOf = (entry: FinanceEntryRow): QuickAction[] => [
    ...(entry.apart === "owed"
      ? [{ key: "apart", label: t("finance-apart-mark"), onClick: () => void markApart(entry, true) }]
      : []),
    ...(entry.apart === "apart" && entry.kind === "client_money"
      ? [{ key: "unapart", label: t("finance-apart-undo"), onClick: () => void markApart(entry, false) }]
      : []),
    { key: "cancel", label: t("finance-entry-cancel"), onClick: () => setCancelling(entry) },
  ];

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("finance-entries-title")}
        crumbs={[{ label: t("finance-crumb"), href: "/financeiro" }, { label: t("finance-entries-title") }]}
        description={t("finance-entries-description")}
      />
      <ListBar
        label={t("finance-entries-title")}
        viewsTitle={t("list-views-title")}
        views={views}
        view={view}
        onView={(key) => setView(key as View)}
        search={{
          label: t("list-bar-search"),
          placeholder: t("finance-entries-search"),
          value: search,
          onChange: setSearch,
        }}
        exporting={
          state.supportVisit || shown.length === 0
            ? undefined
            : {
                label: t("finance-export"),
                busy: exporting,
                formats: [
                  { key: "xlsx", label: t("finance-export-xlsx"), onClick: () => void exportAs("xlsx") },
                  { key: "pdf", label: t("finance-export-pdf"), onClick: () => void exportAs("pdf") },
                ],
              }
        }
        create={
          writes
            ? {
                label: t("finance-new"),
                actions: (["income", "expense", "transfer", "client_money", "partner"] as ManualKind[]).map((kind) => ({
                  key: kind,
                  label: t(NEW_KEY[kind]),
                  onClick: () => setWriting(kind),
                })),
              }
            : undefined
        }
      />
      {note ? (
        <Alert severity={note.severity} className="neutral bg-background-paper/60!" role="status">
          {note.text}
        </Alert>
      ) : null}
      <Card>
        <CardContent>
          {shown.length === 0 ? (
            <EmptyState
              icon={<NiMoney size="large" />}
              illustration={<IllustrationAnalytics />}
              title={entries.length === 0 ? t("finance-latest-empty") : t("finance-entries-none-here")}
              description={entries.length === 0 ? t("finance-latest-empty-body") : undefined}
              titleAs="h2"
              framed={false}
            />
          ) : (
            <Box component="ul" className="m-0 flex list-none flex-col p-0">
              {shown.map((entry) => (
                <Box
                  component="li"
                  key={entry.id}
                  className="border-grey-100 flex items-start justify-between gap-3 border-b py-3 last:border-b-0"
                >
                  <Box className="flex min-w-0 flex-col gap-1">
                    <Typography
                      variant="body1"
                      className={entry.cancelled ? "text-text-secondary line-through" : undefined}
                    >
                      {entry.counterparty ?? entry.description ?? entry.category ?? t(ENTRY_KIND_KEY[entry.kind])}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {[dayLabel(entry.occurredOn), entry.category ?? t(ENTRY_KIND_KEY[entry.kind]), entry.account]
                        .filter(Boolean)
                        .join(" · ")}
                    </Typography>
                    {entry.cancelled && entry.cancelledReason ? (
                      <Typography variant="body2" className="text-text-secondary">
                        {t("finance-entry-cancelled", { reason: entry.cancelledReason })}
                      </Typography>
                    ) : null}
                    {entry.apart === "owed" ? (
                      <StateLine tone="attention">{t("finance-apart-line-owed")}</StateLine>
                    ) : entry.apart === "apart" ? (
                      <StateLine tone="done">{t("finance-apart-line-done")}</StateLine>
                    ) : null}
                    {entry.byOne ? (
                      <Box>
                        <StatusChip tone="neutral" label={t("finance-by-one")} />
                      </Box>
                    ) : null}
                  </Box>
                  <Box className="flex shrink-0 items-start gap-2">
                    <Typography variant="body1" className="tabular-nums">
                      {money(entry.cents)}
                    </Typography>
                    {writes && !entry.cancelled ? (
                      <QuickActions label={t("finance-entry-actions")} actions={actionsOf(entry)} />
                    ) : null}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>

      {writing ? (
        <EntryPanel
          kind={writing}
          registrations={state.registrations}
          onClose={() => setWriting(null)}
          onSaved={() => {
            setWriting(null);
            router.refresh();
          }}
        />
      ) : null}
      {cancelling ? (
        <ConfirmActionDialog
          title={t("finance-entry-cancel-title")}
          intro={t("finance-entry-cancel-intro", { value: money(cancelling.cents) })}
          consequences={[
            t("finance-entry-cancel-kept"),
            ...(cancelling.transferId ? [t("finance-entry-cancel-transfer")] : []),
            ...(cancelling.fromStatement ? [t("finance-entry-cancel-line")] : []),
          ]}
          reasonLabel={t("finance-field-reason")}
          reasonMinLength={3}
          requireReason
          confirmLabel={t("finance-entry-cancel")}
          cancelLabel={t("finance-cancel")}
          tone="warning"
          onClose={() => setCancelling(null)}
          onConfirm={async (reason) => {
            const result = await cancelFinanceEntry(cancelling.id, reason);
            if (!result.ok) return t(financeErrorKey(result.code));
            setCancelling(null);
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </Box>
  );
}
