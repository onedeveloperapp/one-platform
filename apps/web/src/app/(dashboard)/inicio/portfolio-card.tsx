"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Button, Card, CardContent } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import StateLine from "@/components/product/state-line";
import NiFolder from "@/icons/nexture/ni-folder";
import type { PortfolioLines } from "@/lib/import/djen-cases";

/**
 * The firm's portfolio on the home (migration 0287), each line whose it is: the firm's step while it said it used a
 * system before ONE and brought nothing of it (the spreadsheet only the firm has), ONE's work with the lawsuits the
 * DJEN shows (done, and being done, never as the firm's task), and what only the firm gives of those cases (their
 * clients' CPF). Drawn only with something to say.
 */
export default function PortfolioCard({ lines }: { lines: PortfolioLines }) {
  const t = useTranslations("product");
  return (
    <Card component="section" aria-labelledby="home-portfolio-title">
      <CardContent className="flex flex-col gap-3">
        <CardTitle
          id="home-portfolio-title"
          icon={<NiFolder size="medium" />}
          title={t("home-portfolio-title")}
          description={t("home-portfolio-hint")}
        />
        {lines.bring !== null ? (
          <StateLine
            tone="attention"
            action={
              <Button variant="contained" size="small" href="/casos/importar" LinkComponent={Link}>
                {t("home-portfolio-bring-action")}
              </Button>
            }
          >
            {t("home-portfolio-bring", { system: lines.bring })}
          </StateLine>
        ) : null}
        {lines.withoutCpf > 0 ? (
          <StateLine
            tone="attention"
            action={
              <Button variant="outlined" size="small" href="/casos/importar" LinkComponent={Link}>
                {t("home-portfolio-cpf-action")}
              </Button>
            }
          >
            {t("home-portfolio-cpf", { count: lines.withoutCpf })}
          </StateLine>
        ) : null}
        {lines.opened > 0 ? (
          <StateLine tone="done">{t("home-portfolio-opened", { count: lines.opened })}</StateLine>
        ) : null}
        {lines.opening > 0 ? (
          <StateLine tone="waiting">{t("home-portfolio-opening", { count: lines.opening })}</StateLine>
        ) : null}
      </CardContent>
    </Card>
  );
}
