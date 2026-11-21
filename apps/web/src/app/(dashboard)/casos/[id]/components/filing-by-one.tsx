"use client";

import type { CaseFiling } from "../case-types";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, Button } from "@mui/material";

import StateLine from "@/components/product/state-line";
import { caseErrorKey } from "@/lib/cases/cases";

/**
 * What ONE does with the filing of a package itself (migration 0101): it
 * files the lawsuit through the court's own channel (or the test court of a
 * test case), and says where that stands: about to go, going, tried again
 * after the court did not answer, filed, refused with the court's reason,
 * failed, or sent with no answer to read (it may be in the court already, so
 * a lawyer looks before it goes again). Where the firm keeps the filing to a
 * lawyer, the lawyer asks ONE here. Where the court has no channel but ONE
 * files on its screen (0264), a lawyer hands the package to ONE in a batch
 * on /protocolo, and the card says where that batch stands: waiting, going,
 * or held at the court's summary for the lawyer's word. Nothing is shown
 * where ONE does not file the package: the lawyer's own way stays as it was.
 */

/** Filed by a lawyer's batch on the court's screen (0264), by ONE's browser or the lawyer's extension. */
const onScreen = (channel: string | undefined): boolean => channel === "browser" || channel === "extension";

const time = (iso: string | null): string =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(
        new Date(iso),
      )
    : "";

/** Whether ONE files this package now (or is about to): the lawyer's own steps step back meanwhile. */
export function oneFilesIt(filing: CaseFiling | null): boolean {
  const byOne = filing?.byOne;
  if (!filing || !byOne || filing.status !== "ready") return false;
  const sub = byOne.submission;
  // A batch of a lawyer files it on the court's screen: their own steps step back while it is in course.
  if (sub && onScreen(sub.channel)) {
    return sub.status === "owed" || sub.status === "claimed" || sub.status === "confirming" || sub.status === "sending";
  }
  if (!byOne.channel) return false;
  if (sub) return sub.status === "owed" || sub.status === "claimed" || sub.status === "sending";
  return byOne.blocker === null || byOne.blocker === "not_signed";
}

/** The court received the lawsuit from ONE, and gave no number a lawyer could take from it: the receipt goes by hand. */
export const filedWithoutNumber = (filing: CaseFiling | null): boolean =>
  filing?.status === "ready" && filing.byOne?.submission?.status === "filed";

export default function FilingByOne({
  filing,
  systemName,
  mayAct,
  busy,
  onRequest,
  onRetry,
}: {
  filing: CaseFiling;
  /** The court's system, as the card names it. */
  systemName: string;
  /** A partner or a lawyer, writing (never a support visit). */
  mayAct: boolean;
  busy: boolean;
  onRequest: () => void;
  onRetry: (notInCourt: boolean) => void;
}) {
  const t = useTranslations("product");
  const byOne = filing.byOne;
  if (!byOne) return null;
  const sub = byOne.submission;
  const where =
    byOne.channel === "test_court" || sub?.channel === "test_court" ? t("filing-one-test-court") : systemName;

  if (sub?.status === "filed") {
    return (
      <StateLine tone="done">
        {[
          filing.status === "filed"
            ? t("filing-one-filed", { system: where, protocol: sub.protocol ?? "" })
            : t("filing-one-filed-unnumbered", { system: where, protocol: sub.protocol ?? "" }),
          t("filing-one-may-err", { system: where }),
        ].join(" ")}
      </StateLine>
    );
  }
  if (filing.status !== "ready") return null;

  if (sub?.status === "refused" || sub?.status === "failed" || sub?.status === "unknown") {
    const words =
      sub.status === "refused"
        ? t("filing-one-refused", { system: where, message: sub.message ?? t("filing-one-no-reason") })
        : sub.status === "failed"
          ? t("filing-one-failed", { system: where })
          : t("filing-one-unknown", { system: where });
    return (
      <Box className="flex flex-col gap-2">
        <StateLine tone={sub.status === "unknown" ? "attention" : "failed"}>{words}</StateLine>
        {mayAct ? (
          <Box className="flex flex-wrap gap-2">
            <Button variant="outlined" size="small" disabled={busy} onClick={() => onRetry(sub.status === "unknown")}>
              {sub.status === "unknown"
                ? t("filing-one-unknown-action", { system: where })
                : t("filing-one-retry-action")}
            </Button>
          </Box>
        ) : null}
      </Box>
    );
  }

  // A lawyer's batch on the court's screen: where the batch is followed, and where the lawyer gives their word.
  const toBatches = (
    <Button variant="outlined" color="grey" size="small" href="/protocolo" LinkComponent={Link}>
      {t("filing-one-see-protocol")}
    </Button>
  );
  if (sub && onScreen(sub.channel) && (sub.status === "owed" || sub.status === "confirming")) {
    return (
      <StateLine tone={sub.status === "confirming" ? "attention" : "waiting"} action={toBatches}>
        {sub.status === "confirming"
          ? t("filing-one-screen-confirming", { system: where })
          : t("filing-one-screen-owed", { system: where })}
      </StateLine>
    );
  }

  if (sub && (sub.status === "owed" || sub.status === "claimed" || sub.status === "sending")) {
    return (
      <StateLine tone="waiting">
        {sub.status === "owed" && sub.attempts > 0 && sub.retryAfter
          ? t("filing-one-retry", { system: where, time: time(sub.retryAfter) })
          : sub.status === "owed"
            ? t("filing-one-soon", { system: where })
            : t("filing-one-sending", { system: where })}
      </StateLine>
    );
  }

  // No channel of the court, and its screen is one ONE files on: a lawyer hands the package to ONE in a batch.
  if (!sub && !byOne.channel && byOne.blocker === "no_channel" && byOne.screen && byOne.screen.ways.length > 0) {
    return (
      <StateLine tone="info" action={mayAct ? toBatches : undefined}>
        {t("filing-one-screen-ready", { system: byOne.screen.name })}
      </StateLine>
    );
  }
  if (!byOne.channel || byOne.blocker === "no_channel" || byOne.blocker === "court_codes_missing") {
    return <StateLine tone="info">{t("filing-one-no-channel", { system: where })}</StateLine>;
  }
  if (byOne.blocker === "awaits_lawyer") {
    return (
      <StateLine
        tone="attention"
        action={
          mayAct ? (
            <Button variant="contained" size="small" disabled={busy} onClick={onRequest}>
              {t("filing-one-request")}
            </Button>
          ) : undefined
        }
      >
        {t("filing-one-awaits", { system: where })}
      </StateLine>
    );
  }
  // What only the firm puts right before ONE can file it: a lawyer who signs, the company of the case.
  if (byOne.blocker === "no_signer" || byOne.blocker === "no_airline") {
    return <StateLine tone="attention">{t(caseErrorKey(byOne.blocker))}</StateLine>;
  }
  if (byOne.blocker === "not_signed") {
    return <StateLine tone="waiting">{t("filing-one-after-signature", { system: where })}</StateLine>;
  }
  if (byOne.blocker === null) {
    return <StateLine tone="waiting">{t("filing-one-soon", { system: where })}</StateLine>;
  }
  return null;
}
