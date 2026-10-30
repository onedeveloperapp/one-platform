"use client";

import ConversationList from "./conversation-list";
import SimulatorCard from "./simulator-card";
import Thread from "./thread";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import ModuleScope from "@/components/product/module-scope";
import PageHeader from "@/components/product/page-header";
import NiMessages from "@/icons/nexture/ni-messages";
import NiPlug from "@/icons/nexture/ni-plug";
import NiUsers from "@/icons/nexture/ni-users";
import { isManager } from "@/lib/firm/roles";
import { scopeCrumbs } from "@/lib/modules/offer";
import { cn } from "@/lib/utils";
import type { InboxState } from "@/lib/whatsapp/conversations";

/** How often the screen asks again for what arrived, while it is in front of somebody. */
const REFRESH_MS = 10_000;

/**
 * The firm's conversations. Somebody comes here to answer the people who
 * wrote to the firm, before the 24 hours each message opens run out. Success
 * is nobody left waiting. So it is the list of who wrote, most recent first,
 * beside the one conversation being answered: never a table of messages.
 */
export default function InboxView({ state }: { state: InboxState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [simulating, setSimulating] = useState(false);

  const ready = state.kind === "ready" ? state : null;
  const isReady = ready !== null;
  const refresh = () => router.refresh();

  // There is no live channel yet: the screen asks again while somebody is looking at it.
  useEffect(() => {
    if (!isReady) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [isReady, router]);

  const manager = ready ? isManager(ready.me.role) : false;
  const selected = ready?.selected ?? null;
  const showSimulator = Boolean(ready?.simulatorNumberId) && !ready?.supportVisit;

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("inbox-title")}
        crumbs={scopeCrumbs(t("inbox-home"), t("inbox-title"), ready?.scope.current ?? null)}
        description={ready ? t("inbox-description", { firm: ready.firm.name }) : undefined}
      />
      {ready ? (
        <ModuleScope path="/atendimento" modules={ready.scope.modules} current={ready.scope.current?.key ?? null} />
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
            <Button color="inherit" size="small" onClick={refresh}>
              {t("inbox-retry")}
            </Button>
          }
        >
          {t("inbox-load-error")}
        </Alert>
      ) : null}

      {state.kind === "no-firm" ? (
        <EmptyState
          icon={<NiUsers size="large" />}
          title={t("inbox-no-firm-title")}
          description={t("inbox-no-firm-body")}
          action={{ label: t("inbox-no-firm-action"), href: "/admin" }}
        />
      ) : null}

      {ready && ready.whatsapp === "none" ? (
        <EmptyState
          icon={<NiPlug size="large" />}
          title={t("inbox-none-title")}
          description={manager ? t("inbox-none-body-manager") : t("inbox-none-body-member")}
          action={manager ? { label: t("inbox-none-action"), href: "/settings/connections" } : undefined}
        />
      ) : null}

      {ready && ready.whatsapp !== "none" ? (
        <>
          {ready.whatsapp === "disconnected" ? (
            <Alert
              severity="warning"
              className="neutral bg-background-paper/60!"
              action={
                manager ? (
                  <Button color="inherit" size="small" href="/settings/connections" LinkComponent={Link}>
                    {t("inbox-disconnected-action")}
                  </Button>
                ) : undefined
              }
            >
              {t("inbox-disconnected")}
            </Alert>
          ) : null}

          {ready.conversations.length === 0 && !selected ? (
            <EmptyState
              icon={<NiMessages size="large" />}
              title={t("inbox-empty-title")}
              description={t("inbox-empty-body")}
              action={
                showSimulator && !simulating
                  ? { label: t("inbox-empty-simulate"), onClick: () => setSimulating(true) }
                  : undefined
              }
            />
          ) : (
            <Box className="flex flex-col gap-5 lg:flex-row lg:items-start">
              <Box className={cn("w-full flex-none lg:block lg:w-96", selected ? "hidden" : "block")}>
                <ConversationList
                  conversations={ready.conversations}
                  selectedId={selected?.conversation.id ?? null}
                  module={ready.scope.current?.key ?? null}
                />
              </Box>
              <Box className={cn("min-w-0 flex-1 lg:block", selected ? "block" : "hidden")}>
                {selected ? (
                  <Thread
                    key={selected.conversation.id}
                    conversation={selected.conversation}
                    messages={selected.messages}
                    olderHidden={selected.olderHidden}
                    cases={selected.cases}
                    events={selected.events}
                    waitingReply={selected.waitingReply}
                    templates={ready.templates}
                    me={ready.me}
                    firmName={ready.firm.name}
                    supportVisit={ready.supportVisit}
                    manager={manager}
                    module={ready.scope.current?.key ?? null}
                    onChanged={refresh}
                  />
                ) : (
                  <EmptyState
                    icon={<NiMessages size="large" />}
                    title={t("inbox-choose-title")}
                    description={t("inbox-choose-body")}
                  />
                )}
              </Box>
            </Box>
          )}

          {showSimulator && ready.simulatorNumberId && (simulating || ready.conversations.length > 0 || selected) ? (
            <SimulatorCard
              numberId={ready.simulatorNumberId}
              conversation={selected?.conversation.simulated ? selected.conversation : null}
              onDelivered={refresh}
            />
          ) : null}
        </>
      ) : null}
    </Box>
  );
}
