import { ROUTES } from '../constants/routes';

/**
 * Safely executes navigation.goBack() if possible;
 * otherwise navigates to a fallback route to avoid 'GO_BACK' not handled errors.
 * 
 * @param {object} navigation - React Navigation navigation object
 * @param {string} fallbackRoute - Route to navigate to if canGoBack is false
 * @param {object} fallbackParams - Optional parameters for fallback route
 */
export const safeGoBack = (navigation, fallbackRoute = ROUTES.MAIN_TABS, fallbackParams = undefined) => {
  if (!navigation) return;
  if (typeof navigation.canGoBack === 'function' && navigation.canGoBack()) {
    navigation.goBack();
  } else if (fallbackRoute) {
    if (fallbackParams) {
      navigation.navigate(fallbackRoute, fallbackParams);
    } else {
      navigation.navigate(fallbackRoute);
    }
  }
};
