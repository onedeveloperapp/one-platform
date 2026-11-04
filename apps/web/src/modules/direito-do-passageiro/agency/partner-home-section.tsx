"use client";

import PartnerFlightsCard from "./partner-flights-card";
import PartnerPassengersCard from "./partner-passengers-card";

import { Box } from "@mui/material";

/**
 * The passenger module's section of a partner's home (`partnerHome` of its definition; the core opens it through
 * the registry, never by name): the passengers in progress, each with where they are along their way, then their
 * flights as they happen.
 */
export default function PartnerHomeSection() {
  return (
    <Box className="flex flex-col gap-5">
      <PartnerPassengersCard />
      <PartnerFlightsCard />
    </Box>
  );
}
