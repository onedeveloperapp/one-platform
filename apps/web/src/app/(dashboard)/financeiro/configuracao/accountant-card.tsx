"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, TextField } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import QuickActions from "@/components/product/quick-actions";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import IllustrationAccounts from "@/icons/illustrations/illustration-accounts";
import NiUser from "@/icons/nexture/ni-user";
import { removeFinanceAccountant, saveFinanceAccountant } from "@/lib/finance/accountant-actions";
import type { FinanceAccountant } from "@/lib/finance/read";

const ERROR_KEY: Record<string, string> = {
  not_allowed: "accountant-error-not-allowed",
  second_factor: "accountant-error-second-factor",
  support_visit: "accountant-error-support",
};
const FIELD_KEY: Record<string, string> = {
  name: "accountant-error-name",
  email: "accountant-error-email",
  office: "accountant-error-office",
  crc: "accountant-error-crc",
};
const errorKey = (code: string, field?: string) =>
  (code === "invalid_data" && field ? FIELD_KEY[field] : ERROR_KEY[code]) ?? "accountant-error-failed";
const SEND_KEY = {
  sending: "accountant-send-sending",
  sent: "accountant-send-sent",
  failed: "accountant-send-failed",
} as const;
const SEND_TONE = { sending: "waiting", sent: "done", failed: "failed" } as const;

/**
 * The firm's accountant (migration 0166), who the month's package goes to by e-mail: registered, changed and taken off
 * by who configures the books, with the second factor; the latest sendings with what came of each.
 */
export default function AccountantCard({
  accountant,
  configures,
  factor,
}: {
  accountant: FinanceAccountant | null;
  configures: boolean;
  factor: "ok" | "challenge" | "missing";
}) {
  const t = useTranslations("product");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [factorOk, setFactorOk] = useState(factor === "ok");

  return (
    <Card component="section" id="contador" aria-labelledby="finance-settings-accountant">
      <CardContent className="flex flex-col gap-4">
        <CardTitle
          id="finance-settings-accountant"
          icon={<NiUser size="medium" />}
          tone="accent-4"
          title={t("accountant-title")}
          description={t("accountant-description")}
          actions={
            configures && accountant ? (
              <QuickActions
                label={t("accountant-actions")}
                actions={[
                  { key: "change", label: t("accountant-change"), onClick: () => setEditing(true) },
                  { key: "remove", label: t("accountant-remove"), onClick: () => setRemoving(true) },
                ]}
              />
            ) : configures ? (
              <Button size="small" variant="outlined" color="grey" onClick={() => setEditing(true)}>
                {t("accountant-add")}
              </Button>
            ) : undefined
          }
        />
        {accountant ? (
          <Box className="flex flex-col gap-1">
            <StateLine tone="done">
              {[
                accountant.name,
                accountant.office,
                accountant.crc ? t("accountant-crc", { crc: accountant.crc }) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </StateLine>
            <StateLine tone="info">{accountant.email}</StateLine>
            {accountant.sends.map((send) => (
              <StateLine key={`${send.month}-${send.at}`} tone={SEND_TONE[send.status]}>
                {t(SEND_KEY[send.status], { month: send.month.split("-").reverse().join("/") })}
              </StateLine>
            ))}
          </Box>
        ) : (
          <EmptyState
            illustration={<IllustrationAccounts />}
            layout="row"
            framed={false}
            title={t("accountant-none")}
            titleAs="h3"
          />
        )}
      </CardContent>
      {editing ? (
        <AccountantPanel
          accountant={accountant}
          factor={factorOk ? "ok" : factor}
          onFactor={() => setFactorOk(true)}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            router.refresh();
          }}
        />
      ) : null}
      {removing && accountant ? (
        <ConfirmActionDialog
          title={t("accountant-remove-title")}
          intro={t("accountant-remove-intro", { name: accountant.name })}
          consequences={[t("accountant-remove-kept")]}
          confirmLabel={t("accountant-remove")}
          cancelLabel={t("accountant-cancel")}
          tone="warning"
          blocked={!factorOk}
          onClose={() => setRemoving(false)}
          onConfirm={async () => {
            const result = await removeFinanceAccountant();
            if (!result.ok) return t(errorKey(result.code));
            setRemoving(false);
            router.refresh();
            return null;
          }}
        >
          {!factorOk ? (
            <SecondFactorPrompt
              state={factor === "missing" ? "missing" : "challenge"}
              onConfirmed={() => setFactorOk(true)}
            />
          ) : null}
        </ConfirmActionDialog>
      ) : null}
    </Card>
  );
}

function AccountantPanel({
  accountant,
  factor,
  onFactor,
  onClose,
  onSaved,
}: {
  accountant: FinanceAccountant | null;
  factor: "ok" | "challenge" | "missing";
  onFactor: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [name, setName] = useState(accountant?.name ?? "");
  const [email, setEmail] = useState(accountant?.email ?? "");
  const [office, setOffice] = useState(accountant?.office ?? "");
  const [crc, setCrc] = useState(accountant?.crc ?? "");
  const [confirmed, setConfirmed] = useState(factor === "ok");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await saveFinanceAccountant({ name, email, office, crc });
      if (result.ok) return onSaved();
      if (result.code === "second_factor") setConfirmed(false);
      setProblem(t(errorKey(result.code, result.field)));
    } catch {
      setProblem(t("accountant-error-failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("accountant-cancel")}
      icon={<NiUser size="medium" />}
      tone="accent-4"
      busy={busy}
      title={t(accountant ? "accountant-change" : "accountant-add")}
      description={t("accountant-panel-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || !confirmed}>
            {t("accountant-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("accountant-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {problem}
          </Alert>
        ) : null}
        {!confirmed ? (
          <SecondFactorPrompt
            state={factor === "missing" ? "missing" : "challenge"}
            onConfirmed={() => {
              setConfirmed(true);
              onFactor();
            }}
          />
        ) : null}
        <TextField label={t("accountant-field-name")} value={name} onChange={(event) => setName(event.target.value)} />
        <TextField
          type="email"
          label={t("accountant-field-email")}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          helperText={t("accountant-field-email-help")}
        />
        <Box className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("accountant-field-office")}
            value={office}
            onChange={(event) => setOffice(event.target.value)}
          />
          <TextField
            label={t("accountant-field-crc")}
            value={crc}
            onChange={(event) => setCrc(event.target.value.toUpperCase().slice(0, 20))}
            helperText={t("accountant-field-crc-help")}
          />
        </Box>
      </Box>
    </SidePanel>
  );
}
