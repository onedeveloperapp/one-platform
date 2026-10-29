import { ImageResponse } from "next/og";

import { common, hsl } from "@flyee/design-tokens";

export const alt = "Seus voos";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The preview card of a passenger's link of an agency: a plain card that says what the link is, with no mark,
 * as the card of a client's link (`app/c/opengraph-image.tsx`). The token is not in this image's address.
 */
export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: hsl(common.light["background-paper"]),
          color: hsl(common.light["text-primary"]),
          fontSize: 72,
        }}
      >
        Seus voos
      </div>
    ),
    size,
  );
}
