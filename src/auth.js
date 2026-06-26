// src/auth.js
// Handles all authentication state and UI.

import { sb, ENV } from './supabase.js';
import { showToast } from './components/toast.js';
import { setLoading } from './components/spinner.js';

export let currentUser = null;

// Called once on app start. Resolves when auth state is known.
export async function initAuth(onSignedIn, onSignedOut) {
  const { data: { session } } = await sb.auth.getSession();
  currentUser = session?.user ?? null;

  sb.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user ?? null;
    if (currentUser) onSignedIn(currentUser);
    else onSignedOut();
  });

  if (currentUser) onSignedIn(currentUser);
  else onSignedOut();
}

export async function signOut() {
  await sb.auth.signOut();
}

// ── Auth UI ────────────────────────────────────────────────────
let _authMode = 'login';

export function mountAuthUI() {
  document.getElementById('auth-login-tab')
    ?.addEventListener('click', () => switchAuthTab('login'));
  document.getElementById('auth-signup-tab')
    ?.addEventListener('click', () => switchAuthTab('signup'));
  document.getElementById('auth-submit-btn')
    ?.addEventListener('click', handleAuthSubmit);
  document.getElementById('auth-password')
    ?.addEventListener('keydown', e => { if (e.key === 'Enter') handleAuthSubmit(); });
}

function switchAuthTab(mode) {
  _authMode = mode;
  document.getElementById('auth-login-tab')
    ?.classList.toggle('active', mode === 'login');
  document.getElementById('auth-signup-tab')
    ?.classList.toggle('active', mode === 'signup');
  document.getElementById('auth-submit-btn').textContent =
    mode === 'login' ? 'Sign in' : 'Create account';
  setAuthMessage('', '');
}

async function handleAuthSubmit() {
  const email    = document.getElementById('auth-email')?.value.trim();
  const password = document.getElementById('auth-password')?.value;
  const btn      = document.getElementById('auth-submit-btn');

  setAuthMessage('', '');
  if (!email || !password) { setAuthMessage('Please fill in all fields.', 'error'); return; }

  setLoading(btn, true, _authMode === 'login' ? 'Signing in…' : 'Creating account…');

  let error;
  if (_authMode === 'login') {
    ({ error } = await sb.auth.signInWithPassword({ email, password }));
  } else {
    ({ error } = await sb.auth.signUp({ email, password }));
  }

  setLoading(btn, false, _authMode === 'login' ? 'Sign in' : 'Create account');

  if (error) { setAuthMessage(error.message, 'error'); return; }
  if (_authMode === 'signup') {
    setAuthMessage('Check your email to confirm your account.', 'success');
  }
}

function setAuthMessage(msg, type) {
  const el = document.getElementById('auth-message');
  if (!el) return;
  el.textContent = msg;
  el.className   = type === 'error' ? 'auth-error' : 'auth-success';
}
