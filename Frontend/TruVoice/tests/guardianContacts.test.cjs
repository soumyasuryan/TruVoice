const assert = require('node:assert/strict');
const test = require('node:test');
const {
  MAX_GUARDIAN_CONTACTS,
  canAddGuardianContact,
  isValidGuardianEmail,
} = require('../src/utils/guardianContacts');

test('validates guardian email addresses after trimming whitespace', () => {
  assert.equal(isValidGuardianEmail('  guardian@example.com  '), true);
  assert.equal(isValidGuardianEmail('not-an-email'), false);
  assert.equal(isValidGuardianEmail('missing-domain@'), false);
});

test('enforces the guardian contact limit', () => {
  assert.equal(MAX_GUARDIAN_CONTACTS, 5);
  assert.equal(canAddGuardianContact(Array(4).fill({})), true);
  assert.equal(canAddGuardianContact(Array(5).fill({})), false);
});
