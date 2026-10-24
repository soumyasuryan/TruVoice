import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FloatingCallButton from '../../components/buttons/FloatingCallButton';
import { ROUTES } from '../../constants/routes';
import { useAuthStore } from '../../store';
import { colors } from '../../theme';
import { tokenStorage } from '../../services/storage/tokenStorage';
import { showAlert } from '../../store/alertStore';

export default function SubscriptionScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const user = useAuthStore((state) => state.user);
  const isPro = user?.isPro || false;

  const [billingCycle, setBillingCycle] = useState('monthly'); // 'monthly' | 'annual'
  const [selectedPlan, setSelectedPlan] = useState(isPro ? 'pro' : 'free');

  const plans = [
    {
      id: 'free',
      name: 'TruVoice Free',
      badge: 'Basic Shield',
      priceMonthly: '$0',
      priceAnnual: '$0',
      period: 'forever',
      description: 'Essential call protection for everyday use',
      features: [
        'On-device basic scam detection',
        'Call history logging (Last 30 calls)',
        'Community spam call reports',
        'Standard WebRTC audio encryption',
      ],
      color: '#A1A1AA',
    },
    {
      id: 'pro',
      name: 'TruVoice Pro',
      badge: 'Popular',
      priceMonthly: '$4.99',
      priceAnnual: '$3.99',
      period: 'per month',
      discount: 'Save 20% yearly',
      description: 'Real-time AI synthetic voice & deepfake defense',
      features: [
        'Real-time AI voice anomaly detection',
        'Deepfake synthetic voiceprint analysis',
        'Unlimited secured call history & transcripts',
        'Automated scam complaint filing',
        'Priority threat intelligence updates',
        '24/7 Priority support',
      ],
      color: '#3B82F6',
      popular: true,
    },
    {
      id: 'family',
      name: 'TruVoice Family',
      badge: 'Best Value',
      priceMonthly: '$9.99',
      priceAnnual: '$7.99',
      period: 'per month',
      discount: 'Save 20% yearly',
      description: 'Protect up to 5 family members under one shield',
      features: [
        'Includes all TruVoice Pro features',
        'Up to 5 family member accounts',
        'Shared family scammer blacklist',
        'Real-time elder fraud alert system',
        'Family threat dashboard',
      ],
      color: '#6366F1',
    },
  ];

  const handleTogglePlan = async (planId) => {
    if (planId === 'free' && isPro) {
      showAlert(
        'Cancel Pro Subscription',
        'Are you sure you want to downgrade to TruVoice Free? You will lose real-time AI deepfake detection.',
        [
          { text: 'Keep Pro', style: 'cancel' },
          {
            text: 'Downgrade',
            style: 'destructive',
            onPress: async () => {
              const updated = { ...user, isPro: false };
              useAuthStore.setState({ user: updated });
              const token = useAuthStore.getState().token;
              if (token) await tokenStorage.saveSession(token, updated);
              setSelectedPlan('free');
              showAlert('Plan Updated', 'Your subscription has been changed to TruVoice Free.', [], 'info');
            },
          },
        ],
        'danger',
      );
    } else if ((planId === 'pro' || planId === 'family') && !isPro) {
      showAlert(
        'Activate TruVoice Pro',
        `Upgrade to ${planId === 'family' ? 'TruVoice Family' : 'TruVoice Pro'} (${billingCycle === 'annual' ? 'Billed annually' : 'Billed monthly'})?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Subscribe Now',
            onPress: async () => {
              const updated = { ...user, isPro: true, planTier: planId };
              useAuthStore.setState({ user: updated });
              const token = useAuthStore.getState().token;
              if (token) await tokenStorage.saveSession(token, updated);
              setSelectedPlan(planId);
              showAlert('Congratulations!', 'Your TruVoice Pro protection is now active.', [], 'success');
            },
          },
        ],
        'confirm',
      );
    } else {
      setSelectedPlan(planId);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View style={styles.container}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.backBtn}
            activeOpacity={0.7}
          >
            <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Subscription Plans</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 110, 120) },
          ]}
        >
          {/* Active Status Card */}
          <View style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={styles.statusIconBox}>
                <Ionicons
                  name={isPro ? 'sparkles' : 'shield-outline'}
                  size={24}
                  color={isPro ? '#3B82F6' : colors.textMuted}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.statusLabel}>CURRENT PLAN</Text>
                <Text style={styles.statusTitle}>
                  {isPro ? 'TruVoice Pro Active' : 'TruVoice Free'}
                </Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: isPro ? 'rgba(59, 130, 246, 0.2)' : 'rgba(255, 255, 255, 0.08)' }]}>
                <Text style={[styles.statusBadgeText, { color: isPro ? '#3B82F6' : colors.textMuted }]}>
                  {isPro ? 'PRO' : 'FREE'}
                </Text>
              </View>
            </View>
            <Text style={styles.statusSub}>
              {isPro
                ? 'Your AI synthetic voice protection engine is active.'
                : 'Upgrade to Pro for real-time deepfake analysis.'}
            </Text>
          </View>

          {/* Billing Cycle Switch */}
          <View style={styles.billingToggleWrapper}>
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setBillingCycle('monthly')}
              style={[styles.billingBtn, billingCycle === 'monthly' && styles.billingBtnActive]}
            >
              <Text style={[styles.billingBtnText, billingCycle === 'monthly' && styles.billingBtnTextActive]}>
                Monthly Billing
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => setBillingCycle('annual')}
              style={[styles.billingBtn, billingCycle === 'annual' && styles.billingBtnActive]}
            >
              <Text style={[styles.billingBtnText, billingCycle === 'annual' && styles.billingBtnTextActive]}>
                Annual Billed (Save 20%)
              </Text>
            </TouchableOpacity>
          </View>

          {/* Plan Cards */}
          {plans.map((plan) => {
            const isCurrent = (isPro && (plan.id === 'pro' || plan.id === 'family')) || (!isPro && plan.id === 'free');
            const isSelected = selectedPlan === plan.id;
            const price = billingCycle === 'annual' ? plan.priceAnnual : plan.priceMonthly;

            return (
              <View
                key={plan.id}
                style={[
                  styles.planCard,
                  isSelected && { borderColor: plan.color, borderWidth: 2 },
                  plan.popular && styles.popularPlanCard,
                ]}
              >
                {plan.popular && (
                  <LinearGradient colors={['#3B82F6', '#6366F1']} style={styles.popularBanner}>
                    <Text style={styles.popularBannerText}>MOST POPULAR</Text>
                  </LinearGradient>
                )}

                <View style={styles.planHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.planName}>{plan.name}</Text>
                    <Text style={styles.planDesc}>{plan.description}</Text>
                  </View>
                  <Text style={[styles.planPrice, { color: plan.color }]}>
                    {price}
                    <Text style={styles.planPeriod}>/{plan.period === 'forever' ? 'mo' : 'mo'}</Text>
                  </Text>
                </View>

                {billingCycle === 'annual' && plan.discount && (
                  <View style={styles.discountPill}>
                    <Ionicons name="pricetag-outline" size={12} color="#22C55E" style={{ marginRight: 4 }} />
                    <Text style={styles.discountText}>{plan.discount}</Text>
                  </View>
                )}

                <View style={styles.planDivider} />

                {/* Features List */}
                <View style={styles.featuresList}>
                  {plan.features.map((feat, idx) => (
                    <View key={idx} style={styles.featureRow}>
                      <Ionicons name="checkmark-circle" size={16} color={plan.color} style={{ marginRight: 8 }} />
                      <Text style={styles.featureText}>{feat}</Text>
                    </View>
                  ))}
                </View>

                {/* Select / Upgrade Button */}
                <TouchableOpacity
                  activeOpacity={0.8}
                  onPress={() => handleTogglePlan(plan.id)}
                  style={[
                    styles.planActionBtn,
                    isCurrent
                      ? { backgroundColor: 'rgba(255,255,255,0.08)' }
                      : { backgroundColor: plan.color },
                  ]}
                >
                  <Text
                    style={[
                      styles.planActionText,
                      isCurrent && { color: colors.textMuted },
                    ]}
                  >
                    {isCurrent ? 'Current Plan' : `Select ${plan.name}`}
                  </Text>
                </TouchableOpacity>
              </View>
            );
          })}
        </ScrollView>

        <FloatingCallButton onPress={() => navigation.navigate(ROUTES.KEYPAD)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#09090B',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  container: {
    flex: 1,
    backgroundColor: '#09090B',
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
  scrollContent: {
    paddingTop: 8,
  },
  statusCard: {
    backgroundColor: '#131316',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  statusLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1,
  },
  statusTitle: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '800',
  },
  statusSub: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 10,
    lineHeight: 18,
  },
  billingToggleWrapper: {
    flexDirection: 'row',
    backgroundColor: '#18181B',
    borderRadius: 16,
    padding: 4,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  billingBtn: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 12,
  },
  billingBtnActive: {
    backgroundColor: '#3B82F6',
  },
  billingBtnText: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  billingBtnTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },
  planCard: {
    backgroundColor: '#131316',
    borderRadius: 24,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 18,
    position: 'relative',
    overflow: 'hidden',
  },
  popularPlanCard: {
    borderColor: '#3B82F6',
  },
  popularBanner: {
    position: 'absolute',
    top: 0,
    right: 0,
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderBottomLeftRadius: 14,
  },
  popularBannerText: {
    color: '#FFFFFF',
    fontSize: 9,
    fontWeight: '800',
    letterSpacing: 1,
  },
  planHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 4,
  },
  planName: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  planDesc: {
    color: colors.textSecondary,
    fontSize: 12,
    marginTop: 4,
    maxWidth: '85%',
  },
  planPrice: {
    fontSize: 24,
    fontWeight: '800',
  },
  planPeriod: {
    fontSize: 12,
    color: colors.textMuted,
    fontWeight: '400',
  },
  discountPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 8,
  },
  discountText: {
    color: '#22C55E',
    fontSize: 11,
    fontWeight: '600',
  },
  planDivider: {
    height: 1,
    backgroundColor: 'rgba(255, 255, 255, 0.06)',
    marginVertical: 14,
  },
  featuresList: {
    gap: 10,
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  featureText: {
    color: '#FFFFFF',
    fontSize: 13,
    flex: 1,
  },
  planActionBtn: {
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  planActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
