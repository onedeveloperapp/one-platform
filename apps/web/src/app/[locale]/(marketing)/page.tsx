import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import BentoGrid from "@/components/marketing/bento-grid";
import CaseDemo, { type CaseDemoWords } from "@/components/marketing/case-demo";
import Cta from "@/components/marketing/cta";
import Faq from "@/components/marketing/faq";
import FeatureRows from "@/components/marketing/feature-row";
import { AutonomyPanel, ModelImportPanel, ModelMark, PortfolioImportPanel } from "@/components/marketing/firm-screens";
import Hero from "@/components/marketing/hero";
import {
  ConversationFigure,
  DeadlineFigure,
  DocumentsFigure,
  PackageFigure,
} from "@/components/marketing/product-figures";
import Showcase from "@/components/marketing/showcase";
import SourceRadar from "@/components/marketing/source-radar";
import StickyCta from "@/components/marketing/sticky-cta";
import TypingLine from "@/components/marketing/typing-line";
import NiAnnouncement from "@/icons/nexture/ni-announcement";
import NiBriefcase from "@/icons/nexture/ni-briefcase";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiFolder from "@/icons/nexture/ni-folder";
import NiFolderCheck from "@/icons/nexture/ni-folder-check";
import NiMessageCheck from "@/icons/nexture/ni-message-check";
import NiMessageDots from "@/icons/nexture/ni-message-dots";
import NiMoney from "@/icons/nexture/ni-money";
import NiPaperclip from "@/icons/nexture/ni-paperclip";
import NiPen from "@/icons/nexture/ni-pen";
import NiPulse from "@/icons/nexture/ni-pulse";
import NiRobot from "@/icons/nexture/ni-robot";
import NiScale from "@/icons/nexture/ni-scale";
import NiSendRight from "@/icons/nexture/ni-send-right";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiSlider from "@/icons/nexture/ni-slider";
import NiUserCheck from "@/icons/nexture/ni-user-check";
import NiUsers from "@/icons/nexture/ni-users";
import { JOURNEY_STEP_KEY, type JourneyStepId } from "@/lib/cases/journey";
import { fileLine } from "@/lib/conversations/agent";
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

/** The way of a case on the top of the scene, with the icons the case screen gives each step (journey-card.tsx). */
const SCENE_STEPS: { id: JourneyStepId; icon: React.ReactNode }[] = [
  { id: "intake", icon: <NiMessageDots size="small" /> },
  { id: "documents", icon: <NiFolder size="small" /> },
  { id: "signature", icon: <NiPen size="small" /> },
  { id: "drafting", icon: <NiDocumentFull size="small" /> },
  { id: "filing", icon: <NiSendRight size="small" /> },
  { id: "hearing", icon: <NiCalendar size="small" /> },
  { id: "judgment", icon: <NiScale size="small" /> },
  { id: "payment", icon: <NiMoney size="small" /> },
];

/** When the client of the scene sent her identity, and when ONE answered: the check takes seconds. */
const SCENE_TIME = "09:41";
/** The file the client sent, as WhatsApp names a photo. */
const SCENE_FILE = "identidade.jpg";
/** When the client of the conversation asked, late at night, and ONE answered. */
const CHAT_TIME = "23:41";

/**
 * Each decision of the control panel by the product's own name, with the ways the catalog lets a firm choose for it
 * (`autonomy_decisions`: auto, sampled, approval), and the one the example firm chose.
 */
const AUTONOMY_ROWS = [
  { key: "autonomy-document-check", modes: ["auto", "sampled", "approval"], mode: "auto" },
  { key: "autonomy-reply-client", modes: ["auto", "sampled", "approval"], mode: "sampled" },
  { key: "autonomy-deadline-confirm", modes: ["auto", "approval"], mode: "approval" },
  { key: "autonomy-piece-text", modes: ["auto", "approval"], mode: "approval" },
  { key: "autonomy-send-signature-papers", modes: ["auto", "approval"], mode: "auto" },
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
 * The public home of ONE: a sales page in the structure, the mechanics and the visual effect of the analysed model
 * of a legal software's page (the conversion-pages app's `juridiq-pagina-de-vendas`), in ONE's own brand, words and
 * screens (docs/DESIGN.md, "Reference blueprint"; the plan is docs/paginas/home/plano.md). It sells ONE's core, the
 * AI automation of a mass-litigation firm's cases, never one of its applications: the deep top with ONE checking
 * a paper a client sent, drawn with the product's own components; the client's question answered on the firm's
 * WhatsApp; what ONE follows after the filing; the day to day of a case as one grid; what the firm lets ONE decide
 * alone, on the deep band; how a firm arrives without starting over; the firm's questions (the one place the first
 * module is named); the closing call. Every figure carries invented data and says so; nothing here is a metric, a
 * client's logo, a testimonial, a price or a promotion, because there is none yet. The primary action follows the
 * launch stage, as the header's does.
 */
export default async function Home() {
  const [t, p, stage] = await Promise.all([getTranslations("marketing"), getTranslations("product"), getLaunchStage()]);
  const action = primaryCtaFor(stage);
  const primary = { label: t(action.labelKey), href: action.href };
  const contact = { label: t("one-home-cta-contact"), href: "/contato" };
  const waitlist = stage === "waitlist";
  const sample = t("one-home-sample");
  const client = t("one-home-demo-client");

  const faq = [1, 2, 3, 4, 5, 6, 7, 8, ...(waitlist ? [9] : [])].map((n) => ({
    id: String(n),
    question: t(`one-home-faq-${n}-question`),
    answer: t(`one-home-faq-${n}-answer`),
  }));

  // The top of a case and the conversation with its client, in the product's own words.
  const scene: CaseDemoWords = {
    label: t("one-home-demo-label"),
    sample,
    pauseLabel: t("one-home-demo-pause"),
    playLabel: t("one-home-demo-play"),
    title: p("journey-title"),
    steps: SCENE_STEPS.map((step, index) => ({
      key: step.id,
      label: p(JOURNEY_STEP_KEY[step.id]),
      state: index === 0 ? "done" : index === 1 ? "current" : "next",
      icon: step.icon,
    })),
    stateWords: {
      done: p("journey-state-done"),
      current: p("journey-state-current"),
      next: p("journey-state-next"),
      stopped: p("journey-state-stopped"),
    },
    workingTitle: p("case-now-title-working"),
    workingLine: p("case-now-checking-one", { document: p("case-now-document-identity"), name: client }),
    workingSince: p("case-now-since", { time: SCENE_TIME }),
    recentTitle: p("case-now-title-recent"),
    recent: {
      key: "document-accepted",
      icon: <NiPaperclip size="small" />,
      tone: "secondary",
      title: p("case-event-document-accepted"),
      when: p("case-now-ago-now"),
      facts: [p("case-actor-ai")],
    },
    client: {
      sideLabel: p("inbox-said-person", { name: client }),
      kind: p("inbox-kind-image"),
      open: p("inbox-media-open-named", { name: SCENE_FILE }),
      time: SCENE_TIME,
      by: p("inbox-by-client"),
    },
    reply: {
      sideLabel: p("inbox-said-firm"),
      // The very words ONE sends for a paper it accepted.
      text: fileLine({ kind: "paper", paper: "identity", status: "accepted", reason: null }),
      time: SCENE_TIME,
      by: p("inbox-by-one"),
      status: p("inbox-status-delivered"),
    },
  };

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
        media={<CaseDemo words={scene} />}
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
          <ConversationFigure
            label={t("one-home-chat-label")}
            question={t("one-home-chat-question")}
            answer={t("one-home-chat-answer")}
            time={CHAT_TIME}
          />
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
            sample={sample}
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

      <BentoGrid
        track="case"
        title={t("one-home-work-title")}
        subtitle={t("one-home-work-subtitle")}
        caption={sample}
        cta={primary}
        items={[
          {
            featured: true,
            bleed: true,
            title: t("one-home-bento-documents-title"),
            body: t("one-home-bento-documents-body"),
            figure: <DocumentsFigure label={t("one-home-bento-documents-label")} />,
          },
          {
            title: t("one-home-bento-signature-title"),
            body: t("one-home-bento-signature-body"),
            icon: <NiPen />,
            tone: "accent-1",
          },
          {
            title: t("one-home-bento-package-title"),
            body: t("one-home-bento-package-body"),
            figure: <PackageFigure label={t("one-home-bento-package-label")} />,
          },
          {
            title: t("one-home-bento-dossier-title"),
            body: t("one-home-bento-dossier-body"),
            icon: <NiFolderCheck />,
            tone: "secondary",
          },
          {
            title: t("one-home-bento-deadline-title"),
            body: t("one-home-bento-deadline-body"),
            figure: <DeadlineFigure label={t("one-home-bento-deadline-label")} />,
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
                mayErr={t("one-home-may-err")}
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
