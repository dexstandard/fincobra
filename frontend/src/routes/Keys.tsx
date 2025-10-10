import { useUser } from '../lib/useUser';
import AiApiKeySection from '../components/forms/AiApiKeySection';
import SharedAiApiKeySection from '../components/forms/SharedAiApiKeySection';
import ExchangeApiKeySection from '../components/forms/ExchangeApiKeySection';
import { useTranslation } from '../lib/i18n';
import GroqApiKeySection from '../components/forms/GroqApiKeySection';

export default function Keys() {
  const { user } = useUser();
  const t = useTranslation();
  if (!user) return <p>{t('please_log_in')}</p>;
  return (
    <div className="space-y-10 max-w-2xl">
      <div className="p-3 bg-blue-100 border border-blue-200 text-sm text-blue-900 rounded">
        {t('api_keys_notice')}
      </div>
      <section className="space-y-6">
        <div className="border-b border-gray-200 pb-2">
          <h2 className="text-lg font-semibold text-gray-900">
            {t('ai_api_keys_heading')}
          </h2>
        </div>
        <div className="space-y-6">
          <AiApiKeySection label={t('openai_api_key')} allowShare />
          <GroqApiKeySection label={t('groq_api_key')} />
          <SharedAiApiKeySection label={t('openai_api_key_shared')} />
        </div>
      </section>
      <section className="space-y-6 border-t border-gray-200 pt-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            {t('exchange_api_keys_heading')}
          </h2>
        </div>
        <div className="space-y-6">
          <ExchangeApiKeySection
            exchange="binance"
            label={t('binance_api_credentials')}
          />
          <ExchangeApiKeySection
            exchange="bybit"
            label={t('bybit_api_credentials')}
          />
        </div>
      </section>
    </div>
  );
}
