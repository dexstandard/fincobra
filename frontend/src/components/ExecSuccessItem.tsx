import { useState, type ReactNode } from 'react';
import { Eye } from 'lucide-react';
import Modal from './ui/Modal';
import { useTranslation } from '../lib/i18n';
import ResponseVisualizer from './ResponseVisualizer';
import type { ResponseData, ResponseOrder } from './ResponseVisualizer.types';

const MAX_LEN = 255;
function truncate(text: string) {
  return text.length > MAX_LEN ? text.slice(0, MAX_LEN) + '…' : text;
}

interface Props {
  response: {
    rebalance: boolean;
    shortReport: string;
    orders?: ResponseOrder[];
  };
  rawLog?: string | null;
  promptIcon?: ReactNode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toOrder(value: unknown): ResponseOrder | null {
  if (!isRecord(value)) return null;
  const order: ResponseOrder = {
    ...(typeof value.pair === 'string' ? { pair: value.pair } : {}),
    ...(typeof value.token === 'string' ? { token: value.token } : {}),
    ...(typeof value.side === 'string' ? { side: value.side } : {}),
    ...(typeof value.qty === 'number' ? { qty: value.qty } : {}),
    ...(typeof value.limitPrice === 'number' ? { limitPrice: value.limitPrice } : {}),
    ...(typeof value.basePrice === 'number' ? { basePrice: value.basePrice } : {}),
    ...(typeof value.maxPriceDriftPct === 'number'
      ? { maxPriceDriftPct: value.maxPriceDriftPct }
      : {}),
  };
  return Object.keys(order).length > 0 ? order : null;
}

function toErrorMessage(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (isRecord(value)) {
    if (typeof (value as { message?: unknown }).message === 'string') {
      return String((value as { message: string }).message);
    }
    if (typeof (value as { error?: unknown }).error === 'string') {
      return String((value as { error: string }).error);
    }
  }
  return null;
}

function toErrorMessages(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => toErrorMessage(item) ?? (typeof item === 'string' ? item : null))
      .filter((msg): msg is string => Boolean(msg));
  }
  if (isRecord(value)) {
    const direct = toErrorMessage(value);
    if (direct) return [direct];
    const entries = Object.entries(value)
      .map(([key, val]) => {
        const message = toErrorMessage(val) ?? (typeof val === 'string' ? val : null);
        return message ? `${key}: ${message}` : null;
      })
      .filter((msg): msg is string => Boolean(msg));
    return entries;
  }
  if (typeof value === 'string') return [value];
  return [];
}

function toResponseData(value: unknown): ResponseData | null {
  if (!value) return null;
  if (isRecord(value) && 'result' in value) {
    const nested = toResponseData(value.result);
    if (nested) return nested;
  }
  if (isRecord(value) && 'response' in value) {
    const nested = toResponseData(value.response);
    if (nested) return nested;
  }
  if (!isRecord(value)) return null;

  const ordersValue = Array.isArray(value.orders)
    ? (value.orders.map(toOrder).filter(Boolean) as ResponseOrder[])
    : [];

  const errorMessage = toErrorMessage(value.error);
  const errorsList = toErrorMessages((value as { errors?: unknown }).errors);

  let shortReport: string | undefined;
  if (typeof value.shortReport === 'string') shortReport = value.shortReport;
  if (typeof (value as { short_report?: unknown }).short_report === 'string') {
    shortReport = String((value as { short_report: string }).short_report);
  }

  let strategyName: string | undefined;
  if (typeof (value as { strategyName?: unknown }).strategyName === 'string') {
    strategyName = String((value as { strategyName: string }).strategyName);
  } else if (
    typeof (value as { strategy_name?: unknown }).strategy_name === 'string'
  ) {
    strategyName = String((value as { strategy_name: string }).strategy_name);
  }

  let strategyRationale: string | undefined;
  if (
    typeof (value as { strategyRationale?: unknown }).strategyRationale === 'string'
  ) {
    strategyRationale = String(
      (value as { strategyRationale: string }).strategyRationale,
    );
  } else if (
    typeof (value as { strategy_rationale?: unknown }).strategy_rationale ===
    'string'
  ) {
    strategyRationale = String(
      (value as { strategy_rationale: string }).strategy_rationale,
    );
  }

  let rebalance: boolean | undefined;
  if (typeof value.rebalance === 'boolean') {
    rebalance = value.rebalance;
  } else if (typeof (value as { decision?: unknown }).decision === 'string') {
    const normalized = String((value as { decision: string }).decision).toLowerCase();
    if (normalized.includes('rebalance')) rebalance = true;
    if (normalized.includes('hold')) rebalance = false;
  }

  if (rebalance === undefined) {
    rebalance = ordersValue.length > 0;
  }

  if (
    rebalance === undefined &&
    shortReport === undefined &&
    ordersValue.length === 0 &&
    !errorMessage &&
    errorsList.length === 0 &&
    !strategyName &&
    !strategyRationale
  ) {
    return null;
  }

  return {
    rebalance: rebalance ?? false,
    ...(shortReport ? { shortReport } : {}),
    ...(strategyName ? { strategyName } : {}),
    ...(strategyRationale ? { strategyRationale } : {}),
    ...(errorMessage ? { error: errorMessage } : {}),
    ...(errorsList.length > 0 ? { errors: errorsList } : {}),
    orders: ordersValue,
  };
}

function parseResponse(
  response: Props['response'],
  rawLog?: string | null,
): { data: ResponseData | null; raw: string | null; failed: boolean } {
  let parsed: ResponseData | null = null;
  let raw: string | null = null;

  if (rawLog && rawLog.trim()) {
    raw = rawLog;
    try {
      const parsedJson = JSON.parse(rawLog);
      parsed = toResponseData(parsedJson);
      raw = JSON.stringify(parsedJson, null, 2);
    } catch {
      // keep raw as original string when parsing fails
    }
  }

  if (!parsed) {
    parsed = toResponseData(response);
  }

  if (!raw) {
    raw = JSON.stringify(response, null, 2);
  }

  return { data: parsed, raw, failed: !parsed };
}

export default function ExecSuccessItem({ response, rawLog, promptIcon }: Props) {
  const [showResponse, setShowResponse] = useState(false);
  const [parsedResponse, setParsedResponse] = useState<ResponseData | null>(null);
  const [responseRaw, setResponseRaw] = useState<string | null>(null);
  const [parseFailed, setParseFailed] = useState(false);
  const { rebalance, shortReport } = response;
  const color = rebalance
    ? 'border-green-300 bg-green-50 text-green-800'
    : 'border-blue-300 bg-blue-50 text-blue-800';
  const t = useTranslation();

  function handleShowResponse() {
    if (!showResponse) {
      const { data, raw, failed } = parseResponse(response, rawLog);
      setParsedResponse(data);
      setResponseRaw(raw);
      setParseFailed(failed);
    }
    setShowResponse(true);
  }

  return (
    <div className={`mt-1 flex items-center gap-2 rounded border p-2 ${color}`}>
      <div className="flex-1 min-w-0 whitespace-pre-wrap break-words">
        <span className="font-bold mr-1">
          {rebalance ? t('rebalance') : t('hold')}
        </span>
        <span>{truncate(shortReport)}</span>
      </div>
      {promptIcon}
      <Eye className="h-4 w-4 cursor-pointer" onClick={handleShowResponse} />
      <Modal open={showResponse} onClose={() => setShowResponse(false)}>
        {parseFailed && !parsedResponse && responseRaw ? (
          <pre className="whitespace-pre-wrap break-words text-sm">{responseRaw}</pre>
        ) : parsedResponse ? (
          <ResponseVisualizer data={parsedResponse} />
        ) : (
          <p className="text-sm text-gray-600">{t('loading')}</p>
        )}
      </Modal>
    </div>
  );
}
