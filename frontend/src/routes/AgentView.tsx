import { useParams } from 'react-router-dom';
import axios from 'axios';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useUser } from '../lib/useUser';
import { useAgentData } from '../lib/useAgentData';
import { useAgentActions } from '../lib/useAgentActions';
import api from '../lib/axios';
import Button from '../components/ui/Button';
import { useToast } from '../lib/useToast';
import AgentPreview from './AgentPreview';
import ExecLogItem, { type ExecLog } from '../components/ExecLogItem';
import FormattedDate from '../components/ui/FormattedDate';
import AgentUpdateModal from '../components/AgentUpdateModal';
import AgentDetailsDesktop from '../components/AgentDetailsDesktop';
import AgentDetailsMobile from '../components/AgentDetailsMobile';
import Toggle from '../components/ui/Toggle';
import { usePrerequisites } from '../lib/usePrerequisites';
import { useTranslation } from '../lib/i18n';

export default function AgentView() {
  const { id } = useParams();
  const { user } = useUser();
  const { data } = useAgentData(id);
  const { startMut, stopMut } = useAgentActions(id);
  const queryClient = useQueryClient();
  const toast = useToast();
  const { hasOpenAIKey, hasBinanceKey } = usePrerequisites([]);
  const t = useTranslation();

  const reviewMut = useMutation({
    mutationFn: async (agentId: string) => {
      await api.post(`/portfolio-workflows/${agentId}/review`);
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['agent-log', id] }),
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
    queryKey: ['agent-log', id, logPage, user?.id, onlyRebalance],
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

  if (!data) return <div className="p-4">{t('loading')}</div>;
  if (data.status === 'draft') return <AgentPreview draft={data} />;

    const isActive = data.status === 'active';
    return (
      <div className="p-4">
        <div className="hidden md:block">
          <AgentDetailsDesktop agent={data} />
        </div>
        <div className="md:hidden">
          <AgentDetailsMobile agent={data} />
        </div>
        {isActive ? (
          <div className="mt-4 flex gap-2">
            <Button onClick={() => setShowUpdate(true)}>{t('update_agent')}</Button>
            <Button
              disabled={stopMut.isPending}
              loading={stopMut.isPending}
              onClick={() => stopMut.mutate()}
            >
              {t('stop_agent')}
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
            <Button onClick={() => setShowUpdate(true)}>{t('update_agent')}</Button>
            {hasOpenAIKey && hasBinanceKey && (
              <Button
                disabled={startMut.isPending}
                loading={startMut.isPending}
                onClick={() => startMut.mutate()}
              >
                {t('start_agent')}
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
                    <table className="w-full mb-2 table-fixed hidden md:table">
                      <colgroup>
                        <col className="w-40" />
                        <col />
                      </colgroup>
                      <thead>
                        <tr>
                          <th className="text-left">{t('time')}</th>
                          <th className="text-left">{t('log')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {logData.items.map((log) => (
                          <tr key={log.id}>
                            <td className="align-top pr-2 whitespace-nowrap">
                              <FormattedDate date={log.createdAt} />
                            </td>
                            <td className="w-full">
                              <ExecLogItem
                                log={log}
                                agentId={id!}
                                manualRebalance={data.manualRebalance}
                                tokens={data.tokens.map((t) => t.token)}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div className="md:hidden mb-2">
                      {logData.items.map((log) => (
                        <div key={log.id} className="mb-2">
                          <div className="text-xs text-gray-500 mb-1">
                            <FormattedDate date={log.createdAt} />
                          </div>
                          <ExecLogItem
                            log={log}
                            agentId={id!}
                            manualRebalance={data.manualRebalance}
                            tokens={data.tokens.map((t) => t.token)}
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
        <AgentUpdateModal
          agent={data}
          open={showUpdate}
          onClose={() => setShowUpdate(false)}
          onUpdated={() =>
            queryClient.invalidateQueries({ queryKey: ['agent', id, user?.id] })
          }
        />
      </div>
  );
}

