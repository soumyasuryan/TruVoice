import Svg, { Circle, Rect, Path, Line } from 'react-native-svg';
import { View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

function ScamIllustration() {
  return (
    <View className="h-56 w-56 items-center justify-center">
      <View className="absolute h-52 w-52 rounded-[40px] border border-white/10" />
      <View className="absolute h-40 w-40 rounded-full border border-white/8" />
      <View className="h-16 w-16 items-center justify-center rounded-full bg-primary/15">
        <MaterialCommunityIcons name="alert-decagram" size={32} color="#3B82F6" />
      </View>
    </View>
  );
}

function AnalysisIllustration() {
  const bars = [18, 28, 38, 48, 38, 28, 18, 32, 44, 36, 24, 40];
  return (
    <View className="h-56 w-56 items-center justify-center">
      <View className="absolute h-52 w-52 rounded-[40px] border border-white/10" />
      <View className="absolute h-40 w-40 rounded-full border border-white/8" />
      <Svg width={120} height={48} viewBox="0 0 120 48">
        {bars.map((height, index) => (
          <Rect
            key={`bar-${index}`}
            x={index * 10}
            y={48 - height}
            width={6}
            height={height}
            rx={3}
            fill="#3B82F6"
            opacity={0.85}
          />
        ))}
      </Svg>
    </View>
  );
}

function SecureIllustration() {
  return (
    <View className="h-56 w-56 items-center justify-center">
      <View className="absolute h-52 w-52 rounded-[40px] border border-white/10" />
      <View className="absolute h-40 w-40 rounded-full border border-white/8" />
      <Svg width={64} height={72} viewBox="0 0 64 72">
        <Path
          d="M32 4 L58 16 V36 C58 52 32 68 32 68 C32 68 6 52 6 36 V16 Z"
          fill="none"
          stroke="#3B82F6"
          strokeWidth={2.5}
          strokeLinejoin="round"
        />
        <Path
          d="M22 36 L29 43 L44 28"
          fill="none"
          stroke="#22C55E"
          strokeWidth={3}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    </View>
  );
}

const ILLUSTRATIONS = {
  scam: ScamIllustration,
  analysis: AnalysisIllustration,
  secure: SecureIllustration,
};

export default function OnboardingIllustration({ type = 'scam' }) {
  const Illustration = ILLUSTRATIONS[type] || ScamIllustration;
  return <Illustration />;
}
