import { describe, expect, it } from "vitest";

import { baseMime, mediaType } from "@/lib/whatsapp/media-type";

describe("the type a WhatsApp media is kept under", () => {
  it("takes the PDF a message declared when the vendor's download names no format", () => {
    // OpenWA's answer for a document (2026-11-13): the bytes unknown to the detector, the download generic.
    expect(mediaType(null, "application/octet-stream", "application/pdf")).toBe("application/pdf");
  });

  it("takes what the bytes are over what anybody said", () => {
    expect(mediaType("application/pdf", "application/octet-stream", "application/pdf")).toBe("application/pdf");
    expect(mediaType("image/jpeg", "image/png", "image/webp")).toBe("image/jpeg");
  });

  it("takes the vendor's type when it names one and the bytes say nothing", () => {
    expect(mediaType(null, "audio/ogg; codecs=opus", null)).toBe("audio/ogg");
    expect(mediaType(null, "Audio/AMR", "audio/ogg")).toBe("audio/amr");
  });

  it("is generic when nobody names a format, so the purpose refuses it", () => {
    expect(mediaType(null, "application/octet-stream", null)).toBe("application/octet-stream");
    expect(mediaType(null, "", "  ")).toBe("application/octet-stream");
    expect(mediaType(null, null, "binary/octet-stream")).toBe("application/octet-stream");
  });

  it("drops a type's parameters", () => {
    expect(baseMime("audio/ogg; codecs=opus")).toBe("audio/ogg");
    expect(baseMime(null)).toBe("");
  });
});
