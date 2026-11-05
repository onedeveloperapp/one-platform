"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSnackbar } from "notistack";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import {
  Alert,
  Badge,
  Box,
  Button,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Skeleton,
  Tooltip,
  Typography,
} from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import StatusChip from "@/components/product/status-chip";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiClock from "@/icons/nexture/ni-clock";
import NiCross from "@/icons/nexture/ni-cross";
import NiInbox from "@/icons/nexture/ni-inbox";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiRobot from "@/icons/nexture/ni-robot";
import {
  type PendingGroup,
  type PendingGroupKey,
  type PendingText,
  pendingWaitsOnFirm,
  sayPending,
  urgentIds,
} from "@/lib/firm/pending";
import { readPendingCenter } from "@/lib/firm/pending-actions";
import { cn } from "@/lib/utils";

/** How often the center reads again while the tab is in front of the person. */
const REFRESH_MS = 60_000;

const GROUP_ICON: Record<PendingGroupKey, React.ReactNode> = {
  late: <NiClock size="medium" className="text-error" />,
  today: <NiCalendarClock size="medium" className="text-accent-3" />,
  one: <NiRobot size="medium" className="text-primary" />,
  review: <NiInbox size="medium" className="text-text-secondary" />,
};

type CenterState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; groups: PendingGroup[]; badge: number; late: boolean };

/**
 * What waits for the person, on every screen of the firm (migration 0044):
 * the number in the header, red when something passed its time, and the
 * drawer that says what, of which case and why, each line one click from
 * where it is done. Read again at every change of screen, every minute while
 * the tab is in front of the person and when they come back to it; something
 * new that is late or that only a person can do is also told at once, as a
 * notice on the screen they are on. A read that fails says so, never that
 * nothing waits.
 */
export default function PendingCenter() {
  const t = useTranslations("product");
  const pathname = usePathname();
  const { enqueueSnackbar } = useSnackbar();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CenterState>({ kind: "loading" });
  const [tooltipShow, setTooltipShow] = useState(false);
  /** What was urgent at the last read; nothing on the first one, which tells nothing. */
  const seen = useRef<Set<string> | null>(null);

  const say = useCallback((text: PendingText) => sayPending(t, text), [t]);

  const load = useCallback(async () => {
    let read: Awaited<ReturnType<typeof readPendingCenter>>;
    try {
      read = await readPendingCenter();
    } catch {
      setState((current) => (current.kind === "ready" ? current : { kind: "error" }));
      return;
    }
    if (!read.ok) {
      setState((current) => (current.kind === "ready" ? current : { kind: "error" }));
      return;
    }
    const urgent = urgentIds(read.groups);
    if (seen.current) {
      const fresh = urgent.filter((id) => !seen.current?.has(id));
      if (fresh.length > 0) {
        enqueueSnackbar(t("pending-new", { count: fresh.length }), {
          variant: "warning",
          action: (key) => (
            <Button color="inherit" size="small" onClick={() => setOpen(true)} key={String(key)}>
              {t("pending-new-action")}
            </Button>
          ),
        });
      }
    }
    seen.current = new Set(urgent);
    setState({ kind: "ready", groups: read.groups, badge: read.badge, late: read.late });
  }, [enqueueSnackbar, t]);

  // A change of screen is a moment the person looks at the header.
  useEffect(() => {
    void load();
  }, [load, pathname]);

  useEffect(() => {
    const refreshIfVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", refreshIfVisible);
    const interval = window.setInterval(refreshIfVisible, REFRESH_MS);
    return () => {
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.clearInterval(interval);
    };
  }, [load]);

  const badge = state.kind === "ready" ? state.badge : 0;
  const late = state.kind === "ready" && state.late;
  // Red when something passed its time; the accent of "look at this" when a case waits on the firm.
  const waits = state.kind === "ready" && pendingWaitsOnFirm(state.groups);

  const toggle = () => {
    if (!open) void load();
    setOpen((current) => !current);
  };

  return (
    <>
      <Tooltip title={t("pending-title")} placement="bottom" arrow open={!open && tooltipShow}>
        <Badge
          badgeContent={badge}
          max={99}
          color={late ? "error" : waits ? "warning" : "primary"}
          slotProps={{ badge: { className: "right-2 top-2 pointer-events-none", "aria-hidden": true } }}
        >
          <Button
            variant="text"
            size="large"
            color="text-primary"
            className={cn(
              "icon-only hover-icon-shrink [&.active]:text-primary! hover:bg-grey-25",
              open && "active bg-grey-25",
            )}
            onClick={toggle}
            onMouseEnter={() => setTooltipShow(true)}
            onMouseLeave={() => setTooltipShow(false)}
            aria-label={
              state.kind === "ready"
                ? t("pending-open", { count: badge, late: late ? "yes" : "no" })
                : t("pending-title")
            }
            aria-expanded={open}
            aria-controls="pending-panel"
            startIcon={<NiListCheck size="large" variant={open ? "contained" : "outlined"} />}
          />
        </Badge>
      </Tooltip>

      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        slotProps={{ paper: { id: "pending-panel", role: "dialog", "aria-labelledby": "pending-title" } }}
      >
        <Box className="flex h-full w-screen max-w-md flex-col">
          <Box className="flex flex-row items-start justify-between gap-2 p-5 pb-3">
            <Box className="flex flex-col gap-1">
              <Typography id="pending-title" variant="h5" component="h2" className="mb-0">
                {t("pending-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("pending-subtitle")}
              </Typography>
            </Box>
            <IconButton aria-label={t("pending-close")} onClick={() => setOpen(false)}>
              <NiCross size="medium" />
            </IconButton>
          </Box>

          <Box className="flex flex-1 flex-col gap-6 overflow-y-auto px-5 pb-6">
            {state.kind === "loading" ? (
              <Box className="flex flex-col gap-2" aria-busy="true">
                <Skeleton variant="rounded" height={56} />
                <Skeleton variant="rounded" height={56} />
                <Skeleton variant="rounded" height={56} />
              </Box>
            ) : state.kind === "error" ? (
              <Alert
                severity="error"
                className="neutral bg-background-paper/60!"
                action={
                  <Button color="inherit" size="small" onClick={() => void load()}>
                    {t("pending-retry")}
                  </Button>
                }
              >
                {t("pending-error")}
              </Alert>
            ) : state.groups.length === 0 ? (
              <EmptyState
                icon={<NiListCheck size="large" />}
                title={t("pending-empty-title")}
                description={t("pending-empty-body")}
                titleAs="h3"
              />
            ) : (
              state.groups.map((group) => (
                <Box key={group.key} component="section" aria-labelledby={`pending-group-${group.key}`}>
                  <Box className="mb-1 flex flex-row items-center gap-2">
                    {GROUP_ICON[group.key]}
                    <Typography id={`pending-group-${group.key}`} variant="subtitle2" component="h3" className="flex-1">
                      {t(`pending-group-${group.key}`)}
                    </Typography>
                    <Typography variant="subtitle2" component="span" className="text-text-secondary">
                      {group.total}
                    </Typography>
                  </Box>
                  <List disablePadding>
                    {group.items.map((item) => (
                      <ListItemButton
                        key={item.id}
                        component={Link}
                        href={item.href}
                        onClick={() => setOpen(false)}
                        className="rounded-lg px-2"
                      >
                        <ListItemText
                          primary={
                            <Box component="span" className="flex flex-col items-start gap-1">
                              <StatusChip
                                label={say(item.tag)}
                                tone={group.key === "late" ? "danger" : group.key === "one" ? "attention" : "neutral"}
                              />
                              <span>{say(item.label)}</span>
                            </Box>
                          }
                          secondary={item.detail ? say(item.detail) : undefined}
                          slotProps={{ primary: { variant: "body1" }, secondary: { variant: "body2" } }}
                        />
                        {item.count > 1 ? (
                          <Typography variant="subtitle2" component="span" className="ml-3">
                            {item.count}
                          </Typography>
                        ) : null}
                      </ListItemButton>
                    ))}
                  </List>
                </Box>
              ))
            )}
            {/* Every decision the firm left to a person, of every case, for whoever reviews many in a row: the list
                is out of the main menu, and each line above already leads to where its decision is taken. */}
            {state.kind === "ready" &&
            state.groups.some((group) =>
              group.items.some((item) => item.id.startsWith("decision") || item.id === "need:queue"),
            ) ? (
              <Box>
                <Button
                  variant="text"
                  color="grey"
                  size="small"
                  component={Link}
                  href="/aprovacoes"
                  onClick={() => setOpen(false)}
                >
                  {t("pending-decisions-all")}
                </Button>
              </Box>
            ) : null}
          </Box>
        </Box>
      </Drawer>
    </>
  );
}
