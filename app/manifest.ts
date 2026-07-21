import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Kal, Fitness log",
    short_name: "Kal",
    description: "Personal fitness chat and daily macro log.",
    start_url: "/",
    display: "standalone",
    background_color: "#F7F6F3",
    theme_color: "#F7F6F3",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
  };
}
