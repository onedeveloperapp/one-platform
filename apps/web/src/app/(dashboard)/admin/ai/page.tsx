import AiConsoleView from "./components/ai-console-view";

import {
  loadAiAccuracy,
  loadAiHealth,
  loadAiSpend,
  loadAutonomyCatalog,
  loadDjenHealth,
  loadFirmChoices,
  loadFlightWatch,
  loadTaskPrompts,
  loadTriageMeasure,
} from "@/lib/admin/ai";
import { loadConsole } from "@/lib/admin/session";
import { providerReadiness } from "@/lib/ai/executor";
import { isDjenCaptureOn } from "@/lib/courts/djen";
import { isMarketCaptureOn } from "@/lib/jurimetrics/capture";
import { flightStatusProvider } from "@/modules/direito-do-passageiro/flights/status";

export const metadata = { title: "IA" };

// The executor check calls a model from an action of this page: a short task
// answers in seconds, and the limit leaves room for a slow provider.
export const maxDuration = 60;

/**
 * /admin/ai: what the platform's use of AI costs and to which firm
 * (`admin_ai_spend_overview`, migration 0014), how the answers of each task
 * fared with the people who decided them (`admin_ai_task_accuracy`, 0016), the
 * instructions of each task (the next version and the autonomy are written
 * here), how the reading of the DJEN is doing across every firm
 * (`admin_djen_health`, 0028) and how the shadow triage of publications
 * compares with the people's (`admin_publication_triage_measure`, 0028), the
 * check that runs the whole path for one firm, the price list behind every
 * cost figure, and the flights ONE follows at FlightAware with the release of
 * its first word to real passengers (`admin_flight_watch_status`, 0051).
 * Counts and cost only: an answer belongs to its firm.
 */
export default async function AdminAiPage() {
  const state = await loadConsole(async ({ supabase }) => {
    const [spend, accuracy, firms, prompts, triage, djen, autonomy, flights, health] = await Promise.all([
      loadAiSpend(supabase, 30),
      loadAiAccuracy(supabase, 90),
      loadFirmChoices(supabase),
      loadTaskPrompts(supabase),
      loadTriageMeasure(supabase, 90),
      loadDjenHealth(supabase),
      loadAutonomyCatalog(supabase),
      loadFlightWatch(supabase),
      loadAiHealth(supabase),
    ]);
    return {
      spend,
      accuracy,
      firms,
      prompts,
      triage,
      djen,
      autonomy,
      flights,
      health,
      flightSourceOn: flightStatusProvider() !== null,
      djenCaptureOn: isDjenCaptureOn(),
      marketCaptureOn: isMarketCaptureOn(),
      readiness: providerReadiness(),
      serviceAvailable: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
    };
  });
  return <AiConsoleView state={state} />;
}
