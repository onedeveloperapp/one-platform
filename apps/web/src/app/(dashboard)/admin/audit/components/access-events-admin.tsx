"use client";

import { TRAIL_PAGE_SIZES, type TrailPage, trailPageOf, type TrailQuery, useTrailPages } from "./trail-pages";
import { useMemo } from "react";

import { Alert, Box, Button, Chip, Tooltip, Typography } from "@mui/material";
import { type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import IllustrationAccess from "@/icons/illustrations/illustration-access";
import { createClient } from "@flyee/auth/client";

type AccessRow = {
  id: string;
  userName: string | null;
  /** Of a support visit, the operator who opened it: the access is never the person's own sign-in. */
  support: boolean;
  supportName: string | null;
  ip: string | null;
  userAgent: string | null;
  aal: string | null;
  createdAt: string;
};

/** Crude but scannable browser/OS summary out of a raw user-agent string. */
export const describeAgent = (agent: string | null) => {
  if (!agent) return null;
  const browser = /edg\//i.test(agent)
    ? "Edge"
    : /firefox\//i.test(agent)
      ? "Firefox"
      : /chrome\//i.test(agent)
        ? "Chrome"
        : /safari\//i.test(agent)
          ? "Safari"
          : null;
  const os = /windows/i.test(agent)
    ? "Windows"
    : /mac os x|macintosh/i.test(agent)
      ? "macOS"
      : /android/i.test(agent)
        ? "Android"
        : /iphone|ipad|ios/i.test(agent)
          ? "iOS"
          : /linux/i.test(agent)
            ? "Linux"
            : null;
  return [browser, os].filter(Boolean).join(" · ") || agent.slice(0, 40);
};

/** One page of the sign-in trail, searched in the database (0291). */
async function readAccess(query: TrailQuery): Promise<TrailPage<AccessRow> | { error: string }> {
  const { data, error } = await createClient().rpc("admin_access_events", {
    target_search: query.search || null,
    target_limit: query.pageSize,
    target_offset: query.page * query.pageSize,
  });
  if (error) return { error: error.message };
  const answer = trailPageOf(data);
  if (!answer) return { error: "A trilha de acessos veio num formato que este console não lê." };
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    total: answer.total,
    rows: answer.rows.map((row) => ({
      id: String(row.id),
      userName: text(row.user_name),
      support: row.support === true,
      supportName: text(row.support_name),
      ip: text(row.ip),
      userAgent: text(row.user_agent),
      aal: text(row.aal),
      createdAt: text(row.created_at) ?? "",
    })),
  };
}

/**
 * Sign-in trail viewer: who authenticated, from where, with which assurance
 * level. The operator's job is scanning many events to spot the anomalous
 * one (odd IP, unexpected hour, aal1 where 2FA was expected). Read a page at
 * a time and searched in the database, so every access is reachable; a
 * support visit says so, with the operator who opened it.
 */
export default function AccessEventsAdmin() {
  const trail = useTrailPages(readAccess);

  const columns = useMemo<GridColDef<AccessRow>[]>(
    () => [
      {
        field: "createdAt",
        headerName: "Quando",
        flex: 1,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<AccessRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {new Date(params.row.createdAt).toLocaleString()}
            </Typography>
          </Box>
        ),
      },
      {
        field: "userName",
        headerName: "Integrante",
        flex: 1.2,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<AccessRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value ?? "Integrante desconhecido"}
              {params.row.support ? ` · acesso de suporte (${params.row.supportName ?? "operador removido"})` : ""}
            </Typography>
          </Box>
        ),
      },
      {
        field: "ip",
        headerName: "IP",
        flex: 0.8,
        minWidth: 140,
        renderCell: (params: GridRenderCellParams<AccessRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate font-mono">
              {params.value ?? "—"}
            </Typography>
          </Box>
        ),
      },
      {
        // The full user-agent stays the cell VALUE so the quick filter still
        // reaches it (the old plain-text filter searched the raw string); the
        // cell shows the scannable summary, with the raw string in a tooltip.
        field: "userAgent",
        headerName: "Dispositivo",
        flex: 1.2,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<AccessRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Tooltip title={params.value ?? ""}>
              <Typography variant="body2" className="text-text-secondary truncate">
                {describeAgent(params.value ?? null) ?? "—"}
              </Typography>
            </Tooltip>
          </Box>
        ),
      },
      {
        field: "aal",
        headerName: "Autenticação",
        minWidth: 130,
        renderCell: (params: GridRenderCellParams<AccessRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Chip
              label={params.row.aal === "aal2" ? "2FA" : "senha"}
              size="small"
              color={params.row.aal === "aal2" ? "success" : "default"}
              variant="outlined"
            />
          </Box>
        ),
      },
    ],
    [],
  );

  return (
    <Box className="flex flex-col gap-3">
      {trail.error && (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={trail.retry}>
              Tentar de novo
            </Button>
          }
        >
          {trail.error}
        </Alert>
      )}

      {/* A failed first read is an error, never an empty-looking table. */}
      {(trail.loaded || !trail.error) && (
        <DataTable<AccessRow>
          rows={trail.rows}
          columns={columns}
          loading={trail.loading}
          // The trail is the database's, a page at a time: an export here would be of the page alone.
          enableExport={false}
          pageSize={trail.query.pageSize}
          pageSizeOptions={TRAIL_PAGE_SIZES}
          server={trail.server}
          noRowsOverlay={
            trail.query.search ? (
              <Typography variant="body2" className="text-text-secondary">
                Nenhum acesso corresponde à sua busca.
              </Typography>
            ) : (
              <EmptyState
                layout="row"
                illustration={<IllustrationAccess />}
                title="Nenhum acesso registrado ainda"
                description="Toda nova sessão cai aqui automaticamente (trigger em auth.sessions, migração 0016). Se há acessos acontecendo e nada aparece, aplique a migração."
                className="border-none"
              />
            )
          }
        />
      )}
    </Box>
  );
}
