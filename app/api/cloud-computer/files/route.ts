import { handleCloudComputerFileGet } from "@/lib/cloud-computer/file-route-handler";

export function GET(request: Request) {
  return handleCloudComputerFileGet(request);
}
