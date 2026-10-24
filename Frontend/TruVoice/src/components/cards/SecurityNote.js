import { View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function SecurityNote({ className = '' }) {
  return (
    <View
      className={`flex-row items-start rounded-2xl border border-white/8 bg-background-card p-4 ${className}`}
    >
      <View className="mr-3 mt-0.5 h-8 w-8 items-center justify-center rounded-full bg-success/15">
        <MaterialCommunityIcons name="shield-check" size={18} color="#22C55E" />
      </View>
      <Text className="flex-1 text-sm leading-5 text-secondary">
        Audio never leaves the encrypted channel. Analysis chunks are discarded
        after scoring.
      </Text>
    </View>
  );
}
