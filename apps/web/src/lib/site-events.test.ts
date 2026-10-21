// @vitest-environment node
import { describe, expect, it } from "vitest";

import { datasetToEventProps, isSiteEventName, trackAttributes } from "@/lib/site-events";

describe("site events declared as data attributes", () => {
  it("turns the attributes an element carries into the event's props", () => {
    expect(datasetToEventProps({ track: "cta_click", trackCtaId: "hero", section: "ignored" })).toEqual({
      cta_id: "hero",
    });
    expect(datasetToEventProps({ track: "contact_click", trackLocation: "footer" })).toEqual({
      location: "footer",
    });
  });

  it("writes the attributes a server component declares an event with", () => {
    expect(trackAttributes({ event: "contact_click", location: "hero" })).toEqual({
      "data-track": "contact_click",
      "data-track-location": "hero",
    });
    expect(trackAttributes({ event: "cta_click", cta_id: "final" })).toEqual({
      "data-track": "cta_click",
      "data-track-cta-id": "final",
    });
  });

  it("knows its own vocabulary and nothing else", () => {
    expect(isSiteEventName("faq_open")).toBe(true);
    expect(isSiteEventName("purchase")).toBe(false);
    expect(isSiteEventName(null)).toBe(false);
  });
});
