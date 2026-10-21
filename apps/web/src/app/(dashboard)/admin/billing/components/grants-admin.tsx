"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
} from "@mui/material";
import { type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import NiTicket from "@/icons/nexture/ni-ticket";
import { createClient } from "@flyee/auth/client";

type GrantRow = {
  id: string;
  orgId: string;
  orgName: string;
  kind: string;
  planName: string;
  priceCents: number | null;
  currency: string | null;
  source: string;
  note: string | null;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
};

type OrgOption = { id: string; name: string };
type PlanOption = { id: string; name: string; kind: string; currency: string };

/** Grant kinds and sources (migration 0003) as the operator reads them. */
const KIND_LABEL: Record<string, string> = { kit: "kit", license: "licença", comp: "cortesia" };
const SOURCE_LABEL: Record<string, string> = { purchase: "compra", admin: "operador" };

const dateOf = (value: string | null) => (value ? new Date(value).toLocaleDateString("pt-BR") : "—");
const moneyOf = (cents: number | null, currency: string | null) =>
  cents === null || !currency
    ? "—"
    : new Intl.NumberFormat("pt-BR", { style: "currency", currency, maximumFractionDigits: 2 }).format(cents / 100);

/**
 * The rights that do not come from a subscription (`entitlement_grants`): kits
 * bought with a one-time payment, and the courtesies the operator gives
 * (partners, the team, a replacement after a problem).
 *
 * Granting goes through `grant_entitlement` and revoking through
 * `revoke_entitlement_grant` (migration 0004), which check the superadmin,
 * refuse a support session and write the audit event. Revoking also revokes
 * the workspace's CLI tokens when nothing else still grants catalog access.
 */
export default function GrantsAdmin() {
  const [rows, setRows] = useState<GrantRow[]>([]);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [grantOrg, setGrantOrg] = useState<OrgOption | null>(null);
  const [grantPlan, setGrantPlan] = useState("");
  const [grantNote, setGrantNote] = useState("");
  const [granting, setGranting] = useState(false);

  const [revoking, setRevoking] = useState<GrantRow | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [revokeWorking, setRevokeWorking] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const [grantsResult, orgsResult, plansResult] = await Promise.all([
      supabase
        .from("entitlement_grants")
        .select(
          "id, org_id, kind, price_cents, currency, source, note, created_at, expires_at, revoked_at, revoke_reason, organizations(name), plans(name)",
        )
        .order("created_at", { ascending: false })
        .limit(200),
      supabase.from("organizations").select("id, name").order("name").limit(1000),
      supabase
        .from("plans")
        .select("id, name, kind, currency, is_free, is_addon, sort")
        .eq("is_active", true)
        .eq("is_free", false)
        .eq("is_addon", false)
        .order("sort"),
    ]);
    if (grantsResult.error || orgsResult.error || plansResult.error) {
      setError((grantsResult.error ?? orgsResult.error ?? plansResult.error)?.message ?? "Falha ao carregar.");
      setLoadFailed(true);
      setLoaded(true);
      return;
    }
    setRows(
      (grantsResult.data ?? []).map((row) => ({
        id: row.id,
        orgId: row.org_id,
        orgName: (row.organizations as unknown as { name: string } | null)?.name ?? "Conta desconhecida",
        kind: row.kind,
        planName: (row.plans as unknown as { name: string } | null)?.name ?? "—",
        priceCents: (row.price_cents as number | null) ?? null,
        currency: (row.currency as string | null) ?? null,
        source: row.source,
        note: row.note,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        revokedAt: row.revoked_at,
        revokeReason: row.revoke_reason,
      })),
    );
    setOrgs((orgsResult.data ?? []).map((org) => ({ id: org.id, name: org.name })));
    const planOptions = (plansResult.data ?? []).map((plan) => ({
      id: plan.id,
      name: plan.name,
      kind: plan.kind,
      currency: plan.currency,
    }));
    setPlans(planOptions);
    setGrantPlan((current) => current || (planOptions.find((plan) => plan.kind === "access")?.id ?? ""));
    setLoadFailed(false);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const grant = async () => {
    if (!grantOrg || !grantPlan) {
      setError("Escolha a conta e o plano da cortesia.");
      return;
    }
    setError(null);
    setNotice(null);
    setGranting(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("grant_entitlement", {
      target_org: grantOrg.id,
      target_plan: grantPlan,
      target_note: grantNote.trim() || null,
    });
    setGranting(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    const result = data as { plan?: string; selfGrant?: boolean } | null;
    setNotice(
      `Cortesia concedida a ${grantOrg.name}${result?.selfGrant ? " (sua própria conta — registrado na trilha de auditoria)" : ""}.`,
    );
    setGrantOrg(null);
    setGrantNote("");
    void refresh();
  };

  const revoke = async () => {
    if (!revoking) return;
    const reason = revokeReason.trim();
    if (!reason) {
      setError("Informe o motivo da revogação.");
      return;
    }
    setError(null);
    setRevokeWorking(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("revoke_entitlement_grant", {
      target_grant: revoking.id,
      target_reason: reason,
    });
    if (rpcError) {
      setRevokeWorking(false);
      setError(rpcError.message);
      return;
    }
    setRevokeWorking(false);
    setNotice(`Direito revogado em ${revoking.orgName}.`);
    setRevoking(null);
    setRevokeReason("");
    void refresh();
  };

  const columns = useMemo<GridColDef<GrantRow>[]>(
    () => [
      {
        field: "orgName",
        headerName: "Conta",
        flex: 1.4,
        minWidth: 200,
      },
      {
        field: "kind",
        headerName: "Tipo",
        minWidth: 140,
        valueGetter: (_, row) => `${KIND_LABEL[row.kind] ?? row.kind} · ${row.planName}`,
      },
      {
        field: "priceCents",
        headerName: "Valor",
        minWidth: 130,
        valueGetter: (_, row) => moneyOf(row.priceCents, row.currency),
      },
      {
        field: "source",
        headerName: "Origem",
        minWidth: 160,
        valueGetter: (_, row) => `${SOURCE_LABEL[row.source] ?? row.source} · ${dateOf(row.createdAt)}`,
      },
      {
        field: "revokedAt",
        headerName: "Situação",
        minWidth: 220,
        valueGetter: (_, row) =>
          row.revokedAt
            ? `revogado em ${dateOf(row.revokedAt)}${row.revokeReason ? ` · ${row.revokeReason}` : ""}`
            : row.expiresAt
              ? `ativo até ${dateOf(row.expiresAt)}`
              : "ativo",
        renderCell: (params: GridRenderCellParams<GrantRow, string>) => (
          <Box className="flex h-full flex-row items-center gap-2">
            <Chip
              size="small"
              variant="outlined"
              color={params.row.revokedAt ? "default" : "success"}
              label={params.row.revokedAt ? "revogado" : "ativo"}
            />
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.row.revokedAt ? (params.row.revokeReason ?? "") : (params.row.note ?? "")}
            </Typography>
          </Box>
        ),
      },
      {
        field: "actions",
        headerName: "",
        minWidth: 120,
        sortable: false,
        filterable: false,
        renderCell: (params: GridRenderCellParams<GrantRow>) =>
          params.row.revokedAt ? null : (
            <Button size="small" color="grey" onClick={() => setRevoking(params.row)}>
              Revogar
            </Button>
          ),
      },
    ],
    [],
  );

  return (
    <Box className="flex flex-col gap-4">
      <Box className="flex flex-col gap-1">
        <Typography variant="subtitle1">Kits e cortesias</Typography>
        <Typography variant="body2" className="text-text-secondary">
          Direitos que não vêm de assinatura: o kit comprado em pagamento único e as cortesias que você concede. Um kit
          reembolsado é revogado sozinho pelo webhook do provedor.
        </Typography>
      </Box>

      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {notice && (
        <Alert severity="success" className="neutral bg-background-paper/60!" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Box className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4 md:flex-row md:items-end">
        <Autocomplete
          className="md:min-w-72"
          options={orgs}
          value={grantOrg}
          onChange={(_, value) => setGrantOrg(value)}
          getOptionLabel={(option) => option.name}
          isOptionEqualToValue={(option, value) => option.id === value.id}
          renderInput={(params) => <TextField {...params} label="Conta" size="small" />}
        />
        <FormControl className="outlined md:min-w-56" variant="standard" size="small">
          <FormLabel component="label" htmlFor="grant-plan" id="grant-plan-label">
            Plano da cortesia
          </FormLabel>
          <Select
            id="grant-plan"
            labelId="grant-plan-label"
            value={grantPlan}
            onChange={(event) => setGrantPlan(event.target.value)}
          >
            {plans.map((plan) => (
              <MenuItem key={plan.id} value={plan.id}>
                {plan.name} · {plan.kind === "access" ? "kit" : "plano"} · {plan.currency}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          className="md:flex-1"
          size="small"
          label="Nota (fica na trilha de auditoria)"
          value={grantNote}
          onChange={(event) => setGrantNote(event.target.value)}
        />
        <Button variant="contained" onClick={() => void grant()} disabled={granting || !grantOrg || !grantPlan}>
          {granting ? "Concedendo…" : "Conceder cortesia"}
        </Button>
      </Box>

      {!loadFailed && (
        <DataTable<GrantRow>
          rows={rows}
          columns={columns}
          loading={!loaded}
          noRowsOverlay={
            <EmptyState
              icon={<NiTicket size="medium" />}
              title="Nenhum kit ou cortesia ainda"
              description="Os kits aparecem aqui quando o pagamento único é confirmado; as cortesias, quando você concede uma acima."
              className="border-none"
            />
          }
          noResultsOverlay={
            <Typography variant="body2" className="text-text-secondary">
              Nenhum direito corresponde à sua busca.
            </Typography>
          }
        />
      )}

      <Dialog open={Boolean(revoking)} onClose={() => !revokeWorking && setRevoking(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Revogar este direito?</DialogTitle>
        <DialogContent className="flex flex-col gap-3">
          <Typography variant="body2" className="text-text-secondary">
            {revoking?.orgName} perde o que este {KIND_LABEL[revoking?.kind ?? ""] ?? "direito"} concede. Se nada mais
            garantir acesso ao catálogo, os tokens da CLI também são revogados: as ferramentas instaladas continuam
            funcionando, só as atualizações param.
          </Typography>
          <TextField
            label="Motivo (obrigatório, fica na trilha de auditoria)"
            value={revokeReason}
            onChange={(event) => setRevokeReason(event.target.value)}
            size="small"
            autoFocus
          />
        </DialogContent>
        <DialogActions>
          <Button color="grey" onClick={() => setRevoking(null)} disabled={revokeWorking}>
            Manter
          </Button>
          <Button color="error" variant="contained" onClick={() => void revoke()} disabled={revokeWorking}>
            {revokeWorking ? "Revogando…" : "Revogar"}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
