"use client";
import { Accordion, AccordionDetails, AccordionSummary, Button, Typography } from "@mui/material";

import JsonLd from "@/components/marketing/json-ld";
import Link from "@/components/marketing/locale-link";
import Reveal from "@/components/marketing/reveal";
import Section from "@/components/marketing/section";
import SectionHeader from "@/components/marketing/section-header";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import { trackSiteEvent } from "@/lib/site-events";

export type FaqItem = { question: string; answer: string; id?: string };

/**
 * Funnel stage: objection handling. Each question should be a REAL purchase
 * objection (price, migration, security, lock-in), answered plainly.
 *
 * Emits FAQPage structured data from the same `items` — an eligible rich
 * result and a strong AI-search signal, with nothing for the page to remember.
 *
 * Layouts:
 * - "stack": the classic centered list, for quieter pages;
 * - "split": sticky intro column (eyebrow, title, subtitle, CTA link) beside
 *   the accordion list;
 * - "aside": the heading centered above, the list on the left and, on the
 *   right, a card for who did not find their question (`aside`), the home's
 *   treatment since its blueprint of 2026-10-26.
 */
export default function Faq({
  eyebrow,
  title,
  subtitle,
  items,
  id,
  track,
  layout = "stack",
  link,
  aside,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  items: FaqItem[];
  id?: string;
  /** The section's key in the measurement (`section_view`). */
  track?: string;
  layout?: "stack" | "split" | "aside";
  /** Split layout only: conversion link under the intro (repeats the page CTA). */
  link?: { label: string; href: string };
  /** Aside layout only: the card beside the list, with its way to ask. */
  aside?: { title: string; body: string; cta: { label: string; href: string } };
}) {
  const structuredData = (
    <JsonLd
      data={{
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: items.map((item) => ({
          "@type": "Question",
          name: item.question,
          acceptedAnswer: { "@type": "Answer", text: item.answer },
        })),
      }}
    />
  );

  const accordions = (
    <Reveal className="flex w-full flex-col gap-2">
      {items.map((item, index) => (
        <Accordion
          key={item.question}
          elevation={0}
          disableGutters
          className="border-grey-100 bg-background-paper rounded-2xl! border"
          // Opening a question is a site event (`faq_open`); closing it is not.
          onChange={(_event, expanded) => {
            if (expanded) trackSiteEvent("faq_open", { question_id: item.id ?? String(index + 1) });
          }}
        >
          <AccordionSummary expandIcon={<NiChevronDownSmall />} className="px-6! py-4!">
            <Typography component="h3" variant="subtitle1">
              {item.question}
            </Typography>
          </AccordionSummary>
          <AccordionDetails className="px-6! pt-0! pb-6!">
            <Typography variant="body1" className="text-text-secondary leading-6">
              {item.answer}
            </Typography>
          </AccordionDetails>
        </Accordion>
      ))}
    </Reveal>
  );

  if (layout === "aside") {
    return (
      <Section id={id} track={track}>
        {structuredData}
        <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
        <div className="grid grid-cols-1 items-start gap-6 md:grid-cols-[1.6fr_1fr] md:gap-8">
          {accordions}
          {aside && (
            <div className="bg-grey-50 flex flex-col items-center gap-3 rounded-4xl px-8 py-12 text-center md:sticky md:top-28">
              <h3 className="font-heading text-text-primary text-xl font-bold">{aside.title}</h3>
              <p className="text-text-secondary max-w-xs leading-6">{aside.body}</p>
              <Button
                variant="pastel"
                color="primary"
                href={aside.cta.href}
                LinkComponent={Link}
                className="mt-2"
                data-track="contact_click"
                data-track-location="faq"
              >
                {aside.cta.label}
              </Button>
            </div>
          )}
        </div>
      </Section>
    );
  }

  if (layout === "split") {
    return (
      <Section id={id} track={track}>
        {structuredData}
        <div className="grid grid-cols-1 items-start gap-10 md:grid-cols-[0.6fr_1fr] md:gap-16">
          <div className="md:sticky md:top-28">
            <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} align="start" className="mb-0 md:mb-0" />
            {link && (
              <Button variant="pastel" color="primary" href={link.href} LinkComponent={Link} className="mt-6">
                {link.label}
              </Button>
            )}
          </div>
          {accordions}
        </div>
      </Section>
    );
  }

  return (
    <Section id={id} track={track}>
      {structuredData}
      <SectionHeader eyebrow={eyebrow} title={title} subtitle={subtitle} />
      <div className="mx-auto w-full max-w-3xl">{accordions}</div>
    </Section>
  );
}
