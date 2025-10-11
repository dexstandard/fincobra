import { useState, useEffect } from 'react';
import {
  AlertCircle,
  Eye,
  ChevronDown,
  ChevronRight,
  FileText,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import api from '../lib/axios';
import type { LimitOrder } from '../lib/types';
import Modal from './ui/Modal';
import TextInput from './forms/TextInput';
import ExecSuccessItem from './ExecSuccessItem';
import ExecTxCard from './ExecTxCard';
import Button from './ui/Button';
import { useTranslation } from '../lib/i18n';
import PromptVisualizer from './PromptVisualizer';
import type { PromptData } from './PromptVisualizer.types';
import type { TradingMode } from '../lib/exchange.types';

const MAX_LEN = 255;
function truncate(text: string) {
  return text.length > MAX_LEN ? text.slice(0, MAX_LEN) + '…' : text;
}

function isErrorWithMessage(
  err: Record<string, unknown>,
): err is { message: string } {
  return typeof (err as { message?: unknown }).message === 'string';
}

export interface ExecLog {
  id: string;
  log: string;
  response?: {
    rebalance: boolean;
    shortReport: string;
    orders?: {
      pair: string;
      token: string;
      side: string;
      qty: number;
      limitPrice: number;
      basePrice: number;
      maxPriceDriftPct: number;
    }[];
    strategyName?: string;
    strategyRationale?: string;
  };
  error?: Record<string, unknown>;
  createdAt: number;
}

interface Props {
  log: ExecLog;
  workflowId: string;
  manualRebalance: boolean;
  tokens: string[];
  developerInstructions?: string;
  readOnly?: boolean;
  mode?: TradingMode;
}

export default function ExecLogItem({
  log,
  workflowId,
  manualRebalance,
  tokens,
  developerInstructions,
  readOnly = false,
  mode = 'spot',
}: Props) {
  const [showJson, setShowJson] = useState(false);
  const [showTx, setShowTx] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const [promptData, setPromptData] = useState<PromptData | null>(null);
  const [promptRaw, setPromptRaw] = useState<string | null>(null);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [promptLoaded, setPromptLoaded] = useState(false);
  const [promptLoading, setPromptLoading] = useState(false);
  const { log: text, error, response } = log;
  const hasError = error && Object.keys(error).length > 0;
  const hasResponse = response && Object.keys(response).length > 0;
  const t = useTranslation();
  const isFuturesMode = mode === 'futures';
  const { data: orders, refetch: refetchOrders } = useQuery({
    queryKey: ['exec-orders', workflowId, log.id],
    queryFn: async () => {
      const res = await api.get(
        `/portfolio-workflows/${workflowId}/exec-log/${log.id}/orders`,
      );
      return res.data.orders as LimitOrder[];
    },
    enabled:
      !isFuturesMode && (showTx || (!!response?.rebalance && manualRebalance)),
  });
  const hasOrders = !!orders && orders.length > 0;
  const txEnabled =
    !isFuturesMode &&
    !!response?.rebalance &&
    (!manualRebalance || hasOrders || readOnly);
  const [creating, setCreating] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [order, setOrder] = useState<{
    qty: number;
    price: number;
    side: string;
  } | null>(null);
  const [qtyInput, setQtyInput] = useState('');
  const [price, setPrice] = useState('');
  const [manuallyEdited, setManuallyEdited] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleShowPrompt() {
    if (!showPrompt && !promptLoaded) {
      setPromptLoading(true);
      setPromptError(null);
      try {
        const res = await api.get(
          `/portfolio-workflows/${workflowId}/exec-log/${log.id}/prompt`,
        );
        const payload = res.data.prompt;
        let raw =
          typeof payload === 'string'
            ? payload
            : JSON.stringify(payload, null, 2);
        let parsed: PromptData | null = null;
        if (typeof payload === 'string') {
          try {
            const maybe = JSON.parse(payload);
            if (maybe && typeof maybe === 'object') {
              parsed = maybe as PromptData;
              raw = JSON.stringify(maybe, null, 2);
            }
          } catch {
            parsed = null;
          }
        } else if (payload && typeof payload === 'object') {
          parsed = payload as PromptData;
        }
        const normalized = parsed ? { ...parsed } : null;
        if (normalized) {
          const instr =
            typeof normalized.instructions === 'string' && normalized.instructions.trim()
              ? normalized.instructions
              : developerInstructions;
          if (instr) {
            normalized.instructions = instr;
          }
        }
        setPromptRaw(raw);
        setPromptData(normalized);
        setPromptError(null);
        setPromptLoaded(true);
      } catch {
        const message = t('failed_load_prompt');
        setPromptRaw(null);
        setPromptData(null);
        setPromptError(message);
        setPromptLoaded(false);
      } finally {
        setPromptLoading(false);
      }
    }
    setShowPrompt(true);
  }

  useEffect(() => {
    if (showPreview && order) {
      setQtyInput(order.qty.toString());
      setPrice(order.price.toString());
    }
  }, [showPreview, order]);

  useEffect(() => {
    if (!developerInstructions) return;
    setPromptData((prev) => {
      if (!prev) return prev;
      if (typeof prev.instructions === 'string' && prev.instructions.trim()) {
        return prev;
      }
      return { ...prev, instructions: developerInstructions };
    });
  }, [developerInstructions]);

  async function handleRebalance() {
    setCreating(true);
    try {
      const res = await api.get(
        `/portfolio-workflows/${workflowId}/exec-log/${log.id}/rebalance/preview`,
      );
      const ord = res.data.order as {
        qty: number;
        price: number;
        side: string;
      };
      setOrder(ord);
      setManuallyEdited(false);
      setShowPreview(true);
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setErrorMsg(err.response.data.error);
      } else {
        setErrorMsg('Failed to fetch order preview');
      }
    } finally {
      setCreating(false);
    }
  }

  async function confirmRebalance() {
    setCreating(true);
    try {
      await api.post(
        `/portfolio-workflows/${workflowId}/exec-log/${log.id}/rebalance`,
        {
          qty: Number(qtyInput),
          price: Number(price),
          ...(manuallyEdited ? { manuallyEdited: true } : {}),
        },
      );
      setShowPreview(false);
      await refetchOrders();
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setErrorMsg(err.response.data.error);
      } else {
        setErrorMsg('failed to create order');
      }
    } finally {
      setCreating(false);
    }
  }
  return (
    <div className="w-full">
      <div className="flex items-start">
        <div className="flex-1 min-w-0">
          {!hasError && !hasResponse && text && (
            <div className="whitespace-pre-wrap break-words">
              {truncate(text)}
            </div>
          )}
          {hasError && (
            <div className="mt-1 flex items-center gap-2 rounded border border-red-300 bg-red-50 p-2 text-red-800">
              <AlertCircle className="h-4 w-4" />
              <div className="flex-1 min-w-0 break-words">
                <span className="font-bold mr-1">ERROR</span>
                <span>
                  {truncate(
                    isErrorWithMessage(error as Record<string, unknown>)
                      ? (error as { message: string }).message
                      : JSON.stringify(error),
                  )}
                </span>
              </div>
              <FileText
                className="h-4 w-4 cursor-pointer flex-shrink-0"
                onClick={handleShowPrompt}
              />
              <Eye
                className="h-4 w-4 cursor-pointer"
                onClick={() => setShowJson(true)}
              />
              <Modal open={showJson} onClose={() => setShowJson(false)}>
                <pre className="whitespace-pre-wrap text-sm">
                  {JSON.stringify(error, null, 2)}
                </pre>
              </Modal>
            </div>
          )}
          {hasResponse && (
            <ExecSuccessItem
              response={response}
              rawLog={log.log}
              promptIcon={
                <FileText
                  className="h-4 w-4 cursor-pointer flex-shrink-0"
                  onClick={handleShowPrompt}
                />
              }
            />
          )}
        </div>
        {!hasError && !hasResponse && (
          <FileText
            className="ml-2 h-4 w-4 cursor-pointer flex-shrink-0"
            onClick={handleShowPrompt}
          />
        )}
        {manualRebalance &&
          !!response?.rebalance &&
          !hasOrders &&
          !readOnly && (
          <Button
            variant="secondary"
            className="ml-2 self-center"
            onClick={handleRebalance}
            loading={creating}
          >
            {t('run_rebalance')}
          </Button>
        )}
        {txEnabled && (
          <div
            className="ml-2 flex cursor-pointer items-center gap-1 text-xs text-blue-600"
            onClick={() => setShowTx((s) => !s)}
          >
            <span className="rounded border border-blue-600 px-1">Tx</span>
            {showTx ? (
              <ChevronDown className="h-3 w-3" />
            ) : (
              <ChevronRight className="h-3 w-3" />
            )}
          </div>
        )}
      </div>
      <Modal
        open={showPrompt}
        onClose={() => setShowPrompt(false)}
        className="max-w-5xl w-full max-h-[90vh]"
      >
        <div className="max-h-[78vh] overflow-y-auto pr-2">
          {promptLoading && (
            <p className="text-sm text-gray-600">{t('loading')}</p>
          )}
          {!promptLoading && promptData && (
            <PromptVisualizer data={promptData} raw={promptRaw} />
          )}
          {!promptLoading && !promptData && promptRaw && (
            <pre className="whitespace-pre-wrap text-sm">{promptRaw}</pre>
          )}
          {!promptLoading && promptError && !promptRaw && !promptData && (
            <p className="text-sm text-red-600">{promptError}</p>
          )}
        </div>
      </Modal>
      {showTx && orders && (
        <ExecTxCard
          workflowId={workflowId}
          logId={log.id}
          orders={orders}
          onCancel={refetchOrders}
          readOnly={readOnly}
        />
      )}
      {showPreview && order && (
        <Modal open={showPreview} onClose={() => setShowPreview(false)}>
          <h3 className="mb-2 text-lg font-bold">{t('confirm_rebalance')}</h3>
          <div className="mb-2 text-sm">
            {t('side')}: {order.side}
          </div>
          <div className="mb-2">
            <label className="mb-1 block text-sm">
              {t('quantity')} ({tokens[0]})
            </label>
            <TextInput
              type="number"
              value={qtyInput}
              onChange={(e) => {
                setQtyInput(e.target.value);
                setManuallyEdited(true);
              }}
            />
          </div>
          <div className="mb-4">
            <label className="mb-1 block text-sm">
              {t('price')} ({tokens[1]})
            </label>
            <TextInput
              type="number"
              value={price}
              onChange={(e) => {
                setPrice(e.target.value);
                setManuallyEdited(true);
              }}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setShowPreview(false)}>
              {t('cancel')}
            </Button>
            <Button onClick={confirmRebalance} loading={creating}>
              {t('confirm')}
            </Button>
          </div>
        </Modal>
      )}
      {errorMsg && (
        <Modal open onClose={() => setErrorMsg(null)}>
          <p className="mb-4">{errorMsg}</p>
          <div className="flex justify-end">
            <Button onClick={() => setErrorMsg(null)}>{t('close')}</Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
