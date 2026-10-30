"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, Button } from "@mui/material";

import ModuleIcon from "@/components/product/module-icon";
import NiPuzzle from "@/icons/nexture/ni-puzzle";
import { type ModuleCard, scopedHref } from "@/lib/modules/offer";

/**
 * Which modules a page of the firm's work shows (migration 0078): every module the firm contracted, or one. A
 * page of the work (the cases, the conversations, the approvals, the filing queue, the deadlines, the hearings, the
 * publications) is the firm's; under a module it shows only what is of a case of that module, which is how a
 * module's area leads into it. The choice is the address (`?modulo=`), so a page under a module is a link anybody
 * of the firm can open and the back button undoes it.
 *
 * Closest catalog entries: the filter tiles (`StatTile`) choose within a page's list; this chooses whose list the
 * page is, so it sits above them as links, never as a filter that keeps a state of its own.
 */
export default function ModuleScope({
  path,
  modules,
  current,
  keep,
}: {
  /** The page's own address, with no query. */
  path: string;
  /** The modules the firm contracted, in the catalog's order. */
  modules: readonly ModuleCard[];
  /** The module the page shows, or null for every module. */
  current: string | null;
  /** What else of the address a change of module keeps (a list's view). */
  keep?: Record<string, string | null | undefined>;
}) {
  const t = useTranslations("product");
  if (modules.length === 0) return null;
  return (
    <Box component="nav" aria-label={t("module-scope-label")} className="flex flex-wrap items-center gap-2">
      <Button
        component={Link}
        href={scopedHref(path, null, keep)}
        size="small"
        variant={current === null ? "contained" : "outlined"}
        color={current === null ? "primary" : "grey"}
        startIcon={<NiPuzzle size="small" />}
        aria-current={current === null ? "page" : undefined}
      >
        {t("module-scope-all")}
      </Button>
      {modules.map((module) => (
        <Button
          key={module.key}
          component={Link}
          href={scopedHref(path, module.key, keep)}
          size="small"
          variant={current === module.key ? "contained" : "outlined"}
          color={current === module.key ? "primary" : "grey"}
          startIcon={<ModuleIcon name={module.icon} size="small" />}
          aria-current={current === module.key ? "page" : undefined}
        >
          {module.name}
        </Button>
      ))}
    </Box>
  );
}
