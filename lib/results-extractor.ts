import { readFixturePayload } from "./fixtures";
import { visualPayload } from "./openui/attach";
import type { ChatMessage } from "./types";

export type ConversationResultKind =
  | "openui"
  | "fixture"
  | "weather"
  | "document"
  | "draft"
  | "inbox";

export type ConversationResultSummary = {
  id: string;
  messageId: string;
  kind: ConversationResultKind;
  title: string;
  subtitle: string;
};

export function extractConversationResults(
  messages: readonly ChatMessage[]
): ConversationResultSummary[] {
  const results: ConversationResultSummary[] = [];

  for (const message of messages) {
    if (message.role !== "assistant") {
      continue;
    }

    const openui = visualPayload(message.parts);
    if (openui) {
      results.push({
        id: `${message.id}-openui`,
        messageId: message.id,
        kind: "openui",
        title: openui.data.stats.current?.hint ?? "Interactive visual card",
        subtitle: "Grounded OpenUI summary",
      });
    }

    for (let i = 0; i < message.parts.length; i++) {
      const part = message.parts[i];
      if (part.type === "tool-getFixtures" && "output" in part) {
        const fixture = readFixturePayload(part.output);
        if (fixture) {
          results.push({
            id: `${message.id}-fixture-${i}`,
            messageId: message.id,
            kind: "fixture",
            title: `${fixture.team.name} fixtures`,
            subtitle: fixture.upcoming[0]
              ? `Next: ${fixture.upcoming[0].home.name} vs ${fixture.upcoming[0].away.name}`
              : "Fixture feed",
          });
        }
      } else if (
        part.type === "tool-getWeather" &&
        part.state === "output-available" &&
        part.output &&
        !("error" in part.output) &&
        !openui
      ) {
        const city =
          (part.output as { cityName?: string }).cityName ?? "Forecast";
        results.push({
          id: `${message.id}-weather-${i}`,
          messageId: message.id,
          kind: "weather",
          title: `Weather · ${city}`,
          subtitle: "3-day Open-Meteo forecast",
        });
      } else if (
        (part.type === "tool-createDocument" ||
          part.type === "tool-updateDocument") &&
        part.state === "output-available" &&
        part.output &&
        !("error" in part.output)
      ) {
        const doc = part.output as { title?: string; kind?: string };
        results.push({
          id: `${message.id}-doc-${i}`,
          messageId: message.id,
          kind: "document",
          title: doc.title ?? "Document artifact",
          subtitle: `Canvas (${doc.kind ?? "text"})`,
        });
      } else if (part.type === "tool-draftOutboundMessage") {
        const input =
          "input" in part
            ? (part.input as { channel?: string; recipient?: string })
            : undefined;
        results.push({
          id: `${message.id}-draft-${i}`,
          messageId: message.id,
          kind: "draft",
          title: `Draft → ${input?.recipient ?? "recipient"}`,
          subtitle: `${input?.channel ?? "outbound"} (${part.state})`,
        });
      } else if (
        part.type === "tool-demoInbox" &&
        part.state === "output-available"
      ) {
        results.push({
          id: `${message.id}-inbox-${i}`,
          messageId: message.id,
          kind: "inbox",
          title: "Fictional inbox demo",
          subtitle: "12 synthetic sample messages",
        });
      }
    }
  }

  return results;
}
