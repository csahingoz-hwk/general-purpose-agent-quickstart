import { createGateway } from "ai";

/**
 * Web search through AI Gateway DeepSeek Search. This is a PROVIDER-EXECUTED tool:
 * AI Gateway runs the search and lets the model keep writing inside the same
 * model call, so there is no local execute function and no extra SDK step.
 *
 * Only the Gateway lane may register it (see webSearchLane in routing/catalog);
 * the same gateway provider factory as lib/ai/routing/model.ts resolves
 * authentication (OIDC header on Vercel or AI_GATEWAY_API_KEY) for the call.
 *
 * Config values override whatever the model passes as arguments. Result content
 * is not requested (snippets and summaries are enough and keep context small).
 */
export const WEB_SEARCH_CONFIG = { count: 5, needContent: false } as const;

export const webSearch = (provider = createGateway()) =>
  provider.tools.deepseekSearch({ ...WEB_SEARCH_CONFIG });
