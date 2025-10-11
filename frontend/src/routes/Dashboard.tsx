import { useMemo, useState } from 'react';
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
  ownerEmail?: string | null;
  mode: 'spot' | 'futures';
}

function formatOwnerEmail(email?: string | null) {
  if (!email) {
    return undefined;
  }
  const atIndex = email.indexOf('@');
  return atIndex === -1 ? email : email.slice(0, atIndex);
}

function WorkflowRow({
  workflow,
  onDelete,
  showOwner,
  canDelete,
}: {
  workflow: WorkflowSummary;
  onDelete: (id: string) => void;
  showOwner: boolean;
  canDelete: boolean;
}) {
  const t = useTranslation();
  const isSpot = workflow.mode === 'spot';
  const tokenList = isSpot
    ? [
        workflow.cashToken,
        ...(workflow.tokens ? workflow.tokens.map((t) => t.token) : []),
      ]
    : [];
  const modeLabel =
    workflow.mode === 'spot' ? t('spot_trading') : t('futures_trading');
  const { balance, isLoading } = useWorkflowBalanceUsd(
    tokenList,
    workflow.userId,
  );
  const balanceText = !isSpot
    ? '-'
    : balance === null
      ? '-'
      : isLoading
        ? t('loading')
        : `$${balance.toFixed(2)}`;
  const pnl =
    isSpot && balance !== null && workflow.startBalanceUsd != null
      ? balance - workflow.startBalanceUsd
      : null;
  const pnlPercent =
    pnl !== null && workflow.startBalanceUsd
      ? (pnl / workflow.startBalanceUsd) * 100
      : null;
  const pnlText =
    !isSpot
      ? '-'
      : pnl === null
        ? '-'
        : isLoading
          ? t('loading')
          : `${pnl > 0 ? '+' : pnl < 0 ? '-' : ''}$${Math.abs(pnl).toFixed(2)}${
              pnlPercent !== null
                ? ` (${pnlPercent > 0 ? '+' : pnlPercent < 0 ? '-' : ''}${Math.abs(pnlPercent).toFixed(2)}%)`
                : ''
            }`;
  const pnlClass =
    !isSpot || pnl === null || isLoading
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
    !isSpot || pnl === null || isLoading
      ? !isSpot
        ? t('futures_metrics_unavailable')
        : undefined
      : `${t('pnl')} = $${balance!.toFixed(2)} - $${workflow.startBalanceUsd!.toFixed(2)} = ${
          pnl > 0 ? '+' : pnl < 0 ? '-' : ''
        }$${Math.abs(pnl).toFixed(2)}${
          pnlPercent !== null
            ? ` (${pnlPercent > 0 ? '+' : pnlPercent < 0 ? '-' : ''}${Math.abs(pnlPercent).toFixed(2)}%)`
            : ''
        }`;
  const balanceTooltip =
    !isSpot || balance === null || isLoading
      ? !isSpot
        ? t('futures_metrics_unavailable')
        : undefined
      : undefined;
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
      <td>
        <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
          {modeLabel}
        </span>
      </td>
      <td title={balanceTooltip}>{balanceText}</td>
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
      {showOwner && <td>{formatOwnerEmail(workflow.ownerEmail) ?? '-'}</td>}
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
          {canDelete && (
            <button
              className="text-red-600"
              onClick={() => onDelete(workflow.id)}
              aria-label={t('delete_workflow')}
            >
              <Trash className="w-4 h-4" />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

function WorkflowBlock({
  workflow,
  onDelete,
  showOwner,
  canDelete,
}: {
  workflow: WorkflowSummary;
  onDelete: (id: string) => void;
  showOwner: boolean;
  canDelete: boolean;
}) {
  const t = useTranslation();
  const isSpot = workflow.mode === 'spot';
  const tokenList = isSpot
    ? [
        workflow.cashToken,
        ...(workflow.tokens ? workflow.tokens.map((t) => t.token) : []),
      ]
    : [];
  const modeLabel =
    workflow.mode === 'spot' ? t('spot_trading') : t('futures_trading');
  const { balance, isLoading } = useWorkflowBalanceUsd(
    tokenList,
    workflow.userId,
  );
  const balanceText = !isSpot
    ? '-'
    : balance === null
      ? '-'
      : isLoading
        ? t('loading')
        : `$${balance.toFixed(2)}`;
  const pnl =
    isSpot && balance !== null && workflow.startBalanceUsd != null
      ? balance - workflow.startBalanceUsd
      : null;
  const pnlPercent =
    pnl !== null && workflow.startBalanceUsd
      ? (pnl / workflow.startBalanceUsd) * 100
      : null;
  const pnlText =
    !isSpot
      ? '-'
      : pnl === null
        ? '-'
        : isLoading
          ? t('loading')
          : `${pnl > 0 ? '+' : pnl < 0 ? '-' : ''}$${Math.abs(pnl).toFixed(2)}${
              pnlPercent !== null
                ? ` (${pnlPercent > 0 ? '+' : pnlPercent < 0 ? '-' : ''}${Math.abs(pnlPercent).toFixed(2)}%)`
                : ''
            }`;
  const pnlClass =
    !isSpot || pnl === null || isLoading
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
    !isSpot || pnl === null || isLoading
      ? !isSpot
        ? t('futures_metrics_unavailable')
        : undefined
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
      <div className="mb-2 inline-block rounded-full bg-blue-50 px-2 py-0.5 text-xs font-semibold text-blue-700 border border-blue-200">
        {modeLabel}
      </div>
      <div className="grid grid-cols-3 gap-2 mb-2 items-center">
        <div>
          <div className="text-xs text-gray-500">{t('balance')}</div>
          <span title={!isSpot ? t('futures_metrics_unavailable') : undefined}>
            {balanceText}
          </span>
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
      <div
        className={`grid ${showOwner ? 'grid-cols-5' : 'grid-cols-4'} gap-2 items-center`}
      >
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
        {showOwner && (
          <div>
            <div className="text-xs text-gray-500">{t('owner')}</div>
            {formatOwnerEmail(workflow.ownerEmail) ?? '-'}
          </div>
        )}
        <div className="flex justify-end">
          {canDelete && (
            <button
              className="text-red-600"
              onClick={() => onDelete(workflow.id)}
              aria-label={t('delete_workflow')}
            >
              <Trash className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useUser();
  const [page, setPage] = useState(1);
  const [onlyActive, setOnlyActive] = useState(false);
  const [onlyMy, setOnlyMy] = useState(true);
  const queryClient = useQueryClient();
  const toast = useToast();
  const t = useTranslation();
  const { hasBinanceKey, hasBybitKey } = usePrerequisites([], {
    includeAiKey: false,
  });
  const hasExchangeKey = hasBinanceKey || hasBybitKey;
  const exchangeOptions = useMemo(
    () => [
      { id: 'binance' as const, label: 'Binance' },
      { id: 'bybit' as const, label: 'Bybit' },
    ],
    [],
  );
  const [selectedExchange, setSelectedExchange] = useState<
    (typeof exchangeOptions)[number]['id']
  >(exchangeOptions[0].id);
  const isAdmin = user?.role === 'admin';
  const showOwnerColumn = isAdmin && !onlyMy;

  const { data } = useQuery({
    queryKey: [
      'workflows',
      isAdmin ? 'admin' : 'user',
      page,
      user?.id,
      onlyActive,
      isAdmin ? onlyMy : undefined,
    ],
    queryFn: async () => {
      const params: Record<string, string | number | undefined> = {
        page,
        pageSize: 10,
        status: onlyActive ? 'active' : undefined,
      };
      const url =
        isAdmin
          ? '/portfolio-workflows/admin/paginated'
          : '/portfolio-workflows/paginated';
      if (isAdmin && onlyMy && user?.id) {
        params.userId = user.id;
      }
      const res = await api.get(url, {
        params,
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
              {hasExchangeKey
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
        {!hasExchangeKey && (
          <div className="flex flex-col md:flex-row gap-3 items-stretch">
            <div className="flex-1 flex flex-col gap-4">
              <div className="bg-white shadow-md border border-gray-200 rounded p-6">
                <h2 className="text-xl font-bold mb-4">
                  {t('connect_exchange_api')}
                </h2>
                <div className="flex gap-2 text-sm">
                  {exchangeOptions.map((option) => {
                    const isActive = selectedExchange === option.id;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => setSelectedExchange(option.id)}
                        className={`px-3 py-1.5 rounded border transition-colors ${
                          isActive
                            ? 'bg-blue-600 text-white border-transparent'
                            : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                        }`}
                        aria-pressed={isActive}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
                <div className="mt-4">
                  <ExchangeApiKeySection
                    exchange={selectedExchange}
                    label={
                      selectedExchange === 'binance'
                        ? t('binance_api_credentials')
                        : t('bybit_api_credentials')
                    }
                  />
                </div>
              </div>
            </div>
          </div>
        )}
        <ErrorBoundary>
          <div className="bg-white shadow-md border border-gray-200 rounded p-6 w-full">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-bold">{t('my_workflows')}</h2>
                {hasExchangeKey && (
                  <Link
                    to="/portfolio-workflow"
                    className="text-blue-600 inline-flex"
                    aria-label={t('create_workflow')}
                  >
                    <Plus className="w-6 h-6" strokeWidth={3} />
                  </Link>
                )}
              </div>
              <div
                className={`flex gap-3 ${
                  isAdmin
                    ? 'flex-col items-end sm:flex-row sm:items-center'
                    : 'items-center'
                }`}
              >
                {isAdmin && (
                  <Toggle
                    label={t('only_my')}
                    checked={onlyMy}
                    onChange={setOnlyMy}
                  />
                )}
                <Toggle
                  label={t('only_active')}
                  checked={onlyActive}
                  onChange={setOnlyActive}
                />
              </div>
            </div>
            {items.length === 0 ? (
              <p>
                {hasExchangeKey
                  ? t('no_workflows_yet_connected')
                  : t('no_workflows_yet')}
              </p>
            ) : (
              <>
                <table className="w-full mb-4 hidden md:table">
                    <thead>
                      <tr>
                        <th className="text-left">{t('tokens')}</th>
                        <th className="text-left">{t('trading_mode')}</th>
                        <th className="text-left">{t('balance_usd')}</th>
                        <th className="text-left">{t('pnl_usd')}</th>
                        <th className="text-left">{t('model')}</th>
                        <th className="text-left">{t('interval')}</th>
                      {showOwnerColumn && (
                        <th className="text-left">{t('owner')}</th>
                      )}
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
                        showOwner={showOwnerColumn}
                        canDelete={workflow.userId === user?.id}
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
                      showOwner={showOwnerColumn}
                      canDelete={workflow.userId === user?.id}
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
