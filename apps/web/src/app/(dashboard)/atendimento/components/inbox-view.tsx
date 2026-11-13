"use client";

import ConversationList from "./conversation-list";
import SimulatorCard from "./simulator-card";
import Thread from "./thread";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useCallback, useEffect, useRef, useState, useTransition } from "react";

import { Alert, Box, Button, Grid } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import ListBar, { type ListView } from "@/components/product/list-bar";
import ModuleScope from "@/components/product/module-scope";
import NumberCard from "@/components/product/number-card";
import PageHeader from "@/components/product/page-header";
import type { TileTone } from "@/components/product/tile-tone";
import IllustrationEmail from "@/icons/illustrations/illustration-email";
import IllustrationPhone from "@/icons/illustrations/illustration-phone";
import IllustrationSupport from "@/icons/illustrations/illustration-support";
import NiMessageDots from "@/icons/nexture/ni-message-dots";
import NiSendUpRight from "@/icons/nexture/ni-send-up-right";
import NiStopwatch from "@/icons/nexture/ni-stopwatch";
import NiUser from "@/icons/nexture/ni-user";
import NiUsers from "@/icons/nexture/ni-users";
import { isManager } from "@/lib/firm/roles";
import { scopeCrumbs } from "@/lib/modules/offer";
import { countText } from "@/lib/numbers/compare";
import { cn } from "@/lib/utils";
import type { ConversationSummary, InboxState } from "@/lib/whatsapp/conversations";
import { searchInbox } from "@/lib/whatsapp/inbox-actions";
import {
  conversationHref,
  INBOX_CARDS,
  INBOX_SORTS,
  INBOX_VIEWS,
  type InboxCounts,
  inboxHref,
  type InboxSort,
  type InboxView as InboxViewKey,
  inboxViewGroup,
  isInboxSort,
  isInboxView,
} from "@/lib/whatsapp/inbox-list";

/** How often the screen asks again for what arrived, while it is in front of somebody. */
const REFRESH_MS = 10_000;

/** The numbers above the list, each the view it counts. */
const CARD: Record<(typeof INBOX_CARDS)[number], { icon: ReactNode; tone: TileTone }> = {
  fechando: { icon: <NiStopwatch size="medium" />, tone: "accent-3" },
  esperando: { icon: <NiMessageDots size="medium" />, tone: "primary" },
  chamou: { icon: <NiUser size="medium" />, tone: "accent-2" },
  resposta: { icon: <NiSendUpRight size="medium" />, tone: "secondary" },
};

/** The empty state of a view that waits says the good news; any other says the view holds nothing. */
const EMPTY_TITLE: Partial<Record<InboxViewKey, string>> = {
  esperando: "inbox-empty-esperando",
  fechando: "inbox-empty-fechando",
  chamou: "inbox-empty-chamou",
  resposta: "inbox-empty-resposta",
};

/** What a search found: the list under it, for the view and the order it was made in. */
type Searched = {
  text: string;
  view: InboxViewKey;
  sort: InboxSort;
  conversations: ConversationSummary[];
  total: number;
  counts: InboxCounts;
};

/**
 * The firm's conversations. Somebody comes here to answer the people who
 * wrote to the firm, before the 24 hours each message opens run out. Success
 * is nobody left waiting. So it is the list of who wrote beside the one
 * conversation being answered: never a table of messages.
 *
 * The list is of the screen pattern (phase 0, migration 0109): four cards of
 * numbers of what waits (the windows closing, who waits for an answer, where
 * ONE called a person, ONE's answers to send), each the view it counts; the
 * bar with the ready views, counted over every conversation of the firm, the
 * search (a name or a number, in the request's body) and the order (who
 * waits the longest first). The view and the order are in the address, so a
 * link of the home opens the view it counts. No "Novo": a conversation starts
 * with the person or with ONE.
 */
/** Why the panel did not open, said where the person tried (`?painel=`). */
const PANEL_ERRORS: Record<string, string> = {
  email_is_admin: "inbox-panel-error-email",
  support_session: "inbox-panel-error-support",
  busy: "inbox-panel-error-busy",
  not_configured: "inbox-panel-error-off",
};

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
        action={
          ready ? (
            <Box className="flex flex-wrap items-center gap-2">
              {/* The team's rooms (0238): its people talk among themselves there, in the panel. */}
              <Button
                variant="outlined"
                color="grey"
                href="/atendimento/salas"
                LinkComponent={Link}
                startIcon={<NiUsers size="small" />}
              >
                {t("inbox-rooms-open")}
              </Button>
              {ready.panel.available ? (
                // The firm's panel of attendance (0223), entered signed in, in a tab of its own.
                <Button
                  variant="contained"
                  href="/atendimento/painel"
                  target="_blank"
                  rel="noopener"
                  startIcon={<NiSendUpRight size="small" />}
                >
                  {t("inbox-panel-open")}
                </Button>
              ) : null}
            </Box>
          ) : undefined
        }
      />
      {ready?.panel.error ? (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          {t(PANEL_ERRORS[ready.panel.error] ?? "inbox-panel-error")}
        </Alert>
      ) : null}
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
          illustration={<IllustrationPhone />}
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

          {ready.counts.todas === 0 && !selected ? (
            <EmptyState
              illustration={<IllustrationSupport />}
              title={t("inbox-empty-title")}
              description={t("inbox-empty-body")}
              action={
                showSimulator && !simulating
                  ? { label: t("inbox-empty-simulate"), onClick: () => setSimulating(true) }
                  : undefined
              }
            />
          ) : (
            <InboxList ready={ready} manager={manager} onChanged={refresh} />
          )}

          {showSimulator && ready.simulatorNumberId && (simulating || ready.counts.todas > 0 || selected) ? (
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

type Ready = Extract<InboxState, { kind: "ready" }>;

/**
 * The cards, the bar, the list of the view and the conversation open beside it. The view and the order go in the
 * address (the page reads them again); a search is asked of the server in the request's body, and read again each
 * time the page is, under the view and the order it was made in, the newest answer winning.
 */
function InboxList({ ready, manager, onChanged }: { ready: Ready; manager: boolean; onChanged: () => void }) {
  const t = useTranslations("product");
  const router = useRouter();
  const selected = ready.selected;
  const module = ready.scope.current?.key ?? null;
  const [routing, startRouting] = useTransition();
  // The view and the order the person asked for, shown at once while the page reads them.
  const [view, setView] = useState<InboxViewKey>(ready.view);
  const [sort, setSort] = useState<InboxSort>(ready.sort);
  useEffect(() => setView(ready.view), [ready.view]);
  useEffect(() => setSort(ready.sort), [ready.sort]);

  const [search, setSearch] = useState("");
  const [searched, setSearched] = useState<Searched | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  /** What was asked last: an answer to an older question is not the list's. */
  const asked = useRef(0);

  const runSearch = useCallback(
    async (text: string, forView: InboxViewKey, forSort: InboxSort) => {
      const turn = (asked.current += 1);
      if (text.trim() === "") {
        setSearched(null);
        setSearchBusy(false);
        setSearchFailed(false);
        return;
      }
      setSearchBusy(true);
      let answer: Awaited<ReturnType<typeof searchInbox>>;
      try {
        answer = await searchInbox({ view: forView, sort: forSort, search: text, module });
      } catch {
        answer = { ok: false };
      }
      if (turn !== asked.current) return;
      setSearchBusy(false);
      if (!answer.ok) {
        setSearchFailed(true);
        return;
      }
      setSearchFailed(false);
      setSearched({ text, view: forView, sort: forSort, ...answer.list });
    },
    [module],
  );

  // The page was read again (the screen's own refresh, a conversation opened, a message sent): a search in course
  // is asked again too, under the view and the order the page now has.
  const firstList = useRef(ready.conversations);
  useEffect(() => {
    if (firstList.current === ready.conversations) return;
    firstList.current = ready.conversations;
    if (search.trim() !== "") void runSearch(search, ready.view, ready.sort);
  }, [ready.conversations, ready.view, ready.sort, search, runSearch]);

  const go = (next: { view: InboxViewKey; sort: InboxSort }) => {
    setView(next.view);
    setSort(next.sort);
    const query = { ...next, module };
    startRouting(() => {
      router.replace(selected ? conversationHref(selected.conversation.id, query) : inboxHref(query), {
        scroll: false,
      });
    });
    if (search.trim() !== "") void runSearch(search, next.view, next.sort);
  };

  const onSearch = (text: string) => {
    setSearch(text);
    void runSearch(text, view, sort);
  };

  // A search is the list once its answer is for what the bar now shows; the page's list otherwise.
  const searching = search.trim() !== "";
  const current = searching && searched && searched.view === view && searched.sort === sort ? searched : null;
  const conversations = searching ? (current?.conversations ?? []) : ready.conversations;
  const total = searching ? (current?.total ?? 0) : ready.total;
  const counts = current?.counts ?? ready.counts;
  // While the page reads another view, or a search is on its way, the list shown is not yet the bar's.
  const stale = routing || view !== ready.view || sort !== ready.sort || (searching && (!current || searchBusy));

  const views: ListView[] = INBOX_VIEWS.map((key) => ({
    key,
    label: t(`inbox-view-${key}`),
    count: countText(counts[key]),
    group: inboxViewGroup(key),
  }));

  const emptyKey = searching ? "inbox-search-empty-title" : (EMPTY_TITLE[view] ?? "inbox-empty-view");

  return (
    <>
      <Grid container spacing={2.5} className={cn(selected ? "hidden lg:flex" : "flex")}>
        {INBOX_CARDS.map((key) => (
          <Grid key={key} size={{ xs: 6, md: 3 }}>
            <NumberCard
              icon={CARD[key].icon}
              tone={CARD[key].tone}
              label={t(`inbox-view-${key}`)}
              hint={t(`inbox-card-${key}-hint`)}
              value={countText(counts[key])}
              onClick={() => go({ view: view === key ? "todas" : key, sort })}
              pressed={view === key}
            />
          </Grid>
        ))}
      </Grid>

      <Box className={cn(selected ? "hidden lg:block" : "block")}>
        <ListBar
          label={t("inbox-bar-label")}
          viewsTitle={t("list-views-title")}
          views={views}
          view={view}
          onView={(key) => {
            if (isInboxView(key)) go({ view: key, sort });
          }}
          search={{
            label: t("inbox-search-label"),
            placeholder: t("list-bar-search"),
            value: search,
            onChange: onSearch,
          }}
          sort={{
            label: t("list-bar-sort"),
            options: INBOX_SORTS.map((key) => ({ key, label: t(`inbox-sort-${key}`) })),
            value: sort,
            onChange: (key) => {
              if (isInboxSort(key)) go({ view, sort: key });
            },
          }}
        />
      </Box>

      {searchFailed ? (
        <Alert
          severity="error"
          className={cn("neutral bg-background-paper/60!", selected ? "hidden lg:flex" : "flex")}
          action={
            <Button color="inherit" size="small" onClick={() => void runSearch(search, view, sort)}>
              {t("inbox-retry")}
            </Button>
          }
        >
          {t("inbox-search-failed")}
        </Alert>
      ) : null}

      <Box className="flex flex-col gap-5 lg:flex-row lg:items-start">
        <Box className={cn("w-full flex-none lg:block lg:w-96", selected ? "hidden" : "block")}>
          <ConversationList
            title={searching ? t("inbox-search-title") : t(`inbox-view-${view}`)}
            conversations={conversations}
            total={total}
            sort={sort}
            searching={searching}
            stale={stale}
            selectedId={selected?.conversation.id ?? null}
            hrefOf={(id) => conversationHref(id, { view: ready.view, sort: ready.sort, module })}
            empty={
              stale
                ? null
                : {
                    title: t(emptyKey),
                    description: searching ? t("inbox-search-empty-body") : t("inbox-empty-view-body"),
                    action: searching
                      ? { label: t("inbox-search-clear"), onClick: () => onSearch("") }
                      : view !== "todas"
                        ? { label: t("inbox-view-all"), onClick: () => go({ view: "todas", sort }) }
                        : undefined,
                  }
            }
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
              module={module}
              backHref={inboxHref({ view: ready.view, sort: ready.sort, module })}
              panel={ready.panel.available}
              onChanged={onChanged}
            />
          ) : (
            <EmptyState
              illustration={<IllustrationEmail />}
              title={t("inbox-choose-title")}
              description={t("inbox-choose-body")}
            />
          )}
        </Box>
      </Box>
    </>
  );
}
