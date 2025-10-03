import type { ExecOrder, ParsedExecLog } from './parse-exec-log.types.js';
import { TOKEN_SYMBOLS } from './tokens.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExecOrder(value: unknown): value is ExecOrder {
  if (!isRecord(value)) return false;
  if (
    typeof value.pair !== 'string' ||
    typeof value.token !== 'string' ||
    typeof value.side !== 'string' ||
    typeof value.qty !== 'number'
  )
    return false;
  if ('limitPrice' in value && typeof value.limitPrice !== 'number')
    return false;
  if ('basePrice' in value && typeof value.basePrice !== 'number') return false;
  if (
    'maxPriceDriftPct' in value &&
    typeof value.maxPriceDriftPct !== 'number'
  )
    return false;
  return true;
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

  let parsed: unknown;
  try {
    parsed = typeof log === 'string' ? JSON.parse(log) : log;
  } catch {
    return { text, response, error };
  }

  if (isRecord(parsed)) {
    if ('prompt' in parsed) {
      if ('response' in parsed) return parseExecLog(parsed.response);
      if ('error' in parsed)
        return {
          text: '',
          response: undefined,
          error: { message: String(parsed.error) },
        };
    }
    // *** FIX: only treat as error if value is truthy, not when it's null ***
    if ('error' in parsed && parsed.error) {
      const parsedError = parsed.error;
      error = isRecord(parsedError)
        ? parsedError
        : { message: String(parsedError) };
      const { error: _err, ...rest } = parsed;
      text = Object.keys(rest).length > 0 ? JSON.stringify(rest) : '';
      return { text, response, error };
    }

    if (parsed.object === 'response') {
      const outputs = Array.isArray(parsed.output) ? parsed.output : [];

      const msg = outputs.find((o): o is Record<string, unknown> => {
        if (!isRecord(o)) return false;
        const id = o.id;
        const type = o.type;
        return (
          (typeof id === 'string' && id.startsWith('msg_')) ||
          type === 'message'
        );
      });

      let textField: string | undefined;
      if (msg && Array.isArray(msg.content)) {
        const first = msg.content[0];
        if (isRecord(first) && typeof first.text === 'string') {
          textField = first.text;
        }
      }

      if (typeof textField === 'string') {
        text = textField;

        try {
          const sanitized = textField
            .replace(/\r/g, '\\r')
            .replace(/\n/g, '\\n');
          const out = JSON.parse(sanitized);

          if (isRecord(out) && 'result' in out) {
            const result = out.result;

            if (isRecord(result)) {
              if ('error' in result && result.error) {
                const resultError = result.error;
                const message =
                  typeof resultError === 'string'
                    ? resultError
                    : JSON.stringify(resultError);
                error = { message };
              } else if ('orders' in result) {
                const ordersValue = result.orders;
                const orders = Array.isArray(ordersValue)
                  ? ordersValue.filter(isExecOrder)
                  : [];
                response = {
                  orders,
                  shortReport:
                    typeof result.shortReport === 'string'
                      ? result.shortReport
                      : '',
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
    if (typeof o.qty !== 'number' || o.qty <= 0)
      return 'invalid qty';
  }
  return undefined;
}
