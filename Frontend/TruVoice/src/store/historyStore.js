import { create } from 'zustand';
import { analysisService } from '../services/analysis/analysisService';
import { mapHistoryItem } from '../utils/analysisMapper';

import { useContactsStore } from './contactsStore';
import { useAuthStore } from './authStore';

export const useHistoryStore = create((set, get) => ({
  items: [],
  isLoading: false,
  error: null,

  fetchHistory: async () => {
    set({ isLoading: true, error: null });
    try {
      let contacts = useContactsStore.getState().contacts;
      if (!contacts || contacts.length === 0) {
        await useContactsStore.getState().loadContacts();
        contacts = useContactsStore.getState().contacts;
      }
      const rawItems = await analysisService.fetchHistory();
      const items = rawItems.map((item) => mapHistoryItem(item, contacts));
      set({ items, isLoading: false });
      return items;
    } catch (error) {
      set({ isLoading: false, error: error.message });
      throw error;
    }
  },

  prependItem: (analysisItem) => {
    const contacts = useContactsStore.getState().contacts;
    const mapped = mapHistoryItem(analysisItem, contacts);
    set({ items: [mapped, ...get().items.filter((i) => i.id !== mapped.id)] });
  },

  refreshContactNames: () => {
    const contacts = useContactsStore.getState().contacts;
    if (!contacts.length || !get().items.length) return;
    set({
      items: get().items.map((item) => mapHistoryItem(item, contacts)),
    });
  },

  addMissedCall: ({ callId, callerName, callerNumber, callerUserId }) => {
    const contacts = useContactsStore.getState().contacts;
    const currentUser = useAuthStore.getState().user;
    const missedItem = mapHistoryItem(
      {
        id: callId || `missed_${Date.now()}`,
        caller_number: callerNumber || 'App-to-App',
        target_user_id: currentUser?.id || '',
        caller_id: callerUserId || '',
        caller_name: callerName || '',
        status: 'missed',
        created_at: new Date().toISOString(),
        ai_voice_probability: 0,
        scam_intent_score: 0,
        unified_risk_score: 0,
        risk_level: 'LOW RISK',
        scam_category: '',
        duration: 0,
        transcript: '',
        flagged_keywords: [],
        reasoning: 'Missed call — not answered',
      },
      contacts,
    );
    set({ items: [missedItem, ...get().items.filter((i) => i.id !== missedItem.id)] });
  },

  getRecentCalls: (limit = 5) => get().items.slice(0, limit),

  clear: () => set({ items: [], error: null }),
}));

export default useHistoryStore;
