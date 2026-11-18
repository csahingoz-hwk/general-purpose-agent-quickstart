import { OpenTelemetry } from "@ai-sdk/otel";
import { registerOTel } from "@vercel/otel";
import { registerTelemetry } from "ai";

export async function register() {
  registerOTel({ serviceName: "chatbot" });
  registerTelemetry(
    new OpenTelemetry({
      headers: false,
      providerMetadata: false,
      runtimeContext: false,
    })
  );

  if (
    process.env.NEXT_RUNTIME === "nodejs" &&
    process.env.PLAYWRIGHT !== "True"
  ) {
    const { runStartupGoogleWorkspaceHealthCheck } = await import(
      "@/lib/connectors/google-health"
    );
    runStartupGoogleWorkspaceHealthCheck().catch(() => {
      /* non-blocking startup health probe */
    });
  }
}
