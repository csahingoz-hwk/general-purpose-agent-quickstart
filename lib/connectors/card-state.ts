export type ConnectorCardActionOutput = {
  status: "setup_required" | "reconnect_required" | "connector_error" | "error";
  code?: string;
  message?: string;
  connectProvider?: "google" | "github";
};

export function isSetupRequiredOutput(
  output: unknown
): output is ConnectorCardActionOutput {
  if (!output || typeof output !== "object") {
    return false;
  }
  const status = (output as { status?: string }).status;
  return (
    status === "setup_required" ||
    status === "reconnect_required" ||
    status === "connector_error" ||
    status === "error"
  );
}
