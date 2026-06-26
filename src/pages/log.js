// src/pages/log.js
// Time entry form — the home page.

import { sb } from '../supabase.js';
import { currentUser } from '../auth.js';
import { showToast } from '../components/toast.js';
import { setLoading } from '../components/spinner.js';
import {
  calcMinutes, formatDuration,
  todayISO,
} from '../utils.js';

// Build hour options 00–23
const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
// Build minute options 00, 05, 10 ... 55
const MINS  = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));

function timeSelectHTML(prefix) {
  return `
    <div class="time-select" id="${prefix}-wrap">
      <select class="input time-select-h" id="${prefix}-h" aria-label="Hour">
        <option value="">HH</option>
        ${HOURS.map(h => `<option value="${h}">${h}</option>`).join('')}
      </select>
      <span class="time-colon">:</span>
      <select class="input time-select-m" id="${prefix}-m" aria-label="Minute">
        <option value="">MM</option>
        ${MINS.map(m => `<option value="${m}">${m}</option>`).join('')}
      </select>
    </div>
  `;
}

function getTimeValue(prefix) {
  const h = document.getElementById(`${prefix}-h`).value;
  const m = document.getElementById(`${prefix}-m`).value;
  if (!h || !m) return '';
  return `${h}:${m}`;
}

function setTimeValue(prefix, value) {
  if (!value) return;
  const [h, m] = value.split(':');
  document.getElementById(`${prefix}-h`).value = h;
  // Round to nearest 5-min slot
  const mRounded = String(Math.round(parseInt(m) / 5) * 5 % 60).padStart(2, '0');
  document.getElementById(`${prefix}-m`).value = MINS.includes(mRounded) ? mRounded : '00';
}

export async function mount(container) {
  const { data: clients } = await sb
    .from('clients')
    .select('id, name')
    .eq('user_id', currentUser.id)
    .eq('archived', false)
    .order('name', { ascending: true });

  const hasClients = clients && clients.length > 0;

  container.innerHTML = `
    <div class="card">
      <div class="field">
        <label class="label" for="log-client">Client</label>
        ${hasClients
          ? `<select class="input" id="log-client">
               <option value="">— Select client —</option>
               ${clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
             </select>`
          : `<div class="input" style="color:var(--text3);cursor:default">
               No clients yet — add them in the invoices app
             </div>
             <input type="hidden" id="log-client" value="" />`
        }
      </div>
      <div class="field">
        <label class="label" for="log-name">Description</label>
        <input class="input" type="text" id="log-name"
          placeholder="What did you work on?" autocomplete="off" />
      </div>
      <div class="field">
        <label class="label" for="log-date">Date</label>
        <input class="input" type="date" id="log-date" />
      </div>
      <div class="field">
        <div class="input-row">
          <div>
            <label class="label">From</label>
            ${timeSelectHTML('log-from')}
          </div>
          <div>
            <label class="label">Until</label>
            ${timeSelectHTML('log-until')}
          </div>
        </div>
      </div>
      <div class="duration-display">
        <span class="duration-label">Duration</span>
        <span class="duration-value" id="log-duration-value">—</span>
      </div>
      <div id="log-midnight" style="height:1.1rem;margin-top:0.4rem;text-align:center"></div>
    </div>

    <button class="btn btn-primary" id="log-save-btn">Save entry</button>
  `;

  document.getElementById('log-date').value = todayISO();

  // Live duration on any time select change
  ['log-from-h','log-from-m','log-until-h','log-until-m'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateDuration);
  });

  document.getElementById('log-save-btn').addEventListener('click', saveEntry);

  // Enter key submits from text/date inputs
  ['log-name', 'log-date'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveEntry();
    });
  });
}

function updateDuration() {
  const from  = getTimeValue('log-from');
  const until = getTimeValue('log-until');
  const val   = document.getElementById('log-duration-value');
  const mid   = document.getElementById('log-midnight');

  if (!from || !until) {
    val.textContent = '—';
    mid.innerHTML   = '';
    return;
  }

  const { minutes, crossesMidnight } = calcMinutes(from, until);
  val.textContent = formatDuration(minutes);
  mid.innerHTML   = crossesMidnight
    ? '<span class="midnight-tag">↻ Crosses midnight</span>'
    : '';
}

async function saveEntry() {
  const clientId = document.getElementById('log-client').value;
  const name     = document.getElementById('log-name').value.trim();
  const date     = document.getElementById('log-date').value;
  const from     = getTimeValue('log-from');
  const until    = getTimeValue('log-until');
  const btn      = document.getElementById('log-save-btn');

  if (!clientId) return shake('log-client');
  if (!name)     return shake('log-name');
  if (!date)     return shake('log-date');
  if (!from)     return shake('log-from-h');
  if (!until)    return shake('log-until-h');

  const { minutes, crossesMidnight } = calcMinutes(from, until);

  setLoading(btn, true, 'Saving…');

  const { error } = await sb.from('entries').insert({
    user_id:          currentUser.id,
    client_id:        clientId,
    name,
    date,
    time_from:        from,
    time_until:       until,
    minutes,
    crosses_midnight: crossesMidnight,
  });

  setLoading(btn, false, 'Save entry');

  if (error) {
    showToast('Could not save entry', 'error');
    console.error(error);
    return;
  }

  showToast('Entry saved');
  document.getElementById('log-client').value = clientId;
  document.getElementById('log-name').value   = '';
  setTimeValue('log-from', '');
  setTimeValue('log-until', '');
  document.getElementById('log-from-h').value  = '';
  document.getElementById('log-from-m').value  = '';
  document.getElementById('log-until-h').value = '';
  document.getElementById('log-until-m').value = '';
  document.getElementById('log-duration-value').textContent = '—';
  document.getElementById('log-midnight').innerHTML = '';
  document.getElementById('log-name').focus();
}

function shake(id) {
  const el = document.getElementById(id);
  el.classList.add('error');
  el.focus();
  setTimeout(() => el.classList.remove('error'), 1500);
}
