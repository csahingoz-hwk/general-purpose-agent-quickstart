/** Compact visual instructions. Included only when a tool result can be drawn. */
export const visualPrompt = `## Visual card
After your prose you may add one \`\`\`openui block. The root must be Card(title, summary, children). Inside it use only Chart, Table, Stat, Slider, Tabs, and Map:
Chart(title, "line"|"bar"|"pie", seriesId)
Table(title, tableId)
Stat(label, statId)
Slider(label, seriesId)
Tabs(["Label"], ["datasetId"])
Map(title, placeId)
Use dataset ids that already exist in the tool result. Do not write numbers, queries, mutations, images, frames, actions, or a sources table. Sliders and tabs only filter that same data on the device. If you are unsure, omit the block.`;

export function visualPromptTokens(): number {
  return Math.ceil(visualPrompt.length / 4);
}
