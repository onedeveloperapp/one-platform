import { TONE, type Tone } from "@/components/marketing/tone";
import NiCheck from "@/icons/nexture/ni-check";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiLock from "@/icons/nexture/ni-lock";
import NiSearch from "@/icons/nexture/ni-search";
import NiSparkle from "@/icons/nexture/ni-sparkle";
import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import { cn } from "@/lib/utils";

/**
 * The firm's side of ONE drawn with tokens, until its screens can be captured
 * (`npm run shots:marketing`): the case as the firm follows it, a deadline
 * counted over the court's calendar, what the firm lets ONE decide alone, the
 * model ONE makes of a document the firm already uses, and the portfolio
 * brought from a spreadsheet. Every word is passed in from the `marketing`
 * namespace and every person and number is invented; the page says so in a
 * caption beside each screen. The client's side (the conversation, the link)
 * is in case-media.tsx.
 *
 * Closest library entries: <ProductFrame> (the chrome a screen sits in) and
 * <DataVizPlaceholder> (a token chart); neither draws any of these.
 */

/** White words on a primary fill: in dark mode the fill is the logo's blue, its -dark (blue.css). */
const ON_PRIMARY = "bg-primary text-text-contrast dark:bg-primary-dark";

export type CaseScreenLine = {
  /** "Agora", "Depois", "Feito". */
  label: string;
  text: string;
  when?: string;
  tone: Tone;
};

/**
 * The case as the firm sees it in ONE: a rail of icons, the search, the
 * client and the stage, the steps of the case with the current one marked,
 * what ONE does now and what comes next, and the client's papers. For the
 * frame of a deep hero: wide at md+, the steps a bar and the papers left out
 * on a phone.
 */
export function CaseScreen({
  rail,
  search,
  crumb,
  client,
  stage,
  carried,
  journey,
  steps,
  current,
  stepCount,
  lines,
  docsTitle,
  docs,
  mayErr,
}: {
  /** The icons of the app's rail; the first is the page in view. */
  rail: React.ReactNode[];
  search: string;
  crumb: string;
  client: string;
  stage: string;
  /** The line that says ONE carries the case by itself. */
  carried: string;
  journey: string;
  steps: string[];
  /** The index of the step the case is at. */
  current: number;
  /** The same as words, for a phone ("Etapa 4 de 6 · Peça"). */
  stepCount: string;
  lines: CaseScreenLine[];
  docsTitle: string;
  docs: { label: string; state: string }[];
  /** What ONE generates says it may err. */
  mayErr: string;
}) {
  return (
    <div className="bg-background flex text-left">
      <div
        aria-hidden
        className="border-grey-100 hidden w-14 flex-none flex-col items-center gap-2 border-r py-4 sm:flex"
      >
        <span className={cn("mb-2 h-7 w-7 rounded-lg", ON_PRIMARY)} />
        {rail.map((icon, index) => (
          <span
            key={index}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl",
              index === 0 ? "bg-primary/10 text-primary" : "text-text-secondary",
            )}
          >
            {icon}
          </span>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4 p-4 sm:p-6">
        <div className="flex items-center justify-between gap-4">
          <p className="text-text-secondary truncate text-xs">{crumb}</p>
          <span className="border-grey-100 bg-background-paper text-text-secondary hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs sm:flex">
            <NiSearch size="tiny" />
            {search}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="font-display text-text-primary text-xl font-bold sm:text-2xl">{client}</p>
          <span className="bg-primary/10 text-text-primary rounded-full px-2.5 py-1 text-xs font-semibold">
            {stage}
          </span>
          <span className="bg-secondary/15 text-text-primary flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold">
            <NiSparkle size="tiny" className="text-secondary-dark dark:text-secondary" />
            {carried}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1.65fr_1fr]">
          <div className="border-grey-100 bg-background-paper flex flex-col gap-4 rounded-2xl border p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-text-primary text-sm font-bold">{journey}</p>
              <p className="text-text-secondary text-xs sm:hidden">{stepCount}</p>
            </div>

            {/* A phone: the steps as a bar. */}
            <div aria-hidden className="bg-grey-50 h-2 overflow-hidden rounded-full sm:hidden">
              <div
                className="bg-primary h-full rounded-full"
                style={{ width: `${((current + 0.5) / steps.length) * 100}%` }}
              />
            </div>

            <ol className="hidden items-start sm:flex">
              {steps.map((step, index) => (
                <li key={step} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                  <div className="flex w-full items-center">
                    <span
                      aria-hidden
                      className={cn(
                        "h-0.5 flex-1",
                        index === 0 ? "bg-transparent" : index <= current ? "bg-primary" : "bg-grey-100",
                      )}
                    />
                    <span
                      aria-hidden
                      className={cn(
                        "flex h-7 w-7 flex-none items-center justify-center rounded-full",
                        index < current && ON_PRIMARY,
                        index === current && "bg-primary/10 ring-primary ring-2",
                        index > current && "bg-grey-50",
                      )}
                    >
                      {index < current && <NiCheck size="tiny" />}
                      {index === current && <span className="bg-primary h-2 w-2 rounded-full" />}
                    </span>
                    <span
                      aria-hidden
                      className={cn(
                        "h-0.5 flex-1",
                        index === steps.length - 1 ? "bg-transparent" : index < current ? "bg-primary" : "bg-grey-100",
                      )}
                    />
                  </div>
                  <span
                    className={cn(
                      "w-full truncate text-center text-xs",
                      index === current ? "text-text-primary font-bold" : "text-text-secondary",
                    )}
                  >
                    {step}
                  </span>
                </li>
              ))}
            </ol>

            <ul className="border-grey-100 flex flex-col gap-3 border-t pt-4">
              {lines.map((line) => (
                <li key={line.label} className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-1.5 h-2 w-2 flex-none rounded-full"
                    style={{ backgroundColor: `hsl(var(${TONE[line.tone].cssVar}))` }}
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
                    <span className="text-text-secondary w-16 flex-none text-xs font-bold">{line.label}</span>
                    <span className="text-text-primary text-sm leading-5">{line.text}</span>
                    {line.when && (
                      <span className="text-text-secondary text-xs sm:ml-auto sm:flex-none">{line.when}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            <p className="text-text-secondary flex items-center gap-1.5 text-xs">
              <NiSparkle size="tiny" className="flex-none" />
              {mayErr}
            </p>
          </div>

          <div className="border-grey-100 bg-background-paper hidden flex-col gap-3 rounded-2xl border p-5 md:flex">
            <p className="text-text-primary text-sm font-bold">{docsTitle}</p>
            <ul className="flex flex-col gap-2.5">
              {docs.map((doc) => (
                <li key={doc.label} className="flex items-center gap-3">
                  <span className="bg-accent-1/10 text-accent-1 flex h-8 w-8 flex-none items-center justify-center rounded-xl">
                    <NiDocumentCheck size="small" />
                  </span>
                  <span className="text-text-primary min-w-0 flex-1 truncate text-sm">{doc.label}</span>
                  <span className="bg-grey-50 text-text-primary flex-none rounded-full px-2 py-0.5 text-xs font-semibold">
                    {doc.state}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

export type CalendarMark = "available" | "published" | "counted" | "holiday" | "last";

/**
 * A deadline counted over the court's calendar: the month with the days that
 * counted tinted, the court's holiday and the weekends left out, and the last
 * day in the primary. The grey panel is a feature row's surface, like the
 * client's link beside it.
 */
export function DeadlineCalendar({
  act,
  term,
  due,
  month,
  weekdays,
  firstWeekday,
  days,
  marks,
  legend,
  note,
}: {
  /** What the term is for ("Manifestação"). */
  act: string;
  /** "15 dias úteis". */
  term: string;
  /** "Vence 27/11". */
  due: string;
  /** "Novembro de 2026". */
  month: string;
  /** Seven initials, Sunday first. */
  weekdays: string[];
  /** The weekday of the 1st, 0 for Sunday. */
  firstWeekday: number;
  days: number;
  marks: Partial<Record<number, CalendarMark>>;
  legend: { counted: string; holiday: string; last: string };
  note: string;
}) {
  const cells = [...Array.from({ length: firstWeekday }, () => 0), ...Array.from({ length: days }, (_, i) => i + 1)];
  const style = (day: number) => {
    const weekday = (firstWeekday + day - 1) % 7;
    const mark = marks[day];
    if (mark === "last") return cn(ON_PRIMARY, "font-bold");
    if (mark === "counted") return "bg-accent-1/15 text-text-primary font-semibold";
    if (mark === "holiday") return "bg-accent-4/20 text-text-primary";
    if (mark === "published" || mark === "available") return "ring-grey-200 text-text-primary ring-1 ring-inset";
    return weekday === 0 || weekday === 6 ? "text-text-secondary/70" : "text-text-secondary";
  };
  return (
    <div className="bg-grey-50 flex flex-col items-center rounded-4xl px-5 py-8 md:px-10 md:py-12">
      <div className="border-grey-100 bg-background-paper shadow-darker-sm flex w-full max-w-sm flex-col gap-4 rounded-3xl border p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <p className="text-text-primary text-sm font-bold">{act}</p>
            <p className="text-text-secondary text-xs">{term}</p>
          </div>
          <span className="bg-primary/10 text-text-primary rounded-full px-2.5 py-1 text-xs font-bold">{due}</span>
        </div>
        <p className="text-text-secondary text-xs font-semibold">{month}</p>
        <div className="grid grid-cols-7 gap-1 text-center">
          {weekdays.map((weekday, index) => (
            <span key={index} aria-hidden className="text-text-secondary py-1 text-xs font-bold">
              {weekday}
            </span>
          ))}
          {cells.map((day, index) =>
            day === 0 ? (
              <span key={`empty-${index}`} aria-hidden />
            ) : (
              <span
                key={day}
                className={cn("flex h-8 items-center justify-center rounded-lg text-xs tabular-nums", style(day))}
              >
                {day}
              </span>
            ),
          )}
        </div>
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
          {(
            [
              ["bg-accent-1/30", legend.counted],
              ["bg-accent-4/40", legend.holiday],
              [ON_PRIMARY, legend.last],
            ] as const
          ).map(([swatch, label]) => (
            <li key={label} className="text-text-secondary flex items-center gap-1.5 text-xs">
              <span aria-hidden className={cn("h-2.5 w-2.5 rounded-sm", swatch)} />
              {label}
            </li>
          ))}
        </ul>
        <p className="text-text-secondary border-grey-100 border-t pt-3 text-xs leading-5">{note}</p>
      </div>
    </div>
  );
}

/**
 * What the firm lets ONE decide alone, decision by decision: each with the
 * three ways a firm chooses among, the one in force filled. The settings card
 * of a section on the deep band: a paper card, so the screen reads as one.
 */
export function AutonomyPanel({
  title,
  modes,
  rows,
  footer,
}: {
  title: string;
  /** ONE decides · a share is checked · a person decides. */
  modes: [string, string, string];
  rows: { label: string; mode: 0 | 1 | 2 }[];
  footer: string;
}) {
  return (
    <div className="border-grey-100 bg-background-paper shadow-darker-sm flex w-full flex-col gap-4 rounded-3xl border p-5 text-left sm:p-6">
      <p className="text-text-primary flex items-center gap-2 text-sm font-bold">
        <NiSparkle size="small" className="text-primary flex-none" />
        {title}
      </p>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li
            key={row.label}
            className="border-grey-100 flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0 lg:flex-row lg:items-center lg:justify-between lg:gap-4"
          >
            <span className="text-text-primary text-sm">{row.label}</span>
            <span className="bg-grey-50 grid flex-none grid-cols-3 gap-0.5 rounded-xl p-0.5">
              {modes.map((mode, index) => (
                <span
                  key={mode}
                  className={cn(
                    "rounded-lg px-2 py-1 text-center text-xs font-semibold whitespace-nowrap",
                    index === row.mode ? ON_PRIMARY : "text-text-secondary",
                  )}
                >
                  {mode}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-text-secondary border-grey-100 flex items-center gap-1.5 border-t pt-3 text-xs">
        <NiLock size="tiny" className="flex-none" />
        {footer}
      </p>
    </div>
  );
}

/**
 * A mark ONE fills for each client inside a model's text ("[[NOME]]"), set
 * apart from the firm's own words. For a rich message:
 * `t.rich(key, { m: (chunks) => <ModelMark>{chunks}</ModelMark> })`.
 */
export function ModelMark({ children }: { children: React.ReactNode }) {
  return (
    <span className="bg-secondary/15 text-text-primary mx-0.5 rounded-md px-1.5 py-0.5 font-mono text-xs font-semibold whitespace-nowrap">
      {children}
    </span>
  );
}

/**
 * The firm's own document becoming a model of ONE: the file the firm sent,
 * what ONE did with it, and the model with the marks where each client's
 * facts go, highlighted. The grey panel is a feature row's surface.
 */
export function ModelImportPanel({
  fileName,
  fileMeta,
  step,
  modelTitle,
  modelBadge,
  text,
  checks,
  mayErr,
}: {
  fileName: string;
  fileMeta: string;
  /** What ONE did between the file and the model. */
  step: string;
  modelTitle: string;
  modelBadge: string;
  /** The model's text, its marks in <ModelMark>. */
  text: React.ReactNode;
  checks: string[];
  mayErr: string;
}) {
  return (
    <div className="bg-grey-50 flex flex-col gap-4 rounded-4xl px-5 py-8 md:px-10 md:py-12">
      <div className="border-grey-100 bg-background-paper flex items-center gap-3 self-start rounded-2xl border px-4 py-3 shadow-2xs">
        <span className="bg-grey-50 text-text-secondary flex h-9 w-9 flex-none items-center justify-center rounded-xl">
          <NiUploadCloud size="small" />
        </span>
        <div className="flex min-w-0 flex-col">
          <p className="text-text-primary truncate text-sm font-bold">{fileName}</p>
          <p className="text-text-secondary text-xs">{fileMeta}</p>
        </div>
      </div>

      <p className="text-text-secondary flex items-center gap-2 pl-4 text-xs font-semibold">
        <span aria-hidden className="bg-grey-200 h-6 w-px" />
        <NiSparkle size="tiny" className="text-primary flex-none" />
        {step}
      </p>

      <div className="border-grey-100 bg-background-paper shadow-darker-sm flex flex-col gap-4 rounded-3xl border p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-text-primary text-sm font-bold">{modelTitle}</p>
          <span className="bg-secondary/15 text-text-primary rounded-full px-2.5 py-1 text-xs font-semibold">
            {modelBadge}
          </span>
        </div>
        <p className="text-text-primary text-sm leading-7">{text}</p>
        <ul className="border-grey-100 flex flex-col gap-2 border-t pt-4">
          {checks.map((check) => (
            <li key={check} className="text-text-primary flex items-start gap-2 text-xs leading-5">
              <NiCheck size="tiny" className="text-secondary-dark dark:text-secondary mt-0.5 flex-none" />
              {check}
            </li>
          ))}
        </ul>
        <p className="text-text-secondary flex items-center gap-1.5 text-xs">
          <NiSparkle size="tiny" className="flex-none" />
          {mayErr}
        </p>
      </div>
    </div>
  );
}

export type ImportRowKind = "open" | "known" | "unread";

const IMPORT_KIND: Record<ImportRowKind, string> = {
  open: "bg-primary",
  known: "bg-grey-300",
  unread: "bg-accent-4",
};

/**
 * The portfolio a firm brings from the spreadsheet of the system it used
 * before, as ONE shows it before anything is written: each line with what it
 * will do, and the count of the file. The grey panel is a feature row's
 * surface.
 */
export function PortfolioImportPanel({
  fileName,
  fileMeta,
  columns,
  rows,
  summary,
}: {
  fileName: string;
  fileMeta: string;
  /** The lawsuit's number, the client, what the line does. */
  columns: [string, string, string];
  rows: { number: string; client: string; result: string; kind: ImportRowKind }[];
  summary: { label: string; kind: ImportRowKind }[];
}) {
  return (
    <div className="bg-grey-50 flex flex-col rounded-4xl px-4 py-8 md:px-8 md:py-12">
      <div className="border-grey-100 bg-background-paper shadow-darker-sm flex flex-col overflow-hidden rounded-3xl border">
        <div className="border-grey-100 flex items-center gap-3 border-b px-5 py-4">
          <span className="bg-accent-4/15 text-accent-4 flex h-9 w-9 flex-none items-center justify-center rounded-xl">
            <NiUploadCloud size="small" />
          </span>
          <div className="flex min-w-0 flex-col">
            <p className="text-text-primary truncate text-sm font-bold">{fileName}</p>
            <p className="text-text-secondary text-xs">{fileMeta}</p>
          </div>
        </div>
        <div className="text-text-secondary grid grid-cols-[1fr_auto] gap-3 px-5 pt-3 pb-1 text-xs font-bold sm:grid-cols-[1.4fr_1fr_auto]">
          <span>{columns[0]}</span>
          <span className="hidden sm:block">{columns[1]}</span>
          <span>{columns[2]}</span>
        </div>
        <ul className="flex flex-col">
          {rows.map((row) => (
            <li
              key={row.number}
              className="border-grey-100 grid grid-cols-[1fr_auto] items-center gap-3 border-t px-5 py-2.5 first:border-t-0 sm:grid-cols-[1.4fr_1fr_auto]"
            >
              <span className="text-text-primary truncate font-mono text-xs">{row.number}</span>
              <span className="text-text-secondary hidden truncate text-xs sm:block">{row.client}</span>
              <span className="text-text-primary flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap">
                <span aria-hidden className={cn("h-2 w-2 flex-none rounded-full", IMPORT_KIND[row.kind])} />
                {row.result}
              </span>
            </li>
          ))}
        </ul>
        <ul className="bg-grey-25 border-grey-100 flex flex-wrap gap-x-5 gap-y-1.5 border-t px-5 py-3">
          {summary.map((item) => (
            <li key={item.label} className="text-text-primary flex items-center gap-1.5 text-xs font-semibold">
              <span aria-hidden className={cn("h-2 w-2 flex-none rounded-full", IMPORT_KIND[item.kind])} />
              {item.label}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
