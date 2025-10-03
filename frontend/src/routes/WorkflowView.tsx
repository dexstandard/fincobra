import { useParams } from 'react-router-dom';
import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useUser } from '../lib/useUser';
import { useWorkflowData } from '../lib/useWorkflowData';
import { useWorkflowActions } from '../lib/useWorkflowActions';
import api from '../lib/axios';
import Button from '../components/ui/Button';
import { useToast } from '../lib/useToast';
import ExecLogItem, { type ExecLog } from '../components/ExecLogItem';
import FormattedDate from '../components/ui/FormattedDate';
import WorkflowUpdateModal from '../components/WorkflowUpdateModal';
import WorkflowDetailsDesktop from '../components/WorkflowDetailsDesktop';
import WorkflowDetailsMobile from '../components/WorkflowDetailsMobile';
import Toggle from '../components/ui/Toggle';
import { usePrerequisites } from '../lib/usePrerequisites';
import { useTranslation } from '../lib/i18n';

export default function WorkflowView() {
  const { id } = useParams();
  const { user } = useUser();
  const { data: workflow } = useWorkflowData(id);
  const { startMut, stopMut } = useWorkflowActions(id);
  const queryClient = useQueryClient();
  const toast = useToast();
  const { hasOpenAIKey, hasBinanceKey } = usePrerequisites([]);
  const t = useTranslation();

  const reviewMut = useMutation({
    mutationFn: async (workflowId: string) => {
      await api.post(`/portfolio-workflows/${workflowId}/review`);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['workflow-log', id] }),
    onError: (err) => {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        toast.show(err.response.data.error);
      } else {
        toast.show(t('failed_run_review'));
      }
    },
  });

  const [showUpdate, setShowUpdate] = useState(false);

  const [logPage, setLogPage] = useState(1);
  const [onlyRebalance, setOnlyRebalance] = useState(false);
  const { data: logData } = useQuery({
    queryKey: ['workflow-log', id, logPage, user?.id, onlyRebalance],
    queryFn: async () => {
      const res = await api.get(`/portfolio-workflows/${id}/exec-log`, {
        params: { page: logPage, pageSize: 10, rebalanceOnly: onlyRebalance },
      });
      return res.data as {
        items: ExecLog[];
        total: number;
        page: number;
        pageSize: number;
      };
    },
    enabled: !!id && !!user,
  });

  if (!workflow) return <div className="p-4">{t('loading')}</div>;
  const isActive = workflow.status === 'active';
  return (
    <div className="p-4">
      <div className="hidden md:block">
        <WorkflowDetailsDesktop workflow={workflow} />
      </div>
      <div className="md:hidden">
        <WorkflowDetailsMobile workflow={workflow} />
      </div>
      {isActive ? (
        <div className="mt-4 flex gap-2">
          <Button onClick={() => setShowUpdate(true)}>
            <span className="hidden md:inline">{t('update_workflow')}</span>
            <span className="md:hidden">{t('edit')}</span>
          </Button>
          <Button
            disabled={stopMut.isPending}
            loading={stopMut.isPending}
            onClick={() => stopMut.mutate()}
          >
            <span className="hidden md:inline">{t('stop_workflow')}</span>
            <span className="md:hidden">{t('stop_workflow_short')}</span>
          </Button>
          <Button
            disabled={reviewMut.isPending}
            loading={reviewMut.isPending}
            onClick={() => id && reviewMut.mutate(id)}
          >
            {t('run_review')}
          </Button>
        </div>
      ) : (
        <div className="mt-4 flex gap-2">
          <Button onClick={() => setShowUpdate(true)}>
            <span className="hidden md:inline">{t('update_workflow')}</span>
            <span className="md:hidden">{t('edit')}</span>
          </Button>
          {hasOpenAIKey && hasBinanceKey && (
            <Button
              disabled={startMut.isPending}
              loading={startMut.isPending}
              onClick={() => startMut.mutate()}
            >
              {t('start_workflow')}
            </Button>
          )}
        </div>
      )}
      {logData && (
        <div className="mt-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-xl font-bold">{t('execution_log')}</h2>
            <Toggle
              label={t('only_rebalances')}
              checked={onlyRebalance}
              onChange={setOnlyRebalance}
            />
          </div>
          {logData.items.length === 0 ? (
            <p>{t('no_logs_yet')}</p>
          ) : (
            <>
              <div className="hidden md:block">
                <div className="overflow-hidden rounded border border-gray-200 bg-white shadow-sm">
                  <table className="w-full table-fixed">
                    <colgroup>
                      <col className="w-40" />
                      <col />
                    </colgroup>
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-gray-600">
                          {t('time')}
                        </th>
                        <th className="px-3 py-2 text-left text-sm font-semibold text-gray-600">
                          {t('log')}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {logData.items.map((log) => (
                        <tr key={log.id} className="align-top">
                          <td className="px-3 py-2 align-top whitespace-nowrap text-sm text-gray-600">
                            <FormattedDate date={log.createdAt} />
                          </td>
                          <td className="px-3 py-2">
                            <ExecLogItem
                              log={log}
                              workflowId={id!}
                              manualRebalance={workflow.manualRebalance}
                              tokens={
                                [
                                  workflow.tokens[0]?.token,
                                  workflow.cashToken,
                                ].filter(Boolean) as string[]
                              }
                              developerInstructions={workflow.agentInstructions}
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="md:hidden mb-2 space-y-2">
                {logData.items.map((log) => (
                  <div
                    key={log.id}
                    className="rounded border border-gray-200 bg-white p-3 shadow-sm"
                  >
                    <div className="mb-1 text-xs text-gray-500">
                      <FormattedDate date={log.createdAt} />
                    </div>
                    <ExecLogItem
                      log={log}
                      workflowId={id!}
                      manualRebalance={workflow.manualRebalance}
                      tokens={
                        [workflow.tokens[0]?.token, workflow.cashToken].filter(
                          Boolean,
                        ) as string[]
                      }
                      developerInstructions={workflow.agentInstructions}
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  disabled={logPage === 1}
                  onClick={() => setLogPage((p) => Math.max(p - 1, 1))}
                >
                  {t('prev')}
                </Button>
                <span>
                  Page {logData.page} of{' '}
                  {Math.ceil(logData.total / logData.pageSize)}
                </span>
                <Button
                  disabled={logData.page * logData.pageSize >= logData.total}
                  onClick={() => setLogPage((p) => p + 1)}
                >
                  {t('next')}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
      <WorkflowUpdateModal
        workflow={workflow}
        open={showUpdate}
        onClose={() => setShowUpdate(false)}
        onUpdated={() =>
          queryClient.invalidateQueries({
            queryKey: ['workflow', id, user?.id],
          })
        }
      />
    </div>
  );
}
