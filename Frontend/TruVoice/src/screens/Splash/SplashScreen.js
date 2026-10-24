import { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import TruVoiceLogo from '../../components/common/TruVoiceLogo';
import ProgressBar from '../../components/common/ProgressBar';
import ScreenContainer from '../../components/layout/ScreenContainer';
import { ROUTES } from '../../constants/routes';
import { config } from '../../constants/config';
import { useAuthStore } from '../../store/authStore';

export default function SplashScreen() {
  const navigation = useNavigation();
  const hydrate = useAuthStore((s) => s.hydrate);
  const isHydrated = useAuthStore((s) => s.isHydrated);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const hasOnboarded = useAuthStore((s) => s.hasOnboarded);
  const [minElapsed, setMinElapsed] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setMinElapsed(true), config.splashDuration);
    hydrate();
    return () => clearTimeout(timer);
  }, [hydrate]);

  useEffect(() => {
    if (!minElapsed || !isHydrated) return;

    let nextRoute;
    if (isAuthenticated) {
      nextRoute = ROUTES.MAIN_TABS;
    } else if (hasOnboarded) {
      nextRoute = ROUTES.LOGIN;
    } else {
      nextRoute = ROUTES.ONBOARDING;
    }

    navigation.reset({
      index: 0,
      routes: [{ name: nextRoute }],
    });
  }, [minElapsed, isHydrated, isAuthenticated, hasOnboarded, navigation]);

  return (
    <ScreenContainer withGlow edges={['top', 'bottom']}>
      <View className="flex-1 items-center justify-center px-8">
        <View className="items-center">
          <View className="mb-6 items-center justify-center rounded-full p-1">
            <View className="absolute h-28 w-28 rounded-full opacity-80">
              <LinearGradient
                colors={['rgba(59, 130, 246, 0.25)', 'rgba(59, 130, 246, 0)']}
                style={{ flex: 1, borderRadius: 9999 }}
              />
            </View>
            <TruVoiceLogo size={80} color="#3B82F6" />
          </View>

          <Text className="text-[34px] font-bold tracking-tight text-white">
            TruVoice
          </Text>
          <Text className="mt-2 text-center text-base text-secondary">
            Know who&apos;s really speaking.
          </Text>
        </View>
      </View>

      <View className="px-10 pb-10">
        <ProgressBar progress={0.82} duration={config.splashDuration} />
        <Text className="mt-3 text-center text-[11px] font-semibold uppercase tracking-[2px] text-muted">
          Securing session
        </Text>
      </View>
    </ScreenContainer>
  );
}
