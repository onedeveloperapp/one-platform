import Logo from "@/components/logo/logo";
import ProductFrame from "@/components/marketing/product-frame";
import { TONE, type Tone } from "@/components/marketing/tone";
import NiAnnouncement from "@/icons/nexture/ni-announcement";
import NiBell from "@/icons/nexture/ni-bell";
import NiBook from "@/icons/nexture/ni-book";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiChartBar from "@/icons/nexture/ni-chart-bar";
import NiFolder from "@/icons/nexture/ni-folder";
import NiHome from "@/icons/nexture/ni-home";
import NiMessages from "@/icons/nexture/ni-messages";
import NiPlus from "@/icons/nexture/ni-plus";
import NiPuzzle from "@/icons/nexture/ni-puzzle";
import NiScale from "@/icons/nexture/ni-scale";
import NiSearch from "@/icons/nexture/ni-search";
import { cn } from "@/lib/utils";

export type WindowNumber = {
  /** Pass the icon at `size="small"`. */
  icon: React.ReactNode;
  tone: Tone;
  label: string;
  value: string;
  delta?: string;
};

export type WindowCase = {
  seq: number;
  client: string;
  /** How long it is at its step, in the list's words. */
  days: string;
  /** Who has it, in the list's word, and the family hue on its dot. */
  holder: string;
  holderTone: Tone;
};

export type WindowColumn = {
  key: string;
  label: string;
  total: string;
  cases: WindowCase[];
};

export type WindowPendingGroup = {
  title: string;
  items: { icon: React.ReactNode; tone: Tone; text: string }[];
};

/** The firm's menu as the product draws it, a thin rail of icons in its own order (menu-items.ts), at its own page. */
const RAIL = [
  { key: "home", icon: <NiHome size="small" /> },
  { key: "modules", icon: <NiPuzzle size="small" /> },
  { key: "cases", icon: <NiFolder size="small" /> },
  { key: "oversight", icon: <NiChartBar size="small" />, current: true },
  { key: "conversations", icon: <NiMessages size="small" /> },
  { key: "filing", icon: <NiScale size="small" /> },
  { key: "publications", icon: <NiAnnouncement size="small" /> },
  { key: "deadlines", icon: <NiCalendarClock size="small" /> },
  { key: "hearings", icon: <NiCalendar size="small" /> },
  { key: "library", icon: <NiBook size="small" /> },
];

/**
 * The whole system at a glance, the figure of the top of the home (the demonstration guide of the sales-page skill: a
 * large window that says a whole product exists, drawn for who never saw it; its first choice, a replica): the firm's
 * menu, the search, the numbers of the month, the cases on the board by step, each with who has it, and beside them only
 * what asks a person today. Every part stands for a screen the product has (`demo.real_today`,
 * docs/paginas/home/pagina.json), and nothing here is to be read closely: the board is seen, not read.
 *
 * A picture: one name for a screen reader, nothing inside it to focus and no heading in the page's outline. On a phone the window
 * would be a blur, so it has a drawing of its own: no rail, two columns of the board and no panel beside it.
 */
export default function FirmWindow({
  label,
  sample,
  search,
  add,
  numbers,
  boardTitle,
  columns,
  pendingTitle,
  pending,
}: {
  label: string;
  /** The tag on the window's own address bar: the data are invented. */
  sample: string;
  search: string;
  add: string;
  numbers: WindowNumber[];
  boardTitle: string;
  columns: WindowColumn[];
  pendingTitle: string;
  pending: WindowPendingGroup[];
}) {
  return (
    <div data-demo="janela" data-figura="janela-do-sistema" role="img" aria-label={label} className="text-left">
      <ProductFrame address={sample} glow>
        <div className="bg-background flex">
          <div className="border-grey-100 bg-background-paper hidden w-14 flex-none flex-col items-center gap-1 border-r py-3 md:flex">
            <span className="mb-2 flex h-9 items-center">
              <Logo classNameFull="hidden" classNameMobile="block" />
            </span>
            {RAIL.map((item) => (
              <span
                key={item.key}
                className={cn(
                  "flex h-9 w-9 items-center justify-center rounded-lg",
                  item.current ? "bg-primary/10 text-primary" : "text-text-secondary",
                )}
              >
                {item.icon}
              </span>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 sm:gap-4 sm:p-4 md:p-5 md:pb-7">
            <div className="flex items-center gap-2">
              <span className="border-grey-100 bg-background-paper text-text-secondary flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border px-3 text-xs md:max-w-sm">
                <NiSearch size="small" className="flex-none" />
                <span className="truncate">{search}</span>
              </span>
              <span className="flex-1 max-md:hidden" />
              {/* On a phone the room goes to the search, whose words are read whole. */}
              <span className="bg-primary text-text-contrast dark:bg-primary-dark flex h-9 flex-none items-center gap-1.5 rounded-lg px-3 text-xs font-bold max-sm:hidden">
                <NiPlus size="tiny" />
                {add}
              </span>
              <span className="border-grey-100 bg-background-paper text-text-secondary relative flex h-9 w-9 flex-none items-center justify-center rounded-lg border">
                <NiBell size="small" />
                <span className="bg-accent-4 absolute top-1.5 right-1.5 h-2 w-2 rounded-full" />
              </span>
            </div>

            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
              {numbers.map((number) => (
                <li
                  key={number.label}
                  className="border-grey-100 bg-background-paper flex min-w-0 flex-col gap-1 rounded-xl border p-2.5 sm:p-3"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "flex h-7 w-7 flex-none items-center justify-center rounded-lg max-sm:hidden",
                        TONE[number.tone].softBg,
                        TONE[number.tone].text,
                      )}
                    >
                      {number.icon}
                    </span>
                    <span className="text-text-secondary truncate text-xs font-semibold">{number.label}</span>
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className="font-heading text-text-primary text-xl font-bold tabular-nums sm:text-2xl">
                      {number.value}
                    </span>
                    {number.delta ? (
                      <span className="bg-success/15 text-text-primary rounded-full px-1.5 py-0.5 text-xs font-semibold">
                        {number.delta}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>

            <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_14.5rem] lg:gap-4">
              <div className="flex min-w-0 flex-col gap-2">
                <span className="text-text-primary font-heading text-sm font-bold">{boardTitle}</span>
                <ul className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
                  {columns.map((column, index) => (
                    <li
                      key={column.key}
                      className={cn(
                        "bg-grey-25 flex min-w-0 flex-col gap-1.5 rounded-xl p-1.5",
                        // A phone holds two columns, a tablet three, and the rest of the way shows from a laptop on.
                        index >= 2 && "max-sm:hidden",
                        index >= 3 && "max-md:hidden",
                        index >= 4 && "max-lg:hidden",
                      )}
                    >
                      <span className="flex items-center justify-between gap-1 px-1 pt-0.5 text-xs font-bold">
                        <span className="text-text-primary truncate">{column.label}</span>
                        <span className="text-text-secondary tabular-nums">{column.total}</span>
                      </span>
                      {column.cases.map((item, position) => (
                        <span
                          key={item.seq}
                          className={cn(
                            "border-grey-100 bg-background-paper flex min-w-0 flex-col gap-0.5 rounded-lg border p-2",
                            position === 2 && "max-sm:hidden",
                          )}
                        >
                          <span className="text-text-secondary flex justify-between gap-1 text-xs tabular-nums">
                            <span>#{item.seq}</span>
                            <span className="truncate">{item.days}</span>
                          </span>
                          <span className="text-text-primary truncate text-xs font-bold">{item.client}</span>
                          <span className="text-text-secondary flex min-w-0 items-center gap-1.5 text-xs">
                            <span
                              className="h-1.5 w-1.5 flex-none rounded-full"
                              style={{
                                backgroundColor: `hsl(var(${TONE[item.holderTone].cssVar}))`,
                              }}
                            />
                            <span className="truncate">{item.holder}</span>
                          </span>
                        </span>
                      ))}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="border-grey-100 bg-background-paper hidden flex-col gap-3 self-start rounded-xl border p-3 lg:flex">
                <span className="text-text-primary font-heading flex items-center gap-1.5 text-sm font-bold">
                  <NiBell size="small" className="text-text-secondary" />
                  {pendingTitle}
                </span>
                {pending.map((group) => (
                  <div key={group.title} className="flex flex-col gap-1.5">
                    <span className="text-text-secondary text-xs font-semibold">{group.title}</span>
                    {group.items.map((item) => (
                      <span key={item.text} className="flex items-center gap-2">
                        <span
                          className={cn(
                            "flex h-6 w-6 flex-none items-center justify-center rounded-md",
                            TONE[item.tone].softBg,
                            TONE[item.tone].text,
                          )}
                        >
                          {item.icon}
                        </span>
                        <span className="text-text-primary min-w-0 text-xs leading-4 font-semibold">{item.text}</span>
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </ProductFrame>
    </div>
  );
}
