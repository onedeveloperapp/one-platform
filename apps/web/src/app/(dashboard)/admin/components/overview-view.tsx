"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Alert, Box, Button, Grid, Typography } from "@mui/material";

import { QuickActionTile, StatTile } from "@/components/product/home-tiles";
import PageHeader from "@/components/product/page-header";
import type { TileTone } from "@/components/product/tile-tone";
import NiAnnouncement from "@/icons/nexture/ni-announcement";
import NiArchive from "@/icons/nexture/ni-archive";
import NiBriefcase from "@/icons/nexture/ni-briefcase";
import NiEmail from "@/icons/nexture/ni-email";
import NiHeadset from "@/icons/nexture/ni-headset";
import NiMoney from "@/icons/nexture/ni-money";
import NiPen from "@/icons/nexture/ni-pen";
import NiQuestionHexagon from "@/icons/nexture/ni-question-hexagon";
import NiReceipt from "@/icons/nexture/ni-receipt";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiTag from "@/icons/nexture/ni-tag";
import NiUserPlus from "@/icons/nexture/ni-user-plus";
import NiUsers from "@/icons/nexture/ni-users";
import { formatMoneyByCurrency, formatNumber } from "@/lib/admin/format";
import type { ConsoleState } from "@/lib/admin/session";

/** `admin_metrics()` (migration 0012). Money is kept per currency, never summed across them. */
export type AdminMetrics = {
  firms: number;
  people: number;
  new_firms_30d: number;
  new_people_30d: number;
  /** Accounts that founded or joined no firm yet. */
  people_without_firm: number;
  open_invitations: number;
  subscriptions: Record<string, number>;
  suspended: number;
  mrr: { currency: string; amount_cents: number }[];
  revenue_30d: { currency: string; amount_cents: number }[];
  /** Firms where somebody of the team signed in, in their own name. */
  firms_signed_in_7d: number;
  leads_confirmed: number;
};

export type OverviewState = ConsoleState<{ metrics: AdminMetrics }>;

const byCurrency = (entries: { currency: string; amount_cents: number }[]) =>
  Object.fromEntries(entries.map((entry) => [entry.currency, Number(entry.amount_cents)]));

const CONSOLES: { href: string; title: string; description: string; icon: React.ReactNode; tone: TileTone }[] = [
  {
    href: "/admin/escritorios",
    title: "Escritórios",
    description: "Equipes, planos e alertas",
    icon: <NiUsers size="large" />,
    tone: "primary",
  },
  {
    href: "/admin/leads",
    title: "Leads",
    description: "Lista de espera e newsletter",
    icon: <NiEmail size="large" />,
    tone: "accent-2",
  },
  {
    href: "/admin/billing",
    title: "Faturamento",
    description: "Planos, cupons e assinaturas",
    icon: <NiMoney size="large" />,
    tone: "accent-2",
  },
  {
    href: "/admin/ai",
    title: "Preços de IA",
    description: "Tabela de preços dos modelos",
    icon: <NiTag size="large" />,
    tone: "accent-2",
  },
  {
    href: "/admin/audit",
    title: "Auditoria",
    description: "Trilha e histórico de acessos",
    icon: <NiShieldCheck size="large" />,
    tone: "accent-4",
  },
  {
    href: "/admin/backups",
    title: "Backups",
    description: "Cópias diárias do banco",
    icon: <NiArchive size="large" />,
    tone: "accent-4",
  },
  {
    href: "/admin/announcements",
    title: "Anúncios",
    description: "Avisos para todo o painel",
    icon: <NiAnnouncement size="large" />,
    tone: "accent-4",
  },
  {
    href: "/admin/help",
    title: "Central de ajuda",
    description: "Artigos públicos por idioma",
    icon: <NiQuestionHexagon size="large" />,
    tone: "secondary",
  },
  {
    href: "/admin/blog",
    title: "Blog e novidades",
    description: "Posts e comentários",
    icon: <NiPen size="large" />,
    tone: "secondary",
  },
  {
    href: "/admin/support",
    title: "Site e suporte",
    description: "Lançamento e empresa",
    icon: <NiHeadset size="large" />,
    tone: "secondary",
  },
];

const CRUMBS = [{ label: "Início", href: "/inicio" }, { label: "Admin" }];

/**
 * The operator's front door: the platform's real numbers in one row of
 * counters, then every console. Each counter comes from `admin_metrics()`; the
 * consoles behind the tiles hold the detail.
 */
export default function OverviewView({ state }: { state: OverviewState }) {
  const router = useRouter();
  const metrics = state.kind === "ready" ? state.metrics : null;
  const active = (metrics?.subscriptions.active ?? 0) + (metrics?.subscriptions.trialing ?? 0);
  const pastDue = metrics?.subscriptions.past_due ?? 0;
  const suspended = metrics?.suspended ?? 0;

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <PageHeader
          title="Administração"
          crumbs={CRUMBS}
          description="Os números da plataforma e a porta de cada console."
        />
      </Grid>

      {state.kind === "unavailable" ? (
        <Grid size={12}>
          <Alert severity="info" className="neutral bg-background-paper/60!">
            Os consoles precisam do Supabase configurado e de uma sessão com o papel de superadmin.
          </Alert>
        </Grid>
      ) : null}

      {state.kind === "error" ? (
        <Grid size={12}>
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" onClick={() => router.refresh()}>
                Tentar de novo
              </Button>
            }
          >
            Não foi possível ler os números da plataforma agora. Os consoles abaixo continuam disponíveis.
          </Alert>
        </Grid>
      ) : null}

      {metrics && (pastDue > 0 || suspended > 0) ? (
        <Grid size={12}>
          <Alert
            severity="warning"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" component={Link} href="/admin/escritorios">
                Ver os escritórios
              </Button>
            }
          >
            {[
              pastDue > 0
                ? `${formatNumber(pastDue)} ${pastDue === 1 ? "assinatura inadimplente" : "assinaturas inadimplentes"}`
                : null,
              suspended > 0
                ? `${formatNumber(suspended)} ${suspended === 1 ? "escritório suspenso" : "escritórios suspensos"} pela equipe`
                : null,
            ]
              .filter(Boolean)
              .join(" e ")}
            .
          </Alert>
        </Grid>
      ) : null}

      {metrics ? (
        <Grid size={12}>
          <Box className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
            <StatTile
              icon={<NiMoney size="large" />}
              tone="primary"
              label="Receita recorrente por mês"
              value={formatMoneyByCurrency(byCurrency(metrics.mrr))}
              hint="Assinaturas pagas ativas, ao preço vendido, normalizadas por mês"
            />
            <StatTile
              icon={<NiReceipt size="large" />}
              tone="primary"
              label="Recebido em 30 dias"
              value={formatMoneyByCurrency(byCurrency(metrics.revenue_30d))}
              hint="Faturas pagas nos últimos 30 dias, sem reembolsos"
            />
            <StatTile
              icon={<NiReceipt size="large" />}
              tone="accent-2"
              label="Assinaturas ativas"
              value={formatNumber(active)}
              hint={`${formatNumber(pastDue)} inadimplentes`}
            />
            <StatTile
              icon={<NiBriefcase size="large" />}
              tone="accent-2"
              label="Escritórios"
              value={formatNumber(metrics.firms)}
              hint={`${formatNumber(metrics.new_firms_30d)} novos em 30 dias`}
            />
            <StatTile
              icon={<NiBriefcase size="large" />}
              tone="accent-4"
              label="Escritórios que entraram em 7 dias"
              value={formatNumber(metrics.firms_signed_in_7d)}
              hint="Alguém da equipe entrou, em nome próprio"
            />
            <StatTile
              icon={<NiUsers size="large" />}
              tone="accent-4"
              label="Pessoas"
              value={formatNumber(metrics.people)}
              hint={`${formatNumber(metrics.new_people_30d)} novas em 30 dias`}
            />
            <StatTile
              icon={<NiUserPlus size="large" />}
              tone="secondary"
              label="Contas sem escritório"
              value={formatNumber(metrics.people_without_firm)}
              hint={`${formatNumber(metrics.open_invitations)} convites em aberto`}
            />
            <StatTile
              icon={<NiEmail size="large" />}
              tone="secondary"
              label="Leads confirmados"
              value={formatNumber(metrics.leads_confirmed)}
              hint="Confirmaram o e-mail e não se descadastraram"
            />
          </Box>
        </Grid>
      ) : null}

      <Grid size={12}>
        <Typography variant="h5" component="h2" className="mb-3">
          Consoles
        </Typography>
        <Box className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-4">
          {CONSOLES.map((entry) => (
            <QuickActionTile key={entry.href} {...entry} />
          ))}
        </Box>
      </Grid>
    </Grid>
  );
}
