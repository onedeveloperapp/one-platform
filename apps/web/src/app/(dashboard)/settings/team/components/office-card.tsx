"use client";

import type { TeamData } from "../team-types";
import { useTranslations } from "next-intl";

import { Grid } from "@mui/material";

import OfficeForm from "@/components/firm/office-form";
import CollapsibleCard from "@/components/product/collapsible-card";
import StateLine from "@/components/product/state-line";
import { officeAddressGiven } from "@/lib/firm/office";

/**
 * Where the firm is, for who manages the firm account (migration 0217): what the power of attorney ONE prepares says
 * of the firm and of its lawyers, the address, the e-mail and the registration of the society at the bar (CPC, art.
 * 105, §§ 2º and 3º, and art. 287). Until the address is given the power of attorney goes without it, and this card
 * says so.
 */
export default function OfficeCard({ data, onChanged }: { data: TeamData; onChanged: () => void }) {
  const t = useTranslations("product");
  const given = officeAddressGiven(data.office);
  return (
    <Grid size={12}>
      <CollapsibleCard
        id="team-office"
        title={t("office-title")}
        summary={t(given ? "office-summary-given" : "office-summary-missing")}
        description={t("office-body")}
        bodyClassName="gap-5"
      >
        {given ? null : <StateLine tone="attention">{t("office-missing")}</StateLine>}
        <OfficeForm office={data.office} onSaved={onChanged} />
      </CollapsibleCard>
    </Grid>
  );
}
