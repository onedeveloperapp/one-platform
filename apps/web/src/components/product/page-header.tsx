import Link from "next/link";

import { Box, Breadcrumbs, Typography } from "@mui/material";

/**
 * The title block every member screen opens with: the page's one `<h1>`, the
 * breadcrumb trail back to the home, and at most one action on the right.
 *
 * The template's own page-title markup (Typography h1 over MUI Breadcrumbs),
 * packaged once because every screen of the member area repeats it verbatim.
 */
export default function PageHeader({
  title,
  crumbs,
  description,
  action,
}: {
  title: string;
  /** From the home down to the current page; the last one is the page itself and is not a link. */
  crumbs: { label: string; href?: string }[];
  /** One sentence under the title: what this screen is for. */
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <Box className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <Box className="flex min-w-0 flex-col gap-1">
        <Typography variant="h1" component="h1" className="mb-0">
          {title}
        </Typography>
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
        {description ? (
          <Typography variant="body1" className="text-text-secondary mt-2 max-w-3xl">
            {description}
          </Typography>
        ) : null}
      </Box>
      {action ? <Box className="flex-none">{action}</Box> : null}
    </Box>
  );
}
