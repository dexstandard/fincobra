import { type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../lib/axios';
import ApiKeySection from './ApiKeySection';
import { useTranslation } from '../../lib/i18n';

const videoGuideLinks: Record<string, string | undefined> = {
  binance: 'https://youtu.be/2NLF6eV2xhk?t=20',
};

interface Props {
  exchange: string;
  label: ReactNode;
}

export default function ExchangeApiKeySection({ exchange, label }: Props) {
  const t = useTranslation();
  const supportsWhitelist = exchange === 'binance' || exchange === 'bybit';
  const capabilityCopy =
    exchange === 'binance'
      ? t('binance_capabilities')
      : t('bybit_capabilities');
  const modeLabel =
    exchange === 'binance' ? t('spot_trading') : t('futures_trading');
  const exchangeFields = [
    {
      name: 'key',
      placeholder: t('api_key'),
      minLength: exchange === 'binance' ? 64 : 18,
    },
    {
      name: 'secret',
      placeholder: t('api_secret'),
      minLength: exchange === 'binance' ? 64 : 32,
    },
  ];
  const commonProps = {
    label,
    queryKey: `${exchange}-key`,
    getKeyPath: (id: string) => `/users/${id}/${exchange}-key`,
    fields: exchangeFields,
    videoGuideUrl: videoGuideLinks[exchange],
  } as const;

  const whitelistQuery = useQuery<string>({
    queryKey: ['output-ip'],
    enabled: supportsWhitelist,
    queryFn: async () => {
      const res = await api.get('/ip');
      return (res.data as { ip: string }).ip;
    },
  });

  const headerLabel = (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span>{label}</span>
        <span className="uppercase tracking-wide text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-200 text-slate-800">
          {modeLabel}
        </span>
      </div>
      <p className="mt-1 text-sm text-gray-600">{capabilityCopy}</p>
    </div>
  );

  return supportsWhitelist ? (
    <ApiKeySection
      {...commonProps}
      label={headerLabel}
      whitelistHost={whitelistQuery.data}
    />
  ) : (
    <ApiKeySection {...commonProps} label={headerLabel} />
  );
}
