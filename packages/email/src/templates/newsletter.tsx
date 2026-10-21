import { Markdown } from "@react-email/components";

import { emailCopyFor } from "../copy";
import type { EmailLocale } from "../locale";
import EmailShell, { COLOR } from "./shell";

export type NewsletterEmailProps = {
  locale: EmailLocale;
  /** The heading of the message (the subject line says the same). */
  heading: string;
  /** What the operator wrote, in Markdown. Raw HTML in it is not rendered. */
  bodyMarkdown: string;
  /** One-click address that takes this reader off the list (also sent as List-Unsubscribe). */
  unsubscribeUrl: string;
};

const paragraph = { color: COLOR.text, fontSize: "14px", lineHeight: "22px", margin: "0 0 16px" };

/**
 * A message the operator writes to the confirmed list (the opening notice, the
 * news): the text is theirs, the frame is ours. Every send says why the reader
 * is getting it and lets them leave in one click, in the body and in the
 * header.
 */
export default function NewsletterEmail({ locale, heading, bodyMarkdown, unsubscribeUrl }: NewsletterEmailProps) {
  const copy = emailCopyFor(locale).newsletter;
  return (
    <EmailShell
      locale={locale}
      preview={heading}
      heading={heading}
      notes={[copy.reason]}
      unsubscribe={{ label: copy.unsubscribe, url: unsubscribeUrl }}
    >
      <Markdown
        markdownCustomStyles={{
          p: paragraph,
          li: { ...paragraph, margin: "0 0 6px" },
          h1: { color: COLOR.text, fontSize: "18px", lineHeight: "24px", margin: "0 0 12px" },
          h2: { color: COLOR.text, fontSize: "16px", lineHeight: "22px", margin: "0 0 12px" },
          h3: { color: COLOR.text, fontSize: "14px", lineHeight: "22px", margin: "0 0 8px" },
          link: { color: COLOR.text, textDecoration: "underline" },
          codeInline: { fontFamily: "Consolas, Menlo, monospace", fontSize: "13px" },
        }}
        markdownContainerStyles={{ margin: "0 0 8px" }}
      >
        {bodyMarkdown}
      </Markdown>
    </EmailShell>
  );
}
