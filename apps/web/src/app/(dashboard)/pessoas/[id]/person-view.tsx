"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, MenuItem, TextField, Typography } from "@mui/material";

import { useViewer } from "@/components/layout/viewer-context";
import { PersonModuleSections } from "@/components/people/module-people";
import CardTitle from "@/components/product/card-title";
import PageHeader from "@/components/product/page-header";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiFolder from "@/icons/nexture/ni-folder";
import NiMessages from "@/icons/nexture/ni-messages";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiUser from "@/icons/nexture/ni-user";
import { caseLabel, DOCUMENT_KIND_KEY, STATUS_KEY } from "@/lib/cases/cases";
import { caseKindLabelKey } from "@/lib/modules/registry";
import { KIND_KEY as NOTICE_KIND_KEY } from "@/lib/notices/notices";
import { erasePerson, exportPersonData, setPersonMarketing } from "@/lib/people/actions";
import { ASKED_HOW, ASKED_KEY, type AskedHow } from "@/lib/people/people";
import type { PersonPage } from "@/lib/people/read";
import { formatCpf } from "@flyee/fields";
import { formatDayBr } from "@flyee/rules/person";

export type PersonState =
  | { kind: "ready"; id: string; page: PersonPage; factor: "ok" | "challenge" | "missing" }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

const ERROR_KEY: Record<string, string> = {
  not_allowed: "person-error-not-allowed",
  support_visit: "person-error-support",
  second_factor: "person-error-second-factor",
  open_lawsuit: "person-error-open-lawsuit",
  // 0139: a part of a release the firm still owes the person.
  money_owed: "person-error-money-owed",
  invalid_data: "person-error-invalid",
};
const errorKey = (code: string) => ERROR_KEY[code] ?? "person-error-failed";
const howKey = (how: string | null): string => ASKED_KEY[(how ?? "outro") as AskedHow | "link"] ?? "people-how-other";
const requestKey = (request: { status: string; kind: string }) =>
  request.status === "refused"
    ? "person-request-refused"
    : request.kind === "erase"
      ? "person-request-erased"
      : "person-request-exported";
const DATA_KEY = {
  export: {
    title: "person-rights-export",
    body: "person-export-body",
    button: "person-export-download",
    done: "person-export-done",
  },
  erase: {
    title: "person-rights-erase",
    body: "person-erase-body",
    button: "person-erase-confirm",
    done: "person-erase-done",
  },
} as const;
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
const day = (moment: string | null) => (moment ? (formatDayBr(moment.slice(0, 10)) ?? moment.slice(0, 10)) : null);

/**
 * The page of a person of the firm (phase 9): who they are, their cases, lawsuits, documents, conversations and
 * notices, one place to answer when they call; their word on marketing; and, for who decides for the firm, their data
 * exported or erased at their request. A person's data are changed on their case, where they are read and checked.
 */
export default function PersonView({ state }: { state: PersonState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const viewer = useViewer();
  const [marketing, setMarketing] = useState(false);
  const [data, setData] = useState<"export" | "erase" | null>(null);

  if (state.kind !== "ready") {
    const failedKey = state.kind === "error" ? "people-load-error" : "settings-unavailable";
    return (
      <Box className="flex flex-col gap-6">
        <PageHeader
          title={t("people-title")}
          crumbs={[
            { label: t("approvals-home"), href: "/inicio" },
            { label: t("people-title"), href: "/pessoas" },
          ]}
        />
        <Alert severity={state.kind === "error" ? "error" : "info"} className="neutral bg-background-paper/60!">
          {t(failedKey)}
        </Alert>
      </Box>
    );
  }
  const { page } = state;
  const person = page.person;
  const name = text(person.full_name) ?? "";
  const cpf = text(person.cpf);
  const address = [text(person.street), text(person.address_number), text(person.complement), text(person.district)]
    .filter(Boolean)
    .join(", ");
  const place = [text(person.city), text(person.uf)].filter(Boolean).join("/");
  const marketingOff = text(person.marketing_off_at);
  const marketingHow = text(person.marketing_off_how) as AskedHow | "link" | null;
  const erased = text(person.erased_at);
  const latestCase = page.cases[0] ?? null;

  const facts: { label: string; value: string | null }[] = [
    { label: t("person-field-cpf"), value: cpf ? formatCpf(cpf) : null },
    { label: t("person-field-birth"), value: day(text(person.birth_date)) },
    { label: t("person-field-phone"), value: text(person.phone) },
    { label: t("person-field-email"), value: text(person.email) },
    { label: t("person-field-address"), value: [address, place].filter(Boolean).join(" · ") || null },
    { label: t("person-field-profession"), value: text(person.profession) },
  ];

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={name}
        crumbs={[
          { label: t("approvals-home"), href: "/inicio" },
          { label: t("people-title"), href: "/pessoas" },
          { label: name },
        ]}
        chip={
          erased ? (
            <StatusChip tone="neutral" label={t("people-chip-erased")} />
          ) : page.minor ? (
            <StatusChip tone="info" label={t("people-chip-minor")} />
          ) : (
            <StatusChip
              tone={page.active ? "positive" : "neutral"}
              label={t(page.active ? "people-chip-active" : "people-chip-inactive")}
            />
          )
        }
      />

      <Card component="section" aria-labelledby="person-data">
        <CardContent className="flex flex-col gap-4">
          <CardTitle
            id="person-data"
            icon={<NiUser size="medium" />}
            title={t("person-data-title")}
            description={t("person-data-description")}
            actions={
              latestCase ? (
                <Button size="small" variant="text" href={`/casos/${latestCase.id}#pessoas`} LinkComponent={Link}>
                  {t("person-data-edit")}
                </Button>
              ) : undefined
            }
          />
          {erased ? <StateLine tone="info">{t("person-erased", { day: day(erased) ?? "" })}</StateLine> : null}
          <Box component="dl" className="m-0 grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {facts.map((fact) => (
              <Box key={fact.label} className="flex min-w-0 flex-col">
                <Typography component="dt" variant="caption" className="text-text-secondary">
                  {fact.label}
                </Typography>
                <Typography component="dd" variant="body2" className="m-0 break-words">
                  {fact.value ?? t("person-field-none")}
                </Typography>
              </Box>
            ))}
          </Box>
          <StateLine
            tone={marketingOff ? "info" : "done"}
            action={
              page.may.marketing && !erased ? (
                <Button size="small" variant="text" onClick={() => setMarketing(true)}>
                  {t(marketingOff ? "person-marketing-on" : "person-marketing-off")}
                </Button>
              ) : undefined
            }
          >
            {marketingOff
              ? t("person-marketing-off-since", {
                  day: day(marketingOff) ?? "",
                  how: t(howKey(marketingHow)),
                })
              : t("person-marketing-receives")}
          </StateLine>
        </CardContent>
      </Card>

      <Card component="section" aria-labelledby="person-cases">
        <CardContent className="flex flex-col gap-3">
          <CardTitle id="person-cases" icon={<NiFolder size="medium" />} title={t("person-cases-title")} />
          {page.cases.length === 0 ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("person-cases-none")}
            </Typography>
          ) : (
            <Box component="ul" className="m-0 flex list-none flex-col p-0">
              {page.cases.map((item) => (
                <Box component="li" key={item.id} className="border-grey-100 border-b py-2 last:border-b-0">
                  <Link href={`/casos/${item.id}`} className="flex items-center gap-3 no-underline">
                    <Box className="flex min-w-0 flex-1 flex-col">
                      <Typography variant="body1" className="text-text-primary font-semibold">
                        {[
                          caseLabel(item.seq),
                          item.incident ? t(caseKindLabelKey(item.incident) ?? "case-incident-other") : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary">
                        {[
                          item.roles.includes("guardian") ? t("person-role-guardian") : t("person-role-claimant"),
                          day(item.createdAt),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Typography>
                    </Box>
                    {item.isTest ? <StatusChip tone="neutral" label={t("agenda-entry-test")} /> : null}
                    <StatusChip
                      tone="neutral"
                      label={t(STATUS_KEY[item.status as keyof typeof STATUS_KEY] ?? "case-status-intake")}
                    />
                  </Link>
                </Box>
              ))}
            </Box>
          )}
          {page.lawsuits.length > 0 ? (
            <Box className="flex flex-col gap-1">
              <Typography variant="subtitle2" component="h3">
                {t("person-lawsuits-title")}
              </Typography>
              {page.lawsuits.map((lawsuit) => (
                <Typography key={lawsuit.id} variant="body2">
                  {[lawsuit.cnj ?? t("person-lawsuit-planned"), lawsuit.court, caseLabel(lawsuit.caseSeq)].join(" · ")}
                </Typography>
              ))}
            </Box>
          ) : null}
        </CardContent>
      </Card>

      {erased ? null : <PersonModuleSections modules={viewer?.modules} personId={state.id} personName={name} />}

      <Box className="grid gap-6 lg:grid-cols-2">
        <Card component="section" aria-labelledby="person-documents">
          <CardContent className="flex flex-col gap-3">
            <CardTitle
              id="person-documents"
              icon={<NiDocumentFull size="medium" />}
              title={t("person-documents-title")}
            />
            {page.documents.length === 0 ? (
              <Typography variant="body2" className="text-text-secondary">
                {t("person-documents-none")}
              </Typography>
            ) : (
              page.documents.map((document) => (
                <StateLine
                  key={document.id}
                  tone={document.status === "accepted" ? "done" : document.status === "rejected" ? "info" : "waiting"}
                >
                  {[
                    t(DOCUMENT_KIND_KEY[document.kind as keyof typeof DOCUMENT_KIND_KEY] ?? "case-incident-other"),
                    caseLabel(document.caseSeq),
                    day(document.createdAt),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </StateLine>
              ))
            )}
          </CardContent>
        </Card>

        <Card component="section" aria-labelledby="person-conversations">
          <CardContent className="flex flex-col gap-3">
            <CardTitle
              id="person-conversations"
              icon={<NiMessages size="medium" />}
              title={t("person-conversations-title")}
            />
            {page.conversations.length === 0 ? (
              <Typography variant="body2" className="text-text-secondary">
                {t("person-conversations-none")}
              </Typography>
            ) : (
              page.conversations.map((conversation) => (
                <Link
                  key={conversation.id}
                  href={`/atendimento?c=${conversation.id}`}
                  className="flex flex-col no-underline"
                >
                  <Typography variant="body1" className="text-text-primary font-semibold">
                    {conversation.name ?? conversation.number}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary line-clamp-1">
                    {[day(conversation.lastMessageAt), conversation.preview].filter(Boolean).join(" · ")}
                  </Typography>
                </Link>
              ))
            )}
            {page.notices.length > 0 ? (
              <Box className="flex flex-col gap-1">
                <Typography variant="subtitle2" component="h3">
                  {t("person-notices-title")}
                </Typography>
                {page.notices.map((notice, index) => (
                  <Typography
                    key={`${notice.kind}:${notice.at}:${index}`}
                    variant="body2"
                    className="text-text-secondary"
                  >
                    {[
                      NOTICE_KIND_KEY[notice.kind as keyof typeof NOTICE_KIND_KEY]
                        ? t(NOTICE_KIND_KEY[notice.kind as keyof typeof NOTICE_KIND_KEY].label)
                        : notice.kind,
                      day(notice.at),
                    ].join(" · ")}
                  </Typography>
                ))}
              </Box>
            ) : null}
          </CardContent>
        </Card>
      </Box>

      {page.may.data ? (
        <Card component="section" aria-labelledby="person-rights">
          <CardContent className="flex flex-col gap-3">
            <CardTitle
              id="person-rights"
              icon={<NiShieldCheck size="medium" />}
              title={t("person-rights-title")}
              description={t("person-rights-description")}
            />
            <Box className="flex flex-wrap gap-2">
              <Button variant="outlined" color="grey" onClick={() => setData("export")}>
                {t("person-rights-export")}
              </Button>
              {!erased ? (
                <Button variant="outlined" color="grey" onClick={() => setData("erase")}>
                  {t("person-rights-erase")}
                </Button>
              ) : null}
            </Box>
            {page.requests.map((request) => (
              <StateLine key={request.id} tone={request.status === "done" ? "done" : "info"}>
                {t(requestKey(request), {
                  day: day(request.requestedAt) ?? "",
                  how: t(howKey(request.how)),
                })}
              </StateLine>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {marketing ? (
        <MarketingPanel
          personId={state.id}
          off={!marketingOff}
          onClose={() => setMarketing(false)}
          onDone={() => {
            setMarketing(false);
            router.refresh();
          }}
        />
      ) : null}
      {data ? (
        <DataPanel
          personId={state.id}
          name={name}
          kind={data}
          factor={state.factor}
          onClose={() => setData(null)}
          onDone={() => router.refresh()}
        />
      ) : null}
    </Box>
  );
}

/** "Não quer receber marketing", recorded with how the person asked; or receiving it again. */
function MarketingPanel({
  personId,
  off,
  onClose,
  onDone,
}: {
  personId: string;
  off: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("product");
  const [how, setHow] = useState<AskedHow>("telefone");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await setPersonMarketing(personId, off, off ? how : null);
      if (result.ok) onDone();
      else setProblem(t(errorKey(result.code)));
    } catch {
      setProblem(t("person-error-failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("segments-cancel")}
      icon={<NiUser size="medium" />}
      busy={busy}
      title={t(off ? "person-marketing-off" : "person-marketing-on")}
      description={t(off ? "person-marketing-off-body" : "person-marketing-on-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
            {t("segments-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("segments-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-4">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {problem}
          </Alert>
        ) : null}
        {off ? (
          <TextField
            select
            label={t("person-asked-how")}
            value={how}
            onChange={(event) => setHow(event.target.value as AskedHow)}
          >
            {ASKED_HOW.map((item) => (
              <MenuItem key={item} value={item}>
                {t(ASKED_KEY[item])}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        <StateLine tone="info">{t("person-marketing-notices-stay")}</StateLine>
      </Box>
    </SidePanel>
  );
}

/** A person's data exported, or erased at their request: who decides for the firm, with the second factor. */
function DataPanel({
  personId,
  name,
  kind,
  factor,
  onClose,
  onDone,
}: {
  personId: string;
  name: string;
  kind: "export" | "erase";
  factor: "ok" | "challenge" | "missing";
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("product");
  const [how, setHow] = useState<AskedHow | "link">("email");
  const [confirmed, setConfirmed] = useState(factor === "ok");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const run = async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (kind === "export") {
        const result = await exportPersonData(personId, how);
        if (!result.ok) return setProblem(t(errorKey(result.code)));
        const blob = new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "") || "pessoa"}-dados.json`;
        link.click();
        URL.revokeObjectURL(url);
      } else {
        const result = await erasePerson(personId, how);
        if (!result.ok) return setProblem(t(errorKey(result.code)));
      }
      setDone(true);
      onDone();
    } catch {
      setProblem(t("person-error-failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("segments-cancel")}
      icon={<NiShieldCheck size="medium" />}
      busy={busy}
      title={t(DATA_KEY[kind].title)}
      description={t(DATA_KEY[kind].body)}
      onSubmit={() => void run()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || !confirmed || done}>
            {t(DATA_KEY[kind].button)}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t(done ? "agenda-close" : "segments-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-4">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {problem}
          </Alert>
        ) : null}
        {done ? <StateLine tone="done">{t(DATA_KEY[kind].done)}</StateLine> : null}
        <TextField
          select
          label={t("person-asked-how")}
          value={how}
          onChange={(event) => setHow(event.target.value as AskedHow | "link")}
        >
          {(["link", ...ASKED_HOW] as const).map((item) => (
            <MenuItem key={item} value={item}>
              {t(ASKED_KEY[item])}
            </MenuItem>
          ))}
        </TextField>
        {kind === "erase" ? (
          <>
            <StateLine tone="attention">{t("person-erase-goes")}</StateLine>
            <StateLine tone="info">{t("person-erase-stays")}</StateLine>
          </>
        ) : null}
        {!confirmed ? (
          <SecondFactorPrompt
            state={factor === "missing" ? "missing" : "challenge"}
            onConfirmed={() => setConfirmed(true)}
          />
        ) : null}
      </Box>
    </SidePanel>
  );
}
