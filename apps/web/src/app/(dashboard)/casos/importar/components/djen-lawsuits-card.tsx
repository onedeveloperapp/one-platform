"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Skeleton } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import StateLine from "@/components/product/state-line";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import { writeWorkbook } from "@/lib/export/xlsx-write";
import { readFirmDjenLawsuits } from "@/lib/import/djen-actions";
import { type DjenLawsuit, djenLawsuitsSheet } from "@/lib/import/djen-lawsuits";

/**
 * The migration by the OAB from the DJEN (migration 0208): the lawsuits the DJEN already shows of the firm's lawyers
 * that the firm has no lawsuit of yet, offered as a spreadsheet in the import's own columns. The firm writes each
 * client's name and sends it back through the import below, which checks every line again.
 */
export default function DjenLawsuitsCard() {
  const t = useTranslations("product");
  // undefined while it is read; null where the person may not bring lawsuits in (the card is not theirs); "failed"
  // when the read failed, said with the way to try again.
  const [read, setRead] = useState<{ total: number; lawsuits: DjenLawsuit[] } | null | "failed" | undefined>(undefined);

  const load = () => {
    setRead(undefined);
    void readFirmDjenLawsuits()
      .then((answer) =>
        setRead(
          answer.ok
            ? { total: answer.total, lawsuits: answer.lawsuits }
            : answer.code === "not_allowed" || answer.code === "support_visit"
              ? null
              : "failed",
        ),
      )
      .catch(() => setRead("failed"));
  };

  useEffect(() => {
    load();
  }, []);

  const download = () => {
    if (!read || read === "failed" || read.lawsuits.length === 0) return;
    const bytes = writeWorkbook([djenLawsuitsSheet(read.lawsuits)]);
    const blob = new Blob([bytes as BlobPart], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "processos-do-djen.xlsx";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (read === null) return null;

  return (
    <Card component="section" aria-labelledby="import-djen-title" className="mx-auto w-full max-w-2xl">
      <CardContent className="flex flex-col gap-4">
        <CardTitle
          id="import-djen-title"
          icon={<NiDocumentCheck size="medium" />}
          title={t("import-djen-title")}
          description={t("import-djen-hint")}
        />
        {read === undefined ? (
          <Skeleton variant="rounded" height={56} />
        ) : read === "failed" ? (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" onClick={load}>
                {t("cases-retry")}
              </Button>
            }
          >
            {t("import-djen-failed")}
          </Alert>
        ) : read.total === 0 ? (
          <StateLine tone="info">{t("import-djen-none")}</StateLine>
        ) : (
          <>
            <StateLine tone="attention">{t("import-djen-found", { count: read.total })}</StateLine>
            {read.total > read.lawsuits.length ? (
              <Alert severity="info" className="neutral bg-background-paper/60!">
                {t("import-djen-partial", { shown: read.lawsuits.length })}
              </Alert>
            ) : null}
            <Box>
              <Button variant="contained" onClick={download}>
                {t("import-djen-download")}
              </Button>
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}
