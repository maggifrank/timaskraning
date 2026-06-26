// src/pages/export.js
// CSV export with date range defaulting to current payment cycle.

import { sb } from '../supabase.js';
import { currentUser } from '../auth.js';
import { showToast } from '../components/toast.js';
import { setLoading } from '../components/spinner.js';
import {
  getCycleForDate, isoDate, formatDuration, formatTime,
} from '../utils.js';

let _cycleStartDay = 21;

export function mount(container, profile) {
  _cycleStartDay = profile?.cycle_start_day ?? 21;

  const { start, end } = getCycleForDate(new Date(), _cycleStartDay);
  const fromISO  = isoDate(start);
  const untilISO = isoDate(end);

  container.innerHTML = `
    <div class="card">
      <div class="field">
        <div class="input-row">
          <div>
            <label class="label" for="export-from">From</label>
            <input class="input" type="date" id="export-from" value="${fromISO}" />
          </div>
          <div>
            <label class="label" for="export-until">Until</label>
            <input class="input" type="date" id="export-until" value="${untilISO}" />
          </div>
        </div>
      </div>
      <div class="export-preview" id="export-preview">Loading…</div>
      <button class="btn btn-primary" id="export-btn">Download CSV</button>
    </div>
  `;

  document.getElementById('export-from').addEventListener('change', updatePreview);
  document.getElementById('export-until').addEventListener('change', updatePreview);
  document.getElementById('export-btn').addEventListener('click', doExport);

  updatePreview();
}

async function updatePreview() {
  const from  = document.getElementById('export-from').value;
  const until = document.getElementById('export-until').value;
  const prev  = document.getElementById('export-preview');
  if (!from || !until) { prev.textContent = 'Choose a date range.'; return; }

  const { data } = await sb
    .from('entries')
    .select('minutes')
    .eq('user_id', currentUser.id)
    .gte('date', from)
    .lte('date', until);

  if (!data) { prev.textContent = 'Could not load preview.'; return; }

  const totalMins = data.reduce((s, e) => s + e.minutes, 0);
  prev.innerHTML  = `<strong>${data.length}</strong> entries · <strong>${formatDuration(totalMins)}</strong>`;
}

async function doExport() {
  const from  = document.getElementById('export-from').value;
  const until = document.getElementById('export-until').value;
  const btn   = document.getElementById('export-btn');

  if (!from || !until) { showToast('Set a date range first', 'error'); return; }

  setLoading(btn, true, 'Preparing…');

  const { data, error } = await sb
    .from('entries')
    .select('*')
    .eq('user_id', currentUser.id)
    .gte('date', from)
    .lte('date', until)
    .order('date', { ascending: true })
    .order('time_from', { ascending: true });

  setLoading(btn, false, 'Download CSV');

  if (error || !data?.length) {
    showToast('No entries in that range', 'error');
    return;
  }

  const rows = [
    ['Date', 'Description', 'From', 'Until', 'Crosses Midnight', 'Minutes', 'Hours', 'Invoiced'],
    ...data.map(e => [
      e.date,
      `"${String(e.name).replace(/"/g, '""')}"`,
      formatTime(e.time_from),
      formatTime(e.time_until),
      e.crosses_midnight ? 'Yes' : 'No',
      e.minutes,
      (e.minutes / 60).toFixed(2),
      e.invoice_id ? 'Yes' : 'No',
    ]),
  ];

  const csv  = rows.map(r => r.join(',')).join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `timelog_${from}_${until}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  showToast('CSV downloaded');
}
