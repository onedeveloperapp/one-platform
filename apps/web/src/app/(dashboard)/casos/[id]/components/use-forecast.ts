"use client";

import { useEffect, useState } from "react";

import { readCaseForecast } from "@/lib/jurimetrics/actions";
import { type CaseForecast } from "@/lib/jurimetrics/forecast";

export type ForecastRead = { state: "loading" } | { state: "error" } | { state: "ready"; read: CaseForecast | null };

/**
 * A lawsuit's forecast (0250), read when the case shows it and again when the lawsuit changes (filed, its unit or its
 * judge known): the case's card and its hearing share it. A failed read is said as such, never as no forecast.
 */
export function useCaseForecast(proceedingId: string | null, version: string): ForecastRead {
  const [read, setRead] = useState<ForecastRead>({ state: "loading" });
  useEffect(() => {
    if (!proceedingId) {
      setRead({ state: "ready", read: null });
      return;
    }
    let live = true;
    setRead((current) => (current.state === "ready" ? current : { state: "loading" }));
    readCaseForecast(proceedingId)
      .then((answer) => live && setRead({ state: "ready", read: answer }))
      .catch(() => live && setRead({ state: "error" }));
    return () => {
      live = false;
    };
  }, [proceedingId, version]);
  return read;
}
