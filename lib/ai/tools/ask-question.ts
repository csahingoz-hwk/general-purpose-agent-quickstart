import { tool } from "ai";
import { z } from "zod";

export type ClarifyingQuestionOption = {
  label: string;
  description?: string;
};

export type ClarifyingQuestionResult = {
  kind: "clarifying-question";
  question: string;
  options: ClarifyingQuestionOption[];
  allowCustom: boolean;
};

const optionSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().max(140).optional(),
});

export const askUserQuestion = tool({
  description:
    "Present 2 to 4 concise clickable choices when a user request genuinely requires an explicit decision before proceeding.",
  inputSchema: z.object({
    question: z.string().trim().min(3).max(240),
    options: z.array(optionSchema).min(2).max(4),
    allowCustom: z.boolean().default(true),
  }),
  execute: ({ question, options, allowCustom }): ClarifyingQuestionResult => ({
    kind: "clarifying-question",
    question,
    options,
    allowCustom,
  }),
  toModelOutput: ({ output }) => ({
    type: "json" as const,
    value: {
      asked: output.question,
      optionCount: output.options.length,
    },
  }),
});
