import "server-only";

// External integrations cannot be activated by merely setting an API key.
export function getComposioClient(): null {
  return null;
}
