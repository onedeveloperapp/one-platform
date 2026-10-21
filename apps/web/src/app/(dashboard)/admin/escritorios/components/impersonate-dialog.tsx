"use client";

import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Input,
  Typography,
} from "@mui/material";

import { DEFAULTS } from "@/config";
import { startImpersonation } from "@/lib/impersonation-actions";

/**
 * Confirmation for opening a support session inside a member's account.
 *
 * The dialog exists to make the operator state a reason and to show, before
 * anything happens, exactly what this access is and is not: the member is
 * notified, the visit is logged and time-boxed, and what belongs to the member
 * stays read-only (the database refuses those writes, migration 0012).
 */
export default function ImpersonateDialog({
  userId,
  userName,
  onClose,
}: {
  userId: string;
  userName: string;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = reason.trim().length < 8;

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const result = await startImpersonation(userId, reason);
    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }
    // Full page load so every client picks the parallel session cookie up.
    window.location.href = DEFAULTS.appRoot;
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="impersonate-title">
      <DialogTitle id="impersonate-title">Abrir uma sessão de suporte na conta de {userName}</DialogTitle>
      <DialogContent>
        <Box className="flex flex-col gap-4 pt-1">
          <Typography variant="body1" className="text-text-secondary">
            Você navega no painel exatamente como {userName} vê, sem a senha da conta e sem sair da sua: a sua sessão
            continua ativa e você volta com um clique.
          </Typography>

          <Alert severity="info" className="neutral bg-background-paper/60!">
            <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-4">
              <li>
                O que é da pessoa fica somente leitura: progresso das aulas, votos no roadmap, inscrições em encontros,
                aceites de termos, computadores conectados e a conexão da CLI. O banco recusa essas gravações.
              </li>
              <li>Senha, 2FA, a área /admin e o login da CLI ficam bloqueados nesta sessão.</li>
              <li>A pessoa é avisada na conta, e o acesso aparece no histórico de segurança dela com o seu nome.</li>
              <li>A sessão expira sozinha e fica registrada na trilha de auditoria.</li>
            </Box>
          </Alert>

          <FormControl className="outlined" variant="standard">
            <FormLabel htmlFor="impersonation-reason">Por que você precisa deste acesso?</FormLabel>
            <Input
              id="impersonation-reason"
              placeholder="Ticket 1234: a atualização falha desde ontem"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
              autoFocus
            />
            <Typography variant="body2" className="text-text-secondary mt-1">
              Fica guardado com o acesso e visível para a pessoa. Cite o ticket ou o sintoma relatado.
            </Typography>
          </FormControl>

          {error && (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {error}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={confirm} disabled={busy || tooShort}>
          {busy ? "Abrindo…" : "Entrar na conta"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
