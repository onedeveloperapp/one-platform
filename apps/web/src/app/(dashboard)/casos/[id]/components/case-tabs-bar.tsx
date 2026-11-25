"use client";

import { useTranslations } from "next-intl";

import { Box, Card, Tab, Tabs } from "@mui/material";

import { CASE_TABS, type CaseTab, type TabMark } from "@/lib/cases/case-tabs";
import { cn } from "@/lib/utils";

/** The name of each tab. */
export const TAB_KEY: Record<CaseTab, string> = {
  cliente: "case-tab-cliente",
  documentos: "case-tab-documentos",
  acao: "case-tab-acao",
  processo: "case-tab-processo",
  dinheiro: "case-tab-dinheiro",
  historico: "case-tab-historico",
};

/** What a tab holds, in a line over its cards. */
export const TAB_HINT_KEY: Record<CaseTab, string> = {
  cliente: "case-tab-cliente-hint",
  documentos: "case-tab-documentos-hint",
  acao: "case-tab-acao-hint",
  processo: "case-tab-processo-hint",
  dinheiro: "case-tab-dinheiro-hint",
  historico: "case-tab-historico-hint",
};

const MARK_KEY: Record<TabMark["tone"], string> = {
  failed: "case-tab-mark-failed",
  firm: "case-tab-mark-firm",
  working: "case-tab-mark-working",
  client: "case-tab-mark-client",
};

/** The dot before a tab's mark, in the colour the cards' heads give the same state; the words say the state too. */
const MARK_DOT: Record<TabMark["tone"], string> = {
  failed: "bg-error",
  firm: "bg-accent-3",
  working: "bg-accent-4 animate-pulse motion-reduce:animate-none",
  client: "border-accent-4 border-[1.5px] border-solid",
};

/**
 * The strip of the case's tabs (the owner's canvas "ONE · O caso em abas", 2026-11-25): each tab says under its name
 * what waits in it, with the words the cards' heads use, so a tab out of sight never hides what asks for the firm; a
 * tab whose cards changed a moment ago is marked for a while. Across the page from a tablet on; on a phone it scrolls
 * sideways, the open one brought into view.
 *
 * Closest catalog entries: none of the product layer; it is MUI's Tabs in the template's underlined look
 * (`style/navigation/tabs.css`, `.underlined`), on a Card like every block of the case.
 */
export default function CaseTabsBar({
  tab,
  marks,
  flashed,
  onPick,
}: {
  tab: CaseTab;
  marks: Record<CaseTab, TabMark | null>;
  /** The tabs whose cards changed with the latest reading. */
  flashed: ReadonlySet<CaseTab>;
  onPick: (tab: CaseTab) => void;
}) {
  const t = useTranslations("product");
  return (
    <Card className="px-2">
      <Tabs
        value={tab}
        onChange={(_, value: CaseTab) => onPick(value)}
        variant="scrollable"
        scrollButtons={false}
        aria-label={t("case-tabs-label")}
        className="underlined border-b-0"
      >
        {CASE_TABS.map((key) => {
          const mark = marks[key];
          return (
            <Tab
              key={key}
              value={key}
              id={`case-tab-${key}`}
              aria-controls={`case-panel-${key}`}
              className="min-h-16 md:max-w-none md:flex-1"
              label={
                <Box
                  component="span"
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-lg px-2 py-0.5 transition-colors duration-500 motion-reduce:transition-none",
                    flashed.has(key) && key !== tab && "bg-primary-light/10",
                  )}
                >
                  <span>{t(TAB_KEY[key])}</span>
                  {mark ? (
                    <Box
                      component="span"
                      className="text-text-secondary inline-flex items-center gap-1.5 text-xs font-semibold"
                    >
                      <Box
                        component="span"
                        aria-hidden
                        className={cn("size-2 flex-none rounded-full", MARK_DOT[mark.tone])}
                      />
                      {t(MARK_KEY[mark.tone], { count: mark.count })}
                    </Box>
                  ) : null}
                </Box>
              }
            />
          );
        })}
      </Tabs>
    </Card>
  );
}
