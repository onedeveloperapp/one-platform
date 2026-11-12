"use client";

import { loadTestFirm, setTestFirm, type TestFirmMark } from "../operation-actions";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Skeleton, TextField, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import { formatDateTime } from "@/lib/admin/format";

const ERROR: Record<string, string> = {
  note_required: "Escreva o motivo, de 8 a 500 caracteres.",
  second_factor: "Confirme o segundo fator nesta sessão antes de marcar.",
  not_authorized: "Só o operador da plataforma marca um escritório de teste.",
  not_found: "Este escritório não foi encontrado.",
};

/**
 * Whether a firm is a test firm (migration 0220), in its dossier: marked, every case of the firm and every trip ONE
 * follows for it are tests, its flights made to happen by its tools and never read at FlightAware, and its link
 * opens those tools and the test court. The operator marks it, or takes the mark away, with a note; what was a test
 * stays a test.
 */
export default function TestFirmSection({ orgId }: { orgId: string }) {
  const [mark, setMark] = useState<TestFirmMark | null | undefined>(undefined);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    void loadTestFirm(orgId)
      .then((read) => live && setMark(read))
      .catch(() => live && setMark(null));
    return () => {
      live = false;
    };
  }, [orgId]);

  const toggle = async (on: boolean) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await setTestFirm(orgId, on, note).catch(() => ({ ok: false, code: "failed" }) as const);
    setBusy(false);
    if (!result.ok) {
      setError(ERROR[result.code] ?? "Não foi possível salvar agora. Tente de novo.");
      return;
    }
    setNote("");
    setMark(result.mark);
  };

  const copy = async () => {
    if (!mark?.url) return;
    try {
      await navigator.clipboard.writeText(mark.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Box component="section" className="flex flex-col gap-3">
      <Box className="flex flex-row flex-wrap items-center gap-2">
        <Typography variant="h6" component="h3" className="mb-0">
          Escritório de teste
        </Typography>
        {mark?.marked ? <StatusChip tone="info" label="Marcado como de teste" /> : null}
      </Box>
      {mark === undefined ? (
        <Skeleton variant="rounded" height={88} />
      ) : mark === null ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          Não foi possível ler se este escritório é de teste agora.
        </Alert>
      ) : (
        <>
          <Typography variant="body2" className="text-text-secondary">
            {mark.marked
              ? `Desde ${mark.since ? formatDateTime(mark.since) : "agora"}. ${mark.note ?? ""}`
              : "Os casos deste escritório e as viagens que o ONE acompanha para ele viram de teste: o voo é simulado pelo link do escritório, nunca lido na FlightAware, e o tribunal de teste responde aos processos. Os avisos saem pelo número real do escritório."}
          </Typography>
          {mark.marked && mark.url ? (
            <Box className="flex flex-row flex-wrap items-center gap-2">
              <Typography variant="body2" className="min-w-0 flex-1 basis-60 break-all">
                {mark.url}
              </Typography>
              <Button variant="outlined" color="grey" size="small" onClick={() => void copy()}>
                {copied ? "Link copiado" : "Copiar o link"}
              </Button>
            </Box>
          ) : null}
          <TextField
            label={mark.marked ? "Por que deixa de ser de teste" : "Por que é um escritório de teste"}
            value={note}
            onChange={(event) => {
              setNote(event.target.value.slice(0, 500));
              setError(null);
            }}
            disabled={busy}
            size="small"
            fullWidth
          />
          <Box className="flex flex-row flex-wrap gap-2">
            <Button
              variant={mark.marked ? "outlined" : "contained"}
              color={mark.marked ? "grey" : "primary"}
              disabled={busy || note.trim().length < 8}
              onClick={() => void toggle(!mark.marked)}
            >
              {busy ? "Salvando" : mark.marked ? "Deixar de ser de teste" : "Marcar como escritório de teste"}
            </Button>
          </Box>
          {error ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {error}
            </Alert>
          ) : null}
        </>
      )}
    </Box>
  );
}
