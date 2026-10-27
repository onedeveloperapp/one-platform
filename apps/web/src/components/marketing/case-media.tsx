import NiBriefcase from "@/icons/nexture/ni-briefcase";
import NiLink from "@/icons/nexture/ni-link";
import NiSendRight from "@/icons/nexture/ni-send-right";
import { cn } from "@/lib/utils";

/**
 * The product evidence of ONE's public pages, drawn with tokens until the
 * screens can be captured (`npm run shots:marketing`): what a client sees on
 * the firm's WhatsApp, the link of the case with what it gathered, and the
 * firm's cases by stage. Every word is passed in from the `marketing`
 * namespace; the data is an example, and the page says so in a caption beside
 * the media. Closest library entries: <ProductFrame> (the chrome these sit in)
 * and <DataVizPlaceholder> (a token chart standing for a screenshot); neither
 * draws a conversation, a link or a stage chart, which is why these exist.
 */

export type ChatMessage = {
  /** The firm's assistant on the left, the client on the right, as on the client's own phone. */
  from: "firm" | "client";
  text: string;
  time: string;
  /** A link the message carries, as WhatsApp previews it. */
  link?: string;
};

/** A client's conversation with the firm's WhatsApp number, for a <PhoneFrame>. */
export function ClientChat({
  firm,
  status,
  messages,
  inputLabel,
}: {
  /** Who the client is talking to: always the firm, never the platform. */
  firm: string;
  status: string;
  messages: ChatMessage[];
  inputLabel: string;
}) {
  return (
    <div className="flex flex-col">
      <div className="border-grey-100 flex items-center gap-3 border-b px-4 pb-3">
        {/* A white mark on a blue fill: in dark mode the fill is the logo's blue, its -dark (blue.css). */}
        <span className="bg-primary text-text-contrast dark:bg-primary-dark flex h-9 w-9 flex-none items-center justify-center rounded-full">
          <NiBriefcase size="small" />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="text-text-primary truncate text-sm font-bold">{firm}</p>
          <p className="text-text-secondary text-xs">{status}</p>
        </div>
      </div>
      <ol className="bg-grey-25 flex flex-col gap-2 px-3 py-4">
        {messages.map((message, index) => (
          <li
            key={index}
            className={cn(
              "flex flex-col gap-1.5 rounded-2xl px-3 py-2 text-sm leading-5 shadow-2xs",
              message.from === "firm"
                ? "bg-background-paper text-text-primary mr-8 self-start rounded-tl-md"
                : "bg-primary text-text-contrast dark:bg-primary-dark ml-8 self-end rounded-tr-md",
            )}
          >
            <span>{message.text}</span>
            {message.link && (
              <span className="border-grey-100 bg-grey-25 text-text-primary flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-bold">
                <NiLink size="tiny" className="text-primary flex-none" />
                {message.link}
              </span>
            )}
            {/* The client's time keeps the bubble's own white: a dimmed white reads 3.4:1 on the blue. */}
            <span className={cn("self-end text-xs", message.from === "firm" && "text-text-secondary")}>
              {message.time}
            </span>
          </li>
        ))}
      </ol>
      <div aria-hidden className="flex items-center gap-2 px-3 py-3">
        <span className="border-grey-100 text-text-secondary flex-1 rounded-full border px-4 py-2 text-xs">
          {inputLabel}
        </span>
        <span className="bg-primary text-text-contrast dark:bg-primary-dark flex h-8 w-8 flex-none items-center justify-center rounded-full">
          <NiSendRight size="tiny" />
        </span>
      </div>
    </div>
  );
}

/**
 * The link of a case as the firm follows it: what it gathered over what the
 * case asks, and below it the papers a client sends through it, each with its
 * icon. The grey panel is the feature row's own surface.
 */
export function ClientLinkPanel({
  firm,
  label,
  value,
  caption,
  documentsLabel,
  documents,
}: {
  firm: string;
  /** What the value counts ("Documentos aceitos"). */
  label: string;
  value: string;
  /** Whose link it is. */
  caption: string;
  documentsLabel: string;
  documents: { icon: React.ReactNode; label: string }[];
}) {
  return (
    <div className="bg-grey-50 flex flex-col items-center gap-8 rounded-4xl px-6 py-10 md:px-10 md:py-14">
      <div className="border-grey-100 bg-background-paper shadow-darker-sm flex w-full max-w-sm flex-col gap-5 rounded-3xl border p-6">
        <div className="flex items-center justify-between gap-3">
          <span className="bg-primary/10 text-primary flex h-10 w-10 items-center justify-center rounded-2xl">
            <NiLink size="small" />
          </span>
          <span className="text-text-secondary truncate text-xs font-bold">{firm}</span>
        </div>
        <div className="flex flex-col gap-1">
          <p className="text-text-secondary text-sm">{label}</p>
          <p className="font-display text-display-md text-text-primary font-extrabold tabular-nums">{value}</p>
          <p className="text-text-secondary text-sm">{caption}</p>
        </div>
        <div aria-hidden className="bg-grey-50 h-2 overflow-hidden rounded-full">
          <div className="bg-primary h-full w-full rounded-full" />
        </div>
      </div>
      <div className="flex flex-col items-center gap-3">
        <p className="text-text-secondary text-sm">{documentsLabel}</p>
        <ul className="flex flex-wrap justify-center gap-2">
          {documents.map((document) => (
            <li key={document.label} className="flex w-18 flex-col items-center gap-1.5">
              <span className="border-grey-100 bg-background-paper text-text-primary flex h-12 w-12 items-center justify-center rounded-2xl border shadow-2xs">
                {document.icon}
              </span>
              <span className="text-text-secondary text-center text-xs">{document.label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/**
 * The firm's cases by stage, as a bar each, the stage the eye should land on
 * in the primary: the central card of a <ProductComposition>.
 */
export function CaseStageChart({
  title,
  total,
  stages,
  highlight,
}: {
  title: string;
  total: string;
  stages: { label: string; value: number }[];
  /** The index of the stage drawn in the primary. */
  highlight?: number;
}) {
  const max = Math.max(...stages.map((stage) => stage.value), 1);
  const share = (value: number) => `${Math.round((value / max) * 100)}%`;
  const fill = (index: number) => (index === highlight ? "bg-primary" : "bg-grey-100");
  return (
    // A container: the card is narrow on a phone and again beside the copy of a feature row at 960px,
    // so it lays out by its own width, not the screen's.
    <div className="border-grey-100 bg-background-paper shadow-darker-xs @container w-full rounded-3xl border p-6">
      {/* The count under its title, at the left: the corner on the right is where a composition puts its satellite. */}
      <div className="flex flex-col gap-1">
        <p className="text-text-secondary text-sm">{title}</p>
        <p className="font-display text-text-primary text-3xl font-bold tabular-nums">{total}</p>
      </div>

      {/* Too narrow for five names under five columns: each stage is a row, its name beside its bar. */}
      <ul className="mt-5 flex flex-col gap-3 @sm:hidden">
        {stages.map((stage, index) => (
          <li key={stage.label} className="grid grid-cols-[6rem_1fr] items-center gap-3">
            <span className="text-text-secondary text-xs">{stage.label}</span>
            <span aria-hidden className={cn("h-3 rounded-full", fill(index))} style={{ width: share(stage.value) }} />
          </li>
        ))}
      </ul>

      <div className="hidden @sm:block">
        <div aria-hidden className="mt-6 flex h-40 items-end gap-3">
          {stages.map((stage, index) => (
            <div key={stage.label} className="flex h-full min-w-0 flex-1 flex-col justify-end">
              <div
                className={cn("w-full rounded-t-xl rounded-b-md", fill(index))}
                style={{ height: share(stage.value) }}
              />
            </div>
          ))}
        </div>
        <ul className="mt-3 flex gap-3">
          {stages.map((stage) => (
            <li key={stage.label} className="text-text-secondary min-w-0 flex-1 truncate text-center text-xs">
              {stage.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
