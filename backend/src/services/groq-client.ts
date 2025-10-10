import { compactJson } from './openai-client.js';

const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';
const GROQ_RESPONSES_URL = 'https://api.groq.com/openai/v1/responses';
const RETRYABLE_STATUS = 502;
const RETRY_DELAY_MS = 2_000;

interface VerificationResult {
  ok: boolean;
  reason?: string;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

interface GroqModel {
  id: string;
}

export async function callGroq(
  model: string,
  developerInstructions: string,
  schema: unknown,
  input: unknown,
  apiKey: string,
): Promise<string> {
  const body = {
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
  } as const;
  let attempt = 0;
  while (true) {
    const res = await fetch(GROQ_RESPONSES_URL, {
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

export async function fetchGroqModels(
  apiKey: string,
): Promise<string[] | null> {
  try {
    const res = await fetch(GROQ_MODELS_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { data?: GroqModel[] };
    return (body.data ?? []).map((m) => m.id);
  } catch {
    return null;
  }
}
