"use client";

import { type TeamData, teamErrorKey, type TeamPerson } from "../team-types";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Grid,
  IconButton,
  Menu,
  MenuItem,
  Radio,
  RadioGroup,
  Typography,
} from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import DialogHeader from "@/components/product/dialog-header";
import StatusChip from "@/components/product/status-chip";
import UsageMeter from "@/components/product/usage-meter";
import NiEllipsisVertical from "@/icons/nexture/ni-ellipsis-vertical";
import { removeMember, setMemberFunction, setMemberRole, transferOwnership } from "@/lib/firm/actions";
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

/** The words of each action in the menu of a person (`product` namespace). */
const ACTION_LABEL_KEY: Record<Pending["kind"], string> = {
  function: "team-action-function",
  promote: "team-action-promote",
  demote: "team-action-demote",
  transfer: "team-action-transfer",
  remove: "team-action-remove",
};

const initialOf = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

/** The roster: who is in the firm, what each one does, and what a manager may change. */
export default function PeopleCard({
  data,
  onChanged,
  onInvite,
}: {
  data: TeamData;
  onChanged: () => void;
  onInvite: () => void;
}) {
  const t = useTranslations("product");
  const [menu, setMenu] = useState<{ anchor: HTMLElement; person: TeamPerson } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);

  const used = data.people.length;
  const reserved = data.invitations.length;
  const manager = data.me.role !== "member";
  const alone = used === 1 && reserved === 0;

  const open = (kind: Pending["kind"]) => {
    if (menu) setPending({ kind, person: menu.person } as Pending);
    setMenu(null);
  };

  /** Runs a confirmed change and returns the message of its failure, if any. */
  const run = async (action: () => Promise<{ ok: boolean; code: string }>): Promise<string | null> => {
    const result = await action();
    if (!result.ok) return t(teamErrorKey(result.code));
    onChanged();
    return null;
  };

  return (
    <Grid size={12}>
      <Card component="section" aria-labelledby="team-people">
        <CardContent className="flex flex-col gap-5">
          <Box className="flex flex-col gap-1">
            <Typography id="team-people" variant="h5" component="h2" className="mb-0">
              {t("team-people-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {manager ? t("team-people-body-manager") : t("team-people-body")}
            </Typography>
          </Box>

          {data.seatCeiling !== null && (
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

          <Box component="ul" className="m-0 flex list-none flex-col p-0">
            {data.people.map((person) => {
              const self = person.userId === data.me.userId;
              const actions = actionsFor(data.me, person);
              return (
                <Box
                  component="li"
                  key={person.userId}
                  className="border-grey-100 flex flex-row items-start gap-3 border-b py-4 last:border-b-0"
                >
                  <Avatar src={person.avatarUrl ?? undefined} alt="" className="bg-primary/10 text-primary h-10 w-10">
                    {initialOf(person.name)}
                  </Avatar>
                  <Box className="flex min-w-0 flex-1 flex-col gap-1.5">
                    <Box className="flex flex-col">
                      <Typography variant="subtitle2" component="p" className="break-words">
                        {self ? t("team-person-you", { name: person.name }) : person.name}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary break-all">
                        {person.email}
                      </Typography>
                    </Box>
                    <Box className="flex flex-row flex-wrap items-center gap-1.5">
                      <StatusChip label={t(FUNCTION_LABEL_KEY[person.firmFunction])} tone="info" />
                      {person.role !== "member" && (
                        <StatusChip
                          label={t(ROLE_LABEL_KEY[person.role])}
                          tone={person.role === "owner" ? "primary" : "neutral"}
                        />
                      )}
                      {person.hasSecondFactor === false && person.role !== "member" && (
                        <StatusChip label={t("team-no-second-factor")} tone="attention" />
                      )}
                    </Box>
                    {person.oab.length > 0 && (
                      <Typography variant="body2" className="text-text-secondary">
                        {person.oab.map((registration) => formatOab(registration)).join(" · ")}
                      </Typography>
                    )}
                  </Box>
                  {actions.length > 0 && (
                    <IconButton
                      size="small"
                      color="grey"
                      aria-label={t("team-person-actions", { name: person.name })}
                      onClick={(event) => setMenu({ anchor: event.currentTarget, person })}
                    >
                      <NiEllipsisVertical size="medium" />
                    </IconButton>
                  )}
                </Box>
              );
            })}
          </Box>

          {alone && manager && (
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

          {manager && data.people.some((person) => person.role !== "member" && person.hasSecondFactor === false) && (
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
      </Card>

      <Menu anchorEl={menu?.anchor ?? null} open={Boolean(menu)} onClose={() => setMenu(null)}>
        {menu &&
          actionsFor(data.me, menu.person).map((kind) => (
            <MenuItem key={kind} onClick={() => open(kind)}>
              {t(ACTION_LABEL_KEY[kind])}
            </MenuItem>
          ))}
      </Menu>

      {pending?.kind === "function" && (
        <FunctionDialog
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
    </Grid>
  );
}

/** Picks what a person does in the firm, each option with what it means. */
function FunctionDialog({
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
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="team-function-dialog">
      <DialogHeader
        id="team-function-dialog"
        title={t("team-function-title", { name: person.name })}
        onClose={onClose}
        closeLabel={t("team-close")}
      />
      <DialogContent>
        <Box className="flex flex-col gap-3">
          <RadioGroup
            aria-labelledby="team-function-dialog"
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
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
          {t("team-cancel")}
        </Button>
        <Button variant="contained" onClick={() => void save()} disabled={busy || value === person.firmFunction}>
          {busy ? t("team-working") : t("team-save")}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
