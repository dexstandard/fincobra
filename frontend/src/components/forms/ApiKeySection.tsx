import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { useForm } from 'react-hook-form';
import { useQuery, useMutation } from '@tanstack/react-query';
import axios from 'axios';
import api from '../../lib/axios';
import { useUser } from '../../lib/useUser';
import { useToast } from '../../lib/useToast';
import Button from '../ui/Button';
import { Copy } from 'lucide-react';
import { useTranslation } from '../../lib/i18n';

interface Field {
  name: string;
  placeholder: string;
  minLength?: number;
}

interface ApiKeySectionProps {
  label?: ReactNode;
  queryKey: string;
  getKeyPath: (id: string) => string;
  fields: Field[];
  videoGuideUrl?: string;
  whitelistHost?: string;
  sharePath?: (id: string) => string;
}

const textSecurityStyle: CSSProperties & { WebkitTextSecurity: string } = {
  WebkitTextSecurity: 'disc',
};

export default function ApiKeySection({
  label,
  queryKey,
  getKeyPath,
  fields,
  videoGuideUrl,
  whitelistHost,
  sharePath,
}: ApiKeySectionProps) {
  const { user } = useUser();
  const toast = useToast();
  const t = useTranslation();
  const defaultValues = useMemo(
    () =>
      Object.fromEntries(fields.map((f) => [f.name, ''])) as Record<
        string,
        string
      >,
    [fields],
  );
  const form = useForm<Record<string, string>>({
    defaultValues,
    mode: 'onChange',
  });
  const id = user!.id;
  type KeyData = {
    [key: string]: string | boolean | undefined;
    shared?: boolean;
  };
  const query = useQuery<KeyData | null>({
    queryKey: [queryKey, id],
    enabled: !!user,
    queryFn: async () => {
      try {
        const res = await api.get(getKeyPath(id));
        return res.data as KeyData;
      } catch (err) {
        if (axios.isAxiosError(err) && err.response?.status === 404)
          return null;
        throw err;
      }
    },
  });

  useEffect(() => {
    const data = query.data
      ? fields.reduce(
          (acc, f) => ({
            ...acc,
            [f.name]: (query.data![f.name] as string | undefined) ?? '',
          }),
          {} as Record<string, string>,
        )
      : defaultValues;
    form.reset(data);
  }, [query.data, defaultValues, form, fields]);

  const [editing, setEditing] = useState(false);
  useEffect(() => {
    setEditing(!query.data);
  }, [query.data]);

  const saveMut = useMutation({
    mutationFn: async (vals: Record<string, string>) => {
      const method = query.data ? 'put' : 'post';
      const res = await api[method](getKeyPath(id), vals);
      return res.data as Record<string, string>;
    },
    onSuccess: () => {
      query.refetch();
      setEditing(false);
    },
    onError: (err) => {
      if (axios.isAxiosError(err)) {
        const errorMessage = err.response?.data?.error;
        if (errorMessage) {
          if (errorMessage === 'verification failed') {
            toast.show(t('key_verification_failed'), 'error');
          } else if (errorMessage.startsWith('verification failed:')) {
            const reason = errorMessage.slice('verification failed:'.length).trim();
            toast.show(
              reason
                ? `${t('key_verification_failed')}: ${reason}`
                : t('key_verification_failed'),
              'error',
            );
          } else {
            toast.show(errorMessage, 'error');
          }
          return;
        }
      }
      toast.show(t('failed_save_exchange_key'), 'error');
    },
  });

  const delMut = useMutation({
    mutationFn: async () => {
      await api.delete(getKeyPath(id));
    },
    onSuccess: () => query.refetch(),
  });

  const shareMut = useMutation({
    mutationFn: async ({ email, model }: { email: string; model: string }) => {
      await api.post(sharePath!(id), { email, model });
    },
  });

  const revokeMut = useMutation({
    mutationFn: async (email: string) => {
      await api.delete(sharePath!(id), { data: { email } });
    },
  });

  const onSubmit = form.handleSubmit((data) => saveMut.mutate(data));
  const saveDisabled = !form.formState.isValid || saveMut.isPending;
  const hasErrors = Object.keys(form.formState.errors).length > 0;

  return (
    <div className="space-y-2 w-full max-w-md">
      {label && <h2 className="text-md font-bold">{label}</h2>}
      {query.isLoading ? (
        <p>{t('loading')}</p>
      ) : editing ? (
        <div className="space-y-2">
          {fields.map((f) => (
            <input
              key={f.name}
              type="text"
              autoComplete="off"
              placeholder={f.placeholder}
              {...form.register(f.name, {
                required: true,
                minLength: f.minLength ?? 10,
              })}
              className="border rounded px-2 py-1 w-full"
              style={form.watch(f.name) ? textSecurityStyle : undefined}
              data-lpignore="true"
              data-1p-ignore="true"
            />
          ))}
          {videoGuideUrl && (
            <p className="text-sm text-gray-600 space-x-2">
              <a
                href={videoGuideUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline"
              >
                {t('video_guide')}
              </a>
            </p>
          )}
          {hasErrors && (
            <p className="text-sm text-red-600">
              {t('fields_required_min_length')}
            </p>
          )}
          <div className="flex gap-2">
            <Button
              type="button"
              onClick={onSubmit}
              disabled={saveDisabled}
              loading={saveMut.isPending}
            >
              {query.data ? t('update') : t('save')}
            </Button>
            {query.data && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  const data = fields.reduce(
                    (acc, f) => ({
                      ...acc,
                      [f.name]:
                        (query.data?.[f.name] as string | undefined) ?? '',
                    }),
                    {} as Record<string, string>,
                  );
                  form.reset(data);
                }}
                disabled={saveMut.isPending}
              >
                {t('cancel')}
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              value={
                query.data
                  ? ((query.data[fields[0].name] as string | undefined) ?? '')
                  : ''
              }
              disabled
              className="border rounded px-2 py-1 w-full"
              style={textSecurityStyle}
              data-lpignore="true"
              data-1p-ignore="true"
            />
            {!query.data?.shared && (
              <>
                <Button
                  type="button"
                  onClick={() => {
                    setEditing(true);
                    form.reset(defaultValues);
                  }}
                  disabled={delMut.isPending}
                >
                  {t('edit')}
                </Button>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() => {
                    if (window.confirm(t('delete_key_confirm'))) {
                      delMut.mutate();
                    }
                  }}
                  disabled={delMut.isPending}
                >
                  {t('delete')}
                </Button>
              </>
            )}
            {query.data?.shared && (
              <p className="text-sm text-gray-600 self-center">
                {t('shared_by_admin')}
              </p>
            )}
            {user?.role === 'admin' && sharePath && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    const email = window.prompt(t('enter_email_share'));
                    if (!email) return;
                    try {
                      const res = await api.get(`/users/${user!.id}/models`);
                      const models = res.data.models as string[];
                      const model = window.prompt(
                        `${t('select_model')}: ${models.join(', ')}`,
                      );
                      if (model && models.includes(model)) {
                        shareMut.mutate({ email, model });
                      }
                    } catch {
                      toast.show(t('failed_fetch_models'));
                    }
                  }}
                  disabled={
                    delMut.isPending ||
                    shareMut.isPending ||
                    revokeMut.isPending
                  }
                >
                  {t('share')}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => {
                    const email = window.prompt(t('enter_email_revoke'));
                    if (email) revokeMut.mutate(email);
                  }}
                  disabled={
                    delMut.isPending ||
                    shareMut.isPending ||
                    revokeMut.isPending
                  }
                >
                  {t('revoke')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
      {whitelistHost && (
        <div className="text-sm text-gray-600 sm:flex sm:items-center sm:gap-2">
          <span className="block sm:inline">{t('whitelist_ip')}</span>
          <span className="flex items-center gap-2">
            <span className="font-mono">{whitelistHost}</span>
            <button
              type="button"
              className="p-1 border rounded"
              onClick={() => {
                navigator.clipboard.writeText(whitelistHost);
                toast.show(t('copied'), 'success');
              }}
              aria-label={t('copy_ip')}
            >
              <Copy className="w-4 h-4" />
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
