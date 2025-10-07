import type {
  AIResponse,
  AIResponseContent,
  AIResponseOutput,
} from './openai-client.types.js';

const OPENAI_MODELS_URL = 'https://api.openai.com/v1/models';
const RETRYABLE_STATUS = 502;
const RETRY_DELAY_MS = 2_000;

interface OpenAiModel {
  id: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export async function callAi(
  model: string,
  developerInstructions: string,
  schema: unknown,
  input: unknown,
  apiKey: string,
  webSearch = false,
): Promise<string> {
  const body: Record<string, unknown> = {
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
  };
  if (webSearch) body.tools = [{ type: 'web_search_preview' }];
  let attempt = 0;
  while (true) {
    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: compactJson(body),
    });
    const text = await res.text();
    if (res.ok) return text;
    if (res.status === RETRYABLE_STATUS && attempt === 0) {
      attempt += 1;
      await delay(RETRY_DELAY_MS);
      continue;
    }
    throw new Error(`AI request failed: ${res.status} ${text}`);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
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

function filterSupportedModels(models: OpenAiModel[]): string[] {
  return models
    .map((m) => m.id)
    .filter(
      (id) =>
        id.startsWith('gpt-5') || id.startsWith('o3') || id.includes('search'),
    );
}

export async function verifyAiKey(key: string): Promise<boolean> {
  try {
    const res = await fetch(OPENAI_MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchSupportedModels(
  apiKey: string,
): Promise<string[] | null> {
  try {
    const res = await fetch(OPENAI_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: OpenAiModel[] };
    return filterSupportedModels(body.data ?? []);
  } catch {
    return null;
  }
}
