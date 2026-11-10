import type { MascotVariant } from "./mascot";

export type BotThemeTokens = {
  accent: string;
  accentForeground: string;
  tint: string;
  ring: string;
  avatarRing: string;
  /** Link colour on the card surface. Light accents use a darker ink. */
  link: string;
  /** Optional control edge when the fill is close to the page. */
  edge: string;
};

export type BotThemePair = {
  light: BotThemeTokens;
  dark: BotThemeTokens;
};

const white = "#FFFFFF";
const ink = "#1A1400";
const nearBlack = "#1C1917";

export const BOT_THEMES: Record<MascotVariant, BotThemePair> = {
  blue: {
    light: {
      accent: "#0B5CAD",
      accentForeground: white,
      tint: "#E5F2FC",
      ring: "#0B5CAD",
      avatarRing: "#0B5CAD",
      link: "#0B5CAD",
      edge: "transparent",
    },
    dark: {
      accent: "#7CC4FF",
      accentForeground: "#0B1B2B",
      tint: "#1A2833",
      ring: "#7CC4FF",
      avatarRing: "#7CC4FF",
      link: "#7CC4FF",
      edge: "transparent",
    },
  },
  purple: {
    light: {
      accent: "#6B21A8",
      accentForeground: white,
      tint: "#F3E8FF",
      ring: "#6B21A8",
      avatarRing: "#6B21A8",
      link: "#6B21A8",
      edge: "transparent",
    },
    dark: {
      accent: "#D8B4FE",
      accentForeground: "#1E1030",
      tint: "#261A30",
      ring: "#D8B4FE",
      avatarRing: "#D8B4FE",
      link: "#D8B4FE",
      edge: "transparent",
    },
  },
  pink: {
    light: {
      accent: "#BE185D",
      accentForeground: white,
      tint: "#FDE7F1",
      ring: "#BE185D",
      avatarRing: "#BE185D",
      link: "#BE185D",
      edge: "transparent",
    },
    dark: {
      accent: "#FF8DC0",
      accentForeground: "#2A1020",
      tint: "#2A1A22",
      ring: "#FF8DC0",
      avatarRing: "#FF8DC0",
      link: "#FF8DC0",
      edge: "transparent",
    },
  },
  orange: {
    light: {
      accent: "#C2410C",
      accentForeground: white,
      tint: "#FFF1E6",
      ring: "#C2410C",
      avatarRing: "#C2410C",
      link: "#C2410C",
      edge: "transparent",
    },
    dark: {
      accent: "#FFB067",
      accentForeground: "#2A1408",
      tint: "#2A2018",
      ring: "#FFB067",
      avatarRing: "#FFB067",
      link: "#FFB067",
      edge: "transparent",
    },
  },
  green: {
    light: {
      accent: "#157A32",
      accentForeground: white,
      tint: "#E5F6E4",
      ring: "#157A32",
      avatarRing: "#157A32",
      link: "#157A32",
      edge: "transparent",
    },
    dark: {
      accent: "#9BE38A",
      accentForeground: "#0E2412",
      tint: "#1A2A1C",
      ring: "#9BE38A",
      avatarRing: "#9BE38A",
      link: "#9BE38A",
      edge: "transparent",
    },
  },
  yellow: {
    light: {
      accent: "#A67C00",
      accentForeground: ink,
      tint: "#FFF4CC",
      ring: "#A67C00",
      avatarRing: "#A67C00",
      link: "#8C6800",
      edge: "transparent",
    },
    dark: {
      accent: "#FFE08A",
      accentForeground: ink,
      tint: "#2A2618",
      ring: "#FFE08A",
      avatarRing: "#FFE08A",
      link: "#FFE08A",
      edge: "transparent",
    },
  },
  red: {
    light: {
      accent: "#C81E1E",
      accentForeground: white,
      tint: "#FDECEC",
      ring: "#C81E1E",
      avatarRing: "#C81E1E",
      link: "#C81E1E",
      edge: "transparent",
    },
    dark: {
      accent: "#FF8A8A",
      accentForeground: "#2A0C0C",
      tint: "#2A1A1A",
      ring: "#FF8A8A",
      avatarRing: "#FF8A8A",
      link: "#FF8A8A",
      edge: "transparent",
    },
  },
  teal: {
    light: {
      accent: "#0F766E",
      accentForeground: white,
      tint: "#E5F7F5",
      ring: "#0F766E",
      avatarRing: "#0F766E",
      link: "#0F766E",
      edge: "transparent",
    },
    dark: {
      accent: "#7EEADF",
      accentForeground: "#062422",
      tint: "#142826",
      ring: "#7EEADF",
      avatarRing: "#7EEADF",
      link: "#7EEADF",
      edge: "transparent",
    },
  },
  black: {
    light: {
      accent: "#2A2926",
      accentForeground: white,
      tint: "#ECEAE6",
      ring: "#2A2926",
      avatarRing: "#2A2926",
      link: "#2A2926",
      edge: "transparent",
    },
    dark: {
      accent: "#E7E2DA",
      accentForeground: "#1A1917",
      tint: "#2A2926",
      ring: "#E7E2DA",
      avatarRing: "#E7E2DA",
      link: "#E7E2DA",
      edge: "transparent",
    },
  },
  white: {
    light: {
      accent: "#E6E1D6",
      accentForeground: nearBlack,
      tint: "#F3F1EC",
      ring: "#6B645C",
      avatarRing: "#6B645C",
      link: "#3F3A36",
      edge: "#6B645C",
    },
    dark: {
      accent: "#F4F1EC",
      accentForeground: nearBlack,
      tint: "#2C2A28",
      ring: "#F4F1EC",
      avatarRing: "#F4F1EC",
      link: "#F4F1EC",
      edge: "transparent",
    },
  },
};

const LIGHT_PAGE = "#F6F5F3";
const LIGHT_TEXT = "#161513";
const DARK_PAGE = "#141311";
const DARK_TEXT = "#F4F1EC";
const LIGHT_CARD = "#FFFFFF";
const DARK_CARD = "#221F1C";

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.040_45
    ? scaled / 12.92
    : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const raw = hex.slice(1);
  const red = channel(Number.parseInt(raw.slice(0, 2), 16));
  const green = channel(Number.parseInt(raw.slice(2, 4), 16));
  const blue = channel(Number.parseInt(raw.slice(4, 6), 16));
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(luminance(first), luminance(second));
  const darker = Math.min(luminance(first), luminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

function block(selector: string, tokens: BotThemeTokens): string {
  return `${selector}{--bot-accent:${tokens.accent};--bot-accent-foreground:${tokens.accentForeground};--bot-tint:${tokens.tint};--bot-ring:${tokens.ring};--bot-avatar-ring:${tokens.avatarRing};--bot-link:${tokens.link};--bot-edge:${tokens.edge};}`;
}

/** One stylesheet so the accent family cannot drift from the contrast tests. */
export function botThemeCss(): string {
  const blue = BOT_THEMES.blue;
  const rules = [block(":root", blue.light), block(".dark", blue.dark)];
  for (const [id, pair] of Object.entries(BOT_THEMES)) {
    rules.push(block(`:root[data-bot-theme="${id}"]`, pair.light));
    rules.push(block(`.dark[data-bot-theme="${id}"]`, pair.dark));
  }
  return rules.join("");
}

export const THEME_SURFACES = {
  lightPage: LIGHT_PAGE,
  lightText: LIGHT_TEXT,
  lightCard: LIGHT_CARD,
  darkPage: DARK_PAGE,
  darkText: DARK_TEXT,
  darkCard: DARK_CARD,
};
