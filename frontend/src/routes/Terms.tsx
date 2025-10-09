import { useTranslation } from '../lib/i18n';

export default function Terms() {
  const t = useTranslation();
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h2 className="text-xl font-bold">{t('terms_title')}</h2>
      <p>{t('terms_intro')}</p>
      <p>{t('terms_disclaimer')}</p>
      <p>{t('terms_access')}</p>
      <p>{t('terms_safety_heading')}</p>
      <ul className="list-disc pl-5 space-y-1">
        <li>{t('terms_safety_item_enable_2fa')}</li>
        <li>{t('terms_safety_item_no_withdrawals')}</li>
        <li>{t('terms_safety_item_openai_billing')}</li>
      </ul>
      <p>{t('terms_free_stage')}</p>
      <p>{t('terms_responsible_use')}</p>
    </div>
  );
}
