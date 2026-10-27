import type { ReactNode } from "react";

import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

import { emailCopyFor } from "../copy";
import type { EmailLocale } from "../locale";

/**
 * Colours of the e-mails. Inline styles only: e-mail clients ignore
 * stylesheets, so the design tokens cannot be consumed here. These are the
 * light values of packages/design-tokens (common.css and blue.css) copied by
 * hand: keep them aligned when the palette changes.
 *
 * The primary is the blue of the provisional logo's tile (hsl 207 85% 42%)
 * since 2026-10-26, and the button carries a white label on it: 4.7:1, where
 * the charcoal would measure 2.8:1. On the cyan it replaced the charcoal was
 * the one that read.
 */
export const COLOR = {
  ground: "#f9f8f6",
  paper: "#ffffff",
  text: "#48433d",
  muted: "#716c65",
  rule: "#e8e6e3",
  primary: "#1074c6",
  onPrimary: "#ffffff",
  deep: "#303030",
  onDeep: "#f9f8f6",
} as const;

const FONT = "Arial, Helvetica, sans-serif";
const MONO = "Consolas, Menlo, 'Courier New', monospace";

const text = { color: COLOR.text, fontSize: 14, lineHeight: "22px" } as const;

/** A paragraph of body copy. */
export function EmailText({ children, tight = false }: { children: ReactNode; tight?: boolean }) {
  return <Text style={{ ...text, margin: tight ? "0 0 4px" : "0 0 16px" }}>{children}</Text>;
}

/** The one action of the message. */
export function EmailButton({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Section style={{ margin: "24px 0", textAlign: "center" }}>
      <Button
        href={href}
        style={{
          backgroundColor: COLOR.primary,
          borderRadius: 12,
          color: COLOR.onPrimary,
          display: "inline-block",
          fontSize: 14,
          fontWeight: 700,
          padding: "12px 24px",
          textDecoration: "none",
        }}
      >
        {children}
      </Button>
    </Section>
  );
}

/** Numbered steps, or a plain list when `ordered` is false. */
export function EmailList({ items, ordered = false }: { items: string[]; ordered?: boolean }) {
  return (
    <Section style={{ margin: "0 0 16px" }}>
      {items.map((item, index) => (
        <Text key={item} style={{ ...text, margin: "0 0 6px" }}>
          {ordered ? `${index + 1}. ` : "• "}
          {item}
        </Text>
      ))}
    </Section>
  );
}

/** A terminal command, in the mono face on the deep band (the look of the site's terminal frames). */
export function EmailCommand({ children }: { children: string }) {
  return (
    <Section style={{ backgroundColor: COLOR.deep, borderRadius: 12, margin: "0 0 16px", padding: "12px 16px" }}>
      <Text style={{ color: COLOR.onDeep, fontFamily: MONO, fontSize: 13, lineHeight: "20px", margin: 0 }}>
        {children}
      </Text>
    </Section>
  );
}

/** Small print under the rule: why the message was sent, where to manage it. */
export function EmailNote({ children }: { children: ReactNode }) {
  return <Text style={{ color: COLOR.muted, fontSize: 12, lineHeight: "18px", margin: "0 0 8px" }}>{children}</Text>;
}

/**
 * The frame every e-mail shares: language, preview line, one card with the
 * heading, the body, then the small print and the signature.
 *
 * `unsubscribe` is for the messages a reader may stop (the weekly summary, the
 * list): the same address goes in the List-Unsubscribe header, so the link in
 * the body and the button of the mail client do the same thing. A message that
 * confirms a purchase or warns about the account has none.
 */
export default function EmailShell({
  locale,
  preview,
  heading,
  children,
  notes,
  unsubscribe,
}: {
  locale: EmailLocale;
  preview: string;
  heading: string;
  children: ReactNode;
  /** Small print: one string per line. */
  notes?: string[];
  unsubscribe?: { label: string; url: string };
}) {
  const copy = emailCopyFor(locale);
  return (
    <Html lang={locale}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: COLOR.ground, fontFamily: FONT, margin: 0 }}>
        <Container
          style={{ backgroundColor: COLOR.paper, borderRadius: 16, margin: "40px auto", maxWidth: 480, padding: 32 }}
        >
          <Heading as="h1" style={{ color: COLOR.text, fontSize: 20, lineHeight: "26px", margin: "0 0 16px" }}>
            {heading}
          </Heading>
          {children}
          <Hr style={{ borderColor: COLOR.rule, margin: "24px 0 16px" }} />
          {notes?.map((note) => <EmailNote key={note}>{note}</EmailNote>)}
          {unsubscribe && (
            <EmailNote>
              <Link href={unsubscribe.url} style={{ color: COLOR.muted, textDecoration: "underline" }}>
                {unsubscribe.label}
              </Link>
            </EmailNote>
          )}
          <EmailNote>{copy.shell.signature}</EmailNote>
        </Container>
      </Body>
    </Html>
  );
}
