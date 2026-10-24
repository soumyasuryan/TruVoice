import { create } from 'zustand';
import { fetchDeviceContacts, requestContactsPermission } from '../services/contacts/contactsService';

export const useContactsStore = create((set, get) => ({
  contacts: [],
  permissionGranted: false,
  isLoading: false,
  searchQuery: '',

  setContacts: (contacts) => set({ contacts }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),

  loadContacts: async () => {
    set({ isLoading: true });
    const { granted, contacts } = await fetchDeviceContacts();
    set({
      permissionGranted: granted,
      contacts: contacts,
      isLoading: false,
    });
  },

  requestPermissionAndLoad: async () => {
    set({ isLoading: true });
    const granted = await requestContactsPermission();
    if (granted) {
      const result = await fetchDeviceContacts();
      set({
        permissionGranted: true,
        contacts: result.contacts,
        isLoading: false,
      });
    } else {
      set({
        permissionGranted: false,
        isLoading: false,
      });
    }
  },
}));

export default useContactsStore;
