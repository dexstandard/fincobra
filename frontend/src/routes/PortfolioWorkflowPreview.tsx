import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from '../lib/i18n';
import WorkflowName from '../components/WorkflowName';
import AgentInstructions from '../components/AgentInstructions';
import { useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import api from '../lib/axios';
import { useUser } from '../lib/useUser';
import ApiKeyProviderSelector from '../components/forms/ApiKeyProviderSelector';
import TokenSelect from '../components/forms/TokenSelect';
import TextInput from '../components/forms/TextInput';
import { Plus, Trash } from 'lucide-react';
import {
  tokens as tokenOptions,
  stableCoins,
  type PortfolioReviewFormValues,
} from '../lib/constants';
import { useToast } from '../lib/useToast';
import Button from '../components/ui/Button';
import { usePrerequisites } from '../lib/usePrerequisites';
import WorkflowStartButton from '../components/WorkflowStartButton';
import SelectInput from '../components/forms/SelectInput';

interface WorkflowPreviewDetails {
  name: string;
  tokens: { token: string; minAllocation: number }[];
  risk: PortfolioReviewFormValues['risk'];
  reviewInterval: PortfolioReviewFormValues['reviewInterval'];
  agentInstructions: string;
  manualRebalance: boolean;
  useEarn: boolean;
}

interface WorkflowDraft extends WorkflowPreviewDetails {
  id: string;
  userId: string;
  model: string | null;
}

interface Props {
  draft?: WorkflowDraft;
}

export default function PortfolioWorkflowPreview({ draft }: Props) {
  const navigate = useNavigate();
  const location = useLocation();
  const locationData = location.state as WorkflowPreviewDetails | undefined;
  const { user } = useUser();
  const toast = useToast();
  const t = useTranslation();
  const data = draft ?? locationData;
  const [workflowData, setWorkflowData] =
    useState<WorkflowPreviewDetails | undefined>(data);
  useEffect(() => {
    if (data) setWorkflowData(data);
  }, [data]);
  const tokenSymbols = workflowData
    ? workflowData.tokens.map((t) => t.token)
    : [];
  const { hasOpenAIKey, hasBinanceKey, models, balances } =
    usePrerequisites(tokenSymbols);
  const [model, setModel] = useState(draft?.model || '');
  const [aiProvider, setAiProvider] = useState('openai');
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
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  const handleAddToken = () => {
    setWorkflowData((d) => {
      if (!d) return d;
      const available = tokenOptions.filter(
        (t) => !d.tokens.some((tw) => tw.token === t.value),
      );
      const newToken = available[0]?.value || tokenOptions[0].value;
      return {
        ...d,
        tokens: [...d.tokens, { token: newToken, minAllocation: 0 }],
      };
    });
  };

  const handleRemoveToken = (index: number) => {
    setWorkflowData((d) => {
      if (!d) return d;
      if (index === 0 || d.tokens.length <= 2) return d;
      return {
        ...d,
        tokens: d.tokens.filter((_, i) => i !== index),
      };
    });
  };

  function WarningSign({ children }: { children: ReactNode }) {
    return (
      <div className="mt-2 p-4 text-sm text-red-600 border border-red-600 rounded bg-red-100">
        <div>{children}</div>
      </div>
    );
  }

  const isDraft = !!draft;

  if (!workflowData) return <div className="p-4">{t('no_preview_data')}</div>;

  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
        <span>{isDraft ? t('workflow_draft') : t('workflow_preview')}:</span>
        <WorkflowName
          name={workflowData.name}
          onChange={(name) =>
            setWorkflowData((d) => (d ? { ...d, name } : d))
          }
          className="text-2xl font-bold"
        />
      </h1>
      <div className="max-w-xl">
        <h2 className="text-md font-bold mb-2">{t('tokens')}</h2>
        <div className="space-y-2 w-fit">
          <div className="grid grid-cols-[7rem_6rem_4rem_auto] gap-2 text-sm font-medium">
            <div className="text-left">Token</div>
            <div className="text-left">
              {workflowData.useEarn ? 'Spot + Earn' : 'Spot'}
            </div>
            <div className="text-left">Min %</div>
            <div />
          </div>
          {workflowData.tokens.map((tkn, index) => {
            const balanceInfo = balances.find(
              (b) => b.token.toUpperCase() === tkn.token.toUpperCase(),
            );
            return (
              <div
                key={`${tkn.token}-${index}`}
                className="grid grid-cols-[7rem_6rem_4rem_auto] gap-2 items-center"
              >
                <TokenSelect
                  id={`token-${index}`}
                  value={tkn.token}
                  onChange={(val) =>
                    setWorkflowData((d) =>
                      d
                        ? {
                            ...d,
                            tokens: d.tokens.map((t, i) =>
                              i === index ? { ...t, token: val } : t,
                            ),
                          }
                        : d,
                    )
                  }
                  options={
                    index === 0
                      ? tokenOptions.filter((t) =>
                          stableCoins.includes(t.value),
                        )
                      : tokenOptions.filter(
                          (t) =>
                            t.value === tkn.token ||
                            !workflowData.tokens.some(
                              (tw, i) => tw.token === t.value && i !== index,
                            ),
                        )
                  }
                />
                <span className="text-sm text-left">
                  {balanceInfo?.isLoading
                    ? t('loading')
                    : balanceInfo
                    ? (
                        balanceInfo.walletBalance +
                        (workflowData.useEarn ? balanceInfo.earnBalance : 0)
                      ).toFixed(5)
                    : '0.00000'}
                </span>
                <TextInput
                  id={`minAllocation-${index}`}
                  type="number"
                  min={0}
                  max={95}
                  value={tkn.minAllocation}
                  onChange={(e) =>
                    setWorkflowData((d) =>
                      d
                        ? {
                            ...d,
                            tokens: d.tokens.map((t, i) =>
                              i === index
                                ? {
                                    ...t,
                                    minAllocation:
                                      e.target.value === ''
                                        ? 0
                                        : Number(e.target.value),
                                  }
                                : t,
                            ),
                          }
                        : d,
                    )
                  }
                />
                <button
                  type="button"
                  onClick={() => handleRemoveToken(index)}
                  disabled={index === 0 || workflowData.tokens.length <= 2}
                  className="text-red-600 disabled:opacity-50"
                >
                  <Trash className="w-4 h-4" />
                </button>
              </div>
            );
          })}
          {workflowData.tokens.length < 4 && (
            <button
              type="button"
              onClick={handleAddToken}
              className="flex items-center gap-1 text-blue-600"
          >
              <Plus className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="text-sm font-medium text-right mt-2">
          Total $:{' '}
          {(() => {
            return workflowData.tokens
              .reduce((sum, tkn) => {
                const balanceInfo = balances.find(
                  (b) => b.token.toUpperCase() === tkn.token.toUpperCase(),
                );
                if (!balanceInfo) return sum;
                const total =
                  balanceInfo.walletBalance + balanceInfo.earnBalance;
                const price = total > 0 ? balanceInfo.usdValue / total : 0;
                const usd =
                  (balanceInfo.walletBalance +
                    (workflowData.useEarn ? balanceInfo.earnBalance : 0)) *
                  price;
                return sum + usd;
              }, 0)
              .toFixed(5);
          })()}
        </div>
        <div className="mt-4 grid grid-cols-2 grid-rows-2 gap-x-4 gap-y-1 text-sm">
          <span className="font-medium">{t('risk_tolerance')}</span>
          <span className="font-medium">{t('review_interval')}</span>
          <span>{workflowData.risk}</span>
          <span>{workflowData.reviewInterval}</span>
        </div>
      </div>
      <AgentInstructions
        value={workflowData.agentInstructions}
        onChange={(v) =>
          setWorkflowData((d) => (d ? { ...d, agentInstructions: v } : d))
        }
      />
      {user && (
        <div className="mt-4 max-w-xl">
          <div>
            <ApiKeyProviderSelector
              type="ai"
              label={t('ai_provider')}
              value={aiProvider}
              onChange={setAiProvider}
            />
            {hasOpenAIKey && (models.length || draft?.model) && (
              <div className="mt-2">
                <h2 className="text-md font-bold">{t('model')}</h2>
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
            workflowData.tokens
              .map((t) => t.token.toUpperCase())
              .join(` ${t('and')} `),
          )}
          <br />
          <strong>{t('dont_move_funds_warning')}</strong>
        </WarningSign>
        <label className="mt-4 flex items-center gap-2">
          <input
            type="checkbox"
            checked={workflowData.manualRebalance}
            onChange={(e) =>
              setWorkflowData((d) =>
                d ? { ...d, manualRebalance: e.target.checked } : d,
              )
            }
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
                const [cashToken, ...positions] = workflowData.tokens;
                const payload = {
                  model,
                  name: workflowData.name,
                  cash: cashToken.token.toUpperCase(),
                  tokens: positions.map((t) => ({
                    token: t.token.toUpperCase(),
                    minAllocation: t.minAllocation,
                  })),
                  risk: workflowData.risk,
                  reviewInterval: workflowData.reviewInterval,
                  agentInstructions: workflowData.agentInstructions,
                  manualRebalance: workflowData.manualRebalance,
                  status: 'draft',
                };
                if (isDraft) {
                  await api.put(`/portfolio-workflows/${draft!.id}`, payload);
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
            {isDraft ? t('update_draft') : t('save_draft')}
          </Button>
          <WorkflowStartButton
            draft={draft}
            workflowData={workflowData}
            model={model}
            disabled={!user || !hasOpenAIKey || !hasBinanceKey || !model}
          />
        </div>
      </div>
    </div>
  );
}
