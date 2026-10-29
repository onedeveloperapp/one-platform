"use client";

import FirmDossierDialog from "./firm-dossier-dialog";
import { usePersonActions } from "./person-actions";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, Tab, Tabs, Typography } from "@mui/material";
import { GridActionsCellItem, type GridColDef } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import MetricBars from "@/components/product/metric-bars";
import PageHeader from "@/components/product/page-header";
import StatusChip from "@/components/product/status-chip";
import type { TileTone } from "@/components/product/tile-tone";
import NiBriefcase from "@/icons/nexture/ni-briefcase";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiClock from "@/icons/nexture/ni-clock";
import NiCreditCard from "@/icons/nexture/ni-credit-card";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiPause from "@/icons/nexture/ni-pause";
import NiRefresh from "@/icons/nexture/ni-refresh";
import NiShield from "@/icons/nexture/ni-shield";
import NiStar from "@/icons/nexture/ni-star";
import NiUserMinus from "@/icons/nexture/ni-user-minus";
import NiUsers from "@/icons/nexture/ni-users";
import {
  ATTENTION_FILTERS,
  filterFirms,
  firmClock,
  type FirmRow,
  firmSearchText,
  type FirmsOverview,
  type FirmTotals,
  isBanned,
  type PartnerOverviewRow,
  type PeopleWithoutFirm,
  type PersonWithoutFirm,
  PLAN_FILTERS,
  planLabel,
} from "@/lib/admin/firms";
import { formatDate, formatDateTime, formatMoneyByCurrency, formatNumber, sinceLabel } from "@/lib/admin/format";
import type { ConsoleState } from "@/lib/admin/session";

export type FirmsState = ConsoleState<{
  overview: FirmsOverview;
  people: PeopleWithoutFirm;
  /** The partnerships of travel agencies with the firms, in counts (0072). */
  partners: PartnerOverviewRow[];
  selfId: string;
  /** False without SUPABASE_SERVICE_ROLE_KEY: the auth-admin actions are not offered. */
  serviceAvailable: boolean;
}>;

const CRUMBS = [{ label: "Início", href: "/inicio" }, { label: "Admin", href: "/admin" }, { label: "Escritórios" }];

type FilterKey = Exclude<keyof FirmTotals, "noOwner">;

const FILTER_ICON: Record<FilterKey, { icon: React.ReactNode; tone: TileTone }> = {
  firms: { icon: <NiBriefcase size="large" />, tone: "primary" },
  withPlan: { icon: <NiStar size="large" />, tone: "primary" },
  noPlan: { icon: <NiUserMinus size="large" />, tone: "secondary" },
  pastDue: { icon: <NiCreditCard size="large" />, tone: "accent-3" },
  idle: { icon: <NiClock size="large" />, tone: "accent-3" },
  noSecondFactor: { icon: <NiShield size="large" />, tone: "accent-3" },
  cancelScheduled: { icon: <NiCalendar size="large" />, tone: "accent-3" },
  suspended: { icon: <NiPause size="large" />, tone: "secondary" },
};

const personName = (person: { name: string | null; email: string | null }) =>
  person.name ?? person.email ?? "Conta sem nome";

/**
 * Which firms use the platform and what needs attention. The operator arrives
 * with one of two jobs: a support call about ONE firm (search, open the
 * dossier, act on a person of its team) or a look at a GROUP that needs
 * something (the tiles are the filters). Both end in a list of many firms to
 * scan and compare, which is why this is a table. The second tab holds the
 * accounts that belong to no firm.
 */
export default function FirmsView({
  state,
  notice = null,
}: {
  state: FirmsState;
  /** A support session just ended, by the operator or by its time limit. */
  notice?: "ended" | "expired" | null;
}) {
  const router = useRouter();
  const [filter, setFilter] = useState<FilterKey>("firms");
  const [tab, setTab] = useState<"firms" | "people" | "partners">("firms");
  const [query, setQuery] = useState("");
  const [dossier, setDossier] = useState<FirmRow | null>(null);

  const ready = state.kind === "ready" ? state : null;
  const refresh = useCallback(() => router.refresh(), [router]);
  const actions = usePersonActions({
    selfId: ready?.selfId ?? null,
    serviceAvailable: ready?.serviceAvailable ?? false,
    onChanged: refresh,
  });

  const firms = useMemo(() => ready?.overview.firms ?? [], [ready?.overview.firms]);
  const visible = useMemo(() => filterFirms(firms, filter), [firms, filter]);

  // The columns shown by default fit a desktop screen with the row action in
  // view; what was paid and the founding date start hidden in the columns
  // panel, and the dossier carries both.
  const firmColumns = useMemo<GridColDef<FirmRow>[]>(
    () => [
      {
        field: "firm",
        headerName: "Escritório",
        flex: 1.5,
        minWidth: 240,
        valueGetter: (_, row) => firmSearchText(row),
        renderCell: ({ row }) => (
          <Box className="flex min-w-0 flex-col justify-center py-1">
            <Box className="flex min-w-0 flex-row items-center gap-2">
              <Typography variant="subtitle2" component="span" className="truncate">
                {row.name}
              </Typography>
              {row.flags.noOwner ? <StatusChip label="sem titular" tone="danger" /> : null}
              {row.owner && isBanned(row.owner.bannedUntil) ? (
                <StatusChip label="titular bloqueado" tone="danger" />
              ) : null}
            </Box>
            <Typography variant="body2" className="text-text-secondary truncate">
              {row.owner ? `${personName(row.owner)} · ${row.owner.email ?? "sem e-mail"}` : "nenhum titular"}
            </Typography>
          </Box>
        ),
      },
      { field: "people", headerName: "Pessoas", width: 100, type: "number", valueGetter: (_, row) => row.people },
      { field: "lawyers", headerName: "Com OAB", width: 100, type: "number", valueGetter: (_, row) => row.lawyers },
      {
        field: "openInvitations",
        headerName: "Convites em aberto",
        width: 160,
        type: "number",
        valueGetter: (_, row) => row.openInvitations,
      },
      { field: "plan", headerName: "Plano", flex: 1, minWidth: 200, valueGetter: (_, row) => planLabel(row) },
      { field: "clock", headerName: "Prazo", flex: 1, minWidth: 170, valueGetter: (_, row) => firmClock(row) },
      {
        field: "lastSignInAt",
        headerName: "Último acesso",
        width: 150,
        valueGetter: (_, row) => row.lastSignInAt ?? "",
        renderCell: ({ row }) => (row.lastSignInAt ? sinceLabel(row.lastSignInAt) : "ninguém entrou"),
      },
      {
        field: "revenue",
        headerName: "Pago até hoje",
        width: 170,
        type: "number",
        align: "left",
        headerAlign: "left",
        // Sorting needs one number; the cell keeps the currencies apart.
        valueGetter: (_, row) => row.revenue.BRL + row.revenue.USD,
        renderCell: ({ row }) => formatMoneyByCurrency(row.revenue),
      },
      {
        field: "createdAt",
        headerName: "Fundado em",
        width: 130,
        valueGetter: (_, row) => row.createdAt,
        renderCell: ({ row }) => formatDate(row.createdAt),
      },
      {
        field: "actions",
        type: "actions",
        headerName: "Ações",
        width: 64,
        getActions: ({ row }) => [
          <GridActionsCellItem
            key="dossier"
            icon={<NiDocumentFull size="medium" />}
            label="Abrir o dossiê"
            onClick={() => setDossier(row)}
            showInMenu
          />,
        ],
      },
    ],
    [],
  );

  const partnerColumns = useMemo<GridColDef<PartnerOverviewRow>[]>(
    () => [
      { field: "agency", headerName: "Agência", flex: 1, minWidth: 180 },
      { field: "firm", headerName: "Escritório", flex: 1, minWidth: 180 },
      {
        field: "status",
        headerName: "Situação",
        width: 130,
        renderCell: ({ row }) => (
          <StatusChip
            tone={row.status === "active" ? "positive" : "neutral"}
            label={row.status === "active" ? "Ativa" : "Encerrada"}
          />
        ),
      },
      {
        field: "startedAt",
        headerName: "Desde",
        width: 120,
        valueGetter: (_, row) => (row.startedAt ? formatDate(row.startedAt) : ""),
      },
      { field: "members", headerName: "Pessoas da agência", width: 150, type: "number" },
      { field: "travelers", headerName: "Passageiros", width: 120, type: "number" },
      { field: "watched", headerName: "Viagens acompanhadas", width: 170, type: "number" },
      { field: "handedOver", headerName: "Repassados ao escritório", width: 190, type: "number" },
      { field: "documents", headerName: "Documentos na agência", width: 180, type: "number" },
    ],
    [],
  );

  const peopleColumns = useMemo<GridColDef<PersonWithoutFirm>[]>(
    () => [
      {
        field: "person",
        headerName: "Pessoa",
        flex: 1.4,
        minWidth: 240,
        valueGetter: (_, row) => `${row.name ?? ""} ${row.email ?? ""}`,
        renderCell: ({ row }) => (
          <Box className="flex min-w-0 flex-col justify-center py-1">
            <Box className="flex min-w-0 flex-row items-center gap-2">
              <Typography variant="subtitle2" component="span" className="truncate">
                {personName(row)}
              </Typography>
              {row.isSuperadmin ? <StatusChip label="superadmin" tone="info" /> : null}
              {isBanned(row.bannedUntil) ? <StatusChip label="bloqueada" tone="danger" /> : null}
            </Box>
            <Typography variant="body2" className="text-text-secondary truncate">
              {row.email ?? "sem e-mail"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "openInvitations",
        headerName: "Convite",
        width: 170,
        valueGetter: (_, row) => (row.openInvitations > 0 ? "convite esperando" : "nenhum convite"),
        renderCell: ({ row }) =>
          row.openInvitations > 0 ? (
            <StatusChip label="convite esperando" tone="attention" />
          ) : (
            <StatusChip label="nenhum convite" tone="neutral" />
          ),
      },
      {
        field: "authProvider",
        headerName: "Entra com",
        width: 150,
        valueGetter: (_, row) => (row.authProvider === "google" ? "Google" : "e-mail e senha"),
      },
      {
        field: "confirmed",
        headerName: "E-mail",
        width: 150,
        valueGetter: (_, row) => (row.confirmed ? "confirmado" : "não confirmado"),
      },
      {
        field: "createdAt",
        headerName: "Conta criada",
        width: 160,
        valueGetter: (_, row) => row.createdAt,
        renderCell: ({ row }) => formatDateTime(row.createdAt),
      },
      {
        field: "lastSignInAt",
        headerName: "Último acesso",
        width: 150,
        valueGetter: (_, row) => row.lastSignInAt ?? "",
        renderCell: ({ row }) => (row.lastSignInAt ? sinceLabel(row.lastSignInAt) : "nunca entrou"),
      },
      {
        field: "actions",
        type: "actions",
        headerName: "Ações",
        width: 64,
        getActions: ({ row }) =>
          actions.buildItems({
            userId: row.userId,
            orgId: null,
            name: personName(row),
            email: row.email,
            isSuperadmin: row.isSuperadmin,
            hasMfa: false,
            banned: isBanned(row.bannedUntil),
          }),
      },
    ],
    [actions],
  );

  const header = (
    <PageHeader
      title="Escritórios"
      crumbs={CRUMBS}
      description="Quem usa a plataforma: a equipe de cada escritório, o plano e o que pede atenção. Abra um escritório para ver a conta por dentro e agir sobre uma pessoa da equipe."
      action={
        <Button variant="outlined" color="grey" startIcon={<NiRefresh size="medium" />} onClick={refresh}>
          Atualizar
        </Button>
      }
    />
  );

  if (!ready) {
    return (
      <Grid container spacing={5}>
        <Grid size={12}>{header}</Grid>
        <Grid size={12}>
          {state.kind === "unavailable" ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              Este console precisa do Supabase configurado e de uma sessão com o papel de superadmin.
            </Alert>
          ) : (
            // A failed read is an error, never a platform with no firms.
            <Alert
              severity="error"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" onClick={refresh}>
                  Tentar de novo
                </Button>
              }
            >
              Não foi possível ler os escritórios agora. Nada foi alterado.
            </Alert>
          )}
        </Grid>
      </Grid>
    );
  }

  const { totals } = ready.overview;
  const activeFilter = [...PLAN_FILTERS, ...ATTENTION_FILTERS].find((entry) => entry.key === filter);

  return (
    <Grid container spacing={5}>
      <Grid size={12}>{header}</Grid>

      {notice ? (
        <Grid size={12}>
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {notice === "expired"
              ? "A sessão de suporte expirou e você voltou para a sua conta."
              : "Sessão de suporte encerrada. Você está de volta na sua conta."}
          </Alert>
        </Grid>
      ) : null}

      {!ready.serviceAvailable ? (
        <Grid size={12}>
          <Alert severity="info" className="neutral bg-background-paper/60!">
            Sem SUPABASE_SERVICE_ROLE_KEY neste ambiente: entrar como, bloquear, redefinir 2FA e excluir conta ficam
            desligados. O restante do console funciona.
          </Alert>
        </Grid>
      ) : null}

      {totals.noOwner > 0 ? (
        <Grid size={12}>
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {formatNumber(totals.noOwner)} {totals.noOwner === 1 ? "escritório está" : "escritórios estão"} sem titular.
            Um escritório sempre deveria ter um: procure por “sem titular” na lista e avise a engenharia.
          </Alert>
        </Grid>
      ) : null}

      <Grid size={12}>
        <Box className="flex flex-col gap-2.5">
          <Box className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {PLAN_FILTERS.map((entry) => (
              <StatTile
                key={entry.key}
                icon={FILTER_ICON[entry.key as FilterKey].icon}
                tone={FILTER_ICON[entry.key as FilterKey].tone}
                label={entry.label}
                value={formatNumber(totals[entry.key])}
                hint={entry.hint}
                pressed={tab === "firms" && filter === entry.key}
                onClick={() => {
                  setTab("firms");
                  setFilter(entry.key as FilterKey);
                }}
              />
            ))}
          </Box>
          <Box className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
            {ATTENTION_FILTERS.map((entry) => (
              <StatTile
                key={entry.key}
                icon={FILTER_ICON[entry.key as FilterKey].icon}
                tone={FILTER_ICON[entry.key as FilterKey].tone}
                label={entry.label}
                value={formatNumber(totals[entry.key])}
                hint={entry.hint}
                pressed={tab === "firms" && filter === entry.key}
                onClick={() => {
                  setTab("firms");
                  setFilter(entry.key as FilterKey);
                }}
              />
            ))}
          </Box>
        </Box>
      </Grid>

      <Grid size={12}>
        <Card>
          <CardContent>
            <Tabs value={tab} onChange={(_, value) => setTab(value)} className="mb-4" aria-label="Listas do console">
              <Tab value="firms" label={`Escritórios (${formatNumber(visible.length)})`} />
              <Tab value="people" label={`Contas sem escritório (${formatNumber(ready.people.totals.people)})`} />
              <Tab value="partners" label={`Parcerias com agências (${formatNumber(ready.partners.length)})`} />
            </Tabs>

            {tab === "partners" ? (
              ready.partners.length === 0 ? (
                <EmptyState
                  icon={<NiUsers size="large" />}
                  title="Nenhuma parceria com agência ainda"
                  description="Um escritório convida uma agência de viagens em Configurações, Parceiros. Cada parceria aparece aqui com o que a agência guarda, em números, nunca um passageiro."
                />
              ) : (
                <DataTable<PartnerOverviewRow>
                  rows={ready.partners}
                  columns={partnerColumns}
                  getRowId={(row) => row.linkId}
                  pageSize={25}
                  pageSizeOptions={[25, 50]}
                  enableExport={false}
                  labels={{ search: "Buscar por agência ou escritório" }}
                  noResultsOverlay={
                    <EmptyState icon={<NiUsers size="large" />} title="Nenhuma parceria corresponde à busca" />
                  }
                />
              )
            ) : tab === "firms" ? (
              firms.length === 0 ? (
                <EmptyState
                  icon={<NiBriefcase size="large" />}
                  title="Nenhum escritório ainda"
                  description="Cada escritório fundado aparece aqui, com a equipe, o plano e o que pede atenção. Enquanto o site está em lista de espera, quem se inscreve fica em Leads."
                  action={{ label: "Ver a lista de espera", href: "/admin/leads" }}
                />
              ) : visible.length === 0 ? (
                <EmptyState
                  icon={<NiBriefcase size="large" />}
                  title={`Nenhum escritório em “${activeFilter?.label ?? "este filtro"}”`}
                  description={activeFilter?.hint ?? "Nenhum escritório corresponde a este filtro agora."}
                  action={{ label: "Ver todos os escritórios", onClick: () => setFilter("firms") }}
                />
              ) : (
                <DataTable<FirmRow>
                  rows={visible}
                  columns={firmColumns}
                  getRowId={(row) => row.orgId}
                  onRowClick={(row) => setDossier(row)}
                  onQuickFilterChange={setQuery}
                  pageSize={25}
                  pageSizeOptions={[25, 50, 100]}
                  initialColumnVisibility={{ lawyers: false, revenue: false, createdAt: false }}
                  labels={{ search: "Buscar por escritório, titular, plano ou campanha" }}
                  noResultsOverlay={
                    <EmptyState
                      icon={<NiBriefcase size="large" />}
                      title="Nenhum escritório corresponde à busca"
                      description={`Nada encontrado para “${query}” ${filter === "firms" ? "entre todos os escritórios" : `no filtro “${activeFilter?.label}”`}. Quem criou a conta e ainda não está em um escritório fica na outra aba.`}
                    />
                  }
                />
              )
            ) : ready.people.people.length === 0 ? (
              <EmptyState
                icon={<NiUsers size="large" />}
                title="Nenhuma conta sem escritório"
                description="Uma conta nova fica aqui até fundar um escritório ou aceitar um convite. Quando alguém aparecer e não sair, vale conferir se o convite foi para outro e-mail."
              />
            ) : (
              <Box className="flex flex-col gap-4">
                <Alert severity="info" className="neutral bg-background-paper/60!">
                  Estas pessoas têm login e ainda não estão em um escritório: ao entrar, veem a tela de fundar um ou
                  aceitar um convite. Quem opera a plataforma também aparece aqui, porque não trabalha dentro de um
                  escritório.
                </Alert>
                <MetricBars
                  spacing="dense"
                  total={ready.people.totals.people}
                  items={[
                    {
                      key: "invited",
                      label: "Com convite esperando",
                      value: ready.people.totals.invited,
                      hint: "Foram convidadas e ainda não aceitaram",
                    },
                    {
                      key: "never",
                      label: "Nunca entraram",
                      value: ready.people.totals.neverSignedIn,
                      hint: "Criaram a conta e não fizeram o primeiro acesso",
                    },
                  ]}
                />
                <DataTable<PersonWithoutFirm>
                  rows={ready.people.people}
                  columns={peopleColumns}
                  getRowId={(row) => row.userId}
                  pageSize={25}
                  pageSizeOptions={[25, 50]}
                  enableExport={false}
                  labels={{ search: "Buscar por nome ou e-mail" }}
                  noResultsOverlay={
                    <EmptyState icon={<NiUsers size="large" />} title="Nenhuma pessoa corresponde à busca" />
                  }
                />
              </Box>
            )}
          </CardContent>
        </Card>
      </Grid>

      {dossier ? (
        <FirmDossierDialog
          key={dossier.orgId}
          orgId={dossier.orgId}
          name={dossier.name}
          listActions={actions.listActions}
          onClose={() => setDossier(null)}
        />
      ) : null}
      {actions.dialogs}
    </Grid>
  );
}
