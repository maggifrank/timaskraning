// src/pages/history.js
// Shows entries grouped by payment cycle.
// Uninvoiced periods appear at the top, invoiced periods below — collapsed by default.

import { sb } from '../supabase.js';
import { currentUser } from '../auth.js';
import { showToast } from '../components/toast.js';
import { setLoading } from '../components/spinner.js';
import {
  formatDuration, formatTime, formatDateLabel, formatMonthDay,
  timeToPercent, bucketIntoCycles, cyclePeriodLabel,
  isCurrentCycle, escHtml, isoDate, calcMinutes,
} from '../utils.js';

let _cycleStartDay = 21;
let _entries       = [];
let _clients       = [];
let _container     = null;

const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINS  = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

export async function mount(container, profile) {
  _container     = container;
  _cycleStartDay = profile?.cycle_start_day ?? 21;
  container.innerHTML = loadingHTML();

  // Load clients for the edit modal dropdown
  const { data: clients } = await sb
    .from('clients')
    .select('id, name')
    .eq('user_id', currentUser.id)
    .eq('archived', false)
    .order('name', { ascending: true });
  _clients = clients ?? [];

  await refresh();
  setupEditModal();
}

export async function refresh() {
  if (!_container) return;

  const { data, error } = await sb
    .from('entries')
    .select('*, clients(name)')
    .eq('user_id', currentUser.id)
    .order('date', { ascending: false })
    .order('time_from', { ascending: false });

  if (error) {
    _container.innerHTML = `<div class="empty">Failed to load entries.</div>`;
    return;
  }

  _entries = data ?? [];

  if (!_entries.length) {
    _container.innerHTML = `
      <div class="empty">
        <div class="empty-icon">⏱</div>
        No entries yet.<br>Log your first shift.
      </div>`;
    return;
  }

  render();
}

function render() {
  const totalMins = _entries.reduce((s, e) => s + e.minutes, 0);

  const byDate = {};
  _entries.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  const allDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const cycles   = bucketIntoCycles(allDates, _cycleStartDay);

  const uninvoiced = [];
  const invoiced   = [];

  cycles.forEach(cycle => {
    const cycleEntries = cycle.dates.flatMap(d => byDate[d] ?? []);
    const allInvoiced  = cycleEntries.length > 0 && cycleEntries.every(e => e.invoice_id);
    if (allInvoiced) invoiced.push(cycle);
    else uninvoiced.push(cycle);
  });

  let html = `
    <div class="summary-strip">
      <span class="summary-strip-label">All time</span>
      <span class="summary-strip-value">${formatDuration(totalMins)}</span>
    </div>
  `;

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
      _container.querySelector(`#cycle-u-${i}`)?.classList.add('collapsed');
    }
  });
  invoiced.forEach((_c, i) => {
    _container.querySelector(`#cycle-v-${i}`)?.classList.add('collapsed');
  });

  _container.querySelectorAll('.period-header').forEach(header => {
    header.addEventListener('click', () => header.closest('.period-block').classList.toggle('collapsed'));
  });

  _container.querySelectorAll('.entry-delete').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); deleteEntry(btn.dataset.id); });
  });

  _container.querySelectorAll('.entry-edit').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); openEditModal(btn.dataset.id); });
  });
}

function renderCycle(cycle, byDate, isInvoiced, key) {
  const cycleDates  = cycle.dates.sort((a, b) => b.localeCompare(a));
  const allEntries  = cycleDates.flatMap(d => byDate[d] ?? []);
  const cycleMins   = allEntries.reduce((s, e) => s + e.minutes, 0);
  const label       = cyclePeriodLabel(cycle.startISO, cycle.endISO);
  const isCurrent   = isCurrentCycle(cycle.startISO, cycle.endISO);

  const invoicedAt    = allEntries[0]?.invoiced_at;
  const invoicedLabel = invoicedAt ? ` · Invoiced ${formatMonthDay(invoicedAt.slice(0, 10))}` : '';

  const headerClass = isInvoiced ? 'period-header invoiced' : 'period-header';
  const labelClass  = isInvoiced ? 'period-label invoiced'
                    : isCurrent  ? 'period-label current'
                    :              'period-label';

  let html = `
    <div class="period-block" id="cycle-${key}">
      <div class="${headerClass}">
        <span class="${labelClass}">
          ${isCurrent && !isInvoiced ? '● ' : ''}${escHtml(label)}${escHtml(invoicedLabel)}
        </span>
        <div class="period-meta">
          <span class="period-total">${formatDuration(cycleMins)}</span>
          <span class="period-chevron">▼</span>
        </div>
      </div>
      <div class="period-body">
  `;

  cycleDates.forEach(date => {
    const dayEntries = byDate[date] ?? [];
    const dayMins    = dayEntries.reduce((s, e) => s + e.minutes, 0);
    html += `<div class="date-label">${escHtml(formatDateLabel(date))} · ${formatDuration(dayMins)}</div>`;

    dayEntries.forEach(e => {
      const fromPct  = timeToPercent(e.time_from);
      const untilPct = e.crosses_midnight ? 100 : timeToPercent(e.time_until);
      const barW     = Math.max(untilPct - fromPct, 1.5);
      const canEdit  = !e.invoice_id;

      html += `
        <div class="entry-card${e.invoice_id ? ' invoiced' : ''}">
          <div class="entry-card-top">
            <span class="entry-name">
              ${escHtml(e.name)}
              ${e.crosses_midnight ? '<span class="badge badge-accent">+midnight</span>' : ''}
              ${e.invoice_id ? '<span class="badge badge-green">invoiced</span>' : ''}
            </span>
            <span class="entry-hours">${formatDuration(e.minutes)}</span>
          </div>
          <div class="entry-time">
            <span>${formatTime(e.time_from)}</span>
            <span>→</span>
            <span>${formatTime(e.time_until)}</span>
            ${e.crosses_midnight ? '<span class="badge badge-accent" style="margin-left:0.25rem">next day</span>' : ''}
            ${e.clients?.name ? `<span class="badge badge-neutral" style="margin-left:auto">${escHtml(e.clients.name)}</span>` : ''}
          </div>
          <div class="time-bar">
            <div class="time-bar-fill" style="left:${fromPct}%;width:${barW}%"></div>
          </div>
          ${canEdit ? `
            <div style="display:flex;gap:0.4rem;position:absolute;top:0.625rem;right:0.625rem">
              <button class="btn-icon entry-edit" data-id="${e.id}" title="Edit entry">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" width="14" height="14" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <button class="btn-icon entry-delete" data-id="${e.id}" title="Delete entry">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" width="14" height="14" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>` : ''}
        </div>
      `;
    });
  });

  html += `</div></div>`;
  return html;
}

// ── Edit modal ─────────────────────────────────────────────────
function setupEditModal() {
  // Populate hour/minute selects
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

  // Populate client dropdown
  const clientSel = document.getElementById('edit-client');
  if (clientSel) {
    clientSel.innerHTML = '<option value="">— Select client —</option>' +
      _clients.map(c => `<option value="${c.id}">${escHtml(c.name)}</option>`).join('');
  }

  // Live duration update
  ['edit-from-h','edit-from-m','edit-until-h','edit-until-m'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', updateEditDuration);
  });

  document.getElementById('edit-save-btn')?.addEventListener('click', saveEdit);
  document.getElementById('edit-cancel-btn')?.addEventListener('click', () => closeEditModal());

  // Close on backdrop click
  document.getElementById('edit-modal')?.addEventListener('click', e => {
    if (e.target === document.getElementById('edit-modal')) closeEditModal();
  });
}

function openEditModal(id) {
  const entry = _entries.find(e => e.id === id);
  if (!entry) return;

  document.getElementById('edit-id').value   = entry.id;
  document.getElementById('edit-name').value = entry.name;
  document.getElementById('edit-date').value = entry.date;

  // Set client
  const clientSel = document.getElementById('edit-client');
  if (clientSel && entry.client_id) clientSel.value = entry.client_id;

  // Set time values
  const [fh, fm] = entry.time_from.split(':');
  const [uh, um] = entry.time_until.split(':');
  document.getElementById('edit-from-h').value  = fh.padStart(2, '0');
  document.getElementById('edit-from-m').value  = roundMin(fm);
  document.getElementById('edit-until-h').value = uh.padStart(2, '0');
  document.getElementById('edit-until-m').value = roundMin(um);

  updateEditDuration();
  document.getElementById('edit-modal').classList.add('open');
}

function closeEditModal() {
  document.getElementById('edit-modal').classList.remove('open');
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
    name,
    date,
    time_from:        from,
    time_until:       until,
    minutes,
    crosses_midnight: crossesMidnight,
  }).eq('id', id).eq('user_id', currentUser.id);

  setLoading(btn, false, 'Save changes');
  if (error) { showToast('Could not save entry', 'error'); return; }

  showToast('Entry updated');
  closeEditModal();
  await refresh();
}

// ── Helpers ────────────────────────────────────────────────────
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

async function deleteEntry(id) {
  if (!confirm('Delete this entry? This cannot be undone.')) return;
  const { error } = await sb
    .from('entries').delete().eq('id', id).eq('user_id', currentUser.id);
  if (error) { showToast('Could not delete entry', 'error'); return; }
  showToast('Entry deleted');
  await refresh();
}

function loadingHTML() {
  return `<div class="empty"><span class="spinner" style="border-top-color:var(--accent);color:var(--border)"></span></div>`;
}
