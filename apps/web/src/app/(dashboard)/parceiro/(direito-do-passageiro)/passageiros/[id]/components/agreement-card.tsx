"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, TextField, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import { issueAgreementLink } from "@/modules/direito-do-passageiro/agency/actions";
import {
  CONSENT_KEY,
  CONSENT_TONE,
  type PaxDetail,
  paxErrorKey,
} from "@/modules/direito-do-passageiro/agency/passengers";

const when = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(value))
    : "";

/**
 * Where the passenger's agreement stands, and the link that asks for it. The link is ONE's: the passenger reads
 * ONE's words and the clause of the agency's contract, and answers for themself and the children they answer
 * for. A new link is shown once, to be sent by the agency; only its hash is kept, and it ends the one before.
 */
export default function AgreementCard({
  detail,
  hasClause,
  onIssued,
}: {
  detail: PaxDetail;
  hasClause: boolean;
  onIssued: () => void;
}) {
  const t = useTranslations("product");
  const traveler = detail.traveler;
  const [issued, setIssued] = useState<{ url: string; expiresAt: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const consent = detail.consent ?? "none";

  const issue = async () => {
    setBusy(true);
    setProblem(null);
    setCopied(false);
    const result = await issueAgreementLink(traveler.id);
    setBusy(false);
    if (!result.ok) {
      setProblem(t(paxErrorKey(result.code)));
      return;
    }
    setIssued({ url: result.url, expiresAt: result.expiresAt });
    onIssued();
  };

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Card component="section" aria-labelledby="pax-agreement-title" className="h-full">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-wrap items-center justify-between gap-2">
          <Typography id="pax-agreement-title" variant="h5" component="h2" className="mb-0">
            {t("pax-agreement-title")}
          </Typography>
          {!traveler.minor && <StatusChip label={t(CONSENT_KEY[consent])} tone={CONSENT_TONE[consent]} />}
        </Box>

        {traveler.minor ? (
          <Typography variant="body2">
            {detail.guardian
              ? t("pax-agreement-minor", { name: detail.guardian.fullName })
              : t("pax-agreement-minor-alone")}
          </Typography>
        ) : (
          <>
            <Typography variant="body2" className="text-text-secondary">
              {detail.children.length > 0
                ? t("pax-agreement-help-children", { names: detail.children.map((child) => child.fullName).join(", ") })
                : t("pax-agreement-help")}
            </Typography>

            {detail.confirmLink && !issued && (
              <Typography variant="body2">
                {detail.confirmLink.open
                  ? t("pax-agreement-link-open", { date: when(detail.confirmLink.expiresAt) })
                  : t("pax-agreement-link-closed")}
              </Typography>
            )}

            {issued && (
              <Box className="flex flex-col gap-2">
                <TextField
                  id="pax-agreement-url"
                  label={t("pax-agreement-url")}
                  value={issued.url}
                  size="small"
                  fullWidth
                  slotProps={{ input: { readOnly: true } }}
                  onFocus={(event) => event.target.select()}
                />
                <Box className="flex flex-wrap items-center gap-2">
                  <Button variant="outlined" color="grey" size="small" onClick={() => void copy()}>
                    {copied ? t("pax-agreement-copied") : t("pax-agreement-copy")}
                  </Button>
                  <Typography variant="body2" className="text-text-secondary">
                    {t("pax-agreement-url-help", { date: when(issued.expiresAt) })}
                  </Typography>
                </Box>
              </Box>
            )}

            {problem && <Alert severity="error">{problem}</Alert>}
            {!hasClause && (
              <Alert severity="warning" className="neutral bg-background-paper/60!">
                {t("pax-error-no-clause")}
              </Alert>
            )}
            {!traveler.handedOver && (
              <Box>
                <Button
                  variant={issued ? "text" : "contained"}
                  disabled={busy || !hasClause}
                  onClick={() => void issue()}
                >
                  {busy
                    ? t("pax-agreement-issuing")
                    : detail.confirmLink
                      ? t("pax-agreement-issue-again")
                      : t("pax-agreement-issue")}
                </Button>
              </Box>
            )}

            {detail.consents.length > 0 && (
              <Box className="flex flex-col gap-1">
                <Typography variant="subtitle2" component="h3">
                  {t("pax-agreement-history")}
                </Typography>
                <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
                  {detail.consents.map((answer) => (
                    <Typography key={`${answer.answer}-${answer.createdAt}`} component="li" variant="body2">
                      {t("pax-agreement-answer", {
                        answer: t(CONSENT_KEY[answer.answer]),
                        date: when(answer.createdAt),
                      })}
                    </Typography>
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}
        {detail.trips.length === 0 && !traveler.minor && (
          <Typography variant="body2" className="text-text-secondary">
            {t("pax-agreement-no-trip")}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
