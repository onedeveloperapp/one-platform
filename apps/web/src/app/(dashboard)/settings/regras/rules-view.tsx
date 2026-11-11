"use client";

import SettingsFrame from "../components/settings-frame";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Alert, Button } from "@mui/material";

import DecidesNotice from "@/components/firm/decides-notice";
import InternalDeadlineCard from "@/components/firm/internal-deadline-card";
import SignersCard, { type FirmSigner } from "@/components/firm/signers-card";
import ThirdPartyBillCard, { type ThirdPartyMonth } from "@/components/firm/third-party-bill-card";
import EmptyState from "@/components/product/empty-state";
import NiUsers from "@/icons/nexture/ni-users";
import type { SecondFactorState } from "@/lib/ai/approvals";
import type { ThirdPartyBillPolicy } from "@/lib/firm/third-party-bill-actions";

export type RulesState =
  | {
      kind: "ready";
      /** Decides for the firm what a partner decides: a partner, or, in a firm with no partner, who manages it (0078). */
      decides: boolean;
      secondFactor: SecondFactorState;
      supportVisit: boolean;
      /** Null when who signs could not be read: its card says so. */
      signers: FirmSigner[] | null;
      /** Null when it could not be read. */
      thirdParty: { policy: ThirdPartyBillPolicy; month: ThirdPartyMonth | null } | null;
      /** The internal deadline, and whether this person sets it (a partner or the controladoria); null unread. */
      internal: {
        days: number;
        byAct: Record<string, number>;
        acts: { slug: string; name: string }[];
        sets: boolean;
      } | null;
    }
  | { kind: "no-firm" }
  | { kind: "unavailable" };

/**
 * The firm's rules of the cases: what ONE follows in every case, which the firm sets once and nobody decides case by
 * case. Who signs what ONE prepares, the bill in somebody else's name and the internal deadline. Anybody of the firm
 * reads how the firm works; who decides for it changes who signs and the bill, and a partner or the controladoria the
 * internal deadline.
 */
export default function RulesView({ state }: { state: RulesState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const refresh = () => router.refresh();
  const ready = state.kind === "ready" ? state : null;

  return (
    <SettingsFrame
      active="rules"
      title={t("settings-rules-title")}
      crumb={t("settings-rules")}
      description={t("settings-rules-description")}
    >
      {state.kind === "unavailable" ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("settings-unavailable")}
        </Alert>
      ) : null}
      {state.kind === "no-firm" ? (
        <EmptyState
          icon={<NiUsers size="large" />}
          title={t("team-no-firm-title")}
          description={t("team-no-firm-body")}
          action={{ label: t("team-no-firm-action"), href: "/admin" }}
        />
      ) : null}
      {ready ? (
        <>
          <DecidesNotice
            decides={ready.decides}
            supportVisit={ready.supportVisit}
            secondFactor={ready.secondFactor}
            next="/settings/regras"
          />
          <SignersCard
            signers={ready.signers}
            editable={ready.decides && !ready.supportVisit && ready.secondFactor === "ok"}
            onSaved={refresh}
          />
          {ready.thirdParty ? (
            <ThirdPartyBillCard
              policy={ready.thirdParty.policy}
              decides={ready.decides}
              supportVisit={ready.supportVisit}
              month={ready.thirdParty.month}
              onSaved={refresh}
            />
          ) : null}
          {ready.internal ? (
            <InternalDeadlineCard
              days={ready.internal.days}
              byAct={ready.internal.byAct}
              acts={ready.internal.acts}
              sets={ready.internal.sets}
              supportVisit={ready.supportVisit}
            />
          ) : (
            <Alert
              severity="error"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" onClick={refresh}>
                  {t("autonomy-retry")}
                </Button>
              }
            >
              {t("rules-internal-load-error")}
            </Alert>
          )}
        </>
      ) : null}
    </SettingsFrame>
  );
}
