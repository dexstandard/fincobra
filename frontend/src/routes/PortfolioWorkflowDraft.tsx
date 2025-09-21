import { useState, useEffect, type ReactNode } from 'react';
import { useTranslation } from '../lib/i18n';
import WorkflowName from '../components/WorkflowName';
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
import { FormProvider, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  portfolioReviewSchema,
  portfolioReviewDefaults,
  DEFAULT_AGENT_INSTRUCTIONS,
  type PortfolioReviewFormValues,
} from '../lib/constants';
import PortfolioWorkflowFields from '../components/forms/PortfolioWorkflowFields';
import type { PortfolioWorkflow } from '../lib/useWorkflowData';

interface Props {
  draft?: PortfolioWorkflow;
}

export default function PortfolioWorkflowDraft({ draft }: Props) {
  const navigate = useNavigate();
  const { user } = useUser();
  const toast = useToast();
  const t = useTranslation();

  const defaultValues = draft
    ? {
        tokens: [
          { token: draft.cashToken, minAllocation: 0 },
          ...draft.tokens,
        ],
        risk: draft.risk,
        reviewInterval: draft.reviewInterval,
      }
    : portfolioReviewDefaults;

  const [model, setModel] = useState(draft?.model || '');
  const [aiProvider, setAiProvider] = useState('openai');
  const [useEarn, setUseEarn] = useState(draft?.useEarn ?? true);
  const [tokenSymbols, setTokenSymbols] = useState(
    defaultValues.tokens.map((t) => t.token),
  );

  const methods = useForm<PortfolioReviewFormValues>({
    resolver: zodResolver(portfolioReviewSchema),
    defaultValues,
  });
  const {
    hasOpenAIKey,
    hasBinanceKey,
    models,
    balances,
    accountBalances,
    isAccountLoading,
  } = usePrerequisites(tokenSymbols);

  const [name, setName] = useState(
    draft?.name || tokenSymbols.map((t) => t.toUpperCase()).join(' / '),
  );
  const [instructions, setInstructions] = useState(
    draft?.agentInstructions || DEFAULT_AGENT_INSTRUCTIONS,
  );
  const [manualRebalance, setManualRebalance] = useState(
    draft?.manualRebalance || false,
  );
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const values = methods.watch();

  useEffect(() => {
    setModel(draft?.model || '');
  }, [draft?.model]);

  useEffect(() => {
    if (!hasOpenAIKey) {
      setModel('');
    } else if (!model) {
      setModel(draft?.model || models[0] || '');
    }
  }, [hasOpenAIKey, models, draft?.model, model]);

  useEffect(() => {
    if (!draft) {
      setName(tokenSymbols.map((t) => t.toUpperCase()).join(' / '));
    }
  }, [tokenSymbols, draft]);

  function WarningSign({ children }: { children: ReactNode }) {
    return (
      <div className="mt-2 p-4 text-sm text-red-600 border border-red-600 rounded bg-red-100">
        <div>{children}</div>
      </div>
    );
  }

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
        <span>{t('workflow_draft')}:</span>
        <WorkflowName
          name={name}
          onChange={setName}
          className="text-2xl font-bold"
        />
      </h1>
      <FormProvider {...methods}>
        <div className="max-w-xl">
          <PortfolioWorkflowFields
            onTokensChange={setTokenSymbols}
            balances={balances}
            accountBalances={accountBalances}
            accountLoading={isAccountLoading}
            useEarn={useEarn}
            onUseEarnChange={setUseEarn}
            autoPopulateTopTokens={!draft}
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
            {hasOpenAIKey && (models.length || draft?.model) && (
              <div>
                <label
                  htmlFor="model"
                  className="block text-md font-bold"
                >
                  {t('model')}
                </label>
                <SelectInput
                  id="model"
                  value={model}
                  onChange={setModel}
                  options={
                    draft?.model && !models.length
                      ? [{ value: draft.model, label: draft.model }]
                      : models.map((m) => ({ value: m, label: m }))
                  }
                />
              </div>
              )}
            </div>
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
          <p className="text-sm text-gray-600 mb-2 mt-4">{t('log_in_to_continue')}</p>
        )}
        <div className="mt-4 flex gap-2">
          <Button
            disabled={isSavingDraft || !user}
            loading={isSavingDraft}
            onClick={async () => {
              if (!user) return;
              setIsSavingDraft(true);
              try {
                const values = methods.getValues();
                const [cashToken, ...positions] = values.tokens;
                const payload = {
                  model,
                  name,
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
                  status: 'draft',
                };
                if (draft) {
                  await api.put(`/portfolio-workflows/${draft.id}`, payload);
                } else {
                  await api.post('/portfolio-workflows', payload);
                }
                setIsSavingDraft(false);
                toast.show(t('draft_saved_successfully'), 'success');
                navigate('/');
              } catch (err) {
                setIsSavingDraft(false);
                if (axios.isAxiosError(err) && err.response?.data?.error) {
                  toast.show(err.response.data.error);
                } else {
                  toast.show(t('failed_save_draft'));
                }
              }
            }}
          >
            {draft ? t('update_draft') : t('save_draft')}
          </Button>
          <WorkflowStartButton
            draft={draft}
            workflowData={{
              name,
              tokens: values.tokens.map((t) => ({ token: t.token, minAllocation: t.minAllocation })),
              risk: values.risk,
              reviewInterval: values.reviewInterval,
              agentInstructions: instructions,
              manualRebalance,
              useEarn,
            }}
            model={model}
            disabled={!user || !hasOpenAIKey || !hasBinanceKey || !model}
          />
        </div>
      </div>
    </div>
  );
}
