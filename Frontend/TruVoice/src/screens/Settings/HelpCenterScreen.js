import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FloatingCallButton from '../../components/buttons/FloatingCallButton';
import { ROUTES } from '../../constants/routes';
import { colors } from '../../theme';
import { showAlert } from '../../store/alertStore';

export default function HelpCenterScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedId, setExpandedId] = useState('faq-1');
  const [showContactForm, setShowContactForm] = useState(false);
  const [supportSubject, setSupportSubject] = useState('');
  const [supportMessage, setSupportMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const faqs = [
    {
      id: 'faq-1',
      question: 'How does TruVoice detect synthetic AI voices in real time?',
      answer:
        'TruVoice uses advanced spectral analysis and acoustic neural network models. During live calls, our on-device engine analyzes acoustic artifacts, pitch micro-variance, spectral gaps, and synthetic voiceprint signatures without sending raw voice audio to external servers.',
      category: 'AI Detection',
    },
    {
      id: 'faq-2',
      question: 'Is my personal call audio private and secure?',
      answer:
        'Yes. All calls conducted on TruVoice utilize end-to-end DTLS-SRTP encryption with 256-bit AES protection. Speech analysis happens locally on your mobile device, so personal conversations remain completely private and unrecorded.',
      category: 'Security',
    },
    {
      id: 'faq-3',
      question: 'What should I do if a call is flagged as High Risk or AI?',
      answer:
        'If a call receives a high risk rating, do not reveal sensitive information such as OTPs, passwords, or banking details. Use our in-call "Report Scam" button or file a formal scam complaint to protect other TruVoice users.',
      category: 'Scam Protection',
    },
    {
      id: 'faq-4',
      question: 'How do community scam reports work?',
      answer:
        'When users report a scam number, TruVoice registers the report in our threat intelligence network. Numbers exceeding 20 independent community reports are automatically flagged as scam callers across the TruVoice network.',
      category: 'Scam Protection',
    },
    {
      id: 'faq-5',
      question: 'How do I upgrade or manage my subscription?',
      answer:
        'Navigate to Profile > Subscription to choose between Free, Pro, or Family plans. You can toggle between monthly and annual billing cycles at any time.',
      category: 'Billing',
    },
  ];

  const filteredFaqs = faqs.filter(
    (faq) =>
      faq.question.toLowerCase().includes(searchQuery.toLowerCase()) ||
      faq.answer.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const handleSendSupport = () => {
    if (!supportSubject.trim() || !supportMessage.trim()) {
      showAlert('Incomplete Form', 'Please provide both a subject and a message description.', [], 'warning');
      return;
    }
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      setShowContactForm(false);
      setSupportSubject('');
      setSupportMessage('');
      showAlert(
        'Ticket Submitted',
        'Thank you! Your support ticket has been received. Our team will review your inquiry shortly.',
        [],
        'success',
      );
    }, 1000);
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
          <Text style={styles.headerTitle}>Help Center & FAQ</Text>
          <View style={{ width: 36 }} />
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 110, 120) },
          ]}
        >
          {/* System Status Hero Banner */}
          <View style={styles.statusBanner}>
            <View style={styles.statusDot} />
            <View style={{ flex: 1 }}>
              <Text style={styles.statusTitle}>All Systems Operational</Text>
              <Text style={styles.statusSub}>AI Detection Engine v2.4 · WebRTC Relay Active</Text>
            </View>
          </View>

          {/* Search Box */}
          <View style={styles.searchContainer}>
            <Ionicons name="search-outline" size={20} color={colors.textMuted} style={styles.searchIcon} />
            <TextInput
              style={styles.searchInput}
              placeholder="Search help topics & FAQs..."
              placeholderTextColor={colors.textMuted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery ? (
              <TouchableOpacity onPress={() => setSearchQuery('')}>
                <Ionicons name="close-circle" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            ) : null}
          </View>

          {/* FAQs Accordion */}
          <Text style={styles.sectionTitle}>Frequently Asked Questions</Text>
          <View style={styles.faqList}>
            {filteredFaqs.length > 0 ? (
              filteredFaqs.map((faq) => {
                const isOpen = expandedId === faq.id;
                return (
                  <View key={faq.id} style={styles.faqCard}>
                    <TouchableOpacity
                      activeOpacity={0.7}
                      onPress={() => setExpandedId(isOpen ? null : faq.id)}
                      style={styles.faqHeader}
                    >
                      <Text style={styles.faqQuestion}>{faq.question}</Text>
                      <Ionicons
                        name={isOpen ? 'chevron-up' : 'chevron-down'}
                        size={20}
                        color={colors.textMuted}
                      />
                    </TouchableOpacity>

                    {isOpen && (
                      <View style={styles.faqBody}>
                        <Text style={styles.faqAnswer}>{faq.answer}</Text>
                        <View style={styles.categoryTag}>
                          <Text style={styles.categoryTagText}>{faq.category}</Text>
                        </View>
                      </View>
                    )}
                  </View>
                );
              })
            ) : (
              <View style={styles.emptyFaq}>
                <Text style={{ color: colors.textMuted }}>No matching help topics found.</Text>
              </View>
            )}
          </View>

          {/* Contact Support Section */}
          <Text style={styles.sectionTitle}>Still Need Assistance?</Text>

          {showContactForm ? (
            <View style={styles.supportFormCard}>
              <Text style={styles.formTitle}>Contact Support Team</Text>
              <TextInput
                style={styles.formInput}
                placeholder="Subject (e.g., Question about AI score)"
                placeholderTextColor={colors.textMuted}
                value={supportSubject}
                onChangeText={setSupportSubject}
              />
              <TextInput
                style={[styles.formInput, { height: 100, textAlignVertical: 'top' }]}
                placeholder="Describe your issue or feedback in detail..."
                placeholderTextColor={colors.textMuted}
                multiline
                value={supportMessage}
                onChangeText={setSupportMessage}
              />

              <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
                <TouchableOpacity
                  onPress={() => setShowContactForm(false)}
                  style={[styles.formBtn, { backgroundColor: '#18181B' }]}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '600' }}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSendSupport}
                  disabled={isSubmitting}
                  style={[styles.formBtn, { backgroundColor: '#3B82F6' }]}
                >
                  <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>
                    {isSubmitting ? 'Sending...' : 'Submit Ticket'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.supportCardsRow}>
              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => setShowContactForm(true)}
                style={styles.supportCard}
              >
                <View style={[styles.supportIconBox, { backgroundColor: 'rgba(59, 130, 246, 0.15)' }]}>
                  <Ionicons name="mail-outline" size={22} color="#3B82F6" />
                </View>
                <Text style={styles.supportCardTitle}>Email Support</Text>
                <Text style={styles.supportCardSub}>Submit a ticket to our response team</Text>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.7}
                onPress={() => navigation.navigate(ROUTES.ABOUT)}
                style={styles.supportCard}
              >
                <View style={[styles.supportIconBox, { backgroundColor: 'rgba(34, 197, 94, 0.15)' }]}>
                  <Ionicons name="information-circle-outline" size={22} color="#22C55E" />
                </View>
                <Text style={styles.supportCardTitle}>App Specs</Text>
                <Text style={styles.supportCardSub}>View engine details & licenses</Text>
              </TouchableOpacity>
            </View>
          )}
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
  statusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#131316',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.25)',
    marginBottom: 16,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#22C55E',
    marginRight: 12,
  },
  statusTitle: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  statusSub: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderRadius: 18,
    paddingHorizontal: 16,
    height: 48,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 14,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  faqList: {
    gap: 12,
    marginBottom: 24,
  },
  faqCard: {
    backgroundColor: '#131316',
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    overflow: 'hidden',
  },
  faqHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: 16,
  },
  faqQuestion: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    flex: 1,
    paddingRight: 10,
    lineHeight: 20,
  },
  faqBody: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.06)',
    paddingTop: 12,
  },
  faqAnswer: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  categoryTag: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    marginTop: 10,
  },
  categoryTagText: {
    color: '#3B82F6',
    fontSize: 11,
    fontWeight: '600',
  },
  emptyFaq: {
    padding: 20,
    alignItems: 'center',
  },
  supportCardsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 20,
  },
  supportCard: {
    flex: 1,
    backgroundColor: '#131316',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  supportIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  supportCardTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  supportCardSub: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 4,
  },
  supportFormCard: {
    backgroundColor: '#131316',
    borderRadius: 22,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    marginBottom: 20,
  },
  formTitle: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 12,
  },
  formInput: {
    color: '#FFFFFF',
    fontSize: 14,
    backgroundColor: '#18181B',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 10,
  },
  formBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 14,
  },
});
