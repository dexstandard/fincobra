import type { AiApiProvider } from '../repos/ai-api-key.types.js';
import {
  callAi as callOpenAi,
  extractJson as extractOpenAiJson,
  fetchSupportedModels as fetchOpenAiModels,
} from './openai-client.js';
import {
  callGroqAi,
  fetchSupportedModels as fetchGroqModels,
} from './groq-client.js';

interface AiClient {
  call: (
    model: string,
    developerInstructions: string,
    schema: unknown,
    input: unknown,
    apiKey: string,
    webSearch?: boolean,
  ) => Promise<string>;
  extract: <T>(response: string) => T | null;
  fetchModels: (apiKey: string) => Promise<string[] | null>;
}

const aiClients: Record<AiApiProvider, AiClient> = {
  openai: {
    call: callOpenAi,
    extract: <T>(response: string) => extractOpenAiJson<T>(response),
    fetchModels: fetchOpenAiModels,
  },
  groq: {
    call: callGroqAi,
    extract: <T>(response: string) => extractOpenAiJson<T>(response),
    fetchModels: fetchGroqModels,
  },
};

export async function callAi(
  provider: AiApiProvider,
  model: string,
  developerInstructions: string,
  schema: unknown,
  input: unknown,
  apiKey: string,
  webSearch = false,
): Promise<string> {
  return aiClients[provider].call(
    model,
    developerInstructions,
    schema,
    input,
    apiKey,
    webSearch,
  );
}

export function extractJson<T>(
  provider: AiApiProvider,
  response: string,
): T | null {
  return aiClients[provider].extract<T>(response);
}

export async function fetchSupportedModels(
  provider: AiApiProvider,
  apiKey: string,
): Promise<string[] | null> {
  return aiClients[provider].fetchModels(apiKey);
}
