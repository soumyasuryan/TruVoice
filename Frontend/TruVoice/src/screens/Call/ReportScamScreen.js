import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  Alert,
  KeyboardAvoidingView,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenContainer from '../../components/layout/ScreenContainer';
import PrimaryButton from '../../components/buttons/PrimaryButton';
import { ROUTES } from '../../constants/routes';
import { showAlert } from '../../store/alertStore';
import { analysisService } from '../../services/analysis/analysisService';
import { colors } from '../../theme';
import { safeGoBack } from '../../utils/navigationHelper';

export default function ReportScamScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const initialCall = route.params?.call || {};
  const [scamCategory, setScamCategory] = useState('Impersonation / Vishing');
  const [phoneNumber, setPhoneNumber] = useState(
    initialCall.number || initialCall.phone_number || '',
  );
  const callSummary = route.params?.call_summary || {};

  const [description, setDescription] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  const prefillSuggestions = [
    'Caller claimed to be from my bank and requested my OTP.',
    'Fake IRS / tax officer demanding immediate payment.',
    'Impersonating a relative in emergency need of money.',
    'Lottery / prize scam asking for advance fees.',
    'Tech support claiming my device has a virus.',
  ];

  const handleSubmit = async () => {
    if (!description.trim()) {
      setError('Please add a brief description of what happened.');
      return;
    }
    if (!phoneNumber) {
      setError('Phone number is missing.');
      return;
    }

    setError('');
    setIsSubmitting(true);
    try {
      const result = await analysisService.reportScam(
        scamCategory,
        phoneNumber,
        description.trim(),
      );
      showAlert(
        'Complaint submitted',
        `Thank you. Your complaint has been registered.\n\nComplaint ID: ${result.complaint_id?.slice(0, 8) || 'received'}\n\nThis data helps protect other TruVoice users.`,
        [
          {
            text: 'Done',
            onPress: () => {
              safeGoBack(navigation, ROUTES.MAIN_TABS);
            },
          },
        ],
        'success',
      );
    } catch (err) {
      setError(err.message || 'Failed to submit complaint. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const appendSuggestion = (text) => {
    setDescription((prev) => (prev ? `${prev}\n${text}` : text));
  };

  return (
    <ScreenContainer edges={['top', 'bottom']}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <SafeAreaView style={styles.safeAreaInner}>
          <StatusBar barStyle="light-content" backgroundColor="#09090B" />
          <View style={[styles.container, { paddingBottom: Math.max(insets.bottom + 20, 24) }]}>
            <View style={styles.header}>
              <TouchableOpacity
                onPress={() => safeGoBack(navigation, ROUTES.MAIN_TABS)}
                style={styles.backBtn}
                activeOpacity={0.7}
              >
                <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>File scam complaint</Text>
              <View style={{ width: 36 }} />
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 24 }}
              keyboardShouldPersistTaps="handled"
            >
              <View style={styles.overviewCard}>
                <View style={styles.overviewIcon}>
                  <Ionicons name="shield-half-outline" size={26} color="#3B82F6" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.overviewTitle}>Protect the community</Text>
                  <Text style={styles.overviewSub}>
                    Your report helps flag scam patterns and warns other users before they answer.
                  </Text>
                </View>
              </View>

              <View style={styles.fieldCard}>
                <Text style={styles.fieldLabel}>Reported phone number</Text>
                <View style={styles.phoneRow}>
                  <Ionicons name="call-outline" size={18} color={colors.textMuted} style={{ marginRight: 10 }} />
                  <Text style={styles.phoneValue}>
                    {phoneNumber || 'Unknown number'}
                  </Text>
                </View>
              </View>

              {callSummary.scamCategory || callSummary.riskLevelLabel ? (
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryLabel}>Analysis context from call</Text>
                  {callSummary.riskLevelLabel ? (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryKey}>Risk level</Text>
                      <Text style={styles.summaryValue}>{callSummary.riskLevelLabel}</Text>
                    </View>
                  ) : null}
                  {callSummary.scamCategory ? (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryKey}>Scam category</Text>
                      <Text style={[styles.summaryValue, { color: '#F59E0B' }]}>{callSummary.scamCategory}</Text>
                    </View>
                  ) : null}
                  {typeof callSummary.unifiedRiskScore === 'number' ? (
                    <View style={styles.summaryRow}>
                      <Text style={styles.summaryKey}>Risk score</Text>
                      <Text style={styles.summaryValue}>{callSummary.unifiedRiskScore}%</Text>
                    </View>
                  ) : null}
                </View>
              ) : null}

              <Text style={styles.fieldLabel2}>Describe what happened</Text>
              <TextInput
                style={styles.textArea}
                multiline
                textAlignVertical="top"
                placeholder="Explain the call. What did they say? What did they ask for? Was money, OTP, or personal info requested?"
                placeholderTextColor={colors.textMuted}
                value={description}
                onChangeText={(t) => {
                  setDescription(t);
                  if (error) setError('');
                }}
                maxLength={1000}
              />
              <Text style={styles.charCount}>{description.length}/1000</Text>

              <Text style={styles.fieldLabel2}>Quick suggestions (tap to add)</Text>
              <View style={styles.chipsWrap}>
                {prefillSuggestions.map((s) => (
                  <TouchableOpacity
                    key={s}
                    activeOpacity={0.7}
                    onPress={() => appendSuggestion(s)}
                    style={styles.chip}
                  >
                    <Text style={styles.chipText} numberOfLines={2}>
                      {s}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}
            </ScrollView>

            <View style={{ paddingTop: 12 }}>
              <PrimaryButton
                label={isSubmitting ? 'Submitting...' : 'Submit complaint'}
                onPress={handleSubmit}
                loading={isSubmitting}
                disabled={isSubmitting}
                leftIcon={!isSubmitting ? 'flag-outline' : undefined}
                iconLibrary="Ionicons"
              />
              {isSubmitting ? (
                <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 10 }}>
                  <ActivityIndicator size="small" color="#3B82F6" style={{ marginRight: 8 }} />
                  <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                    Sending complaint securely...
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </SafeAreaView>
      </KeyboardAvoidingView>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  safeAreaInner: {
    flex: 1,
    backgroundColor: '#09090B',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  container: {
    flex: 1,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  overviewCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(59,130,246,0.08)',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(59,130,246,0.2)',
    marginVertical: 10,
  },
  overviewIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(59,130,246,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  overviewTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
  },
  overviewSub: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 4,
    lineHeight: 18,
  },
  fieldCard: {
    backgroundColor: '#131316',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginVertical: 8,
  },
  fieldLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 10,
    letterSpacing: 0.5,
  },
  phoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  phoneValue: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '600',
  },
  summaryCard: {
    backgroundColor: '#131316',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginVertical: 8,
  },
  summaryLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
  },
  summaryKey: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  summaryValue: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  fieldLabel2: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 16,
    marginBottom: 8,
  },
  textArea: {
    minHeight: 140,
    backgroundColor: '#131316',
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    color: '#FFFFFF',
    fontSize: 14,
    lineHeight: 20,
  },
  charCount: {
    alignSelf: 'flex-end',
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    maxWidth: '48%',
    backgroundColor: '#131316',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '500',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    marginTop: 12,
    textAlign: 'left',
  },
});
