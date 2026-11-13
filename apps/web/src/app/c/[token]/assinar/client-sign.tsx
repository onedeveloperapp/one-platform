"use client";

import { ClientSignatures } from "../client-tasks";
import NextLink from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Button, Card, CardContent, Typography } from "@mui/material";

import StateLine from "@/components/product/state-line";
import type { ClientLinkView, ClientTasks } from "@/lib/cases/client-link";

type OpenView = Extract<ClientLinkView, { state: "open" }>;

/**
 * What the client signs, and nothing else (0237): the firm's name, each paper with its steps, and the rest of the
 * case one link away. With nothing left to sign, it says so and where the case goes on.
 */
export default function ClientSign({ token, view, tasks }: { token: string; view: OpenView; tasks: ClientTasks }) {
  const t = useTranslations("product");
  const router = useRouter();
  const owed = tasks.signatures.some((signature) => signature.status === "pending" && !signature.signed_at);

  return (
    <>
      <Card component="header">
        <CardContent className="flex flex-col gap-3">
          <Typography variant="h1" component="h1" className="mb-0 break-words">
            {t("client-sign-title")}
          </Typography>
          <Typography variant="body1" className="text-text-primary">
            {t("client-sign-intro", { firm: view.firm })}
          </Typography>
          {!owed && <StateLine tone="done">{t("client-sign-nothing")}</StateLine>}
        </CardContent>
      </Card>

      <ClientSignatures
        token={token}
        signatures={tasks.signatures}
        editable
        titled={false}
        onSaved={() => router.refresh()}
      />

      <Typography variant="body2" className="text-text-secondary px-2 text-center">
        <Button component={NextLink} href={`/c/${token}`} variant="text" color="grey" size="small">
          {t("client-sign-case")}
        </Button>
      </Typography>
    </>
  );
}
