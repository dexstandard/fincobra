import {
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from 'react';

import { useQueries } from '@tanstack/react-query';
import axios from 'axios';
import { useUser } from '../../lib/useUser';
import api from '../../lib/axios';
import SelectInput from './SelectInput';
import AiApiKeySection from './AiApiKeySection';
import ExchangeApiKeySection from './ExchangeApiKeySection';
import GroqApiKeySection from './GroqApiKeySection';
import type {
  AiProvider,
  ExchangeProvider,
} from './ApiKeyProviderSelector.types';

interface ProviderConfig<TValue extends string> {
  value: TValue;
  label: string;
  queryKey: string;
  getKeyPath: (id: string) => string;
  renderForm: () => ReactElement;
}

const aiBaseConfigs: ProviderConfig<AiProvider>[] = [
  {
    value: 'openai',
    label: 'OpenAI',
    queryKey: 'ai-key',
    getKeyPath: (id) => `/users/${id}/ai-key`,
    renderForm: () => <AiApiKeySection label="OpenAI API Key" />,
  },
  {
    value: 'groq',
    label: 'Groq',
    queryKey: 'groq-key',
    getKeyPath: (id) => `/users/${id}/groq-key`,
    renderForm: () => <GroqApiKeySection label="Groq API Key" />,
  },
];

const exchangeConfigs: ProviderConfig<ExchangeProvider>[] = [
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

interface AiProps {
  type: 'ai';
  label: string;
  value: AiProvider;
  onChange: Dispatch<SetStateAction<AiProvider>>;
}

interface ExchangeProps {
  type: 'exchange';
  label: string;
  value: ExchangeProvider;
  onChange: Dispatch<SetStateAction<ExchangeProvider>>;
}

type Props = AiProps | ExchangeProps;

export default function ApiKeyProviderSelector(props: Props) {
  const { user } = useUser();

  if (!user) return null;

  if (props.type === 'ai') {
    return (
      <ProviderSelector
        type="ai"
        label={props.label}
        value={props.value}
        onChange={props.onChange}
        configs={aiBaseConfigs}
        userId={user.id}
      />
    );
  }

  return (
    <ProviderSelector
      type="exchange"
      label={props.label}
      value={props.value}
      onChange={props.onChange}
      configs={exchangeConfigs}
      userId={user.id}
    />
  );
}

interface ProviderSelectorProps<TValue extends string> {
  type: 'ai' | 'exchange';
  label: string;
  value: TValue;
  onChange: Dispatch<SetStateAction<TValue>>;
  configs: ProviderConfig<TValue>[];
  userId: string;
}

function ProviderSelector<TValue extends string>({
  type,
  label,
  value,
  onChange,
  configs,
  userId,
}: ProviderSelectorProps<TValue>) {
  const queries = useQueries({
    queries: configs.map((cfg) => ({
      queryKey: [cfg.queryKey, userId],
      queryFn: async () => {
        try {
          const res = await api.get(cfg.getKeyPath(userId));
          return res.data.key as string;
        } catch (err) {
          if (axios.isAxiosError(err) && err.response?.status === 404)
            return null;
          throw err;
        }
      },
    })),
  });

  const queryFor = (val: TValue) => {
    const idx = configs.findIndex((c) => c.value === val);
    return queries[idx];
  };

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
            onChange={(next) => onChange(next as TValue)}
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
