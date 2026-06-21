import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// iOS home-screen icon (PNG). Matches the bone-on-ink mark.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#1F2421",
          color: "#F7F6F3",
          fontSize: 116,
          fontWeight: 500,
          fontFamily: "Georgia, serif",
        }}
      >
        K
      </div>
    ),
    size,
  );
}
