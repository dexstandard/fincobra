import { compactJson } from './openai-client.js';

const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
const GROQ_RESPONSES_URL = 'https://api.groq.com/openai/v1/responses';

interface GroqModel {
  id: string;
}

interface VerificationResult {
  ok: boolean;
  reason?: string;
}

function isSupportedGroqModel(id: string): boolean {
  return (
    id.includes('openai/gpt-oss') || id.includes('meta-llama/llama-4')
  );
}

function normalizeReason(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function verifyGroqKey(key: string): Promise<VerificationResult> {
  try {
    const res = await fetch(GROQ_MODELS_URL, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.ok) return { ok: true };
    const text = await res.text();
    let reason: string | undefined;
    try {
      const body = JSON.parse(text) as { error?: { message?: string } };
      reason = body.error?.message ?? text;
    } catch {
      reason = text;
    }
    return { ok: false, reason: normalizeReason(reason) };
  } catch {
    return { ok: false };
  }
}

export async function callGroqAi(
  model: string,
  developerInstructions: string,
  schema: Record<string, unknown>,
  input: unknown,
  apiKey: string,
  _webSearch = false,
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
  const res = await fetch(GROQ_RESPONSES_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: compactJson(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`AI request failed: ${res.status} ${text}`);
  }
  return text;
}

export async function fetchSupportedModels(
  apiKey: string,
): Promise<string[] | null> {
  try {
    const res = await fetch(GROQ_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: GroqModel[] };
    return (body.data ?? [])
      .map((m) => m.id)
      .filter((id) => isSupportedGroqModel(id))
      .sort();
  } catch {
    return null;
  }
}
