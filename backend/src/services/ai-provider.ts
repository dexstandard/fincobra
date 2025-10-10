import type { AiApiProvider } from '../repos/ai-api-key.types.js';
import {
  callAi as callOpenAi,
  verifyAiKey as verifyOpenAiKey,
  fetchSupportedModels as fetchOpenAiModels,
  extractJson,
  compactJson,
} from './openai-client.js';
import {
  callGroq,
  verifyGroqKey,
  fetchGroqModels,
} from './groq-client.js';

export interface AiVerificationResult {
  ok: boolean;
  reason?: string;
}

export { extractJson, compactJson };

export async function callAi(
  provider: AiApiProvider,
  model: string,
  developerInstructions: string,
  schema: unknown,
  input: unknown,
  apiKey: string,
  webSearch = false,
): Promise<string> {
  if (provider === 'groq') {
    return callGroq(model, developerInstructions, schema, input, apiKey);
  }
  return callOpenAi(model, developerInstructions, schema, input, apiKey, webSearch);
}

export async function verifyAiKey(
  provider: AiApiProvider,
  key: string,
): Promise<AiVerificationResult> {
  if (provider === 'groq') {
    return verifyGroqKey(key);
  }
  const ok = await verifyOpenAiKey(key);
  return { ok };
}

export async function fetchSupportedModels(
  provider: AiApiProvider,
  apiKey: string,
): Promise<string[] | null> {
  if (provider === 'groq') {
    return fetchGroqModels(apiKey);
  }
  return fetchOpenAiModels(apiKey);
}
