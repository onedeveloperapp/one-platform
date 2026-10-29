"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import { QuickActionTile } from "@/components/product/home-tiles";
import PageHeader from "@/components/product/page-header";
import NextureIcons, { type IconName } from "@/icons/icon-registry";
import NiBuilding from "@/icons/nexture/ni-building";
import NiUsers from "@/icons/nexture/ni-users";
import { moduleOf, MODULES } from "@/lib/modules/registry";
import { endPartnership } from "@/lib/partners/actions";
import { isPartnerManager, type MemberPartner, partnerErrorKey, type PartnerLink } from "@/lib/partners/partner";

const day = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value))
    : "";

/**
 * The home of a partner of a firm (migration 0069). Somebody of a travel agency comes here to do the work of the
 * partnership: the module's own area (the passengers, in the passenger module) is one click away, and the
 * partnership itself is said plainly, with the firm, since when, and, to who manages the agency, how it ends.
 */
export default function PartnerHome({ partner }: { partner: MemberPartner | null }) {
  const t = useTranslations("product");
  const tm = useTranslations("dashboard");
  const router = useRouter();
  const [ending, setEnding] = useState<PartnerLink | null>(null);

  if (!partner) {
    return (
      <Grid container spacing={5}>
        <Grid size={12}>
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("partner-unavailable")}
          </Alert>
        </Grid>
      </Grid>
    );
  }

  const manager = isPartnerManager(partner.role);
  // What each module of the partnerships gives the agency to do: its area, by the registry (lib/modules).
  const areas = MODULES.modules
    .filter((definition) => partner.links.some((link) => link.module === definition.key))
    .flatMap((definition) => definition.partnerArea);

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <PageHeader
          title={partner.name}
          crumbs={[{ label: t("partner-home-title") }]}
          description={partner.links.length > 0 ? t("partner-home-description") : undefined}
        />
      </Grid>

      {partner.links.length === 0 && (
        <Grid size={12}>
          <EmptyState
            icon={<NiBuilding size="large" />}
            title={t("partner-home-no-link-title")}
            description={t("partner-home-no-link-body")}
            action={{ label: t("partner-home-team"), href: "/parceiro/equipe" }}
          />
        </Grid>
      )}

      {areas.length > 0 && (
        <Grid size={12} container spacing={2.5}>
          {areas.map((area) => (
            <Grid key={area.id} size={{ xs: 12, sm: 6, lg: 4 }}>
              <QuickActionTile
                href={area.href}
                icon={<NextureIcons icon={area.icon as IconName} size="large" />}
                tone="primary"
                title={tm(area.labelKey)}
                description={tm(area.descriptionKey)}
              />
            </Grid>
          ))}
        </Grid>
      )}

      {partner.links.length > 0 && (
        <Grid size={12}>
          <Card component="section" aria-labelledby="partner-links">
            <CardContent className="flex flex-col gap-4">
              <Typography id="partner-links" variant="h5" component="h2" className="mb-0">
                {t("partner-home-links-title")}
              </Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t("partner-home-privacy")}
              </Typography>
              <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                {partner.links.map((link) => {
                  const moduleKey = moduleOf(link.module)?.nameKey;
                  return (
                    <Box
                      component="li"
                      key={link.id}
                      className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"
                    >
                      <Box className="flex min-w-0 flex-1 flex-col">
                        <Typography variant="subtitle2" component="p" className="break-words">
                          {link.firm}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          {[moduleKey ? t(moduleKey) : link.module, t("partners-since", { date: day(link.startedAt) })]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                      </Box>
                      {manager && (
                        <Button variant="outlined" color="grey" size="small" onClick={() => setEnding(link)}>
                          {t("partners-end")}
                        </Button>
                      )}
                    </Box>
                  );
                })}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      )}

      <Grid size={12}>
        <Button
          variant="text"
          color="grey"
          startIcon={<NiUsers size="medium" />}
          href="/parceiro/equipe"
          LinkComponent={Link}
        >
          {t("partner-home-team")}
        </Button>
      </Grid>

      {ending && (
        <ConfirmActionDialog
          title={t("partner-end-title", { firm: ending.firm })}
          consequences={[t("partner-end-consequence-1"), t("partner-end-consequence-2")]}
          reasonLabel={t("partners-end-reason")}
          reasonHelp={t("partner-end-reason-help")}
          reasonMinLength={4}
          confirmLabel={t("partners-end-confirm")}
          cancelLabel={t("partners-cancel")}
          busyLabel={t("partners-ending")}
          tone="danger"
          onConfirm={async (reason) => {
            const result = await endPartnership(ending.id, reason);
            if (!result.ok) return t(partnerErrorKey(result.code));
            router.refresh();
            return null;
          }}
          onClose={() => setEnding(null)}
        />
      )}
    </Grid>
  );
}
