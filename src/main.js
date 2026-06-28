// src/main.js
// App entry point. Wires together auth, routing, and pages.

import { sb, ENV } from './supabase.js';
import { initAuth, signOut, mountAuthUI, currentUser } from './auth.js';
import { register, start, navigate }  from './router.js';
import { showToast } from './components/toast.js';

import * as LogPage      from './pages/log.js';
import * as HistoryPage  from './pages/history.js';
import * as KmPage       from './pages/km.js';
import * as SettingsPage from './pages/settings.js';

// ── Profile (shared mutable state) ────────────────────────────
let profile = {};

async function loadProfile() {
  const { data } = await sb
    .from('profiles')
    .select('*')
    .eq('id', currentUser.id)
    .maybeSingle();
  profile = data ?? {};
}

// ── Page container ─────────────────────────────────────────────
function getPageEl(id) {
  return document.getElementById(id);
}

function activatePage(id) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(id)?.classList.add('active');
}

// ── Routes ─────────────────────────────────────────────────────
function setupRoutes() {
  register('/', () => {
    activatePage('page-log');
    LogPage.mount(getPageEl('page-log'));
  });

  register('/history', () => {
    activatePage('page-history');
    HistoryPage.mount(getPageEl('page-history'), profile);
  });

  register('/km', () => {
    activatePage('page-km');
    KmPage.mount(getPageEl('page-km'), profile);
  });

  register('/settings', () => {
    activatePage('page-settings');
    SettingsPage.mount(getPageEl('page-settings'), profile);
  });
}

// ── Auth lifecycle ─────────────────────────────────────────────
async function onSignedIn(user) {
  await loadProfile();
  document.getElementById('auth-screen').style.display  = 'none';
  document.getElementById('app-screen').style.display   = 'block';
  document.getElementById('loading-overlay').style.display = 'none';

  // Topbar
  document.getElementById('topbar-user').textContent = user.email;
  const badge = document.getElementById('env-badge');
  if (ENV === 'dev') { badge.textContent = 'dev'; badge.className = 'env-badge dev'; }
  else badge.className = 'env-badge';

  setupRoutes();
  start('/');
}

function onSignedOut() {
  document.getElementById('auth-screen').style.display   = 'flex';
  document.getElementById('app-screen').style.display    = 'none';
  document.getElementById('loading-overlay').style.display = 'none';
}

// ── Boot ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  mountAuthUI();

  document.getElementById('topbar-signout')
    ?.addEventListener('click', signOut);

  initAuth(onSignedIn, onSignedOut);
});
