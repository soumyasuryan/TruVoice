import { useState } from 'react';
import {
  View,
  Text,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Pressable,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';

import ScreenContainer from '../../components/layout/ScreenContainer';
import TruVoiceLogo from '../../components/common/TruVoiceLogo';
import AppInput from '../../components/inputs/AppInput';
import PrimaryButton from '../../components/buttons/PrimaryButton';

import { ROUTES } from '../../constants/routes';
import { safeGoBack } from '../../utils/navigationHelper';

export default function ForgotPasswordScreen() {
  const navigation = useNavigation();

  const [emailOrPhone, setEmailOrPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const sendOTP = async () => {
    if (!emailOrPhone) {
      setErrorMsg('Please enter your email or phone number');
      return;
    }

    setErrorMsg('');
    setLoading(true);

    try {
      // Simulate sending reset OTP
      setTimeout(() => {
        setLoading(false);
        navigation.navigate(ROUTES.OTP, {
          phone: emailOrPhone,
          mode: 'reset',
        });
      }, 1000);
    } catch (err) {
      setErrorMsg(err.message || 'Failed to send OTP');
      setLoading(false);
    }
  };

  return (
    <ScreenContainer scrollable keyboardView edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center' }}
          className="py-6"
          showsVerticalScrollIndicator={false}
        >
          <TruVoiceLogo subtitle="Reset your password" />

          {errorMsg ? (
            <View className="bg-risk-high/10 border border-risk-high/30 rounded-xl p-3 mt-4">
              <Text className="text-risk-high text-sm text-center">{errorMsg}</Text>
            </View>
          ) : null}

          <View className="mt-6">
            <AppInput
              label="Email or Phone Number"
              placeholder="Enter your registered email or phone"
              value={emailOrPhone}
              onChangeText={setEmailOrPhone}
              autoCapitalize="none"
              leftIcon="email-outline"
            />
          </View>

          <PrimaryButton
            label="Send Verification Code"
            loading={loading}
            onPress={sendOTP}
            className="mt-8"
          />

          <Pressable
            onPress={() => safeGoBack(navigation, ROUTES.LOGIN)}
            className="mt-6 self-center"
          >
            <Text className="text-primary font-semibold">
              Back to Login
            </Text>
          </Pressable>

        </ScrollView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}