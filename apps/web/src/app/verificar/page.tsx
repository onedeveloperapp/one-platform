import CodeForm from "./code-form";
import VerifyFrame from "./frame";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Box, Typography } from "@mui/material";

/**
 * Where somebody who received a document issued through ONE checks it: they
 * type the code printed at the foot of the page. Public, with no account;
 * kept out of search engines, and it loads no tracker.
 */
export const metadata: Metadata = {
  title: "Conferir um documento",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function VerifyPage() {
  const t = await getTranslations("product");
  return (
    <VerifyFrame>
      <Box className="flex flex-col gap-6">
        <Box className="flex flex-col">
          <Typography variant="h1" component="h1" className="mb-2">
            {t("verify-title")}
          </Typography>
          <Typography variant="body1" className="text-text-primary">
            {t("verify-intro")}
          </Typography>
        </Box>
        <CodeForm />
        <Typography variant="body2" className="text-text-secondary">
          {t("verify-safety")}
        </Typography>
      </Box>
    </VerifyFrame>
  );
}
