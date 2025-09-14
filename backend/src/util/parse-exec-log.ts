import { TOKEN_SYMBOLS } from './tokens.js';

export interface ParsedExecLog {
  text: string;
  response?: {
    orders: any[];
    shortReport: string;
  };
  error?: Record<string, unknown>;
}

export function parseExecLog(log: unknown): ParsedExecLog {
  let text =
      typeof log === 'string'
          ? log
          : log !== undefined
              ? JSON.stringify(log)
              : '';

  let response: ParsedExecLog['response'];
  let error: Record<string, unknown> | undefined;

  let parsed: any;
  try {
    parsed = typeof log === 'string' ? JSON.parse(log) : log;
  } catch {
    return { text, response, error };
  }

  if (parsed && typeof parsed === 'object') {
    if ('prompt' in parsed) {
      if ('response' in parsed)
        return parseExecLog((parsed as any).response);
      if ('error' in parsed)
        return {
          text: '',
          response: undefined,
          error: { message: String((parsed as any).error) },
        };
    }
    // *** FIX: only treat as error if value is truthy, not when it's null ***
    if ('error' in parsed && parsed.error) {
      error = parsed.error as Record<string, unknown>;
      const { error: _err, ...rest } = parsed as any;
      text = Object.keys(rest).length > 0 ? JSON.stringify(rest) : '';
      return { text, response, error };
    }

    if ((parsed as any).object === 'response') {
      const outputs = Array.isArray((parsed as any).output)
          ? (parsed as any).output
          : [];

      const msg = outputs.find(
          (o: any) =>
              typeof o?.id === 'string' &&
              (o.id.startsWith('msg_') || o.type === 'message')
      );

      const textField = Array.isArray(msg?.content)
          ? msg.content[0]?.text
          : undefined;

      if (typeof textField === 'string') {
        text = textField;

        try {
          const sanitized = textField.replace(/\r/g, '\\r').replace(/\n/g, '\\n');
          const out = JSON.parse(sanitized);

          if (out && typeof out === 'object' && 'result' in out) {
            const result = (out as any).result;

            if (result && typeof result === 'object') {
              if ('error' in result && result.error) {
                error = {
                  message:
                      typeof result.error === 'string'
                          ? result.error
                          : JSON.stringify(result.error),
                };
              } else if ('orders' in result) {
                const r = result as { orders: any[]; shortReport?: string };
                response = {
                  orders: Array.isArray(r.orders) ? r.orders : [],
                  shortReport: typeof r.shortReport === 'string' ? r.shortReport : '',
                };
              }
            }
          }
        } catch {
          // ignore parsing errors for fallback
        }
      } else {
        text = JSON.stringify(parsed);
      }
    }
  }

  return { text, response, error };
}

export function validateExecResponse(
  response: ParsedExecLog['response'] | undefined,
  allowedTokens: string[],
): string | undefined {
  if (!response) return undefined;
  for (const o of response.orders || []) {
    if (
      typeof o.pair !== 'string' ||
      typeof o.token !== 'string' ||
      typeof o.side !== 'string'
    )
      return 'invalid order';
    let base = '';
    let quote = '';
    for (const sym of TOKEN_SYMBOLS) {
      if (o.pair.startsWith(sym)) {
        const rest = o.pair.slice(sym.length);
        if (TOKEN_SYMBOLS.includes(rest)) {
          base = sym;
          quote = rest;
          break;
        }
      }
    }
    if (!base || !quote) return 'invalid pair';
    if (!allowedTokens.includes(base) || !allowedTokens.includes(quote))
      return 'invalid pair';
    if (o.token !== base && o.token !== quote) return 'invalid token';
    if (typeof o.quantity !== 'number' || o.quantity <= 0)
      return 'invalid quantity';
  }
  return undefined;
}
