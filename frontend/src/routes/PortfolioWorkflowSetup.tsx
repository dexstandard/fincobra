import { useState, useEffect, useMemo, type ReactNode } from 'react';
import { useTranslation } from '../lib/i18n';
import AgentInstructions from '../components/AgentInstructions';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import api from '../lib/axios';
import { useUser } from '../lib/useUser';
import ApiKeyProviderSelector from '../components/forms/ApiKeyProviderSelector';
import { useToast } from '../lib/useToast';
import Button from '../components/ui/Button';
import { usePrerequisites } from '../lib/usePrerequisites';
import WorkflowStartButton from '../components/WorkflowStartButton';
import SelectInput from '../components/forms/SelectInput';
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
  const [aiProvider, setAiProvider] = useState('openai');
  const [exchangeProvider, setExchangeProvider] = useState<
    'binance' | 'bybit' | null
  >(workflow?.exchangeProvider ?? null);
  const [useEarn, setUseEarn] = useState(workflow?.useEarn ?? false);
  const [tokenSymbols, setTokenSymbols] = useState(
    defaultValues.tokens.map((t) => t.token),
  );

  const methods = useForm<PortfolioReviewFormValues>({
    resolver: zodResolver(portfolioReviewSchema),
    defaultValues,
  });
  const { reset } = methods;
  const {
    hasOpenAIKey,
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
    exchange: exchangeProvider ?? undefined,
  });
  const hasExchangeKey = hasBinanceKey || hasBybitKey;
  const selectedExchangeKeyId = useMemo(() => {
    if (exchangeProvider === 'binance') return binanceKeyId;
    if (exchangeProvider === 'bybit') return bybitKeyId;
    return null;
  }, [exchangeProvider, binanceKeyId, bybitKeyId]);

  const [instructions, setInstructions] = useState(
    workflow?.agentInstructions || '',
  );
  const [manualRebalance, setManualRebalance] = useState(
    workflow?.manualRebalance || false,
  );
  const [isSaving, setIsSaving] = useState(false);
  const values = methods.watch();
  const { data: defaultDeveloperInstructions } = useDeveloperInstructions();

  const exchangeOptions = useMemo(() => {
    const options: { value: 'binance' | 'bybit'; label: string }[] = [];
    if (hasBinanceKey) {
      options.push({ value: 'binance', label: 'Binance' });
    }
    if (hasBybitKey) {
      options.push({ value: 'bybit', label: 'Bybit' });
    }
    return options;
  }, [hasBinanceKey, hasBybitKey]);

  useEffect(() => {
    setModel(workflow?.model || '');
  }, [workflow?.model]);

  useEffect(() => {
    if (!hasOpenAIKey) {
      setModel('');
    } else if (!model) {
      setModel(workflow?.model || models[0] || '');
    }
  }, [hasOpenAIKey, models, workflow?.model, model]);

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
    if (!exchangeOptions.length) {
      if (exchangeProvider !== null) {
        setExchangeProvider(null);
      }
      return;
    }
    const desiredExchange = (() => {
      if (workflow?.exchangeProvider) return workflow.exchangeProvider;
      if (!workflow?.exchangeApiKeyId) return null;
      if (workflow.exchangeApiKeyId === bybitKeyId) return 'bybit';
      if (workflow.exchangeApiKeyId === binanceKeyId) return 'binance';
      return null;
    })();
    if (
      desiredExchange &&
      exchangeProvider !== desiredExchange &&
      exchangeOptions.some((opt) => opt.value === desiredExchange)
    ) {
      setExchangeProvider(desiredExchange);
      return;
    }
    if (!exchangeProvider) {
      setExchangeProvider(exchangeOptions[0].value);
      return;
    }
    if (!exchangeOptions.some((opt) => opt.value === exchangeProvider)) {
      setExchangeProvider(exchangeOptions[0].value);
    }
  }, [
    exchangeOptions,
    exchangeProvider,
    workflow?.exchangeApiKeyId,
    workflow?.exchangeProvider,
    binanceKeyId,
    bybitKeyId,
  ]);

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
            {hasOpenAIKey && (models.length || workflow?.model) && (
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
          {exchangeOptions.length > 0 && (
            <div className="mt-4">
              <label
                htmlFor="exchange-provider"
                className="block text-md font-bold"
              >
                {t('exchange')}
              </label>
              <SelectInput
                id="exchange-provider"
                value={
                  exchangeProvider ?? exchangeOptions[0]?.value ?? 'binance'
                }
                onChange={(value) =>
                  setExchangeProvider(value as 'binance' | 'bybit')
                }
                options={exchangeOptions}
              />
            </div>
          )}
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
            disabled={
              !user ||
              !hasOpenAIKey ||
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
