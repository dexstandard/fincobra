import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import api from '../lib/axios';
import { useUser } from '../lib/useUser';
import { useToast } from '../lib/useToast';
import { useTranslation } from '../lib/i18n';
import type { PortfolioWorkflow } from '../lib/useWorkflowData';
import Button from './ui/Button';
import ConfirmDialog from './ui/ConfirmDialog';

interface WorkflowPreviewDetails {
  tokens: { token: string; minAllocation: number }[];
  risk: string;
  reviewInterval: string;
  agentInstructions: string;
  manualRebalance: boolean;
  useEarn: boolean;
  exchangeKeyId: string | null;
  aiProvider: 'openai' | 'groq';
  mode: 'spot' | 'futures';
  futuresDefaultLeverage: number | null;
  futuresMarginMode: 'cross' | 'isolated' | null;
}

interface Props {
  workflow?: PortfolioWorkflow;
  workflowData: WorkflowPreviewDetails;
  model: string;
  disabled: boolean;
}

export default function WorkflowStartButton({
  workflow,
  workflowData,
  model,
  disabled,
}: Props) {
  const { user } = useUser();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const t = useTranslation();
  const [isCreating, setIsCreating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function startWorkflow() {
    if (!user) return;
    if (!model) {
      toast.show(t('model_required'));
      return;
    }
    if (
      workflowData.mode === 'futures' &&
      (!workflowData.futuresDefaultLeverage ||
        workflowData.futuresDefaultLeverage < 1)
    ) {
      toast.show(t('futures_leverage_required'));
      return;
    }
    setConfirmOpen(false);
    setIsCreating(true);
    try {
      if (workflow) {
        await api.post(`/portfolio-workflows/${workflow.id}/start`, {
          aiProvider: workflowData.aiProvider,
        });
        queryClient.invalidateQueries({ queryKey: ['workflows'] });
        toast.show(t('workflow_started_success'), 'success');
        navigate('/');
      } else {
        const [cashToken, ...positions] = workflowData.tokens;
        const res = await api.post('/portfolio-workflows', {
          model,
          aiProvider: workflowData.aiProvider,
          cash: cashToken.token.toUpperCase(),
          tokens: positions.map((t) => ({
            token: t.token.toUpperCase(),
            minAllocation: t.minAllocation,
          })),
          risk: workflowData.risk,
          reviewInterval: workflowData.reviewInterval,
          agentInstructions: workflowData.agentInstructions,
          manualRebalance: workflowData.manualRebalance,
          useEarn: workflowData.useEarn,
          status: 'active',
          exchangeKeyId: workflowData.exchangeKeyId,
          mode: workflowData.mode,
          futuresDefaultLeverage: workflowData.futuresDefaultLeverage,
          futuresMarginMode: workflowData.futuresMarginMode,
        });
        navigate(`/portfolio-workflows/${res.data.id}`);
      }
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        toast.show(err.response.data.error);
      } else {
        toast.show(t('failed_start_workflow'));
      }
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <>
      <Button
        disabled={disabled || isCreating}
        loading={isCreating}
        onClick={() => setConfirmOpen(true)}
      >
        {t('start_workflow')}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        message={t('start_workflow_confirm')}
        onConfirm={startWorkflow}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
