"use client";

import SettingsFrame from "../../components/settings-frame";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button } from "@mui/material";

import ClaimValueCard from "@/components/firm/claim-value-card";
import DecidesNotice from "@/components/firm/decides-notice";
import SettlementFloorCard from "@/components/firm/settlement-floor-card";
import CollapsibleCard from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import StateLine from "@/components/product/state-line";
import NiUsers from "@/icons/nexture/ni-users";
import type { SecondFactorState } from "@/lib/ai/approvals";
import type { ClaimDefault } from "@/lib/firm/autonomy";
import { caseKindsOf } from "@/lib/modules/registry";
import FirmClauseFields, { type FirmClause, useFirmClause } from "@/modules/direito-do-passageiro/firm-clause";
import { PASSENGER_MODULE } from "@/modules/direito-do-passageiro/incidents";

export type PassengerSettingsState =
  | {
      kind: "ready";
      /** The module's name as ONE's catalog says it; null when it could not be read. */
      moduleName: string | null;
      /** Decides for the firm what a partner decides: a partner, or, in a firm with no partner, who manages it (0078). */
      decides: boolean;
      secondFactor: SecondFactorState;
      supportVisit: boolean;
      /** The values of this module's kinds of problem; null when they could not be read. */
      claimDefaults: ClaimDefault[] | null;
      clause: FirmClause;
      clauseRead: boolean;
      /** ONE's proposal of the clause written for the firm; null when there is none to read. */
      proposal: string | null;
    }
  | { kind: "not-contracted" }
  | { kind: "no-firm" }
  | { kind: "unavailable" };

/**
 * The passenger module's own settings: the Valor da Causa Pedido and the settlement floor of each kind of air-passenger
 * problem, and the clause the partner agencies register. The same cards as the module's setup, which asks them once;
 * here the firm reads and changes them any time. The partner agencies are the next item of the module in the menu.
 */
export default function PassengerSettingsView({ state }: { state: PassengerSettingsState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const refresh = () => router.refresh();
  const ready = state.kind === "ready" ? state : null;
  const name = ready?.moduleName ?? t("module-passenger");
  const editable = ready !== null && ready.decides && !ready.supportVisit && ready.secondFactor === "ok";
  const kinds = caseKindsOf(PASSENGER_MODULE);

  return (
    <SettingsFrame active="module" title={name} crumb={name} description={t("settings-module-description")}>
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
      {state.kind === "not-contracted" ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("module-setup-not-contracted")}
        </Alert>
      ) : null}
      {ready ? (
        <>
          <DecidesNotice
            decides={ready.decides}
            supportVisit={ready.supportVisit}
            secondFactor={ready.secondFactor}
            next="/settings/direito-do-passageiro"
          />
          <ClaimValueCard defaults={ready.claimDefaults} kinds={kinds} editable={editable} onSaved={refresh} />
          <SettlementFloorCard editable={editable} kinds={kinds} />
          <ClauseCard state={ready} editable={editable} onSaved={refresh} />
        </>
      ) : null}
    </SettingsFrame>
  );
}

/** The words of the clause the agencies register: the version in force, and a new one registered by who decides. */
function ClauseCard({
  state,
  editable,
  onSaved,
}: {
  state: Extract<PassengerSettingsState, { kind: "ready" }>;
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const draft = useFirmClause({ clause: state.clause, proposal: state.proposal, editable, onSaved });
  const register = async () => {
    setBusy(true);
    setSaved(false);
    try {
      if (await draft.save()) setSaved(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <CollapsibleCard
      id="clausula-das-agencias-title"
      anchor="clausula-das-agencias"
      title={t("pax-setup-clause-title")}
      summary={
        state.clause ? t("pax-clause-version", { version: state.clause.version }) : t("settings-module-clause-none")
      }
      description={t("settings-module-clause-description")}
      defaultOpen={!state.clauseRead}
      bodyClassName="gap-3"
    >
      <FirmClauseFields
        draft={draft}
        clause={state.clause}
        clauseRead={state.clauseRead}
        proposal={state.proposal}
        decides={state.decides}
      />
      {editable ? (
        <Box>
          <Button
            variant="contained"
            size="small"
            disabled={busy || draft.change.kind === "same"}
            onClick={() => void register()}
          >
            {busy ? t("cases-working") : draft.inForce ? t("pax-clause-save") : t("pax-setup-clause-register")}
          </Button>
        </Box>
      ) : null}
      {saved ? <StateLine tone="done">{t("settings-module-clause-saved")}</StateLine> : null}
    </CollapsibleCard>
  );
}
