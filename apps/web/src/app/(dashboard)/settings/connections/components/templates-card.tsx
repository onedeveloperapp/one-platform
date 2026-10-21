"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import StatusChip from "@/components/product/status-chip";
import NiMessage from "@/icons/nexture/ni-message";
import NiRefresh from "@/icons/nexture/ni-refresh";
import { refreshTemplates } from "@/lib/whatsapp/actions";
import { type AccountTemplateRow, connectErrorKey, findingKey, templateStatus } from "@/lib/whatsapp/connections";
import { checkTemplate } from "@flyee/whatsapp/rules";

/**
 * The templates of the firm's account: the messages that may start a
 * conversation, or resume one after the 24 hours. Each shows what the vendor
 * decided about it and, beside that, what a check of its text found for a
 * lawyer to weigh (a promise of result, a word about price). The check points
 * and decides nothing: whether a sentence breaches the bar's rules on
 * advertising is the lawyer's to say.
 */
export default function TemplatesCard({
  templates,
  readOnly,
  onChanged,
}: {
  templates: AccountTemplateRow[];
  /** A support visit reads the templates and asks the vendor for nothing. */
  readOnly: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "synced" } | { kind: "error"; code: string } | null>(null);

  const sync = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);
    const result = await refreshTemplates();
    setBusy(false);
    if (!result.ok) {
      setStatus({ kind: "error", code: result.code });
      return;
    }
    setStatus({ kind: "synced" });
    onChanged();
  };

  return (
    <Grid size={12}>
      <Card component="section" aria-labelledby="connections-templates">
        <CardContent className="flex flex-col gap-4">
          <Box className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
            <Box className="flex min-w-0 flex-col gap-1">
              <Typography id="connections-templates" variant="h5" component="h2" className="mb-0">
                {t("connections-templates-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary max-w-3xl">
                {t("connections-templates-body")}
              </Typography>
            </Box>
            <Button
              variant="outlined"
              color="grey"
              startIcon={<NiRefresh size="medium" />}
              onClick={() => void sync()}
              disabled={busy || readOnly}
              className="flex-none"
            >
              {busy ? t("connections-working") : t("connections-templates-sync")}
            </Button>
          </Box>

          {status?.kind === "synced" ? (
            <Alert
              severity="success"
              role="status"
              className="neutral bg-background-paper/60!"
              onClose={() => setStatus(null)}
            >
              {t("connections-templates-synced")}
            </Alert>
          ) : null}
          {status?.kind === "error" ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t(connectErrorKey(status.code))}
            </Alert>
          ) : null}

          {templates.length === 0 ? (
            <EmptyState
              icon={<NiMessage size="large" />}
              title={t("connections-templates-empty-title")}
              description={t("connections-templates-empty-body")}
              action={readOnly ? undefined : { label: t("connections-templates-sync"), onClick: () => void sync() }}
            />
          ) : (
            <Box component="ul" className="m-0 flex list-none flex-col p-0">
              {templates.map((template) => {
                const state = templateStatus(template.status);
                const findings = checkTemplate({
                  name: template.name,
                  category: template.category,
                  body: template.body,
                  headerText: template.headerText,
                  footerText: template.footerText,
                })
                  .filter((finding) => finding.severity === "warning")
                  .flatMap((finding) => {
                    const key = findingKey(finding.code);
                    return key ? [key] : [];
                  });
                return (
                  <Box
                    component="li"
                    key={template.id}
                    className="border-grey-100 flex flex-col gap-2 border-b py-3 last:border-b-0"
                  >
                    <Box className="flex flex-row flex-wrap items-center gap-2">
                      <Typography variant="subtitle2" component="p" className="min-w-0 flex-1 break-all">
                        {template.name}
                      </Typography>
                      <StatusChip label={t(state.key)} tone={state.tone} />
                    </Box>
                    <Typography variant="body1" className="text-text-primary whitespace-pre-wrap">
                      {[template.headerText, template.body, template.footerText].filter(Boolean).join("\n\n")}
                    </Typography>
                    {findings.length > 0 ? (
                      <Box className="flex flex-col gap-1">
                        <Typography variant="body2" className="text-text-secondary">
                          {t("connections-findings-intro")}
                        </Typography>
                        <Box className="flex flex-row flex-wrap gap-1.5">
                          {findings.map((key) => (
                            <StatusChip key={key} label={t(key)} tone="attention" />
                          ))}
                        </Box>
                      </Box>
                    ) : null}
                  </Box>
                );
              })}
            </Box>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}
