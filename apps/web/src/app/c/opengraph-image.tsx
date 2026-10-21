import { ImageResponse } from "next/og";

import { common, hsl } from "@flyee/design-tokens";

export const alt = "Seu caso";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/**
 * The preview card of a client's link: a plain card that says what the link
 * is, with no platform mark, because the passenger reads the firm's name and
 * never the platform's (the card of the public site, `app/opengraph-image.tsx`,
 * carries ONE's). The token is not in this image's address.
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
        Seu caso
      </div>
    ),
    size,
  );
}
