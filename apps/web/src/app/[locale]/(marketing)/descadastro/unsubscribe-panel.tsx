"use client";

import { confirmUnsubscribe, type UnsubscribeStatus } from "./actions";
import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";

import { Alert, Box, Button } from "@mui/material";

import Link from "@/components/marketing/locale-link";
import NiCheckSquare from "@/icons/nexture/ni-check-square";

/**
 * The unsubscribe itself: one button, pressed by a person. The link in the
 * e-mail only opens this page, because mail providers open every link they
 * deliver to scan it, and a link that acted would unsubscribe people who never
 * asked. `kind` says whose preference the link changes: a member's news, or a
 * contact of the list; null when this browser carries no request (the link
 * expired, or the page was opened directly), which the page's heading already
 * says.
 */
export default function UnsubscribePanel({ kind }: { kind: "member" | "lead" | null }) {
  const t = useTranslations("marketing");
  const [status, setStatus] = useState<UnsubscribeStatus | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!kind) {
    return (
      <Box className="mx-auto flex w-full max-w-xl flex-col items-center gap-4">
        <Button variant="pastel" color="primary" href="/" LinkComponent={Link}>
          {t("unsubscribe-home-cta")}
        </Button>
      </Box>
    );
  }

  const member = kind === "member";

  if (status === "done") {
    return (
      <Box
        role="status"
        className="border-grey-100 bg-background-paper mx-auto flex w-full max-w-xl flex-col items-start gap-3 rounded-3xl border p-6 md:p-8"
      >
        <span className="bg-accent-2-light/10 text-accent-2 flex h-11 w-11 items-center justify-center rounded-xl">
          <NiCheckSquare size="medium" />
        </span>
        <p className="font-display text-text-primary text-xl font-normal">
          {t(member ? "unsubscribe-member-done-title" : "unsubscribe-lead-done-title")}
        </p>
        <p className="text-text-secondary text-base leading-6">
          {t(member ? "unsubscribe-member-done-body" : "unsubscribe-lead-done-body")}
        </p>
        <Button variant="pastel" color="primary" href={member ? "/settings" : "/"} LinkComponent={Link}>
          {t(member ? "unsubscribe-member-done-cta" : "unsubscribe-home-cta")}
        </Button>
      </Box>
    );
  }

  return (
    <Box className="mx-auto flex w-full max-w-xl flex-col items-center gap-4">
      {status === "expired" && (
        <Alert severity="warning" className="neutral bg-background-paper/60! w-full">
          {t("unsubscribe-expired")}
        </Alert>
      )}
      {status === "unavailable" && (
        <Alert severity="error" className="neutral bg-background-paper/60! w-full">
          {t("unsubscribe-error")}
        </Alert>
      )}
      {status !== "expired" && (
        <Button
          size="large"
          variant="contained"
          color="primary"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await confirmUnsubscribe();
              setStatus(result.status);
            })
          }
        >
          {isPending ? t("unsubscribe-working") : t(member ? "unsubscribe-member-button" : "unsubscribe-lead-button")}
        </Button>
      )}
    </Box>
  );
}
