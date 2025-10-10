import { type ReactNode } from 'react';
import ApiKeySection from './ApiKeySection';
import { useTranslation } from '../../lib/i18n';

export default function GroqApiKeySection({
  label,
}: {
  label: ReactNode;
}) {
  const t = useTranslation();
  return (
    <ApiKeySection
      label={label}
      queryKey="groq-key"
      getKeyPath={(id) => `/users/${id}/groq-key`}
      fields={[{ name: 'key', placeholder: t('api_key') }]}
    />
  );
}
