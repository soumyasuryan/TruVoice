import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

/**
 * Base screen wrapper — dark background, optional radial glow, safe area.
 * Most screens will use this so padding/background stay consistent.
 */
export default function ScreenContainer({
  children,
  className = '',
  withGlow = false,
  edges = ['top', 'bottom'],
}) {
  return (
    <View className={`flex-1 bg-background ${className}`}>
      {withGlow && (
        <View className="absolute inset-0">
          <LinearGradient
            colors={[
              'rgba(59, 130, 246, 0.12)',
              'rgba(9, 9, 11, 0)',
              'rgba(9, 9, 11, 0)',
            ]}
            locations={[0, 0.45, 1]}
            start={{ x: 0.5, y: 0.35 }}
            end={{ x: 0.5, y: 1 }}
            style={{ flex: 1 }}
          />
        </View>
      )}
      <SafeAreaView className="flex-1" edges={edges}>
        {children}
      </SafeAreaView>
    </View>
  );
}
