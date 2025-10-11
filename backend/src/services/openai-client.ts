import OpenAI, { APIError } from 'openai';
import type {
  AIResponse,
  AIResponseContent,
  AIResponseOutput,
} from './openai-client.types.js';

const RETRYABLE_STATUS = 502;
const RETRY_DELAY_MS = 2_000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function createClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey });
}

type ResponseCreateParams = Parameters<
  InstanceType<typeof OpenAI>['responses']['create']
>[0];

function isApiError(error: unknown): error is APIError {
  return error instanceof APIError;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function formatErrorDetail(error: unknown): string {
  if (isApiError(error)) {
    if (typeof error.error === 'string') return error.error;
    if (error.error) return compactJson(error.error);
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

function extractStatus(error: unknown): number | undefined {
  return isApiError(error) ? error.status : undefined;
}

export async function callAi(
  model: string,
  developerInstructions: string,
  schema: Record<string, unknown>,
  input: unknown,
  apiKey: string,
  webSearch = false,
): Promise<string> {
  const tools = webSearch
    ? ([{ type: 'web_search' }] as ResponseCreateParams['tools'])
    : undefined;
  const body: ResponseCreateParams = {
    model,
    input: compactJson(input),
    instructions: developerInstructions,
    text: {
      format: {
        type: 'json_schema',
        name: 'rebalance_response',
        strict: true,
        schema,
      },
    },
    ...(tools ? { tools } : {}),
  };
  let attempt = 0;
  const client = createClient(apiKey);
  while (true) {
    try {
      const response = await client.responses.create(body);
      return compactJson(response);
    } catch (error) {
      const status = extractStatus(error);
      if (status === RETRYABLE_STATUS && attempt === 0) {
        attempt += 1;
        await delay(RETRY_DELAY_MS);
        continue;
      }
      const detail = formatErrorDetail(error);
      throw new Error(`AI request failed: ${status ?? 'unknown'} ${detail}`);
    }
  }
}

export function compactJson(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return value.trim();
    }
  }
  return JSON.stringify(value);
}

function isAIResponse(value: unknown): value is AIResponse {
  if (!isRecord(value)) return false;
  const output = value.output;
  if (!Array.isArray(output)) return false;
  return output.every((item): item is AIResponseOutput => {
    if (!isRecord(item)) return false;
    const { id, type, role, content } = item;
    if (id !== undefined && typeof id !== 'string') return false;
    if (type !== undefined && typeof type !== 'string') return false;
    if (role !== undefined && typeof role !== 'string') return false;
    if (content === undefined) return true;
    if (!Array.isArray(content)) return false;
    return content.every((entry): entry is AIResponseContent => {
      if (!isRecord(entry)) return false;
      const { type: contentType, text } = entry;
      if (typeof contentType !== 'string') return false;
      if (text !== undefined && typeof text !== 'string') return false;
      return true;
    });
  });
}

export function extractJson<T>(res: string): T | null {
  try {
    const json = JSON.parse(res);
    if (!isAIResponse(json)) {
      console.error('Invalid OpenAI response payload', json);
      return null;
    }
    const msg = json.output.find(
      (item) => item.type === 'message' || item.id?.startsWith('msg_'),
    );
    if (!msg) {
      console.error('OpenAI response missing assistant message', json);
      return null;
    }
    const text = msg.content?.find(
      (entry) => typeof entry.text === 'string',
    )?.text;
    if (typeof text !== 'string') {
      console.error('OpenAI response missing assistant text content', json);
      return null;
    }
    return JSON.parse(text) as T;
  } catch (error) {
    console.error('Failed to parse OpenAI response JSON', { error, res });
    return null;
  }
}

function filterSupportedModels(models: { id: string }[]): string[] {
  return models
    .map((m) => m.id)
    .filter(
      (id) =>
        id.startsWith('gpt-5') || id.startsWith('o3') || id.includes('search'),
    );
}

export async function verifyAiKey(key: string): Promise<boolean> {
  try {
    const client = createClient(key);
    await client.models.list();
    return true;
  } catch {
    return false;
  }
}

export async function fetchSupportedModels(
  apiKey: string,
): Promise<string[] | null> {
  try {
    const client = createClient(apiKey);
    const modelsPage = await client.models.list();
    return filterSupportedModels(modelsPage.data ?? []);
  } catch {
    return null;
  }
}
