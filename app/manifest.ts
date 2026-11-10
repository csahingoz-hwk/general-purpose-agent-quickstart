import type { MetadataRoute } from "next";
import { LIGHT_THEME_COLOR } from "@/lib/theme-colors";

/**
 * Installed home-screen app. Splash and chrome use the light shell colour;
 * the viewport theme-color meta covers light and dark browser chrome.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Assistant",
    short_name: "Assistant",
    description:
      "A personal assistant for planning, answers, and everyday tasks.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: LIGHT_THEME_COLOR,
    theme_color: LIGHT_THEME_COLOR,
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
