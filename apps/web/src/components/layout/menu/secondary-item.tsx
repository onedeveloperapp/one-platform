import { OpenedAccordion } from "./left-menu";
import NextLink from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ComponentProps, Dispatch, useCallback, useEffect, useMemo } from "react";

import { Accordion, AccordionDetails, AccordionSummary, Box, Button } from "@mui/material";

import CornerTag from "@/components/product/corner-tag";
import NextureIcons, { IconMap, type IconName } from "@/icons/icon-registry";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import NiLock from "@/icons/nexture/ni-lock";
import { cn, isPathMatch } from "@/lib/utils";
import { MenuItem } from "@/types";

/**
 * The page a group of the menu opens on, as a subtle link beside the title of its submenu (the owner, 2026-11-07):
 * "Todos" beside "Módulos", "Visão geral" beside "Admin". It is never an item of the submenu, where it took a line
 * and read as one more module.
 */
export function OverviewLink({ item, className }: { item: MenuItem; className?: string }) {
  const t = useTranslations("dashboard");
  const pathname = usePathname();
  if (!item.href) return null;
  const words = t(item.overviewLabel ?? "menu-all");
  const current = pathname.replace(/\/$/, "") === item.href;
  return (
    <NextLink
      href={item.href}
      prefetch={false}
      aria-label={t("menu-overview-aria", { section: t(item.label), label: words })}
      aria-current={current ? "page" : undefined}
      className={cn(
        "hover:text-primary shrink-0 rounded-sm text-sm font-semibold no-underline hover:underline",
        current ? "text-primary" : "text-text-secondary",
        className,
      )}
    >
      {words}
    </NextLink>
  );
}

type Props = {
  item: MenuItem;
  indent: number;
  openedAccordions: OpenedAccordion[];
  setOpenedAccordions: Dispatch<React.SetStateAction<OpenedAccordion[]>>;
  className?: string;
};

export function SecondaryItem({ item, indent = 0, openedAccordions, setOpenedAccordions, className }: Props) {
  const t = useTranslations("dashboard");
  const pathname = usePathname();

  const isActive = useMemo(() => {
    if (item.exact) return Boolean(item.href) && pathname.replace(/\/$/, "") === item.href;
    if (item.href && isPathMatch(pathname, item.href)) return true;
    if (item.children) return item.children.some((child) => child.href && isPathMatch(pathname, child.href));
    return false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const handleOnChange = useCallback(
    (expanded: boolean) => {
      if (expanded) {
        setOpenedAccordions([...openedAccordions.filter((a) => a.indent !== indent), { indent, id: item.id }]);
      } else {
        setOpenedAccordions(openedAccordions.filter((a) => a.indent !== indent && a.id !== item.id));
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [openedAccordions],
  );

  useEffect(() => {
    if (isActive) {
      setOpenedAccordions((prev) => [...prev.filter((a) => a.indent !== indent), { indent, id: item.id }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive]);

  if (item.isExternalLink) {
    return (
      <Button
        variant="text"
        size={indent === 0 ? "large" : "medium"}
        color="text-primary"
        className={cn(
          "full-width-button group hover:bg-grey-25 px-4",
          isActive && "active text-primary! bg-grey-25!",
          className,
        )}
        component={NextLink}
        href={item.href}
        target="_blank"
        startIcon={
          item.icon && (
            <NextureIcons
              variant={isActive ? "contained" : "outlined"}
              icon={item.icon}
              size={indent === 0 ? "large" : "medium"}
              className={cn("transition-transform group-hover:scale-[0.85]", isActive && "scale-[0.85]")}
            />
          )
        }
        aria-label={t(item.label)}
        aria-current={isActive ? "page" : undefined}
        rel="noreferrer"
      >
        {t(item.label)}
      </Button>
    );
  }

  // An icon named by data (a module's, from the catalog) that the set does not have is drawn as the generic one.
  const icon: IconName | undefined =
    item.icon && !Object.prototype.hasOwnProperty.call(IconMap, item.icon) ? "NiPuzzle" : item.icon;
  // What the item is called: a module's name is data, every other item's words are the catalog's. Over the item's top
  // edge, at its right end (the owner, 2026-11-08), a module still to come says so and one the firm did not contract
  // carries a lock (said to a screen reader in the item's own name): the tag floats, so the name keeps its line.
  const label = item.text ?? t(item.label);
  const tagWords = item.tag === "soon" ? t("menu-tag-soon") : item.tag === "locked" ? t("menu-tag-locked") : null;
  const tag: ComponentProps<typeof CornerTag> | null =
    item.tag === "soon"
      ? { tone: "attention", label: t("menu-tag-soon") }
      : item.tag === "locked"
        ? { icon: <NiLock size={12} className="text-text-secondary" /> }
        : null;

  // the item is a link without children
  if ((!item.children || item.children.length === 0) && item.href) {
    return (
      <Button
        variant="text"
        size={indent === 0 ? "large" : "medium"}
        color="text-primary"
        className={cn(
          "full-width-button group hover:bg-grey-25 px-4",
          // The tag floats above the item: a little air keeps it off the item before.
          tag && "mt-1",
          isActive && "active text-primary! bg-grey-25!",
          className,
        )}
        startIcon={
          icon && (
            <NextureIcons
              variant={isActive ? "contained" : "outlined"}
              icon={icon}
              size={indent === 0 ? "large" : "medium"}
              className={cn("transition-transform group-hover:scale-[0.85]", isActive && "scale-[0.85]")}
            />
          )
        }
        aria-label={tagWords ? `${label}, ${tagWords}` : label}
        aria-current={isActive ? "page" : undefined}
        component={NextLink}
        href={item.href}
      >
        {/* One line always: a name longer than the menu ends in an ellipsis, said whole in the item's name. */}
        <span className="min-w-0 truncate">{label}</span>
        {tag ? <CornerTag {...tag} placement="edge" /> : null}
      </Button>
    );
  }

  // Item has children - render as accordion
  const isExpanded = !!openedAccordions.find((a) => a.id === item.id && a.indent === indent);

  return (
    <Accordion expanded={isExpanded} onChange={(_, expanded) => handleOnChange(expanded)}>
      {/* The group's own page is a subtle link on its title's line, before the chevron: beside the summary, never
          inside it, since a link inside the button that opens the group would be a control inside a control. */}
      <Box className="relative">
        <AccordionSummary>
          <Button
            variant="text"
            size={indent === 0 ? "large" : "medium"}
            color="text-primary"
            className={cn(
              "full-width-button group hover:bg-grey-25 px-4",
              isActive && "text-primary! bg-grey-25!",
              (isExpanded || isActive) && "active",
              className,
            )}
            startIcon={
              item.icon && (
                <NextureIcons
                  variant={isActive ? "contained" : "outlined"}
                  icon={item.icon}
                  size={indent === 0 ? "large" : "medium"}
                  className={cn(
                    "transition-transform group-hover:scale-[0.85]",
                    (isActive || isExpanded) && "scale-[0.85]",
                  )}
                />
              )
            }
            endIcon={<NiChevronRightSmall size="medium" className="accordion-rotate" />}
            component="div"
          >
            {t(item.label)}
          </Button>
        </AccordionSummary>
        {/* Above the summary's button, which takes z-20 while the menu opens over the page. */}
        {item.href ? <OverviewLink item={item} className="absolute top-1/2 right-12 z-30 -translate-y-1/2" /> : null}
      </Box>
      <AccordionDetails className="ml-7 flex flex-col gap-1 pt-2">
        {item.children?.map((child) => (
          <SecondaryItem
            className={className}
            item={child}
            key={`left-menu-secondary-item-${item.id}-${child.id}`}
            indent={indent + 1}
            openedAccordions={openedAccordions}
            setOpenedAccordions={setOpenedAccordions}
          />
        ))}
      </AccordionDetails>
    </Accordion>
  );
}
