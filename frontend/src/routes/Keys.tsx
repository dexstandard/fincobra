import { useUser } from '../lib/useUser';
import AiApiKeySection from '../components/forms/AiApiKeySection';
import SharedAiApiKeySection from '../components/forms/SharedAiApiKeySection';
import ExchangeApiKeySection from '../components/forms/ExchangeApiKeySection';
import { useTranslation } from '../lib/i18n';

export default function Keys() {
  const { user } = useUser();
  const t = useTranslation();
  if (!user) return <p>{t('please_log_in')}</p>;
  return (
    <div className="space-y-8 max-w-md">
      <div className="p-3 bg-blue-100 border border-blue-200 text-sm text-blue-900 rounded">
        {t('api_keys_notice')}
      </div>
      <AiApiKeySection label={t('openai_api_key')} allowShare />
      <SharedAiApiKeySection label={t('openai_api_key_shared')} />
      <ExchangeApiKeySection
        exchange="binance"
        label={t('binance_api_credentials')}
      />
      <ExchangeApiKeySection
        exchange="bybit"
        label={t('bybit_api_credentials')}
      />
    </div>
  );
}
