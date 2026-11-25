"use client";

import type { CaseFiling } from "../case-types";
import { onScreen } from "./filing-by-one-rules";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button } from "@mui/material";

import FilingChoiceDialog from "@/components/firm/filing-choice-dialog";
import StateLine from "@/components/product/state-line";
import { caseErrorKey } from "@/lib/cases/cases";
import { type ScreenFilingFacts, screenStanding, waysOffered } from "@/lib/filing-ways/ways";

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
 * or held at the court's summary for the lawyer's word; before any batch, it
 * says whose turn it is for ONE to file it there (`screenStanding`): who
 * decides for the firm choosing the firm's way, a lawyer of the lawsuit
 * choosing theirs at that system (both in place, `FilingChoiceDialog`), or
 * a lawyer handing it to ONE in a batch. Nothing is shown where ONE does not
 * file the package: the lawyer's own way stays as it was.
 */

const time = (iso: string | null): string =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(
        new Date(iso),
      )
    : "";

export default function FilingByOne({
  filing,
  systemName,
  mayAct,
  mayDecide,
  busy,
  nameOf,
  onRequest,
  onRetry,
  onChanged,
}: {
  filing: CaseFiling;
  /** The court's system, as the card names it. */
  systemName: string;
  /** A partner or a lawyer, writing (never a support visit). */
  mayAct: boolean;
  /** Who decides for the firm, writing: the firm's way is theirs to choose. */
  mayDecide: boolean;
  busy: boolean;
  /** A person of the firm by their id, in words. */
  nameOf: (id: string) => string;
  onRequest: () => void;
  onRetry: (notInCourt: boolean) => void;
  /** A way to file chosen here: the case is read again. */
  onChanged: () => void;
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

  // Something holds the package before ONE took it (what holds its case, built for the lawsuit as it was, a contact
  // the court's screen asks, 0288): the card says what above, and ONE's way waits until it is put right.
  if (
    !sub &&
    (filing.blocker !== null ||
      Boolean(filing.held) ||
      byOne.blocker === "package_outdated" ||
      byOne.blocker === "contact_missing")
  ) {
    return null;
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

  // No channel of the court, and its screen is one ONE files on: whose turn it is for ONE to file it there.
  if (!sub && !byOne.channel && byOne.blocker === "no_channel" && byOne.screen && byOne.screen.ways.length > 0) {
    return (
      <ScreenLine
        screen={byOne.screen}
        signs={filing.signature.viewerSigns}
        mayAct={mayAct}
        mayDecide={mayDecide}
        busy={busy}
        nameOf={nameOf}
        toBatches={toBatches}
        onChanged={onChanged}
      />
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

/**
 * Whose turn it is for ONE to file a package on its court's screen (the owner's test of 2026-11-23, where the card
 * showed only the steps by hand): the choice that is missing, made in place by whom it belongs to (the firm's way by
 * who decides for the firm, a lawyer's at that system by the lawyer), or the batch a lawyer of the lawsuit approves
 * on /protocolo; a colleague reads whose it is. A lawyer who chose may change their way here before anything goes
 * (the owner, 2026-11-24, "Trocar a forma"): beside the batch to approve, or, filing by hand where ONE could file it,
 * on a line that says so. Filed by hand as the firm chose: nothing.
 */
function ScreenLine({
  screen,
  signs,
  mayAct,
  mayDecide,
  busy,
  nameOf,
  toBatches,
  onChanged,
}: {
  screen: ScreenFilingFacts;
  /** The person reading signs the lawsuit. */
  signs: boolean;
  mayAct: boolean;
  mayDecide: boolean;
  busy: boolean;
  nameOf: (id: string) => string;
  toBatches: React.ReactNode;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [choosing, setChoosing] = useState(false);
  const standing = screenStanding(screen);
  if (!standing) return null;

  const system = screen.name;
  // The ways the firm's way leaves the lawyers at this system: by hand alone leaves nothing to change.
  const offered = waysOffered(
    { ways: screen.ways.filter((way): way is "browser" | "extension" => way === "browser" || way === "extension") },
    screen.firmWay,
  );
  const dialog = choosing ? (
    <FilingChoiceDialog systemKey={screen.key} signs={signs} onClose={() => setChoosing(false)} onSaved={onChanged} />
  ) : null;
  const changeButton = (
    <Button variant="text" color="grey" size="small" disabled={busy} onClick={() => setChoosing(true)}>
      {t("filing-one-screen-change")}
    </Button>
  );
  const viewerWay = screen.lawyers.find((lawyer) => lawyer.userId === screen.viewerId)?.way ?? null;
  if (standing.kind === "hand") {
    // The lawyer chose to file by hand where ONE could file it: they may change it before filing.
    return mayAct && viewerWay === "hand" && offered.length > 1 ? (
      <>
        <StateLine tone="info" action={changeButton}>
          {t("filing-one-screen-hand-mine", { system })}
        </StateLine>
        {dialog}
      </>
    ) : null;
  }
  const mine = (ids: string[]) => Boolean(screen.viewerId) && ids.includes(screen.viewerId ?? "");
  // Any one of them may do it: "Ana", "Ana ou Caio".
  const who = (ids: string[]) =>
    new Intl.ListFormat("pt-BR", { type: "disjunction" }).format(ids.map(nameOf).filter((name) => name !== "")) ||
    t("filing-one-screen-someone");
  const chooseHere = (text: string) => (
    <>
      <StateLine
        tone="attention"
        action={
          <Button variant="contained" size="small" disabled={busy} onClick={() => setChoosing(true)}>
            {t("filing-one-screen-choose-action")}
          </Button>
        }
      >
        {text}
      </StateLine>
      {dialog}
    </>
  );

  if (standing.kind === "firm_unchosen") {
    return mayDecide ? (
      chooseHere(t("filing-one-screen-firm-mine", { system }))
    ) : (
      <StateLine tone="info">{t("filing-one-screen-firm", { system })}</StateLine>
    );
  }
  if (standing.kind === "choose") {
    return mayAct && mine(standing.lawyers) ? (
      chooseHere(t("filing-one-screen-choose-mine", { system }))
    ) : (
      <StateLine tone="info">{t("filing-one-screen-choose", { system, who: who(standing.lawyers) })}</StateLine>
    );
  }
  return mayAct && mine(standing.lawyers) ? (
    <>
      <StateLine
        tone="attention"
        action={
          <Box className="flex flex-wrap items-center gap-1">
            {changeButton}
            {toBatches}
          </Box>
        }
      >
        {t("filing-one-screen-batch-mine", { system })}
      </StateLine>
      {dialog}
    </>
  ) : (
    <StateLine tone="info">{t("filing-one-screen-batch", { system, who: who(standing.lawyers) })}</StateLine>
  );
}
