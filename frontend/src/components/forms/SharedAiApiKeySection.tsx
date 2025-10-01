import { type ReactNode, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import api from '../../lib/axios';
import { useUser } from '../../lib/useUser';
import { useTranslation } from '../../lib/i18n';

const textSecurityStyle: CSSProperties & { WebkitTextSecurity: string } = {
  WebkitTextSecurity: 'disc',
};

export default function SharedAiApiKeySection({ label }: { label: ReactNode }) {
  const { user } = useUser();
  const t = useTranslation();
  const query = useQuery<{ key: string; model?: string } | null>({
    queryKey: ['ai-key-shared', user?.id],
    enabled: !!user,
    queryFn: async () => {
      try {
        const res = await api.get(`/users/${user!.id}/ai-key/shared`);
        return res.data as { key: string; model?: string };
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404)
          return null;
        throw err;
      }
    },
  });

  if (!user || !query.data) return null;

  return (
    <div className="space-y-2 w-full max-w-md">
      <h2 className="text-md font-bold">{label}</h2>
      <div className="flex gap-2">
        <input
          type="text"
          value={query.data.key}
          disabled
          className="border rounded px-2 py-1 w-full"
          style={textSecurityStyle}
          data-lpignore="true"
          data-1p-ignore="true"
        />
        <p className="text-sm text-gray-600 self-center">
          {t('shared_by_admin')}
          {query.data.model ? ` (${query.data.model})` : ''}
        </p>
      </div>
    </div>
  );
}
