import { Pressable, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function SecondaryButton({
  label,
  onPress,
  icon,
  className = '',
}) {
  return (
    <Pressable
      onPress={onPress}
      className={`h-[52px] flex-row items-center justify-center rounded-full border border-white/10 bg-background-input px-6 active:opacity-90 ${className}`}
    >
      {icon && (
        <MaterialCommunityIcons
          name={icon}
          size={20}
          color="#FFFFFF"
          style={{ marginRight: 10 }}
        />
      )}
      <Text className="text-base font-medium text-white">{label}</Text>
    </Pressable>
  );
}
