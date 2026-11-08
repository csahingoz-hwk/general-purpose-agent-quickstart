import { z } from "zod";

const textPartSchema = z.object({
  type: z.enum(["text"]),
  text: z.string().min(1).max(2000),
});

const filePartSchema = z.object({
  type: z.enum(["file"]),
  mediaType: z.enum(["image/jpeg", "image/png"]),
  name: z.string().min(1).max(100),
  url: z.string().url(),
});

const partSchema = z.union([textPartSchema, filePartSchema]);

const userMessageSchema = z.object({
  id: z.string().uuid(),
  role: z.enum(["user"]),
  parts: z.array(partSchema).min(1),
});

const toolApprovalMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  parts: z.array(z.record(z.string(), z.unknown())),
});

export const postRequestBodySchema = z
  .object({
    id: z.string().uuid(),
    message: userMessageSchema.optional(),
    messages: z.array(toolApprovalMessageSchema).optional(),
    retry: z.boolean().optional(),
    selectedChatModel: z.string(),
    selectedVisibilityType: z.enum(["public", "private"]),
  })
  .refine((body) => Boolean(body.message) !== Boolean(body.messages?.length), {
    message: "Submit a user turn or an approval continuation",
  })
  .refine((body) => !body.retry || Boolean(body.message), {
    message: "Retry requires a user turn",
  });

export type PostRequestBody = z.infer<typeof postRequestBodySchema>;
