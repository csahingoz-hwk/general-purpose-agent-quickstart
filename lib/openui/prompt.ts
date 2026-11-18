/** Compact visual instructions. Included only when a structured card may help. */
export const visualPrompt = `## Visual card
When a visual card (Chart, Table, Stat, Slider, Tabs, Map, Comparison, or Timeline) makes the answer clearer, stream a concise summary first without duplicating a big table, then end with ONE \`\`\`visual-json block using verified facts only:
- {"kind":"comparison","title":"...","options":["A","B"],"rows":[{"feature":"...","values":["...","..."],"winnerIndex":0}],"verdict":"..."}
- {"kind":"timeline","title":"...","events":[{"when":"...","title":"...","detail":"..."}]}
- {"kind":"chart","chartKind":"bar"|"line"|"pie","title":"...","unit":"...","points":[{"label":"...","value":10}]}
- {"kind":"table","title":"...","columns":["..."],"rows":[["..."]]}
- {"kind":"map","title":"...","label":"...","latitude":51.5,"longitude":-0.12}
Never invent numbers or raw HTML. Omit the block for simple prose answers.`;

export function visualPromptTokens(): number {
  return Math.ceil(visualPrompt.length / 4);
}
