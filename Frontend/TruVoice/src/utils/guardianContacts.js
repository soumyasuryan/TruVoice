const MAX_GUARDIAN_CONTACTS = 5;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function isValidGuardianEmail(email) {
  return EMAIL_PATTERN.test(String(email || '').trim());
}

function canAddGuardianContact(contacts, limit = MAX_GUARDIAN_CONTACTS) {
  return Array.isArray(contacts) && contacts.length < limit;
}

module.exports = {
  MAX_GUARDIAN_CONTACTS,
  canAddGuardianContact,
  isValidGuardianEmail,
};
