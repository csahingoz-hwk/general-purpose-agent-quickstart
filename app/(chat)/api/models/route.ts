import { auth } from "@/app/(auth)/auth";
import { getAllGatewayModels, getCapabilities, isDemo } from "@/lib/ai/models";

export async function GET() {
  if (!(await auth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const headers = {
    "Cache-Control": "private, no-store",
  };

  const curatedCapabilities = await getCapabilities();

  if (isDemo) {
    const models = await getAllGatewayModels();
    const capabilities = Object.fromEntries(
      models.map((m) => [m.id, curatedCapabilities[m.id] ?? m.capabilities])
    );

    return Response.json({ capabilities, models }, { headers });
  }

  return Response.json(curatedCapabilities, { headers });
}
