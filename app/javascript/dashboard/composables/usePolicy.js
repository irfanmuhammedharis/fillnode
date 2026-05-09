import { unref } from 'vue';
import { useMapGetter } from 'dashboard/composables/store';
import { useAccount } from 'dashboard/composables/useAccount';
import {
  getUserPermissions,
  hasPermissions,
} from 'dashboard/helper/permissionsHelper';

export function usePolicy() {
  const user = useMapGetter('getCurrentUser');
  const isFeatureEnabled = useMapGetter('accounts/isFeatureEnabledonAccount');
  const { accountId } = useAccount();

  const getUserPermissionsForAccount = () => {
    return getUserPermissions(user.value, accountId.value);
  };

  const isFeatureFlagEnabled = featureFlag => {
    if (!featureFlag) return true;
    return isFeatureEnabled.value(accountId.value, featureFlag);
  };

  const checkPermissions = requiredPermissions => {
    if (!requiredPermissions || !requiredPermissions.length) return true;
    const userPermissions = getUserPermissionsForAccount();
    return hasPermissions(requiredPermissions, userPermissions);
  };

  const shouldShow = (featureFlag, permissions, _installationTypes) => {
    const flag = unref(featureFlag);
    const perms = unref(permissions);

    if (!checkPermissions(perms)) return false;

    return isFeatureFlagEnabled(flag);
  };

  const shouldShowPaywall = _featureFlag => {
    return false;
  };

  return {
    checkPermissions,
    shouldShowPaywall,
    isFeatureFlagEnabled,
    shouldShow,
  };
}
