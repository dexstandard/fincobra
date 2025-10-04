import { Link, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import axios from '../../lib/axios';
import GoogleLoginButton from '../GoogleLoginButton';
import {
  Bot,
  Key,
  Settings as SettingsIcon,
  Users as UsersIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useUser } from '../../lib/useUser';
import { useState } from 'react';
import { useTranslation } from '../../lib/i18n';

function ApiStatus() {
  const { isSuccess } = useQuery({
    queryKey: ['api-status'],
    queryFn: () => axios.get('/health'),
  });
  const t = useTranslation();

  return (
    <span className="text-sm">
      API: {isSuccess ? t('online') : t('offline')}
    </span>
  );
}

export default function AppShell() {
  const { user } = useUser();
  const [navCollapsed, setNavCollapsed] = useState(true);
  const t = useTranslation();
  return (
    <div className="h-screen flex flex-col">
      <header className="fixed top-0 left-0 right-0 bg-gray-800 text-white p-4 flex justify-between z-10">
        <Link to="/" className="font-bold flex items-center gap-2">
          <img
            src="/logo-min.svg"
            alt="FinCobra"
            className="h-8 w-8"
          />
          <span className="hidden sm:inline">FinCobra</span>
        </Link>
        <div className="flex items-center gap-4">
          <span className="hidden md:inline">
            <ApiStatus />
          </span>
          <GoogleLoginButton />
        </div>
      </header>
      <div className="flex flex-1 pt-16 pb-24 md:pb-8 overflow-hidden">
        <nav
          className={`${navCollapsed ? 'w-20' : 'w-32'} bg-gray-100 p-4 transition-all duration-300 hidden md:flex md:flex-col`}
        >
          <div
            className={`flex flex-col flex-1 overflow-y-auto ${
              navCollapsed ? 'gap-3' : 'gap-2'
            }`}
          >
            <Link
              to="/"
              className={`flex items-center text-gray-700 hover:text-gray-900 ${
                navCollapsed ? 'justify-center' : 'gap-2'
              }`}
              title={navCollapsed ? t('workflows') : undefined}
            >
              <Bot className={`${navCollapsed ? 'w-6 h-6' : 'w-4 h-4'}`} />
              {!navCollapsed && t('workflows')}
            </Link>
            <Link
              to="/keys"
              className={`flex items-center text-gray-700 hover:text-gray-900 ${
                navCollapsed ? 'justify-center' : 'gap-2'
              }`}
              title={navCollapsed ? t('keys') : undefined}
            >
              <Key className={`${navCollapsed ? 'w-6 h-6' : 'w-4 h-4'}`} />
              {!navCollapsed && t('keys')}
            </Link>
            <Link
              to="/settings"
              className={`flex items-center text-gray-700 hover:text-gray-900 ${
                navCollapsed ? 'justify-center' : 'gap-2'
              }`}
              title={navCollapsed ? t('settings') : undefined}
            >
              <SettingsIcon
                className={`${navCollapsed ? 'w-6 h-6' : 'w-4 h-4'}`}
              />
              {!navCollapsed && t('settings')}
            </Link>
            {user?.role === 'admin' && (
              <Link
                to="/users"
                className={`flex items-center text-gray-700 hover:text-gray-900 ${
                  navCollapsed ? 'justify-center' : 'gap-2'
                }`}
                title={navCollapsed ? t('users') : undefined}
              >
                <UsersIcon
                  className={`${navCollapsed ? 'w-6 h-6' : 'w-4 h-4'}`}
                />
                {!navCollapsed && t('users')}
              </Link>
            )}
          </div>
          <button
            onClick={() => setNavCollapsed(!navCollapsed)}
            className={`mt-4 text-gray-700 hover:text-gray-900 ${
              navCollapsed ? 'flex justify-center w-full' : ''
            }`}
          >
            {navCollapsed ? (
              <ChevronRight className="w-6 h-6" />
            ) : (
              <ChevronLeft className="w-4 h-4" />
            )}
          </button>
        </nav>
        <main className="flex-1 p-3 pt-0 bg-white overflow-y-auto">
          <Outlet />
        </main>
      </div>
      <footer className="hidden md:block fixed bottom-0 left-0 right-0 bg-gray-100 text-xs text-center py-1 border-t">
        <Link to="/terms" className="mx-2 hover:text-gray-900">
          {t('terms')}
        </Link>
        <Link to="/privacy" className="mx-2 hover:text-gray-900">
          {t('privacy')}
        </Link>
      </footer>
      <nav
        className="md:hidden fixed bottom-0 left-0 right-0 bg-gray-100 border-t flex justify-around pt-3 pb-8"
        style={{ paddingBottom: 'calc(2rem + env(safe-area-inset-bottom))' }}
      >
        <Link
          to="/settings"
          className="text-gray-700 hover:text-gray-900"
          aria-label={t('settings')}
        >
          <SettingsIcon className="w-6 h-6" />
        </Link>
        <Link
          to="/"
          className="text-gray-700 hover:text-gray-900"
          aria-label={t('workflows')}
        >
          <Bot className="w-6 h-6" />
        </Link>
        <Link
          to="/keys"
          className="text-gray-700 hover:text-gray-900"
          aria-label={t('keys')}
        >
          <Key className="w-6 h-6" />
        </Link>
      </nav>
    </div>
  );
}
