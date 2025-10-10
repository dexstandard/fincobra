import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { UiSettingsContext, defaultUiSettings } from './ui-settings-context';
import type { UiSettings } from './ui-settings.types';

const STORAGE_KEY = 'ui-settings';

export function UiSettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<UiSettings>(() => {
    if (typeof window === 'undefined') {
      return defaultUiSettings;
    }
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return defaultUiSettings;
      }
      const parsed = JSON.parse(raw) as UiSettings;
      return {
        ...defaultUiSettings,
        ...parsed,
        navigation: {
          ...defaultUiSettings.navigation,
          ...parsed.navigation,
        },
      } satisfies UiSettings;
    } catch {
      return defaultUiSettings;
    }
  });

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }, [settings]);

  const updateSettings = useCallback((next: UiSettings) => {
    setSettings({
      ...defaultUiSettings,
      ...next,
      navigation: {
        ...defaultUiSettings.navigation,
        ...next.navigation,
      },
    });
  }, []);

  const toggleNavigationItem = useCallback<
    (item: keyof UiSettings['navigation'], enabled: boolean) => void
  >((item, enabled) => {
    setSettings((prev) => ({
      ...prev,
      navigation: {
        ...prev.navigation,
        [item]: enabled,
      },
    }));
  }, []);

  const value = useMemo(
    () => ({ settings, updateSettings, toggleNavigationItem }),
    [settings, updateSettings, toggleNavigationItem],
  );

  return (
    <UiSettingsContext.Provider value={value}>
      {children}
    </UiSettingsContext.Provider>
  );
}
