import { Pressable, Text, View, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function PrimaryButton({
  label,
  onPress,
  disabled = false,
  loading = false,
  icon,
  className = '',
}) {
  return (
    <View className={`relative ${className}`}>
      <View className="absolute inset-x-4 top-3 h-10 rounded-full bg-primary/30 blur-xl" />
      <Pressable
        onPress={onPress}
        disabled={disabled || loading}
        className={`h-[52px] flex-row items-center justify-center rounded-full bg-primary px-6 active:opacity-90 ${
          disabled || loading ? 'opacity-50' : ''
        }`}
      >
        {loading ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <>
            {icon && (
              <MaterialCommunityIcons
                name={icon}
                size={20}
                color="#FFFFFF"
                style={{ marginRight: 8 }}
              />
            )}
            <Text className="text-base font-semibold text-white">{label}</Text>
          </>
        )}
      </Pressable>
    </View>
  );
}
