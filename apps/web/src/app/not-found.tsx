"use client";
import { useTranslations } from "next-intl";

import { Box, Button, Paper, Typography } from "@mui/material";

import Logo from "@/components/logo/logo";
import LocaleLink from "@/components/marketing/locale-link";
import NiHome from "@/icons/nexture/ni-home";
import { cn } from "@/lib/utils";
import { useThemeContext } from "@/theme/theme-provider";

/**
 * The 404 of every address outside the member area: a page that called
 * notFound() (a help article or a post that does not exist) and any
 * address no route matches. It is read in the language of the address and
 * leads back to the site, never to the member home, where a visitor without an
 * account would land on sign-in. The member area has its own,
 * app/(dashboard)/not-found.tsx.
 */
export default function NotFound() {
  const t = useTranslations("marketing");
  const { isDarkMode } = useThemeContext();

  return (
    <Box className="flex min-h-screen w-full items-center justify-center p-4">
      <Paper
        elevation={3}
        className={cn(
          isDarkMode
            ? "bg-[url(/images/misc/error-background-dark.svg)]"
            : "bg-[url(/images/misc/error-background-light.svg)]",
          "bg-background-paper shadow-darker-xs min-h-[400px] max-w-full min-w-full items-center justify-center rounded-4xl bg-center py-14 md:min-w-[800px]",
        )}
      >
        <Box className="flex flex-col gap-4 px-8 sm:px-14">
          <Box className="mb-14 flex justify-center">
            <Logo classNameMobile="hidden h-9 w-auto" />
          </Box>
          <Box className="flex flex-col items-center gap-4 text-center">
            <Typography variant="h1" component="h1">
              {t("not-found-title")}
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {t("not-found-body")}
            </Typography>
            <Box className="flex flex-row flex-wrap justify-center gap-2">
              <Button variant="contained" startIcon={<NiHome />} href="/" LinkComponent={LocaleLink}>
                {t("not-found-home")}
              </Button>
              <Button variant="outlined" href="/contato" LinkComponent={LocaleLink}>
                {t("nav-contact")}
              </Button>
            </Box>
          </Box>
        </Box>
      </Paper>
    </Box>
  );
}
