import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useContactsStore } from '../../store/contactsStore';
import { colors } from '../../theme';

const FALLBACK_CONTACTS = [
  { id: 'fb1', initials: 'RK', name: 'Riya', colors: ['#F97316', '#EC4899'], isOnline: true },
  { id: 'fb2', initials: 'PN', name: 'Priya', colors: ['#3B82F6', '#6366F1'], isOnline: true },
  { id: 'fb3', initials: 'DO', name: 'Daniel', colors: ['#8B5CF6', '#3B82F6'], isOnline: false },
  { id: 'fb4', initials: 'EV', name: 'Elena', colors: ['#EC4899', '#F97316'], isOnline: true },
  { id: 'fb5', initials: 'FI', name: 'Farah', colors: ['#3B82F6', '#22C55E'], isOnline: false },
  { id: 'fb6', initials: 'KS', name: 'Kenji', colors: ['#6366F1', '#A855F7'], isOnline: false },
];

export default function RecentContactsScroll({ onSelectContact, onSeeAll }) {
  const storeContacts = useContactsStore((state) => state.contacts);

  // Use real device contacts if available, otherwise fallback
  const displayContacts = storeContacts && storeContacts.length > 0
    ? storeContacts.slice(0, 8).map((c) => ({
        ...c,
        name: c.name.split(' ')[0], // Show first name only in the scroll
      }))
    : FALLBACK_CONTACTS;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>Recent contacts</Text>
        <TouchableOpacity onPress={onSeeAll} activeOpacity={0.7}>
          <Text style={styles.seeAllText}>See all</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {displayContacts.map((contact) => (
          <TouchableOpacity
            key={contact.id}
            activeOpacity={0.75}
            onPress={() => onSelectContact && onSelectContact(contact)}
            style={styles.contactItem}
          >
            <View style={styles.avatarContainer}>
              <LinearGradient
                colors={contact.colors}
                style={styles.avatarGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <Text style={styles.initialsText}>{contact.initials}</Text>
              </LinearGradient>
              {contact.isOnline && <View style={styles.onlineBadge} />}
            </View>
            <Text style={styles.contactName} numberOfLines={1}>
              {contact.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  seeAllText: {
    color: '#3B82F6',
    fontSize: 14,
    fontWeight: '500',
  },
  scrollContent: {
    paddingRight: 10,
    gap: 16,
  },
  contactItem: {
    alignItems: 'center',
    width: 60,
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 6,
  },
  avatarGradient: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
  },
  initialsText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  onlineBadge: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#22C55E',
    borderWidth: 2,
    borderColor: '#09090B',
  },
  contactName: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: 'center',
  },
});
