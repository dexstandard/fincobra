import { createContext } from 'react';
import type { UiSettings } from './ui-settings.types';

export const defaultUiSettings: UiSettings = {
  navigation: {
    cryptoDashboard: false,
  },
};

interface UiSettingsContextValue {
  settings: UiSettings;
  updateSettings: (next: UiSettings) => void;
  toggleNavigationItem: <T extends keyof UiSettings['navigation']>(
    item: T,
    enabled: UiSettings['navigation'][T],
  ) => void;
}

export const UiSettingsContext = createContext<UiSettingsContextValue>({
  settings: defaultUiSettings,
  updateSettings: () => {},
  toggleNavigationItem: () => {},
});
