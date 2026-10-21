"use client";

import { type AccountDeletionResult, deleteAccount, retryAccountStoragePurge } from "../actions";
import { useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormLabel,
  Input,
  Typography,
} from "@mui/material";

import { plural } from "@/lib/admin/format";
import { createClient } from "@flyee/auth/client";

/** `admin_account_deletion_preview` (migration 0013). */
type DeletionPreview = {
  email: string | null;
  /** The firm deleted with the person: the one they alone belong to. */
  firms: { id: string; name: string }[];
  /** The firm the person owns with other people in it: what blocks the deletion. */
  sharedFirms: string[];
  /** The firm that stays, with one person fewer. */
  leavingFirms: string[];
  counts: {
    subscriptions: number;
    invoices: number;
    grants: number;
    invitations: number;
    consents: number;
    registrations: number;
    comments: number;
    files: number;
  };
  providerSubscriptions: { id: string; provider: string; status: string }[];
  blockers: string[];
};

const BLOCKERS: Record<string, string> = {
  self: "Esta é a sua própria conta. Outra pessoa com o papel de superadmin precisa excluí-la.",
  superadmin:
    "Esta conta tem o papel de superadmin da plataforma. Remova o papel primeiro (mesmo menu), depois exclua a conta.",
  shared_firm:
    "Esta pessoa é titular de um escritório do qual outras pessoas fazem parte. A titularidade precisa passar para alguém da equipe, ou as outras pessoas saírem, antes da exclusão.",
};

function actionError(error: string): string {
  if (error === "forbidden") return "Só quem tem o papel de superadmin pode excluir contas.";
  if (error === "not-configured") {
    return "Defina SUPABASE_SERVICE_ROLE_KEY: os arquivos guardados só podem ser removidos com a service role, então a exclusão fica desligada sem ela.";
  }
  return error;
}

/**
 * Permanent deletion of an account and what it holds (migration 0013): the
 * person, and the firm they alone belong to. A person who is one of several in
 * a firm is removed and the firm stays.
 *
 * The dialog's job is to make the operator SEE the size of what goes before
 * the click, and to carry the friction the database also enforces: a stated
 * reason and the account's e-mail typed back. It is mounted only while open
 * (keyed by user), so each account starts from a fresh preview.
 */
export default function DeleteAccountDialog({
  userId,
  userName,
  onClose,
  onDeleted,
}: {
  userId: string;
  userName: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AccountDeletionResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data, error: rpcError } = await createClient().rpc("admin_account_deletion_preview", {
        target_user: userId,
      });
      if (cancelled) return;
      if (rpcError) setLoadError(rpcError.message);
      else setPreview(data as DeletionPreview);
    };
    load();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const expected = (preview?.email ?? userId).toLowerCase();
  const confirmed = typed.trim().toLowerCase() === expected;
  const reasonOk = reason.trim().length >= 8;
  const blockers = preview?.blockers ?? [];
  const canConfirm = Boolean(preview) && blockers.length === 0 && !result;

  // Files the purge could not remove (or could not verify) are the one state
  // this dialog must not let go of: `retryAccountStoragePurge` needs
  // `result.deletedFirms`, which exists only in this component's state.
  // Once it closes, the only trace left is the audit trail.
  const storagePending = Boolean(result) && result!.storage.remaining !== 0;

  const close = () => {
    if (busy || storagePending) return;
    if (result) onDeleted();
    else onClose();
  };

  const confirm = async () => {
    setBusy(true);
    setError(null);
    const outcome = await deleteAccount(userId, typed, reason);
    setBusy(false);
    if (!outcome.ok) {
      setError(actionError(outcome.error));
      return;
    }
    setResult(outcome.data);
  };

  const retry = async () => {
    if (!result) return;
    setBusy(true);
    setError(null);
    const outcome = await retryAccountStoragePurge(userId, result.deletedFirms);
    setBusy(false);
    if (!outcome.ok) {
      setError(actionError(outcome.error));
      return;
    }
    setResult({ ...result, storage: outcome.data });
  };

  return (
    // `open` is controlled and `close` refuses while files are stranded, so the
    // backdrop and Escape are already inert.
    <Dialog open onClose={close} maxWidth="sm" fullWidth aria-labelledby="delete-account-title">
      <DialogTitle id="delete-account-title">
        {result ? "Conta excluída" : `Excluir a conta de ${userName}?`}
      </DialogTitle>
      <DialogContent>
        {result ? (
          <DeletionOutcome userName={userName} result={result} error={error} />
        ) : loadError ? (
          // A failed count is an error, never an empty-looking account.
          <Alert severity="error" className="neutral bg-background-paper/60!">
            Não foi possível carregar o que esta exclusão removeria: {loadError}
          </Alert>
        ) : !preview ? (
          <Box className="flex min-h-40 items-center gap-3">
            <CircularProgress size={20} aria-label="Carregando" />
            <Typography variant="body1" className="text-text-secondary">
              Contando tudo o que esta conta guarda…
            </Typography>
          </Box>
        ) : blockers.length > 0 ? (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-4">
              {blockers.map((blocker) => (
                <li key={blocker}>
                  {BLOCKERS[blocker] ?? blocker}
                  {blocker === "shared_firm" && preview.sharedFirms.length > 0
                    ? ` (${preview.sharedFirms.join(", ")})`
                    : null}
                </li>
              ))}
            </Box>
          </Alert>
        ) : (
          <Box className="flex flex-col gap-4 pt-1">
            <Typography variant="body1" className="text-text-secondary">
              Tudo abaixo é removido para sempre. Não existe lixeira, restauração nem desfazer em lugar nenhum da
              plataforma.
            </Typography>

            <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-5">
              <li>
                <Typography variant="body1">
                  {preview.firms.length > 0
                    ? `O escritório ${preview.firms.map((firm) => firm.name).join(", ")}, do qual só esta pessoa faz parte, com tudo o que ele guarda`
                    : preview.leavingFirms.length > 0
                      ? `A participação em ${preview.leavingFirms.join(", ")}: o escritório continua, com uma pessoa a menos`
                      : "Nenhum escritório: esta conta não faz parte de um"}
                </Typography>
              </li>
              {preview.firms.length > 0 ? (
                <li>
                  <Typography variant="body1">
                    Do escritório: {plural(preview.counts.subscriptions, "assinatura", "assinaturas")},{" "}
                    {plural(preview.counts.invoices, "fatura", "faturas")},{" "}
                    {plural(preview.counts.grants, "acesso ou cortesia", "acessos e cortesias")} e{" "}
                    {plural(preview.counts.invitations, "convite", "convites")}
                  </Typography>
                </li>
              ) : null}
              <li>
                <Typography variant="body1">
                  {plural(preview.counts.registrations, "inscrição na OAB informada", "inscrições na OAB informadas")},{" "}
                  {plural(preview.counts.consents, "aceite de termos", "aceites de termos")} e{" "}
                  {plural(preview.counts.comments, "comentário no blog", "comentários no blog")}
                </Typography>
              </li>
              <li>
                <Typography variant="body1">
                  {plural(preview.counts.files, "arquivo guardado", "arquivos guardados")} (a foto do perfil)
                </Typography>
              </li>
              <li>
                <Typography variant="body1">O login, o perfil, as notificações e o histórico de acessos</Typography>
              </li>
            </Box>

            {preview.providerSubscriptions.length > 0 && (
              <Alert severity="info" className="neutral bg-background-paper/60!">
                {plural(preview.providerSubscriptions.length, "assinatura", "assinaturas")} ainda cobrando em{" "}
                {[...new Set(preview.providerSubscriptions.map((subscription) => subscription.provider))].join(" e ")}{" "}
                será cancelada no provedor primeiro. Se isso falhar, nada é excluído.
              </Alert>
            )}

            <Alert severity="warning" className="neutral bg-background-paper/60!">
              <Box component="ul" className="m-0 flex list-disc flex-col gap-1 pl-4">
                <li>
                  As cobranças e as notas fiscais ficam registradas no provedor de pagamento (Asaas ou Stripe): excluir
                  a conta aqui não apaga a obrigação fiscal de lá.
                </li>
                <li>Os backups automáticos guardam uma cópia até serem descartados (30 dias por padrão).</li>
              </Box>
            </Alert>

            <FormControl className="outlined" variant="standard">
              <FormLabel htmlFor="delete-account-reason">Por que esta conta está sendo excluída?</FormLabel>
              <Input
                id="delete-account-reason"
                placeholder="Pedido da pessoa por e-mail, ticket 1234"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={busy}
                autoFocus
              />
              <Typography variant="body2" className="text-text-secondary mt-1">
                Fica na trilha de auditoria com o seu nome, junto com quanto foi excluído.
              </Typography>
            </FormControl>

            <FormControl className="outlined" variant="standard">
              <FormLabel htmlFor="delete-account-confirm">
                Digite <strong>{expected}</strong> para confirmar
              </FormLabel>
              <Input
                id="delete-account-confirm"
                autoComplete="off"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                disabled={busy}
              />
            </FormControl>

            {error && (
              <Alert severity="error" className="neutral bg-background-paper/60!">
                {error}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {result ? (
          storagePending ? (
            // Retry is the primary action while files are stranded; leaving is
            // still possible, but it has to be chosen, not stumbled into.
            <>
              <Button variant="text" color="grey" onClick={onDeleted} disabled={busy}>
                Fechar mesmo assim
              </Button>
              <Button variant="contained" onClick={retry} disabled={busy}>
                {busy ? "Tentando…" : "Tentar de novo a limpeza dos arquivos"}
              </Button>
            </>
          ) : (
            <Button variant="contained" onClick={onDeleted} disabled={busy}>
              Pronto
            </Button>
          )
        ) : (
          <>
            <Button variant="text" color="grey" onClick={close} disabled={busy}>
              {canConfirm ? "Cancelar" : "Fechar"}
            </Button>
            {canConfirm && (
              <Button variant="contained" color="error" onClick={confirm} disabled={busy || !reasonOk || !confirmed}>
                {busy ? "Excluindo…" : "Excluir para sempre"}
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}

function DeletionOutcome({
  userName,
  result,
  error,
}: {
  userName: string;
  result: AccountDeletionResult;
  error: string | null;
}) {
  const { storage, counts } = result;
  return (
    <Box className="flex flex-col gap-3 pt-1">
      <Alert severity="success" className="neutral bg-background-paper/60!">
        A conta de {userName} foi excluída
        {result.deletedFirms.length > 0
          ? `, com ${plural(result.deletedFirms.length, "escritório", "escritórios")} do qual só ela fazia parte e ${plural(counts.grants ?? 0, "acesso ou cortesia", "acessos e cortesias")}.`
          : ". Nenhum escritório foi excluído."}
        {result.canceledSubscriptions > 0
          ? ` ${plural(result.canceledSubscriptions, "assinatura cancelada no provedor", "assinaturas canceladas no provedor")}.`
          : ""}
      </Alert>
      {storage.remaining === 0 ? (
        <Typography variant="body1" className="text-text-secondary">
          {storage.removed === 0
            ? "Não havia arquivos guardados para remover."
            : `${plural(storage.removed, "arquivo guardado foi removido", "arquivos guardados foram removidos")}.`}
        </Typography>
      ) : storage.remaining > 0 ? (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          {plural(
            storage.remaining,
            "arquivo guardado ainda não pôde ser removido",
            "arquivos guardados ainda não puderam ser removidos",
          )}
          . Eles não pertencem mais a nenhuma conta: tente de novo agora. O id do escritório excluído também fica na
          trilha de auditoria.
        </Alert>
      ) : (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          Não foi possível verificar a limpeza dos arquivos{storage.error ? `: ${storage.error}` : ""}. Tente de novo
          agora.
        </Alert>
      )}
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}
    </Box>
  );
}
