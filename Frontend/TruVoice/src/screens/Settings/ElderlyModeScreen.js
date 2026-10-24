import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../../services/api/client';
import { useSettingsStore } from '../../store/settingsStore';
import {
  canAddGuardianContact,
  isValidGuardianEmail,
  MAX_GUARDIAN_CONTACTS,
} from '../../utils/guardianContacts';

export default function ElderlyModeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const setElderlyModeEnabled = useSettingsStore((state) => state.setElderlyModeEnabled);
  const [enabled, setEnabled] = useState(false);
  const [contacts, setContacts] = useState([]);
  const [contactLimit, setContactLimit] = useState(MAX_GUARDIAN_CONTACTS);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);
  const [savingMode, setSavingMode] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [removingContactId, setRemovingContactId] = useState(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [settingsResponse, contactsResponse] = await Promise.all([
        api.getGuardianSettings(),
        api.getGuardianContacts(),
      ]);
      const modeEnabled = Boolean(settingsResponse.data?.enabled);
      setEnabled(modeEnabled);
      setElderlyModeEnabled(modeEnabled);
      setContacts(contactsResponse.data?.contacts || []);
      setContactLimit(contactsResponse.data?.limit || MAX_GUARDIAN_CONTACTS);
    } catch (loadError) {
      setError(loadError.message || 'Unable to load guardian settings.');
    } finally {
      setLoading(false);
    }
  }, [setElderlyModeEnabled]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const handleToggle = async (nextEnabled) => {
    setSavingMode(true);
    setError('');
    try {
      const response = await api.updateGuardianSettings(nextEnabled);
      const persistedValue = Boolean(response.data?.enabled);
      setEnabled(persistedValue);
      setElderlyModeEnabled(persistedValue);
    } catch (saveError) {
      setError(saveError.message || 'Unable to update elderly mode.');
    } finally {
      setSavingMode(false);
    }
  };

  const handleAddContact = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!isValidGuardianEmail(normalizedEmail)) {
      setError('Enter a valid email address.');
      return;
    }
    if (!canAddGuardianContact(contacts, contactLimit)) {
      setError(`You can add up to ${contactLimit} guardian contacts.`);
      return;
    }

    setAddingContact(true);
    setError('');
    try {
      const response = await api.addGuardianContact(normalizedEmail);
      setContacts((current) => [...current, response.data]);
      setEmail('');
    } catch (addError) {
      setError(addError.message || 'Unable to add this guardian contact.');
    } finally {
      setAddingContact(false);
    }
  };

  const handleRemoveContact = async (contactId) => {
    setRemovingContactId(contactId);
    setError('');
    try {
      await api.removeGuardianContact(contactId);
      setContacts((current) => current.filter((contact) => contact.id !== contactId));
    } catch (removeError) {
      setError(removeError.message || 'Unable to remove this guardian contact.');
    } finally {
      setRemovingContactId(null);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View style={[styles.container, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        <View style={styles.header}>
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel="Back to settings"
            onPress={() => navigation.goBack()}
            style={styles.backButton}
          >
            <Ionicons name="arrow-back" size={22} color="#FFFFFF" />
          </TouchableOpacity>
          <Text style={styles.title}>Elderly mode</Text>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color="#60A5FA" size="large" />
          </View>
        ) : (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.content}
          >
            <View style={styles.card}>
              <View style={styles.modeHeader}>
                <View style={styles.modeCopy}>
                  <Text style={styles.sectionTitle}>Elderly mode</Text>
                  <Text style={styles.description}>
                    Use larger text and spoken severe-risk warnings. Guardian emails are sent
                    only after two consecutive severe analysis windows.
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Elderly mode"
                  accessibilityRole="switch"
                  value={enabled}
                  onValueChange={handleToggle}
                  disabled={savingMode}
                  trackColor={{ false: '#3F3F46', true: '#2563EB' }}
                  thumbColor={enabled ? '#FFFFFF' : '#D4D4D8'}
                />
              </View>
              {savingMode && <ActivityIndicator color="#60A5FA" style={styles.inlineLoader} />}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Trusted email contacts</Text>
              <Text style={styles.description}>
                Add up to {contactLimit} people. Each address must be verified before it can
                receive an alert. Every alert includes an unsubscribe link.
              </Text>

              <View style={styles.inputRow}>
                <TextInput
                  accessibilityLabel="Guardian email address"
                  autoCapitalize="none"
                  autoComplete="email"
                  autoCorrect={false}
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  onSubmitEditing={handleAddContact}
                  placeholder="name@example.com"
                  placeholderTextColor="#71717A"
                  value={email}
                  style={styles.input}
                />
                <TouchableOpacity
                  accessibilityRole="button"
                  accessibilityLabel="Add guardian contact"
                  disabled={addingContact || !canAddGuardianContact(contacts, contactLimit)}
                  onPress={handleAddContact}
                  style={[
                    styles.addButton,
                    (addingContact || !canAddGuardianContact(contacts, contactLimit)) &&
                      styles.disabledButton,
                  ]}
                >
                  {addingContact ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Ionicons name="add" size={24} color="#FFFFFF" />
                  )}
                </TouchableOpacity>
              </View>

              <Text style={styles.countText}>
                {contacts.length} of {contactLimit} contacts
              </Text>

              {contacts.length === 0 ? (
                <Text style={styles.emptyText}>No guardian contacts added yet.</Text>
              ) : (
                contacts.map((contact) => (
                  <View key={contact.id} style={styles.contactRow}>
                    <View style={styles.contactCopy}>
                      <Text style={styles.contactEmail}>{contact.email}</Text>
                      <Text
                        style={[
                          styles.contactStatus,
                          contact.status === 'verified' ? styles.verified : styles.pending,
                        ]}
                      >
                        {contact.status === 'verified'
                          ? 'Verified'
                          : 'Pending email verification'}
                      </Text>
                    </View>
                    <TouchableOpacity
                      accessibilityRole="button"
                      accessibilityLabel={`Remove ${contact.email}`}
                      disabled={removingContactId === contact.id}
                      onPress={() => handleRemoveContact(contact.id)}
                      style={styles.removeButton}
                    >
                      {removingContactId === contact.id ? (
                        <ActivityIndicator color="#F87171" />
                      ) : (
                        <Ionicons name="trash-outline" size={20} color="#F87171" />
                      )}
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </View>

            {!!error && (
              <View accessibilityRole="alert" style={styles.errorBox}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}
          </ScrollView>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#09090B' },
  container: { flex: 1, backgroundColor: '#09090B', paddingHorizontal: 20 },
  header: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16 },
  backButton: { padding: 8, marginLeft: -8, marginRight: 10 },
  title: { color: '#FFFFFF', fontSize: 25, fontWeight: '700' },
  content: { paddingBottom: 24, gap: 16 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: '#131316',
    borderRadius: 20,
    borderColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    padding: 18,
  },
  modeHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  modeCopy: { flex: 1, paddingRight: 12 },
  sectionTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '700', marginBottom: 8 },
  description: { color: '#A1A1AA', fontSize: 15, lineHeight: 22 },
  inlineLoader: { marginTop: 12, alignSelf: 'flex-start' },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18, gap: 10 },
  input: {
    flex: 1,
    height: 50,
    color: '#FFFFFF',
    backgroundColor: '#09090B',
    borderColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    fontSize: 16,
  },
  addButton: {
    width: 50,
    height: 50,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563EB',
  },
  disabledButton: { opacity: 0.5 },
  countText: { color: '#A1A1AA', fontSize: 13, marginTop: 10 },
  emptyText: { color: '#A1A1AA', fontSize: 15, marginTop: 20, textAlign: 'center' },
  contactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopColor: 'rgba(255,255,255,0.08)',
    borderTopWidth: 1,
    paddingTop: 14,
    marginTop: 14,
  },
  contactCopy: { flex: 1, paddingRight: 10 },
  contactEmail: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  contactStatus: { fontSize: 14, marginTop: 5 },
  verified: { color: '#4ADE80' },
  pending: { color: '#FBBF24' },
  removeButton: { padding: 10 },
  errorBox: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderColor: 'rgba(239,68,68,0.35)',
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  errorText: { color: '#FCA5A5', fontSize: 15 },
});
