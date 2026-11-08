// Re-enable only after a separate review of owner binding and allowed tools.
export function POST() {
  return Response.json(
    { error: "Telegram execution is disabled pending security review" },
    { status: 503 }
  );
}
