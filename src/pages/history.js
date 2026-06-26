// src/pages/history.js
// Shows entries grouped by payment cycle.
// Uninvoiced periods appear at the top, invoiced periods below — collapsed by default.

import { sb } from '../supabase.js';
import { currentUser } from '../auth.js';
import { showToast } from '../components/toast.js';
import {
  formatDuration, formatTime, formatDateLabel, formatMonthDay,
  timeToPercent, bucketIntoCycles, cyclePeriodLabel,
  isCurrentCycle, escHtml, isoDate,
} from '../utils.js';

let _cycleStartDay = 21;
let _entries       = [];
let _container     = null;

export async function mount(container, profile) {
  _container     = container;
  _cycleStartDay = profile?.cycle_start_day ?? 21;
  container.innerHTML = loadingHTML();
  await refresh();
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
  // Grand total
  const totalMins = _entries.reduce((s, e) => s + e.minutes, 0);

  // Group entries by date
  const byDate = {};
  _entries.forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });

  const allDates = Object.keys(byDate).sort((a, b) => b.localeCompare(a));
  const cycles   = bucketIntoCycles(allDates, _cycleStartDay);

  // Split into uninvoiced and invoiced
  // A cycle is "invoiced" if ALL entries in it have an invoice_id
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

  // ── Uninvoiced ──
  if (uninvoiced.length) {
    html += `<div class="section-label" style="margin-bottom:0.75rem">Uninvoiced</div>`;
    uninvoiced.forEach((cycle, i) => {
      html += renderCycle(cycle, byDate, false, `u-${i}`);
    });
  }

  // ── Invoiced ──
  if (invoiced.length) {
    html += `<div class="section-label" style="margin-top:1.25rem;margin-bottom:0.75rem">Invoiced</div>`;
    invoiced.forEach((cycle, i) => {
      html += renderCycle(cycle, byDate, true, `v-${i}`);
    });
  }

  _container.innerHTML = html;

  // Collapse invoiced cycles by default, collapse older uninvoiced cycles
  uninvoiced.forEach((cycle, i) => {
    if (!isCurrentCycle(cycle.startISO, cycle.endISO)) {
      _container.querySelector(`#cycle-u-${i}`)?.classList.add('collapsed');
    }
  });
  invoiced.forEach((_c, i) => {
    _container.querySelector(`#cycle-v-${i}`)?.classList.add('collapsed');
  });

  // Bind toggle + delete
  _container.querySelectorAll('.period-header').forEach(header => {
    header.addEventListener('click', () => header.closest('.period-block').classList.toggle('collapsed'));
  });
  _container.querySelectorAll('.entry-delete').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      deleteEntry(btn.dataset.id);
    });
  });
}

function renderCycle(cycle, byDate, isInvoiced, key) {
  const cycleDates  = cycle.dates.sort((a, b) => b.localeCompare(a));
  const allEntries  = cycleDates.flatMap(d => byDate[d] ?? []);
  const cycleMins   = allEntries.reduce((s, e) => s + e.minutes, 0);
  const label       = cyclePeriodLabel(cycle.startISO, cycle.endISO);
  const isCurrent   = isCurrentCycle(cycle.startISO, cycle.endISO);

  const invoicedAt  = allEntries[0]?.invoiced_at;
  const invoicedLabel = invoicedAt
    ? ` · Invoiced ${formatMonthDay(invoicedAt.slice(0, 10))}`
    : '';

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
          ${!e.invoice_id ? `
            <button class="btn-icon entry-delete" data-id="${e.id}" title="Delete entry"
              style="position:absolute;top:0.625rem;right:0.625rem">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" width="15" height="15">
                <path stroke-linecap="round" stroke-linejoin="round"
                  d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>` : ''}
        </div>
      `;
    });
  });

  html += `</div></div>`;
  return html;
}

async function deleteEntry(id) {
  const { error } = await sb
    .from('entries')
    .delete()
    .eq('id', id)
    .eq('user_id', currentUser.id);

  if (error) { showToast('Could not delete entry', 'error'); return; }
  showToast('Entry deleted');
  await refresh();
}

function loadingHTML() {
  return `<div class="empty"><span class="spinner" style="border-top-color:var(--accent);color:var(--border)"></span></div>`;
}
