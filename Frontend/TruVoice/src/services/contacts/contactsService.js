import * as Contacts from 'expo-contacts';
import { Alert } from 'react-native';

const GRADIENT_PALETTES = [
  ['#3B82F6', '#6366F1'],
  ['#F97316', '#EC4899'],
  ['#22C55E', '#10B981'],
  ['#8B5CF6', '#3B82F6'],
  ['#EC4899', '#F97316'],
  ['#6366F1', '#A855F7'],
];

export async function requestContactsPermission() {
  try {
    const { status } = await Contacts.requestPermissionsAsync();
    return status === 'granted';
  } catch (error) {
    console.error('Error requesting contacts permission:', error);
    return false;
  }
}

export async function fetchDeviceContacts() {
  try {
    const { status } = await Contacts.getPermissionsAsync();
    let isGranted = status === 'granted';

    if (!isGranted) {
      isGranted = await requestContactsPermission();
    }

    if (!isGranted) {
      return { granted: false, contacts: [] };
    }

    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Emails],
      sort: Contacts.SortTypes.FirstName,
    });

    if (!data || data.length === 0) {
      return { granted: true, contacts: [] };
    }

    const formatted = data
      .filter((c) => c.name && c.name.trim().length > 0)
      .map((c, index) => {
        const name = c.name.trim();
        const words = name.split(' ');
        const initials =
          words.length >= 2
            ? `${words[0][0]}${words[1][0]}`.toUpperCase()
            : name.slice(0, 2).toUpperCase();

        const phoneNumber =
          c.phoneNumbers && c.phoneNumbers.length > 0
            ? c.phoneNumbers[0].number
            : '';

        const palette = GRADIENT_PALETTES[index % GRADIENT_PALETTES.length];

        return {
          id: c.id || `device_${index}`,
          name,
          number: phoneNumber,
          handle: `@${name.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
          initials,
          colors: palette,
          isOnline: index % 3 === 0,
          status: index % 2 === 0 ? 'Online' : 'Last seen recently',
        };
      });

    return { granted: true, contacts: formatted };
  } catch (error) {
    console.error('Error fetching device contacts:', error);
    return { granted: false, contacts: [] };
  }
}
