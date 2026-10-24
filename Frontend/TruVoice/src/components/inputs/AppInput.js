import { View, TextInput, Text, Pressable } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

export default function AppInput({
  label,
  value,
  onChangeText,
  placeholder,
  secureTextEntry = false,
  keyboardType = 'default',
  autoCapitalize = 'none',
  leftIcon,
  rightIcon,
  onRightIconPress,
  className = '',
  error,
}) {
  return (
    <View className={`mb-4 ${className}`}>
      {label && (
        <Text className="mb-2 text-[11px] font-semibold uppercase tracking-[1.5px] text-muted">
          {label}
        </Text>
      )}
      <View className="h-[52px] flex-row items-center rounded-2xl border border-white/8 bg-background-input px-4">
        {leftIcon && (
          <MaterialCommunityIcons
            name={leftIcon}
            size={20}
            color="#71717A"
            style={{ marginRight: 12 }}
          />
        )}
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#52525B"
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          className="flex-1 text-base text-white"
        />
        {rightIcon && (
          <Pressable onPress={onRightIconPress} hitSlop={8}>
            <MaterialCommunityIcons
              name={rightIcon}
              size={20}
              color="#71717A"
            />
          </Pressable>
        )}
      </View>
      {error ? (
        <Text className="mt-1.5 text-xs text-danger">{error}</Text>
      ) : null}
    </View>
  );
}
