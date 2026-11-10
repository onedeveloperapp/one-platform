import Link from "next/link";

import { Box, Breadcrumbs, Typography } from "@mui/material";

import InfoHint from "@/components/product/info-hint";

/**
 * The title block every member screen opens with: the page's one `<h1>`, the
 * breadcrumb trail back to the home, and at most one action on the right.
 *
 * What the screen is goes behind the "i" beside the title (`description`): a
 * person reads it once, when they want, and never again on every visit (the
 * owner, 2026-11-09: a page that opened on a paragraph read as tiring). A line
 * under the trail is only for state or data that tells this page apart
 * (`detail`: the kind of a case, who a passenger is), never a definition.
 *
 * The template's own page-title markup (Typography h1 over MUI Breadcrumbs),
 * packaged once because every screen of the member area repeats it verbatim.
 */
export default function PageHeader({
  title,
  crumbs,
  description,
  detail,
  chip,
  action,
}: {
  title: string;
  /** From the home down to the current page; the last one is the page itself and is not a link. */
  crumbs: { label: string; href?: string }[];
  /** What this screen is for, behind the "i" beside the title. At most 200 characters (a test keeps it). */
  description?: string;
  /** One line of state or data under the trail, shown. Never what the screen is for: that is `description`. */
  detail?: React.ReactNode;
  /** Where the page's subject stands, beside its title (a `StatusChip`). */
  chip?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <Box className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <Box className="flex min-w-0 flex-col gap-1">
        <Box className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Typography variant="h1" component="h1" className="mb-0">
            {title}
          </Typography>
          {description ? <InfoHint label={description} placement="bottom-start" className="self-center" /> : null}
          {chip ? <Box className="flex items-center">{chip}</Box> : null}
        </Box>
        <Breadcrumbs>
          {crumbs.map((crumb, index) =>
            crumb.href && index < crumbs.length - 1 ? (
              <Link key={crumb.label} color="inherit" href={crumb.href}>
                {crumb.label}
              </Link>
            ) : (
              <Typography key={crumb.label} variant="body2">
                {crumb.label}
              </Typography>
            ),
          )}
        </Breadcrumbs>
        {detail ? (
          <Typography variant="body2" component="div" className="text-text-secondary mt-1">
            {detail}
          </Typography>
        ) : null}
      </Box>
      {action ? <Box className="flex-none">{action}</Box> : null}
    </Box>
  );
}
