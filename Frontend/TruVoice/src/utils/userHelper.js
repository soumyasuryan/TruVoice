/**
 * Returns an effective display user name for the authenticated user.
 * Falls back to name derived from email or phone if user.name is default/empty.
 */
export const getEffectiveUserName = (user) => {
  if (user?.name && user.name !== 'TruVoice User' && user.name.trim() !== '') {
    return user.name.trim();
  }
  if (user?.email && user.email.includes('@')) {
    const username = user.email.split('@')[0];
    const formatted = username
      .replace(/[._-]/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    if (formatted && formatted.trim()) return formatted.trim();
  }
  if (user?.phone_number || user?.phone) {
    const p = String(user.phone_number || user.phone);
    return `User ${p.slice(-4)}`;
  }
  return 'User';
};

export const getEffectiveUserInitials = (user) => {
  const name = getEffectiveUserName(user);
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || 'TV';
};

export default {
  getEffectiveUserName,
  getEffectiveUserInitials,
};
