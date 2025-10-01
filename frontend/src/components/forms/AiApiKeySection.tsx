import { type ReactNode } from 'react';
import ApiKeySection from './ApiKeySection';
import { useTranslation } from '../../lib/i18n';

export default function AiApiKeySection({
  label,
  allowShare = false,
}: {
  label: ReactNode;
  allowShare?: boolean;
}) {
  const t = useTranslation();
  const aiFields = [{ name: 'key', placeholder: t('api_key') }];
  return (
    <ApiKeySection
      label={label}
      queryKey="ai-key"
      getKeyPath={(id) => `/users/${id}/ai-key`}
      sharePath={allowShare ? (id) => `/users/${id}/ai-key/share` : undefined}
      fields={aiFields}
      videoGuideUrl="https://www.youtube.com/watch?v=WjVf80HUvYg"
    />
  );
}
