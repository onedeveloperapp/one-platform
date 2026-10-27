"use client";

import type { CloudSignature, CloudSignatureData } from "../team-types";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Grid, MenuItem, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import { CpfField } from "@/components/product/fields";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import NiPen from "@/icons/nexture/ni-pen";
import { declareLawyerCpf, endLawyerSignature, startLawyerSignature } from "@/lib/psc/actions";
import {
  type AuthorizationState,
  DEFAULT_SIGNATURE_HOURS,
  SIGNATURE_HOURS,
  SIGNATURE_HOURS_KEY,
  SIGNATURE_OUTCOME_KEY,
  signatureActionErrorKey,
  signatureErrorKey,
  type SignatureHours,
  type SignatureOutcome,
  USE_PURPOSE_KEY,
} from "@/lib/psc/signature";
import { onlyDigits } from "@flyee/fields";

const STATE: Record<AuthorizationState, { key: string; tone: StatusTone }> = {
  active: { key: "psc-state-active", tone: "positive" },
  failing: { key: "psc-state-failing", tone: "attention" },
  pending: { key: "psc-state-pending", tone: "neutral" },
  ended: { key: "psc-state-ended", tone: "neutral" },
};

const USE_STATE: Record<"opened" | "signed" | "failed", { key: string; tone: StatusTone }> = {
  signed: { key: "psc-use-signed", tone: "positive" },
  failed: { key: "psc-use-failed", tone: "attention" },
  opened: { key: "psc-use-open", tone: "neutral" },
};

const OUTCOME_SEVERITY: Record<SignatureOutcome, "success" | "info" | "error"> = {
  autorizada: "success",
  recusada: "info",
  expirada: "info",
  "sem-certificado": "error",
  "certificado-vencido": "error",
  "nao-pessoal": "error",
  "outro-titular": "error",
  "sem-sessao": "error",
  "teste-falhou": "error",
  "teste-pendente": "info",
  erro: "error",
};

/** The reasons an authorization ended that the lawyer reads in words; an end by time or by a person is said apart. */
const ENDING_ERRORS = new Set([
  "session_ended",
  "token_used",
  "denied",
  "psc_moved",
  "no_certificate",
  "certificate_changed",
  "certificate_expired",
]);

/**
 * The lawyer's signature in the cloud (migration 0041): the lawyer declares
 * their CPF and authorizes ONE at the provider of their certificate (a PSC),
 * for the time they choose up to the norm's 7 days, and ONE then signs the
 * files of the filing packages of the lawsuits they sign, each signature on
 * record here. The authorization is given on the PSC's own page with the
 * lawyer's own factors, which ONE never sees. A partner or who manages the
 * firm reads the team's authorizations and ends any of them; anybody ends
 * their own, with no second factor. A support visit only reads.
 */
export default function CloudSignatureCard({
  data,
  mayAuthorize,
  readsTeam,
  onChanged,
}: {
  /** What the card shows; null when it could not be read. */
  data: CloudSignatureData | null;
  /** The person is a partner or a lawyer of the firm: their own authorization is theirs to give. */
  mayAuthorize: boolean;
  /** The person is a partner or manages the firm: the team's authorizations and uses are theirs to read. */
  readsTeam: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const router = useRouter();
  const pathname = usePathname();
  const lastPsc = data?.mine[0]?.pscSlug;
  const [psc, setPsc] = useState(lastPsc && data?.offers.some((offer) => offer.slug === lastPsc) ? lastPsc : "");
  const [hours, setHours] = useState<SignatureHours>(DEFAULT_SIGNATURE_HOURS);
  const [cpf, setCpf] = useState("");
  const [changingCpf, setChangingCpf] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<SignatureOutcome | null>(data?.outcome ?? null);
  // The case the lawyer came from, kept while the address is cleaned of what the PSC answered.
  const [backToCase] = useState<string | null>(data?.backToCase ?? null);
  const [ending, setEnding] = useState<CloudSignature | null>(null);

  // The PSC's answer is said once: a reload or the back button never says it again.
  useEffect(() => {
    if (data?.outcome) router.replace(`${pathname}#team-cloud-signature`, { scroll: false });
  }, [data?.outcome, pathname, router]);

  // A page brought back from the browser's history after leaving for the PSC is free to act again.
  useEffect(() => {
    const shown = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(null);
    };
    window.addEventListener("pageshow", shown);
    return () => window.removeEventListener("pageshow", shown);
  }, []);

  if (!data) {
    return (
      <Grid size={12}>
        <CollapsibleCard id="team-cloud-signature" title={t("psc-title")} defaultOpen bodyClassName="gap-3">
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" onClick={onChanged}>
                {t("team-retry")}
              </Button>
            }
          >
            {t("psc-read-error")}
          </Alert>
        </CollapsibleCard>
      </Grid>
    );
  }

  const inForce = data.mine.filter((item) => item.state === "active" || item.state === "failing");
  const readOnly = data.supportVisit;
  // Giving an authorization or a CPF asks the second factor; ending one never does.
  const gated = data.secondFactor !== "ok";
  const nothingHere =
    data.offers.length === 0 && data.mine.length === 0 && data.team.length === 0 && data.uses.length === 0;

  const authorize = async () => {
    if (busy || !psc) return;
    setBusy("authorize");
    setErrorCode(null);
    setOutcome(null);
    try {
      const result = await startLawyerSignature({ psc, hours, backToCase });
      if (result.ok && result.url) {
        window.location.assign(result.url);
        return;
      }
      setErrorCode(result.code);
      setBusy(null);
    } catch {
      setErrorCode("failed");
      setBusy(null);
    }
  };

  const declare = async () => {
    if (busy) return;
    setBusy("cpf");
    setErrorCode(null);
    try {
      const result = await declareLawyerCpf(onlyDigits(cpf));
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }
      setCpf("");
      setChangingCpf(false);
      onChanged();
    } catch {
      setErrorCode("failed");
    } finally {
      setBusy(null);
    }
  };

  const end = async (item: CloudSignature): Promise<string | null> => {
    setErrorCode(null);
    setOutcome(null);
    try {
      const result = await endLawyerSignature(item.connectionId);
      if (!result.ok) return t(signatureActionErrorKey(result.code));
      setEnding(null);
      onChanged();
      return null;
    } catch {
      return t("psc-action-failed");
    }
  };

  const endedLine = (item: CloudSignature): string | null => {
    if (item.state !== "ended" || !item.endedLabel) return null;
    if (item.endedBy === "self") return t("psc-ended-self", { when: item.endedLabel });
    if (item.endedBy === "person" && item.endedByName) {
      return t("psc-ended-by", { name: item.endedByName, when: item.endedLabel });
    }
    if (item.lastError && ENDING_ERRORS.has(item.lastError)) return t(signatureErrorKey(item.lastError));
    return t("psc-ended-at", { when: item.endedLabel });
  };

  const describe = (item: CloudSignature) =>
    [
      item.holderCpf ? t("psc-line-cpf", { cpf: item.holderCpf }) : null,
      item.state === "active" || item.state === "failing"
        ? item.untilLabel
          ? t("psc-until", { when: item.untilLabel })
          : null
        : null,
      item.certificateUntilLabel ? t("psc-certificate-until", { day: item.certificateUntilLabel }) : null,
    ]
      .filter(Boolean)
      .join(" · ");

  const row = (item: CloudSignature, named: boolean) => {
    const ended = endedLine(item);
    return (
      <Box
        component="li"
        key={item.connectionId}
        className="border-grey-100 flex flex-col gap-2 border-b py-3 last:border-b-0"
      >
        <Box className="flex flex-row flex-wrap items-center gap-3">
          <Typography variant="subtitle2" component="p" className="mb-0 min-w-0 flex-1">
            {[
              named ? item.personName : null,
              item.holder ? t("psc-line", { psc: item.pscName, holder: item.holder }) : item.pscName,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Typography>
          <StatusChip label={t(STATE[item.state].key)} tone={STATE[item.state].tone} />
        </Box>
        {describe(item) ? (
          <Typography variant="body2" className="text-text-secondary">
            {describe(item)}
          </Typography>
        ) : null}
        {item.state === "failing" && item.lastError ? (
          <Typography variant="body2" className="text-text-secondary">
            {t(signatureErrorKey(item.lastError))}
          </Typography>
        ) : null}
        {ended ? (
          <Typography variant="body2" className="text-text-secondary">
            {ended}
          </Typography>
        ) : null}
        {!readOnly && (item.state === "active" || item.state === "failing") ? (
          <Box>
            <Button
              variant="text"
              color="grey"
              size="small"
              aria-label={
                item.personName
                  ? t("psc-end-aria", { name: item.personName, psc: item.pscName })
                  : t("psc-end-aria-own", { psc: item.pscName })
              }
              onClick={() => setEnding(item)}
            >
              {t("psc-end")}
            </Button>
          </Box>
        ) : null}
      </Box>
    );
  };

  const secondFactorAlert = gated ? (
    <Alert
      severity="warning"
      className="neutral bg-background-paper/60!"
      action={
        data.secondFactor === "challenge" ? (
          <Button
            color="inherit"
            size="small"
            href={`/auth/two-factor?next=${encodeURIComponent("/settings/team#team-cloud-signature")}`}
            LinkComponent={Link}
          >
            {t("connections-second-factor-confirm")}
          </Button>
        ) : (
          <Button color="inherit" size="small" href="/settings/security" LinkComponent={Link}>
            {t("connections-second-factor-setup")}
          </Button>
        )
      }
    >
      {data.secondFactor === "challenge" ? t("psc-second-factor-challenge") : t("psc-second-factor-missing")}
    </Alert>
  ) : null;

  // Closed, the card says whether ONE may sign now and at which provider, or, for who reads the team, how many
  // colleagues it may sign for. It opens by itself on the provider's answer, on the way back to a case, and while
  // an authorization fails.
  const mineInForce = inForce[0] ?? null;
  const teamInForce = data.team.filter((item) => item.state === "active" || item.state === "failing").length;
  const failingNow = inForce.some((item) => item.state === "failing");
  const summary = mayAuthorize
    ? mineInForce
      ? [mineInForce.pscName, mineInForce.untilLabel ? t("psc-until", { when: mineInForce.untilLabel }) : null]
          .filter(Boolean)
          .join(" · ")
      : t("psc-mine-empty-title")
    : teamInForce > 0
      ? t("psc-summary-team", { count: teamInForce })
      : t("psc-summary-team-none");

  return (
    <Grid size={12}>
      <CollapsibleCard
        id="team-cloud-signature"
        title={t("psc-title")}
        summary={summary}
        chip={failingNow ? <StatusChip label={t(STATE.failing.key)} tone={STATE.failing.tone} /> : null}
        description={mayAuthorize ? t("psc-body") : t("psc-body-reader")}
        defaultOpen={Boolean(outcome) || Boolean(backToCase) || failingNow}
        bodyClassName="gap-5"
      >
        {outcome ? (
          <Alert
            severity={OUTCOME_SEVERITY[outcome]}
            className="neutral bg-background-paper/60!"
            onClose={() => setOutcome(null)}
            action={
              backToCase && (outcome === "autorizada" || outcome === "teste-pendente") ? (
                <Button color="inherit" size="small" href={`/casos/${backToCase}#case-filing`} LinkComponent={Link}>
                  {t("psc-back-to-case")}
                </Button>
              ) : undefined
            }
          >
            {t(SIGNATURE_OUTCOME_KEY[outcome])}
          </Alert>
        ) : null}
        {errorCode ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setErrorCode(null)}>
            {t(signatureActionErrorKey(errorCode))}
          </Alert>
        ) : null}
        {readOnly ? (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("psc-support-visit")}
          </Alert>
        ) : null}

        {nothingHere ? (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("psc-none-offered")}
          </Alert>
        ) : (
          <>
            {mayAuthorize ? (
              <Box className="flex flex-col gap-4">
                {data.mine.length > 0 ? (
                  <Box component="ul" className="m-0 flex list-none flex-col p-0">
                    {data.mine.map((item) => row(item, false))}
                  </Box>
                ) : (
                  <EmptyState
                    icon={<NiPen size="large" />}
                    title={t("psc-mine-empty-title")}
                    description={t("psc-mine-empty-body")}
                    titleAs="h3"
                    className="py-8"
                  />
                )}
                {inForce.length > 0 ? (
                  <Typography variant="body2" className="text-text-secondary max-w-3xl">
                    {t("psc-end-help")}
                  </Typography>
                ) : null}

                {readOnly ? null : data.offers.length === 0 ? (
                  <Alert severity="info" className="neutral bg-background-paper/60!">
                    {t("psc-none-offered")}
                  </Alert>
                ) : gated ? (
                  secondFactorAlert
                ) : !data.declaredCpf || changingCpf ? (
                  <Box className="flex flex-col gap-2">
                    <Typography variant="subtitle1" component="h3" className="mb-0">
                      {t("psc-cpf-title")}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary max-w-3xl">
                      {t("psc-cpf-body")}
                    </Typography>
                    <Grid container spacing={3} className="items-start">
                      <Grid size={{ xs: 12, sm: 5 }}>
                        <CpfField
                          fullWidth
                          size="small"
                          id="psc-cpf"
                          label={t("psc-cpf-label")}
                          value={cpf}
                          disabled={busy !== null}
                          invalidMessage={t("psc-action-invalid-cpf")}
                          onChange={(event) => setCpf(event.target.value)}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: "auto" }}>
                        <Box className="flex flex-row flex-wrap gap-2">
                          <Button
                            variant="contained"
                            disabled={busy !== null || onlyDigits(cpf).length !== 11}
                            onClick={() => void declare()}
                          >
                            {busy === "cpf" ? t("psc-cpf-saving") : t("psc-cpf-save")}
                          </Button>
                          {changingCpf ? (
                            <Button
                              variant="text"
                              color="grey"
                              disabled={busy !== null}
                              onClick={() => setChangingCpf(false)}
                            >
                              {t("team-certificate-cancel")}
                            </Button>
                          ) : null}
                        </Box>
                      </Grid>
                    </Grid>
                  </Box>
                ) : (
                  <Box className="flex flex-col gap-3">
                    <Box className="flex flex-row flex-wrap items-center gap-2">
                      <Typography variant="body2" className="text-text-secondary">
                        {t("psc-cpf-declared", { cpf: data.declaredCpf })}
                      </Typography>
                      {inForce.length === 0 ? (
                        <Button variant="text" color="grey" size="small" onClick={() => setChangingCpf(true)}>
                          {t("psc-cpf-change")}
                        </Button>
                      ) : null}
                    </Box>
                    <Grid container spacing={3} className="items-start">
                      <Grid size={{ xs: 12, sm: 5 }}>
                        <TextField
                          select
                          fullWidth
                          size="small"
                          id="psc-provider"
                          label={t("psc-provider")}
                          value={psc}
                          disabled={busy !== null}
                          onChange={(event) => setPsc(event.target.value)}
                        >
                          {data.offers.map((offer) => (
                            <MenuItem key={offer.slug} value={offer.slug}>
                              {offer.name}
                            </MenuItem>
                          ))}
                        </TextField>
                      </Grid>
                      <Grid size={{ xs: 12, sm: 4 }}>
                        <TextField
                          select
                          fullWidth
                          size="small"
                          id="psc-hours"
                          label={t("psc-hours")}
                          value={hours}
                          disabled={busy !== null}
                          onChange={(event) => setHours(Number(event.target.value) as SignatureHours)}
                        >
                          {SIGNATURE_HOURS.map((value) => (
                            <MenuItem key={value} value={value}>
                              {t(SIGNATURE_HOURS_KEY[value])}
                            </MenuItem>
                          ))}
                        </TextField>
                      </Grid>
                      <Grid size={{ xs: 12, sm: 3 }}>
                        <Button
                          variant={inForce.length > 0 ? "outlined" : "contained"}
                          color={inForce.length > 0 ? "grey" : "primary"}
                          fullWidth
                          disabled={busy !== null || !psc}
                          onClick={() => void authorize()}
                        >
                          {busy === "authorize"
                            ? t("psc-authorizing")
                            : inForce.length > 0
                              ? t("psc-authorize-again")
                              : t("psc-authorize")}
                        </Button>
                      </Grid>
                    </Grid>
                  </Box>
                )}
              </Box>
            ) : null}

            {readsTeam ? (
              <Box className="flex flex-col gap-1">
                <Typography variant="subtitle1" component="h3" className="mb-0">
                  {t("psc-team-title")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary max-w-3xl">
                  {t("psc-team-body")}
                </Typography>
                {data.team.length > 0 ? (
                  <Box component="ul" className="m-0 flex list-none flex-col p-0">
                    {data.team.map((item) => row(item, true))}
                  </Box>
                ) : (
                  <Typography variant="body2" className="text-text-secondary py-2">
                    {t("psc-team-empty")}
                  </Typography>
                )}
              </Box>
            ) : null}

            <Box className="flex flex-col gap-1">
              <Typography variant="subtitle1" component="h3" className="mb-0">
                {t("psc-uses-title")}
              </Typography>
              {data.uses.length === 0 ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("psc-uses-empty")}
                </Typography>
              ) : (
                <>
                  <Typography variant="body2" className="text-text-secondary">
                    {t("psc-uses-help")}
                  </Typography>
                  <Box component="ul" className="m-0 flex list-none flex-col p-0">
                    {data.uses.map((use) => (
                      <Box
                        component="li"
                        key={use.id}
                        className="border-grey-100 flex flex-col gap-1 border-b py-2 last:border-b-0"
                      >
                        <Box className="flex flex-row flex-wrap items-center gap-3">
                          <Typography variant="body2" component="p" className="mb-0 min-w-0 flex-1">
                            {[
                              t(USE_PURPOSE_KEY[use.purpose] ?? "psc-use-filing"),
                              t("psc-use-files", { count: use.documents }),
                              use.whenLabel,
                              readsTeam && use.personName ? t("psc-use-by", { name: use.personName }) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            {use.caseId && use.caseSeq !== null ? (
                              <>
                                {" · "}
                                <Link href={`/casos/${use.caseId}`} className="text-text-primary underline">
                                  {t("psc-use-case", { seq: use.caseSeq })}
                                </Link>
                              </>
                            ) : null}
                          </Typography>
                          <StatusChip label={t(USE_STATE[use.status].key)} tone={USE_STATE[use.status].tone} />
                        </Box>
                        {use.status === "failed" ? (
                          <Typography variant="body2" className="text-text-secondary">
                            {t(signatureErrorKey(use.errorCode))}
                          </Typography>
                        ) : null}
                      </Box>
                    ))}
                  </Box>
                </>
              )}
            </Box>
          </>
        )}
      </CollapsibleCard>

      {ending ? (
        <ConfirmActionDialog
          title={
            ending.personName && readsTeam && !data.mine.some((item) => item.connectionId === ending.connectionId)
              ? t("psc-end-dialog-title", { name: ending.personName })
              : t("psc-end-dialog-title-own")
          }
          intro={ending.holder ? t("psc-line", { psc: ending.pscName, holder: ending.holder }) : ending.pscName}
          consequences={[t("psc-end-dialog-consequence-1"), t("psc-end-dialog-consequence-2")]}
          staysTitle={t("psc-end-dialog-stays-title")}
          stays={[t("psc-end-dialog-stays")]}
          requireReason={false}
          confirmLabel={t("psc-end")}
          cancelLabel={t("team-certificate-cancel")}
          busyLabel={t("psc-ending")}
          tone="danger"
          onConfirm={() => end(ending)}
          onClose={() => setEnding(null)}
        />
      ) : null}
    </Grid>
  );
}
