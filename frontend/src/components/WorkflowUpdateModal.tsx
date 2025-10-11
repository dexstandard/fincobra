import { useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import axios from 'axios';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import api from '../lib/axios';
import {
  portfolioReviewSchema,
  type PortfolioReviewFormValues,
} from '../lib/constants';
import { usePrerequisites } from '../lib/usePrerequisites';
import { useToast } from '../lib/useToast';
import { useTranslation } from '../lib/i18n';
import type { TradingMode } from '../lib/exchange.types';
import type { PortfolioWorkflow } from '../lib/useWorkflowData';

import AgentInstructions from './AgentInstructions';
import ApiKeyProviderSelector from './forms/ApiKeyProviderSelector';
import type { AiProvider } from './forms/ApiKeyProviderSelector.types';
import SelectInput from './forms/SelectInput';
import PortfolioWorkflowFields from './forms/PortfolioWorkflowFields';
import WalletBalances from './WalletBalances';
import Button from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';
import Modal from './ui/Modal';

interface Props {
  workflow: PortfolioWorkflow;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

export default function WorkflowUpdateModal({
  workflow,
  open,
  onClose,
  onUpdated,
}: Props) {
  const toast = useToast();
  const t = useTranslation();
  const methods = useForm<PortfolioReviewFormValues>({
    resolver: zodResolver(portfolioReviewSchema),
    defaultValues: {
      tokens: [
        { token: workflow.cashToken, minAllocation: 0 },
        ...workflow.tokens.map((t) => ({
          token: t.token,
          minAllocation: t.minAllocation,
        })),
      ],
      risk: workflow.risk,
      reviewInterval: workflow.reviewInterval,
    },
  });
  const { reset, handleSubmit } = methods;
  const [instructions, setInstructions] = useState(workflow.agentInstructions);
  const [useEarn, setUseEarn] = useState(workflow.useEarn);
  const [tokenSymbols, setTokenSymbols] = useState<string[]>([
    workflow.cashToken,
    ...workflow.tokens.map((t) => t.token),
  ]);

  const [model, setModel] = useState(workflow.model || '');
  const [aiProvider, setAiProvider] = useState<AiProvider>(
    workflow.aiProvider ?? 'openai',
  );
  const [tradingMode, setTradingMode] = useState<TradingMode>('spot');
  const [selectedExchange, setSelectedExchange] = useState<'binance' | 'bybit'>(
    'binance',
  );
  const desiredExchange = selectedExchange;
  const {
    hasOpenAIKey,
    hasGroqKey,
    hasBinanceKey,
    hasBybitKey,
    binanceKeyId,
    bybitKeyId,
    models,
    balances,
    accountBalances,
    isAccountLoading,
    activeExchange,
  } = usePrerequisites(tokenSymbols, {
    exchange: desiredExchange,
    mode: tradingMode,
    aiProvider,
  });
  const selectedExchangeKeyId = useMemo(() => {
    if (desiredExchange === 'binance') return binanceKeyId;
    if (desiredExchange === 'bybit') return bybitKeyId;
    return null;
  }, [desiredExchange, binanceKeyId, bybitKeyId]);

  useEffect(() => {
    if (open) {
      reset({
        tokens: [
          { token: workflow.cashToken, minAllocation: 0 },
          ...workflow.tokens.map((t) => ({
            token: t.token,
            minAllocation: t.minAllocation,
          })),
        ],
        risk: workflow.risk,
        reviewInterval: workflow.reviewInterval,
      });
      setInstructions(workflow.agentInstructions);
      setUseEarn(workflow.useEarn);
      setModel(workflow.model || '');
      setAiProvider(workflow.aiProvider ?? 'openai');
      setTokenSymbols([
        workflow.cashToken,
        ...workflow.tokens.map((t) => t.token),
      ]);
    }
  }, [open, workflow, reset, bybitKeyId, binanceKeyId]);

  useEffect(() => {
    const hasAiKey = aiProvider === 'groq' ? hasGroqKey : hasOpenAIKey;
    if (!hasAiKey) {
      setModel('');
    } else if (!model) {
      setModel(workflow.model || models[0] || '');
    }
  }, [aiProvider, hasGroqKey, hasOpenAIKey, models, workflow.model, model]);

  useEffect(() => {
    if (!open) return;
    if (workflow.exchangeApiKeyId === bybitKeyId) {
      setTradingMode('futures');
      setSelectedExchange('bybit');
    } else if (workflow.exchangeApiKeyId === binanceKeyId) {
      setSelectedExchange('binance');
    }
  }, [open, workflow.exchangeApiKeyId, binanceKeyId, bybitKeyId]);

  useEffect(() => {
    if (tradingMode === 'spot' && !hasBinanceKey && hasBybitKey) {
      setTradingMode('futures');
      setSelectedExchange('bybit');
    }
  }, [tradingMode, hasBinanceKey, hasBybitKey]);

  useEffect(() => {
    if (tradingMode === 'spot') {
      setSelectedExchange('binance');
      return;
    }
    setSelectedExchange((prev) => {
      if (prev === 'bybit' && hasBybitKey) return 'bybit';
      if (prev === 'binance' && hasBinanceKey) return 'binance';
      if (hasBybitKey) return 'bybit';
      if (hasBinanceKey) return 'binance';
      return prev;
    });
  }, [tradingMode, hasBinanceKey, hasBybitKey]);

  const tradingModeConfigs = useMemo(
    () => [
      {
        id: 'spot' as const,
        label: t('spot_trading'),
        description: t('trading_mode_spot_description'),
        exchangeLabel: 'Binance',
        enabled: hasBinanceKey,
      },
      {
        id: 'futures' as const,
        label: t('futures_trading'),
        description: t('trading_mode_futures_description'),
        exchangeLabel: 'Binance or Bybit',
        enabled: hasBybitKey || hasBinanceKey,
      },
    ],
    [t, hasBinanceKey, hasBybitKey],
  );

  const futuresExchangeOptions = useMemo(
    () => [
      {
        id: 'bybit' as const,
        label: 'Bybit',
        enabled: hasBybitKey,
      },
      {
        id: 'binance' as const,
        label: 'Binance',
        enabled: hasBinanceKey,
      },
    ],
    [hasBinanceKey, hasBybitKey],
  );

  const updateMut = useMutation<void, unknown, PortfolioReviewFormValues>({
    mutationFn: async (values: PortfolioReviewFormValues) => {
      const [cashToken, ...positions] = values.tokens;
      await api.put(`/portfolio-workflows/${workflow.id}`, {
        model,
        aiProvider,
        status: workflow.status,
        cash: cashToken.token.toUpperCase(),
        tokens: positions.map((t) => ({
          token: t.token.toUpperCase(),
          minAllocation: t.minAllocation,
        })),
        risk: values.risk,
        reviewInterval: values.reviewInterval,
        agentInstructions: instructions,
        manualRebalance: workflow.manualRebalance,
        useEarn,
        exchangeKeyId: selectedExchangeKeyId,
      });
    },
    onSuccess: () => {
      onClose();
      onUpdated();
    },
    onError: (err) => {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        toast.show(err.response.data.error);
      } else {
        toast.show(t('failed_update_workflow'));
      }
    },
  });

  const [formValues, setFormValues] =
    useState<PortfolioReviewFormValues | null>(null);

  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="text-xl font-bold mb-2">{t('update_workflow')}</h2>
      <FormProvider {...methods}>
        <div className="max-w-2xl">
          <PortfolioWorkflowFields
            onTokensChange={setTokenSymbols}
            balances={balances}
            accountBalances={accountBalances}
            accountLoading={isAccountLoading}
            useEarn={useEarn}
            onUseEarnChange={setUseEarn}
          />
        </div>
      </FormProvider>
      <AgentInstructions value={instructions} onChange={setInstructions} />
      <div className="mt-4 max-w-2xl">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <ApiKeyProviderSelector
              type="ai"
              label={t('ai_provider')}
              value={aiProvider}
              onChange={setAiProvider}
            />
            {(
              (aiProvider === 'groq' ? hasGroqKey : hasOpenAIKey) &&
              (models.length || workflow.model)
            ) && (
              <div className="mt-2">
                <h2 className="text-md font-bold">{t('model')}</h2>
                <SelectInput
                  id="update-model"
                  value={model}
                  onChange={setModel}
                  options={
                    workflow.model && !models.length
                      ? [{ value: workflow.model, label: workflow.model }]
                      : models.map((m) => ({ value: m, label: m }))
                  }
                />
              </div>
            )}
          </div>
          <div>
            <span className="block text-md font-bold">{t('trading_mode')}</span>
            <div className="mt-2 flex flex-col gap-2">
              <div className="flex flex-wrap gap-2">
                {tradingModeConfigs.map((mode) => {
                  const isActive = tradingMode === mode.id;
                  const disabled = !mode.enabled;
                  const hint = disabled
                    ? t('trading_mode_connect_exchange').replace(
                        '{{exchange}}',
                        mode.exchangeLabel,
                      )
                    : undefined;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      onClick={() => {
                        if (!disabled) setTradingMode(mode.id);
                      }}
                      disabled={disabled}
                      title={hint}
                      className={`px-3 py-1.5 rounded border text-sm transition-colors ${
                        isActive
                          ? 'bg-blue-600 text-white border-transparent'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200'
                      }`}
                    >
                      {mode.label}
                    </button>
                  );
                })}
              </div>
              {tradingMode === 'futures' && (
                <div className="flex flex-wrap gap-2">
                  {futuresExchangeOptions.map((exchange) => {
                    const isActive = selectedExchange === exchange.id;
                    const disabled = !exchange.enabled;
                    const hint = disabled
                      ? t('trading_mode_connect_exchange').replace(
                          '{{exchange}}',
                          exchange.label,
                        )
                      : undefined;
                    return (
                      <button
                        key={exchange.id}
                        type="button"
                        onClick={() => {
                          if (!disabled) {
                            setSelectedExchange(exchange.id);
                          }
                        }}
                        disabled={disabled}
                        title={hint}
                        className={`px-3 py-1.5 rounded border text-sm transition-colors ${
                          isActive
                            ? 'bg-blue-600 text-white border-transparent'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50 disabled:bg-gray-100 disabled:text-gray-400 disabled:border-gray-200'
                        }`}
                      >
                        {exchange.label}
                      </button>
                    );
                  })}
                </div>
              )}
              <p className="text-sm text-gray-600">
                {
                  tradingModeConfigs.find((mode) => mode.id === tradingMode)
                    ?.description ?? ''
                }
              </p>
            </div>
            <div className="mt-4">
              <WalletBalances
                balances={balances}
                exchange={activeExchange}
              />
            </div>
          </div>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button onClick={onClose}>{t('cancel')}</Button>
        <Button
          disabled={updateMut.isPending}
          loading={updateMut.isPending}
          onClick={handleSubmit((values) => {
            setFormValues(values);
            setConfirmOpen(true);
          })}
        >
          {t('confirm')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        message={
          workflow.status === 'active'
            ? t('update_running_workflow_prompt')
            : t('update_workflow_prompt')
        }
        onConfirm={() => {
          if (!formValues) return;
          setConfirmOpen(false);
          updateMut.mutate(formValues);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </Modal>
  );
}
