// src/pages/km.js
// Log and view driven kilometres per client.

import { sb } from '../supabase.js';
import { currentUser } from '../auth.js';
import { showToast } from '../components/toast.js';
import { setLoading } from '../components/spinner.js';
import {
  isoDate, escHtml, bucketIntoCycles, cyclePeriodLabel,
  isCurrentCycle, formatDateLabel, formatMonthDay,
} from '../utils.js';

let _profile      = {};
let _clients      = [];
let _entries      = [];
let _container    = null;
let _view         = 'log'; // 'log' | 'history'

export async function mount(container, profile) {
  _container = container;
  _profile   = profile ?? {};

  const { data: clients } = await sb
    .from('clients')
    .select('id, name, km_rate')
    .eq('user_id', currentUser.id)
    .eq('archived', false)
    .order('name', { ascending: true });
  _clients = clients ?? [];

  renderLog();
}

// ── Log form ───────────────────────────────────────────────
function renderLog() {
  const lastClient = localStorage.getItem('timelog_last_client');

  _container.innerHTML = `
    <div class="card">
      <div class="field">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.4rem">
          <label class="label" style="margin-bottom:0">Client</label>
        </div>
        ${_clients.length
          ? `<select class="input" id="km-client">
               <option value="">— Select client —</option>
               ${_clients.map(c =>
                 `<option value="${c.id}"${c.id === lastClient ? ' selected' : ''}>${escHtml(c.name)}</option>`
               ).join('')}
             </select>`
          : `<div class="input" style="color:var(--text3)">No clients yet</div>
             <input type="hidden" id="km-client" value="" />`
        }
      </div>
      <div class="field">
        <label class="label" for="km-date">Date</label>
        <input class="input" type="date" id="km-date" value="${isoDate(new Date())}" />
      </div>
      <div class="field input-row">
        <div>
          <label class="label">From</label>
          <input class="input" type="text" id="km-from" placeholder="Hafnarfjörður" autocomplete="off" />
        </div>
        <div>
          <label class="label">To</label>
          <input class="input" type="text" id="km-to" placeholder="Reykjavík" autocomplete="off" />
        </div>
      </div>
      <div class="field">
        <label class="label">Kilometres</label>
        <div style="display:flex;gap:0.5rem;align-items:center">
          <input class="input" type="number" id="km-km" placeholder="0" min="0" step="0.1"
            style="flex:1" oninput="updateKmPreview()" />
          <button class="btn-xs btn-xs-outline" id="km-roundtrip-btn" onclick="toggleRoundTrip()"
            style="white-space:nowrap">↩ Round trip</button>
        </div>
        <div id="km-preview" style="font-size:0.75rem;color:var(--text3);margin-top:0.4rem"></div>
      </div>
      <div class="field">
        <label class="label">Notes <span style="font-weight:400;color:var(--text3)">(optional)</span></label>
        <input class="input" type="text" id="km-notes" placeholder="e.g. client meeting" />
      </div>
    </div>
    <button class="btn btn-primary" id="km-save-btn">Log kilometres</button>
    <button class="btn btn-ghost" style="margin-top:0.5rem" onclick="window.switchKmView('history')">
      View history
    </button>
  `;

  document.getElementById('km-save-btn')?.addEventListener('click', saveKmEntry);
  document.getElementById('km-from')?.addEventListener('keydown', e => { if (e.key === 'Enter') saveKmEntry(); });
}

let _isRoundTrip = false;

window.toggleRoundTrip = () => {
  _isRoundTrip = !_isRoundTrip;
  const btn = document.getElementById('km-roundtrip-btn');
  if (btn) {
    btn.style.background = _isRoundTrip ? 'var(--accent)' : '';
    btn.style.color      = _isRoundTrip ? '#fff' : '';
    btn.style.border     = _isRoundTrip ? 'none' : '';
  }
  updateKmPreview();
};

window.updateKmPreview = () => {
  const km   = parseFloat(document.getElementById('km-km')?.value) || 0;
  const total = _isRoundTrip ? km * 2 : km;
  const el    = document.getElementById('km-preview');
  if (!el) return;
  el.textContent = total > 0
    ? `Total: ${total.toLocaleString('is-IS', { maximumFractionDigits: 1 })} km${_isRoundTrip ? ' (round trip)' : ''}`
    : '';
};

async function saveKmEntry() {
  const clientId = document.getElementById('km-client')?.value;
  const date     = document.getElementById('km-date')?.value;
  const from     = document.getElementById('km-from')?.value.trim();
  const to       = document.getElementById('km-to')?.value.trim();
  const kmVal    = parseFloat(document.getElementById('km-km')?.value) || 0;
  const notes    = document.getElementById('km-notes')?.value.trim() || null;
  const btn      = document.getElementById('km-save-btn');

  if (!from)  { shake('km-from'); return; }
  if (!to)    { shake('km-to');   return; }
  if (!kmVal) { shake('km-km');   return; }

  const totalKm = _isRoundTrip ? kmVal * 2 : kmVal;

  setLoading(btn, true, 'Saving…');

  const { error } = await sb.from('km_entries').insert({
    user_id:      currentUser.id,
    client_id:    clientId || null,
    date,
    from_location: from,
    to_location:   to,
    kilometres:    totalKm,
    is_round_trip: _isRoundTrip,
    notes,
  });

  setLoading(btn, false, 'Log kilometres');

  if (error) { showToast('Could not save entry', 'error'); return; }

  if (clientId) localStorage.setItem('timelog_last_client', clientId);

  // Reset form fields
  document.getElementById('km-from').value  = '';
  document.getElementById('km-to').value    = '';
  document.getElementById('km-km').value    = '';
  document.getElementById('km-notes').value = '';
  _isRoundTrip = false;
  window.updateKmPreview();
  const btn2 = document.getElementById('km-roundtrip-btn');
  if (btn2) { btn2.style.background = ''; btn2.style.color = ''; btn2.style.border = ''; }

  showToast('Kilometres logged');
}

// ── History ────────────────────────────────────────────────
window.switchKmView = (view) => {
  _view = view;
  if (view === 'history') renderHistory();
  else renderLog();
};

async function renderHistory() {
  _container.innerHTML = loadingHTML();

  const { data, error } = await sb
    .from('km_entries')
    .select('*, clients(name)')
    .eq('user_id', currentUser.id)
    .order('date', { ascending: false });

  if (error) { _container.innerHTML = '<div class="empty">Failed to load.</div>'; return; }
  _entries = data ?? [];

  if (!_entries.length) {
    _container.innerHTML = `
      <button class="btn btn-ghost" style="margin-bottom:1rem" onclick="window.switchKmView('log')">← Log</button>
      <div class="empty"><div class="empty-icon">🚗</div>No km entries yet.</div>`;
    return;
  }

  const cycleStartDay = _profile?.cycle_start_day ?? 21;
  const byDate = {};
  _entries.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  const allDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const cycles   = bucketIntoCycles(allDates, cycleStartDay);

  const uninvoiced = cycles.filter(c => {
    const entries = c.dates.flatMap(d => byDate[d] ?? []);
    return entries.some(e => !e.invoice_id);
  });
  const invoiced = cycles.filter(c => {
    const entries = c.dates.flatMap(d => byDate[d] ?? []);
    return entries.length > 0 && entries.every(e => e.invoice_id);
  });

  let html = `<button class="btn btn-ghost" style="margin-bottom:1rem" onclick="window.switchKmView('log')">← Log</button>`;

  if (uninvoiced.length) {
    html += `<div class="section-label" style="margin-bottom:0.75rem">Uninvoiced</div>`;
    uninvoiced.forEach((cycle, i) => { html += renderCycle(cycle, byDate, false, `u-${i}`); });
  }
  if (invoiced.length) {
    html += `<div class="section-label" style="margin-top:1.25rem;margin-bottom:0.75rem">Invoiced</div>`;
    invoiced.forEach((cycle, i) => { html += renderCycle(cycle, byDate, true, `v-${i}`); });
  }

  _container.innerHTML = html;

  uninvoiced.forEach((cycle, i) => {
    if (!isCurrentCycle(cycle.startISO, cycle.endISO)) {
      _container.querySelector(`#km-cycle-u-${i}`)?.classList.add('collapsed');
    }
  });
  invoiced.forEach((_c, i) => {
    _container.querySelector(`#km-cycle-v-${i}`)?.classList.add('collapsed');
  });

  _container.querySelectorAll('.period-header').forEach(h => {
    h.addEventListener('click', () => h.closest('.period-block').classList.toggle('collapsed'));
  });

  _container.querySelectorAll('.km-delete').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteKmEntry(btn.dataset.id); });
  });
}

function renderCycle(cycle, byDate, isInvoiced, key) {
  const cycleDates = cycle.dates.sort((a, b) => b.localeCompare(a));
  const allEntries = cycleDates.flatMap(d => byDate[d] ?? []);
  const totalKm    = allEntries.reduce((s, e) => s + parseFloat(e.kilometres), 0);
  const label      = cyclePeriodLabel(cycle.startISO, cycle.endISO);
  const isCurrent  = isCurrentCycle(cycle.startISO, cycle.endISO);

  let html = `
    <div class="period-block" id="km-cycle-${key}">
      <div class="${isInvoiced ? 'period-header invoiced' : 'period-header'}">
        <span class="${isInvoiced ? 'period-label invoiced' : isCurrent ? 'period-label current' : 'period-label'}">
          ${isCurrent && !isInvoiced ? '● ' : ''}${escHtml(label)}
        </span>
        <div class="period-meta">
          <span class="period-total">${totalKm.toLocaleString('is-IS', { maximumFractionDigits: 1 })} km</span>
          <span class="period-chevron">▼</span>
        </div>
      </div>
      <div class="period-body">
  `;

  cycleDates.forEach(date => {
    const dayEntries = byDate[date] ?? [];
    const dayKm      = dayEntries.reduce((s, e) => s + parseFloat(e.kilometres), 0);
    html += `<div class="date-label">${escHtml(formatDateLabel(date))} · ${dayKm.toLocaleString('is-IS', { maximumFractionDigits: 1 })} km</div>`;

    dayEntries.forEach(e => {
      const canEdit = !e.invoice_id;
      html += `
        <div class="entry-card${e.invoice_id ? ' invoiced' : ''}">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:0.5rem;margin-bottom:0.35rem">
            <span class="entry-name">
              ${escHtml(e.from_location)} → ${escHtml(e.to_location)}
              ${e.is_round_trip ? '<span class="badge badge-accent">↩ return</span>' : ''}
              ${e.invoice_id ? '<span class="badge badge-green">invoiced</span>' : ''}
            </span>
            <span class="entry-hours">${parseFloat(e.kilometres).toLocaleString('is-IS', { maximumFractionDigits: 1 })} km</span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem">
            <div class="entry-time" style="margin:0">
              ${e.notes ? `<span>${escHtml(e.notes)}</span>` : '<span style="color:var(--text3)">—</span>'}
            </div>
            <div style="display:flex;align-items:center;gap:0.4rem;flex-shrink:0">
              ${e.clients?.name ? `<span class="badge badge-neutral">${escHtml(e.clients.name)}</span>` : ''}
              ${canEdit ? `
                <button class="km-delete" data-id="${e.id}"
                  style="background:var(--surface2);border:1px solid rgba(224,92,92,0.3);border-radius:6px;padding:0.25rem 0.5rem;color:var(--red);font-size:0.7rem;display:flex;align-items:center;gap:0.25rem;cursor:pointer;font-family:inherit">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="11" height="11" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                  Delete
                </button>` : ''}
            </div>
          </div>
        </div>
      `;
    });
  });

  html += `</div></div>`;
  return html;
}

async function deleteKmEntry(id) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  const { error } = await sb
    .from('km_entries').delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) { showToast('Could not delete entry', 'error'); return; }
  showToast('Entry deleted');
  renderHistory();
}

function shake(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('error');
  setTimeout(() => el.classList.remove('error'), 1500);
}

function loadingHTML() {
  return `<div class="empty"><span class="spinner" style="border-top-color:var(--accent);color:var(--border)"></span></div>`;
}
