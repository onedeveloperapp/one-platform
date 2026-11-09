import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { Button } from "@mui/material";

import { ClientChat } from "@/components/marketing/case-media";
import Cta from "@/components/marketing/cta";
import Faq from "@/components/marketing/faq";
import FeatureRows from "@/components/marketing/feature-row";
import { AutonomyPanel, ModelImportPanel, ModelMark, PortfolioImportPanel } from "@/components/marketing/firm-screens";
import FirmWindow, { type WindowColumn } from "@/components/marketing/firm-window";
import Hero from "@/components/marketing/hero";
import Link from "@/components/marketing/locale-link";
import PhoneFrame from "@/components/marketing/phone-frame";
import PhoneStage from "@/components/marketing/phone-stage";
import ProductComposition from "@/components/marketing/product-composition";
import { EXAMPLE_DEADLINE, EXAMPLE_WINDOW, type ExampleHolder } from "@/components/marketing/product-examples";
import { CalendarFigure, DocumentsFigure, PackageFigure, PieceFigure } from "@/components/marketing/product-figures";
import RuledGrid from "@/components/marketing/ruled-grid";
import { KpiChip, MessageChip } from "@/components/marketing/satellite-chips";
import Showcase from "@/components/marketing/showcase";
import SourceRadar from "@/components/marketing/source-radar";
import StickyCta from "@/components/marketing/sticky-cta";
import type { Tone } from "@/components/marketing/tone";
import TypingLine from "@/components/marketing/typing-line";
import NiAnnouncement from "@/icons/nexture/ni-announcement";
import NiArchive from "@/icons/nexture/ni-archive";
import NiBriefcase from "@/icons/nexture/ni-briefcase";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiFolder from "@/icons/nexture/ni-folder";
import NiFolderCheck from "@/icons/nexture/ni-folder-check";
import NiFolderPlus from "@/icons/nexture/ni-folder-plus";
import NiMessageCheck from "@/icons/nexture/ni-message-check";
import NiPen from "@/icons/nexture/ni-pen";
import NiPulse from "@/icons/nexture/ni-pulse";
import NiRobot from "@/icons/nexture/ni-robot";
import NiScale from "@/icons/nexture/ni-scale";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiSlider from "@/icons/nexture/ni-slider";
import NiUserCheck from "@/icons/nexture/ni-user-check";
import NiUsers from "@/icons/nexture/ni-users";
import { JOURNEY_STEP_KEY } from "@/lib/cases/journey";
import { getLaunchStage, primaryCtaFor } from "@/lib/launch";
import { publicPageMetadata } from "@/lib/seo";
import { formatDayBr } from "@flyee/rules/person";

export async function generateMetadata(): Promise<Metadata> {
  const [locale, t] = await Promise.all([getLocale(), getTranslations("marketing")]);
  return {
    title: { absolute: t("one-home-meta-title") },
    description: t("one-home-meta-description"),
    ...publicPageMetadata({ path: "/", locale }),
  };
}

/** The court systems ONE builds a filing package for, and the national gazette it reads: names, not logos. */
const SYSTEMS = ["Projudi", "eproc", "PJe", "e-SAJ", "DJEN"];

/** Who has a case, in the list's word and with one hue per holder across the window. */
const HOLDERS: Record<ExampleHolder, { key: string; tone: Tone }> = {
  one: { key: "standing-holder-one", tone: "primary" },
  client: { key: "standing-holder-client", tone: "accent-2" },
  firm: { key: "standing-holder-firm", tone: "accent-4" },
  court: { key: "standing-holder-court", tone: "accent-1" },
};

/** When the client of the conversation asked, late at night, and when the firm's number answered: at once. */
const CHAT_TIME = "23:41";
/** When she thanked. */
const CHAT_THANKS_TIME = "23:42";

/**
 * Each decision of the control panel by the product's own name, with the ways the catalog lets a firm choose for it
 * (`autonomy_decisions`: auto, sampled, approval), and the one the example firm chose.
 */
const AUTONOMY_ROWS = [
  {
    key: "autonomy-document-check",
    modes: ["auto", "sampled", "approval"],
    mode: "auto",
  },
  {
    key: "autonomy-reply-client",
    modes: ["auto", "sampled", "approval"],
    mode: "sampled",
  },
  {
    key: "autonomy-deadline-confirm",
    modes: ["auto", "approval"],
    mode: "approval",
  },
  { key: "autonomy-piece-text", modes: ["auto", "approval"], mode: "approval" },
  {
    key: "autonomy-send-signature-papers",
    modes: ["auto", "approval"],
    mode: "auto",
  },
] as const;

/** The lines of the example spreadsheet: lawsuits of a year to come (2099), with their check digits. */
const IMPORT_ROWS = [
  { number: "0001234-67.2099.8.09.0051", kind: "open" },
  { number: "0004567-27.2099.8.09.0051", kind: "open" },
  { number: "0007890-40.2099.8.09.0051", kind: "known" },
  { number: "0012345-48.2099.8.09.0051", kind: "open" },
  { number: "0023456-00.2099.8.09.0051", kind: "unread" },
] as const;

/**
 * The public home of ONE: a sales page in the structure, the mechanics and the visual effect of the analysed model of a
 * legal software's page (the conversion-pages app's `juridiq-pagina-de-vendas`), in ONE's own brand, words and data
 * (docs/DESIGN.md, "Reference blueprint"; the plan is docs/paginas/home/plano.md). Each chapter is an object recognized
 * before a word is read, with little beside it: the whole system's window on the deep top; a phone with the client's
 * question answered on the firm's WhatsApp; a radar over the lawsuits; two photos of a client's papers, a sheet of a
 * petition, the calendar of a deadline and a folder for the court; the switches of what the firm lets ONE decide alone,
 * on the deep band; a document made a model and a spreadsheet brought in; the firm's questions (the one place the first
 * module is named); the closing call. It sells ONE's core, the AI automation of a mass-litigation firm's cases, never one
 * of its applications. Every figure carries invented data and says so; nothing here is a metric, a client's logo, a
 * testimonial, a price or a promotion, because there is none yet. The primary action follows the launch stage, as the
 * header's does.
 */
export default async function Home() {
  const [t, p, d, stage] = await Promise.all([
    getTranslations("marketing"),
    getTranslations("product"),
    getTranslations("dashboard"),
    getLaunchStage(),
  ]);
  const action = primaryCtaFor(stage);
  const primary = { label: t(action.labelKey), href: action.href };
  const contact = { label: t("one-home-cta-contact"), href: "/contato" };
  const waitlist = stage === "waitlist";
  const sample = t("one-home-sample");
  // The day the example's deadline ends, as the rule counted it: "27/11".
  const dueDay = EXAMPLE_DEADLINE.ok ? (formatDayBr(EXAMPLE_DEADLINE.result.dueOn) ?? "").slice(0, 5) : "";

  const faq = [1, 2, 3, 4, 5, 6, 7, 8, ...(waitlist ? [9] : [])].map((n) => ({
    id: String(n),
    question: t(`one-home-faq-${n}-question`),
    answer: t(`one-home-faq-${n}-answer`),
  }));

  // The board of the window, in the product's own words: the steps of the way and who has each case.
  const columns: WindowColumn[] = EXAMPLE_WINDOW.columns.map((column) => ({
    key: column.step,
    label: p(JOURNEY_STEP_KEY[column.step]),
    total: String(column.total),
    cases: column.cases.map((item) => ({
      seq: item.seq,
      client: item.client,
      days: p("cases-step-days", { count: item.days }),
      holder: p(HOLDERS[item.holder].key),
      holderTone: HOLDERS[item.holder].tone,
    })),
  }));

  const modeWords: Record<"auto" | "sampled" | "approval", string> = {
    auto: t("one-home-autonomy-mode-auto"),
    sampled: t("one-home-autonomy-mode-sampled"),
    approval: t("one-home-autonomy-mode-person"),
  };

  return (
    <>
      <Hero
        tone="deep"
        track="hero"
        badge={{ label: t("one-home-badge") }}
        title={t.rich("one-home-title", { em: (chunks) => <em>{chunks}</em> })}
        subtitle={t("one-home-subtitle")}
        primaryCta={primary}
        secondaryCta={contact}
        note={waitlist ? t("one-home-note-waitlist") : undefined}
        strip={{ label: t("one-home-systems-label"), items: SYSTEMS }}
        media={
          <ProductComposition
            frame={
              <FirmWindow
                label={t("one-home-window-label")}
                sample={sample}
                search={d("search-placeholder")}
                add={p("add-label")}
                numbers={[
                  {
                    icon: <NiFolder size="small" />,
                    tone: "primary",
                    label: p("cases-number-going"),
                    value: EXAMPLE_WINDOW.going.toLocaleString("pt-BR"),
                    delta: EXAMPLE_WINDOW.goingDelta,
                  },
                  {
                    icon: <NiFolderPlus size="small" />,
                    tone: "accent-2",
                    label: p("cases-number-opened"),
                    value: String(EXAMPLE_WINDOW.opened),
                  },
                  {
                    icon: <NiScale size="small" />,
                    tone: "accent-4",
                    label: p("cases-number-filed"),
                    value: String(EXAMPLE_WINDOW.filed),
                  },
                  {
                    icon: <NiArchive size="small" />,
                    tone: "accent-1",
                    label: p("cases-number-archived"),
                    value: String(EXAMPLE_WINDOW.archived),
                  },
                ]}
                boardTitle={p("controladoria-board-title")}
                columns={columns}
                pendingTitle={p("pending-title")}
                pending={[
                  {
                    title: p("pending-group-today"),
                    items: [
                      {
                        icon: <NiCalendar size="tiny" />,
                        tone: "accent-1",
                        text: t("one-home-window-pending-hearing"),
                      },
                      {
                        icon: <NiCalendarClock size="tiny" />,
                        tone: "accent-1",
                        text: t("one-home-window-pending-deadline", {
                          day: dueDay,
                        }),
                      },
                    ],
                  },
                  {
                    title: p("pending-group-one"),
                    items: [
                      {
                        icon: <NiDocumentFull size="tiny" />,
                        tone: "primary",
                        text: t("one-home-window-pending-piece"),
                      },
                      {
                        icon: <NiScale size="tiny" />,
                        tone: "accent-4",
                        text: t("one-home-window-pending-filing"),
                      },
                    ],
                  },
                ]}
              />
            }
            satellites={[
              {
                position: "top-right",
                float: true,
                children: (
                  <MessageChip
                    author={t("one-home-window-now-author")}
                    text={t("one-home-window-now-text", {
                      seq: EXAMPLE_WINDOW.writing,
                    })}
                    icon={<NiRobot size="small" />}
                    tone="primary"
                  />
                ),
              },
              {
                position: "bottom-left",
                float: true,
                floatDelay: 1.2,
                children: (
                  <KpiChip
                    label={t("one-home-window-deadline-label")}
                    value={dueDay}
                    delta={t("one-home-window-deadline-delta")}
                    tone="accent-1"
                  />
                ),
              },
            ]}
          />
        }
      />

      <PhoneStage
        track="client"
        eyebrow={t("one-home-pain-eyebrow")}
        title={t("one-home-pain-title")}
        subtitle={t("one-home-pain-subtitle")}
        caption={sample}
        phone={
          <div role="img" aria-label={t("one-home-chat-label")} data-figura="telefone-conversa">
            <PhoneFrame time={CHAT_TIME} className="max-w-80">
              <ClientChat
                firm={t("one-home-chat-firm")}
                status={t("one-home-chat-status")}
                inputLabel={t("one-home-chat-input")}
                messages={[
                  {
                    from: "client",
                    text: t("one-home-chat-1"),
                    time: CHAT_TIME,
                  },
                  { from: "firm", text: t("one-home-chat-2"), time: CHAT_TIME },
                  { from: "firm", text: t("one-home-chat-3"), time: CHAT_TIME },
                  {
                    from: "client",
                    text: t("one-home-chat-4"),
                    time: CHAT_THANKS_TIME,
                  },
                ]}
              />
            </PhoneFrame>
          </div>
        }
        left={[
          {
            icon: <NiMessageCheck />,
            tone: "accent-2",
            title: t("one-home-pain-1-title"),
            body: t("one-home-pain-1-body"),
          },
          {
            icon: <NiBriefcase />,
            tone: "secondary",
            title: t("one-home-pain-2-title"),
            body: t("one-home-pain-2-body"),
          },
        ]}
        right={[
          {
            icon: <NiUsers />,
            tone: "accent-4",
            title: t("one-home-pain-3-title"),
            body: t("one-home-pain-3-body"),
          },
          {
            icon: <NiUserCheck />,
            tone: "accent-1",
            title: t("one-home-pain-4-title"),
            body: t("one-home-pain-4-body"),
          },
        ]}
      />

      <Showcase
        track="follow"
        background="paper"
        mediaSide="start"
        eyebrow={t("one-home-follow-eyebrow")}
        eyebrowTone="accent-4"
        title={t("one-home-follow-title")}
        subtitle={t("one-home-follow-subtitle")}
        chips={[
          {
            icon: <NiAnnouncement size="small" />,
            tone: "accent-4",
            label: t("one-home-follow-source-1"),
          },
          {
            icon: <NiPulse size="small" />,
            tone: "accent-4",
            label: t("one-home-follow-source-2"),
          },
          {
            icon: <NiCalendarClock size="small" />,
            tone: "accent-1",
            label: t("one-home-follow-source-3"),
          },
          {
            icon: <NiCalendar size="small" />,
            tone: "accent-4",
            label: t("one-home-follow-source-4"),
          },
          {
            icon: <NiMessageCheck size="small" />,
            tone: "accent-2",
            label: t("one-home-follow-source-5"),
          },
        ]}
        media={
          <div data-figura="radar-processos">
            <SourceRadar
              label={t("one-home-radar-label")}
              sample={sample}
              pauseLabel={t("one-home-autoplay-pause")}
              playLabel={t("one-home-autoplay-play")}
              gotoLabels={[1, 2, 3, 4, 5].map((n) => t("one-home-radar-goto", { n }))}
              items={[
                {
                  icon: <NiAnnouncement size="small" />,
                  tone: "accent-4",
                  n: 1,
                },
                {
                  icon: <NiCalendarClock size="small" />,
                  tone: "accent-1",
                  n: 2,
                },
                { icon: <NiPulse size="small" />, tone: "accent-4", n: 3 },
                {
                  icon: <NiDocumentCheck size="small" />,
                  tone: "accent-4",
                  n: 4,
                },
                {
                  icon: <NiShieldCheck size="small" />,
                  tone: "accent-2",
                  n: 5,
                },
              ].map(({ icon, tone, n }) => ({
                icon,
                tone: tone as "accent-1" | "accent-2" | "accent-4",
                source: t(`one-home-radar-${n}-source`),
                title: t(`one-home-radar-${n}-title`),
                detail: t(`one-home-radar-${n}-detail`),
                action: t(`one-home-radar-${n}-action`),
              }))}
            />
          </div>
        }
      />

      <FeatureRows
        track="case"
        title={t("one-home-work-title")}
        subtitle={t("one-home-work-subtitle")}
        start="media"
        items={[
          {
            title: t("one-home-docs-title"),
            body: t("one-home-docs-body"),
            caption: sample,
            media: <DocumentsFigure label={t("one-home-docs-label")} />,
          },
          {
            title: t("one-home-piece-title"),
            body: t("one-home-piece-body"),
            caption: sample,
            media: (
              <PieceFigure
                label={t("one-home-piece-label")}
                heading={t("one-home-piece-heading")}
                badge={t("one-home-piece-badge")}
                gap={t("one-home-piece-gap")}
                sourcesTitle={t("one-home-piece-sources")}
                sources={[t("one-home-piece-source-1"), t("one-home-piece-source-2"), t("one-home-piece-source-3")]}
                sourceState={t("one-home-piece-source-state")}
              />
            ),
          },
          {
            title: t("one-home-deadline-title"),
            body: t("one-home-deadline-body"),
            caption: sample,
            media: (
              <CalendarFigure
                label={t("one-home-deadline-label")}
                published={t("one-home-deadline-legend-published")}
                counted={t("one-home-deadline-legend-counted")}
                holiday={t("one-home-deadline-legend-holiday")}
              />
            ),
          },
          {
            title: t("one-home-package-title"),
            body: t("one-home-package-body"),
            caption: sample,
            media: <PackageFigure label={t("one-home-package-label")} />,
          },
        ]}
      >
        {/* What is smaller closes the chapter in three short cards, the action under them. */}
        <div className="flex flex-col items-center gap-10">
          <div className="w-full">
            <RuledGrid
              variant="cards"
              items={[
                {
                  icon: <NiPen />,
                  tone: "accent-1",
                  title: t("one-home-more-signature-title"),
                  body: t("one-home-more-signature-body"),
                },
                {
                  icon: <NiFolderCheck />,
                  tone: "secondary",
                  title: t("one-home-more-dossier-title"),
                  body: t("one-home-more-dossier-body"),
                },
                {
                  icon: <NiCalendar />,
                  tone: "accent-4",
                  title: t("one-home-more-hearing-title"),
                  body: t("one-home-more-hearing-body"),
                },
              ]}
            />
          </div>
          <Button
            size="large"
            variant="contained"
            color="primary"
            href={primary.href}
            LinkComponent={Link}
            data-track="cta_click"
            data-track-cta-id="case_primary"
          >
            {primary.label}
          </Button>
        </div>
      </FeatureRows>

      <Showcase
        track="control"
        background="deep"
        eyebrow={t("one-home-control-eyebrow")}
        title={t("one-home-control-title")}
        subtitle={t("one-home-control-subtitle")}
        bullets={[t("one-home-control-point-1"), t("one-home-control-point-2")]}
        actions={{ primary, secondary: contact }}
        caption={sample}
        media={
          <div data-figura="painel-autonomia" className="flex flex-col gap-4">
            <TypingLine
              label={t("one-home-typing-label")}
              listLabel={t("one-home-typing-list")}
              icon={<NiRobot size="medium" />}
              phrases={[1, 2, 3, 4, 5].map((n) => t(`one-home-typing-${n}`))}
              pauseLabel={t("one-home-autoplay-pause")}
              playLabel={t("one-home-autoplay-play")}
            />
            <AutonomyPanel
              title={p("autonomy-title")}
              icon={<NiSlider size="small" />}
              rows={AUTONOMY_ROWS.map((row) => ({
                label: p(row.key),
                modes: row.modes.map((mode) => modeWords[mode]),
                mode: (row.modes as readonly string[]).indexOf(row.mode),
              }))}
              footer={t("one-home-autonomy-footer")}
            />
          </div>
        }
      />

      <FeatureRows
        track="arrive"
        title={t("one-home-arrive-title")}
        subtitle={t("one-home-arrive-subtitle")}
        items={[
          {
            title: t("one-home-models-title"),
            body: t("one-home-models-body"),
            tone: "secondary",
            caption: sample,
            media: (
              <div data-figura="modelo-do-escritorio">
                <ModelImportPanel
                  fileName={t("one-home-models-file")}
                  fileMeta={t("one-home-models-file-meta")}
                  step={t("one-home-models-step")}
                  modelTitle={t("one-home-models-model")}
                  modelBadge={t("one-home-models-badge")}
                  text={t.rich("one-home-models-text", {
                    m: (chunks) => <ModelMark>{chunks}</ModelMark>,
                  })}
                  mayErr={t("one-home-may-err")}
                />
              </div>
            ),
          },
          {
            title: t("one-home-import-title"),
            body: t("one-home-import-body"),
            tone: "accent-4",
            cta: { ...primary, variant: "primary" },
            caption: sample,
            media: (
              <div data-figura="planilha-carteira">
                <PortfolioImportPanel
                  fileName={t("one-home-import-file")}
                  fileMeta={t("one-home-import-file-meta")}
                  columns={[
                    t("one-home-import-col-number"),
                    t("one-home-import-col-client"),
                    t("one-home-import-col-result"),
                  ]}
                  rows={IMPORT_ROWS.map((row, index) => ({
                    number: row.number,
                    kind: row.kind,
                    client: t(`one-home-import-client-${index + 1}`),
                    result: t(`one-home-import-${row.kind}`),
                  }))}
                  summary={[
                    { label: t("one-home-import-summary-open"), kind: "open" },
                    {
                      label: t("one-home-import-summary-known"),
                      kind: "known",
                    },
                    {
                      label: t("one-home-import-summary-unread"),
                      kind: "unread",
                    },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />

      <Faq
        layout="aside"
        track="faq"
        title={t("one-home-faq-title")}
        subtitle={t("one-home-faq-subtitle")}
        items={faq}
        aside={{
          title: t("one-home-faq-aside-title"),
          body: t("one-home-faq-aside-body"),
          cta: contact,
        }}
      />

      <Cta
        variant="deep-panel"
        track="final"
        title={t(waitlist ? "one-home-final-title-waitlist" : "one-home-final-title-open")}
        subtitle={t(waitlist ? "one-home-final-subtitle-waitlist" : "one-home-final-subtitle-open")}
        cta={primary}
        secondaryCta={contact}
      />

      <StickyCta label={primary.label} href={primary.href} />
    </>
  );
}
