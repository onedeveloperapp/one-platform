import { describe, expect, it } from "vitest";

import {
  emptyLeg,
  legOfReading,
  legReady,
  legToSend,
  legWhen,
  passengerErrorKey,
  tripStoppable,
} from "@/modules/direito-do-passageiro/passengers/passengers";

const leg = {
  flight_number: "la 3456",
  origin_iata: "gyn",
  destination_iata: "GRU ",
  scheduled_departure_local: "2099-01-10T08:00",
  scheduled_arrival_local: "2099-01-10T09:45",
};

describe("the firm's own passenger", () => {
  it("sends a leg as the database takes it, and none left blank", () => {
    expect(legToSend(leg)).toEqual({
      flight_number: "LA3456",
      origin_iata: "GYN",
      destination_iata: "GRU",
      scheduled_departure_local: "2099-01-10T08:00",
      scheduled_arrival_local: "2099-01-10T09:45",
    });
    expect(legToSend(emptyLeg())).toBeNull();
  });

  it("asks a whole leg: a flight, two airports and an arrival after the departure", () => {
    expect(legReady(leg)).toBe(true);
    expect(legReady({ ...leg, flight_number: "voo" })).toBe(false);
    expect(legReady({ ...leg, origin_iata: "GO" })).toBe(false);
    expect(legReady({ ...leg, scheduled_arrival_local: "2099-01-10T07:00" })).toBe(false);
    expect(legReady({ ...leg, scheduled_departure_local: "" })).toBe(false);
  });

  it("takes a leg ONE read, leaving out a moment that is not one", () => {
    expect(
      legOfReading({
        flight_number: "G31234",
        booking_reference: "ABC123",
        origin_iata: "BSB",
        destination_iata: "CGH",
        scheduled_departure_local: "2099-02-01T10:00",
        scheduled_arrival_local: "amanhã",
      }),
    ).toEqual({
      flight_number: "G31234",
      origin_iata: "BSB",
      destination_iata: "CGH",
      scheduled_departure_local: "2099-02-01T10:00",
      scheduled_arrival_local: "",
    });
  });

  it("writes a moment as the screens do", () => {
    expect(legWhen("2099-01-10T08:00")).toBe("10/01/2099 08:00");
    expect(legWhen("")).toBe("");
  });

  it("names each refusal, and stops only a trip still followed", () => {
    expect(passengerErrorKey("invalid_data", "legs")).toBe("passenger-error-legs");
    expect(passengerErrorKey("no_phone")).toBe("passenger-error-no-phone");
    expect(passengerErrorKey("something_else")).toBe("passenger-error-failed");
    expect(tripStoppable("watching")).toBe(true);
    expect(tripStoppable("alerted")).toBe(true);
    expect(tripStoppable("case_opened")).toBe(false);
  });
});
