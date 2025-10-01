import { useEffect, useRef, useState } from 'react';
import { LogOut } from 'lucide-react';
import axios from 'axios';
import api from '../lib/axios';
import { useUser } from '../lib/useUser';
import Button from './ui/Button';
import Modal from './ui/Modal';
import TextInput from './forms/TextInput';
import { useToast } from '../lib/useToast';
import { useTranslation } from '../lib/i18n';

type CredentialResponse = { credential: string };

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (options: {
            client_id: string;
            callback: (resp: CredentialResponse) => void;
          }) => void;
          renderButton: (
            elem: HTMLElement,
            options: { theme: string; size: string; text: string },
          ) => void;
          disableAutoSelect?: () => void;
        };
      };
    };
  }
}

export default function GoogleLoginButton() {
  const btnRef = useRef<HTMLDivElement>(null);
  const { user, setUser } = useUser();
  const toast = useToast();
  const t = useTranslation();
  const [otpOpen, setOtpOpen] = useState(false);
  const [otp, setOtp] = useState('');
  const [pendingCred, setPendingCred] = useState<string | null>(null);
  const [csrf, setCsrf] = useState('');

  useEffect(() => {
    api.get('/login/csrf').then((res) => setCsrf(res.data.csrfToken));
  }, []);

  useEffect(() => {
    if (!btnRef.current || user) return;

    const initialize = () => {
      const google = window.google;
      if (!google || !btnRef.current) return;

      google.accounts.id.initialize({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        callback: async (resp: CredentialResponse) => {
          try {
            await api.post(
              '/login',
              { token: resp.credential },
              { headers: { 'x-csrf-token': csrf } },
            );
            const session = await api.get('/login/session');
            setUser(session.data);
            if (btnRef.current) btnRef.current.innerHTML = '';
          } catch (err: unknown) {
            if (
              axios.isAxiosError(err) &&
              err.response?.data?.error === 'otp required'
            ) {
              setPendingCred(resp.credential);
              setOtpOpen(true);
            } else {
              toast.show(t('login_failed'));
            }
          }
        },
      });
      google.accounts.id.renderButton(btnRef.current, {
        theme: 'outline',
        size: 'small',
        text: 'signin',
      });
    };

    if (window.google) {
      initialize();
    } else {
      const script = document.querySelector<HTMLScriptElement>(
        'script[src="https://accounts.google.com/gsi/client"]',
      );
      script?.addEventListener('load', initialize);
      return () => script?.removeEventListener('load', initialize);
    }
  }, [user, setUser, csrf, toast, t]);

  if (user) {
    const email = user.email ?? '';
    return (
      <div className="h-5 flex items-center text-sm gap-2">
        <span className="hidden md:inline">{email}</span>
        <span className="md:hidden">{email.split('@')[0]}</span>
        <Button
          type="button"
          variant="link"
          className="text-xs flex items-center gap-1"
          onClick={() => {
            const google = window.google;
            google?.accounts.id.disableAutoSelect?.();
            setUser(null);
          }}
        >
          <LogOut className="w-4 h-4" />
        </Button>
      </div>
    );
  }
  return (
    <>
      <div ref={btnRef} className="h-5 capitalize" />
      <Modal
        open={otpOpen}
        onClose={() => {
          setOtpOpen(false);
          setOtp('');
          setPendingCred(null);
        }}
      >
        <h2 className="text-lg font-bold mb-2">{t('enter_2fa_code')}</h2>
        <TextInput
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          className="mb-4"
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              setOtpOpen(false);
              setOtp('');
              setPendingCred(null);
            }}
          >
            {t('cancel')}
          </Button>
          <Button
            onClick={async () => {
              if (!pendingCred) return;
              try {
                const res2 = await api.post(
                  '/login',
                  {
                    token: pendingCred,
                    otp,
                  },
                  { headers: { 'x-csrf-token': csrf } },
                );
                setUser(res2.data);
                if (btnRef.current) btnRef.current.innerHTML = '';
                setOtp('');
                setPendingCred(null);
                setOtpOpen(false);
              } catch (err) {
                if (axios.isAxiosError(err) && err.response?.data?.error) {
                  toast.show(err.response.data.error);
                } else {
                  toast.show(t('login_failed'));
                }
              }
            }}
          >
            {t('confirm')}
          </Button>
        </div>
      </Modal>
    </>
  );
}
