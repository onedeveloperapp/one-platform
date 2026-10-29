"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  Grid,
  TextField,
  Typography,
} from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import DialogHeader from "@/components/product/dialog-header";
import EmptyState from "@/components/product/empty-state";
import PageHeader from "@/components/product/page-header";
import StatusChip from "@/components/product/status-chip";
import NiLink from "@/icons/nexture/ni-link";
import { createApiKey, revokeApiKey } from "@/modules/direito-do-passageiro/agency/actions";
import type { ApiKeyRow } from "@/modules/direito-do-passageiro/agency/facts";
import { paxErrorKey } from "@/modules/direito-do-passageiro/agency/passengers";

export type IntegrationData = { manager: boolean; keys: ApiKeyRow[] | null; base: string };

const when = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(value))
    : "";

/** What each call takes and answers, as the agency's system writes and reads it. Code, never copy. */
const LINES_EXAMPLE = `{
  "linhas": [
    {
      "nome": "Rafaela Teste",
      "cpf": "111.444.777-35",
      "nascimento": "1990-04-12",
      "whatsapp": "(62) 99999-0001",
      "email": "rafaela@exemplo.com",
      "localizador": "ABC123",
      "voo": "LA3456",
      "origem": "GRU",
      "destino": "REC",
      "partida": "2026-11-03T08:10",
      "chegada": "2026-11-03T11:25"
    }
  ]
}`;
const CPF_EXAMPLE = `{ "cpf": "111.444.777-35" }`;

/** The words of a refusal of a new key that only this screen has. */
const KEY_ERROR: Record<string, string> = {
  too_many_keys: "pax-api-too-many",
  invalid_label: "pax-api-label-error",
};

function Code({ children, label }: { children: string; label: string }) {
  return (
    <Box
      component="pre"
      aria-label={label}
      className="bg-grey-25 border-grey-100 m-0 overflow-x-auto rounded-2xl border p-4 text-sm"
    >
      <code>{children}</code>
    </Box>
  );
}

/**
 * The agency's integration with ONE. Who manages a travel agency comes here to connect its booking system: create a
 * key, copy it once into the system, and read how each call goes. Success is a system that sends the passengers and
 * trips by itself, issues each passenger's link and reads where each one stands.
 */
export default function IntegrationView({ data }: { data: IntegrationData | null }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoking, setRevoking] = useState<ApiKeyRow | null>(null);
  const crumbs = [
    { label: t("partner-home-title"), href: "/parceiro" },
    { label: t("pax-title"), href: "/parceiro/passageiros" },
    { label: t("pax-api-title") },
  ];

  if (!data) {
    return (
      <Grid container spacing={5}>
        <Grid size={12}>
          <PageHeader title={t("pax-api-title")} crumbs={crumbs} />
        </Grid>
        <Grid size={12}>
          <EmptyState
            icon={<NiLink size="large" />}
            title={t("pax-no-partnership-title")}
            description={t("pax-no-partnership-body")}
            action={{ label: t("pax-no-partnership-action"), href: "/parceiro" }}
          />
        </Grid>
      </Grid>
    );
  }

  const active = (data.keys ?? []).filter((key) => !key.revokedAt);
  const create = async () => {
    setBusy(true);
    setProblem(null);
    const result = await createApiKey(label);
    setBusy(false);
    if (!result.ok) {
      setProblem(t(KEY_ERROR[result.code] ?? paxErrorKey(result.code)));
      return;
    }
    setMinted(result.key);
    setLabel("");
    router.refresh();
  };
  const copy = async () => {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  const closeCreate = () => {
    setCreating(false);
    setMinted(null);
    setCopied(false);
    setProblem(null);
  };

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <PageHeader
          title={t("pax-api-title")}
          crumbs={crumbs}
          description={t("pax-api-description")}
          action={
            data.manager ? (
              <Button variant="contained" onClick={() => setCreating(true)}>
                {t("pax-api-create")}
              </Button>
            ) : undefined
          }
        />
      </Grid>

      <Grid size={12}>
        <Card component="section" aria-labelledby="pax-api-keys">
          <CardContent className="flex flex-col gap-4">
            <Typography id="pax-api-keys" variant="h5" component="h2" className="mb-0">
              {t("pax-api-keys-title")}
            </Typography>
            {!data.manager && (
              <Alert severity="info" className="neutral bg-background-paper/60!">
                {t("pax-api-member")}
              </Alert>
            )}
            {data.keys === null ? (
              <Alert
                severity="error"
                action={
                  <Button color="inherit" size="small" onClick={() => router.refresh()}>
                    {t("pax-retry")}
                  </Button>
                }
              >
                {t("pax-api-read-error")}
              </Alert>
            ) : data.keys.length === 0 ? (
              <EmptyState
                titleAs="h3"
                icon={<NiLink size="large" />}
                title={t("pax-api-empty-title")}
                description={t("pax-api-empty-body")}
                action={data.manager ? { label: t("pax-api-create"), onClick: () => setCreating(true) } : undefined}
              />
            ) : (
              <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                {data.keys.map((key) => (
                  <Box
                    component="li"
                    key={key.id}
                    className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4 sm:flex-row sm:items-center"
                  >
                    <Box className="flex min-w-0 flex-1 flex-col">
                      <Typography variant="subtitle2" component="p" className="break-words">
                        {key.label}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary break-words">
                        {[
                          `one_${key.prefix}…`,
                          t("pax-api-created-at", { date: when(key.createdAt) }),
                          key.lastUsedAt
                            ? t("pax-api-used-at", { date: when(key.lastUsedAt) })
                            : t("pax-api-never-used"),
                        ].join(" · ")}
                      </Typography>
                    </Box>
                    <Box className="flex flex-wrap items-center gap-2">
                      <StatusChip
                        tone={key.revokedAt ? "neutral" : "positive"}
                        label={key.revokedAt ? t("pax-api-revoked") : t("pax-api-active")}
                      />
                      {data.manager && !key.revokedAt && (
                        <Button variant="text" color="grey" size="small" onClick={() => setRevoking(key)}>
                          {t("pax-api-revoke")}
                        </Button>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
            {active.length > 0 && (
              <Typography variant="body2" className="text-text-secondary">
                {t("pax-api-active-count", { count: active.length })}
              </Typography>
            )}
          </CardContent>
        </Card>
      </Grid>

      <Grid size={12}>
        <Card component="section" aria-labelledby="pax-api-how">
          <CardContent className="flex flex-col gap-4">
            <Typography id="pax-api-how" variant="h5" component="h2" className="mb-0">
              {t("pax-api-how-title")}
            </Typography>
            <Typography variant="body2">{t("pax-api-how-auth")}</Typography>
            <Code label={t("pax-api-how-auth")}>{`Authorization: Bearer one_...\nContent-Type: application/json`}</Code>

            <Typography variant="subtitle2" component="h3">
              {t("pax-api-lines-title")}
            </Typography>
            <Typography variant="body2">{t("pax-api-lines-body")}</Typography>
            <Code label={t("pax-api-lines-title")}>{`POST ${data.base}/passageiros\n\n${LINES_EXAMPLE}`}</Code>

            <Typography variant="subtitle2" component="h3">
              {t("pax-api-link-title")}
            </Typography>
            <Typography variant="body2">{t("pax-api-link-body")}</Typography>
            <Code label={t("pax-api-link-title")}>{`POST ${data.base}/links\n\n${CPF_EXAMPLE}`}</Code>

            <Typography variant="subtitle2" component="h3">
              {t("pax-api-status-title")}
            </Typography>
            <Typography variant="body2">{t("pax-api-status-body")}</Typography>
            <Code label={t("pax-api-status-title")}>{`POST ${data.base}/situacao\n\n${CPF_EXAMPLE}`}</Code>

            <Typography variant="body2" className="text-text-secondary">
              {t("pax-api-limits")}
            </Typography>
          </CardContent>
        </Card>
      </Grid>

      {creating && (
        <Dialog open onClose={busy ? undefined : closeCreate} maxWidth="sm" fullWidth aria-labelledby="pax-api-new">
          <DialogHeader
            id="pax-api-new"
            title={t("pax-api-create")}
            onClose={closeCreate}
            closeLabel={t("pax-close")}
          />
          <DialogContent>
            {minted ? (
              <Box className="flex flex-col gap-3">
                <Alert severity="warning" className="neutral bg-background-paper/60!">
                  {t("pax-api-copy-now")}
                </Alert>
                <TextField
                  id="pax-api-minted"
                  label={t("pax-api-key")}
                  value={minted}
                  size="small"
                  fullWidth
                  slotProps={{ input: { readOnly: true } }}
                  onFocus={(event) => event.target.select()}
                />
                <Box>
                  <Button variant="outlined" color="grey" size="small" onClick={() => void copy()}>
                    {copied ? t("pax-agreement-copied") : t("pax-api-copy")}
                  </Button>
                </Box>
              </Box>
            ) : (
              <Box className="flex flex-col gap-3">
                <TextField
                  id="pax-api-label"
                  label={t("pax-api-label")}
                  helperText={t("pax-api-label-help")}
                  value={label}
                  size="small"
                  fullWidth
                  disabled={busy}
                  onChange={(event) => setLabel(event.target.value)}
                />
                {problem && <Alert severity="error">{problem}</Alert>}
              </Box>
            )}
          </DialogContent>
          <DialogActions>
            {minted ? (
              <Button variant="contained" onClick={closeCreate}>
                {t("pax-api-done")}
              </Button>
            ) : (
              <>
                <Button variant="text" color="grey" onClick={closeCreate} disabled={busy}>
                  {t("pax-cancel")}
                </Button>
                <Button variant="contained" disabled={busy || label.trim().length < 2} onClick={() => void create()}>
                  {busy ? t("pax-saving") : t("pax-api-create-confirm")}
                </Button>
              </>
            )}
          </DialogActions>
        </Dialog>
      )}

      {revoking && (
        <ConfirmActionDialog
          title={t("pax-api-revoke-title", { label: revoking.label })}
          consequences={[t("pax-api-revoke-consequence")]}
          requireReason={false}
          confirmLabel={t("pax-api-revoke")}
          cancelLabel={t("pax-cancel")}
          busyLabel={t("pax-api-revoking")}
          tone="danger"
          onConfirm={async () => {
            const result = await revokeApiKey(revoking.id);
            if (!result.ok) return t(paxErrorKey(result.code));
            router.refresh();
            return null;
          }}
          onClose={() => setRevoking(null)}
        />
      )}
    </Grid>
  );
}
