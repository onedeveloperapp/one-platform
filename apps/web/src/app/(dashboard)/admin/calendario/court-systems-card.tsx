"use client";

import { answerCourtSystem } from "./court-system-actions";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, MenuItem, TextField, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import type { CourtSystemRefusal } from "@/lib/admin/court-systems";

const SYSTEMS = ["projudi", "eproc", "pje", "esaj", "outro"] as const;
const SYSTEM_LABEL: Record<string, string> = {
  projudi: "Projudi",
  eproc: "eproc",
  pje: "PJe",
  esaj: "e-SAJ",
  outro: "Outro",
};
const KIND_LABEL: Record<CourtSystemRefusal["kind"], string> = { juizado: "Juizado especial", comum: "Vara cível" };
const CODE_TEXT: Record<string, string> = {
  forbidden: "Esta sessão não pode mudar os sistemas dos tribunais.",
  invalid_value: "Algum valor não foi aceito.",
  source_required: "Diga onde o sistema foi conferido (o ato do tribunal), com pelo menos 8 letras.",
  court_not_found: "Tribunal não encontrado.",
};
const when = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("pt-BR", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        timeZone: "America/Sao_Paulo",
      }).format(new Date(iso))
    : null;

/**
 * The court systems the firms did not approve (migration 0066): ONE names a lawsuit's system from the platform's
 * table, and a firm that knows better says why it does not approve it. The operator comes here to check each court's
 * acts and answer: confirm the system of the row, or change it. Either way the planned lawsuits of that court and
 * kind take the row again: an approval of the same system stays, and a firm that did not approve is asked again.
 * Success is this list empty. Counts and the reasons the firms wrote, never which firm or whose case.
 */
export default function CourtSystemsCard({ refusals }: { refusals: CourtSystemRefusal[] | null }) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [system, setSystem] = useState<string>("pje");
  const [source, setSource] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const keyOf = (row: CourtSystemRefusal) => `${row.court}/${row.kind}`;
  const answer = async (row: CourtSystemRefusal, chosen: string) => {
    setBusy(true);
    setNotice(null);
    const result = await answerCourtSystem({ court: row.court, kind: row.kind, system: chosen, source });
    setBusy(false);
    if (!result.ok) {
      setNotice({ tone: "error", text: CODE_TEXT[result.code] ?? "Não foi possível salvar agora." });
      return;
    }
    setNotice({
      tone: "success",
      text:
        chosen === row.system
          ? `${row.court}: ${SYSTEM_LABEL[chosen] ?? chosen} confirmado. Os escritórios são chamados a aprovar de novo.`
          : `${row.court}: o sistema agora é ${SYSTEM_LABEL[chosen] ?? chosen}. Os escritórios são chamados a aprovar de novo.`,
    });
    setOpen(null);
    setSource("");
    router.refresh();
  };

  return (
    <Card component="section" aria-labelledby="calendar-court-systems" className="mt-6">
      <CardContent className="flex flex-col gap-3">
        <Typography id="calendar-court-systems" variant="h5" component="h2" className="mb-0">
          Sistemas dos tribunais que os escritórios não aprovaram
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          O ONE define o sistema de cada ação pela tabela da plataforma, e o escritório aprova ou não. Confira no ato do
          tribunal e confirme o sistema ou troque. As ações planejadas daquele tribunal e tipo recebem a resposta, e o
          escritório é chamado a aprovar de novo.
        </Typography>
        {notice ? (
          <Alert
            severity={notice.tone}
            role="status"
            className="neutral bg-background-paper/60!"
            onClose={() => setNotice(null)}
          >
            {notice.text}
          </Alert>
        ) : null}
        {refusals === null ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            Não foi possível ler os sistemas não aprovados agora.
          </Alert>
        ) : refusals.length === 0 ? (
          <Typography variant="body2" className="text-text-secondary">
            Nenhum escritório deixou de aprovar um sistema.
          </Typography>
        ) : (
          <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
            {refusals.map((row) => (
              <Box component="li" key={keyOf(row)} className="border-grey-100 flex flex-col gap-2 border-b pb-3">
                <Box className="flex flex-wrap items-center gap-2">
                  <Typography variant="body2" className="min-w-0 flex-1 font-semibold">
                    {row.court} · {KIND_LABEL[row.kind]} · {SYSTEM_LABEL[row.system] ?? row.system}
                  </Typography>
                  <StatusChip
                    tone={row.confirmed ? "positive" : "attention"}
                    label={row.confirmed ? "Conferido" : "Não conferido"}
                  />
                </Box>
                <Typography variant="body2" className="text-text-secondary">
                  {row.refused} {row.refused === 1 ? "ação não aprovou" : "ações não aprovaram"} · {row.waiting}{" "}
                  {row.waiting === 1 ? "espera aprovação" : "esperam aprovação"}
                  {when(row.lastRefusedAt) ? ` · última em ${when(row.lastRefusedAt)}` : ""}
                </Typography>
                {row.reasons.length > 0 ? (
                  <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
                    {row.reasons.map((reason, index) => (
                      <Typography component="li" variant="body2" key={index}>
                        {reason}
                      </Typography>
                    ))}
                  </Box>
                ) : null}
                {open === keyOf(row) ? (
                  <Box className="flex flex-col gap-3 sm:max-w-xl">
                    <TextField
                      select
                      size="small"
                      id={`court-system-${keyOf(row)}`}
                      label="Sistema do tribunal"
                      value={system}
                      disabled={busy}
                      onChange={(event) => setSystem(event.target.value)}
                    >
                      {SYSTEMS.map((value) => (
                        <MenuItem key={value} value={value}>
                          {SYSTEM_LABEL[value]}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      size="small"
                      id={`court-system-source-${keyOf(row)}`}
                      label="Onde foi conferido"
                      helperText="O ato do tribunal, com o endereço, como a tabela guarda."
                      value={source}
                      disabled={busy}
                      onChange={(event) => setSource(event.target.value)}
                    />
                    <Box className="flex flex-wrap gap-2">
                      <Button variant="contained" size="small" disabled={busy} onClick={() => void answer(row, system)}>
                        {busy ? "Salvando" : system === row.system ? "Confirmar este sistema" : "Trocar o sistema"}
                      </Button>
                      <Button variant="text" color="grey" size="small" disabled={busy} onClick={() => setOpen(null)}>
                        Cancelar
                      </Button>
                    </Box>
                  </Box>
                ) : (
                  <Box>
                    <Button
                      variant="outlined"
                      color="grey"
                      size="small"
                      onClick={() => {
                        setOpen(keyOf(row));
                        setSystem(row.system);
                        setSource("");
                        setNotice(null);
                      }}
                    >
                      Responder
                    </Button>
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
    </Card>
  );
}
