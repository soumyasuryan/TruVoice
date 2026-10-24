import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  TextInput,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';

import ScreenContainer from '../../components/layout/ScreenContainer';
import TruVoiceLogo from '../../components/common/TruVoiceLogo';
import PrimaryButton from '../../components/buttons/PrimaryButton';

import { ROUTES } from '../../constants/routes';
import { useAuthStore } from '../../store/authStore';
import { config } from '../../constants/config';
import { safeGoBack } from '../../utils/navigationHelper';

export default function OtpScreen() {
  const navigation = useNavigation();
  const route = useRoute();

  const routePhone = route.params?.phone_number || '';
  const routeEmail = route.params?.email || '';
  const routePurpose = route.params?.purpose || 'signup';

  const { verifySignup, verifyLogin, resendOtp, isLoading, pendingPhone, pendingEmail, otpPurpose } = useAuthStore();

  const phoneNumber = pendingPhone || routePhone;
  const email = pendingEmail || routeEmail;
  const purpose = otpPurpose || routePurpose;

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [timer, setTimer] = useState(config.otpResendCooldownSec || 60);
  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');

  const inputRefs = useRef([]);

  useEffect(() => {
    if (timer === 0) return;

    const interval = setInterval(() => {
      setTimer((prev) => prev - 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [timer]);

  const updateOTP = (value, index) => {
    const copy = [...otp];
    copy[index] = value;
    setOtp(copy);
    setError('');

    if (value && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    if (!value && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    const code = otp.join('');
    if (code.length !== 6) {
      setError('Please enter all 6 digits.');
      return;
    }

    setError('');
    setSuccessMsg('');

    try {
      if (purpose === 'login') {
        await verifyLogin(code);
      } else {
        await verifySignup(code);
      }

      setSuccessMsg('Verified!');
      navigation.reset({
        index: 0,
        routes: [{ name: ROUTES.MAIN_TABS }],
      });
    } catch (err) {
      setError(err.message || 'Verification failed. Please check the OTP.');
    }
  };

  const handleResendOTP = async () => {
    if (timer > 0) return;
    setError('');
    setSuccessMsg('');
    try {
      await resendOtp();
      setTimer(config.otpResendCooldownSec || 60);
      setSuccessMsg('OTP resent successfully.');
    } catch (err) {
      setError(err.message || 'Failed to resend OTP.');
    }
  };

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View className="flex-1 px-6 justify-center">
          <View className="items-center">
            <TruVoiceLogo size={50} color="#3B82F6" />

            <Text className="mt-8 text-3xl font-bold text-white">
              Verify OTP
            </Text>

            <Text className="mt-3 text-center text-secondary text-base leading-6">
              We&apos;ve sent a 6 digit verification code to{' '}
              <Text className="text-white font-semibold">
                {email || 'your registered email'}
              </Text>
              .
            </Text>

            {phoneNumber ? (
              <Text className="mt-1 text-center text-muted text-xs">
                {purpose === 'signup' ? 'Signing up' : 'Logging in'} · {phoneNumber}
              </Text>
            ) : null}
          </View>

          <View className="mt-12 flex-row justify-between">
            {otp.map((digit, index) => (
              <TextInput
                key={index}
                ref={(ref) => (inputRefs.current[index] = ref)}
                value={digit}
                onChangeText={(text) => updateOTP(text.slice(-1), index)}
                keyboardType="numeric"
                maxLength={1}
                textAlign="center"
                className="h-16 w-14 rounded-2xl border border-zinc-700 bg-zinc-900 text-center text-2xl font-bold text-white"
              />
            ))}
          </View>

          {error ? (
            <Text className="mt-4 text-sm text-danger text-center">{error}</Text>
          ) : null}
          {successMsg ? (
            <Text className="mt-4 text-sm text-green-500 text-center">{successMsg}</Text>
          ) : null}

          <PrimaryButton
            label="Verify"
            loading={isLoading}
            onPress={handleVerify}
            className="mt-10"
          />

          <View className="mt-8 items-center">
            {timer > 0 ? (
              <Text className="text-secondary">Resend code in {timer}s</Text>
            ) : (
              <Pressable onPress={handleResendOTP} className="active:opacity-70">
                <Text className="font-semibold text-primary">Resend OTP</Text>
              </Pressable>
            )}

            <Pressable
              onPress={() => safeGoBack(navigation)}
              className="mt-6 active:opacity-70"
            >
              <Text className="text-secondary text-sm">
                Wrong number? <Text className="text-primary font-semibold">Go back</Text>
              </Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}
