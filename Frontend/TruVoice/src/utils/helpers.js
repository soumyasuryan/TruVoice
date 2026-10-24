export const getInitials = (name = '') => {
  if (!name.trim()) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

export const getGreeting = () => {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
};

export const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

export const generateId = () =>
  `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const truncate = (text, maxLength = 24) => {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}…`;
};

export default {
  getInitials,
  getGreeting,
  clamp,
  generateId,
  delay,
  truncate,
};
