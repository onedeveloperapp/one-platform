"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { useTranslations } from "use-intl";

import { Box, Typography } from "@mui/material";

import { useCurrentOrg } from "@/hooks/use-current-org";
import { useEntitlements } from "@/hooks/use-entitlements";
import NiBadge from "@/icons/nexture/ni-badge";
import { trackOffer } from "@/lib/product-events";
import { cn } from "@/lib/utils";
import { MenuType } from "@/types";
import type { Tier } from "@flyee/billing/entitlements";

const BILLING_HREF = "/settings/billing?source=menu&feature=plans";

/** The rung's name, never the plan's: a kit owner on the free subscription row is still a kit owner. */
const TIER_LABEL = {
  kit: "menu-plan-kit",
  club: "menu-plan-club",
  pro: "menu-plan-pro",
} as const satisfies Record<Tier, string>;

/**
 * The workspace's rung on the ladder, at the foot of the nav rail.
 *
 * Deliberately a STATE READOUT, not a promotion: it names the rung, and only
 * adds a "compare plans" line for a workspace that has bought nothing. The
 * rung comes from `org_entitlements` (hooks/use-entitlements.ts), the single
 * answer every gate shares. The menu lives in the persistent dashboard
 * layout, so this is one request per page load, not per navigation.
 */
export default function PlanIndicator({ menuType }: { menuType: MenuType }) {
  const t = useTranslations("dashboard");
  const { orgId } = useCurrentOrg();
  const { entitlements, loading } = useEntitlements(orgId);
  const viewTracked = useRef(false);

  // Only a workspace that bought nothing is addressed here. Moving a buyer up
  // the ladder is the upsell rule's job, where it can say WHY (the home and the
  // CLI revalidation); counting buyers as impressions here would dilute this
  // surface's conversion rate with people it never addressed.
  const sellable = Boolean(entitlements) && !entitlements!.suspended && !entitlements!.tier;

  useEffect(() => {
    if (!sellable || viewTracked.current) return;
    viewTracked.current = true;
    trackOffer("upsell.viewed", "menu");
  }, [sellable]);

  if (loading || !entitlements) return null;

  const planLabel = entitlements.active && entitlements.tier ? t(TIER_LABEL[entitlements.tier]) : t("menu-plan-free");
  const title = t("menu-plan-current", { plan: planLabel });
  const minimal = menuType === MenuType.Minimal;

  return (
    <Box
      component={Link}
      href={BILLING_HREF}
      title={minimal ? title : undefined}
      aria-label={title}
      onClick={() => {
        if (sellable) trackOffer("upsell.clicked", "menu");
      }}
      className={cn(
        "hover:bg-grey-25 flex w-full flex-col items-center gap-0.5 rounded-2xl px-2 py-2 transition-colors",
        minimal && "px-0",
      )}
    >
      <Box className="text-text-secondary flex flex-row items-center gap-1.5">
        <NiBadge size="small" aria-hidden />
        {!minimal && (
          <Typography variant="body2" className="text-text-primary text-xs leading-4 font-semibold">
            {planLabel}
          </Typography>
        )}
      </Box>
      {!minimal && sellable && (
        <Typography
          variant="body2"
          className="text-primary dark:text-primary-light text-center text-[0.6875rem] leading-4"
        >
          {t("menu-cta-button")}
        </Typography>
      )}
    </Box>
  );
}
