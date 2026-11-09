"use client";

import { Fragment, type ReactNode, useEffect, useId, useRef, useState } from "react";

import {
  Badge,
  Box,
  Button,
  Card,
  Chip,
  Divider,
  InputAdornment,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
  Popover,
  TextField,
} from "@mui/material";

import QuickActions, { type QuickAction } from "@/components/product/quick-actions";
import NiArrowInDown from "@/icons/nexture/ni-arrow-in-down";
import NiCheck from "@/icons/nexture/ni-check";
import NiChevronDownSmall from "@/icons/nexture/ni-chevron-down-small";
import NiFilter from "@/icons/nexture/ni-filter";
import NiListNumber from "@/icons/nexture/ni-list-number";
import NiPlus from "@/icons/nexture/ni-plus";
import NiSearch from "@/icons/nexture/ni-search";

/** A ready view of the list: its name, how many it holds, and the group it is listed under in the menu. */
export type ListView = { key: string; label: string; count?: string; group: string };

/** A filter in force, said beside the bar, with the way to take it off. */
export type ListChip = { key: string; label: string; onRemove: () => void };

/**
 * "Novo": what a person registers in this list, at the bar's right. One kind is one button; several are one button
 * that opens the menu of them, the one that starts from a document first.
 */
export type ListCreate = { label: string; onClick?: () => void; actions?: QuickAction[]; disabled?: boolean };

/** How long the search waits after the last key before it asks again. */
const SEARCH_DELAY_MS = 400;

/**
 * The same bar on every list of ONE (the screen pattern after ADVBox, approved by the owner on 2026-11-07): the
 * ready views with how many each holds ("Todos os casos 1.284"), the search of the list, "Filtrar", "Ordenar",
 * "Exportar" and, at the right, "Novo" where a person registers here and what the list keeps out of sight ("Mais
 * ações"); under it, each filter in force, one click from being taken off. Whoever learns one list knows them all.
 * A list of what ONE makes by itself (the cases) has no "Novo": making one by hand is the exception, in "Mais ações".
 *
 * Every piece but the views is optional: a list offers only what it really does (an "Exportar" that exports
 * nothing is never shown). The search waits for the person to stop typing and hands the words to the page, which
 * asks the server in the request's body, never in the address. Closest catalog entry: the toolbar of `DataTable`,
 * whose search and columns served one list; this bar is any list's, above a table or a list of cards.
 */
export default function ListBar({
  label,
  viewsTitle,
  views,
  view,
  onView,
  search,
  filter,
  sort,
  exporting,
  create,
  more,
  chips,
}: {
  /** The bar's name to assistive technology ("Lista de casos"). */
  label: string;
  /** The title of the views' menu ("Visões prontas"). */
  viewsTitle: string;
  views: ListView[];
  view: string;
  onView: (key: string) => void;
  /** The search of the list; `numeric` opens a phone's keyboard of digits, for a list searched by a number. */
  search?: { label: string; placeholder: string; value: string; onChange: (text: string) => void; numeric?: boolean };
  /** "Filtrar": the fields of the list's filters, in a panel under the button. */
  filter?: { label: string; active: number; content: ReactNode; clearLabel: string; onClear: () => void };
  /** "Ordenar": the orders the list offers. */
  sort?: { label: string; options: { key: string; label: string }[]; value: string; onChange: (key: string) => void };
  /** "Exportar": one format is one button, several a menu of them. */
  exporting?: { label: string; onExport?: () => void; formats?: QuickAction[]; busy?: boolean };
  create?: ListCreate;
  more?: { label: string; actions: QuickAction[] };
  chips?: ListChip[];
}) {
  const id = useId();
  const [viewsAnchor, setViewsAnchor] = useState<HTMLElement | null>(null);
  const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null);
  // What "Novo" opens runs once its menu finished closing, so the panel keeps the focus on its first field.
  const createPicked = useRef<QuickAction | null>(null);
  // One kind is the button itself; a menu of one would be a click for nothing.
  const createMenu = create?.actions && create.actions.length > 1 ? create.actions : null;
  const [exportAnchor, setExportAnchor] = useState<HTMLElement | null>(null);
  const createOne = create && !createMenu ? (create.onClick ?? create.actions?.[0]?.onClick) : undefined;
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
  const current = views.find((item) => item.key === view) ?? views[0];

  return (
    <Card component="section" aria-label={label} className="flex flex-col gap-2 px-3! py-2.5!">
      <Box className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="outlined"
          color="grey"
          aria-haspopup="menu"
          aria-expanded={viewsAnchor ? true : undefined}
          aria-controls={viewsAnchor ? `${id}-views` : undefined}
          onClick={(event) => setViewsAnchor(event.currentTarget)}
          endIcon={<NiChevronDownSmall size="small" />}
          className="max-w-full"
        >
          <span className="truncate">{current?.label}</span>
          {current?.count !== undefined ? (
            <span className="text-text-secondary ml-2 font-semibold tabular-nums">{current.count}</span>
          ) : null}
        </Button>
        <Menu
          id={`${id}-views`}
          anchorEl={viewsAnchor}
          open={Boolean(viewsAnchor)}
          onClose={() => setViewsAnchor(null)}
          slotProps={{ paper: { className: "mt-1 w-96 max-w-[calc(100vw-2rem)]" }, list: { "aria-label": viewsTitle } }}
        >
          <ListSubheader className="bg-transparent text-xs leading-8 font-extrabold tracking-wider uppercase">
            {viewsTitle}
          </ListSubheader>
          {views.map((item, index) => (
            <Fragment key={item.key}>
              {index > 0 && views[index - 1].group !== item.group ? <Divider className="mx-1 my-1" /> : null}
              <MenuItem
                selected={item.key === view}
                className="gap-2 rounded-lg"
                onClick={() => {
                  setViewsAnchor(null);
                  if (item.key !== view) onView(item.key);
                }}
              >
                <Box component="span" aria-hidden className="text-primary flex w-4 flex-none justify-center">
                  {item.key === view ? <NiCheck size="small" /> : null}
                </Box>
                {/* A view's name is read whole: what tells two apart may be its last word ("há mais de 30 dias"). */}
                <span className="min-w-0 flex-1 whitespace-normal">{item.label}</span>
                {item.count !== undefined ? (
                  <span className="text-text-secondary text-sm font-semibold tabular-nums">{item.count}</span>
                ) : null}
              </MenuItem>
            </Fragment>
          ))}
        </Menu>

        {search ? <ListSearch {...search} /> : null}

        {filter ? (
          <>
            <Button
              variant="text"
              color="grey"
              aria-haspopup="dialog"
              aria-expanded={filterAnchor ? true : undefined}
              onClick={(event) => setFilterAnchor(event.currentTarget)}
              startIcon={
                <Badge badgeContent={filter.active} color="primary" invisible={filter.active === 0}>
                  <NiFilter size="medium" />
                </Badge>
              }
            >
              {filter.label}
            </Button>
            <Popover
              open={Boolean(filterAnchor)}
              anchorEl={filterAnchor}
              onClose={() => setFilterAnchor(null)}
              anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
              slotProps={{
                paper: {
                  className: "mt-1 w-80 max-w-[calc(100vw-2rem)] p-4",
                  role: "dialog",
                  "aria-label": filter.label,
                },
              }}
            >
              <Box className="flex flex-col gap-3">
                {filter.content}
                <Box className="flex justify-end">
                  <Button
                    variant="text"
                    color="grey"
                    size="small"
                    disabled={filter.active === 0}
                    onClick={() => {
                      filter.onClear();
                      setFilterAnchor(null);
                    }}
                  >
                    {filter.clearLabel}
                  </Button>
                </Box>
              </Box>
            </Popover>
          </>
        ) : null}

        {sort ? (
          <>
            <Button
              variant="text"
              color="grey"
              aria-haspopup="menu"
              aria-expanded={sortAnchor ? true : undefined}
              aria-controls={sortAnchor ? `${id}-sort` : undefined}
              onClick={(event) => setSortAnchor(event.currentTarget)}
              startIcon={<NiListNumber size="medium" />}
            >
              {sort.label}
            </Button>
            <Menu
              id={`${id}-sort`}
              anchorEl={sortAnchor}
              open={Boolean(sortAnchor)}
              onClose={() => setSortAnchor(null)}
              slotProps={{ paper: { className: "mt-1" }, list: { "aria-label": sort.label } }}
            >
              {sort.options.map((option) => (
                <MenuItem
                  key={option.key}
                  selected={option.key === sort.value}
                  className="gap-2 rounded-lg"
                  onClick={() => {
                    setSortAnchor(null);
                    if (option.key !== sort.value) sort.onChange(option.key);
                  }}
                >
                  <Box component="span" aria-hidden className="text-primary flex w-4 flex-none justify-center">
                    {option.key === sort.value ? <NiCheck size="small" /> : null}
                  </Box>
                  {option.label}
                </MenuItem>
              ))}
            </Menu>
          </>
        ) : null}

        {exporting ? (
          <>
            <Button
              variant="text"
              color="grey"
              disabled={exporting.busy}
              startIcon={<NiArrowInDown size="medium" />}
              endIcon={exporting.formats ? <NiChevronDownSmall size="small" /> : undefined}
              aria-haspopup={exporting.formats ? "menu" : undefined}
              aria-expanded={exportAnchor ? true : undefined}
              aria-controls={exportAnchor ? `${id}-export` : undefined}
              onClick={(event) => (exporting.formats ? setExportAnchor(event.currentTarget) : exporting.onExport?.())}
            >
              {exporting.label}
            </Button>
            {exporting.formats ? (
              <Menu
                id={`${id}-export`}
                anchorEl={exportAnchor}
                open={Boolean(exportAnchor)}
                onClose={() => setExportAnchor(null)}
                slotProps={{ paper: { className: "mt-1" }, list: { "aria-label": exporting.label } }}
              >
                {exporting.formats.map((format) => (
                  <MenuItem
                    key={format.key}
                    disabled={format.disabled}
                    className="gap-2 rounded-lg"
                    onClick={() => {
                      setExportAnchor(null);
                      format.onClick();
                    }}
                  >
                    {format.icon ? <ListItemIcon className="text-text-secondary">{format.icon}</ListItemIcon> : null}
                    <ListItemText>{format.label}</ListItemText>
                  </MenuItem>
                ))}
              </Menu>
            ) : null}
          </>
        ) : null}

        <Box className="flex-1" />
        {create && (createMenu || createOne) ? (
          <>
            <Button
              variant="contained"
              disabled={create.disabled}
              startIcon={<NiPlus size="medium" />}
              endIcon={createMenu ? <NiChevronDownSmall size="small" /> : undefined}
              aria-haspopup={createMenu ? "menu" : undefined}
              aria-expanded={createAnchor ? true : undefined}
              aria-controls={createAnchor ? `${id}-create` : undefined}
              onClick={(event) => (createMenu ? setCreateAnchor(event.currentTarget) : createOne?.())}
            >
              {create.label}
            </Button>
            {createMenu ? (
              <Menu
                id={`${id}-create`}
                anchorEl={createAnchor}
                open={Boolean(createAnchor)}
                onClose={() => setCreateAnchor(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
                slotProps={{
                  paper: { className: "mt-1" },
                  list: { "aria-label": create.label },
                  transition: {
                    onExited: () => {
                      const action = createPicked.current;
                      createPicked.current = null;
                      action?.onClick();
                    },
                  },
                }}
              >
                {createMenu.map((action) => (
                  <MenuItem
                    key={action.key}
                    disabled={action.disabled}
                    className="gap-2 rounded-lg"
                    onClick={() => {
                      createPicked.current = action;
                      setCreateAnchor(null);
                    }}
                  >
                    {action.icon ? <ListItemIcon className="text-text-secondary">{action.icon}</ListItemIcon> : null}
                    <ListItemText>{action.label}</ListItemText>
                  </MenuItem>
                ))}
              </Menu>
            ) : null}
          </>
        ) : null}
        {more ? <QuickActions label={more.label} actions={more.actions} /> : null}
      </Box>

      {chips && chips.length > 0 ? (
        <Box className="flex flex-wrap items-center gap-1.5 px-1 pb-0.5">
          {chips.map((chip) => (
            <Chip key={chip.key} size="small" label={chip.label} onDelete={chip.onRemove} />
          ))}
        </Box>
      ) : null}
    </Card>
  );
}

/**
 * The search of a list: what is typed stays in the field as it is typed, and reaches the page once the person
 * stops typing. A value the page sets (a view that clears the search) is taken back into the field.
 */
function ListSearch({
  label,
  placeholder,
  value,
  onChange,
  numeric,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (text: string) => void;
  numeric?: boolean;
}) {
  const [text, setText] = useState(value);
  const told = useRef(value);
  // The latest handler, so a page that hands a new one on every render does not restart the wait.
  const changed = useRef(onChange);
  changed.current = onChange;
  // The page's own value wins when it changes from the outside.
  useEffect(() => {
    if (value !== told.current) {
      told.current = value;
      setText(value);
    }
  }, [value]);
  useEffect(() => {
    const words = text.trim();
    if (words === told.current) return;
    const timer = window.setTimeout(() => {
      told.current = words;
      changed.current(words);
    }, SEARCH_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [text]);
  return (
    <TextField
      size="small"
      value={text}
      onChange={(event) => setText(event.target.value.slice(0, 120))}
      placeholder={placeholder}
      // The theme gives a form control a margin under it, for its helper text: a field of a bar has none.
      className="mb-0! min-w-48 flex-[1_1_16rem] sm:max-w-80"
      slotProps={{
        htmlInput: {
          "aria-label": label,
          type: "search",
          autoComplete: "off",
          ...(numeric ? { inputMode: "numeric" as const } : {}),
        },
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <NiSearch size="small" className="text-text-secondary" />
            </InputAdornment>
          ),
        },
      }}
    />
  );
}
