"use client";

import { lacksSecondFactor, type TeamView } from "../team-list";
import { type TeamData, teamErrorKey, type TeamInvitation, type TeamPerson } from "../team-types";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useSnackbar } from "notistack";
import { type ReactNode, useState } from "react";

import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
} from "@mui/material";

import CardTitle from "@/components/product/card-title";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import QuickActions, { type QuickAction } from "@/components/product/quick-actions";
import SidePanel from "@/components/product/side-panel";
import StatusChip from "@/components/product/status-chip";
import UsageMeter from "@/components/product/usage-meter";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiCrown from "@/icons/nexture/ni-crown";
import NiEmail from "@/icons/nexture/ni-email";
import NiKey from "@/icons/nexture/ni-key";
import NiSendUpRight from "@/icons/nexture/ni-send-up-right";
import NiShieldCross from "@/icons/nexture/ni-shield-cross";
import NiSwap from "@/icons/nexture/ni-swap";
import NiUserMinus from "@/icons/nexture/ni-user-minus";
import NiUsers from "@/icons/nexture/ni-users";
import {
  inviteToFirm,
  removeMember,
  revokeInvitation,
  setMemberFunction,
  setMemberRole,
  transferOwnership,
} from "@/lib/firm/actions";
import {
  FIRM_FUNCTIONS,
  type FirmFunction,
  formatOab,
  FUNCTION_HINT_KEY,
  FUNCTION_LABEL_KEY,
  ROLE_LABEL_KEY,
} from "@/lib/firm/roles";

type Pending =
  | { kind: "function"; person: TeamPerson }
  | { kind: "promote"; person: TeamPerson }
  | { kind: "demote"; person: TeamPerson }
  | { kind: "remove"; person: TeamPerson }
  | { kind: "transfer"; person: TeamPerson };

/**
 * What the person looking may do to a colleague. It mirrors the rules of
 * migration 0003 so the menu only offers what the database accepts; the
 * database stays the one that decides.
 */
function actionsFor(me: TeamData["me"], person: TeamPerson): Pending["kind"][] {
  const self = person.userId === me.userId;
  if (me.role === "owner") {
    if (self) return ["function"];
    return ["function", person.role === "admin" ? "demote" : "promote", "transfer", "remove"];
  }
  if (me.role === "admin") {
    if (self) return ["function"];
    return person.role === "member" ? ["function", "remove"] : [];
  }
  return [];
}

/** The words and the icon of each action in the menu of a person. */
const ACTION: Record<Pending["kind"], { key: string; icon: ReactNode }> = {
  function: { key: "team-action-function", icon: <NiSwap size="medium" /> },
  promote: { key: "team-action-promote", icon: <NiKey size="medium" /> },
  demote: { key: "team-action-demote", icon: <NiShieldCross size="medium" /> },
  transfer: { key: "team-action-transfer", icon: <NiCrown size="medium" /> },
  remove: { key: "team-action-remove", icon: <NiUserMinus size="medium" /> },
};

/** What each view's card says of what it holds. */
const VIEW_BODY: Partial<Record<TeamView, string>> = {
  "sem-fator": "team-view-sem-fator-body",
  convites: "team-invitations-body",
};

const initialOf = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

/** "em 3 dias", "amanhã", "hoje": how long an invitation still has. */
function daysLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000));
}

/**
 * The roster in the view the bar chose: who is in the firm and what each one does, each person one line with what
 * a manager may change one click away (their function in the side panel, the rest confirmed with what it does and
 * what stays); or the invitations nobody answered yet, with sending again and taking back. It is a handful of people,
 * so it reads as a roster, never as a table.
 */
export default function TeamRoster({
  data,
  view,
  title,
  people,
  invitations,
  narrowed,
  onChanged,
  onInvite,
  onClearSearch,
}: {
  data: TeamData;
  view: TeamView;
  title: string;
  people: TeamPerson[];
  invitations: TeamInvitation[];
  /** A search narrows the view: an empty view then says so, with the way to clear it. */
  narrowed: boolean;
  onChanged: () => void;
  onInvite: () => void;
  onClearSearch: () => void;
}) {
  const t = useTranslations("product");
  const { enqueueSnackbar } = useSnackbar();
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // Read once per render pass: the label is "days left", not a clock.
  const [now] = useState(() => Date.now());

  const manager = data.me.role !== "member";
  const used = data.people.length;
  const reserved = data.invitations.length;
  const alone = used === 1 && reserved === 0;
  const showsInvitations = view === "convites";
  const empty = showsInvitations ? invitations.length === 0 : people.length === 0;
  const emptyKey = view === "sem-fator" ? "team-view-sem-fator-empty" : "team-view-empty";
  const body = VIEW_BODY[view] ?? (manager ? "team-people-body-manager" : "team-people-body");

  /** Runs a confirmed change and returns the message of its failure, if any. */
  const run = async (action: () => Promise<{ ok: boolean; code: string }>): Promise<string | null> => {
    const result = await action();
    if (!result.ok) return t(teamErrorKey(result.code));
    onChanged();
    return null;
  };

  const revoke = async (invitation: TeamInvitation) => {
    setBusy(invitation.id);
    const result = await revokeInvitation(invitation.id);
    setBusy(null);
    if (!result.ok) {
      enqueueSnackbar(t(teamErrorKey(result.code)), { variant: "error" });
      return;
    }
    enqueueSnackbar(t("team-invitation-revoked", { email: invitation.email }), { variant: "success" });
    onChanged();
  };

  /** Inviting the same address again replaces the link: the new one is the one that works. */
  const resend = async (invitation: TeamInvitation) => {
    setBusy(invitation.id);
    const result = await inviteToFirm({
      email: invitation.email,
      role: invitation.role,
      firmFunction: invitation.firmFunction,
    });
    setBusy(null);
    if (!result.ok) {
      enqueueSnackbar(t(teamErrorKey(result.code)), { variant: "error" });
      return;
    }
    if (result.emailed) {
      enqueueSnackbar(t("team-invite-emailed", { email: invitation.email }), { variant: "success" });
    } else {
      // The e-mail could not leave: the new link goes to the clipboard, so the
      // manager sends it by hand. The invitation exists either way.
      let copied = false;
      try {
        if (result.link) {
          await navigator.clipboard.writeText(result.link);
          copied = true;
        }
      } catch {
        copied = false;
      }
      enqueueSnackbar(
        t(copied ? "team-invitation-resent-copied" : "team-invitation-resent-no-email", { email: invitation.email }),
        { variant: "warning" },
      );
    }
    onChanged();
  };

  return (
    <Card component="section" aria-labelledby="team-people">
      <CardContent className="flex flex-col gap-5">
        <CardTitle
          id="team-people"
          icon={showsInvitations ? <NiEmail size="medium" /> : <NiUsers size="medium" />}
          tone={showsInvitations ? "accent-1" : "primary"}
          title={title}
          description={t(body)}
        />

        {data.seatCeiling !== null && (view === "todos" || showsInvitations) && (
          <UsageMeter
            headline={t("team-seats-headline", { used: used + reserved, total: data.seatCeiling })}
            ariaLabel={t("team-seats-aria")}
            segments={[
              { key: "people", label: t("team-seats-people"), value: used, display: String(used), tone: "primary" },
              {
                key: "invited",
                label: t("team-seats-invited"),
                value: reserved,
                display: String(reserved),
                tone: "secondary",
              },
              {
                key: "free",
                label: t("team-seats-free"),
                value: Math.max(0, data.seatCeiling - used - reserved),
                display: String(Math.max(0, data.seatCeiling - used - reserved)),
                tone: "empty",
              },
            ]}
          />
        )}

        {empty ? (
          narrowed ? (
            <EmptyState
              titleAs="h3"
              icon={<NiUsers size="large" />}
              title={t("team-none-found-title")}
              description={t("team-none-found-body")}
              action={{ label: t("team-none-found-action"), onClick: onClearSearch }}
              className="py-8"
            />
          ) : showsInvitations ? (
            <EmptyState
              titleAs="h3"
              icon={<NiEmail size="large" />}
              title={t("team-invitations-empty-title")}
              description={t("team-invitations-empty-body")}
              action={{ label: t("team-invite"), onClick: onInvite }}
              className="py-8"
            />
          ) : (
            <EmptyState
              titleAs="h3"
              icon={<NiUsers size="large" />}
              title={t(emptyKey)}
              description={t(`${emptyKey}-body`)}
              className="py-8"
            />
          )
        ) : (
          <Box component="ul" className="m-0 flex list-none flex-col p-0">
            {people.map((person) => (
              <PersonRow
                key={person.userId}
                person={person}
                self={person.userId === data.me.userId}
                actions={actionsFor(data.me, person)}
                onAction={(kind) => setPending({ kind, person } as Pending)}
              />
            ))}
            {invitations.map((invitation) => (
              <InvitationRow
                key={invitation.id}
                invitation={invitation}
                left={daysLeft(invitation.expiresAt, now)}
                busy={busy !== null}
                onResend={() => void resend(invitation)}
                onRevoke={() => void revoke(invitation)}
              />
            ))}
          </Box>
        )}

        {view === "todos" && alone && manager && (
          <Alert
            severity="info"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" onClick={onInvite}>
                {t("team-invite")}
              </Button>
            }
          >
            {t("team-alone")}
          </Alert>
        )}

        {(view === "todos" || view === "sem-fator") && manager && data.people.some(lacksSecondFactor) && (
          <Alert
            severity="warning"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" component={Link} href="/settings/security">
                {t("team-second-factor-open")}
              </Button>
            }
          >
            {t("team-second-factor-missing")}
          </Alert>
        )}
      </CardContent>

      {pending?.kind === "function" && (
        <FunctionPanel
          person={pending.person}
          onClose={() => setPending(null)}
          onSave={(firmFunction) => run(() => setMemberFunction(pending.person.userId, firmFunction))}
        />
      )}

      {pending?.kind === "promote" && (
        <ConfirmActionDialog
          requireReason={false}
          title={t("team-promote-title", { name: pending.person.name })}
          consequences={[t("team-promote-does-1"), t("team-promote-does-2")]}
          staysTitle={t("team-confirm-stays")}
          stays={[t("team-promote-stays")]}
          confirmLabel={t("team-action-promote")}
          cancelLabel={t("team-cancel")}
          busyLabel={t("team-working")}
          onConfirm={() => run(() => setMemberRole(pending.person.userId, "admin"))}
          onClose={() => setPending(null)}
        />
      )}

      {pending?.kind === "demote" && (
        <ConfirmActionDialog
          requireReason={false}
          title={t("team-demote-title", { name: pending.person.name })}
          consequences={[t("team-demote-does")]}
          staysTitle={t("team-confirm-stays")}
          stays={[t("team-demote-stays")]}
          confirmLabel={t("team-action-demote")}
          cancelLabel={t("team-cancel")}
          busyLabel={t("team-working")}
          onConfirm={() => run(() => setMemberRole(pending.person.userId, "member"))}
          onClose={() => setPending(null)}
        />
      )}

      {pending?.kind === "remove" && (
        <ConfirmActionDialog
          requireReason={false}
          tone="danger"
          title={t("team-remove-title", { name: pending.person.name })}
          consequences={[t("team-remove-does-1", { firm: data.firm.name }), t("team-remove-does-2")]}
          staysTitle={t("team-confirm-stays")}
          stays={[t("team-remove-stays-1"), t("team-remove-stays-2")]}
          confirmLabel={t("team-action-remove")}
          cancelLabel={t("team-cancel")}
          busyLabel={t("team-working")}
          onConfirm={() => run(() => removeMember(pending.person.userId))}
          onClose={() => setPending(null)}
        />
      )}

      {pending?.kind === "transfer" && (
        <ConfirmActionDialog
          requireReason={false}
          title={t("team-transfer-title", { name: pending.person.name })}
          consequences={[t("team-transfer-does-1", { name: pending.person.name }), t("team-transfer-does-2")]}
          staysTitle={t("team-confirm-stays")}
          stays={[t("team-transfer-stays")]}
          confirmLabel={t("team-action-transfer")}
          cancelLabel={t("team-cancel")}
          busyLabel={t("team-working")}
          onConfirm={() => run(() => transferOwnership(pending.person.userId))}
          onClose={() => setPending(null)}
        />
      )}
    </Card>
  );
}

/**
 * One person: who they are, their function and whether they manage the account, their registrations at the bar,
 * and on the right what still owes something (the second factor). A manager opens their function by the name.
 */
function PersonRow({
  person,
  self,
  actions,
  onAction,
}: {
  person: TeamPerson;
  self: boolean;
  actions: Pending["kind"][];
  onAction: (kind: Pending["kind"]) => void;
}) {
  const t = useTranslations("product");
  const name = self ? t("team-person-you", { name: person.name }) : person.name;
  const menu: QuickAction[] = actions.map((kind) => ({
    key: kind,
    label: t(ACTION[kind].key),
    icon: ACTION[kind].icon,
    onClick: () => onAction(kind),
  }));
  return (
    <Box component="li" className="border-grey-100 flex flex-row items-start gap-3 border-b py-4 last:border-b-0">
      <Avatar src={person.avatarUrl ?? undefined} alt="" className="bg-primary/10 text-primary h-10 w-10">
        {initialOf(person.name)}
      </Avatar>
      <Box className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Box className="flex flex-col items-start">
          {actions.includes("function") ? (
            <Button
              variant="text"
              color="inherit"
              onClick={() => onAction("function")}
              className="-mx-1 min-h-0 px-1 py-0 text-left font-semibold break-words hover:underline"
              aria-label={t("team-function-open", { name: person.name })}
            >
              {name}
            </Button>
          ) : (
            <Typography variant="subtitle2" component="p" className="break-words">
              {name}
            </Typography>
          )}
          <Typography variant="body2" className="text-text-secondary break-all">
            {person.email}
          </Typography>
        </Box>
        <Box className="flex flex-row flex-wrap items-center gap-1.5">
          <StatusChip label={t(FUNCTION_LABEL_KEY[person.firmFunction])} tone="info" />
          {person.role !== "member" && (
            <StatusChip label={t(ROLE_LABEL_KEY[person.role])} tone={person.role === "owner" ? "primary" : "neutral"} />
          )}
          {lacksSecondFactor(person) && <StatusChip label={t("team-no-second-factor")} tone="attention" />}
        </Box>
        {person.oab.length > 0 && (
          <Typography variant="body2" className="text-text-secondary">
            {person.oab.map((registration) => formatOab(registration)).join(" · ")}
          </Typography>
        )}
      </Box>
      <QuickActions label={t("team-person-actions", { name: person.name })} actions={menu} />
    </Box>
  );
}

/** One invitation nobody answered yet: to whom, as what, how long it still lasts; sending again and taking it back. */
function InvitationRow({
  invitation,
  left,
  busy,
  onResend,
  onRevoke,
}: {
  invitation: TeamInvitation;
  left: number;
  busy: boolean;
  onResend: () => void;
  onRevoke: () => void;
}) {
  const t = useTranslations("product");
  return (
    <Box component="li" className="border-grey-100 flex flex-row items-start gap-3 border-b py-4 last:border-b-0">
      <Avatar alt="" className="bg-accent-1/10 text-accent-1 h-10 w-10">
        <NiEmail size="medium" />
      </Avatar>
      <Box className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Typography variant="subtitle2" component="p" className="break-all">
          {invitation.email}
        </Typography>
        <Box className="flex flex-row flex-wrap items-center gap-1.5">
          <StatusChip label={t(FUNCTION_LABEL_KEY[invitation.firmFunction])} tone="info" />
          {invitation.role === "admin" && <StatusChip label={t(ROLE_LABEL_KEY.admin)} tone="neutral" />}
          <StatusChip
            tone={left <= 1 ? "attention" : "neutral"}
            label={left <= 1 ? t("team-invitation-expires-soon") : t("team-invitation-expires", { days: left })}
          />
        </Box>
      </Box>
      <QuickActions
        label={t("team-invitation-actions", { email: invitation.email })}
        actions={[
          {
            key: "resend",
            label: t("team-invitation-resend"),
            icon: <NiSendUpRight size="medium" />,
            onClick: onResend,
            disabled: busy,
          },
          {
            key: "revoke",
            label: t("team-invitation-revoke"),
            icon: <NiBinEmpty size="medium" />,
            onClick: onRevoke,
            disabled: busy,
          },
        ]}
      />
    </Box>
  );
}

/** What a person does in the firm, in the side panel: each function with what it means. */
function FunctionPanel({
  person,
  onClose,
  onSave,
}: {
  person: TeamPerson;
  onClose: () => void;
  onSave: (firmFunction: FirmFunction) => Promise<string | null>;
}) {
  const t = useTranslations("product");
  const [value, setValue] = useState<FirmFunction>(person.firmFunction);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    const failure = await onSave(value);
    setBusy(false);
    if (failure) setError(failure);
    else onClose();
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("team-close")}
      icon={<NiSwap size="medium" />}
      tone="primary"
      busy={busy}
      title={t("team-function-title", { name: person.name })}
      description={t("team-function-panel-description")}
      onSubmit={() => {
        if (!busy && value !== person.firmFunction) void save();
      }}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || value === person.firmFunction}>
            {busy ? t("team-working") : t("team-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("team-cancel")}
          </Button>
        </>
      }
    >
      <RadioGroup
        aria-label={t("team-function-title", { name: person.name })}
        value={value}
        onChange={(event) => setValue(event.target.value as FirmFunction)}
      >
        {FIRM_FUNCTIONS.map((option) => (
          <FormControlLabel
            key={option}
            value={option}
            control={<Radio size="small" />}
            className="items-start py-1"
            label={
              <Box className="flex flex-col pt-0.5">
                <Typography variant="body1" component="span" className="font-semibold">
                  {t(FUNCTION_LABEL_KEY[option])}
                </Typography>
                <Typography variant="body2" component="span" className="text-text-secondary">
                  {t(FUNCTION_HINT_KEY[option])}
                </Typography>
              </Box>
            }
          />
        ))}
      </RadioGroup>
      {error && (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      )}
    </SidePanel>
  );
}
