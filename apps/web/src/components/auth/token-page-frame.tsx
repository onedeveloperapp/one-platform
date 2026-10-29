import { Box, Paper, Typography } from "@mui/material";

import Logo from "@/components/logo/logo";

/**
 * The frame of a page opened by the token of a link, before anybody signs in (the invitation to a firm, the
 * invitation to a partner): the logo on a card over the background of the auth screens.
 */
export function TokenPageFrame({ children }: { children: React.ReactNode }) {
  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Paper elevation={3} className="bg-background-paper shadow-darker-xs w-lg max-w-full rounded-4xl py-14">
        <Box className="flex flex-col gap-10 px-8 sm:px-14">
          <Box className="flex justify-center">
            <Logo classNameFull="h-12 w-auto" classNameMobile="hidden" />
          </Box>
          {children}
        </Box>
      </Paper>
    </Box>
  );
}

/** A page's one message: its title (the page's h1), what it says, and what to do next. */
export function TokenPageMessage({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <Box className="flex flex-col gap-6">
      <Box className="flex flex-col">
        <Typography variant="h1" component="h1" className="mb-2">
          {title}
        </Typography>
        <Typography variant="body1" className="text-text-primary">
          {body}
        </Typography>
      </Box>
      {children}
    </Box>
  );
}
