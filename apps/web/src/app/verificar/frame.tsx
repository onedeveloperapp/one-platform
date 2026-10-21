import { Box, Paper } from "@mui/material";

import Logo from "@/components/logo/logo";

/**
 * The frame of the verification pages: the same quiet card as the invitation
 * page, with the ONE logo, because what is being checked is that ONE has the
 * record of the document.
 */
export default function VerifyFrame({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="main"
      className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4"
    >
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
