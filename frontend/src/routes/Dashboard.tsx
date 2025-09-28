import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Eye, Trash, Clock, Plus } from 'lucide-react';
import axios from 'axios';
import api from '../lib/axios';
import { useUser } from '../lib/useUser';
import WorkflowStatusLabel from '../components/WorkflowStatusLabel';
import TokenDisplay from '../components/TokenDisplay';
import { useWorkflowBalanceUsd } from '../lib/useWorkflowBalanceUsd';
import Button from '../components/ui/Button';
import ConfirmDialog from '../components/ui/ConfirmDialog';
import ExchangeApiKeySection from '../components/forms/ExchangeApiKeySection';
import ErrorBoundary from '../components/ErrorBoundary';
import { useToast } from '../lib/useToast';
import Toggle from '../components/ui/Toggle';
import { useTranslation } from '../lib/i18n';
import { usePrerequisites } from '../lib/usePrerequisites';

interface WorkflowSummary {
  id: string;
  userId: string;
  model: string;
  status: 'active' | 'inactive' | 'retired';
  cashToken: string;
  tokens?: { token: string }[];
  startBalanceUsd?: number | null;
  reviewInterval: string;
}

function WorkflowRow({
  workflow,
  onDelete,
}: {
  workflow: WorkflowSummary;
  onDelete: (id: string) => void;
}) {
  const t = useTranslation();
  const tokenList = [
    workflow.cashToken,
    ...(workflow.tokens ? workflow.tokens.map((t) => t.token) : []),
  ];
  const { balance, isLoading } = useWorkflowBalanceUsd(tokenList);
  const balanceText =
    balance === null
      ? '-'
      : isLoading
        ? t('loading')
        : `$${balance.toFixed(2)}`;
  const pnl =
    balance !== null && workflow.startBalanceUsd != null
      ? balance - workflow.startBalanceUsd
      : null;
  const pnlPercent =
    pnl !== null && workflow.startBalanceUsd
      ? (pnl / workflow.startBalanceUsd) * 100
      : null;
  const pnlText =
    pnl === null
      ? '-'
      : isLoading
        ? t('loading')
        : `${pnl > 0 ? '+' : pnl < 0 ? '-' : ''}$${Math.abs(pnl).toFixed(2)}${
            pnlPercent !== null
              ? ` (${pnlPercent > 0 ? '+' : pnlPercent < 0 ? '-' : ''}${Math.abs(pnlPercent).toFixed(2)}%)`
              : ''
          }`;
  const pnlClass =
    pnl === null || isLoading
      ? ''
      : pnlPercent !== null
        ? pnlPercent <= -3
          ? 'text-red-600'
          : pnlPercent >= 3
            ? 'text-green-600'
            : 'text-gray-600'
        : pnl <= -0.03
          ? 'text-red-600'
          : pnl >= 0.03
            ? 'text-green-600'
            : 'text-gray-600';
  const pnlTooltip =
    pnl === null || isLoading
      ? undefined
      : `${t('pnl')} = $${balance!.toFixed(2)} - $${workflow.startBalanceUsd!.toFixed(2)} = ${
          pnl > 0 ? '+' : pnl < 0 ? '-' : ''
        }$${Math.abs(pnl).toFixed(2)}${
          pnlPercent !== null
            ? ` (${pnlPercent > 0 ? '+' : pnlPercent < 0 ? '-' : ''}${Math.abs(pnlPercent).toFixed(2)}%)`
            : ''
        }`;
  return (
    <tr key={workflow.id}>
      <td>
        {tokenList.length ? (
          <span className="inline-flex items-center gap-1">
            {tokenList.map((tok, i) => (
              <span key={tok} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                <TokenDisplay token={tok} />
              </span>
            ))}
          </span>
        ) : (
          '-'
        )}
      </td>
      <td>{balanceText}</td>
      <td className={pnlClass} title={pnlTooltip}>
        {pnlText}
      </td>
      <td>{workflow.model || '-'}</td>
      <td>
        <span className="inline-flex items-center gap-1">
          <Clock className="w-4 h-4" />
          {workflow.reviewInterval}
        </span>
      </td>
      <td>
        <WorkflowStatusLabel status={workflow.status} />
      </td>
      <td>
        <div className="flex items-center gap-2">
          <Link
            className="text-blue-600 underline inline-flex"
            to={`/portfolio-workflows/${workflow.id}`}
            aria-label={t('view_workflow')}
          >
            <Eye className="w-4 h-4" />
          </Link>
          <button
            className="text-red-600"
            onClick={() => onDelete(workflow.id)}
            aria-label={t('delete_workflow')}
          >
            <Trash className="w-4 h-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

function WorkflowBlock({
  workflow,
  onDelete,
}: {
  workflow: WorkflowSummary;
  onDelete: (id: string) => void;
}) {
  const t = useTranslation();
  const tokenList = [
    workflow.cashToken,
    ...(workflow.tokens ? workflow.tokens.map((t) => t.token) : []),
  ];
  const { balance, isLoading } = useWorkflowBalanceUsd(tokenList);
  const balanceText =
    balance === null
      ? '-'
      : isLoading
        ? t('loading')
        : `$${balance.toFixed(2)}`;
  const pnl =
    balance !== null && workflow.startBalanceUsd != null
      ? balance - workflow.startBalanceUsd
      : null;
  const pnlPercent =
    pnl !== null && workflow.startBalanceUsd
      ? (pnl / workflow.startBalanceUsd) * 100
      : null;
  const pnlText =
    pnl === null
      ? '-'
      : isLoading
        ? t('loading')
        : `${pnl > 0 ? '+' : pnl < 0 ? '-' : ''}$${Math.abs(pnl).toFixed(2)}${
            pnlPercent !== null
              ? ` (${pnlPercent > 0 ? '+' : pnlPercent < 0 ? '-' : ''}${Math.abs(pnlPercent).toFixed(2)}%)`
              : ''
          }`;
  const pnlClass =
    pnl === null || isLoading
      ? ''
      : pnlPercent !== null
        ? pnlPercent <= -3
          ? 'text-red-600'
          : pnlPercent >= 3
            ? 'text-green-600'
            : 'text-gray-600'
        : pnl <= -0.03
          ? 'text-red-600'
          : pnl >= 0.03
            ? 'text-green-600'
            : 'text-gray-600';
  const pnlTooltip =
    pnl === null || isLoading
      ? undefined
      : `${t('pnl')} = $${balance!.toFixed(2)} - $${workflow.startBalanceUsd!.toFixed(2)} = ${
          pnl > 0 ? '+' : pnl < 0 ? '-' : ''
        }$${Math.abs(pnl).toFixed(2)}${
          pnlPercent !== null
            ? ` (${pnlPercent > 0 ? '+' : pnlPercent < 0 ? '-' : ''}${Math.abs(pnlPercent).toFixed(2)}%)`
            : ''
        }`;
  return (
    <div className="border rounded p-3 text-sm">
      <div className="mb-2 flex items-center gap-1 font-medium">
        {tokenList.length ? (
          <span className="inline-flex items-center gap-1">
            {tokenList.map((tok, i) => (
              <span key={tok} className="flex items-center gap-1">
                {i > 0 && <span>/</span>}
                <TokenDisplay token={tok} />
              </span>
            ))}
          </span>
        ) : (
          '-'
        )}
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2 items-center">
        <div>
          <div className="text-xs text-gray-500">{t('balance')}</div>
          {balanceText}
        </div>
        <div className={pnlClass} title={pnlTooltip}>
          <div className="text-xs text-gray-500">{t('pnl')}</div>
          {pnlText}
        </div>
        <div className="flex justify-end">
          <Link
            className="text-blue-600 underline inline-flex"
            to={`/portfolio-workflows/${workflow.id}`}
            aria-label={t('view_workflow')}
          >
            <Eye className="w-5 h-5" />
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-2 items-center">
        <div>
          <div className="text-xs text-gray-500">{t('status')}</div>
          <WorkflowStatusLabel status={workflow.status} />
        </div>
        <div>
          <div className="text-xs text-gray-500">{t('model')}</div>
          {workflow.model || '-'}
        </div>
        <div>
          <div className="text-xs text-gray-500">{t('interval')}</div>
          <span className="inline-flex items-center gap-1">
            <Clock className="w-4 h-4" />
            {workflow.reviewInterval}
          </span>
        </div>
        <div className="flex justify-end">
          <button
            className="text-red-600"
            onClick={() => onDelete(workflow.id)}
            aria-label={t('delete_workflow')}
          >
            <Trash className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useUser();
  const [page, setPage] = useState(1);
  const [onlyActive, setOnlyActive] = useState(false);
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useTranslation();
  const { hasBinanceKey } = usePrerequisites([], {
    includeAiKey: false,
  });

  const { data } = useQuery({
    queryKey: ['workflows', page, user?.id, onlyActive],
    queryFn: async () => {
      const res = await api.get('/portfolio-workflows/paginated', {
        params: {
          page,
          pageSize: 10,
          status: onlyActive ? 'active' : undefined,
        },
      });
      return res.data as {
        items: WorkflowSummary[];
        total: number;
        page: number;
        pageSize: number;
      };
    },
    enabled: !!user,
  });

  const totalPages = data ? Math.ceil(data.total / data.pageSize) : 0;
  const items = data?.items ?? [];

  const [deleteId, setDeleteId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    setDeleteId(id);
  };

  const confirmDelete = async () => {
    if (!deleteId) return;
    try {
      await api.delete(`/portfolio-workflows/${deleteId}`);
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      toast.show(t('workflow_deleted'), 'success');
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        toast.show(err.response.data.error);
      } else {
        toast.show(t('failed_delete_workflow'));
      }
    } finally {
      setDeleteId(null);
    }
  };

  if (!user) {
    return (
      <div className="flex flex-col gap-3 w-full">
        <ErrorBoundary>
          <div className="bg-white shadow-md border border-gray-200 rounded p-6 w-full">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">{t('my_workflows')}</h2>
            </div>
            <p>
              {hasBinanceKey
                ? t('no_workflows_yet_connected')
                : t('no_workflows_yet')}
            </p>
          </div>
        </ErrorBoundary>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 w-full">
        {!hasBinanceKey && (
          <div className="flex flex-col md:flex-row gap-3 items-stretch">
            <div className="flex-1 flex flex-col gap-4">
              <ExchangeApiKeySection
                exchange="binance"
                label={t('connect_binance_api')}
              />
            </div>
          </div>
        )}
        <ErrorBoundary>
          <div className="bg-white shadow-md border border-gray-200 rounded p-6 w-full">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold">{t('my_workflows')}</h2>
                {hasBinanceKey && (
                  <Link
                    to="/portfolio-workflow"
                    className="text-blue-600 inline-flex"
                    aria-label={t('create_workflow')}
                  >
                    <Plus className="w-6 h-6" strokeWidth={3} />
                  </Link>
                )}
              </div>
              <Toggle
                label={t('only_active')}
                checked={onlyActive}
                onChange={setOnlyActive}
              />
            </div>
            {items.length === 0 ? (
              <p>
                {hasBinanceKey
                  ? t('no_workflows_yet_connected')
                  : t('no_workflows_yet')}
              </p>
            ) : (
              <>
                <table className="w-full mb-4 hidden md:table">
                  <thead>
                    <tr>
                      <th className="text-left">{t('tokens')}</th>
                      <th className="text-left">{t('balance_usd')}</th>
                      <th className="text-left">{t('pnl_usd')}</th>
                      <th className="text-left">{t('model')}</th>
                      <th className="text-left">{t('interval')}</th>
                      <th className="text-left">{t('status')}</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((workflow) => (
                      <WorkflowRow
                        key={workflow.id}
                        workflow={workflow}
                        onDelete={handleDelete}
                      />
                    ))}
                  </tbody>
                </table>
                <div className="md:hidden flex flex-col gap-2 mb-4">
                  {items.map((workflow) => (
                    <WorkflowBlock
                      key={workflow.id}
                      workflow={workflow}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
                {totalPages > 0 && (
                  <div className="flex gap-2 items-center">
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      {t('prev')}
                    </Button>
                    <span>
                      {page} / {totalPages}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      {t('next')}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>
        </ErrorBoundary>
      </div>
      <ConfirmDialog
        open={deleteId !== null}
        message={t('delete_workflow_prompt')}
        confirmVariant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteId(null)}
      />
    </>
  );
}
