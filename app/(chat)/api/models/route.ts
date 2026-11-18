import { auth } from "@/app/(auth)/auth";
import { getModelAvailability } from "@/lib/ai/model-runtime";
import { getCapabilities } from "@/lib/ai/models";

export async function GET() {
  if (!(await auth())) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const availability = await getModelAvailability();
  const allCapabilities = await getCapabilities();
  const capabilities = Object.fromEntries(
    availability.models.map((model) => [model.id, allCapabilities[model.id]])
  );
  return Response.json(
    {
      ...availability,
      capabilities,
      notice:
        "Configured models only. Account quotas and the spending allowance still apply.",
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
