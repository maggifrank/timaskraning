// src/pages/history.js
// Shows time entries and km entries grouped by payment cycle.
// Each cycle has collapsible Hours and Kilometres subsections.

import { sb } from '../supabase.js';
import { currentUser } from '../auth.js';
import { showToast } from '../components/toast.js';
import { setLoading } from '../components/spinner.js';
import {
  formatDuration, formatTime, formatDateLabel, formatMonthDay,
  bucketIntoCycles, cyclePeriodLabel,
  isCurrentCycle, escHtml, isoDate, calcMinutes,
} from '../utils.js';

let _cycleStartDay = 21;
let _entries       = [];
let _kmEntries     = [];
let _clients       = [];
let _container     = null;

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINS  = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

export async function mount(container, profile) {
  _container     = container;
  _cycleStartDay = profile?.cycle_start_day ?? 21;
  container.innerHTML = loadingHTML();

  const { data: clients } = await sb
    .from('clients')
    .select('id, name')
    .eq('user_id', currentUser.id)
    .eq('archived', false)
    .order('name', { ascending: true });
  _clients = clients ?? [];

  await refresh();
  setupModals();
}

export async function refresh() {
  if (!_container) return;

  const [{ data: entries, error }, { data: kmEntries, error: kmError }] = await Promise.all([
    sb.from('entries')
      .select('*, clients(name)')
      .eq('user_id', currentUser.id)
      .order('date', { ascending: false })
      .order('time_from', { ascending: false }),
    sb.from('km_entries')
      .select('*, clients(name)')
      .eq('user_id', currentUser.id)
      .order('date', { ascending: false }),
  ]);

  if (error || kmError) {
    _container.innerHTML = `<div class="empty">Failed to load entries.</div>`;
    return;
  }

  _entries   = entries   ?? [];
  _kmEntries = kmEntries ?? [];

  if (!_entries.length && !_kmEntries.length) {
    _container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">⏱</div>
        No entries yet.<br>Log your first shift or trip.
      </div>`;
    return;
  }

  render();
}

function render() {
  const totalMins = _entries.reduce((s, e) => s + e.minutes, 0);
  const totalKm   = _kmEntries.reduce((s, e) => s + parseFloat(e.kilometres), 0);

  // Collect all unique dates across both entry types
  const allDates = [...new Set([
    ..._entries.map(e => e.date),
    ..._kmEntries.map(e => e.date),
  ])].sort((a, b) => b.localeCompare(a));

  const cycles = bucketIntoCycles(allDates, _cycleStartDay);

  const uninvoiced = [];
  const invoiced   = [];

  cycles.forEach(cycle => {
    const cycleTimeEntries = _entries.filter(e => cycle.dates.includes(e.date));
    const cycleKmEntries   = _kmEntries.filter(e => cycle.dates.includes(e.date));
    const allEntries       = [...cycleTimeEntries, ...cycleKmEntries];
    const allInvoiced      = allEntries.length > 0 && allEntries.every(e => e.invoice_id);
    if (allInvoiced) invoiced.push(cycle);
    else uninvoiced.push(cycle);
  });

  let html = `
    <div class="summary-strip">
      <span class="summary-strip-label">All time</span>
      <span class="summary-strip-value">${formatDuration(totalMins)}</span>
      ${totalKm > 0 ? `<span class="summary-strip-label" style="margin-left:1rem">KM</span>
      <span class="summary-strip-value">${totalKm.toLocaleString('is-IS', { maximumFractionDigits: 1 })}</span>` : ''}
    </div>
  `;

  if (uninvoiced.length) {
    html += `<div class="section-label" style="margin-bottom:0.75rem">Uninvoiced</div>`;
    uninvoiced.forEach((cycle, i) => { html += renderCycle(cycle, false, `u-${i}`); });
  }

  if (invoiced.length) {
    html += `<div class="section-label" style="margin-top:1.25rem;margin-bottom:0.75rem">Invoiced</div>`;
    invoiced.forEach((cycle, i) => { html += renderCycle(cycle, true, `v-${i}`); });
  }

  _container.innerHTML = html;

  uninvoiced.forEach((cycle, i) => {
    if (!isCurrentCycle(cycle.startISO, cycle.endISO)) {
      _container.querySelector(`#cycle-u-${i}`)?.classList.add('collapsed');
    }
  });
  invoiced.forEach((_c, i) => {
    _container.querySelector(`#cycle-v-${i}`)?.classList.add('collapsed');
  });

  // Collapse subsections by default on invoiced cycles
  _container.querySelectorAll('.period-header').forEach(h => {
    h.addEventListener('click', () => h.closest('.period-block').classList.toggle('collapsed'));
  });
  _container.querySelectorAll('.subsection-header').forEach(h => {
    h.addEventListener('click', () => h.closest('.subsection-block').classList.toggle('collapsed'));
  });

  _container.querySelectorAll('.entry-edit').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditModal(btn.dataset.id); });
  });
  _container.querySelectorAll('.entry-delete').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteEntry(btn.dataset.id); });
  });
  _container.querySelectorAll('.km-edit').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openKmEditModal(btn.dataset.id); });
  });
  _container.querySelectorAll('.km-delete').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteKmEntry(btn.dataset.id); });
  });
}

function renderCycle(cycle, isInvoiced, key) {
  const cycleTimeEntries = _entries.filter(e => cycle.dates.includes(e.date));
  const cycleKmEntries   = _kmEntries.filter(e => cycle.dates.includes(e.date));
  const cycleMins        = cycleTimeEntries.reduce((s, e) => s + e.minutes, 0);
  const cycleKm          = cycleKmEntries.reduce((s, e) => s + parseFloat(e.kilometres), 0);
  const label            = cyclePeriodLabel(cycle.startISO, cycle.endISO);
  const isCurrent        = isCurrentCycle(cycle.startISO, cycle.endISO);

  const invoicedAt    = cycleTimeEntries[0]?.invoiced_at ?? cycleKmEntries[0]?.invoiced_at;
  const invoicedLabel = invoicedAt ? ` · Invoiced ${formatMonthDay(invoicedAt.slice(0, 10))}` : '';

  const headerClass = isInvoiced ? 'period-header invoiced' : 'period-header';
  const labelClass  = isInvoiced ? 'period-label invoiced'
                    : isCurrent  ? 'period-label current'
                    :              'period-label';

  const summaryParts = [];
  if (cycleMins > 0) summaryParts.push(formatDuration(cycleMins));
  if (cycleKm > 0)   summaryParts.push(`${cycleKm.toLocaleString('is-IS', { maximumFractionDigits: 1 })} km`);

  let html = `
    <div class="period-block" id="cycle-${key}">
      <div class="${headerClass}">
        <span class="${labelClass}">
          ${isCurrent && !isInvoiced ? '● ' : ''}${escHtml(label)}${escHtml(invoicedLabel)}
        </span>
        <div class="period-meta">
          <span class="period-total">${summaryParts.join(' · ')}</span>
          <span class="period-chevron">▼</span>
        </div>
      </div>
      <div class="period-body">
  `;

  // ── Hours subsection ──
  if (cycleTimeEntries.length) {
    const dates = [...new Set(cycleTimeEntries.map(e => e.date))].sort((a, b) => b.localeCompare(a));
    html += `
      <div class="subsection-block">
        <div class="subsection-header">
          <span class="subsection-label">⏱ Hours</span>
          <span class="subsection-total">${formatDuration(cycleMins)}</span>
        </div>
        <div class="subsection-body">
    `;
    dates.forEach(date => {
      const dayEntries = cycleTimeEntries.filter(e => e.date === date);
      const dayMins    = dayEntries.reduce((s, e) => s + e.minutes, 0);
      html += `<div class="date-label">${escHtml(formatDateLabel(date))} · ${formatDuration(dayMins)}</div>`;
      dayEntries.forEach(e => {
        const canEdit = !e.invoice_id;
        html += `
          <div class="entry-card${e.invoice_id ? ' invoiced' : ''}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-bottom:0.35rem">
              <span class="entry-name">
                ${escHtml(e.name)}
                ${e.crosses_midnight ? '<span class="badge badge-accent">+midnight</span>' : ''}
                ${e.invoice_id ? '<span class="badge badge-green">invoiced</span>' : ''}
              </span>
              <div style="display:flex;align-items:center;gap:0.4rem;flex-shrink:0">
                <span class="entry-hours">${formatDuration(e.minutes)}</span>
                ${canEdit ? `
                  <button class="entry-edit" data-id="${e.id}"
                    style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:0.25rem 0.5rem;color:var(--text3);font-size:0.7rem;display:flex;align-items:center;gap:0.25rem;cursor:pointer;font-family:inherit">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="11" height="11" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    Edit
                  </button>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem">
              <div class="entry-time" style="margin:0">
                <span>${formatTime(e.time_from)}</span>
                <span>→</span>
                <span>${formatTime(e.time_until)}</span>
                ${e.crosses_midnight ? '<span class="badge badge-accent" style="margin-left:0.25rem">next day</span>' : ''}
              </div>
              <div style="display:flex;align-items:center;gap:0.4rem">
                ${e.clients?.name ? `<span class="badge badge-neutral">${escHtml(e.clients.name)}</span>` : ''}
                ${canEdit ? `
                  <button class="entry-delete" data-id="${e.id}"
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
  }

  // ── KM subsection ──
  if (cycleKmEntries.length) {
    const dates = [...new Set(cycleKmEntries.map(e => e.date))].sort((a, b) => b.localeCompare(a));
    html += `
      <div class="subsection-block">
        <div class="subsection-header">
          <span class="subsection-label">🚗 Kilometres</span>
          <span class="subsection-total">${cycleKm.toLocaleString('is-IS', { maximumFractionDigits: 1 })} km</span>
        </div>
        <div class="subsection-body">
    `;
    dates.forEach(date => {
      const dayEntries = cycleKmEntries.filter(e => e.date === date);
      const dayKm      = dayEntries.reduce((s, e) => s + parseFloat(e.kilometres), 0);
      html += `<div class="date-label">${escHtml(formatDateLabel(date))} · ${dayKm.toLocaleString('is-IS', { maximumFractionDigits: 1 })} km</div>`;
      dayEntries.forEach(e => {
        const canEdit = !e.invoice_id;
        html += `
          <div class="entry-card${e.invoice_id ? ' invoiced' : ''}">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:0.5rem;margin-bottom:0.35rem">
              <span class="entry-name">
                ${escHtml(e.from_location)} → ${escHtml(e.to_location)}
                ${e.is_round_trip ? '<span class="badge badge-accent">↩ return</span>' : ''}
                ${e.invoice_id ? '<span class="badge badge-green">invoiced</span>' : ''}
              </span>
              <div style="display:flex;align-items:center;gap:0.4rem;flex-shrink:0">
                <span class="entry-hours">${parseFloat(e.kilometres).toLocaleString('is-IS', { maximumFractionDigits: 1 })} km</span>
                ${canEdit ? `
                  <button class="km-edit" data-id="${e.id}"
                    style="background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:0.25rem 0.5rem;color:var(--text3);font-size:0.7rem;display:flex;align-items:center;gap:0.25rem;cursor:pointer;font-family:inherit">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" width="11" height="11" stroke-width="2">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                    Edit
                  </button>` : ''}
              </div>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:0.4rem">
              <div class="entry-time" style="margin:0">
                ${e.notes ? `<span>${escHtml(e.notes)}</span>` : '<span style="color:var(--text3)">—</span>'}
              </div>
              <div style="display:flex;align-items:center;gap:0.4rem">
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
  }

  html += `</div></div>`;
  return html;
}

// ── Time entry edit modal ──────────────────────────────────
function setupModals() {
  ['edit-from-h','edit-until-h'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">HH</option>' +
      HOURS.map(h => `<option value="${h}">${h}</option>`).join('');
  });
  ['edit-from-m','edit-until-m'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">MM</option>' +
      MINS.map(m => `<option value="${m}">${m}</option>`).join('');
  });

  const clientSel = document.getElementById('edit-client');
  if (clientSel) {
    clientSel.innerHTML = '<option value="">— Select client —</option>' +
      _clients.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  }

  const kmClientSel = document.getElementById('km-edit-client');
  if (kmClientSel) {
    kmClientSel.innerHTML = '<option value="">— Select client —</option>' +
      _clients.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  }

  ['edit-from-h','edit-from-m','edit-until-h','edit-until-m'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateEditDuration);
  });

  document.getElementById('edit-save-btn')?.addEventListener('click', saveEdit);
  document.getElementById('edit-cancel-btn')?.addEventListener('click', () => closeModal('edit-modal'));
  document.getElementById('km-edit-save-btn')?.addEventListener('click', saveKmEdit);
  document.getElementById('km-edit-cancel-btn')?.addEventListener('click', () => closeModal('km-edit-modal'));

  ['edit-modal','km-edit-modal'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target === document.getElementById(id)) closeModal(id);
    });
  });
}

function openEditModal(id) {
  const entry = _entries.find(e => e.id === id);
  if (!entry) return;

  document.getElementById('edit-id').value   = entry.id;
  document.getElementById('edit-name').value = entry.name;
  document.getElementById('edit-date').value = entry.date;

  const clientSel = document.getElementById('edit-client');
  if (clientSel && entry.client_id) clientSel.value = entry.client_id;

  const [fh, fm] = entry.time_from.split(':');
  const [uh, um] = entry.time_until.split(':');
  document.getElementById('edit-from-h').value  = fh.padStart(2, '0');
  document.getElementById('edit-from-m').value  = roundMin(fm);
  document.getElementById('edit-until-h').value = uh.padStart(2, '0');
  document.getElementById('edit-until-m').value = roundMin(um);

  updateEditDuration();
  document.getElementById('edit-modal').classList.add('open');
}

function openKmEditModal(id) {
  const entry = _kmEntries.find(e => e.id === id);
  if (!entry) return;

  document.getElementById('km-edit-id').value    = entry.id;
  document.getElementById('km-edit-date').value  = entry.date;
  document.getElementById('km-edit-from').value  = entry.from_location;
  document.getElementById('km-edit-to').value    = entry.to_location;
  document.getElementById('km-edit-km').value    = parseFloat(entry.kilometres);
  document.getElementById('km-edit-notes').value = entry.notes ?? '';

  const clientSel = document.getElementById('km-edit-client');
  if (clientSel && entry.client_id) clientSel.value = entry.client_id;

  const rtBtn = document.getElementById('km-edit-roundtrip');
  if (rtBtn) {
    rtBtn.dataset.active = entry.is_round_trip ? 'true' : 'false';
    rtBtn.style.background = entry.is_round_trip ? 'var(--accent)' : '';
    rtBtn.style.color      = entry.is_round_trip ? '#fff' : '';
  }

  document.getElementById('km-edit-modal').classList.add('open');
}

function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
}

function updateEditDuration() {
  const from  = getTime('edit-from');
  const until = getTime('edit-until');
  const val   = document.getElementById('edit-duration-value');
  const mid   = document.getElementById('edit-midnight');
  if (!from || !until) { val.textContent = '—'; mid.innerHTML = ''; return; }
  const { minutes, crossesMidnight } = calcMinutes(from, until);
  val.textContent = formatDuration(minutes);
  mid.innerHTML   = crossesMidnight ? '<span class="midnight-tag">↻ Crosses midnight</span>' : '';
}

async function saveEdit() {
  const id       = document.getElementById('edit-id').value;
  const clientId = document.getElementById('edit-client').value;
  const name     = document.getElementById('edit-name').value.trim();
  const date     = document.getElementById('edit-date').value;
  const from     = getTime('edit-from');
  const until    = getTime('edit-until');
  const btn      = document.getElementById('edit-save-btn');

  if (!name)  { shake('edit-name');    return; }
  if (!date)  { shake('edit-date');    return; }
  if (!from)  { shake('edit-from-h'); return; }
  if (!until) { shake('edit-until-h'); return; }

  const { minutes, crossesMidnight } = calcMinutes(from, until);
  setLoading(btn, true, 'Saving…');

  const { error } = await sb.from('entries').update({
    client_id:        clientId || null,
    name, date,
    time_from:        from,
    time_until:       until,
    minutes,
    crosses_midnight: crossesMidnight,
  }).eq('id', id).eq('user_id', currentUser.id);

  setLoading(btn, false, 'Save changes');
  if (error) { showToast('Could not save entry', 'error'); return; }
  showToast('Entry updated');
  closeModal('edit-modal');
  await refresh();
}

async function saveKmEdit() {
  const id       = document.getElementById('km-edit-id').value;
  const clientId = document.getElementById('km-edit-client').value;
  const date     = document.getElementById('km-edit-date').value;
  const from     = document.getElementById('km-edit-from').value.trim();
  const to       = document.getElementById('km-edit-to').value.trim();
  const km       = parseFloat(document.getElementById('km-edit-km').value) || 0;
  const notes    = document.getElementById('km-edit-notes').value.trim() || null;
  const isRT     = document.getElementById('km-edit-roundtrip')?.dataset.active === 'true';
  const btn      = document.getElementById('km-edit-save-btn');

  if (!from) { shake('km-edit-from'); return; }
  if (!to)   { shake('km-edit-to');   return; }
  if (!km)   { shake('km-edit-km');   return; }

  setLoading(btn, true, 'Saving…');

  const { error } = await sb.from('km_entries').update({
    client_id:     clientId || null,
    date, notes,
    from_location: from,
    to_location:   to,
    kilometres:    km,
    is_round_trip: isRT,
  }).eq('id', id).eq('user_id', currentUser.id);

  setLoading(btn, false, 'Save changes');
  if (error) { showToast('Could not save entry', 'error'); return; }
  showToast('KM entry updated');
  closeModal('km-edit-modal');
  await refresh();
}

async function deleteEntry(id) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  await sb.from('invoice_entries').delete().eq('entry_id', id);
  const { error } = await sb.from('entries').delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) { showToast('Could not delete entry', 'error'); return; }
  showToast('Entry deleted');
  await refresh();
}

async function deleteKmEntry(id) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  const { error } = await sb.from('km_entries').delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) { showToast('Could not delete entry', 'error'); return; }
  showToast('KM entry deleted');
  await refresh();
}

// ── Helpers ────────────────────────────────────────────────
function getTime(prefix) {
  const h = document.getElementById(`${prefix}-h`)?.value;
  const m = document.getElementById(`${prefix}-m`)?.value;
  return (h && m) ? `${h}:${m}` : '';
}

function roundMin(m) {
  const rounded = String(Math.round(parseInt(m) / 5) * 5 % 60).padStart(2, '0');
  return MINS.includes(rounded) ? rounded : '00';
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
