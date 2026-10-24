import { View, Text } from 'react-native';

export default function OrDivider({ className = '' }) {
  return (
    <View className={`my-6 flex-row items-center ${className}`}>
      <View className="h-px flex-1 bg-white/10" />
      <Text className="mx-4 text-xs font-medium uppercase tracking-widest text-muted">
        or
      </Text>
      <View className="h-px flex-1 bg-white/10" />
    </View>
  );
}
