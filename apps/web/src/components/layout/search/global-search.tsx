"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Autocomplete, Box, Button, Dialog, InputAdornment, TextField, Typography } from "@mui/material";

import { useGlobalSearch } from "@/components/layout/search/use-global-search";
import { useSetupShown } from "@/components/layout/setup-shown";
import NiCross from "@/icons/nexture/ni-cross";
import NiSearch from "@/icons/nexture/ni-search";
import { STATUS_KEY } from "@/lib/cases/cases";
import { type GlobalHit, isSearchShortcut, isSetupPath, searchable } from "@/lib/search/global-search";

/**
 * The field of the search: what is typed is asked of the database a moment after the last key, in the request's
 * body (`useCaseSearch`), and the cases found are listed under it, each opening its case.
 */
const GROUP_KEY: Record<GlobalHit["kind"], string> = {
  person: "search-group-people",
  case: "search-group-cases",
  conversation: "search-group-conversations",
};

/** What a hit is called: the person's name, the client of a case or its number, the contact of a conversation. */
const hitTitle = (hit: GlobalHit): string =>
  hit.kind === "person"
    ? hit.person.name
    : hit.kind === "case"
      ? hit.hit.client || hit.hit.label
      : (hit.conversation.name ?? hit.conversation.number);

function SearchField({ autoFocus = false, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const t = useTranslations("dashboard");
  const tp = useTranslations("product");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const found = useGlobalSearch(text);
  const focused = () => typeof document !== "undefined" && document.activeElement === inputRef.current;

  // "/" or Ctrl+K from anywhere on the screen brings the person here.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event)) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const hits = found.kind === "ready" ? found.hits : [];
  const nothing = found.kind === "error" ? t("search-error") : searchable(text) ? t("search-empty") : t("search-hint");

  return (
    <Autocomplete<GlobalHit, false, false, false>
      options={hits}
      value={null}
      inputValue={text}
      open={open && text.trim() !== ""}
      // The list opens for the person who is in the field, never for text the browser put there by itself.
      onOpen={() => {
        if (focused()) setOpen(true);
      }}
      onClose={() => setOpen(false)}
      onInputChange={(_event, next, reason) => {
        // A browser fills a field it takes for a login with the person's e-mail, with nobody in it: the field stays
        // as it was, and the list never opens over the page (2026-11-21, over the panel of a setup's step).
        if (reason === "input" && !focused()) return;
        if (reason !== "reset") setText(next);
      }}
      onChange={(_event, chosen) => {
        if (!chosen) return;
        setText("");
        setOpen(false);
        onDone?.();
        router.push(chosen.href);
      }}
      filterOptions={(all) => all}
      getOptionLabel={(option) => hitTitle(option)}
      getOptionKey={(option) => option.id}
      isOptionEqualToValue={(option, chosen) => option.id === chosen.id}
      groupBy={(option) => t(GROUP_KEY[option.kind])}
      loading={found.kind === "loading"}
      loadingText={t("search-loading")}
      noOptionsText={nothing}
      autoHighlight
      // A search, not a choice among options: no arrow to open a list.
      forcePopupIcon={false}
      clearOnBlur={false}
      blurOnSelect
      fullWidth
      renderOption={(props, option) => {
        const { key, ...rest } = props as typeof props & { key: string };
        return (
          <li key={key} {...rest}>
            <Box className="flex min-w-0 flex-col py-0.5">
              <Typography variant="body1" component="span" className="truncate font-semibold">
                {hitTitle(option)}
              </Typography>
              <Typography variant="body2" component="span" className="text-text-secondary truncate">
                {option.kind === "case"
                  ? t("search-hit", { label: option.hit.label, status: tp(STATUS_KEY[option.hit.status]) })
                  : option.kind === "person"
                    ? [
                        option.person.cpfMiddle ? t("search-person-cpf", { middle: option.person.cpfMiddle }) : null,
                        option.person.place,
                        t("search-person-cases", { count: option.person.cases }),
                      ]
                        .filter(Boolean)
                        .join(" · ")
                    : option.conversation.number}
              </Typography>
            </Box>
          </li>
        );
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
          autoFocus={autoFocus}
          // The theme gives a form control a margin under it, for its helper text: the search has none, and that
          // margin left it above the middle of the header's row.
          className="mb-0!"
          size="small"
          placeholder={t("search-placeholder")}
          slotProps={{
            ...params.slotProps,
            input: {
              ...params.slotProps.input,
              startAdornment: (
                <InputAdornment position="start">
                  <NiSearch size="medium" className="text-text-secondary" />
                </InputAdornment>
              ),
              endAdornment: (
                <>
                  <Box
                    component="span"
                    aria-hidden
                    className="border-grey-200 text-text-secondary mr-1 hidden rounded-md border px-1.5 text-xs font-bold md:inline"
                  >
                    /
                  </Box>
                  {params.slotProps.input.endAdornment}
                </>
              ),
            },
            htmlInput: {
              ...params.slotProps.htmlInput,
              // A search, never a login: nothing the browser keeps is offered or filled in it.
              type: "search",
              name: "one-search",
              autoComplete: "off",
              "aria-label": t("search-label"),
              "aria-keyshortcuts": "/ Control+K Meta+K",
            },
          }}
        />
      )}
    />
  );
}

/** The search at the top of every screen of the firm, on a wide screen: the field itself, in the header's middle. */
export function GlobalSearchField() {
  const pathname = usePathname();
  const setupShown = useSetupShown();
  if (isSetupPath(pathname) || setupShown) return null;
  return (
    <Box className="hidden min-w-0 flex-1 justify-center px-4 md:flex">
      <Box className="w-full max-w-[32rem]">
        <SearchField />
      </Box>
    </Box>
  );
}

/** The search on a phone: a button among the header's own, which opens the field over the page. */
export function GlobalSearchButton() {
  const t = useTranslations("dashboard");
  const pathname = usePathname();
  const [phoneOpen, setPhoneOpen] = useState(false);
  const setupShown = useSetupShown();
  if (isSetupPath(pathname) || setupShown) return null;
  return (
    <>
      <Button
        variant="text"
        size="large"
        color="text-primary"
        className="icon-only hover:bg-grey-25 md:hidden"
        onClick={() => setPhoneOpen(true)}
        aria-label={t("search-open")}
        startIcon={<NiSearch size={24} />}
      />
      <Dialog open={phoneOpen} onClose={() => setPhoneOpen(false)} fullScreen aria-label={t("search-label")}>
        <Box className="flex flex-row items-start gap-2 p-4">
          <Box className="min-w-0 flex-1">
            {phoneOpen ? <SearchField autoFocus onDone={() => setPhoneOpen(false)} /> : null}
          </Box>
          <Button
            variant="text"
            size="large"
            color="text-primary"
            className="icon-only hover:bg-grey-25"
            onClick={() => setPhoneOpen(false)}
            aria-label={t("search-close")}
            startIcon={<NiCross size={24} />}
          />
        </Box>
      </Dialog>
    </>
  );
}
