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

import { createClient } from "@flyee/auth/client";

/**
 * Confirmation for granting or removing the platform superadmin role.
 *
 * The write is the `set_user_superadmin` function (migration 0001), called with
 * the operator's own session: the gate lives in the database, so this needs no
 * service role. The dialog's job is to spell out, before the click, what the
 * role actually opens, because "superadmin" reads like a settings toggle and
 * is nothing of the sort.
 */
export default function SuperadminDialog({
  userId,
  userName,
  grant,
  onClose,
  onDone,
}: {
  userId: string;
  userName: string;
  /** true = grant the role, false = remove it. */
  grant: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("set_user_superadmin", {
      target_user: userId,
      value: grant,
      target_note: note.trim() || null,
    });
    setBusy(false);
    if (rpcError) {
      setError(messageFor(rpcError.message));
      return;
    }
    onDone();
  };

  const close = () => {
    if (!busy) onClose();
  };

  return (
    <Dialog open onClose={close} maxWidth="sm" fullWidth aria-labelledby="superadmin-title">
      <DialogTitle id="superadmin-title">
        {grant ? `Dar a ${userName} o papel de superadmin?` : `Remover o papel de superadmin de ${userName}?`}
      </DialogTitle>
      <DialogContent>
        <Box className="flex flex-col gap-4 pt-1">
          {grant ? (
            <>
              <Typography variant="body1" className="text-text-secondary">
                Este é o maior privilégio da plataforma, e ele vale para todas as contas.
              </Typography>

              <Alert severity="warning" className="neutral bg-background-paper/60!">
                <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-4">
                  <li>
                    Lê os dados de <strong>todas</strong> as contas: pessoas, compras, computadores conectados e uso.
                  </li>
                  <li>Abre sessões de suporte dentro de qualquer conta.</li>
                  <li>Suspende e bloqueia contas, redefine o 2FA, dá cortesias e exclui contas.</li>
                  <li>Publica e retira ferramentas do catálogo.</li>
                  <li>Concede este mesmo papel a outras pessoas.</li>
                </Box>
              </Alert>

              <Typography variant="body1" className="text-text-secondary">
                Conceda a quem opera a plataforma, nunca como facilidade para um integrante.
              </Typography>
            </>
          ) : (
            <Typography variant="body1" className="text-text-secondary">
              {userName} perde a área /admin e todo privilégio sobre outras contas na próxima requisição. A conta e os
              dados continuam intactos.
            </Typography>
          )}

          <FormControl className="outlined" variant="standard">
            <FormLabel htmlFor="superadmin-note">Nota para a trilha de auditoria (opcional)</FormLabel>
            <Input
              id="superadmin-note"
              placeholder={grant ? "Segunda pessoa na operação durante o lançamento" : "Saiu do time"}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={busy}
              autoFocus
            />
            <Typography variant="body2" className="text-text-secondary mt-1">
              Quem concedeu o papel a quem fica registrado de qualquer jeito. A nota é o único lugar onde o motivo
              sobrevive.
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
        <Button variant="text" color="grey" onClick={close} disabled={busy}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={confirm} disabled={busy}>
          {busy ? "Salvando…" : grant ? "Conceder superadmin" : "Remover superadmin"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** The database speaks in error codes; the console has to speak in reasons. */
function messageFor(raw: string): string {
  if (raw.includes("self_change_forbidden")) {
    return "Você não pode mudar o seu próprio papel. Peça a outra pessoa com o papel de superadmin: remover o seu poderia deixar a plataforma sem ninguém para operá-la.";
  }
  if (raw.includes("not_authorized")) {
    return "Só quem tem o papel de superadmin pode mudá-lo, e nunca de dentro de uma sessão de suporte.";
  }
  if (raw.includes("user_not_found")) return "Esta conta não existe mais. Recarregue a lista.";
  if (raw.includes("superadmin_not_self_assignable")) {
    return "O banco recusou a mudança: este papel não pode ser atribuído à própria conta.";
  }
  return raw;
}
