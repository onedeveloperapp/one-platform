"use client";

import { resetUserMfa, setUserBanned } from "../actions";
import DeleteAccountDialog from "./delete-account-dialog";
import ImpersonateDialog from "./impersonate-dialog";
import SuperadminDialog from "./superadmin-dialog";
import { useSnackbar } from "notistack";
import { useCallback, useState } from "react";

import { GridActionsCellItem } from "@mui/x-data-grid";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiCrown from "@/icons/nexture/ni-crown";
import NiEyeOpen from "@/icons/nexture/ni-eye-open";
import NiShield from "@/icons/nexture/ni-shield";
import NiShieldCross from "@/icons/nexture/ni-shield-cross";
import NiUserCheck from "@/icons/nexture/ni-user-check";
import NiUserCross from "@/icons/nexture/ni-user-cross";

/** The person an escalated action acts on, however the row was built. */
export type PersonTarget = {
  userId: string;
  /** The firm the person is in, when they are in one. */
  orgId: string | null;
  name: string;
  email: string | null;
  isSuperadmin: boolean;
  /** Known only where the dossier was read; the list rows do not carry it. */
  hasMfa: boolean;
  banned: boolean;
};

/** One thing the operator may do to a person: what a menu, of a table row or of the dossier, shows. */
export type PersonAction = { key: string; label: string; icon: React.ReactElement; run: () => void };

/** The database and the auth API speak in codes; the console speaks in reasons. */
export const personActionError = (raw: string): string => {
  if (raw === "forbidden") return "Só quem tem o papel de superadmin pode fazer isto.";
  if (raw === "not-configured") {
    return "Defina SUPABASE_SERVICE_ROLE_KEY: esta ação usa a API de administração da autenticação e fica desligada sem ela.";
  }
  if (raw === "reason-required") return "Escreva um motivo com pelo menos 8 caracteres.";
  if (raw === "self-ban") return "Você não pode bloquear a sua própria conta.";
  if (raw === "self-mfa") {
    return "Você não pode redefinir o seu próprio 2FA aqui: perderia o acesso de suporte, que exige segundo fator. Refaça o cadastro em Configurações → Segurança.";
  }
  if (raw === "invalid" || raw === "failed") return "Não foi possível concluir. Recarregue a lista e tente de novo.";
  return raw;
};

/**
 * What each escalated action REALLY does, checked against the code that runs
 * it. These sentences are what the operator will believe and repeat to a
 * firm, so each one states what the action leaves untouched as well.
 */
type ConfirmKind = "ban" | "unban" | "mfa";

const CONFIRM_COPY: Record<
  ConfirmKind,
  {
    title: (name: string) => string;
    intro?: string;
    consequences: string[];
    stays: string[];
    confirm: string;
    tone: "warning" | "danger";
    placeholder: string;
  }
> = {
  ban: {
    title: (name) => `Bloquear o acesso de ${name} à plataforma?`,
    intro: "O bloqueio é na conta de autenticação, então vale para todo o acesso à plataforma.",
    consequences: [
      "Novas tentativas de entrar passam a ser recusadas, sem prazo para acabar.",
      "A tela de entrada não explica o bloqueio: a pessoa vê uma mensagem genérica de erro e não é avisada por nós.",
      "Uma sessão do painel já aberta no navegador não é encerrada por esta ação: não dá para garantir que ela pare na hora.",
      "Enquanto durar o bloqueio, “Entrar como” fica indisponível: para ver a conta por dentro é preciso desbloquear antes.",
    ],
    stays: [
      "Nada é apagado: compras e dados da conta seguem intactos.",
      "A assinatura do escritório continua sendo cobrada: suspender ou cancelar é no console de Faturamento.",
      "É reversível: “Desbloquear na plataforma” devolve o acesso, com senha e 2FA intactos.",
    ],
    confirm: "Bloquear na plataforma",
    tone: "danger",
    placeholder: "Ticket 1234: uso indevido confirmado",
  },
  unban: {
    title: (name) => `Devolver o acesso de ${name} à plataforma?`,
    consequences: ["A pessoa volta a conseguir entrar, com a senha e o 2FA que já tinha."],
    stays: ["Nada além do bloqueio é alterado."],
    confirm: "Desbloquear na plataforma",
    tone: "warning",
    placeholder: "Ticket 1234: bloqueio aplicado por engano",
  },
  mfa: {
    title: (name) => `Redefinir o 2FA de ${name}?`,
    intro: "É o caminho de recuperação de quem perdeu o aparelho e não passa mais da verificação em duas etapas.",
    consequences: [
      "Remove TODOS os fatores de verificação da conta.",
      "A pessoa passa a entrar só com e-mail e senha, e nada a obriga a cadastrar outro aplicativo depois.",
      "Nenhum aviso é enviado: nem e-mail, nem notificação no painel.",
    ],
    stays: [
      "A senha, a sessão e os dados da conta não são tocados.",
      "Um novo autenticador pode ser cadastrado a qualquer momento, em Configurações → Segurança.",
    ],
    confirm: "Redefinir 2FA",
    tone: "danger",
    placeholder: "Ticket 1234: perdeu o celular, identidade confirmada por vídeo",
  },
};

/**
 * The escalated actions on a PERSON, in one place, so every surface that can
 * reach an account (the team in a firm's dossier, the people without a firm)
 * offers the same set with the same guards and the same confirmations.
 */
export function usePersonActions({
  selfId,
  serviceAvailable,
  onChanged,
}: {
  selfId: string | null;
  /** False when SUPABASE_SERVICE_ROLE_KEY is missing: the auth-admin actions
   *  cannot run, so they are not offered. */
  serviceAvailable: boolean;
  onChanged: () => void;
}) {
  const { enqueueSnackbar } = useSnackbar();
  const [confirming, setConfirming] = useState<{ kind: ConfirmKind; target: PersonTarget } | null>(null);
  const [impersonating, setImpersonating] = useState<PersonTarget | null>(null);
  const [roleChange, setRoleChange] = useState<{ target: PersonTarget; grant: boolean } | null>(null);
  const [deleting, setDeleting] = useState<PersonTarget | null>(null);

  const run = useCallback(
    async (kind: ConfirmKind, target: PersonTarget, reason: string): Promise<string | null> => {
      const result =
        kind === "mfa"
          ? await resetUserMfa(target.userId, reason)
          : await setUserBanned(target.userId, kind === "ban", reason);
      if (!result.ok) return personActionError(result.error);
      enqueueSnackbar(
        kind === "mfa"
          ? `2FA de ${target.name} redefinido. A conta entra só com a senha até cadastrar outro aplicativo.`
          : kind === "ban"
            ? `${target.name}: acesso bloqueado na plataforma.`
            : `${target.name}: acesso devolvido.`,
        { variant: "success" },
      );
      onChanged();
      return null;
    },
    [enqueueSnackbar, onChanged],
  );

  /**
   * What may be done to a person, as plain descriptors. The guards are the same
   * ones the server enforces, so no menu offers what will be refused.
   */
  const listActions = useCallback(
    (target: PersonTarget): PersonAction[] => {
      const isSelf = target.userId === selfId;
      const items: PersonAction[] = [];
      if (serviceAvailable && !isSelf && !target.isSuperadmin && !target.banned) {
        items.push({
          key: "impersonate",
          icon: <NiEyeOpen size="medium" />,
          label: "Entrar como",
          run: () => setImpersonating(target),
        });
      }
      // Never on yourself: wiping your own second factor costs you support
      // access (impersonation requires AAL2) and nothing here would say so.
      if (serviceAvailable && target.hasMfa && !isSelf) {
        items.push({
          key: "reset-mfa",
          icon: <NiShieldCross size="medium" />,
          label: "Redefinir 2FA (perdeu o aparelho)",
          run: () => setConfirming({ kind: "mfa", target }),
        });
      }
      // The database refuses a self role change too, in either direction.
      if (!isSelf) {
        items.push({
          key: "superadmin",
          icon: target.isSuperadmin ? <NiShield size="medium" /> : <NiCrown size="medium" />,
          label: target.isSuperadmin ? "Remover superadmin" : "Tornar superadmin",
          run: () => setRoleChange({ target, grant: !target.isSuperadmin }),
        });
      }
      if (serviceAvailable && !isSelf) {
        items.push({
          key: "ban",
          icon: target.banned ? <NiUserCheck size="medium" /> : <NiUserCross size="medium" />,
          label: target.banned ? "Desbloquear na plataforma" : "Bloquear na plataforma",
          run: () => setConfirming({ kind: target.banned ? "unban" : "ban", target }),
        });
      }
      // Irreversible, and service-role backed. A superadmin has to lose the
      // role first: the database refuses otherwise.
      if (serviceAvailable && !isSelf && !target.isSuperadmin) {
        items.push({
          key: "delete",
          icon: <NiBinEmpty size="medium" />,
          label: "Excluir a conta desta pessoa",
          run: () => setDeleting(target),
        });
      }
      return items;
    },
    [selfId, serviceAvailable],
  );

  /** The same actions as the items of a table row's menu. */
  const buildItems = useCallback(
    (target: PersonTarget) =>
      listActions(target).map((item) => (
        <GridActionsCellItem key={item.key} icon={item.icon} label={item.label} onClick={item.run} showInMenu />
      )),
    [listActions],
  );

  // Every dialog is mounted only while open and keyed by the person: kept
  // mounted they changed identity during the exit fade, and the impersonation
  // reason (audited AND shown to the person) survived from one account to the next.
  const dialogs = (
    <>
      {confirming && (
        <ConfirmActionDialog
          key={`${confirming.kind}-${confirming.target.userId}`}
          title={CONFIRM_COPY[confirming.kind].title(confirming.target.name)}
          intro={CONFIRM_COPY[confirming.kind].intro}
          consequences={CONFIRM_COPY[confirming.kind].consequences}
          stays={CONFIRM_COPY[confirming.kind].stays}
          confirmLabel={CONFIRM_COPY[confirming.kind].confirm}
          tone={CONFIRM_COPY[confirming.kind].tone}
          reasonPlaceholder={CONFIRM_COPY[confirming.kind].placeholder}
          onConfirm={(reason) => run(confirming.kind, confirming.target, reason)}
          onClose={() => setConfirming(null)}
        />
      )}

      {impersonating && (
        <ImpersonateDialog
          key={impersonating.userId}
          userId={impersonating.userId}
          userName={impersonating.name}
          onClose={() => setImpersonating(null)}
        />
      )}

      {roleChange && (
        <SuperadminDialog
          key={`${roleChange.target.userId}-${roleChange.grant}`}
          userId={roleChange.target.userId}
          userName={roleChange.target.name}
          grant={roleChange.grant}
          onClose={() => setRoleChange(null)}
          onDone={() => {
            setRoleChange(null);
            onChanged();
          }}
        />
      )}

      {deleting && (
        <DeleteAccountDialog
          key={deleting.userId}
          userId={deleting.userId}
          userName={deleting.name}
          onClose={() => setDeleting(null)}
          onDeleted={() => {
            setDeleting(null);
            onChanged();
          }}
        />
      )}
    </>
  );

  /**
   * Support access and the 2FA reset, exposed on their own so the dossier can
   * offer them as buttons: it is the one place that knows whether the account
   * has a second factor at all.
   */
  const canImpersonate = useCallback(
    (target: PersonTarget) => serviceAvailable && target.userId !== selfId && !target.isSuperadmin && !target.banned,
    [selfId, serviceAvailable],
  );
  const canResetMfa = useCallback(
    (target: PersonTarget) => serviceAvailable && target.hasMfa && target.userId !== selfId,
    [selfId, serviceAvailable],
  );
  const openMfaReset = useCallback((target: PersonTarget) => setConfirming({ kind: "mfa", target }), []);

  return {
    buildItems,
    listActions,
    dialogs,
    canImpersonate,
    openImpersonation: setImpersonating,
    canResetMfa,
    openMfaReset,
  };
}
