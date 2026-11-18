import { auth } from "@/app/(auth)/auth";
import { handleCloudComputerFileGet } from "@/lib/cloud-computer/file-route-handler";

export function GET(request: Request) {
  return handleCloudComputerFileGet(request, { getSession: () => auth() });
}
