import { useEffect, useState } from 'react';
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
import type { Agent } from '../lib/useAgentData';

import AgentInstructions from './AgentInstructions';
import ApiKeyProviderSelector from './forms/ApiKeyProviderSelector';
import SelectInput from './forms/SelectInput';
import PortfolioWorkflowFields from './forms/PortfolioWorkflowFields';
import WalletBalances from './WalletBalances';
import Button from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';
import Modal from './ui/Modal';

interface Props {
  agent: Agent;
  open: boolean;
  onClose: () => void;
  onUpdated: () => void;
}

export default function AgentUpdateModal({
  agent,
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
        { token: agent.cashToken, minAllocation: 0 },
        ...agent.tokens.map((t) => ({
          token: t.token,
          minAllocation: t.minAllocation,
        })),
      ],
      risk: agent.risk,
      reviewInterval: agent.reviewInterval,
    },
  });
  const { reset, getValues } = methods;
  const [agentInstructions, setAgentInstructions] = useState(
    agent.agentInstructions,
  );
  const [useEarn, setUseEarn] = useState(agent.useEarn);
  const [tokenSymbols, setTokenSymbols] = useState<string[]>([
    agent.cashToken,
    ...agent.tokens.map((t) => t.token),
  ]);

  const {
    hasOpenAIKey,
    hasBinanceKey,
    models,
    balances,
    accountBalances,
    isAccountLoading,
  } = usePrerequisites(tokenSymbols);
  const [model, setModel] = useState(agent.model || '');
  const [aiProvider, setAiProvider] = useState('openai');
  const [exchangeProvider, setExchangeProvider] = useState('binance');

  useEffect(() => {
    if (open) {
      reset({
        tokens: [
          { token: agent.cashToken, minAllocation: 0 },
          ...agent.tokens.map((t) => ({
            token: t.token,
            minAllocation: t.minAllocation,
          })),
        ],
        risk: agent.risk,
        reviewInterval: agent.reviewInterval,
      });
      setAgentInstructions(agent.agentInstructions);
      setUseEarn(agent.useEarn);
      setModel(agent.model || '');
      setTokenSymbols([
        agent.cashToken,
        ...agent.tokens.map((t) => t.token),
      ]);
    }
  }, [open, agent, reset]);

  useEffect(() => {
    if (!hasOpenAIKey) {
      setModel('');
    } else if (!model) {
      setModel(agent.model || models[0] || '');
    }
  }, [hasOpenAIKey, models, agent.model, model]);

  const updateMut = useMutation({
    mutationFn: async () => {
      const values = getValues();
      const [cashToken, ...positions] = values.tokens;
      await api.put(`/portfolio-workflows/${agent.id}`, {
        model,
        status: agent.status,
        name: agent.name,
        cash: cashToken.token.toUpperCase(),
        tokens: positions.map((t) => ({
          token: t.token.toUpperCase(),
          minAllocation: t.minAllocation,
        })),
        risk: values.risk,
        reviewInterval: values.reviewInterval,
        agentInstructions,
        manualRebalance: agent.manualRebalance,
        useEarn,
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
        toast.show(t('failed_update_agent'));
      }
    },
  });

  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <Modal open={open} onClose={onClose}>
      <h2 className="text-xl font-bold mb-2">{t('update_agent')}</h2>
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
      <AgentInstructions
        value={agentInstructions}
        onChange={setAgentInstructions}
      />
      <div className="mt-4 max-w-2xl">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <ApiKeyProviderSelector
              type="ai"
              label={t('ai_provider')}
              value={aiProvider}
              onChange={setAiProvider}
            />
            {hasOpenAIKey && (models.length || agent.model) && (
              <div className="mt-2">
                <h2 className="text-md font-bold">{t('model')}</h2>
                <SelectInput
                  id="update-model"
                  value={model}
                  onChange={setModel}
                  options={
                    agent.model && !models.length
                      ? [{ value: agent.model, label: agent.model }]
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
                hasBinanceKey={hasBinanceKey}
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
          onClick={() => setConfirmOpen(true)}
        >
          {t('confirm')}
        </Button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        message={
          agent.status === 'active'
            ? t('update_running_agent_prompt')
            : t('update_agent_prompt')
        }
        onConfirm={() => {
          setConfirmOpen(false);
          updateMut.mutate();
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </Modal>
  );
}
