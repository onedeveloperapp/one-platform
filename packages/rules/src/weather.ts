/**
 * Reading a METAR, the routine weather report of an airport, for the signs a
 * person would look at when an airline says a flight was held by the weather.
 *
 * This reads what the report SAYS (visibility, the lowest broken or overcast
 * layer, the weather groups, the wind's gusts), never what the airport's
 * operating minimums were: a sign is a reason to look, not a conclusion. The
 * numbers that make a sign are configuration (the setting `tema_1417`),
 * handed in by the caller; the defaults here are only what a test uses.
 *
 * Only the observation is read: it starts after the day and hour of the
 * report (`DDHHMMZ`), so the kind of report and the station's own code are
 * never taken for weather (`SNBR` is Barreiras, not snow and mist), and it
 * stops at the trend (`TEMPO`, `BECMG`, `NOSIG`) and the remarks (`RMK`),
 * which are forecasts and notes.
 */

export type MetarReading = {
  /** Meters; 9999 and CAVOK read as 10000. Null when the report has none. */
  visibilityMeters: number | null;
  /** Feet of the lowest broken, overcast or vertical-visibility layer; null when there is none. */
  ceilingFeet: number | null;
  /** The weather groups as written: `+TSRA`, `BR`, `VCSH`. */
  weather: string[];
  windKnots: number | null;
  gustKnots: number | null;
  cavok: boolean;
};

export type WeatherThresholds = {
  /** A visibility below this many meters is a sign. */
  visibilityBelowMeters: number;
  /** A ceiling below this many feet is a sign. */
  ceilingBelowFeet: number;
  /** Gusts above this many knots are a sign. */
  gustAboveKnots: number;
};

export const DEFAULT_WEATHER_THRESHOLDS: WeatherThresholds = {
  visibilityBelowMeters: 1500,
  ceilingBelowFeet: 500,
  gustAboveKnots: 35,
};

/**
 * - `low_visibility`, `low_ceiling`, `strong_gusts`: past the thresholds;
 * - `thunderstorm` (TS), `fog` (FG), `freezing` (FZ), `snow` (SN), `hail` (GR, GS), `squall` (SQ),
 *   `funnel_cloud` (FC), `volcanic_ash` (VA), `dust_or_sand_storm` (SS, DS), `heavy_rain` (+ with RA).
 */
export type WeatherSign =
  | "low_visibility"
  | "low_ceiling"
  | "strong_gusts"
  | "thunderstorm"
  | "fog"
  | "freezing"
  | "snow"
  | "hail"
  | "squall"
  | "funnel_cloud"
  | "volcanic_ash"
  | "dust_or_sand_storm"
  | "heavy_rain";

const STOP = new Set(["TEMPO", "BECMG", "NOSIG", "RMK"]);
const WEATHER =
  /^(\+|-|VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)*$/;

const isWeatherGroup = (token: string): boolean =>
  token.length >= 2 && WEATHER.test(token) && /(TS|DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS|SH)/.test(token);

export function readMetar(raw: string): MetarReading {
  const reading: MetarReading = {
    visibilityMeters: null,
    ceilingFeet: null,
    weather: [],
    windKnots: null,
    gustKnots: null,
    cavok: false,
  };
  const all = raw.trim().toUpperCase().replace(/=+$/, "").split(/\s+/);
  const time = all.findIndex((token) => /^\d{6}Z$/.test(token));
  // Without its day and hour (a report cut short), the heading is still left out: the kind and the station.
  const heading = all.findIndex((token) => !/^(METAR|SPECI|COR|AUTO)$/.test(token));
  const tokens = time >= 0 ? all.slice(time + 1) : all.slice(heading < 0 ? all.length : heading + 1);
  for (const token of tokens) {
    if (STOP.has(token)) break;
    if (token === "CAVOK") {
      reading.cavok = true;
      reading.visibilityMeters = 10000;
      continue;
    }
    const wind = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT$/.exec(token);
    if (wind) {
      reading.windKnots = Number(wind[2]);
      reading.gustKnots = wind[3] ? Number(wind[3]) : null;
      continue;
    }
    if (/^\d{4}$/.test(token) && reading.visibilityMeters === null) {
      reading.visibilityMeters = token === "9999" ? 10000 : Number(token);
      continue;
    }
    const layer = /^(BKN|OVC|VV)(\d{3})/.exec(token);
    if (layer) {
      const feet = Number(layer[2]) * 100;
      reading.ceilingFeet = reading.ceilingFeet === null ? feet : Math.min(reading.ceilingFeet, feet);
      continue;
    }
    if (isWeatherGroup(token)) reading.weather.push(token);
  }
  return reading;
}

export function weatherSigns(reading: MetarReading, thresholds: WeatherThresholds = DEFAULT_WEATHER_THRESHOLDS): WeatherSign[] {
  const signs = new Set<WeatherSign>();
  if (reading.visibilityMeters !== null && reading.visibilityMeters < thresholds.visibilityBelowMeters) {
    signs.add("low_visibility");
  }
  if (reading.ceilingFeet !== null && reading.ceilingFeet < thresholds.ceilingBelowFeet) signs.add("low_ceiling");
  if (reading.gustKnots !== null && reading.gustKnots > thresholds.gustAboveKnots) signs.add("strong_gusts");
  for (const group of reading.weather) {
    if (group.includes("TS")) signs.add("thunderstorm");
    if (group.includes("FG")) signs.add("fog");
    if (group.includes("FZ")) signs.add("freezing");
    if (group.includes("SN")) signs.add("snow");
    if (group.includes("GR") || group.includes("GS")) signs.add("hail");
    if (group.includes("SQ")) signs.add("squall");
    if (group.includes("FC")) signs.add("funnel_cloud");
    if (group.includes("VA")) signs.add("volcanic_ash");
    if (group.includes("SS") || group.includes("DS")) signs.add("dust_or_sand_storm");
    if (group.startsWith("+") && group.includes("RA")) signs.add("heavy_rain");
  }
  return [...signs];
}
