import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { ROUTES } from '../constants/routes';

import SplashScreen from '../screens/Splash/SplashScreen';
import OnboardingScreen from '../screens/Onboarding/OnboardingScreen';
import LoginScreen from '../screens/Auth/LoginScreen';
import RegisterScreen from '../screens/Auth/RegisterScreen';
import OtpScreen from '../screens/Auth/OtpScreen';
import ForgotPasswordScreen from '../screens/Auth/ForgotPasswordScreen';

import MainTabNavigator from './MainTabNavigator';
import NotificationsScreen from '../screens/Notifications/NotificationsScreen';
import OutgoingCallScreen from '../screens/Call/OutgoingCallScreen';
import IncomingCallScreen from '../screens/Call/IncomingCallScreen';
import ActiveCallScreen from '../screens/Call/ActiveCallScreen';
import CallSummaryScreen from '../screens/Call/CallSummaryScreen';
import CallDetailsScreen from '../screens/Call/CallDetailsScreen';
import KeypadScreen from '../screens/Call/KeypadScreen';
import ContactsScreen from '../screens/Contacts/ContactsScreen';
import ReportScamScreen from '../screens/Call/ReportScamScreen';

import ProfileScreen from '../screens/Settings/ProfileScreen';
import SubscriptionScreen from '../screens/Settings/SubscriptionScreen';
import SecuritySettingsScreen from '../screens/Settings/SecuritySettingsScreen';
import HelpCenterScreen from '../screens/Settings/HelpCenterScreen';
import AboutScreen from '../screens/Settings/AboutScreen';
import ElderlyModeScreen from '../screens/Settings/ElderlyModeScreen';

import IncomingCallOverlay from '../components/IncomingCallOverlay';
import AppAlertModal from '../components/modals/AppAlertModal';

const Stack = createNativeStackNavigator();


const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: '#09090B',
    card: '#09090B',
    text: '#FFFFFF',
    border: 'rgba(255,255,255,0.08)',
    primary: '#3B82F6',
  },
};

export default function RootNavigator() {
  return (
    <NavigationContainer theme={navTheme}>
      <IncomingCallOverlay />
      <AppAlertModal />
      <Stack.Navigator

        initialRouteName={ROUTES.SPLASH}
        screenOptions={{
          headerShown: false,
          animation: 'fade',
          contentStyle: {
            backgroundColor: '#09090B',
          },
        }}
      >
        <Stack.Screen
          name={ROUTES.SPLASH}
          component={SplashScreen}
        />

        <Stack.Screen
          name={ROUTES.ONBOARDING}
          component={OnboardingScreen}
        />

        <Stack.Screen
          name={ROUTES.LOGIN}
          component={LoginScreen}
        />

        <Stack.Screen
          name={ROUTES.REGISTER}
          component={RegisterScreen}
        />

        <Stack.Screen
          name={ROUTES.OTP}
          component={OtpScreen}
        />

        <Stack.Screen
          name={ROUTES.FORGOT_PASSWORD}
          component={ForgotPasswordScreen}
        />

        <Stack.Screen
          name={ROUTES.MAIN_TABS}
          component={MainTabNavigator}
        />

        <Stack.Screen
          name={ROUTES.NOTIFICATIONS}
          component={NotificationsScreen}
        />

        <Stack.Screen
          name={ROUTES.OUTGOING_CALL}
          component={OutgoingCallScreen}
          options={{ animation: 'slide_from_bottom' }}
        />

        <Stack.Screen
          name={ROUTES.INCOMING_CALL}
          component={IncomingCallScreen}
          options={{ animation: 'slide_from_bottom' }}
        />

        <Stack.Screen
          name={ROUTES.ACTIVE_CALL}
          component={ActiveCallScreen}
          options={{ animation: 'fade' }}
        />

        <Stack.Screen
          name={ROUTES.CALL_SUMMARY}
          component={CallSummaryScreen}
        />

        <Stack.Screen
          name={ROUTES.CALL_DETAILS}
          component={CallDetailsScreen}
        />

        <Stack.Screen
          name={ROUTES.KEYPAD}
          component={KeypadScreen}
          options={{ animation: 'slide_from_bottom' }}
        />

        <Stack.Screen
          name={ROUTES.REPORT_SCAM}
          component={ReportScamScreen}
        />

        <Stack.Screen
          name={ROUTES.CONTACTS}
          component={ContactsScreen}
        />

        <Stack.Screen
          name={ROUTES.PROFILE}
          component={ProfileScreen}
        />

        <Stack.Screen
          name={ROUTES.SUBSCRIPTION}
          component={SubscriptionScreen}
        />

        <Stack.Screen
          name={ROUTES.SECURITY_SETTINGS}
          component={SecuritySettingsScreen}
        />

        <Stack.Screen
          name={ROUTES.HELP}
          component={HelpCenterScreen}
        />

        <Stack.Screen
          name={ROUTES.HELP_CENTER}
          component={HelpCenterScreen}
        />

        <Stack.Screen
          name={ROUTES.ABOUT}
          component={AboutScreen}
        />

        <Stack.Screen
          name={ROUTES.ELDERLY_MODE}
          component={ElderlyModeScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </NavigationContainer>

  );
}