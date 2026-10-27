import type { Metadata } from "next";
import { getLocale, getTranslations } from "next-intl/server";

import { CaseStageChart, ClientChat, ClientLinkPanel } from "@/components/marketing/case-media";
import Cta from "@/components/marketing/cta";
import Faq from "@/components/marketing/faq";
import FeatureGrid from "@/components/marketing/feature-grid";
import FeatureRows from "@/components/marketing/feature-row";
import Hero from "@/components/marketing/hero";
import LogoCloud from "@/components/marketing/logo-cloud";
import PhoneFrame from "@/components/marketing/phone-frame";
import ProductComposition from "@/components/marketing/product-composition";
import { KpiChip, ReadoutChip, RingChip } from "@/components/marketing/satellite-chips";
import NiAnnouncement from "@/icons/nexture/ni-announcement";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiHome from "@/icons/nexture/ni-home";
import NiMessageCheck from "@/icons/nexture/ni-message-check";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPaperclip from "@/icons/nexture/ni-paperclip";
import NiPen from "@/icons/nexture/ni-pen";
import NiUser from "@/icons/nexture/ni-user";
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
 * The public home of ONE while the product is built with a pilot firm,
 * following the blueprint of 2026-10-26 (docs/DESIGN.md, "Reference
 * blueprint"). It sells ONE's core, the AI automation of a mass-litigation
 * firm's cases, never one of its applications (the owner, 2026-10-27): ONE
 * answering a client on the firm's WhatsApp, the systems it works with, what
 * the client's link gathers and the AI checks, the piece the AI writes and the
 * package that leaves for the court, what ONE follows after the filing, the
 * firm's questions (the one place the first module is named) and the waitlist.
 * The screens are drawn with tokens and say they carry example data; nothing
 * here is a metric, a client's logo or a testimonial, because there is none yet.
 */
export default async function Home() {
  const t = await getTranslations("marketing");
  const waitlist = { label: t("cta-waitlist"), href: "/espera" };
  const contact = { label: t("one-home-cta-contact"), href: "/contato" };

  return (
    <>
      <Hero
        layout="split"
        track="hero"
        title={t("one-home-title")}
        subtitle={t("one-home-subtitle")}
        primaryCta={waitlist}
        secondaryCta={contact}
        note={t("one-home-note")}
        media={
          <ProductComposition
            className="mx-auto w-full max-w-md"
            frame={
              <PhoneFrame>
                {/* A client asks how the case stands, and ONE answers at once from the case's own record. */}
                <ClientChat
                  firm={t("one-home-chat-firm")}
                  status={t("one-home-chat-status")}
                  inputLabel={t("one-home-chat-input")}
                  messages={[
                    { from: "client", text: t("one-home-chat-question"), time: "14:02" },
                    { from: "firm", text: t("one-home-chat-answer"), time: "14:02" },
                    {
                      from: "firm",
                      text: t("one-home-chat-signature"),
                      time: "14:02",
                      link: t("one-home-chat-link"),
                    },
                  ]}
                />
              </PhoneFrame>
            }
            satellites={[
              {
                position: "top-right",
                rotate: 2,
                float: true,
                children: <ReadoutChip text={t("one-home-chip-reply")} tone="accent-2" />,
              },
              {
                // At the phone's foot: halfway up it would cover the first words of ONE's answer.
                position: "bottom-left",
                rotate: -3,
                float: true,
                floatDelay: 0.8,
                children: (
                  <KpiChip
                    label={t("one-home-chip-docs-label")}
                    value={t("one-home-chip-docs-value")}
                    tone="accent-1"
                  />
                ),
              },
              {
                position: "bottom-right",
                rotate: -2,
                children: (
                  <KpiChip
                    label={t("one-home-chip-piece-label")}
                    value={t("one-home-chip-piece-value")}
                    delta={t("one-home-chip-piece-delta")}
                    tone="primary"
                  />
                ),
              },
            ]}
          />
        }
      />

      <LogoCloud band track="systems" label={t("one-home-systems-label")} items={SYSTEMS.map((name) => ({ name }))} />

      <FeatureRows
        track="case"
        start="media"
        items={[
          {
            title: t("one-home-link-title"),
            body: t("one-home-link-body"),
            bullets: [t("one-home-link-point-1"), t("one-home-link-point-2"), t("one-home-link-point-3")],
            tone: "accent-1",
            cta: { ...waitlist, variant: "primary" },
            caption: t("one-home-sample"),
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
            caption: t("one-home-sample"),
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
                    float: true,
                    floatDelay: 0.4,
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
        ]}
      />

      <FeatureGrid
        track="follow"
        variant="tinted"
        title={t("one-home-follow-title")}
        features={[
          {
            icon: <NiCalendarClock size="large" />,
            tone: "accent-1",
            title: t("one-home-follow-deadlines-title"),
            description: t("one-home-follow-deadlines-body"),
          },
          {
            icon: <NiAnnouncement size="large" />,
            tone: "accent-4",
            title: t("one-home-follow-publications-title"),
            description: t("one-home-follow-publications-body"),
          },
          {
            icon: <NiMessageCheck size="large" />,
            tone: "accent-2",
            title: t("one-home-follow-client-title"),
            description: t("one-home-follow-client-body"),
          },
        ]}
      />

      <Faq
        layout="aside"
        track="faq"
        title={t("one-home-faq-title")}
        subtitle={t("one-home-faq-subtitle")}
        items={[1, 2, 3, 4, 5, 6, 7].map((n) => ({
          id: String(n),
          question: t(`one-home-faq-${n}-question`),
          answer: t(`one-home-faq-${n}-answer`),
        }))}
        aside={{ title: t("one-home-faq-aside-title"), body: t("one-home-faq-aside-body"), cta: contact }}
      />

      <Cta
        variant="deep-panel"
        track="final"
        title={t("one-home-cta-title")}
        subtitle={t("one-home-cta-subtitle")}
        cta={waitlist}
        secondaryCta={contact}
      />
    </>
  );
}
