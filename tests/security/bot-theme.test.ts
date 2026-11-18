import assert from "node:assert/strict";
import test from "node:test";
import { BOT_THEMES, contrastRatio, THEME_SURFACES } from "../../lib/bot-theme";
import { AGENT_MASCOTS } from "../../lib/mascot";

test("every mascot theme keeps AA text contrast and a visible control", () => {
  for (const mascot of AGENT_MASCOTS) {
    const pair = BOT_THEMES[mascot.id];
    for (const mode of ["light", "dark"] as const) {
      const tokens = pair[mode];
      const page =
        mode === "light" ? THEME_SURFACES.lightPage : THEME_SURFACES.darkPage;
      const text =
        mode === "light" ? THEME_SURFACES.lightText : THEME_SURFACES.darkText;
      const card =
        mode === "light" ? THEME_SURFACES.lightCard : THEME_SURFACES.darkCard;
      assert.ok(
        contrastRatio(tokens.accent, tokens.accentForeground) >= 4.5,
        `${mascot.id} ${mode} button text`
      );
      assert.ok(
        contrastRatio(tokens.tint, text) >= 4.5,
        `${mascot.id} ${mode} tint`
      );
      assert.ok(
        contrastRatio(tokens.link, card) >= 4.5,
        `${mascot.id} ${mode} link`
      );
      const edge = tokens.edge === "transparent" ? tokens.accent : tokens.edge;
      assert.ok(
        contrastRatio(edge, page) >= 3,
        `${mascot.id} ${mode} control edge`
      );
    }
  }
});
