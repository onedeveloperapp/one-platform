"use client";

import ClauseDialog from "./components/clause-dialog";
import NewPassengerDialog from "./components/new-passenger-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, TextField, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import PageHeader from "@/components/product/page-header";
import StatusChip from "@/components/product/status-chip";
import NiDocumentCross from "@/icons/nexture/ni-document-cross";
import NiLuggage from "@/icons/nexture/ni-luggage";
import NiPlane from "@/icons/nexture/ni-plane";
import NiUserCross from "@/icons/nexture/ni-user-cross";
import NiUsers from "@/icons/nexture/ni-users";
import { listPassengers } from "@/modules/direito-do-passageiro/agency/actions";
import {
  CONSENT_KEY,
  CONSENT_TONE,
  DOCUMENT_KIND_KEY,
  FILTER_KEY,
  localTimeLabel,
  PAX_PAGE_SIZE,
  type PaxFilter,
  type PaxOverview,
  type PaxPage,
  type PaxRow,
} from "@/modules/direito-do-passageiro/agency/passengers";
import { formatCpf } from "@flyee/fields";

export type PassengersData = {
  firm: string;
  manager: boolean;
  overview: PaxOverview | null;
  page: PaxPage | null;
  clause: { version: number; body: string } | null;
  /** Whether the clause could be read: one that could not is never said to be missing. */
  clauseRead: boolean;
};

const FILTER_HINT: Record<PaxFilter, string> = {
  all: "pax-filter-all-hint",
  waiting_consent: "pax-filter-waiting-consent-hint",
  missing_identity: "pax-filter-missing-identity-hint",
  upcoming: "pax-filter-upcoming-hint",
};

/**
 * The agency's list of passengers. Who works at a travel agency comes here to see who still has to agree on the
 * link, who lacks a document and who flies soon, and to add passengers one by one or from a spreadsheet. The
 * counts above the list are filters; the search travels in a server action, never in the address.
 */
export default function PassengersView({ data }: { data: PassengersData | null }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [filter, setFilter] = useState<PaxFilter>("all");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<PaxPage | null>(data?.page ?? null);
  const [failed, setFailed] = useState(data !== null && data.page === null);
  const [loading, setLoading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [clauseOpen, setClauseOpen] = useState(false);
  const asked = useRef(0);
  const first = useRef(true);

  const load = async (next: { filter: PaxFilter; search: string; offset: number }) => {
    const ask = ++asked.current;
    setLoading(true);
    const result = await listPassengers(next);
    if (ask !== asked.current) return;
    setLoading(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setPage(result.page);
  };

  // A search is asked once the person stops typing; a filter or a page at once.
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const wait = setTimeout(() => void load({ filter, search, offset }), 350);
    return () => clearTimeout(wait);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  if (!data) {
    return (
      <Grid container spacing={5}>
        <Grid size={12}>
          <PageHeader
            title={t("pax-title")}
            crumbs={[{ label: t("partner-home-title"), href: "/parceiro" }, { label: t("pax-title") }]}
          />
        </Grid>
        <Grid size={12}>
          <EmptyState
            icon={<NiLuggage size="large" />}
            title={t("pax-no-partnership-title")}
            description={t("pax-no-partnership-body")}
            action={{ label: t("pax-no-partnership-action"), href: "/parceiro" }}
          />
        </Grid>
      </Grid>
    );
  }

  const overview = data.overview;
  const choose = (next: PaxFilter) => {
    const value = filter === next && next !== "all" ? "all" : next;
    setFilter(value);
    setOffset(0);
    void load({ filter: value, search, offset: 0 });
  };
  const goTo = (next: number) => {
    setOffset(next);
    void load({ filter, search, offset: next });
  };

  const tiles: {
    filter: PaxFilter;
    value: number | null;
    icon: React.ReactNode;
    tone: "primary" | "accent-3" | "accent-2" | "accent-4";
  }[] = [
    { filter: "all", value: overview?.travelers ?? null, icon: <NiUsers size="large" />, tone: "primary" },
    {
      filter: "waiting_consent",
      value: overview?.adultsWaiting ?? null,
      icon: <NiUserCross size="large" />,
      tone: "accent-3",
    },
    {
      filter: "missing_identity",
      value: overview?.missingIdentity ?? null,
      icon: <NiDocumentCross size="large" />,
      tone: "accent-2",
    },
    { filter: "upcoming", value: overview?.upcoming ?? null, icon: <NiPlane size="large" />, tone: "accent-4" },
  ];

  const noneAtAll = overview?.travelers === 0 && filter === "all" && search.trim() === "";
  const rows = page?.rows ?? [];
  const total = page?.total ?? 0;

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <PageHeader
          title={t("pax-title")}
          crumbs={[{ label: t("partner-home-title"), href: "/parceiro" }, { label: t("pax-title") }]}
          description={t("pax-description", { firm: data.firm })}
          action={
            <Button variant="contained" onClick={() => setAdding(true)}>
              {t("pax-add")}
            </Button>
          }
        />
      </Grid>

      {data.clauseRead && !data.clause && (
        <Grid size={12}>
          <Alert
            severity="warning"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" onClick={() => setClauseOpen(true)}>
                {data.manager ? t("pax-clause-register") : t("pax-clause-open")}
              </Button>
            }
          >
            <Typography variant="subtitle2" component="p">
              {t("pax-clause-missing-title")}
            </Typography>
            <Typography variant="body2">
              {data.manager ? t("pax-clause-missing-body") : t("pax-clause-missing-member")}
            </Typography>
          </Alert>
        </Grid>
      )}

      {noneAtAll ? (
        <Grid size={12}>
          <EmptyState
            icon={<NiLuggage size="large" />}
            title={t("pax-empty-title")}
            description={t("pax-empty-body")}
            action={{ label: t("pax-add"), onClick: () => setAdding(true) }}
            secondaryAction={{ label: t("pax-import"), href: "/parceiro/passageiros/importar" }}
          />
        </Grid>
      ) : (
        <>
          <Grid size={12} container spacing={2.5}>
            {tiles.map((tile) => (
              <Grid key={tile.filter} size={{ xs: 6, lg: 3 }}>
                <StatTile
                  onClick={() => choose(tile.filter)}
                  pressed={filter === tile.filter}
                  hint={t(FILTER_HINT[tile.filter])}
                  icon={tile.icon}
                  tone={tile.tone}
                  label={t(FILTER_KEY[tile.filter])}
                  value={tile.value ?? "·"}
                />
              </Grid>
            ))}
          </Grid>

          <Grid size={12}>
            <Card component="section" aria-labelledby="pax-list-title">
              <CardContent className="flex flex-col gap-4">
                <Box className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <Box className="flex flex-col">
                    <Typography id="pax-list-title" variant="h5" component="h2" className="mb-0">
                      {t(FILTER_KEY[filter])}
                    </Typography>
                    {overview && (
                      <Typography variant="body2" className="text-text-secondary">
                        {t("pax-watched", { count: overview.watched })}
                      </Typography>
                    )}
                  </Box>
                  <Box className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <TextField
                      size="small"
                      id="pax-search"
                      label={t("pax-search-label")}
                      value={search}
                      className="sm:w-72"
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setOffset(0);
                      }}
                    />
                    <Button variant="outlined" color="grey" href="/parceiro/passageiros/importar" LinkComponent={Link}>
                      {t("pax-import")}
                    </Button>
                  </Box>
                </Box>

                {failed ? (
                  <Alert
                    severity="error"
                    action={
                      <Button color="inherit" size="small" onClick={() => void load({ filter, search, offset })}>
                        {t("pax-retry")}
                      </Button>
                    }
                  >
                    {t("pax-read-error")}
                  </Alert>
                ) : rows.length === 0 ? (
                  <EmptyState
                    titleAs="h3"
                    icon={<NiUsers size="large" />}
                    title={t("pax-empty-filter-title")}
                    description={t("pax-empty-filter-body")}
                    action={{
                      label: t("pax-empty-filter-clear"),
                      onClick: () => {
                        setSearch("");
                        setFilter("all");
                        setOffset(0);
                        void load({ filter: "all", search: "", offset: 0 });
                      },
                    }}
                  />
                ) : (
                  <Box
                    component="ul"
                    aria-label={t("pax-list-label")}
                    aria-busy={loading}
                    className="m-0 flex list-none flex-col gap-3 p-0"
                  >
                    {rows.map((row) => (
                      <PassengerRow key={row.id} row={row} />
                    ))}
                  </Box>
                )}

                {!failed && total > PAX_PAGE_SIZE && (
                  <Box className="flex flex-wrap items-center justify-between gap-3">
                    <Typography variant="body2" className="text-text-secondary">
                      {t("pax-page-range", {
                        from: Math.min(offset + 1, total),
                        to: Math.min(offset + PAX_PAGE_SIZE, total),
                        total,
                      })}
                    </Typography>
                    <Box className="flex gap-2">
                      <Button
                        variant="outlined"
                        color="grey"
                        size="small"
                        disabled={loading || offset === 0}
                        onClick={() => goTo(Math.max(0, offset - PAX_PAGE_SIZE))}
                      >
                        {t("pax-page-previous")}
                      </Button>
                      <Button
                        variant="outlined"
                        color="grey"
                        size="small"
                        disabled={loading || offset + PAX_PAGE_SIZE >= total}
                        onClick={() => goTo(offset + PAX_PAGE_SIZE)}
                      >
                        {t("pax-page-next")}
                      </Button>
                    </Box>
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        </>
      )}

      <Grid size={12}>
        <Button variant="text" color="grey" onClick={() => setClauseOpen(true)}>
          {t("pax-clause-open")}
        </Button>
      </Grid>

      {adding && (
        <NewPassengerDialog
          onClose={() => setAdding(false)}
          onCreated={(travelerId) => {
            setAdding(false);
            router.push(`/parceiro/passageiros/${travelerId}`);
          }}
        />
      )}
      {clauseOpen && (
        <ClauseDialog
          clause={data.clause}
          manager={data.manager}
          onClose={() => setClauseOpen(false)}
          onSaved={() => router.refresh()}
        />
      )}
    </Grid>
  );
}

function PassengerRow({ row }: { row: PaxRow }) {
  const t = useTranslations("product");
  const consent = row.consent ?? "none";
  const details = [
    row.cpf ? t("pax-row-cpf", { cpf: formatCpf(row.cpf) }) : null,
    row.nextDeparture ? t("pax-row-next", { date: localTimeLabel(row.nextDeparture) }) : null,
    row.kinds.length > 0 ? row.kinds.map((kind) => t(DOCUMENT_KIND_KEY[kind])).join(", ") : t("pax-row-no-documents"),
  ].filter(Boolean);
  return (
    <Box component="li">
      <Link
        href={`/parceiro/passageiros/${row.id}`}
        className="border-grey-100 hover:bg-grey-25 flex flex-col gap-2 rounded-2xl border p-4 no-underline transition-colors sm:flex-row sm:items-center"
      >
        <Box className="flex min-w-0 flex-1 flex-col">
          <Typography variant="subtitle2" component="p" className="text-text-primary break-words">
            {row.fullName}
          </Typography>
          <Typography variant="body2" className="text-text-secondary break-words">
            {details.join(" · ")}
          </Typography>
        </Box>
        <Box className="flex flex-wrap gap-1.5">
          {row.minor && <StatusChip label={t("pax-row-minor")} tone="info" />}
          {row.reading && <StatusChip label={t("pax-row-reading")} tone="neutral" />}
          {row.handedOver ? (
            <StatusChip label={t("pax-row-handed-over")} tone="primary" />
          ) : (
            <StatusChip label={t(CONSENT_KEY[consent])} tone={CONSENT_TONE[consent]} />
          )}
        </Box>
      </Link>
    </Box>
  );
}
