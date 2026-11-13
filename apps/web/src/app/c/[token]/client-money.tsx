"use client";

import { ClientSection } from "./client-section";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Checkbox, FormControlLabel, MenuItem, TextField, Typography } from "@mui/material";

import StateLine from "@/components/product/state-line";
import NiMoney from "@/icons/nexture/ni-money";
import {
  type ClientMoney as Money,
  clientMoney,
  clientMoneyStatements,
  downloadClientMoneyStatement,
} from "@/lib/cases/client-link-actions";
import { formatCents } from "@flyee/rules/finance";
import { formatDayBr } from "@flyee/rules/person";

const ERROR_KEY: Record<string, string> = {
  not_own_cpf: "client-money-error-own-cpf",
  invalid_data: "client-money-error-invalid",
};
const ACCOUNT_KEY: Record<string, string> = { pix: "client-money-account-pix", conta: "client-money-account-bank" };
const STATUS_KEY: Record<string, string> = {
  owed: "client-money-status-owed",
  held: "client-money-status-held",
  minor: "client-money-status-minor",
  paid: "client-money-status-paid",
  direct: "client-money-status-direct",
};

/**
 * "Valores do seu processo" on the client's link (migration 0135): what the court released for them (and for a child
 * they answer for), what the firm kept by the contract, what comes to them and when; the account they receive in,
 * always in their own CPF; and their word that they received. Hidden while there is nothing of theirs. The firm never
 * asks for money to release a value, and the card says so.
 */
export default function ClientMoney({ token, editable }: { token: string; editable: boolean }) {
  const t = useTranslations("product");
  const [money, setMoney] = useState<Money | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<"pix" | "conta">("pix");
  const [pix, setPix] = useState("");
  const [bank, setBank] = useState("");
  const [agency, setAgency] = useState("");
  const [account, setAccount] = useState("");
  const [own, setOwn] = useState(false);
  // The accountability statement of each part passed on (0156), by its part.
  const [statements, setStatements] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let live = true;
    void clientMoney(token)
      .then((answer) => {
        if (live && answer.ok) setMoney(answer.money);
      })
      .catch(() => undefined);
    void clientMoneyStatements(token)
      .then((answer) => {
        if (live && answer.ok) setStatements(new Map(answer.statements.map((item) => [item.shareId, item.id])));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [token]);

  // Shown once money is expected on the case, so the account is given before the court releases anything (0155).
  if (!money || (money.shares.length === 0 && !money.expected)) return null;

  const run = async (give: Parameters<typeof clientMoney>[1], confirm: string | null) => {
    setBusy(true);
    setProblem(null);
    try {
      const answer = await clientMoney(token, give, confirm);
      if (answer.ok) setMoney(answer.money);
      else setProblem(t(ERROR_KEY[answer.code] ?? "client-money-error-failed"));
    } catch {
      setProblem(t("client-money-error-failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ClientSection id="client-money" icon={<NiMoney size="medium" />} title={t("client-money-title")}>
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {problem}
        </Alert>
      ) : null}
      {money.shares.map((share) => (
        <Box key={share.id} className="border-grey-100 flex flex-col gap-1 border-b pb-3 last:border-b-0">
          <Typography variant="body1" className="font-semibold">
            {t(share.minor ? "client-money-share-minor" : "client-money-share-own", {
              value: formatCents(share.payableCents),
            })}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("client-money-line", {
              gross: formatCents(share.grossCents),
              fees: formatCents(share.feesCents),
              costs: formatCents(share.costsCents),
            })}
          </Typography>
          <StateLine tone={share.status === "paid" || share.status === "direct" ? "done" : "waiting"}>
            {t(STATUS_KEY[share.status] ?? "client-money-status-owed", {
              day: formatDayBr(share.paidOn ?? share.dueOn ?? "") ?? "",
            })}
          </StateLine>
          {statements.has(share.id) ? (
            <Box>
              <Button
                size="small"
                variant="text"
                disabled={busy}
                onClick={() =>
                  void downloadClientMoneyStatement(token, statements.get(share.id) as string)
                    .then((link) => {
                      if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
                      else setProblem(t("client-money-statement-error"));
                    })
                    .catch(() => setProblem(t("client-money-statement-error")))
                }
              >
                {t("client-money-statement-download")}
              </Button>
            </Box>
          ) : null}
          {share.confirmedAt ? (
            <StateLine tone="done">{t("client-money-confirmed")}</StateLine>
          ) : (share.status === "paid" || share.status === "direct") && editable ? (
            <Box>
              <Button size="small" variant="contained" disabled={busy} onClick={() => void run(null, share.id)}>
                {t("client-money-confirm")}
              </Button>
            </Box>
          ) : null}
        </Box>
      ))}

      {money.shares.length === 0 ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("client-money-expected")}
        </Typography>
      ) : null}
      {money.account ? (
        <StateLine tone="done">
          {t(ACCOUNT_KEY[money.account.kind] ?? "client-money-account-bank", { ends: money.account.ends })}
        </StateLine>
      ) : (
        <StateLine tone="attention">{t("client-money-account-missing")}</StateLine>
      )}
      {editable ? (
        <Box className="flex flex-col gap-3">
          <TextField
            select
            size="small"
            label={t("client-money-account-kind")}
            value={kind}
            onChange={(event) => setKind(event.target.value as "pix" | "conta")}
          >
            <MenuItem value="pix">{t("client-money-kind-pix")}</MenuItem>
            <MenuItem value="conta">{t("client-money-kind-bank")}</MenuItem>
          </TextField>
          {kind === "pix" ? (
            <TextField
              label={t("client-money-pix")}
              value={pix}
              onChange={(event) => setPix(event.target.value.replace(/[^\d.-]/g, "").slice(0, 14))}
              helperText={t("client-money-pix-help")}
              slotProps={{ htmlInput: { inputMode: "numeric" } }}
            />
          ) : (
            <>
              <TextField
                label={t("client-money-bank")}
                value={bank}
                onChange={(event) => setBank(event.target.value.slice(0, 80))}
              />
              <Box className="grid gap-3 sm:grid-cols-2">
                <TextField
                  label={t("client-money-agency")}
                  value={agency}
                  onChange={(event) => setAgency(event.target.value.slice(0, 12))}
                />
                <TextField
                  label={t("client-money-account")}
                  value={account}
                  onChange={(event) => setAccount(event.target.value.slice(0, 20))}
                />
              </Box>
              <FormControlLabel
                control={<Checkbox checked={own} onChange={(event) => setOwn(event.target.checked)} />}
                label={t("client-money-own")}
              />
            </>
          )}
          <Box>
            <Button
              variant="outlined"
              color="grey"
              disabled={
                busy || (kind === "pix" ? pix.replace(/\D/g, "").length !== 11 : !own || !bank || !agency || !account)
              }
              onClick={() =>
                void run(
                  kind === "pix"
                    ? { kind: "pix", data: { pix_key: pix } }
                    : { kind: "conta", data: { bank, agency, account, confirm_own: own ? "true" : "false" } },
                  null,
                )
              }
            >
              {t("client-money-account-save")}
            </Button>
          </Box>
        </Box>
      ) : null}
      <StateLine tone="info">{t("client-money-never-pay")}</StateLine>
    </ClientSection>
  );
}
