import { timingSafeEqual } from "node:crypto";

export function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const incoming = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret ?? ""}`);
  if (
    !secret ||
    incoming.length !== expected.length ||
    !timingSafeEqual(incoming, expected)
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  // No flag can enable unattended execution during the security milestone.
  return Response.json(
    {
      enabled: false,
      message: "Schedules are disabled pending security review",
    },
    { status: 503 }
  );
}
