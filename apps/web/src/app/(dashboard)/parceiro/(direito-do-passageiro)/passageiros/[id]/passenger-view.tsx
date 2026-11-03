"use client";

import AgreementCard from "./components/agreement-card";
import DocumentsCard from "./components/documents-card";
import PersonCard from "./components/person-card";
import PrivacyCard from "./components/privacy-card";
import TripsCard from "./components/trips-card";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Alert, Button, Grid } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import PageHeader from "@/components/product/page-header";
import NiUserCross from "@/icons/nexture/ni-user-cross";
import type { FlightsRead } from "@/modules/direito-do-passageiro/agency/flight-progress-actions";
import { CONSENT_KEY, type PaxDetail } from "@/modules/direito-do-passageiro/agency/passengers";

export type PassengerState =
  | { kind: "missing" }
  | { kind: "failed" }
  | {
      kind: "ready";
      detail: PaxDetail;
      firm: string;
      hasClause: boolean;
      today: string;
      manager: boolean;
      flights: FlightsRead;
    };

/**
 * One passenger, as the agency works on them. Who comes here wants the passenger ready for a problem with a
 * flight: their data right, their documents read, their trips with every leg, and the link on which they agree
 * sent. Success is a passenger who agreed, whose trips ONE follows, with an identity read.
 */
export default function PassengerView({ state }: { state: PassengerState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const crumbs = [
    { label: t("partner-home-title"), href: "/parceiro" },
    { label: t("pax-title"), href: "/parceiro/passageiros" },
  ];

  if (state.kind !== "ready") {
    return (
      <Grid container spacing={5}>
        <Grid size={12}>
          <PageHeader title={t("pax-detail-title")} crumbs={[...crumbs, { label: t("pax-detail-title") }]} />
        </Grid>
        <Grid size={12}>
          {state.kind === "missing" ? (
            <EmptyState
              icon={<NiUserCross size="large" />}
              title={t("pax-detail-missing-title")}
              description={t("pax-detail-missing-body")}
              action={{ label: t("pax-detail-back"), href: "/parceiro/passageiros" }}
            />
          ) : (
            <Alert
              severity="error"
              action={
                <Button color="inherit" size="small" onClick={() => router.refresh()}>
                  {t("pax-retry")}
                </Button>
              }
            >
              {t("pax-detail-read-error")}
            </Alert>
          )}
        </Grid>
      </Grid>
    );
  }

  const { detail } = state;
  const traveler = detail.traveler;
  const consent = detail.consent ?? "none";
  const summary = traveler.minor
    ? detail.guardian
      ? t("pax-detail-minor-of", { name: detail.guardian.fullName })
      : t("pax-detail-minor-alone")
    : t(CONSENT_KEY[consent]);
  const refresh = () => router.refresh();

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <PageHeader
          title={traveler.fullName}
          crumbs={[...crumbs, { label: traveler.fullName }]}
          description={summary}
        />
      </Grid>
      {traveler.handedOver && (
        <Grid size={12}>
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("pax-detail-handed-over", { firm: state.firm })}
          </Alert>
        </Grid>
      )}
      <Grid size={{ xs: 12, lg: 7 }}>
        <PersonCard detail={detail} today={state.today} onSaved={refresh} />
      </Grid>
      <Grid size={{ xs: 12, lg: 5 }}>
        <AgreementCard detail={detail} hasClause={state.hasClause} onIssued={refresh} />
      </Grid>
      <Grid size={12}>
        <DocumentsCard detail={detail} onChanged={refresh} />
      </Grid>
      <Grid size={12}>
        <TripsCard detail={detail} flights={state.flights} onChanged={refresh} />
      </Grid>
      <Grid size={12}>
        <PrivacyCard detail={detail} manager={state.manager} />
      </Grid>
    </Grid>
  );
}
