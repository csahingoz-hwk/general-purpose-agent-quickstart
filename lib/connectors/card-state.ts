export type ConnectorCardActionOutput = {
  status: "setup_required" | "reconnect_required" | "connector_error" | "error";
  code?: string;
  message?: string;
  connectProvider?: "google" | "github";
  accountConnected?: boolean;
  projectNumber?: string | null;
  enableApiUrl?: string | null;
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

/**
 * Extracts ONLY the numeric GCP project number prefix from an OAuth Client ID
 * (`<projectNumber>-<opaque>.apps.googleusercontent.com`).
 * Never returns or logs the opaque suffix or client secret.
 */
export function extractGoogleClientProjectNumber(
  clientId?: string | null
): string | null {
  if (!clientId) {
    return null;
  }
  const match = clientId
    .trim()
    .match(/^(\d{6,20})-[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/i);
  return match?.[1] ?? null;
}

export function buildGoogleWorkspaceEnableApiUrl(
  projectNumber?: string | null
): string {
  const cleanProject =
    projectNumber && /^\d{6,20}$/.test(projectNumber.trim())
      ? projectNumber.trim()
      : null;
  const base =
    "https://console.cloud.google.com/flows/enableapi?apiid=gmail.googleapis.com,calendar-json.googleapis.com,drive.googleapis.com";
  return cleanProject
    ? `${base}&project=${encodeURIComponent(cleanProject)}`
    : base;
}
