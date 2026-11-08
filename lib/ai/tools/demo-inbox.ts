import { tool } from "ai";
import { z } from "zod";

/**
 * Synthetic, fixed data for testing the *existing* chat/tool/message pipeline.
 * Nothing is fetched from Gmail or any external endpoint.
 */
export type FictionalInboxMessage = {
  id: string;
  sender: string;
  subject: string;
  category: "Projects" | "Travel" | "Personal";
  priority: 1 | 2 | 3 | 4 | 5;
  needsReply: boolean;
};

export type FictionalInboxResult = {
  kind: "fictional-inbox";
  language: "en" | "tr";
  fixtureId: "inbox-demo-v1";
  disclaimer: string;
  messages: FictionalInboxMessage[];
};

const FIXTURE: FictionalInboxMessage[] = [
  {
    id: "demo-01",
    sender: "mira@example.test",
    subject: "Project milestone review",
    category: "Projects",
    priority: 5,
    needsReply: true,
  },
  {
    id: "demo-02",
    sender: "alexa@example.test",
    subject: "Design feedback request",
    category: "Projects",
    priority: 4,
    needsReply: true,
  },
  {
    id: "demo-03",
    sender: "trips@example.test",
    subject: "Itinerary confirmation",
    category: "Travel",
    priority: 4,
    needsReply: true,
  },
  {
    id: "demo-04",
    sender: "club@example.test",
    subject: "Weekend activity reminder",
    category: "Personal",
    priority: 3,
    needsReply: false,
  },
  {
    id: "demo-05",
    sender: "nina@example.test",
    subject: "Review the presentation",
    category: "Projects",
    priority: 5,
    needsReply: true,
  },
  {
    id: "demo-06",
    sender: "hotel@example.test",
    subject: "Your fictional reservation",
    category: "Travel",
    priority: 2,
    needsReply: false,
  },
  {
    id: "demo-07",
    sender: "events@example.test",
    subject: "Local event details",
    category: "Personal",
    priority: 2,
    needsReply: false,
  },
  {
    id: "demo-08",
    sender: "oliver@example.test",
    subject: "Follow-up on shared plan",
    category: "Projects",
    priority: 3,
    needsReply: true,
  },
  {
    id: "demo-09",
    sender: "flight@example.test",
    subject: "Packing information",
    category: "Travel",
    priority: 1,
    needsReply: false,
  },
  {
    id: "demo-10",
    sender: "friend@example.test",
    subject: "Dinner invitation",
    category: "Personal",
    priority: 4,
    needsReply: true,
  },
  {
    id: "demo-11",
    sender: "report@example.test",
    subject: "Weekly newsletter",
    category: "Projects",
    priority: 1,
    needsReply: false,
  },
  {
    id: "demo-12",
    sender: "support@example.test",
    subject: "Help article",
    category: "Personal",
    priority: 2,
    needsReply: false,
  },
];

export function createFictionalInbox(
  language: "en" | "tr" = "en"
): FictionalInboxResult {
  return {
    kind: "fictional-inbox",
    language,
    fixtureId: "inbox-demo-v1",
    disclaimer:
      "Fictional sample data. No personal Gmail or other account was accessed.",
    messages: FIXTURE.map((item) => ({ ...item })),
  };
}

export const demoInbox = tool({
  description:
    "Display an INTERACTIVE DEMO of a completely fictional email inbox containing 12 sample messages. Use only if the user explicitly asks to see a fictional/mock/test inbox, a demo chart, or an interactive inbox UI experiment. NEVER use this for a question about the user's actual emails. This does NOT connect to Gmail.",
  inputSchema: z.object({
    language: z
      .enum(["en", "tr"])
      .optional()
      .describe("Use tr for a Turkish request, otherwise en."),
  }),
  execute: async ({ language }) => createFictionalInbox(language),
  toModelOutput: ({ output }) => {
    const categories = {
      Projects: output.messages.filter((item) => item.category === "Projects")
        .length,
      Travel: output.messages.filter((item) => item.category === "Travel")
        .length,
      Personal: output.messages.filter((item) => item.category === "Personal")
        .length,
    };
    return {
      type: "text",
      value: JSON.stringify({
        fictional: true,
        total: output.messages.length,
        needsReply: output.messages.filter((item) => item.needsReply).length,
        categories,
        note: "Interactive fictional inbox card displayed to the user. No Gmail access.",
      }),
    } as const;
  },
});
