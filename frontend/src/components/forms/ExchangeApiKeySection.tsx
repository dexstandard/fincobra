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
  const supportsBalances = exchange === 'binance';
  const supportsWhitelist = exchange === 'binance';
  const exchangeFields = [
    { name: 'key', placeholder: t('api_key') },
    { name: 'secret', placeholder: t('api_secret') },
  ];
  const commonProps = {
    label,
    queryKey: `${exchange}-key`,
    getKeyPath: (id: string) => `/users/${id}/${exchange}-key`,
    fields: exchangeFields,
    videoGuideUrl: videoGuideLinks[exchange],
    balanceQueryKey: supportsBalances ? `${exchange}-balance` : undefined,
    getBalancePath: supportsBalances
      ? (id: string) => `/users/${id}/${exchange}-balance`
      : undefined,
  } as const;

  const whitelistQuery = useQuery<string>({
    queryKey: ['output-ip'],
    enabled: supportsWhitelist,
    queryFn: async () => {
      const res = await api.get('/ip');
      return (res.data as { ip: string }).ip;
    },
  });

  return supportsWhitelist ? (
    <ApiKeySection {...commonProps} whitelistHost={whitelistQuery.data} />
  ) : (
    <ApiKeySection {...commonProps} />
  );
}
