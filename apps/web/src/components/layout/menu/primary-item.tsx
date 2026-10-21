import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { memo, useMemo, useState } from "react";

import { Box, Button, Tooltip, Typography } from "@mui/material";

import NextureIcons from "@/icons/icon-registry";
import { cn, isPathMatch } from "@/lib/utils";
import { MenuItem, MenuType } from "@/types";

type Props = {
  item: MenuItem;
  onSelect: (item: MenuItem) => void;
  isActive: boolean;
  menuType: MenuType;
  className?: string;
};

export const PrimaryItem = memo(function PrimaryItem({ item, onSelect, isActive, menuType, className }: Props) {
  const t = useTranslations("dashboard");

  const pathname = usePathname();
  const selected = useMemo(() => {
    if (!item) return false;
    if (item.href && isPathMatch(pathname, item.href)) return true;
    if (item.children) return item.children.some((child) => child.href && isPathMatch(pathname, child.href));

    return false;
  }, [item, pathname]);

  const [tooltipOpen, setTooltipOpen] = useState(false);

  if (menuType !== MenuType.Minimal) {
    const select = () => {
      onSelect(item);
      setTooltipOpen(false);
    };
    const boxClass = cn(
      "text-text-primary hover:bg-grey-25 flex h-[5.5rem] w-24 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border-0 bg-transparent p-0 no-underline",
      selected && "bg-grey-25",
      className,
    );
    const content = (
      <>
        {item.icon && (
          <NextureIcons
            variant={selected ? "contained" : "outlined"}
            icon={item.icon}
            size={36}
            strokeWidth={1}
            className={cn(
              "transition-transform group-hover:scale-[0.85]",
              (selected || isActive) && "text-primary scale-[0.85]",
            )}
          />
        )}

        <Typography
          variant="body2"
          component="span"
          className={cn(
            "text-text-primary line-clamp-2 w-full text-center font-semibold transition-all",
            (selected || isActive) && "text-primary-dark dark:text-primary-light mt-0 mb-0",
            selected && "text-primary-dark dark:text-primary-light",
          )}
        >
          {t(item.label)}
        </Typography>
      </>
    );

    // Each item is a real link, or a button for one that opens the second panel: the keyboard reaches it, a
    // screen reader says what it is, and a link opens in a new tab. It was a plain div, out of reach of all three.
    if (item.isExternalLink) {
      return (
        <Box
          className={boxClass}
          component={NextLink}
          href={item.href ?? ""}
          target="_blank"
          rel="noreferrer"
          aria-current={selected ? "page" : undefined}
        >
          {content}
        </Box>
      );
    }
    if (!item.href || (item.children && item.children.length > 0)) {
      return (
        <Box className={boxClass} component="button" type="button" onClick={select} aria-expanded={isActive}>
          {content}
        </Box>
      );
    }
    return (
      <Box
        className={boxClass}
        component={NextLink}
        href={item.href}
        // The menu navigates by itself (onSelect): a prefetch of every item would only cost a read of the session each.
        prefetch={false}
        onClick={(event: React.MouseEvent<HTMLAnchorElement>) => {
          // A click that asks for a new tab or window is the browser's to follow; the menu keeps its own state.
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          event.preventDefault();
          select();
        }}
        aria-current={selected ? "page" : undefined}
      >
        {content}
      </Box>
    );
  }

  return (
    <Box className={cn("group flex w-full flex-col items-center gap-2", className)}>
      <Tooltip
        key={`left-menu-primary-item-${item.id}`}
        open={tooltipOpen}
        onClose={() => setTooltipOpen(false)}
        onOpen={() => setTooltipOpen(true)}
        title={t(item.label)}
        placement="right"
        arrow
        slotProps={{ tooltip: { className: cn("large", selected && "text-primary") } }}
      >
        <Button
          id={item.id}
          variant="text"
          size="large"
          color={item.color || "text-primary"}
          className={cn(
            "icon-only hover:bg-grey-25 text-text-primary h-10 w-10",
            selected &&
              `bg-grey-25 active ${item.color ? `text-${item.color.replace("text-", "")}!` : "text-primary!"}`,
            isActive && "active",
          )}
          startIcon={
            item.icon && (
              <NextureIcons
                variant={selected ? "contained" : "outlined"}
                icon={item.icon}
                size={24}
                className={cn(
                  "transition-transform group-hover:scale-[0.85]",
                  (selected || isActive) && "scale-[0.85]",
                )}
              />
            )
          }
          aria-label={t(item.label)}
          aria-current={selected ? "page" : undefined}
          {...(item.isExternalLink
            ? {
                component: NextLink,
                href: item.href,
                target: "_blank",
                rel: "noreferrer",
              }
            : {
                onClick: () => {
                  onSelect(item);
                  setTooltipOpen(false);
                },
              })}
        ></Button>
      </Tooltip>
    </Box>
  );
});
