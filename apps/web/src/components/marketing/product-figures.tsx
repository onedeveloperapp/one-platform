import { getTranslations } from "next-intl/server";

import {
  type CalendarDayKind,
  calendarMonthOf,
  EXAMPLE_DEADLINE,
  EXAMPLE_PACKAGE_NAMES,
  EXAMPLE_SYSTEM,
} from "@/components/marketing/product-examples";
import StatusChip from "@/components/product/status-chip";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiCamera from "@/icons/nexture/ni-camera";
import NiCheck from "@/icons/nexture/ni-check";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiExclamationSquare from "@/icons/nexture/ni-exclamation-square";
import NiUser from "@/icons/nexture/ni-user";
import { cn } from "@/lib/utils";
import { formatDayBr } from "@flyee/rules/person";

/**
 * Objects of the product for the public home, each one drawn to be recognized before a word is read: two photos of a
 * document, a sheet of a petition, the calendar of a month, a folder of files (the demonstration guide of the sales-page
 * skill: its first choice, a replica; a figure says what it is without its letters). What is computed is computed by the
 * product's own rule (the deadline by `prazo-v1`, the package's names by `planFiling`, in product-examples.ts), and the
 * words the product has are the product's, so the figure changes when the rule does.
 *
 * Every figure is a picture: one name for a screen reader (`role="img"`), nothing inside it to focus, and no heading of
 * the product enters the page's outline. The data are invented, and the section says so in a caption ("Exemplo fictício").
 */

/** The surface a figure sits on: a plate of the page's grey, so the object reads as lying on a table. */
const PLATE = "bg-grey-50 relative flex flex-col rounded-4xl px-5 py-8 sm:px-10 sm:py-12";
const PAPER = "border-grey-100 bg-background-paper shadow-darker-sm rounded-2xl border";
/** A white mark on the blue: in dark mode the fill is the logo's blue (blue.css). */
const ON_PRIMARY = "bg-primary text-text-contrast dark:bg-primary-dark";

/** A line of text no one needs to read: its length is all it says. */
function Bar({ width, className }: { width: string; className?: string }) {
  return <span className={cn("bg-grey-100 block h-2 rounded-full", className)} style={{ width }} />;
}

/** An identity card as a photo shows it: the portrait on one side, the lines of its data on the other. */
function IdentityPhoto() {
  return (
    <div className="border-grey-100 bg-grey-25 flex aspect-[16/9] gap-3 rounded-xl border p-3">
      <span className="text-text-secondary relative flex w-1/3 flex-none items-center justify-center">
        <span className="bg-grey-100 absolute inset-0 rounded-lg" />
        <NiUser size="large" className="relative" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-2.5">
        <Bar width="85%" className="bg-grey-200" />
        <Bar width="60%" />
        <Bar width="72%" />
        <Bar width="40%" />
      </span>
    </div>
  );
}

/** A bill photographed in a dark room: the same lines under a shadow, and the mark that stopped it. */
function DarkPhoto() {
  return (
    <div className="bg-background-deep relative flex aspect-[16/9] flex-col justify-center gap-2.5 overflow-hidden rounded-xl p-4">
      <Bar width="55%" className="bg-text-contrast/25" />
      <Bar width="80%" className="bg-text-contrast/15" />
      <Bar width="70%" className="bg-text-contrast/15" />
      <Bar width="35%" className="bg-text-contrast/15" />
      <span className="bg-accent-3 text-text-contrast absolute top-1/2 left-1/2 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full">
        <NiExclamationSquare size="medium" />
      </span>
    </div>
  );
}

/** Two photos of a client's papers, one over the other: the identity accepted, the bill too dark, sent back. */
export async function DocumentsFigure({ label }: { label: string }) {
  const t = await getTranslations("product");
  return (
    <div role="img" aria-label={label} data-figura="documentos-conferidos">
      <div className={PLATE}>
        {/* Its words over the photo: the photo that follows lies over the foot of this one, never over what it says. */}
        <div className={cn(PAPER, "relative w-4/5 -rotate-2 p-3 sm:p-4")}>
          <div className="mb-3 flex flex-wrap items-center gap-2 pr-6">
            <span className="text-text-primary text-sm font-bold">{t("case-document-identity")}</span>
            <StatusChip tone="positive" label={t("case-document-status-accepted")} />
          </div>
          <IdentityPhoto />
          <span className="bg-success text-text-contrast absolute -top-3 -right-3 flex h-10 w-10 items-center justify-center rounded-full">
            <NiCheck size="medium" />
          </span>
        </div>
        <div className={cn(PAPER, "relative z-10 -mt-10 ml-auto w-4/5 rotate-2 p-3 sm:p-4")}>
          <DarkPhoto />
          <p className="text-text-primary mt-3 text-sm font-bold">{t("client-photo-poor-title")}</p>
          <span
            className={cn("mt-2 inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold", ON_PRIMARY)}
          >
            <NiCamera size="tiny" />
            {t("client-photo-retake")}
          </span>
        </div>
      </div>
    </div>
  );
}

/** How long each line of the sheet runs: the shape of a text, and all a reader needs of it. */
const PIECE_LINES = [
  ["100%", "94%", "98%", "62%"],
  ["96%", "100%", "90%", "97%", "44%"],
];

/** A petition on its sheet, what is left to complete marked in it, and what it cites, each source checked. */
export function PieceFigure({
  label,
  heading,
  badge,
  gap,
  sourcesTitle,
  sources,
  sourceState,
}: {
  label: string;
  heading: string;
  badge: string;
  /** What is left to complete, as the text says it. */
  gap: string;
  sourcesTitle: string;
  sources: string[];
  /** The word beside each source: the library answers for it. */
  sourceState: string;
}) {
  return (
    <div role="img" aria-label={label} data-figura="peticao-escrita">
      <div className={PLATE}>
        <div className={cn(PAPER, "flex w-11/12 flex-col gap-4 p-5 sm:p-7")}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-heading text-text-primary text-base font-bold">{heading}</span>
            <StatusChip tone="primary" label={badge} />
          </div>
          {PIECE_LINES.map((lines, paragraph) => (
            <div key={paragraph} className="flex flex-col gap-2.5">
              {lines.map((width, line) => (
                <Bar key={line} width={width} />
              ))}
            </div>
          ))}
          <span className="bg-accent-4/20 text-text-primary self-start rounded-md px-2 py-1 font-mono text-xs font-semibold">
            {gap}
          </span>
          {/* Room at the foot of the sheet: the card of what it cites lies there, over no line of it. */}
          <div className="flex flex-col gap-2.5 pb-20">
            <Bar width="92%" />
            <Bar width="70%" />
          </div>
        </div>
        <div className={cn(PAPER, "relative z-10 -mt-20 ml-auto flex w-3/4 flex-col gap-2 p-4 sm:w-2/3")}>
          <span className="text-text-primary text-xs font-bold">{sourcesTitle}</span>
          {sources.map((source) => (
            <span key={source} className="flex items-center gap-2 text-xs">
              <NiCheck size="tiny" className="text-success flex-none" />
              <span className="text-text-primary min-w-0 flex-1">{source}</span>
              <span className="text-text-secondary whitespace-nowrap max-sm:hidden">{sourceState}</span>
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/** How each day of the month reads on the calendar. */
const DAY_STYLE: Record<CalendarDayKind, string> = {
  plain: "text-text-secondary",
  weekend: "text-text-secondary bg-grey-25",
  published: "text-text-primary font-bold ring-2 ring-inset ring-grey-300",
  counted: "text-text-primary font-semibold bg-primary/10",
  holiday: "text-text-primary font-bold bg-accent-4/25",
  due: cn("font-bold shadow-darker-sm", ON_PRIMARY),
};

const titleOf = (year: number, month: number): string => {
  const name = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, 15)));
  return name.charAt(0).toUpperCase() + name.slice(1);
};

const weekdayOf = (day: string): string =>
  new Intl.DateTimeFormat("pt-BR", { weekday: "long", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));

/** One narrow letter a day of the week, Sunday first (a month of 2023 that opens on a Sunday). */
const WEEK = Array.from({ length: 7 }, (_, index) =>
  new Intl.DateTimeFormat("pt-BR", {
    weekday: "narrow",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2023, 0, 1 + index))),
);

/** The month a deadline ends in, as ONE counted it: each day counted, the holiday left out, and the last day. */
export async function CalendarFigure({
  label,
  published,
  counted,
  holiday,
}: {
  label: string;
  /** The words of the legend. */
  published: string;
  counted: string;
  holiday: string;
}) {
  if (!EXAMPLE_DEADLINE.ok) return null;
  const t = await getTranslations("product");
  const count = EXAMPLE_DEADLINE.result;
  const month = calendarMonthOf(count);
  const legend = [
    {
      key: "published",
      text: published,
      mark: "ring-2 ring-inset ring-grey-300",
    },
    { key: "counted", text: counted, mark: "bg-primary/10" },
    { key: "holiday", text: holiday, mark: "bg-accent-4/25" },
  ];
  return (
    <div role="img" aria-label={label} data-figura="calendario-prazo">
      <div className={PLATE}>
        {/* Room at the foot of the page: the card of the day it ends lies there, under the legend. */}
        <div className={cn(PAPER, "flex flex-col gap-4 p-4 pb-12 sm:p-6 sm:pb-14")}>
          <span className="font-heading text-text-primary text-base font-bold">{titleOf(month.year, month.month)}</span>
          <div className="grid grid-cols-7 gap-1 sm:gap-1.5">
            {WEEK.map((letter, index) => (
              <span key={index} className="text-text-secondary py-1 text-center text-xs font-bold">
                {letter.toUpperCase()}
              </span>
            ))}
            {Array.from({ length: month.leading }, (_, index) => (
              <span key={`blank-${index}`} />
            ))}
            {month.days.map((day) => (
              <span
                key={day.iso}
                className={cn(
                  "flex aspect-square items-center justify-center rounded-lg text-sm tabular-nums",
                  DAY_STYLE[day.kind],
                )}
              >
                {day.day}
              </span>
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1.5">
            {legend.map((item) => (
              <span key={item.key} className="text-text-secondary flex items-center gap-1.5 text-xs">
                <span className={cn("h-3 w-3 flex-none rounded", item.mark)} />
                {item.text}
              </span>
            ))}
          </div>
        </div>
        <div
          className={cn(
            PAPER,
            "relative z-10 -mt-6 ml-auto flex items-center gap-3 self-end px-4 py-3 sm:-mt-8 sm:-mr-4",
          )}
        >
          <span className="bg-primary/10 text-primary flex h-9 w-9 flex-none items-center justify-center rounded-xl">
            <NiCalendarClock size="small" />
          </span>
          <span className="text-text-primary text-sm font-bold">
            {t("deadline-due-on", {
              day: formatDayBr(count.dueOn) ?? count.dueOn,
              weekday: weekdayOf(count.dueOn),
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

/** The filing package of a lawsuit as an open folder: its files in the order of the filing, under the rule's names. */
export async function PackageFigure({ label }: { label: string }) {
  const t = await getTranslations("product");
  return (
    <div role="img" aria-label={label} data-figura="pasta-protocolo">
      <div className="relative pt-5">
        {/* The folder's tab ends where its body starts: both of one tint, a single shape. */}
        <span className="bg-accent-4/25 absolute top-0 left-8 h-5 w-36 rounded-t-xl" />
        <div className="bg-accent-4/25 relative flex flex-col gap-3 rounded-3xl p-4 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-heading text-text-primary text-base font-bold">{EXAMPLE_SYSTEM}</span>
            <StatusChip tone="positive" label={t("filing-status-ready")} className="bg-background-paper!" />
          </div>
          <ol className="m-0 flex list-none flex-col gap-2 p-0">
            {EXAMPLE_PACKAGE_NAMES.map((name) => (
              <li
                key={name}
                className="border-grey-100 bg-background-paper flex items-center gap-3 rounded-xl border px-3 py-2.5 shadow-2xs"
              >
                <NiDocumentFull size="small" className="text-primary flex-none" />
                <span className="text-text-primary min-w-0 font-mono text-xs break-words">{name}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
