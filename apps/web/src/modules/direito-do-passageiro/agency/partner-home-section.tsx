"use client";

import PartnerFlightsCard from "./partner-flights-card";
import PartnerPassengersCard from "./partner-passengers-card";
import PartnerUnagreedCard from "./partner-unagreed-card";

import { Box } from "@mui/material";

/**
 * The passenger module's section of a partner's home (`partnerHome` of its definition; the core opens it through
 * the registry, never by name): who flies soon with no agreement, while there is time to send the link (0094), the
 * passengers in progress, each with where they are along their way, then their flights as they happen.
 */
export default function PartnerHomeSection() {
  return (
    <Box className="flex flex-col gap-5">
      <PartnerUnagreedCard />
      <PartnerPassengersCard />
      <PartnerFlightsCard />
    </Box>
  );
}
