export function POST() {
  return Response.json(
    { error: "Paid integration demo is disabled" },
    { status: 503 }
  );
}
