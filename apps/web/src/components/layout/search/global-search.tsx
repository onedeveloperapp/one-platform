"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Autocomplete, Box, Button, Dialog, InputAdornment, TextField, Typography } from "@mui/material";

import { useCaseSearch } from "@/components/layout/search/use-case-search";
import NiCross from "@/icons/nexture/ni-cross";
import NiSearch from "@/icons/nexture/ni-search";
import { STATUS_KEY } from "@/lib/cases/cases";
import { isSearchShortcut, isSetupPath, searchable, type SearchHit } from "@/lib/search/global-search";

/**
 * The field of the search: what is typed is asked of the database a moment after the last key, in the request's
 * body (`useCaseSearch`), and the cases found are listed under it, each opening its case.
 */
function SearchField({ autoFocus = false, onDone }: { autoFocus?: boolean; onDone?: () => void }) {
  const t = useTranslations("dashboard");
  const tp = useTranslations("product");
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const found = useCaseSearch(text);

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
    <Autocomplete<SearchHit, false, false, false>
      options={hits}
      value={null}
      inputValue={text}
      open={open && text.trim() !== ""}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      onInputChange={(_event, next, reason) => {
        if (reason !== "reset") setText(next);
      }}
      onChange={(_event, chosen) => {
        if (!chosen) return;
        setText("");
        setOpen(false);
        onDone?.();
        router.push(`/casos/${chosen.id}`);
      }}
      filterOptions={(all) => all}
      getOptionLabel={(option) => option.client || option.label}
      getOptionKey={(option) => option.id}
      isOptionEqualToValue={(option, chosen) => option.id === chosen.id}
      groupBy={() => t("search-group-cases")}
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
                {option.client || option.label}
              </Typography>
              <Typography variant="body2" component="span" className="text-text-secondary truncate">
                {t("search-hit", { label: option.label, status: tp(STATUS_KEY[option.status]) })}
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
  if (isSetupPath(pathname)) return null;
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
  if (isSetupPath(pathname)) return null;
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
