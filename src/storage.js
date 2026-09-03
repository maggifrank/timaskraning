// src/storage.js
// Per-browser UI state. Nothing here is trusted — it only ever repopulates
// form fields, and the user's own content is cleared on sign-out.

export const LAST_CLIENT_KEY = 'timelog_last_client';
export const DRAFT_KEY       = 'timelog_draft';
export const KEEP_VALUES_KEY = 'timelog_keep_values';

// Keys holding content the signed-in user typed, as opposed to inert
// preferences. Cleared on sign-out so a shared browser never restores one
// user's draft into another user's form.
const PER_USER_KEYS = [DRAFT_KEY, KEEP_VALUES_KEY];

export function clearUserLocalState() {
  PER_USER_KEYS.forEach(k => localStorage.removeItem(k));
}
