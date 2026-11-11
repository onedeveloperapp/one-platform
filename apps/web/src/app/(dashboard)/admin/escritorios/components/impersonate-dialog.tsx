"use client";

import { useEffect, useState } from "react";

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
import { readSupportAccessFor, requestSupportAccess, type SupportAccessFor } from "@/lib/support-access-actions";

/**
 * Confirmation for opening a support session inside a member's account.
 *
 * The dialog exists to make the operator state a reason and to show, before
 * anything happens, exactly what this access is and is not: the visit opens only
 * under the firm's authorization in force (migration 0203), which the dialog
 * reads first and asks for when there is none; the person is told, the visit is
 * logged and time-boxed, and everything of the firm stays read-only (the
 * database refuses those writes).
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
  const [access, setAccess] = useState<SupportAccessFor | null | undefined>(undefined);
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    void readSupportAccessFor(userId)
      .then(setAccess)
      .catch(() => setAccess(null));
  }, [userId]);
  const blocked = access !== undefined && access !== null && !access.authorized;

  const ask = async () => {
    if (!access?.firm) return;
    setBusy(true);
    setError(null);
    const result = await requestSupportAccess(access.firm, reason);
    setBusy(false);
    if (result.ok) setAsked(true);
    else
      setError(
        result.code === "reason_required"
          ? "Diga o motivo, com o chamado ou o sintoma."
          : "Não foi possível pedir agora.",
      );
  };

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
              <li>Tudo do escritório fica somente leitura: o banco recusa qualquer gravação feita nesta sessão.</li>
              <li>A visita só abre com a autorização em vigor do escritório, que vê cada visita e o motivo.</li>
              <li>Senha, segundo fator e a área /admin ficam bloqueados nesta sessão.</li>
              <li>A pessoa é avisada na conta, e o acesso aparece no histórico de segurança dela com o seu nome.</li>
              <li>A sessão expira sozinha e fica registrada na trilha de auditoria.</li>
            </Box>
          </Alert>

          {access === undefined ? null : access === null ? (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              Não foi possível ler a autorização do escritório agora.
            </Alert>
          ) : access.firm === null ? null : access.authorized ? (
            <Alert severity="success" className="neutral bg-background-paper/60!">
              {`${access.firmName ?? "O escritório"} autorizou o suporte até ${
                access.endsAt
                  ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(
                      new Date(access.endsAt),
                    )
                  : "agora"
              }.`}
            </Alert>
          ) : asked ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              Pedido enviado. Quem administra o escritório foi avisado; a visita abre quando ele autorizar.
            </Alert>
          ) : (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              {`${access.firmName ?? "O escritório"} não autorizou o suporte agora. Escreva o motivo e peça a autorização: quem administra o escritório é avisado e decide.`}
            </Alert>
          )}

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
        {blocked ? (
          <Button variant="contained" onClick={() => void ask()} disabled={busy || tooShort || asked}>
            {busy ? "Pedindo" : "Pedir autorização"}
          </Button>
        ) : (
          <Button variant="contained" onClick={confirm} disabled={busy || tooShort || access === undefined}>
            {busy ? "Abrindo…" : "Entrar na conta"}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
