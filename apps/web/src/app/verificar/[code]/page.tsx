import CodeForm from "../code-form";
import VerifyFrame from "../frame";
import FileCheck from "./file-check";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Alert, Box, Button, Typography } from "@mui/material";

import { dayLabel, kindLabelKey, type VerificationAnswer, verificationOutcome } from "@/lib/documents/verification";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/server";
import { formatVerifyCode, normalizeVerifyCode } from "@flyee/documents/codes";

/**
 * What the code printed on a document says (`verify_document`, migration
 * 0018): which firm issued it through ONE, what kind of document it is, which
 * version, when, and whether the firm revoked it or issued a newer version.
 * Nothing of its content: the title and the text stay with the firm.
 *
 * It is opened from a QR code on paper or typed by hand, by somebody with no
 * account, so it is public by its code; the page asks browsers to send no
 * referrer and search engines to keep away, and it loads no tracker.
 */
export const metadata: Metadata = {
  title: "Conferir um documento",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Box className="flex flex-row flex-wrap gap-x-2">
      <Typography variant="body2" component="dt" className="text-text-secondary">
        {label}
      </Typography>
      <Typography variant="body2" component="dd" className="m-0 font-semibold break-words">
        {value}
      </Typography>
    </Box>
  );
}

export default async function VerifyCodePage({ params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const t = await getTranslations("product");
  // Whatever arrives in the address becomes a code or nothing: a code is
  // letters and digits, so nothing in it ever needs decoding.
  const code = normalizeVerifyCode(raw);

  const heading = (title: string, body: string) => (
    <Box className="flex flex-col">
      <Typography variant="h1" component="h1" className="mb-2">
        {title}
      </Typography>
      <Typography variant="body1" className="text-text-primary">
        {body}
      </Typography>
    </Box>
  );

  if (!isSupabaseConfigured) {
    return <VerifyFrame>{heading(t("verify-unavailable-title"), t("verify-unavailable-body"))}</VerifyFrame>;
  }

  let answer: VerificationAnswer | null = null;
  let failed = false;
  if (code) {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("verify_document", { target_code: code });
    failed = Boolean(error);
    answer = (data ?? null) as VerificationAnswer | null;
  }

  // A read that failed is never shown as "this code does not exist".
  if (failed) {
    return (
      <VerifyFrame>
        <Box className="flex flex-col gap-6">
          {heading(t("verify-error-title"), t("verify-error-body"))}
          <Button href={`/verificar/${code}`} variant="outlined" color="grey">
            {t("verify-retry")}
          </Button>
        </Box>
      </VerifyFrame>
    );
  }

  const outcome = verificationOutcome(answer);

  if (outcome === "missing" || !answer) {
    return (
      <VerifyFrame>
        <Box className="flex flex-col gap-6">
          {heading(t("verify-missing-title"), t("verify-missing-body"))}
          <CodeForm initial={code ? formatVerifyCode(code) : ""} />
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {t("verify-missing-safety")}
          </Alert>
        </Box>
      </VerifyFrame>
    );
  }

  const firm = answer.firm ?? "";
  const issued = dayLabel(answer.issuedAt);
  const revoked = dayLabel(answer.revokedAt);
  const title =
    outcome === "valid"
      ? t("verify-valid-title")
      : outcome === "revoked"
        ? t("verify-revoked-title")
        : t("verify-replaced-title");
  const body =
    outcome === "valid"
      ? t("verify-valid-body", { firm })
      : outcome === "revoked"
        ? t("verify-revoked-body", { firm })
        : t("verify-replaced-body", { firm, version: answer.replacedByVersion ?? 0 });
  const statusLabel =
    outcome === "valid"
      ? t("verify-status-valid")
      : outcome === "revoked"
        ? t("verify-status-revoked")
        : t("verify-status-replaced");

  return (
    <VerifyFrame>
      <Box className="flex flex-col gap-6">
        {heading(title, body)}

        <Box component="dl" className="border-grey-100 m-0 flex flex-col gap-2 rounded-2xl border p-4">
          <Fact label={t("verify-fact-firm")} value={firm} />
          <Fact label={t("verify-fact-kind")} value={t(kindLabelKey(answer.kind))} />
          <Fact label={t("verify-fact-version")} value={String(answer.version ?? 1)} />
          {issued ? <Fact label={t("verify-fact-issued")} value={issued} /> : null}
          {outcome === "revoked" && revoked ? <Fact label={t("verify-fact-revoked")} value={revoked} /> : null}
          <Fact label={t("verify-fact-status")} value={statusLabel} />
          {code ? <Fact label={t("verify-fact-code")} value={formatVerifyCode(code)} /> : null}
        </Box>

        {outcome === "valid" && answer.contentHash ? <FileCheck expectedHash={answer.contentHash} /> : null}

        <Typography variant="body2" className="text-text-secondary">
          {t("verify-safety")}
        </Typography>
      </Box>
    </VerifyFrame>
  );
}
