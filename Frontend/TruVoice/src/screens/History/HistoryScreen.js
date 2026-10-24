import React, { useState, useEffect, useCallback } from 'react';
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
  RefreshControl,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import FloatingCallButton from '../../components/buttons/FloatingCallButton';
import { ROUTES } from '../../constants/routes';
import { colors } from '../../theme';
import { useHistoryStore } from '../../store/historyStore';
import { useContactsStore } from '../../store/contactsStore';
import { resolveContactName } from '../../utils/analysisMapper';
import { getRiskScoreColor } from '../../utils/scoreColors';

const FILTERS = ['All', 'Missed', 'Human', 'AI', 'Suspicious'];

export default function HistoryScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [activeFilter, setActiveFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const { items, isLoading, error, fetchHistory, refreshContactNames } = useHistoryStore();
  const contacts = useContactsStore((state) => state.contacts);
  const loadContacts = useContactsStore((state) => state.loadContacts);

  const loadHistory = useCallback(async () => {
    try {
      await fetchHistory();
    } catch {
      // error stored in the store
    }
  }, [fetchHistory]);

  useEffect(() => {
    if (items.length === 0) {
      loadHistory();
    }
  }, [items.length, loadHistory]);

  useEffect(() => {
    refreshContactNames();
  }, [contacts, refreshContactNames]);

  useEffect(() => {
    loadContacts().catch(() => {});
  }, [loadContacts]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await loadHistory();
    } finally {
      setRefreshing(false);
    }
  };

  const displayItems = items.map((item) => ({
    ...item,
    displayName: resolveContactName(item, contacts),
  }));

  const filteredItems = displayItems.filter((item) => {
    const haystack = `${item.displayName || ''} ${item.number || ''} ${item.callerNumber || ''}`.toLowerCase();
    const matchesSearch = haystack.includes(search.toLowerCase());
    if (!matchesSearch) return false;
    if (activeFilter === 'All') return true;
    return item.filterCategory === activeFilter;
  });

  const groupsMap = filteredItems.reduce((acc, item) => {
    const key = item.group || item.dateLabel || 'Unknown';
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});

  const groupKeys = Object.keys(groupsMap);

  const getBadgeStyle = (item) => {
    if (item.badge) {
      const bg = item.badgeColor ? `${item.badgeColor}22` : 'rgba(255,255,255,0.08)';
      return { bg, text: item.badgeColor || '#FFFFFF', label: item.badge };
    }
    const scoreColor = getRiskScoreColor(Math.max(item.aiProbability || 0, item.unifiedRiskScore || 0));
    if (item.aiProbability > 60) {
      return { bg: `${scoreColor}26`, text: scoreColor, label: 'AI' };
    }
    if (item.aiProbability > 30 || item.unifiedRiskScore > 50) {
      return { bg: `${scoreColor}26`, text: scoreColor, label: 'Suspicious' };
    }
    return { bg: `${scoreColor}26`, text: scoreColor, label: 'Human' };
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#09090B" />
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>History</Text>
          <Text style={styles.subtitle}>
            {items.length > 0 ? `${items.length} call${items.length === 1 ? '' : 's'} analyzed and secured` : 'Every call, scored and stored'}
          </Text>
        </View>

        <View style={styles.searchContainer}>
          <Ionicons name="search-outline" size={20} color={colors.textMuted} style={styles.searchIcon} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search call history"
            placeholderTextColor={colors.textMuted}
            value={search}
            onChangeText={setSearch}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} />
            </TouchableOpacity>
          ) : null}
        </View>

        <View style={styles.filterWrapper}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterContainer}
          >
            {FILTERS.map((filter) => {
              const isActive = activeFilter === filter;
              return (
                <TouchableOpacity
                  key={filter}
                  activeOpacity={0.7}
                  onPress={() => setActiveFilter(filter)}
                  style={[styles.filterPill, isActive && styles.filterPillActive]}
                >
                  <Text style={[styles.filterText, isActive && styles.filterTextActive]}>
                    {filter}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {error ? (
          <View style={styles.errorBar}>
            <Ionicons name="alert-circle-outline" size={16} color="#EF4444" style={{ marginRight: 6 }} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={loadHistory} style={styles.retryBtn}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        <ScrollView
          style={styles.mainScroll}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#3B82F6"
              colors={['#3B82F6']}
            />
          }
          contentContainerStyle={[
            styles.scrollContent,
            { paddingBottom: Math.max(insets.bottom + 110, 120) },
          ]}
        >
          {isLoading && !refreshing && filteredItems.length === 0 ? (
            <View style={styles.emptyContainer}>
              <ActivityIndicator size="large" color="#3B82F6" />
              <Text style={[styles.emptySub, { marginTop: 16 }]}>Loading call history...</Text>
            </View>
          ) : filteredItems.length === 0 ? (
            <View style={styles.emptyContainer}>
              <View style={styles.emptyIconCircle}>
                <Ionicons name="time-outline" size={36} color={colors.textMuted} />
              </View>
              <Text style={styles.emptyTitle}>No call history yet</Text>
              <Text style={styles.emptySub}>
                {search || activeFilter !== 'All'
                  ? 'No results match your search or filter.'
                  : 'Your call history will appear here once you make or receive calls through TruVoice.'}
              </Text>
            </View>
          ) : (
            groupKeys.map((groupKey) => (
              <View key={groupKey} style={{ marginBottom: 18 }}>
                <Text style={styles.groupHeader}>{groupKey}</Text>
                <View style={styles.groupCard}>
                  {groupsMap[groupKey].map((item, idx) => {
                    const badge = getBadgeStyle(item);
                    return (
                      <TouchableOpacity
                        key={item.id || idx}
                        activeOpacity={0.7}
                        onPress={() => navigation.navigate(ROUTES.CALL_DETAILS, { call: item })}
                        style={[styles.callRow, idx !== groupsMap[groupKey].length - 1 && styles.callRowBorder]}
                      >
                        <View style={styles.callAvatar}>
                          <Text style={styles.callInitials}>{item.initials || 'UC'}</Text>
                        </View>
                        <View style={styles.callInfo}>
                          <View style={styles.callNameRow}>
                            <Text style={styles.callName} numberOfLines={1} ellipsizeMode="tail">
                              {item.displayName || item.callerNumber || item.number || 'Unknown Caller'}
                            </Text>
                            <View style={[styles.inlineBadge, { backgroundColor: badge.bg }]}>
                              <Text style={[styles.inlineBadgeText, { color: badge.text }]}>
                                {badge.label}
                              </Text>
                            </View>
                          </View>
                          <Text style={styles.callNumber}>
                            {item.callerNumber || item.number || 'Unknown number'}
                          </Text>
                          {item.filterCategory !== 'Missed' && item.scamCategory ? (
                            <Text
                              style={[
                                styles.scamCategory,
                                { color: getRiskScoreColor(item.unifiedRiskScore) }
                              ]}
                            >
                              {item.scamCategory === 'Standard Call' ? 'Secure Call' : item.scamCategory}
                            </Text>
                          ) : null}
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={styles.callTime}>{item.time || '--:--'}</Text>
                          <Text
                            style={[
                              styles.callScore,
                              { color: item.filterCategory === 'Missed' ? '#71717A' : getRiskScoreColor(item.unifiedRiskScore) },
                            ]}
                          >
                            {item.isSavedContact || item.filterCategory === 'Missed' ? '--' : (item.unifiedRiskScore > 0 ? `${item.unifiedRiskScore}%` : '--')}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>
            ))
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
    paddingVertical: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: -0.5,
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#18181B',
    borderRadius: 20,
    paddingHorizontal: 16,
    height: 50,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 15,
  },
  filterWrapper: {
    height: 48,
    marginVertical: 6,
    justifyContent: 'center',
  },
  filterContainer: {
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
  },
  filterPill: {
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#18181B',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  filterPillActive: {
    backgroundColor: '#3B82F6',
    borderColor: '#3B82F6',
  },
  filterText: {
    color: colors.textSecondary,
    fontSize: 13,
    fontWeight: '500',
    includeFontPadding: false,
  },
  filterTextActive: {
    color: '#FFFFFF',
    fontWeight: '600',
    includeFontPadding: false,
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.2)',
    marginVertical: 6,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 13,
    flex: 1,
  },
  retryBtn: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
  },
  retryText: {
    color: '#EF4444',
    fontSize: 12,
    fontWeight: '600',
  },
  mainScroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 4,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 80,
    paddingHorizontal: 20,
  },
  emptyIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#131316',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 20,
  },
  emptyTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '700',
  },
  emptySub: {
    color: colors.textMuted,
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
  groupHeader: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    paddingHorizontal: 4,
    letterSpacing: 0.5,
  },
  groupCard: {
    backgroundColor: '#131316',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 14,
    paddingVertical: 4,
  },
  callRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  callRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  callAvatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  callInitials: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  callInfo: {
    flex: 1,
  },
  callNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  callName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    marginRight: 8,
    flexShrink: 1,
  },
  inlineBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    marginRight: 15,
  },
  inlineBadgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  callNumber: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  scamCategory: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '500',
    marginTop: 3,
  },
  callTime: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  callScore: {
    fontSize: 14,
    fontWeight: '700',
  },
});
