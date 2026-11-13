"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import {
  Alert,
  Avatar,
  AvatarGroup,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  TextField,
  Typography,
} from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import ListBar from "@/components/product/list-bar";
import PageHeader from "@/components/product/page-header";
import QuickActions from "@/components/product/quick-actions";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import { TILE_TONE } from "@/components/product/tile-tone";
import IllustrationSupport from "@/icons/illustrations/illustration-support";
import NiArchive from "@/icons/nexture/ni-archive";
import NiMessages from "@/icons/nexture/ni-messages";
import NiSendUpRight from "@/icons/nexture/ni-send-up-right";
import NiUsers from "@/icons/nexture/ni-users";
import { archiveRoom, saveRoom } from "@/lib/chatwoot/room-actions";
import { FIRM_FUNCTIONS, type FirmFunction, FUNCTION_LABEL_KEY } from "@/lib/firm/roles";
import { cn } from "@/lib/utils";

export type RoomPerson = { id: string; name: string; avatarUrl: string | null; firmFunction: string | null };
export type RoomItem = {
  id: string;
  name: string;
  archivedAt: string | null;
  archiveReason: string | null;
  /** The person looking is in it. */
  mine: boolean;
  /** The panel has the room. */
  inPanel: boolean;
  /** Something of it changed after the panel was last brought up to it. */
  behind: boolean;
  members: { id: string; inPanel: boolean }[];
};
export type RoomsState =
  | { kind: "unavailable" }
  | { kind: "no-firm" }
  | { kind: "error" }
  | {
      kind: "ready";
      me: string;
      manages: boolean;
      rooms: RoomItem[];
      team: RoomPerson[];
      panel: { available: boolean; error: string | null };
    };
type Ready = Extract<RoomsState, { kind: "ready" }>;

/** Why the panel did not open, said where the person tried (`?painel=`): the same words as the conversations'. */
const PANEL_ERRORS: Record<string, string> = {
  email_is_admin: "inbox-panel-error-email",
  support_session: "inbox-panel-error-support",
  busy: "inbox-panel-error-busy",
  not_configured: "inbox-panel-error-off",
};

const ERROR_KEY: Record<string, string> = {
  name_taken: "rooms-error-name-taken",
  invalid_name: "rooms-error-name",
  no_members: "rooms-error-no-members",
  not_a_member: "rooms-error-not-a-member",
  forbidden: "rooms-error-forbidden",
  archived: "rooms-error-archived",
  invalid_reason: "rooms-error-reason",
  support_session: "rooms-error-support",
  too_many_rooms: "rooms-error-too-many",
};
const errorKey = (code: string) => ERROR_KEY[code] ?? "rooms-error-failed";

const VIEWS = ["ativas", "arquivadas"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = { ativas: "rooms-view-ativas", arquivadas: "rooms-view-arquivadas" };
const isView = (value: string): value is View => (VIEWS as readonly string[]).includes(value);

const initialsOf = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .filter((_, index, words) => index === 0 || index === words.length - 1)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

const isFirmFunction = (value: string | null): value is FirmFunction =>
  (FIRM_FUNCTIONS as readonly string[]).includes(value ?? "");

/**
 * The team's rooms (migration 0238): where the firm's people talk among themselves, outside a client's conversation,
 * in the panel of attendance. Somebody comes here to open their room; success is the room open in the panel, one
 * click away. Who administers the firm or a partner also makes the rooms, chooses who is in each, renames and
 * archives them (a registration: the list with its views and its "Nova sala", the side panel, the archive with its
 * reason). A colleague who has not entered the panel yet joins the room when they first do, and the card says so.
 */
export default function RoomsView({ state }: { state: RoomsState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const ready = state.kind === "ready" ? state : null;

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("rooms-title")}
        crumbs={[
          { label: t("inbox-home"), href: "/inicio" },
          { label: t("inbox-title"), href: "/atendimento" },
          { label: t("rooms-title") },
        ]}
        description={t("rooms-description")}
      />
      {ready?.panel.error ? (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          {t(PANEL_ERRORS[ready.panel.error] ?? "inbox-panel-error")}
        </Alert>
      ) : null}
      {ready && !ready.panel.available ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("rooms-panel-off")}
        </Alert>
      ) : null}

      {state.kind === "unavailable" ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("settings-unavailable")}
        </Alert>
      ) : null}
      {state.kind === "error" ? (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={() => router.refresh()}>
              {t("inbox-retry")}
            </Button>
          }
        >
          {t("rooms-load-error")}
        </Alert>
      ) : null}
      {state.kind === "no-firm" ? (
        <EmptyState
          icon={<NiUsers size="large" />}
          title={t("inbox-no-firm-title")}
          description={t("inbox-no-firm-body")}
        />
      ) : null}

      {ready ? <RoomsList ready={ready} /> : null}
    </Box>
  );
}

function RoomsList({ ready }: { ready: Ready }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [view, setView] = useState<View>("ativas");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<RoomItem | "new" | null>(null);
  const [archiving, setArchiving] = useState<RoomItem | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const people = new Map(ready.team.map((person) => [person.id, person]));
  const active = ready.rooms.filter((room) => !room.archivedAt);
  const archived = ready.rooms.filter((room) => room.archivedAt);
  const words = search.trim().toLocaleLowerCase("pt-BR");
  const archivedView = view === "arquivadas";
  const shown = (archivedView ? archived : active).filter(
    (room) => !words || room.name.toLocaleLowerCase("pt-BR").includes(words),
  );

  if (ready.rooms.length === 0) {
    return (
      <>
        <EmptyState
          illustration={<IllustrationSupport />}
          title={t(ready.manages ? "rooms-empty-title-manager" : "rooms-empty-title")}
          description={t(ready.manages ? "rooms-empty-body-manager" : "rooms-empty-body")}
          action={ready.manages ? { label: t("rooms-new"), onClick: () => setEditing("new") } : undefined}
        />
        {editing ? (
          <RoomPanel
            room={null}
            me={ready.me}
            team={ready.team}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              router.refresh();
            }}
          />
        ) : null}
      </>
    );
  }

  const restore = async (room: RoomItem) => {
    setProblem(null);
    try {
      const result = await archiveRoom(room.id, null);
      if (result.ok) router.refresh();
      else setProblem(t(errorKey(result.code)));
    } catch {
      setProblem(t("rooms-error-failed"));
    }
  };

  return (
    <>
      <ListBar
        label={t("rooms-bar-label")}
        viewsTitle={t("list-views-title")}
        views={VIEWS.map((key) => ({
          key,
          label: t(VIEW_LABEL[key]),
          count: String(key === "ativas" ? active.length : archived.length),
          group: key,
        }))}
        view={view}
        onView={(key) => {
          if (isView(key)) setView(key);
        }}
        search={{
          label: t("rooms-search-label"),
          placeholder: t("list-bar-search"),
          value: search,
          onChange: setSearch,
        }}
        create={ready.manages ? { label: t("rooms-new"), onClick: () => setEditing("new") } : undefined}
      />
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {problem}
        </Alert>
      ) : null}

      {shown.length === 0 ? (
        <EmptyState
          illustration={<IllustrationSupport />}
          title={t(words ? "rooms-search-empty" : archivedView ? "rooms-archived-empty" : "rooms-active-empty")}
          action={
            words
              ? { label: t("rooms-search-clear"), onClick: () => setSearch("") }
              : archivedView
                ? { label: t("rooms-view-all"), onClick: () => setView("ativas") }
                : ready.manages
                  ? { label: t("rooms-new"), onClick: () => setEditing("new") }
                  : undefined
          }
        />
      ) : (
        <Box component="ul" className="m-0 grid list-none grid-cols-1 gap-5 p-0 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((room) => (
            <Box component="li" key={room.id} className="min-w-0">
              <RoomCard
                room={room}
                people={people}
                manages={ready.manages}
                panel={ready.panel.available}
                onEdit={() => setEditing(room)}
                onArchive={() => setArchiving(room)}
                onRestore={() => void restore(room)}
              />
            </Box>
          ))}
        </Box>
      )}

      {editing ? (
        <RoomPanel
          room={editing === "new" ? null : editing}
          me={ready.me}
          team={ready.team}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
      {archiving ? (
        <ConfirmActionDialog
          title={t("rooms-archive-title")}
          intro={archiving.name}
          consequences={[t("rooms-archive-consequence")]}
          staysTitle={t("rooms-archive-stays-title")}
          stays={[t("rooms-archive-stays")]}
          reasonLabel={t("rooms-archive-reason")}
          reasonMinLength={3}
          requireReason
          confirmLabel={t("rooms-archive")}
          cancelLabel={t("rooms-cancel")}
          onClose={() => setArchiving(null)}
          onConfirm={async (reason) => {
            const result = await archiveRoom(archiving.id, reason);
            if (!result.ok) return t(errorKey(result.code));
            setArchiving(null);
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </>
  );
}

/** One room: who is in it, where it stands in the panel, and the one way in. */
function RoomCard({
  room,
  people,
  manages,
  panel,
  onEdit,
  onArchive,
  onRestore,
}: {
  room: RoomItem;
  people: Map<string, RoomPerson>;
  manages: boolean;
  panel: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const t = useTranslations("product");
  const titleId = `room-${room.id}`;
  const members = room.members.map((member) => ({ ...member, person: people.get(member.id) ?? null }));
  const names = members.map((member) => member.person?.name).filter((name): name is string => Boolean(name));
  const outside = members.filter((member) => !member.inPanel && member.person).map((member) => member.person!.name);
  const shownNames =
    names.length > 3
      ? t("rooms-names-more", { names: names.slice(0, 3).join(", "), count: names.length - 3 })
      : names.join(", ");
  const preparing = !room.archivedAt && panel && (room.behind || !room.inPanel);

  return (
    <Card component="article" aria-labelledby={titleId} className="h-full">
      <CardContent className="flex h-full flex-col gap-4">
        <Box className="flex items-start gap-3">
          <Box
            aria-hidden
            className={cn(
              "flex h-10 w-10 flex-none items-center justify-center rounded-lg",
              room.archivedAt ? "bg-grey-50 text-text-secondary" : [TILE_TONE.primary.bg, TILE_TONE.primary.text],
            )}
          >
            {room.archivedAt ? <NiArchive size="medium" /> : <NiMessages size="medium" />}
          </Box>
          <Box className="flex min-w-0 flex-1 flex-col">
            <Typography id={titleId} variant="subtitle1" component="h3" className="mb-0 truncate font-semibold">
              {room.name}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("rooms-members", { count: members.length })}
            </Typography>
          </Box>
          {manages ? (
            <QuickActions
              label={t("rooms-actions", { name: room.name })}
              actions={
                room.archivedAt
                  ? [{ key: "restore", label: t("rooms-restore"), onClick: onRestore }]
                  : [
                      { key: "edit", label: t("rooms-edit"), onClick: onEdit },
                      { key: "archive", label: t("rooms-archive"), onClick: onArchive },
                    ]
              }
            />
          ) : null}
        </Box>

        {members.length > 0 ? (
          <Box className="flex min-w-0 items-center gap-3">
            <AvatarGroup max={5} className="flex-none" slotProps={{ surplus: { className: "h-8 w-8 text-xs" } }}>
              {members.map((member) => (
                <Avatar
                  key={member.id}
                  src={member.person?.avatarUrl ?? undefined}
                  alt=""
                  className="bg-grey-50 text-text-primary h-8 w-8 text-xs"
                >
                  {initialsOf(member.person?.name ?? "")}
                </Avatar>
              ))}
            </AvatarGroup>
            <Typography variant="body2" className="text-text-secondary min-w-0 truncate">
              {shownNames}
            </Typography>
          </Box>
        ) : null}

        <Box className="flex flex-col gap-2">
          {room.archivedAt ? (
            <StateLine tone="info">{t("rooms-archived", { reason: room.archiveReason ?? "" })}</StateLine>
          ) : null}
          {preparing ? <StateLine tone="waiting">{t("rooms-preparing")}</StateLine> : null}
          {!room.archivedAt && outside.length > 0 ? (
            <StateLine tone="info">
              {t("rooms-outside", { names: outside.join(", "), count: outside.length })}
            </StateLine>
          ) : null}
          {!room.archivedAt && !room.mine ? <StateLine tone="info">{t("rooms-not-in")}</StateLine> : null}
        </Box>

        {!room.archivedAt && room.mine && panel ? (
          <Box className="mt-auto flex">
            <Button
              variant="contained"
              href={`/atendimento/painel?sala=${room.id}`}
              target="_blank"
              rel="noopener"
              startIcon={<NiSendUpRight size="small" />}
            >
              {t("rooms-open")}
            </Button>
          </Box>
        ) : null}
      </CardContent>
    </Card>
  );
}

/** Making a room or changing it: its name and who is in it. */
function RoomPanel({
  room,
  me,
  team,
  onClose,
  onSaved,
}: {
  room: RoomItem | null;
  me: string;
  team: RoomPerson[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [name, setName] = useState(room?.name ?? "");
  const [chosen, setChosen] = useState<Set<string>>(
    () => new Set(room ? room.members.map((member) => member.id) : [me]),
  );
  const [busy, setBusy] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const sorted = [...team].sort((a, b) => (a.id === me ? -1 : b.id === me ? 1 : a.name.localeCompare(b.name, "pt-BR")));

  const toggle = (id: string) =>
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    const clean = name.trim().replace(/\s+/g, " ");
    const badName = clean.length === 0 || clean.length > 60;
    setNameError(badName ? t("rooms-error-name") : null);
    setPeopleError(chosen.size === 0 ? t("rooms-error-no-members") : null);
    if (badName || chosen.size === 0) return;
    setBusy(true);
    setProblem(null);
    try {
      const result = await saveRoom(room?.id ?? null, clean, [...chosen]);
      if (result.ok) onSaved();
      else if (result.code === "name_taken" || result.code === "invalid_name") setNameError(t(errorKey(result.code)));
      else if (result.code === "no_members") setPeopleError(t(errorKey(result.code)));
      else setProblem(t(errorKey(result.code)));
    } catch {
      setProblem(t("rooms-error-failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("rooms-cancel")}
      icon={<NiMessages size="medium" />}
      tone="primary"
      busy={busy}
      title={t(room ? "rooms-edit" : "rooms-new")}
      description={t("rooms-panel-body")}
      onSubmit={() => void submit()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
            {t(room ? "rooms-save" : "rooms-create")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("rooms-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {problem}
          </Alert>
        ) : null}
        <TextField
          label={t("rooms-name")}
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setNameError(null);
          }}
          required
          autoFocus
          error={Boolean(nameError)}
          helperText={nameError ?? t("rooms-name-hint")}
          slotProps={{ htmlInput: { maxLength: 60 } }}
        />
        <Box component="fieldset" className="m-0 flex flex-col gap-1 border-0 p-0">
          <FormLabel component="legend" className="mb-1">
            {t("rooms-people", { count: chosen.size })}
          </FormLabel>
          {sorted.map((person) => (
            <FormControlLabel
              key={person.id}
              control={<Checkbox checked={chosen.has(person.id)} onChange={() => toggle(person.id)} />}
              label={
                <Box className="flex flex-col py-1">
                  <Typography variant="body2" className="font-medium">
                    {person.id === me ? t("rooms-person-you", { name: person.name }) : person.name}
                  </Typography>
                  {isFirmFunction(person.firmFunction) ? (
                    <Typography variant="caption" className="text-text-secondary">
                      {t(FUNCTION_LABEL_KEY[person.firmFunction])}
                    </Typography>
                  ) : null}
                </Box>
              }
            />
          ))}
          {peopleError ? <FormHelperText error>{peopleError}</FormHelperText> : null}
        </Box>
      </Box>
    </SidePanel>
  );
}
