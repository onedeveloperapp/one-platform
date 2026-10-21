"use client";

import { exportSubscribedLeads, optOutLead, purgeLead, resumeNewsletter } from "../actions";
import NewsletterDialog from "./newsletter-dialog";
import { useRouter } from "next/navigation";
import { useSnackbar } from "notistack";
import { useCallback, useMemo, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import PageHeader from "@/components/product/page-header";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import NiArrowInDown from "@/icons/nexture/ni-arrow-in-down";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiClock from "@/icons/nexture/ni-clock";
import NiEmail from "@/icons/nexture/ni-email";
import NiEmailOpen from "@/icons/nexture/ni-email-open";
import NiSendRight from "@/icons/nexture/ni-send-right";
import NiUserMinus from "@/icons/nexture/ni-user-minus";
import { formatDate, formatDateTime, formatNumber } from "@/lib/admin/format";
import { labelOf, LEAD_SOURCE_LABEL, LOCALE_LABEL } from "@/lib/admin/labels";
import { type AdminLead, LEAD_STATUS_LABEL, type LeadStatus, leadStatus } from "@/lib/admin/leads";
import { textOf } from "@/lib/admin/localized";
import { NEWSLETTER_STATUS_LABEL, type NewsletterSend, type NewsletterStatus } from "@/lib/admin/newsletter";
import type { ConsoleState } from "@/lib/admin/session";

export type LeadsState = ConsoleState<{ leads: AdminLead[]; sends: NewsletterSend[] }>;

/** A send that stopped is something to act on, not a failure of the product: attention, never red. */
const SEND_TONE: Record<NewsletterStatus, StatusTone> = {
  queued: "info",
  sending: "info",
  sent: "positive",
  failed: "attention",
};

type Filter = "all" | LeadStatus;

const CRUMBS = [{ label: "Início", href: "/inicio" }, { label: "Admin", href: "/admin" }, { label: "Leads" }];

const STATUS_TONE: Record<LeadStatus, StatusTone> = {
  subscribed: "positive",
  pending: "neutral",
  opted_out: "neutral",
};

const FILTERS: { key: Filter; label: string; hint: string; icon: React.ReactNode }[] = [
  {
    key: "all",
    label: "Todos",
    hint: "Todo contato da lista de espera e da newsletter",
    icon: <NiEmail size="large" />,
  },
  {
    key: "subscribed",
    label: "Confirmados",
    hint: "Confirmaram pelo e-mail e podem receber as novidades",
    icon: <NiEmailOpen size="large" />,
  },
  {
    key: "pending",
    label: "Aguardando confirmação",
    hint: "Ainda não clicaram no link. São apagados sozinhos depois de 7 dias",
    icon: <NiClock size="large" />,
  },
  {
    key: "opted_out",
    label: "Descadastrados",
    hint: "Não recebem mais nada. São apagados sozinhos depois de 6 meses",
    icon: <NiUserMinus size="large" />,
  },
];

/**
 * The people who left an e-mail before having an account: the waitlist and the
 * newsletter. The operator comes to see how the list grows, to write to who
 * confirmed, to export who may be mailed, and to act on a person's request
 * (stop mailing, erase).
 *
 * `canSend` is whether this environment has an e-mail provider: without one
 * the list can still be read and exported, and the screen says why it cannot
 * be written to.
 */
export default function LeadsView({ state, canSend }: { state: LeadsState; canSend: boolean }) {
  const router = useRouter();
  const { enqueueSnackbar } = useSnackbar();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [purging, setPurging] = useState<AdminLead | null>(null);
  const [exporting, setExporting] = useState(false);
  const [writing, setWriting] = useState(false);
  const [resuming, setResuming] = useState<string | null>(null);
  const refresh = useCallback(() => router.refresh(), [router]);

  const leads = useMemo(() => (state.kind === "ready" ? state.leads : []), [state]);
  const sends = useMemo(() => (state.kind === "ready" ? state.sends : []), [state]);
  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: leads.length, subscribed: 0, pending: 0, opted_out: 0 };
    for (const lead of leads) result[leadStatus(lead)] += 1;
    return result;
  }, [leads]);
  const visible = useMemo(
    () => (filter === "all" ? leads : leads.filter((lead) => leadStatus(lead) === filter)),
    [leads, filter],
  );

  const optOut = useCallback(
    async (lead: AdminLead) => {
      const result = await optOutLead(lead.id);
      if (!result.ok) enqueueSnackbar(result.error, { variant: "error" });
      else {
        enqueueSnackbar(`${lead.email} não recebe mais as novidades.`, { variant: "success" });
        refresh();
      }
    },
    [enqueueSnackbar, refresh],
  );

  const resume = async (send: NewsletterSend) => {
    setResuming(send.id);
    const result = await resumeNewsletter(send.id);
    setResuming(null);
    if (!result.ok) enqueueSnackbar(result.error, { variant: "error" });
    else {
      enqueueSnackbar(
        result.data.queued
          ? "Envio retomado na fila. Só quem ainda não recebeu é avisado."
          : "Envio retomado. Recarregue em instantes para ver o andamento.",
        { variant: "success" },
      );
      refresh();
    }
  };

  const exportCsv = async () => {
    setExporting(true);
    const result = await exportSubscribedLeads();
    setExporting(false);
    if (!result.ok) {
      enqueueSnackbar(result.error, { variant: "error" });
      return;
    }
    const blob = new Blob([result.data.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `one-contatos-confirmados-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    enqueueSnackbar(`${formatNumber(result.data.count)} contatos exportados.`, { variant: "success" });
  };

  const columns = useMemo<GridColDef<AdminLead>[]>(
    () => [
      {
        field: "email",
        headerName: "Contato",
        flex: 1.4,
        minWidth: 220,
        valueGetter: (_, row) => `${row.email} ${row.name ?? ""}`,
        renderCell: ({ row }) => (
          <Box className="flex min-w-0 flex-col justify-center py-1">
            <Typography variant="subtitle2" component="span" className="truncate">
              {row.email}
            </Typography>
            <Typography variant="body2" className="text-text-secondary truncate">
              {row.name ?? "sem nome"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "status",
        headerName: "Estado",
        width: 190,
        valueGetter: (_, row) => LEAD_STATUS_LABEL[leadStatus(row)],
        renderCell: ({ row }) => (
          <StatusChip label={LEAD_STATUS_LABEL[leadStatus(row)]} tone={STATUS_TONE[leadStatus(row)]} />
        ),
      },
      {
        field: "source",
        headerName: "Origem",
        width: 130,
        valueGetter: (_, row) => labelOf(LEAD_SOURCE_LABEL, row.source),
      },
      { field: "locale", headerName: "Idioma", width: 110, valueGetter: (_, row) => labelOf(LOCALE_LABEL, row.locale) },
      {
        field: "origem",
        headerName: "Porta / campanha",
        flex: 1,
        minWidth: 160,
        valueGetter: (_, row) => [row.origem, row.utmCampaign].filter(Boolean).join(" · ") || "direto",
      },
      {
        field: "createdAt",
        headerName: "Inscrição",
        width: 110,
        valueGetter: (_, row) => row.createdAt,
        renderCell: ({ row }) => formatDate(row.createdAt),
      },
      {
        field: "confirmedAt",
        headerName: "Confirmou em",
        width: 160,
        valueGetter: (_, row) => row.confirmedAt ?? "",
        renderCell: ({ row }) => (row.confirmedAt ? formatDateTime(row.confirmedAt) : "—"),
      },
      {
        field: "actions",
        type: "actions",
        headerName: "Ações",
        width: 64,
        getActions: ({ row }) => [
          ...(row.optedOutAt
            ? []
            : [
                <GridActionsCellItem
                  key="opt-out"
                  icon={<NiUserMinus size="medium" />}
                  label="Parar de enviar e-mails"
                  onClick={() => optOut(row)}
                  showInMenu
                />,
              ]),
          <GridActionsCellItem
            key="purge"
            icon={<NiBinEmpty size="medium" />}
            label="Apagar os dados (pedido da pessoa)"
            onClick={() => setPurging(row)}
            showInMenu
          />,
        ],
      },
    ],
    [optOut],
  );

  const header = (
    <PageHeader
      title="Leads"
      crumbs={CRUMBS}
      description="Quem deixou o e-mail na lista de espera ou na newsletter, sem conta ainda. A confirmação pelo e-mail é o que libera o envio."
      action={
        state.kind === "ready" ? (
          <Button
            variant="contained"
            startIcon={<NiSendRight size="medium" />}
            onClick={() => setWriting(true)}
            disabled={!canSend || counts.subscribed === 0}
          >
            Escrever para a lista
          </Button>
        ) : undefined
      }
    />
  );

  if (state.kind !== "ready") {
    return (
      <Grid container spacing={5}>
        <Grid size={12}>{header}</Grid>
        <Grid size={12}>
          {state.kind === "unavailable" ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              Este console precisa do Supabase configurado e de uma sessão com o papel de superadmin.
            </Alert>
          ) : (
            <Alert
              severity="error"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" onClick={refresh}>
                  Tentar de novo
                </Button>
              }
            >
              Não foi possível ler os leads agora.
            </Alert>
          )}
        </Grid>
      </Grid>
    );
  }

  const active = FILTERS.find((entry) => entry.key === filter) ?? FILTERS[0];

  return (
    <Grid container spacing={5}>
      <Grid size={12}>{header}</Grid>

      <Grid size={12}>
        <Box className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          {FILTERS.map((entry) => (
            <StatTile
              key={entry.key}
              icon={entry.icon}
              tone={entry.key === "subscribed" ? "accent-2" : entry.key === "opted_out" ? "secondary" : "primary"}
              label={entry.label}
              value={formatNumber(counts[entry.key])}
              hint={entry.hint}
              pressed={filter === entry.key}
              onClick={() => setFilter(entry.key)}
            />
          ))}
        </Box>
      </Grid>

      {!canSend ? (
        <Grid size={12}>
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            Este ambiente não tem provedor de e-mail configurado (RESEND_API_KEY): a lista pode ser lida e exportada,
            mas não dá para escrever para ela por aqui.
          </Alert>
        </Grid>
      ) : null}

      {sends.length > 0 ? (
        <Grid size={12}>
          <Card component="section" aria-labelledby="leads-sends-title">
            <CardContent className="flex flex-col gap-3">
              <Typography id="leads-sends-title" variant="h6" component="h2" className="mb-0">
                Mensagens para a lista
              </Typography>
              <Box component="ul" className="m-0 flex list-none flex-col p-0">
                {sends.map((send) => (
                  <Box
                    component="li"
                    key={send.id}
                    className="border-grey-100 flex flex-col gap-2 border-b py-3 last:border-b-0 md:flex-row md:items-center md:gap-4"
                  >
                    <Box className="flex min-w-0 flex-1 flex-col">
                      <Typography variant="subtitle2" component="span" className="truncate">
                        {textOf(send.subject, "Sem assunto")}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary">
                        {formatDateTime(send.createdAt)}
                        {" · "}
                        {send.source ? `só ${labelOf(LEAD_SOURCE_LABEL, send.source)}` : "todos os confirmados"}
                        {send.status === "failed" && send.lastError ? ` · parou em: ${send.lastError}` : ""}
                      </Typography>
                    </Box>
                    <Box className="flex flex-none flex-row flex-wrap items-center gap-2">
                      <StatusChip label={NEWSLETTER_STATUS_LABEL[send.status]} tone={SEND_TONE[send.status]} />
                      <Typography variant="body2" className="text-text-secondary tabular-nums">
                        {send.delivered === 1 ? "1 entregue" : `${formatNumber(send.delivered)} entregues`}
                      </Typography>
                      {send.status !== "sent" ? (
                        <Button
                          size="small"
                          variant="outlined"
                          color="grey"
                          disabled={!canSend || resuming !== null}
                          onClick={() => resume(send)}
                          aria-label={`Retomar envio: ${textOf(send.subject, "sem assunto")}`}
                        >
                          {resuming === send.id ? "Retomando…" : "Retomar envio"}
                        </Button>
                      ) : null}
                    </Box>
                  </Box>
                ))}
              </Box>
              <Typography variant="body2" className="text-text-secondary">
                Retomar continua de onde o envio parou: quem já recebeu não recebe de novo.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      ) : null}

      <Grid size={12}>
        <Alert severity="info" className="neutral bg-background-paper/60!">
          O consentimento destes contatos cobre e-mails de novidades enviados pela Resend: lançamentos, mudanças nas IAs
          e convites para encontros. Por isso o envio e a exportação alcançam só os confirmados que não se
          descadastraram; o CSV sai no formato de importação de contatos da Resend. Ele não cobre públicos de anúncio:
          não use esta lista em Meta, Google ou outra rede.
          {/* Under the text, not beside it: on a phone a button in the alert's action slot leaves the text a column a few words wide. */}
          <Box className="mt-3">
            <Button
              variant="outlined"
              color="grey"
              size="small"
              startIcon={<NiArrowInDown size="medium" />}
              onClick={exportCsv}
              disabled={exporting || counts.subscribed === 0}
            >
              {exporting ? "Exportando…" : "Exportar confirmados (CSV)"}
            </Button>
          </Box>
        </Alert>
      </Grid>

      <Grid size={12}>
        <Card>
          <CardContent>
            {leads.length === 0 ? (
              <EmptyState
                icon={<NiEmail size="large" />}
                title="Nenhum contato ainda"
                description="Quem se inscreve na lista de espera do site aparece aqui. O link de confirmação chega por e-mail e só depois do clique o contato pode receber as novidades."
                action={{ label: "Abrir a lista de espera", href: "/espera" }}
              />
            ) : visible.length === 0 ? (
              <EmptyState
                icon={<NiEmail size="large" />}
                title={`Nenhum contato em “${active.label}”`}
                description={active.hint}
                action={{ label: "Ver todos", onClick: () => setFilter("all") }}
              />
            ) : (
              <DataTable<AdminLead>
                rows={visible}
                columns={columns}
                getRowId={(row) => row.id}
                onQuickFilterChange={setQuery}
                pageSize={25}
                pageSizeOptions={[25, 50, 100]}
                enableExport={false}
                initialColumnVisibility={{ locale: false, confirmedAt: false }}
                labels={{ search: "Buscar por e-mail, nome ou campanha" }}
                noResultsOverlay={
                  <EmptyState
                    icon={<NiEmail size="large" />}
                    title="Nenhum contato corresponde à busca"
                    description={`Nada encontrado para “${query}”.`}
                  />
                }
              />
            )}
          </CardContent>
        </Card>
      </Grid>

      {writing ? (
        <NewsletterDialog
          onClose={() => setWriting(false)}
          onSent={(queued) => {
            setWriting(false);
            enqueueSnackbar(
              queued
                ? "Envio colocado na fila. O andamento aparece em Mensagens para a lista."
                : "Envio iniciado. Recarregue em instantes para ver o andamento.",
              { variant: "success" },
            );
            refresh();
          }}
        />
      ) : null}

      {purging ? (
        <ConfirmActionDialog
          key={purging.id}
          title={`Apagar os dados de ${purging.email}?`}
          intro="Use para um pedido de exclusão feito pela própria pessoa (LGPD)."
          consequences={[
            "O contato e todo o histórico de alterações dele são apagados, sem como recuperar.",
            "Se a pessoa se inscrever de novo, entra como um contato novo e precisa confirmar outra vez.",
          ]}
          stays={["A trilha de auditoria guarda só o id e o motivo, nunca o e-mail ou o nome."]}
          reasonPlaceholder="Pedido por e-mail em 01/10, ticket 1234"
          confirmLabel="Apagar para sempre"
          tone="danger"
          onConfirm={async (reason) => {
            const result = await purgeLead(purging.id, reason);
            if (!result.ok) return result.error;
            setPurging(null);
            enqueueSnackbar("Dados apagados.", { variant: "success" });
            refresh();
            return null;
          }}
          onClose={() => setPurging(null)}
        />
      ) : null}
    </Grid>
  );
}
