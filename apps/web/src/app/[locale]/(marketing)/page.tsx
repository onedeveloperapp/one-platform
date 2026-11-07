import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { CaseStageChart, ClientChat, ClientLinkPanel } from "@/components/marketing/case-media";
import Cta from "@/components/marketing/cta";
import Faq from "@/components/marketing/faq";
import FeatureGrid from "@/components/marketing/feature-grid";
import FeatureRows from "@/components/marketing/feature-row";
import {
  AutonomyPanel,
  CaseScreen,
  DeadlineCalendar,
  ModelImportPanel,
  ModelMark,
  PortfolioImportPanel,
} from "@/components/marketing/firm-screens";
import Hero from "@/components/marketing/hero";
import PhoneFrame from "@/components/marketing/phone-frame";
import ProductComposition from "@/components/marketing/product-composition";
import ProductFrame from "@/components/marketing/product-frame";
import { KpiChip, MessageChip, RingChip } from "@/components/marketing/satellite-chips";
import Showcase from "@/components/marketing/showcase";
import SourceRadar from "@/components/marketing/source-radar";
import StickyCta from "@/components/marketing/sticky-cta";
import TypingLine from "@/components/marketing/typing-line";
import NiAnnouncement from "@/icons/nexture/ni-announcement";
import NiBook from "@/icons/nexture/ni-book";
import NiBriefcase from "@/icons/nexture/ni-briefcase";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiFolderCheck from "@/icons/nexture/ni-folder-check";
import NiHome from "@/icons/nexture/ni-home";
import NiMessageCheck from "@/icons/nexture/ni-message-check";
import NiMessages from "@/icons/nexture/ni-messages";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPaperclip from "@/icons/nexture/ni-paperclip";
import NiPen from "@/icons/nexture/ni-pen";
import NiPulse from "@/icons/nexture/ni-pulse";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiSparkle from "@/icons/nexture/ni-sparkle";
import NiUser from "@/icons/nexture/ni-user";
import NiUserCheck from "@/icons/nexture/ni-user-check";
import NiUsers from "@/icons/nexture/ni-users";
import { getLaunchStage, primaryCtaFor } from "@/lib/launch";
import { publicPageMetadata } from "@/lib/seo";

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

/** The cases of the example board, by stage, and the pieces of its week (illustrative data). */
const STAGES = [14, 22, 9, 17, 24];
const PIECES = { approved: 7, review: 3, writing: 2 };

/**
 * The example deadline: made available on the DJEN on Wed 4 Nov 2026,
 * published on Thu 5, counted from Fri 6 in business days (CPC, art. 224;
 * Resolução CNJ 455/2022), the holiday of 20 Nov left out: fifteen business
 * days end on Fri 27 Nov. November 2026 starts on a Sunday.
 */
const DEADLINE_MARKS = {
  4: "available",
  5: "published",
  ...Object.fromEntries([6, 9, 10, 11, 12, 13, 16, 17, 18, 19, 23, 24, 25, 26].map((day) => [day, "counted"])),
  20: "holiday",
  27: "last",
} as const;

/** The lines of the example spreadsheet: lawsuits of a year to come (2099), with their check digits. */
const IMPORT_ROWS = [
  { number: "0001234-67.2099.8.09.0051", kind: "open" },
  { number: "0004567-27.2099.8.09.0051", kind: "open" },
  { number: "0007890-40.2099.8.09.0051", kind: "known" },
  { number: "0012345-48.2099.8.09.0051", kind: "open" },
  { number: "0023456-00.2099.8.09.0051", kind: "unread" },
] as const;

/**
 * The public home of ONE: a sales page in the structure, the mechanics and the
 * visual effect of the analysed model of a legal software's page (the
 * conversion-pages app's `juridiq-pagina-de-vendas`, 2026-11-07), in ONE's
 * own brand, words and screens (docs/DESIGN.md, "Reference blueprint"; the
 * plan is docs/paginas/home/plano.md). It sells ONE's core, the AI automation
 * of a mass-litigation firm's cases, never one of its applications: the deep
 * top with the case as the firm follows it; the client's question answered on
 * the firm's WhatsApp; what ONE follows after the filing; the day to day of a
 * case; what the firm lets ONE decide alone, on the deep band; how a firm
 * arrives without starting over; the firm's questions (the one place the
 * first module is named); the closing call. The screens are drawn with tokens
 * and say they carry example data; nothing here is a metric, a client's logo,
 * a testimonial, a price or a promotion, because there is none yet. The
 * primary action follows the launch stage, as the header's does.
 */
export default async function Home() {
  const [t, stage] = await Promise.all([getTranslations("marketing"), getLaunchStage()]);
  const action = primaryCtaFor(stage);
  const primary = { label: t(action.labelKey), href: action.href };
  const contact = { label: t("one-home-cta-contact"), href: "/contato" };
  const waitlist = stage === "waitlist";
  const sample = t("one-home-sample");

  const faq = [1, 2, 3, 4, 5, 6, 7, 8, ...(waitlist ? [9] : [])].map((n) => ({
    id: String(n),
    question: t(`one-home-faq-${n}-question`),
    answer: t(`one-home-faq-${n}-answer`),
  }));

  return (
    <>
      <Hero
        tone="deep"
        track="hero"
        badge={{ label: t("one-home-badge"), icon: <NiSparkle size="small" /> }}
        title={t.rich("one-home-title", { em: (chunks) => <em>{chunks}</em> })}
        subtitle={t("one-home-subtitle")}
        primaryCta={primary}
        secondaryCta={contact}
        note={waitlist ? t("one-home-note-waitlist") : undefined}
        strip={{ label: t("one-home-systems-label"), items: SYSTEMS }}
        media={
          <figure className="m-0 flex flex-col gap-3">
            <ProductComposition
              frame={
                <ProductFrame glow>
                  <CaseScreen
                    rail={[
                      <NiBriefcase key="cases" size="small" />,
                      <NiMessages key="chats" size="small" />,
                      <NiCalendar key="agenda" size="small" />,
                      <NiAnnouncement key="publications" size="small" />,
                      <NiBook key="library" size="small" />,
                    ]}
                    search={t("one-home-screen-search")}
                    crumb={t("one-home-screen-crumb")}
                    client={t("one-home-screen-client")}
                    stage={t("one-home-screen-stage")}
                    carried={t("one-home-screen-carried")}
                    journey={t("one-home-screen-journey")}
                    steps={[1, 2, 3, 4, 5, 6].map((n) => t(`one-home-screen-step-${n}`))}
                    current={3}
                    stepCount={t("one-home-screen-step-count")}
                    lines={[
                      {
                        label: t("one-home-screen-now-label"),
                        text: t("one-home-screen-now"),
                        when: t("one-home-screen-now-when"),
                        tone: "primary",
                      },
                      { label: t("one-home-screen-next-label"), text: t("one-home-screen-next"), tone: "accent-4" },
                      {
                        label: t("one-home-screen-done-label"),
                        text: t("one-home-screen-done"),
                        when: t("one-home-screen-done-when"),
                        tone: "accent-1",
                      },
                    ]}
                    docsTitle={t("one-home-screen-docs")}
                    docs={[
                      { label: t("one-home-screen-doc-identity"), state: t("one-home-screen-doc-accepted") },
                      { label: t("one-home-screen-doc-address"), state: t("one-home-screen-doc-accepted") },
                      { label: t("one-home-screen-doc-account"), state: t("one-home-screen-doc-confirmed") },
                      { label: t("one-home-screen-doc-power"), state: t("one-home-screen-doc-signed") },
                    ]}
                    mayErr={t("one-home-screen-may-err")}
                  />
                </ProductFrame>
              }
              satellites={[
                {
                  position: "top-right",
                  rotate: 2,
                  float: true,
                  children: (
                    <MessageChip
                      author={t("one-home-hero-message-author")}
                      text={t("one-home-hero-message-text")}
                      meta={t("one-home-hero-message-meta")}
                      icon={<NiMessageCheck size="small" />}
                      tone="accent-2"
                    />
                  ),
                },
                {
                  position: "bottom-left",
                  rotate: -2,
                  float: true,
                  floatDelay: 0.8,
                  children: (
                    <KpiChip
                      label={t("one-home-hero-deadline-label")}
                      value={t("one-home-hero-deadline-value")}
                      delta={t("one-home-hero-deadline-delta")}
                      tone="accent-1"
                    />
                  ),
                },
              ]}
            />
            <figcaption className="text-text-secondary text-center text-xs md:mt-6">{sample}</figcaption>
          </figure>
        }
      />

      <Showcase
        track="client"
        eyebrow={t("one-home-pain-eyebrow")}
        eyebrowTone="accent-2"
        title={t("one-home-pain-title")}
        subtitle={t("one-home-pain-subtitle")}
        points={[
          {
            icon: <NiMessageCheck />,
            tone: "accent-2",
            title: t("one-home-pain-1-title"),
            body: t("one-home-pain-1-body"),
          },
          {
            icon: <NiBriefcase />,
            tone: "primary",
            title: t("one-home-pain-2-title"),
            body: t("one-home-pain-2-body"),
          },
          { icon: <NiUsers />, tone: "accent-4", title: t("one-home-pain-3-title"), body: t("one-home-pain-3-body") },
          {
            icon: <NiUserCheck />,
            tone: "accent-1",
            title: t("one-home-pain-4-title"),
            body: t("one-home-pain-4-body"),
          },
        ]}
        caption={sample}
        media={
          <PhoneFrame time="23:41">
            {/* A client asks how the case stands late at night, and ONE answers at once from the case's own record. */}
            <ClientChat
              firm={t("one-home-chat-firm")}
              status={t("one-home-chat-status")}
              inputLabel={t("one-home-chat-input")}
              messages={[
                { from: "client", text: t("one-home-chat-question"), time: "23:41" },
                { from: "firm", text: t("one-home-chat-answer"), time: "23:41" },
                { from: "firm", text: t("one-home-chat-signature"), time: "23:41", link: t("one-home-chat-link") },
              ]}
            />
          </PhoneFrame>
        }
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
          { icon: <NiAnnouncement size="small" />, tone: "accent-4", label: t("one-home-follow-source-1") },
          { icon: <NiPulse size="small" />, tone: "accent-4", label: t("one-home-follow-source-2") },
          { icon: <NiCalendarClock size="small" />, tone: "accent-1", label: t("one-home-follow-source-3") },
          { icon: <NiCalendar size="small" />, tone: "accent-4", label: t("one-home-follow-source-4") },
          { icon: <NiMessageCheck size="small" />, tone: "accent-2", label: t("one-home-follow-source-5") },
        ]}
        media={
          <SourceRadar
            label={t("one-home-radar-label")}
            sample={t("one-home-radar-sample")}
            pauseLabel={t("one-home-autoplay-pause")}
            playLabel={t("one-home-autoplay-play")}
            gotoLabels={[1, 2, 3, 4, 5].map((n) => t("one-home-radar-goto", { n }))}
            items={[
              { icon: <NiAnnouncement size="small" />, tone: "accent-4", n: 1 },
              { icon: <NiCalendarClock size="small" />, tone: "accent-1", n: 2 },
              { icon: <NiPulse size="small" />, tone: "accent-4", n: 3 },
              { icon: <NiDocumentCheck size="small" />, tone: "accent-4", n: 4 },
              { icon: <NiShieldCheck size="small" />, tone: "accent-2", n: 5 },
            ].map(({ icon, tone, n }) => ({
              icon,
              tone: tone as "accent-1" | "accent-2" | "accent-4",
              source: t(`one-home-radar-${n}-source`),
              title: t(`one-home-radar-${n}-title`),
              detail: t(`one-home-radar-${n}-detail`),
              action: t(`one-home-radar-${n}-action`),
            }))}
          />
        }
      />

      <FeatureRows
        track="case"
        start="media"
        title={t("one-home-work-title")}
        subtitle={t("one-home-work-subtitle")}
        items={[
          {
            title: t("one-home-link-title"),
            body: t("one-home-link-body"),
            bullets: [t("one-home-link-point-1"), t("one-home-link-point-2"), t("one-home-link-point-3")],
            tone: "accent-1",
            cta: { ...primary, variant: "primary" },
            caption: sample,
            media: (
              <ClientLinkPanel
                firm={t("one-home-chat-firm")}
                label={t("one-home-link-panel-label")}
                value={t("one-home-link-panel-value")}
                caption={t("one-home-link-panel-case")}
                documentsLabel={t("one-home-link-panel-docs")}
                documents={[
                  { icon: <NiUser size="medium" />, label: t("one-home-doc-identity") },
                  { icon: <NiHome size="medium" />, label: t("one-home-doc-address") },
                  { icon: <NiPaperclip size="medium" />, label: t("one-home-doc-evidence") },
                  { icon: <NiPen size="medium" />, label: t("one-home-doc-signature") },
                  { icon: <NiMicrophone size="medium" />, label: t("one-home-doc-account") },
                ]}
              />
            ),
          },
          {
            title: t("one-home-court-title"),
            body: t("one-home-court-body"),
            bullets: [t("one-home-court-point-1"), t("one-home-court-point-2"), t("one-home-court-point-3")],
            tone: "accent-4",
            cta: { ...contact, variant: "secondary" },
            caption: sample,
            media: (
              <ProductComposition
                className="mx-auto w-full max-w-lg md:my-8"
                frame={
                  <CaseStageChart
                    title={t("one-home-board-title")}
                    total={t("one-home-board-total", { count: STAGES.reduce((sum, value) => sum + value, 0) })}
                    highlight={3}
                    stages={[
                      { label: t("one-home-board-stage-intake"), value: STAGES[0] },
                      { label: t("one-home-board-stage-documents"), value: STAGES[1] },
                      { label: t("one-home-board-stage-signature"), value: STAGES[2] },
                      { label: t("one-home-board-stage-drafting"), value: STAGES[3] },
                      { label: t("one-home-board-stage-filed"), value: STAGES[4] },
                    ]}
                  />
                }
                satellites={[
                  {
                    position: "top-right",
                    rotate: 2,
                    children: (
                      <RingChip
                        label={t("one-home-board-pieces")}
                        total={String(PIECES.approved + PIECES.review + PIECES.writing)}
                        parts={[
                          { label: t("one-home-board-pieces-approved"), value: PIECES.approved, tone: "primary" },
                          { label: t("one-home-board-pieces-review"), value: PIECES.review, tone: "accent-4" },
                          { label: t("one-home-board-pieces-writing"), value: PIECES.writing, tone: "secondary" },
                        ]}
                      />
                    ),
                  },
                  {
                    // Over the first bar, clear of the stage names along the card's foot.
                    position: "left",
                    rotate: -2,
                    children: (
                      <KpiChip
                        label={t("one-home-board-package-label")}
                        value={t("one-home-board-package-value")}
                        delta={t("one-home-board-package-delta")}
                        tone="accent-4"
                      />
                    ),
                  },
                ]}
              />
            ),
          },
          {
            title: t("one-home-deadline-title"),
            body: t("one-home-deadline-body"),
            bullets: [t("one-home-deadline-point-1"), t("one-home-deadline-point-2"), t("one-home-deadline-point-3")],
            tone: "accent-1",
            caption: sample,
            media: (
              <DeadlineCalendar
                act={t("one-home-deadline-act")}
                term={t("one-home-deadline-term")}
                due={t("one-home-deadline-due")}
                month={t("one-home-deadline-month")}
                weekdays={t("one-home-deadline-weekdays").split(",")}
                firstWeekday={0}
                days={30}
                marks={DEADLINE_MARKS}
                legend={{
                  counted: t("one-home-deadline-legend-counted"),
                  holiday: t("one-home-deadline-legend-holiday"),
                  last: t("one-home-deadline-legend-last"),
                }}
                note={t("one-home-deadline-note")}
              />
            ),
          },
        ]}
      />

      <FeatureGrid
        track="more"
        variant="tinted"
        background="paper"
        title={t("one-home-more-title")}
        cta={primary}
        features={[
          {
            icon: <NiPen size="large" />,
            tone: "accent-1",
            title: t("one-home-more-signature-title"),
            description: t("one-home-more-signature-body"),
          },
          {
            icon: <NiCalendar size="large" />,
            tone: "accent-4",
            title: t("one-home-more-hearings-title"),
            description: t("one-home-more-hearings-body"),
          },
          {
            icon: <NiFolderCheck size="large" />,
            tone: "secondary",
            title: t("one-home-more-dossier-title"),
            description: t("one-home-more-dossier-body"),
          },
        ]}
      />

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
          <div className="flex flex-col gap-4">
            <TypingLine
              label={t("one-home-typing-label")}
              listLabel={t("one-home-typing-list")}
              icon={<NiSparkle size="medium" />}
              phrases={[1, 2, 3, 4, 5].map((n) => t(`one-home-typing-${n}`))}
              pauseLabel={t("one-home-autoplay-pause")}
              playLabel={t("one-home-autoplay-play")}
            />
            <AutonomyPanel
              title={t("one-home-autonomy-title")}
              modes={[
                t("one-home-autonomy-mode-auto"),
                t("one-home-autonomy-mode-sampled"),
                t("one-home-autonomy-mode-person"),
              ]}
              rows={(
                [
                  [1, 0],
                  [2, 0],
                  [3, 1],
                  [4, 2],
                  [5, 0],
                ] as const
              ).map(([n, mode]) => ({ label: t(`one-home-autonomy-row-${n}`), mode }))}
              footer={t("one-home-autonomy-footer")}
            />
          </div>
        }
      />

      <FeatureRows
        track="arrive"
        decor="grid"
        title={t("one-home-arrive-title")}
        subtitle={t("one-home-arrive-subtitle")}
        items={[
          {
            title: t("one-home-models-title"),
            body: t("one-home-models-body"),
            bullets: [t("one-home-models-point-1"), t("one-home-models-point-2"), t("one-home-models-point-3")],
            tone: "secondary",
            caption: sample,
            media: (
              <ModelImportPanel
                fileName={t("one-home-models-file")}
                fileMeta={t("one-home-models-file-meta")}
                step={t("one-home-models-step")}
                modelTitle={t("one-home-models-model")}
                modelBadge={t("one-home-models-badge")}
                text={t.rich("one-home-models-text", { m: (chunks) => <ModelMark>{chunks}</ModelMark> })}
                checks={[t("one-home-models-check-1"), t("one-home-models-check-2")]}
                mayErr={t("one-home-screen-may-err")}
              />
            ),
          },
          {
            title: t("one-home-import-title"),
            body: t("one-home-import-body"),
            bullets: [t("one-home-import-point-1"), t("one-home-import-point-2"), t("one-home-import-point-3")],
            tone: "accent-4",
            cta: { ...primary, variant: "primary" },
            caption: sample,
            media: (
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
                  { label: t("one-home-import-summary-known"), kind: "known" },
                  { label: t("one-home-import-summary-unread"), kind: "unread" },
                ]}
              />
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
        aside={{ title: t("one-home-faq-aside-title"), body: t("one-home-faq-aside-body"), cta: contact }}
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
