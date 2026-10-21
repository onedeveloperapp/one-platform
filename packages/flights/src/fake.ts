import {
  arrivalDelayMinutes,
  type FlightQuery,
  type FlightRecordSource,
  type FlightState,
  type FlightStatus,
  type FlightStatusProvider,
  type Metar,
  type VraMonth,
  type WeatherProvider,
} from "@flyee/flights/types";
import { VraFormatError, VraMonthReader, type VraWanted } from "@flyee/flights/vra";

/** A flight as a test declares it: the delay is derived, never typed in. */
export type FakeFlight = Omit<FlightStatus, "arrivalDelayMinutes" | "state"> & { state?: FlightState };

const codeOf = (flight: string) => flight.replace(/\s+/g, "").toUpperCase();
const keyOf = (query: FlightQuery) => `${codeOf(query.flight)}@${query.date}`;

/** The state the times imply, when a test does not name one. */
function impliedState(flight: FakeFlight): FlightState {
  if (flight.actualArrival) return "landed";
  if (flight.actualDeparture) return "departed";
  return "scheduled";
}

/**
 * Flights and weather in memory, for development and tests. A test declares
 * what happened (`addFlight`, `addMetar`, `addRecordMonth`) and the code
 * under test reads it through the same interfaces as the real providers.
 */
export class FakeFlightData implements FlightStatusProvider, WeatherProvider, FlightRecordSource {
  private readonly flights = new Map<string, FlightStatus>();
  private readonly observations: Metar[] = [];
  private readonly months = new Map<string, string | { unavailable: string }>();

  /** A month of the official record, as the text of its file, or as a server that did not answer. */
  addRecordMonth(month: string, file: string | { unavailable: string }): void {
    this.months.set(month, file);
  }

  async readMonth(month: string, wanted: VraWanted): Promise<VraMonth> {
    const file = this.months.get(month);
    if (file === undefined) return { kind: "missing" };
    if (typeof file !== "string") return { kind: "unavailable", code: file.unavailable };
    const reader = new VraMonthReader(wanted);
    try {
      for (const line of file.split(/\r?\n/)) reader.take(line);
      if (!reader.started) return { kind: "unavailable", code: "anac_empty" };
      return reader.finish();
    } catch (error) {
      if (error instanceof VraFormatError) return { kind: "unavailable", code: "anac_format" };
      throw error;
    }
  }

  addFlight(flight: FakeFlight): void {
    const state = flight.state ?? impliedState(flight);
    const landedThere = state === "landed" && flight.actualArrival !== null;
    this.flights.set(keyOf(flight), {
      ...flight,
      flight: codeOf(flight.flight),
      state,
      arrivalDelayMinutes: landedThere
        ? arrivalDelayMinutes(flight.scheduledArrival, flight.actualArrival as string)
        : null,
    });
  }

  addMetar(metar: Metar): void {
    this.observations.push({ ...metar, icao: metar.icao.toUpperCase() });
  }

  async getFlightStatus(query: FlightQuery): Promise<FlightStatus | null> {
    const found = this.flights.get(keyOf(query));
    return found ? { ...found } : null;
  }

  async getMetar(input: { icao: string; from: string; to: string }): Promise<Metar[]> {
    const from = Date.parse(input.from);
    const to = Date.parse(input.to);
    return this.observations
      .filter((metar) => {
        const observed = Date.parse(metar.observedAt);
        return metar.icao === input.icao.toUpperCase() && observed >= from && observed <= to;
      })
      .map((metar) => ({ ...metar }))
      .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  }
}
