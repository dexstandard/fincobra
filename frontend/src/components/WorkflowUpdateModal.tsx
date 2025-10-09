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
import type { PortfolioWorkflow } from '../lib/useWorkflowData';

import AgentInstructions from './AgentInstructions';
import ApiKeyProviderSelector from './forms/ApiKeyProviderSelector';
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
  const [aiProvider, setAiProvider] = useState('openai');
  const [exchangeProvider, setExchangeProvider] = useState<'binance' | 'bybit'>(
    'binance',
  );
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
  } = usePrerequisites(tokenSymbols, { exchange: exchangeProvider });
  const selectedExchangeKeyId = useMemo(() => {
    if (exchangeProvider === 'binance') return binanceKeyId;
    if (exchangeProvider === 'bybit') return bybitKeyId;
    return null;
  }, [exchangeProvider, binanceKeyId, bybitKeyId]);

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
      setTokenSymbols([
        workflow.cashToken,
        ...workflow.tokens.map((t) => t.token),
      ]);
    }
  }, [open, workflow, reset]);

  useEffect(() => {
    if (!hasOpenAIKey) {
      setModel('');
    } else if (!model) {
      setModel(workflow.model || models[0] || '');
    }
  }, [hasOpenAIKey, models, workflow.model, model]);

  useEffect(() => {
    if (!open) return;
    const desired = (() => {
      if (!workflow.exchangeApiKeyId) return null;
      if (workflow.exchangeApiKeyId === bybitKeyId) return 'bybit';
      if (workflow.exchangeApiKeyId === binanceKeyId) return 'binance';
      return null;
    })();
    if (desired && exchangeProvider !== desired) {
      setExchangeProvider(desired);
    }
  }, [
    open,
    workflow.exchangeApiKeyId,
    binanceKeyId,
    bybitKeyId,
    exchangeProvider,
  ]);

  useEffect(() => {
    if (exchangeProvider === 'binance' && !hasBinanceKey && hasBybitKey) {
      setExchangeProvider('bybit');
    } else if (
      exchangeProvider === 'bybit' &&
      !hasBybitKey &&
      hasBinanceKey
    ) {
      setExchangeProvider('binance');
    }
  }, [exchangeProvider, hasBinanceKey, hasBybitKey]);

  const updateMut = useMutation<void, unknown, PortfolioReviewFormValues>({
    mutationFn: async (values: PortfolioReviewFormValues) => {
      const [cashToken, ...positions] = values.tokens;
      await api.put(`/portfolio-workflows/${workflow.id}`, {
        model,
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
            {hasOpenAIKey && (models.length || workflow.model) && (
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
            <ApiKeyProviderSelector
              type="exchange"
              label={t('exchange')}
              value={exchangeProvider}
              onChange={setExchangeProvider}
            />
            <div className="mt-2">
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
