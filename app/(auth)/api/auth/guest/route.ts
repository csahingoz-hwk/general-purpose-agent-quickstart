export function GET() {
  return Response.json({ error: "Guest access is disabled" }, { status: 403 });
}
