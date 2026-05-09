/**
 * Composable for branding-related utilities
 * Provides methods to customize text with installation-specific branding
 */
import { useMapGetter } from 'dashboard/composables/store.js';

export function useBranding() {
  const globalConfig = useMapGetter('globalConfig/get');

  const replaceInstallationName = text => {
    if (!text) return text;

    const installationName = globalConfig.value?.installationName;
    if (!installationName) return text;

    return text.replace(/Fillnode/g, installationName);
  };

  return {
    replaceInstallationName,
  };
}
