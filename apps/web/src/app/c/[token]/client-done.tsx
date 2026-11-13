"use client";

import { CardHead, IconLead, SectionFrame } from "./client-section";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { Box, ButtonBase, Card, CardContent, Collapse, Typography } from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import { cn } from "@/lib/utils";

export type DoneRow = {
  key: string;
  title: string;
  /** Where it stands, in a few words: "assinada em 14/10", "4 aceitos". */
  summary: string;
  /** The section as it is, opened from its line. */
  detail: ReactNode;
};

/**
 * What the client already did, one line each (the owner, 2026-11-13: seven cards of what was done took the page while
 * one thing was asked): the thing, where it stands in a few words, and the section as it was, opened from its line to
 * read or to do again.
 */
export default function ClientDone({ rows }: { rows: DoneRow[] }) {
  const t = useTranslations("product");
  const [open, setOpen] = useState<string | null>(null);
  if (rows.length === 0) return null;
  return (
    <Card component="section" aria-labelledby="client-done">
      <CardContent className="flex flex-col gap-2">
        <CardHead
          id="client-done"
          lead={<IconLead icon={<NiCheck size="medium" />} tone="done" />}
          title={t("client-done-title")}
        />
        <Box component="ul" className="m-0 flex list-none flex-col p-0">
          {rows.map((row) => {
            const shown = open === row.key;
            return (
              <Box component="li" key={row.key} className="border-grey-100 border-t">
                <ButtonBase
                  onClick={() => setOpen(shown ? null : row.key)}
                  aria-expanded={shown}
                  aria-controls={`client-done-${row.key}`}
                  className="flex w-full items-center justify-between gap-3 rounded-md py-3 text-left"
                >
                  <Typography variant="body2" component="span" className="min-w-0 break-words">
                    <span className="font-semibold">{row.title}</span>
                    {row.summary ? <span className="text-text-secondary">{` · ${row.summary}`}</span> : null}
                  </Typography>
                  <span
                    aria-hidden
                    className={cn("text-text-secondary flex flex-none transition-transform", shown && "rotate-90")}
                  >
                    <NiChevronRightSmall size="small" />
                  </span>
                </ButtonBase>
                <Collapse in={shown} unmountOnExit>
                  <Box id={`client-done-${row.key}`} className="flex flex-col gap-4 pb-4">
                    <SectionFrame>{row.detail}</SectionFrame>
                  </Box>
                </Collapse>
              </Box>
            );
          })}
        </Box>
      </CardContent>
    </Card>
  );
}
