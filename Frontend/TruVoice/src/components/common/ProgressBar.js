import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';

// Animated progress bar component
export default function ProgressBar({
  progress = 0,
  duration = 2500,
  className = '',
  trackClassName = 'h-1 rounded-full bg-white/10 overflow-hidden',
  fillClassName = 'h-full rounded-full bg-primary',
}) {
  const animatedProgress = useSharedValue(0);

  useEffect(() => {
    animatedProgress.value = withTiming(progress, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
  }, [progress, duration, animatedProgress]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${animatedProgress.value * 100}%`,
  }));

  return (
    <View className={trackClassName}>
      <Animated.View className={fillClassName} style={fillStyle} />
    </View>
  );
}
