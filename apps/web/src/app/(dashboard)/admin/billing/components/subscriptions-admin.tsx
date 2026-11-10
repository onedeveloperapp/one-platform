"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Alert, Box, Button, Chip, FormControl, Select, Switch, Tooltip, Typography } from "@mui/material";
import { type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import IllustrationAccounts from "@/icons/illustrations/illustration-accounts";
import { recordAudit } from "@/lib/audit";
import { createClient } from "@flyee/auth/client";

type SubRow = {
  id: string;
  orgId: string;
  status: string;
  adminSuspended: boolean;
  period: string | null;
  provider: string | null;
  orgName: string;
  planName: string;
  createdAt: string;
  planId: string;
  /** A provider-backed subscription cannot be re-planned from here. */
  providerManaged: boolean;
  /** The price it was SOLD at (snapshot, migration 0003); later plan edits never touch it. */
  priceCents: number | null;
  currency: string | null;
  couponCode: string | null;
  /** False for a yearly plan paid in installments: one purchase, no renewal. */
  renews: boolean;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  cancelReason: string | null;
};

/** Why a member left (enum subscription_cancel_reason), as the operator reads it. */
const CANCEL_REASON_LABEL: Record<string, string> = {
  too_expensive: "achou caro",
  not_using: "não está usando",
  missing_tool: "falta a ferramenta",
  switched: "trocou de solução",
  technical: "problema técnico",
  temporary: "pausa",
  other: "outro motivo",
};

const moneyOf = (cents: number | null, currency: string | null) =>
  cents === null || !currency
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);

/** Renewal in one line: renews, single term, or ending (with the reason, when given). */
const renewalOf = (row: SubRow) => {
  const end = row.currentPeriodEnd ? new Date(row.currentPeriodEnd).toLocaleDateString("pt-BR") : null;
  if (!row.renews) return end ? `pago por um período · até ${end}` : "pago por um período";
  if (row.cancelAtPeriodEnd) {
    const reason = row.cancelReason ? ` · ${CANCEL_REASON_LABEL[row.cancelReason] ?? row.cancelReason}` : "";
    return `cancela${end ? ` em ${end}` : ""}${reason}`;
  }
  return end ? `renova em ${end}` : "renova";
};

/** Tiers a workspace can be put on: real subscriptions, never add-ons. */
type AssignablePlan = { id: string; name: string; isFree: boolean };

const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  active: "success",
  trialing: "warning",
  past_due: "error",
  incomplete: "default",
};

/** The status enum as the operator reads it; an unknown value falls back to the raw one. */
const STATUS_LABEL: Record<string, string> = {
  active: "ativa",
  trialing: "em trial",
  past_due: "inadimplente",
  incomplete: "incompleta",
  canceled: "cancelada",
};

/** The old row's secondary line: which plan, on what terms, since when. */
const planLineOf = (row: SubRow) =>
  `${row.period ? `${row.period} · ` : ""}${row.provider ? `${row.provider} · ` : ""}desde ${new Date(row.createdAt).toLocaleDateString()}`;

export default function SubscriptionsAdmin() {
  const [rows, setRows] = useState<SubRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const [plans, setPlans] = useState<AssignablePlan[]>([]);
  const [planDraft, setPlanDraft] = useState<Record<string, string>>({});
  const [assigning, setAssigning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [{ data, error: readError }, { data: planRows }] = await Promise.all([
      supabase
        .from("subscriptions")
        .select(
          "id, org_id, plan_id, status, admin_suspended, period, provider, provider_subscription_id, created_at, price_cents, currency, coupon_code_snapshot, renews, cancel_at_period_end, current_period_end, cancel_reason, organizations(name), plans(name)",
        )
        .in("status", ["trialing", "active", "past_due", "incomplete"])
        .order("created_at", { ascending: false })
        .limit(200),
      // Assignable tiers only: recurring plans. An add-on or a one-time access
      // plan (the kit) is not something a workspace is subscribed to —
      // `set_org_plan` refuses those anyway, so offering them here would only
      // produce errors. The kit is given as a grant (entitlement_grants).
      supabase
        .from("plans")
        .select("id, name, is_free, is_addon, kind, period")
        .eq("is_active", true)
        .eq("is_addon", false)
        .eq("kind", "recurring")
        .not("period", "is", null)
        .order("sort"),
    ]);

    if (readError) {
      setError(readError.message);
      setLoadFailed(true);
      setLoaded(true);
      return;
    }

    setPlans((planRows ?? []).map((plan) => ({ id: plan.id, name: plan.name, isFree: Boolean(plan.is_free) })));

    setRows(
      (data ?? []).map((row) => ({
        id: row.id,
        orgId: row.org_id,
        status: row.status,
        adminSuspended: row.admin_suspended,
        period: row.period,
        provider: row.provider,
        orgName: (row.organizations as unknown as { name: string } | null)?.name ?? "Conta desconhecida",
        planName: (row.plans as unknown as { name: string } | null)?.name ?? "Plano desconhecido",
        createdAt: row.created_at,
        planId: row.plan_id,
        providerManaged: Boolean(row.provider_subscription_id),
        priceCents: (row.price_cents as number | null) ?? null,
        currency: (row.currency as string | null) ?? null,
        couponCode: (row.coupon_code_snapshot as string | null) ?? null,
        renews: row.renews !== false,
        cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
        currentPeriodEnd: (row.current_period_end as string | null) ?? null,
        cancelReason: (row.cancel_reason as string | null) ?? null,
      })),
    );
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Superadmin kill-switch: suspends/reactivates access regardless of the
  // provider-side subscription state.
  const toggleSuspended = useCallback(
    async (row: SubRow) => {
      setError(null);
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("subscriptions")
        .update({ admin_suspended: !row.adminSuspended })
        .eq("id", row.id);
      if (updateError) {
        setError(updateError.message);
        return;
      }
      recordAudit(supabase, row.adminSuspended ? "admin.org.reactivated" : "admin.org.suspended", {
        entityType: "subscription",
        entityId: row.id,
        metadata: { org: row.orgName },
      });
      refresh();
    },
    [refresh],
  );

  /**
   * Puts a workspace on a plan without a checkout — comped accounts, betas,
   * partners, the team's own workspace.
   *
   * Everything that makes this safe lives in `set_org_plan` (migration 0004):
   * update instead of insert, NULL period bounds so a comped plan still meters
   * itself, the free plan as the way to "remove" a plan, a refusal when the
   * subscription is provider-backed, and an audit event that records whether
   * the operator was assigning to their own workspace. The console only picks
   * the target and reports back.
   */
  const assignPlan = useCallback(
    async (row: SubRow) => {
      setError(null);
      setNotice(null);
      const planId = planDraft[row.orgId];
      if (!planId || planId === row.planId) {
        setError("Escolha um plano diferente primeiro.");
        return;
      }
      setAssigning(row.orgId);
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("set_org_plan", {
        target_org: row.orgId,
        target_plan: planId,
        target_note: "Atribuído pelo console de faturamento",
      });
      setAssigning(null);
      if (rpcError) {
        setError(
          rpcError.message.includes("provider_managed")
            ? "Esta conta paga por um provedor — trocar o plano aqui descolaria a cobrança do que ela tem direito. Cancele a assinatura no provedor antes."
            : rpcError.message,
        );
        return;
      }
      const result = data as { toPlan?: string; selfGrant?: boolean } | null;
      setNotice(
        `${row.orgName} agora está no ${result?.toPlan ?? "plano selecionado"}${result?.selfGrant ? " (sua própria conta — registrado na trilha de auditoria)" : ""}.`,
      );
      setPlanDraft((draft) => ({ ...draft, [row.orgId]: "" }));
      refresh();
    },
    [planDraft, refresh],
  );

  const columns = useMemo<GridColDef<SubRow>[]>(
    () => [
      {
        field: "orgName",
        headerName: "Conta",
        flex: 1.5,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<SubRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.row.orgName}
            </Typography>
          </Box>
        ),
      },
      {
        field: "planName",
        headerName: "Plano",
        flex: 1.5,
        minWidth: 220,
        // Period, provider and start date are searched and exported with the
        // plan name, even though the cell renders them on a second line.
        valueGetter: (_, row) => `${row.planName} · ${planLineOf(row)}`,
        renderCell: (params: GridRenderCellParams<SubRow, string>) => (
          <Box className="flex h-full min-w-0 flex-col justify-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {params.row.planName}
            </Typography>
            <Typography variant="body2" className="text-text-secondary truncate">
              {planLineOf(params.row)}
            </Typography>
          </Box>
        ),
      },
      {
        field: "priceCents",
        headerName: "Preço vendido",
        minWidth: 170,
        // The snapshot, not the plan's current price: what this member pays.
        valueGetter: (_, row) =>
          `${moneyOf(row.priceCents, row.currency)}${row.couponCode ? ` · ${row.couponCode}` : ""}`,
      },
      {
        field: "renews",
        headerName: "Renovação",
        minWidth: 220,
        valueGetter: (_, row) => renewalOf(row),
      },
      {
        field: "status",
        headerName: "Situação",
        minWidth: 170,
        valueGetter: (_, row) =>
          `${STATUS_LABEL[row.status] ?? row.status.replace("_", " ")}${row.adminSuspended ? " suspensa" : ""}`,
        renderCell: (params: GridRenderCellParams<SubRow, string>) => (
          <Box className="flex h-full flex-row items-center gap-1">
            <Chip
              label={STATUS_LABEL[params.row.status] ?? params.row.status.replace("_", " ")}
              size="small"
              color={STATUS_COLOR[params.row.status] ?? "default"}
              variant="outlined"
              className="first-letter:uppercase"
            />
            {params.row.adminSuspended && <Chip label="suspensa" size="small" color="error" variant="outlined" />}
          </Box>
        ),
      },
      {
        // Comped plan. Disabled rather than hidden when the provider owns
        // the subscription, so the reason is visible instead of the control
        // silently not being there. Downgrading is the same control: pick
        // the free plan.
        field: "compedPlan",
        headerName: "Plano cortesia",
        minWidth: 280,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<SubRow>) => (
          <Box className="flex h-full flex-row items-center gap-2">
            <Tooltip
              title={
                params.row.providerManaged
                  ? "Pago por um provedor — troque o plano no provedor, não aqui"
                  : "Atribuir um plano sem checkout"
              }
            >
              <span>
                <FormControl
                  className="outlined mb-0 w-40"
                  variant="standard"
                  size="small"
                  disabled={params.row.providerManaged}
                >
                  <Select
                    native
                    value={planDraft[params.row.orgId] ?? ""}
                    onChange={(e) =>
                      setPlanDraft((draft) => ({ ...draft, [params.row.orgId]: e.target.value as string }))
                    }
                    inputProps={{ "aria-label": `Atribuir um plano para ${params.row.orgName}` }}
                  >
                    <option value="">Trocar plano…</option>
                    {plans
                      .filter((plan) => plan.id !== params.row.planId)
                      .map((plan) => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name}
                          {plan.isFree ? " (remove o plano pago)" : ""}
                        </option>
                      ))}
                  </Select>
                </FormControl>
              </span>
            </Tooltip>
            <Button
              size="small"
              disabled={params.row.providerManaged || assigning === params.row.orgId || !planDraft[params.row.orgId]}
              onClick={() => void assignPlan(params.row)}
            >
              {assigning === params.row.orgId ? "Aplicando…" : "Aplicar"}
            </Button>
          </Box>
        ),
      },
      {
        // The kill-switch stays visible on the row, never buried in a menu.
        field: "adminSuspended",
        headerName: "Acesso",
        minWidth: 110,
        type: "boolean",
        renderCell: (params: GridRenderCellParams<SubRow, boolean>) => (
          <Box className="flex h-full items-center">
            <Tooltip title={params.row.adminSuspended ? "Reativar acesso" : "Suspender acesso"}>
              <Switch
                checked={!params.row.adminSuspended}
                onChange={() => toggleSuspended(params.row)}
                size="small"
                slotProps={{
                  input: {
                    "aria-label": `${params.row.adminSuspended ? "Reativar" : "Suspender"} acesso de ${params.row.orgName}`,
                  },
                }}
              />
            </Tooltip>
          </Box>
        ),
      },
    ],
    [assignPlan, assigning, planDraft, plans, toggleSuspended],
  );

  return (
    <Box className="flex flex-col gap-3">
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}

      {notice && (
        <Alert severity="success" className="neutral bg-background-paper/60!" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {/* A failed load is an error, never an empty-looking table. */}
      {!loadFailed && (
        <DataTable<SubRow>
          rows={rows}
          columns={columns}
          loading={!loaded}
          noRowsOverlay={
            <EmptyState
              layout="row"
              illustration={<IllustrationAccounts />}
              title="Nenhuma assinatura em andamento"
              description="Assinaturas em trial, ativas, inadimplentes e incompletas aparecem aqui conforme as contas começam a pagar — com o corte de acesso e o plano cortesia em cada linha."
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhuma assinatura corresponde à sua busca.
            </Typography>
          }
        />
      )}
    </Box>
  );
}
