
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
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: compactJson(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`AI request failed: ${res.status} ${text}`);
  return text;
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

export function extractJson<T>(res: string): T | null {
  try {
    const json = JSON.parse(res);
    const outputs = Array.isArray((json as any).output) ? (json as any).output : [];
    const msg = outputs.find((o: any) => o.type === 'message' || o.id?.startsWith('msg_'));
    const text = msg?.content?.[0]?.text;
    if (typeof text !== 'string') return null;
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}
