import NiCheck from "@/icons/nexture/ni-check";
import NiLock from "@/icons/nexture/ni-lock";
import NiRobot from "@/icons/nexture/ni-robot";
import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import { cn } from "@/lib/utils";

/**
 * The firm's side of ONE drawn with tokens, where the product's own components
 * cannot stand alone on a public page: what the firm lets ONE decide alone,
 * the model ONE makes of a document the firm already uses, and the portfolio
 * brought from a spreadsheet. The firm's window, the client's documents, the
 * petition, the package and the deadline are objects of their own
 * (firm-window.tsx, product-figures.tsx). Every word is passed in, the product's
 * own where the product has them, and every person and number is invented;
 * the page says so in a caption beside each screen.
 *
 * Closest library entries: <ProductFrame> (the chrome a screen sits in) and
 * <DataVizPlaceholder> (a token chart); neither draws any of these.
 */

/** White words on a primary fill: in dark mode the fill is the logo's blue, its -dark (blue.css). */
const ON_PRIMARY = "bg-primary text-text-contrast dark:bg-primary-dark";

/**
 * What the firm lets ONE decide alone, decision by decision: each with the
 * ways the product lets a firm choose among for it, the one in force filled.
 * The settings card of a section on the deep band: a paper card, so the
 * screen reads as one.
 */
export function AutonomyPanel({
  title,
  icon,
  rows,
  footer,
}: {
  title: string;
  /** The icon the product's own screen of these decisions carries. */
  icon: React.ReactNode;
  /**
   * Each decision by the product's own name, with only the ways the product lets a firm choose for it (the
   * catalog `autonomy_decisions`: a check of a document or an answer to a client may also be sampled, a deadline or
   * a piece never), and the one this example firm chose.
   */
  rows: { label: string; modes: string[]; mode: number }[];
  footer: string;
}) {
  return (
    <div className="border-grey-100 bg-background-paper shadow-darker-sm flex w-full flex-col gap-4 rounded-3xl border p-5 text-left sm:p-6">
      <p className="text-text-primary flex items-center gap-2 text-sm font-bold">
        <span className="text-primary flex flex-none">{icon}</span>
        {title}
      </p>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <li
            key={row.label}
            className="border-grey-100 flex flex-col gap-2 border-t pt-3 first:border-t-0 first:pt-0 lg:flex-row lg:items-center lg:justify-between lg:gap-4"
          >
            <span className="text-text-primary text-sm">{row.label}</span>
            <span
              className={cn(
                "bg-grey-50 grid flex-none gap-0.5 self-start rounded-xl p-0.5 lg:self-auto",
                row.modes.length === 3 ? "grid-cols-3" : "grid-cols-2",
              )}
            >
              {row.modes.map((mode, index) => (
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
  /** What ONE checked of the model; a figure with little to read leaves them out. */
  checks?: string[];
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
        <NiRobot size="tiny" className="text-primary flex-none" />
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
        {checks && checks.length > 0 ? (
          <ul className="border-grey-100 flex flex-col gap-2 border-t pt-4">
            {checks.map((check) => (
              <li key={check} className="text-text-primary flex items-start gap-2 text-xs leading-5">
                <NiCheck size="tiny" className="text-secondary-dark dark:text-secondary mt-0.5 flex-none" />
                {check}
              </li>
            ))}
          </ul>
        ) : null}
        <p className="text-text-secondary flex items-center gap-1.5 text-xs">
          <NiRobot size="tiny" className="flex-none" />
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
