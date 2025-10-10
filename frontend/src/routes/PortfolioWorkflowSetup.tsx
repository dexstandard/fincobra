import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from '../lib/i18n';
import AgentInstructions from '../components/AgentInstructions';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import api from '../lib/axios';
import { useUser } from '../lib/useUser';
import ApiKeyProviderSelector from '../components/forms/ApiKeyProviderSelector';
import SelectInput from '../components/forms/SelectInput';
import { useToast } from '../lib/useToast';
import Button from '../components/ui/Button';
import { usePrerequisites } from '../lib/usePrerequisites';
import WorkflowStartButton from '../components/WorkflowStartButton';
import WalletBalances from '../components/WalletBalances';
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  portfolioReviewSchema,
  portfolioReviewDefaults,
  type PortfolioReviewFormValues,
} from '../lib/constants';
import PortfolioWorkflowFields from '../components/forms/PortfolioWorkflowFields';
import type { PortfolioWorkflow } from '../lib/useWorkflowData';
import { useDeveloperInstructions } from '../lib/useDeveloperInstructions';
import type { TradingMode } from '../lib/exchange.types';

interface Props {
  workflow?: PortfolioWorkflow;
}

const DEFAULT_AGENT_INSTRUCTIONS =
  'Day trade this pair and determine the target allocation yourself. Monitor real-time market data and news, trimming positions after rallies and adding to them after dips to stay within policy floors while exploiting intraday swings.';

export default function PortfolioWorkflowSetup({ workflow }: Props) {
  const navigate = useNavigate();
  const { user } = useUser();
  const toast = useToast();
  const t = useTranslation();

  const workflowFormValues = useMemo(() => {
    if (!workflow) return null;
    return {
      tokens: [
        { token: workflow.cashToken, minAllocation: 0 },
        ...workflow.tokens,
      ],
      risk: workflow.risk,
      reviewInterval: workflow.reviewInterval,
    } satisfies PortfolioReviewFormValues;
  }, [workflow]);

  const defaultValues = workflowFormValues ?? portfolioReviewDefaults;

  const [model, setModel] = useState(workflow?.model || '');
  const [aiProvider, setAiProvider] = useState<
    'openai' | 'groq'
  >(workflow?.aiProvider ?? 'openai');
  const [tradingMode, setTradingMode] = useState<TradingMode>('spot');
  const [useEarn, setUseEarn] = useState(workflow?.useEarn ?? false);
  const [tokenSymbols, setTokenSymbols] = useState(
    defaultValues.tokens.map((t) => t.token),
  );

  const methods = useForm<PortfolioReviewFormValues>({
    resolver: zodResolver(portfolioReviewSchema),
    defaultValues,
  });
  const { reset } = methods;
  const desiredExchange: 'binance' | 'bybit' =
    tradingMode === 'futures' ? 'bybit' : 'binance';
  const {
    hasAiKey,
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
    aiProvider,
  });
  const hasExchangeKey = hasBinanceKey || hasBybitKey;
  const selectedExchangeKeyId = useMemo(() => {
    if (desiredExchange === 'binance') return binanceKeyId;
    if (desiredExchange === 'bybit') return bybitKeyId;
    return null;
  }, [desiredExchange, binanceKeyId, bybitKeyId]);

  const [instructions, setInstructions] = useState(
    workflow?.agentInstructions || '',
  );
  const [manualRebalance, setManualRebalance] = useState(
    workflow?.manualRebalance || false,
  );
  const [isSaving, setIsSaving] = useState(false);
  const values = methods.watch();
  const { data: defaultDeveloperInstructions } = useDeveloperInstructions();

  useEffect(() => {
    setModel(workflow?.model || '');
  }, [workflow?.model]);

  useEffect(() => {
    if (!hasAiKey) {
      setModel('');
    } else if (!model) {
      setModel(workflow?.model || models[0] || '');
    }
  }, [hasAiKey, models, workflow?.model, model, aiProvider]);

  useEffect(() => {
    if (workflow?.aiProvider) {
      setAiProvider(workflow.aiProvider);
    }
  }, [workflow?.aiProvider]);

  useEffect(() => {
    if (!workflowFormValues) return;

    reset(workflowFormValues);
    setTokenSymbols(workflowFormValues.tokens.map((t) => t.token));
    setUseEarn(workflow?.useEarn ?? false);
    setInstructions(workflow?.agentInstructions || DEFAULT_AGENT_INSTRUCTIONS);
    setManualRebalance(workflow?.manualRebalance || false);
  }, [
    workflowFormValues,
    workflow?.agentInstructions,
    workflow?.manualRebalance,
    workflow?.useEarn,
    reset,
  ]);

  useEffect(() => {
    if (workflow) {
      setInstructions(workflow.agentInstructions);
    }
  }, [workflow?.agentInstructions, workflow]);

  useEffect(() => {
    if (workflow || !defaultDeveloperInstructions) return;
    if (!instructions.trim()) {
      setInstructions(defaultDeveloperInstructions);
    }
  }, [workflow, defaultDeveloperInstructions, instructions]);

  useEffect(() => {
    if (!workflow?.exchangeApiKeyId) return;
    if (workflow.exchangeApiKeyId === bybitKeyId && tradingMode !== 'futures') {
      setTradingMode('futures');
    } else if (
      workflow.exchangeApiKeyId === binanceKeyId &&
      tradingMode !== 'spot'
    ) {
      setTradingMode('spot');
    }
  }, [workflow?.exchangeApiKeyId, binanceKeyId, bybitKeyId, tradingMode]);

  useEffect(() => {
    if (workflow) return;
    if (tradingMode === 'spot' && !hasBinanceKey && hasBybitKey) {
      setTradingMode('futures');
    } else if (
      tradingMode === 'futures' &&
      !hasBybitKey &&
      hasBinanceKey
    ) {
      setTradingMode('spot');
    }
  }, [workflow, tradingMode, hasBinanceKey, hasBybitKey]);

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
        exchangeLabel: 'Bybit',
        enabled: hasBybitKey,
      },
    ],
    [t, hasBinanceKey, hasBybitKey],
  );

  function WarningSign({ children }: { children: ReactNode }) {
    return (
      <div className="mt-2 p-4 text-sm text-red-600 border border-red-600 rounded bg-red-100">
        <div>{children}</div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-1">{t('workflow_setup')}</h1>
      <FormProvider {...methods}>
        <div className="max-w-xl">
          <PortfolioWorkflowFields
            onTokensChange={setTokenSymbols}
            balances={balances}
            accountBalances={accountBalances}
            accountLoading={isAccountLoading}
            useEarn={useEarn}
            onUseEarnChange={setUseEarn}
            autoPopulateTopTokens={!workflow}
          />
        </div>
      </FormProvider>
      <AgentInstructions value={instructions} onChange={setInstructions} />
      {user && (
        <div className="mt-4 max-w-xl">
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <ApiKeyProviderSelector
              type="ai"
              label={t('ai_provider')}
              value={aiProvider}
              onChange={setAiProvider}
            />
            {hasAiKey && (models.length || workflow?.model) && (
              <div>
                <label htmlFor="model" className="block text-md font-bold">
                  {t('model')}
                </label>
                <SelectInput
                  id="model"
                  value={model}
                  onChange={setModel}
                  options={
                    workflow?.model && !models.length
                      ? [{ value: workflow.model, label: workflow.model }]
                      : models.map((m) => ({ value: m, label: m }))
                  }
                />
              </div>
            )}
          </div>
          <div className="mt-4">
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
              <p className="text-sm text-gray-600">
                {
                  tradingModeConfigs.find((mode) => mode.id === tradingMode)
                    ?.description ?? ''
                }
              </p>
            </div>
          </div>
          {activeExchange && (
            <div className="mt-2">
              <WalletBalances
                balances={balances}
                exchange={activeExchange}
              />
            </div>
          )}
        </div>
      )}

      <div className="mt-4 max-w-xl">
        <WarningSign>
          {t('trading_agent_warning').replace(
            '{tokens}',
            tokenSymbols.map((t) => t.toUpperCase()).join(` ${t('and')} `),
          )}
          <br />
          <strong>{t('dont_move_funds_warning')}</strong>
        </WarningSign>
        <label className="mt-4 flex items-center gap-2">
          <input
            type="checkbox"
            checked={manualRebalance}
            onChange={(e) => setManualRebalance(e.target.checked)}
          />
          <span>{t('manual_rebalancing')}</span>
        </label>
        {!user && (
          <p className="text-sm text-gray-600 mb-2 mt-4">
            {t('log_in_to_continue')}
          </p>
        )}
        <div className="mt-4 flex gap-2">
              <Button
                disabled={isSaving || !user}
                loading={isSaving}
                onClick={async () => {
                  if (!user) return;
              setIsSaving(true);
              try {
                const values = methods.getValues();
                const [cashToken, ...positions] = values.tokens;
                const payload = {
                  model,
                  aiProvider,
                  cash: cashToken.token.toUpperCase(),
                  tokens: positions.map((t) => ({
                    token: t.token.toUpperCase(),
                    minAllocation: t.minAllocation,
                  })),
                  risk: values.risk,
                  reviewInterval: values.reviewInterval,
                  agentInstructions: instructions,
                  manualRebalance,
                  useEarn,
                  status: 'inactive',
                  exchangeKeyId: selectedExchangeKeyId,
                };
                if (workflow) {
                  await api.put(`/portfolio-workflows/${workflow.id}`, payload);
                } else {
                  await api.post('/portfolio-workflows', payload);
                }
                setIsSaving(false);
                toast.show(t('setup_saved_successfully'), 'success');
                navigate('/');
              } catch (err) {
                setIsSaving(false);
                if (axios.isAxiosError(err) && err.response?.data?.error) {
                  toast.show(err.response.data.error);
                } else {
                  toast.show(t('failed_save_setup'));
                }
              }
            }}
          >
            {workflow ? t('update_setup') : t('save_setup')}
          </Button>
          <WorkflowStartButton
            workflow={workflow}
            workflowData={{
              tokens: values.tokens.map((t) => ({
                token: t.token,
                minAllocation: t.minAllocation,
              })),
              risk: values.risk,
              reviewInterval: values.reviewInterval,
              agentInstructions: instructions,
              manualRebalance,
              useEarn,
              exchangeKeyId: selectedExchangeKeyId,
            }}
            model={model}
            aiProvider={aiProvider}
            disabled={
              !user ||
              !hasAiKey ||
              !hasExchangeKey ||
              !model ||
              !selectedExchangeKeyId
            }
          />
        </div>
      </div>
    </div>
  );
}
