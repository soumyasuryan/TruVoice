import React, { useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../../theme';
import { useHistoryStore } from '../../store/historyStore';
import { useAuthStore } from '../../store/authStore';
import { getRiskScoreColor } from '../../utils/scoreColors';

export default function RecentCallList({ onSelectCall, onHistoryPress }) {
  const items = useHistoryStore((s) => s.items);
  const isLoading = useHistoryStore((s) => s.isLoading);
  const fetchHistory = useHistoryStore((s) => s.fetchHistory);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const recent = items.slice(0, 5);

  useEffect(() => {
    if (isAuthenticated && items.length === 0) {
      fetchHistory().catch(() => {});
    }
  }, [isAuthenticated, items.length, fetchHistory]);

  const getBadgeStyle = (item) => {
    const scoreColor = getRiskScoreColor(Math.max(item.aiProbability || 0, item.unifiedRiskScore || 0));
    if (item.badge) {
      const bg = item.badgeColor ? `${item.badgeColor}22` : 'rgba(255,255,255,0.08)';
      return { bg, text: item.badgeColor || '#FFFFFF', label: item.badge };
    }
    if (item.aiProbability > 60) {
      return { bg: `${scoreColor}26`, text: scoreColor, label: 'AI' };
    }
    if (item.aiProbability > 30 || item.unifiedRiskScore > 50) {
      return { bg: `${scoreColor}26`, text: scoreColor, label: 'Suspicious' };
    }
    return { bg: `${scoreColor}26`, text: scoreColor, label: 'Human' };
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.sectionTitle}>Recent calls</Text>
        <TouchableOpacity onPress={onHistoryPress} activeOpacity={0.7}>
          <Text style={styles.historyText}>History</Text>
        </TouchableOpacity>
      </View>

      {isLoading && recent.length === 0 ? (
        <View style={styles.emptyCard}>
          <ActivityIndicator size="small" color={colors.textMuted} />
          <Text style={[styles.emptySub, { marginTop: 8 }]}>Loading call history...</Text>
        </View>
      ) : recent.length === 0 ? (
        <View style={styles.emptyCard}>
          <Ionicons name="call-outline" size={28} color={colors.textMuted} style={{ marginBottom: 8 }} />
          <Text style={styles.emptyText}>No recent calls</Text>
          <Text style={styles.emptySub}>Your call history will appear here</Text>
        </View>
      ) : (
        <View style={styles.listCard}>
          {recent.map((item, index) => {
            const badge = getBadgeStyle(item);
            return (
              <TouchableOpacity
                key={item.id || index}
                activeOpacity={0.7}
                onPress={() => onSelectCall && onSelectCall(item)}
                style={[styles.callRow, index !== recent.length - 1 && styles.callRowBorder]}
              >
                <View style={styles.callAvatar}>
                  <Text style={styles.callInitials}>{item.initials || 'UC'}</Text>
                </View>
                <View style={styles.callInfo}>
                  <Text style={styles.callName} numberOfLines={1} ellipsizeMode="tail">
                    {item.name || item.number || 'Unknown'}
                  </Text>
                  <Text style={styles.callMeta}>
                    {item.dateLabel} · {item.time}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                    <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
                  </View>
                  <Text style={styles.callTime}>
                    {item.isSavedContact || item.filterCategory === 'Missed' ? '--' : (item.unifiedRiskScore > 0 ? `${item.unifiedRiskScore}%` : '--')}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 12,
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
  historyText: {
    color: '#3B82F6',
    fontSize: 14,
    fontWeight: '500',
  },
  emptyCard: {
    backgroundColor: '#131316',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingVertical: 28,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  emptyText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  emptySub: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 4,
  },
  listCard: {
    backgroundColor: '#131316',
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    paddingHorizontal: 16,
    paddingVertical: 6,
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
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#18181B',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
  },
  callInitials: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  callInfo: {
    flex: 1,
  },
  callName: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
    flexShrink: 1,
  },
  callMeta: {
    color: colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 10,
    alignSelf: 'flex-end',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  callTime: {
    color: colors.textMuted,
    fontSize: 11,
    marginTop: 4,
    textAlign: 'right',
  },
});
