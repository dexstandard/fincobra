import { useTranslation } from '../lib/i18n';

export default function Terms() {
  const t = useTranslation();
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <h2 className="text-xl font-bold">{t('terms_title')}</h2>
      <p>{t('terms_p1')}</p>
      <p>
        {t('terms_p2')}
        <a
          href="https://github.com/dexstandard/fincobra"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline"
        >
          {t('terms_link')}
        </a>
        .
      </p>
      <p>{t('terms_p3')}</p>
    </div>
  );
}

