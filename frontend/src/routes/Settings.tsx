import { useEffect, useState, type FormEvent } from 'react';
import axios from 'axios';
import { Copy } from 'lucide-react';
import api from '../lib/axios';
import { useUser } from '../lib/useUser';
import Button from '../components/ui/Button';
import { useToast } from '../lib/useToast';
import { useTranslation, useLanguage, type Lang } from '../lib/i18n';

export default function Settings() {
  const { user } = useUser();
  const toast = useToast();
  const t = useTranslation();
  const { lang, setLang } = useLanguage();
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [setup, setSetup] = useState<{
    secret: string;
    otpauthUrl: string;
    qr: string;
  } | null>(null);
  const [code, setCode] = useState('');
  const [loadingSetup, setLoadingSetup] = useState(false);
  const [loadingEnable, setLoadingEnable] = useState(false);
  const [loadingDisable, setLoadingDisable] = useState(false);

  useEffect(() => {
    if (!user) return;
    api.get('/2fa/status').then((res) => setEnabled(res.data.enabled));
  }, [user]);

  if (!user) return <p>{t('please_log_in')}</p>;
  if (enabled === null) return <p>{t('loading')}</p>;

  const startSetup = async () => {
    setLoadingSetup(true);
    try {
      const res = await api.get('/2fa/setup');
      setSetup(res.data);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.response?.data?.error) {
          toast.show(err.response.data.error);
        } else if (err.response?.status === 429) {
          toast.show(t('too_many_requests'));
        } else {
          toast.show(t('failed_start_2fa_setup'));
        }
      } else {
        toast.show(t('failed_start_2fa_setup'));
      }
    } finally {
      setLoadingSetup(false);
    }
  };

  const enable = async (e: FormEvent) => {
    e.preventDefault();
    if (!setup) return;
    setLoadingEnable(true);
    try {
      await api.post('/2fa/enable', { token: code, secret: setup.secret });
      setEnabled(true);
      setSetup(null);
      setCode('');
      toast.show(t('twofa_enabled_success'), 'success');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.response?.data?.error) {
          toast.show(err.response.data.error);
        } else if (err.response?.status === 429) {
          toast.show(t('too_many_requests'));
        } else {
          toast.show(t('failed_enable_2fa'));
        }
      } else {
        toast.show(t('failed_enable_2fa'));
      }
    } finally {
      setLoadingEnable(false);
    }
  };

  const disable = async (e: FormEvent) => {
    e.preventDefault();
    setLoadingDisable(true);
    try {
      await api.post('/2fa/disable', { token: code });
      setEnabled(false);
      setCode('');
      toast.show(t('twofa_disabled_success'), 'success');
    } catch (err) {
      if (axios.isAxiosError(err)) {
        if (err.response?.data?.error) {
          toast.show(err.response.data.error);
        } else if (err.response?.status === 429) {
          toast.show(t('too_many_requests'));
        } else {
          toast.show(t('failed_disable_2fa'));
        }
      } else {
        toast.show(t('failed_disable_2fa'));
      }
    } finally {
      setLoadingDisable(false);
    }
  };

  return (
    <div className="space-y-4 max-w-md">
      <h2 className="text-xl font-bold">{t('settings')}</h2>
      {enabled ? (
        <form onSubmit={disable} className="space-y-2">
          <p>{t('twofa_enabled')}</p>
          <input
            className="border p-1 w-40"
            placeholder={t('code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" loading={loadingDisable}>
            {t('disable')}
          </Button>
        </form>
      ) : setup ? (
        <form onSubmit={enable} className="space-y-2">
          <p>{t('scan_qr_prompt')}</p>
          <img src={setup.qr} alt="QR code" className="w-40 h-40" />
          <div className="flex items-center gap-2 text-sm">
            <span className="break-all">
              {t('secret')}: <span className="font-mono">{setup.secret}</span>
            </span>
            <button
              type="button"
              className="p-1 border rounded"
              onClick={() => {
                navigator.clipboard.writeText(setup.secret);
                toast.show(t('copied'), 'success');
              }}
              aria-label={t('copy_secret')}
            >
              <Copy className="w-4 h-4" />
            </button>
          </div>
          <input
            className="border p-1 w-40"
            placeholder={t('code')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <Button type="submit" loading={loadingEnable}>
            {t('enable')}
          </Button>
        </form>
      ) : (
        <Button onClick={startSetup} loading={loadingSetup}>
          {t('setup_2fa')}
        </Button>
      )}
      <div className="space-y-1">
        <label htmlFor="lang" className="block text-sm">
          {t('language')}
        </label>
        <select
          id="lang"
          value={lang}
          onChange={(e) => setLang(e.target.value as Lang)}
          className="border p-1 w-40"
        >
          <option value="en">EN</option>
          <option value="ru">RU</option>
        </select>
      </div>
    </div>
  );
}
