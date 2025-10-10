import { useContext } from 'react';
import { UiSettingsContext } from './ui-settings-context';

export function useUiSettings() {
  return useContext(UiSettingsContext);
}
