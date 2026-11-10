"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Box, Button, Card, CardContent, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import NiReceipt from "@/icons/nexture/ni-receipt";
import { type ClientReceipt, clientReceipts, downloadClientReceipt } from "@/lib/cases/client-link-actions";
import { formatCents } from "@flyee/rules/finance";
import { formatDayBr } from "@flyee/rules/person";

/**
 * "Recibos" on the client's link (migration 0152): each receipt the firm issued for what the client paid it, with the
 * value, the day, what for and its public code, and the PDF one click away. Hidden while there is none.
 */
export default function ClientReceipts({ token }: { token: string }) {
  const t = useTranslations("product");
  const [receipts, setReceipts] = useState<ClientReceipt[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    void clientReceipts(token)
      .then((answer) => {
        if (live && answer.ok) setReceipts(answer.receipts);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [token]);

  if (receipts.length === 0) return null;

  const download = async (receipt: ClientReceipt) => {
    setBusy(receipt.id);
    setProblem(null);
    const link = await downloadClientReceipt(token, receipt.id).catch(() => null);
    setBusy(null);
    if (link?.ok) window.open(link.url, "_blank", "noopener,noreferrer");
    else setProblem(t("client-receipts-error"));
  };

  return (
    <Card>
      <CardContent className="flex flex-col gap-3">
        <CardTitle
          id="client-receipts"
          icon={<NiReceipt size="medium" />}
          tone="primary"
          title={t("client-receipts-title")}
          description={t("client-receipts-hint")}
        />
        <Box component="ul" className="m-0 flex list-none flex-col p-0">
          {receipts.map((receipt) => (
            <Box
              component="li"
              key={receipt.id}
              className="border-grey-100 flex flex-wrap items-center justify-between gap-3 border-b py-3 last:border-b-0"
            >
              <Box className="flex min-w-0 flex-col gap-1">
                <Typography variant="body1">{receipt.about}</Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {t("client-receipts-line", {
                    value: formatCents(receipt.cents),
                    day: formatDayBr(receipt.paidOn) ?? receipt.paidOn,
                    code: receipt.verifyCode,
                  })}
                </Typography>
              </Box>
              <Button
                variant="outlined"
                size="small"
                disabled={busy === receipt.id}
                onClick={() => void download(receipt)}
              >
                {t("client-receipts-download")}
              </Button>
            </Box>
          ))}
        </Box>
        {problem ? (
          <Typography variant="body2" className="text-error" role="alert">
            {problem}
          </Typography>
        ) : null}
      </CardContent>
    </Card>
  );
}
