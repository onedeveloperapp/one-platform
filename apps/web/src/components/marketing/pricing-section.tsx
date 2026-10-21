"use client";
import { useState } from "react";

import { Button } from "@mui/material";

import { BRAND } from "@/brand";
import JsonLd from "@/components/marketing/json-ld";
import Link from "@/components/marketing/locale-link";
import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import { TONE, type Tone, toneAt } from "@/components/marketing/tone";
import NiCheck from "@/icons/nexture/ni-check";
import NiTag from "@/icons/nexture/ni-tag";
import { cn } from "@/lib/utils";

/** Display-ready plan: price already formatted for the active locale/currency. */
export type PublicPlanDisplay = {
  slug: string;
  name: string;
  description?: string;
  price: string;
  /**
   * What this price depends on, named instead of compared with another price:
   * the campaign coupon that lowered it ("Com o cupom LANCAMENTO"). No card
   * strikes a price through or pairs a "from" with a "to" (docs/PRODUCT.md,
   * "Preço e vagas").
   */
  priceCondition?: string;
  period?: string;
  features: string[];
  highlighted?: boolean;
  /** Harmonic hue identifying this tier (name mark + feature checks). Defaults to a rotation. */
  tone?: Tone;
  /**
   * Raw amount + ISO-4217 currency for Offer structured data. Present for real
   * billing plans; omitted for i18n placeholder plans so no fake pricing is
   * published as JSON-LD.
   */
  priceAmount?: number;
  priceCurrency?: string;
  /** Where THIS card's button leads, when it differs from the section's `ctaHref` (each plan's own checkout). */
  href?: string;
  /** This card's button label, when it differs from the section's (the one-time kit reads "Buy", not "Subscribe"). */
  ctaLabel?: string;
  /** "ou em até 12x de R$ 8,08 no cartão": the card split the checkout offers, from data; absent when it cannot be split. */
  installmentsLabel?: string;
  /** With `periodToggle`, the cycle this card belongs to; a card without one (the kit) always shows. */
  cycle?: "monthly" | "yearly";
  /** What the button's click is reported as (`cta_click`, `cta_id`): the access or the subscription. */
  ctaId?: "plan_access" | "plan_full";
};

/**
 * Funnel stage: action. Real plans come from packages/billing
 * (listPublicPlans → formatted by the page); the CTA repeats the page's
 * primary action and leads straight to sign-up.
 */
export default function PricingSection({
  id,
  track,
  eyebrow,
  title,
  subtitle,
  plans,
  ctaLabel,
  ctaHref = "/auth/sign-up",
  headingAs = "h2",
  decor = "none",
  tiers,
  footnote,
  couponNotice,
  periodToggle,
}: {
  id?: string;
  /** The section's key in the measurement (`section_view`). */
  track?: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  plans: PublicPlanDisplay[];
  ctaLabel: string;
  ctaHref?: string;
  /**
   * Confirmation that a campaign code was recognized (or a plain statement that
   * it was not). Someone who followed "use the code X" needs to see the code
   * land — silence reads as failure and she leaves before the first card.
   */
  couponNotice?: { label: string; applied: boolean };
  /** Set "h1" when this section is the page's lead (e.g. the pricing page). */
  headingAs?: "h1" | "h2";
  /** Section depth layer — pages that LEAD with pricing use "glow" (same treatment as a hero). */
  decor?: "none" | "glow" | "grid" | "gradient-edge";
  /** Ladder above the grid (e.g. "Kit · Assinatura · Pro"). */
  tiers?: string[];
  /** Differentiation line under the grid ("O kit entrega… a assinatura soma…"). */
  footnote?: string;
  /**
   * Monthly / yearly switch above the grid: cards with a `cycle` show only in
   * theirs, cards without one always show. Labels are translated by the page;
   * `yearlyNote` is a real saving computed from the plans ("save 25%").
   */
  periodToggle?: { label: string; monthly: string; yearly: string; yearlyNote?: string };
}) {
  const [period, setPeriod] = useState<"monthly" | "yearly">("monthly");
  const visiblePlans = periodToggle ? plans.filter((plan) => !plan.cycle || plan.cycle === period) : plans;
  // The plan names sit one level under the section title: h2 when the title
  // is the page <h1> (/planos), h3 otherwise. A fixed h3 skipped a level there.
  const PlanHeading = headingAs === "h1" ? "h2" : "h3";
  return (
    <Section id={id} track={track} decor={decor}>
      {plans
        .filter((plan) => plan.priceAmount !== undefined && plan.priceCurrency)
        .map((plan) => (
          <JsonLd
            key={plan.slug}
            data={{
              "@context": "https://schema.org",
              "@type": "Product",
              name: plan.name,
              ...(plan.description ? { description: plan.description } : {}),
              brand: { "@type": "Brand", name: BRAND.name },
              offers: {
                "@type": "Offer",
                price: plan.priceAmount,
                priceCurrency: plan.priceCurrency,
                availability: "https://schema.org/InStock",
                url: `${BRAND.siteUrl}${plan.href ?? ctaHref}`,
              },
            }}
          />
        ))}
      <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} as={headingAs} />
      {couponNotice && (
        <p
          className={cn(
            "mx-auto -mt-4 mb-10 flex w-fit flex-row items-center gap-2 rounded-full px-4 py-2 text-sm font-bold",
            // Never red: a coupon that no longer works is disappointing news,
            // not a risk or a failure (docs/DESIGN.md colour contract).
            couponNotice.applied ? "bg-primary/10 text-text-primary" : "bg-grey-50 text-text-secondary",
          )}
        >
          <NiTag size="small" className="flex-none" />
          {couponNotice.label}
        </p>
      )}
      {tiers && tiers.length > 0 && (
        <p className="text-text-secondary -mt-4 mb-10 flex flex-wrap items-center justify-center gap-3 text-xs font-bold tracking-widest uppercase">
          {tiers.map((tier, index) => (
            <span key={tier} className="flex items-center gap-3">
              {index > 0 && <span aria-hidden className="bg-grey-100 h-px w-8" />}
              {tier}
            </span>
          ))}
        </p>
      )}
      {periodToggle && (
        <div
          role="radiogroup"
          aria-label={periodToggle.label}
          className="border-grey-100 bg-background-paper mx-auto -mt-4 mb-10 flex w-fit flex-row gap-1 rounded-full border p-1"
        >
          {(["monthly", "yearly"] as const).map((option) => {
            const selected = period === option;
            return (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => setPeriod(option)}
                className={cn(
                  "flex flex-row items-center gap-2 rounded-full px-4 py-2 text-sm font-bold transition-colors",
                  selected ? "bg-primary text-text-contrast" : "text-text-secondary hover:text-text-primary",
                )}
              >
                {option === "monthly" ? periodToggle.monthly : periodToggle.yearly}
                {option === "yearly" && periodToggle.yearlyNote && (
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs",
                      selected ? "bg-text-contrast/20" : "bg-secondary/10 text-text-primary",
                    )}
                  >
                    {periodToggle.yearlyNote}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      <Reveal
        stagger={0.08}
        className={cn(
          "mx-auto grid w-full grid-cols-1 items-stretch gap-6",
          // Track the real plan count: one or two plans stay CENTERED instead
          // of stranding in the first column of a 3-up grid (a project may
          // ship a single public plan while billing is being set up).
          visiblePlans.length === 1 && "md:max-w-sm",
          visiblePlans.length === 2 && "md:max-w-2xl md:grid-cols-2",
          visiblePlans.length >= 3 && "max-w-4xl md:grid-cols-3",
        )}
      >
        {visiblePlans.map((plan, index) => {
          const tone = TONE[plan.tone ?? toneAt(index)];
          return (
            <div
              key={plan.slug}
              className={
                plan.highlighted
                  ? "border-primary bg-background-paper shadow-darker-xs flex flex-col gap-4 rounded-3xl border-2 p-6"
                  : "border-grey-100 bg-background-paper flex flex-col gap-4 rounded-3xl border p-6"
              }
            >
              <div className="flex flex-col gap-1">
                <div className="flex flex-row items-center gap-2">
                  <span aria-hidden className={cn("h-2.5 w-2.5 flex-none rounded-full", tone.softBg)}>
                    <span
                      className={cn("block h-full w-full scale-50 rounded-full", tone.text)}
                      style={{ backgroundColor: "currentcolor" }}
                    />
                  </span>
                  <PlanHeading className="text-text-primary font-heading text-xl font-normal">{plan.name}</PlanHeading>
                </div>
                {plan.description && <p className="text-text-secondary text-sm leading-5">{plan.description}</p>}
              </div>

              <div className="flex flex-col gap-1">
                {plan.priceCondition && (
                  <p className="bg-primary/10 text-text-primary flex w-fit flex-row items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold">
                    <NiTag size="small" className="flex-none" />
                    {plan.priceCondition}
                  </p>
                )}
                <p className="flex flex-row items-baseline gap-1">
                  <span className="font-display text-display-md text-text-primary font-bold">{plan.price}</span>
                  {plan.period && <span className="text-text-secondary text-sm">{plan.period}</span>}
                </p>
                {plan.installmentsLabel && <p className="text-text-secondary text-sm">{plan.installmentsLabel}</p>}
              </div>

              <ul className="flex flex-1 flex-col gap-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="text-text-secondary flex flex-row items-start gap-2 text-base leading-6">
                    <NiCheck size="small" className={cn("mt-1 flex-none", tone.text)} />
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                variant={plan.highlighted ? "contained" : "pastel"}
                color="primary"
                href={plan.href ?? ctaHref}
                LinkComponent={Link}
                data-track="cta_click"
                data-track-cta-id={plan.ctaId ?? "plan_full"}
              >
                {plan.ctaLabel ?? ctaLabel}
              </Button>
            </div>
          );
        })}
      </Reveal>
      {footnote && (
        <p className="text-text-secondary mx-auto mt-8 max-w-2xl text-center text-base leading-6">{footnote}</p>
      )}
    </Section>
  );
}
