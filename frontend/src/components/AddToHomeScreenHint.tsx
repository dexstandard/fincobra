import { useEffect, useState } from 'react';
import { Share } from 'lucide-react';
import { useTranslation } from '../lib/i18n';

interface AddToHomeScreenHintProps {
  isLoggedIn: boolean;
}

function isIosDevice(): boolean {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return false;
  }
  const { userAgent, platform, maxTouchPoints } = window.navigator;
  const normalizedUserAgent = userAgent.toLowerCase();

  if (/iphone|ipad|ipod/.test(normalizedUserAgent)) {
    return true;
  }

  return platform === 'MacIntel' && Number(maxTouchPoints) > 1;
}

function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const matchMediaStandalone =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(display-mode: standalone)').matches;
  const navigatorStandalone =
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  return Boolean(matchMediaStandalone || navigatorStandalone);
}

export default function AddToHomeScreenHint({
  isLoggedIn,
}: AddToHomeScreenHintProps) {
  const [isVisible, setIsVisible] = useState(false);
  const t = useTranslation();

  useEffect(() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
      return;
    }

    const mediaQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 767px)')
        : undefined;
    const displayModeQuery =
      typeof window.matchMedia === 'function'
        ? window.matchMedia('(display-mode: standalone)')
        : undefined;

    const updateVisibility = () => {
      if (isLoggedIn) {
        setIsVisible(false);
        return;
      }

      const isMobile = mediaQuery?.matches ?? window.innerWidth <= 767;
      setIsVisible(isIosDevice() && isMobile && !isStandaloneMode());
    };

    updateVisibility();

    const handleChange = () => updateVisibility();

    if (mediaQuery) {
      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange);
      } else if (typeof mediaQuery.addListener === 'function') {
        mediaQuery.addListener(handleChange);
      }
    }

    if (displayModeQuery) {
      if (typeof displayModeQuery.addEventListener === 'function') {
        displayModeQuery.addEventListener('change', handleChange);
      } else if (typeof displayModeQuery.addListener === 'function') {
        displayModeQuery.addListener(handleChange);
      }
    }

    window.addEventListener('resize', handleChange);

    return () => {
      if (mediaQuery) {
        if (typeof mediaQuery.removeEventListener === 'function') {
          mediaQuery.removeEventListener('change', handleChange);
        } else if (typeof mediaQuery.removeListener === 'function') {
          mediaQuery.removeListener(handleChange);
        }
      }

      if (displayModeQuery) {
        if (typeof displayModeQuery.removeEventListener === 'function') {
          displayModeQuery.removeEventListener('change', handleChange);
        } else if (typeof displayModeQuery.removeListener === 'function') {
          displayModeQuery.removeListener(handleChange);
        }
      }

      window.removeEventListener('resize', handleChange);
    };
  }, [isLoggedIn]);

  if (!isVisible) {
    return null;
  }

  return (
    <div className="md:hidden bg-blue-50 border border-blue-100 text-blue-900 rounded-lg p-3 mb-4 flex items-start gap-3">
      <Share className="w-5 h-5 mt-1 flex-shrink-0" />
      <div>
        <p className="font-semibold">{t('ios_add_to_home_screen_title')}</p>
        <p className="text-sm mt-1">{t('ios_add_to_home_screen_instructions')}</p>
      </div>
    </div>
  );
}
