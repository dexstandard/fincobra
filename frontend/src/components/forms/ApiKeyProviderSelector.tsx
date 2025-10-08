import { type ReactElement } from 'react';

import { useQueries } from '@tanstack/react-query';
import axios from 'axios';
import { useUser } from '../../lib/useUser';
import api from '../../lib/axios';
import SelectInput from './SelectInput';
import AiApiKeySection from './AiApiKeySection';
import ExchangeApiKeySection from './ExchangeApiKeySection';

interface ProviderConfig {
  value: string;
  label: string;
  queryKey: string;
  getKeyPath: (id: string) => string;
  renderForm: () => ReactElement;
}

const aiBaseConfigs: ProviderConfig[] = [
  {
    value: 'openai',
    label: 'OpenAI',
    queryKey: 'ai-key',
    getKeyPath: (id) => `/users/${id}/ai-key`,
    renderForm: () => <AiApiKeySection label="OpenAI API Key" />,
  },
  {
    value: 'openai-shared',
    label: 'OpenAI (Shared)',
    queryKey: 'ai-key-shared',
    getKeyPath: (id) => `/users/${id}/ai-key/shared`,
    renderForm: () => <></>,
  },
];

const exchangeConfigs: ProviderConfig[] = [
  {
    value: 'binance',
    label: 'Binance',
    queryKey: 'binance-key',
    getKeyPath: (id) => `/users/${id}/binance-key`,
    renderForm: () => (
      <ExchangeApiKeySection
        exchange="binance"
        label={
          <>
            Binance API <span className="hidden sm:inline">Credentials</span>
          </>
        }
      />
    ),
  },
  {
    value: 'bybit',
    label: 'Bybit',
    queryKey: 'bybit-key',
    getKeyPath: (id) => `/users/${id}/bybit-key`,
    renderForm: () => (
      <ExchangeApiKeySection
        exchange="bybit"
        label={
          <>
            Bybit API <span className="hidden sm:inline">Credentials</span>
          </>
        }
      />
    ),
  },
];

interface Props {
  type: 'ai' | 'exchange';
  label: string;
  value: string;
  onChange: (v: string) => void;
}

export default function ApiKeyProviderSelector({
  type,
  label,
  value,
  onChange,
}: Props) {
  const { user } = useUser();
  const baseConfigs = type === 'ai' ? aiBaseConfigs : exchangeConfigs;

  const queries = useQueries({
    queries: baseConfigs.map((cfg) => ({
      queryKey: [cfg.queryKey, user?.id],
      enabled: !!user,
      queryFn: async () => {
        try {
          const res = await api.get(cfg.getKeyPath(user!.id));
          return res.data.key as string;
        } catch (err) {
          if (axios.isAxiosError(err) && err.response?.status === 404)
            return null;
          throw err;
        }
      },
    })),
  });

  const configs =
    type === 'ai'
      ? aiBaseConfigs.filter(
          (cfg, i) => cfg.value !== 'openai-shared' || !!queries[i]?.data,
        )
      : exchangeConfigs;

  const queryFor = (val: string) => {
    const idx = baseConfigs.findIndex((c) => c.value === val);
    return queries[idx];
  };

  if (!user) return null;

  const selectedIndex = Math.max(
    configs.findIndex((c) => c.value === value),
    0,
  );
  const selectedConfig = configs[selectedIndex];
  const hasKey = !!queryFor(selectedConfig.value)?.data;

  return (
    <div>
      <h2 className="text-md font-bold">{label}</h2>
      {hasKey === false && configs.length === 1 ? (
        <div className="mt-2">{configs[0].renderForm()}</div>
      ) : (
        <>
          <SelectInput
            id={`${type}-provider`}
            value={value}
            onChange={onChange}
            options={configs.map((p) => ({ value: p.value, label: p.label }))}
          />
          {hasKey === false && (
            <div className="mt-2">{selectedConfig.renderForm()}</div>
          )}
        </>
      )}
    </div>
  );
}
