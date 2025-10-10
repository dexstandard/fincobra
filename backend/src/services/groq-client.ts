const GROQ_MODELS_URL = 'https://api.groq.com/openai/v1/models';

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
