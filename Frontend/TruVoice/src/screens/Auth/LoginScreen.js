import { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import ScreenContainer from '../../components/layout/ScreenContainer';
import TruVoiceLogo from '../../components/common/TruVoiceLogo';
import AppInput from '../../components/inputs/AppInput';
import PrimaryButton from '../../components/buttons/PrimaryButton';
import SecurityNote from '../../components/cards/SecurityNote';
import { ROUTES } from '../../constants/routes';
import { useAuthStore } from '../../store/authStore';

export default function LoginScreen() {
  const navigation = useNavigation();
  const { initiateLogin, isLoading } = useAuthStore();

  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleLogin = async () => {
    if (!phoneNumber.trim() || !password.trim()) {
      setError('Please enter phone number and password.');
      return;
    }

    setError('');
    try {
      await initiateLogin({
        phone_number: phoneNumber.trim(),
        password,
      });
      navigation.navigate(ROUTES.OTP, {
        phone_number: phoneNumber.trim(),
        purpose: 'login',
      });
    } catch (err) {
      setError(err.message || 'Login failed.');
    }
  };

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        className="flex-1"
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-6 pb-8 pt-4"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TruVoiceLogo size={44} color="#3B82F6" />

          <Text className="mt-6 text-[28px] font-bold text-white">
            Welcome back
          </Text>
          <Text className="mt-2 text-base text-secondary">
            Encrypted, on-device voice protection.
          </Text>

          <View className="mt-8">
            <AppInput
              label="Phone number"
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              placeholder="+919876543210"
              keyboardType="phone-pad"
              leftIcon="phone-outline"
            />
            <AppInput
              label="Password"
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              secureTextEntry={!showPassword}
              leftIcon="lock-outline"
              rightIcon={showPassword ? 'eye-off-outline' : 'eye-outline'}
              onRightIconPress={() => setShowPassword((prev) => !prev)}
            />
          </View>

          {error ? (
            <Text className="mt-3 text-sm text-danger">{error}</Text>
          ) : null}

          <PrimaryButton
            label="Log in"
            onPress={handleLogin}
            loading={isLoading}
            className="mt-6"
          />

          <SecurityNote className="mt-8" />

          <View className="mt-8 flex-row items-center justify-center">
            <Text className="text-sm text-secondary">New to TruVoice? </Text>
            <Pressable
              onPress={() => navigation.navigate(ROUTES.REGISTER)}
              className="active:opacity-70"
            >
              <Text className="text-sm font-semibold text-primary">Sign up</Text>
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
