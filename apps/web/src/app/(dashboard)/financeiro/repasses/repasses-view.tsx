"use client";

import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { Alert, Box, Card, CardContent, Grid } from "@mui/material";

import MoneyShares from "@/components/finance/money-shares";
import NumberCard from "@/components/product/number-card";
import PageHeader from "@/components/product/page-header";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiClock from "@/icons/nexture/ni-clock";
import NiExclamationSquare from "@/icons/nexture/ni-exclamation-square";
import NiMoney from "@/icons/nexture/ni-money";
import { type MoneyShare, shareLate } from "@/lib/finance/money";
import { formatCents } from "@flyee/rules/finance";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * The transfers to clients (phase 10): what the firm owes its clients of what the courts released, by its day, what is
 * late in red, what is held for a partner or for the judge, and what was passed on. Success is nothing late and every
 * client who received confirming it on their link. ONE never pays: the firm pays at its bank and records it here.
 */
export default function RepassesView({ reads }: { reads: boolean }) {
  const t = useTranslations("product");
  const [shares, setShares] = useState<MoneyShare[]>([]);
  const loaded = useCallback((read: MoneyShare[]) => setShares(read), []);
  const now = today();
  const owed = shares.filter((share) => share.status === "owed");
  const late = owed.filter((share) => shareLate(share, now));
  const held = shares.filter((share) => share.status === "held" || share.status === "minor");
  const paid = shares.filter((share) => share.status === "paid");
  const sum = (list: MoneyShare[], pick: (share: MoneyShare) => number) =>
    formatCents(list.reduce((acc, share) => acc + pick(share), 0));

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("money-title")}
        crumbs={[
          { label: t("approvals-home"), href: "/inicio" },
          { label: t("finance-title"), href: "/financeiro" },
          { label: t("money-title") },
        ]}
        description={t("money-description")}
      />
      {!reads ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("money-not-reader")}
        </Alert>
      ) : (
        <>
          <Grid container spacing={2.5}>
            <Grid size={{ xs: 6, lg: 3 }}>
              <NumberCard
                icon={<NiMoney size="medium" />}
                tone="primary"
                label={t("money-number-owed")}
                value={sum(owed, (share) => share.payableCents)}
              />
            </Grid>
            <Grid size={{ xs: 6, lg: 3 }}>
              <NumberCard
                icon={<NiClock size="medium" />}
                tone="accent-3"
                label={t("money-number-late")}
                value={String(late.length)}
              />
            </Grid>
            <Grid size={{ xs: 6, lg: 3 }}>
              <NumberCard
                icon={<NiExclamationSquare size="medium" />}
                tone="accent-4"
                label={t("money-number-held")}
                value={String(held.length)}
              />
            </Grid>
            <Grid size={{ xs: 6, lg: 3 }}>
              <NumberCard
                icon={<NiCheckSquare size="medium" />}
                tone="secondary"
                label={t("money-number-paid")}
                value={sum(paid, (share) => share.payableCents)}
              />
            </Grid>
          </Grid>
          <Card component="section" aria-label={t("money-title")}>
            <CardContent>
              <MoneyShares caseId={null} onLoaded={loaded} />
            </CardContent>
          </Card>
        </>
      )}
    </Box>
  );
}
