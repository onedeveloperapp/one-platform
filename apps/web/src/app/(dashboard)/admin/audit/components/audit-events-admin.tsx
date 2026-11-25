"use client";

import { TRAIL_PAGE_SIZES, type TrailPage, trailPageOf, type TrailQuery, useTrailPages } from "./trail-pages";
import { useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Tooltip,
  Typography,
} from "@mui/material";
import { GridActionsCellItem, type GridColDef, type GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import IllustrationDocumentation from "@/icons/illustrations/illustration-documentation";
import NiBraces from "@/icons/nexture/ni-braces";
import { createClient } from "@flyee/auth/client";

type AuditRow = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  metadata: Record<string, unknown>;
  actorName: string | null;
  orgName: string | null;
  createdAt: string;
};

const entityOf = (row: AuditRow) =>
  row.entityType ? `${row.entityType}${row.entityId ? ` · ${row.entityId}` : ""}` : "";

/** One page of the audit trail, searched in the database (0291). */
async function readAudit(query: TrailQuery): Promise<TrailPage<AuditRow> | { error: string }> {
  const { data, error } = await createClient().rpc("admin_audit_events", {
    target_search: query.search || null,
    target_limit: query.pageSize,
    target_offset: query.page * query.pageSize,
  });
  if (error) return { error: error.message };
  const answer = trailPageOf(data);
  if (!answer) return { error: "A trilha de auditoria veio num formato que este console não lê." };
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  return {
    total: answer.total,
    rows: answer.rows.map((row) => ({
      id: String(row.id),
      action: text(row.action) ?? "",
      entityType: text(row.entity_type),
      entityId: text(row.entity_id),
      metadata:
        typeof row.metadata === "object" && row.metadata !== null ? (row.metadata as Record<string, unknown>) : {},
      actorName: text(row.actor_name),
      orgName: text(row.org_name),
      createdAt: text(row.created_at) ?? "",
    })),
  };
}

/**
 * Compliance viewer over the append-only audit trail (packages/audit).
 * The job is scan/inspect many events: filter, find the one that matters,
 * open its metadata. The trail is read a page at a time and searched in the
 * database: every event is reachable, the oldest too.
 */
export default function AuditEventsAdmin() {
  const trail = useTrailPages(readAudit);
  const [detail, setDetail] = useState<AuditRow | null>(null);

  const columns = useMemo<GridColDef<AuditRow>[]>(
    () => [
      {
        field: "createdAt",
        headerName: "Quando",
        flex: 1,
        minWidth: 180,
        renderCell: (params: GridRenderCellParams<AuditRow, string>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="text-text-primary truncate font-medium">
              {new Date(params.row.createdAt).toLocaleString()}
            </Typography>
          </Box>
        ),
      },
      {
        field: "action",
        headerName: "Ação",
        flex: 1,
        minWidth: 200,
        renderCell: (params: GridRenderCellParams<AuditRow, string>) => (
          <Box className="flex h-full items-center">
            {/* No colour: the value is constant down the whole column, so a
                colour would distinguish nothing — and primary is the system's
                action colour, which would make a non-clickable pill read as a
                button. */}
            <Chip label={params.row.action} size="small" variant="outlined" />
          </Box>
        ),
      },
      {
        field: "entity",
        headerName: "Entidade",
        flex: 1.5,
        minWidth: 220,
        // The searched text must be reachable as the cell value, not only in
        // the rendered node.
        valueGetter: (_, row) => entityOf(row),
        renderCell: (params: GridRenderCellParams<AuditRow, string>) => (
          <Box className="flex h-full items-center">
            <Tooltip title={params.value || ""}>
              <Typography variant="body2" className="text-text-secondary truncate font-mono">
                {params.value || "—"}
              </Typography>
            </Tooltip>
          </Box>
        ),
      },
      {
        field: "actorName",
        headerName: "Autor",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<AuditRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value ?? "—"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "orgName",
        headerName: "Conta",
        flex: 1,
        minWidth: 160,
        renderCell: (params: GridRenderCellParams<AuditRow, string | null>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.value ?? "—"}
            </Typography>
          </Box>
        ),
      },
      {
        field: "actions",
        headerName: "",
        type: "actions",
        minWidth: 70,
        align: "right",
        headerAlign: "right",
        getActions: (params) => [
          <GridActionsCellItem
            key="metadata"
            icon={<NiBraces size="medium" />}
            label="Ver metadados"
            onClick={() => setDetail(params.row)}
            showInMenu
          />,
        ],
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
        <DataTable<AuditRow>
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
                Nenhum evento corresponde à sua busca.
              </Typography>
            ) : (
              <EmptyState
                layout="row"
                illustration={<IllustrationDocumentation />}
                title="Nenhum evento de auditoria ainda"
                description="Eventos registrados por logAuditEvent (packages/audit) aparecem aqui — a trilha é append-only, então nada pode ser editado ou excluído."
                className="border-none"
              />
            )
          }
        />
      )}

      <Dialog open={Boolean(detail)} onClose={() => setDetail(null)} maxWidth="sm" fullWidth>
        <DialogTitle>{detail?.action ?? "Metadados do evento"}</DialogTitle>
        <DialogContent>
          <Box className="flex flex-col gap-3 pt-1">
            <Typography variant="body2" className="text-text-secondary">
              {detail
                ? [entityOf(detail), detail.actorName, detail.orgName, new Date(detail.createdAt).toLocaleString()]
                    .filter(Boolean)
                    .join(" · ")
                : ""}
            </Typography>
            <Box className="bg-background-default/50 overflow-x-auto rounded-lg p-3">
              <Typography component="pre" variant="body2" className="font-mono whitespace-pre-wrap">
                {detail && Object.keys(detail.metadata).length > 0
                  ? JSON.stringify(detail.metadata, null, 2)
                  : "Nenhum metadado foi registrado neste evento."}
              </Typography>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={() => setDetail(null)}>
            Fechar
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
