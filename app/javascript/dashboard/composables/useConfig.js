export function useConfig() {
  const config = window.fillnodeConfig || {};

  const hostURL = config.hostURL;
  const vapidPublicKey = config.vapidPublicKey;
  const enabledLanguages = config.enabledLanguages;
  const isEnterprise = false;
  const enterprisePlanName = 'community';

  return {
    hostURL,
    vapidPublicKey,
    enabledLanguages,
    isEnterprise,
    enterprisePlanName,
  };
}
