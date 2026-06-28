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

const LAST_CLIENT_KEY = 'timelog_last_client';

export async function mount(container) {
  const { data: clients } = await sb
    .from('clients')
    .select('id, name')
    .eq('user_id', currentUser.id)
    .eq('archived', false)
    .order('name', { ascending: true });

  const hasClients   = clients && clients.length > 0;
  const lastClientId = localStorage.getItem(LAST_CLIENT_KEY);

  container.innerHTML = `
    <div class="card">
      <div class="field">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.4rem">
          <label class="label" for="log-client" style="margin-bottom:0">Client</label>
          <button class="btn-quick-add" id="log-quick-add-btn" title="Quick add client">+ New</button>
        </div>
        ${hasClients
          ? `<select class="input" id="log-client">
               <option value="">— Select client —</option>
               ${clients.map(c =>
                 `<option value="${c.id}"${c.id === lastClientId ? ' selected' : ''}>${c.name}</option>`
               ).join('')}
             </select>`
          : `<div class="input" style="color:var(--text3);cursor:default" id="log-no-clients">
               No clients yet — tap "+ New" to add one
             </div>
             <input type="hidden" id="log-client" value="" />`
        }
        <div id="log-quick-add-form" style="display:none;margin-top:0.5rem">
          <div style="display:flex;gap:0.5rem">
            <input class="input" type="text" id="log-quick-add-name"
              placeholder="Client name" autocomplete="off" style="flex:1" />
            <button class="btn btn-primary" id="log-quick-add-save-btn"
              style="width:auto;padding:0.7rem 1rem;font-size:0.85rem">Save</button>
            <button class="btn btn-ghost" id="log-quick-add-cancel-btn"
              style="width:auto;padding:0.7rem 0.75rem;font-size:0.85rem">✕</button>
          </div>
          <p style="font-size:0.7rem;color:var(--text3);margin-top:0.4rem">
            Billing details can be completed in the invoices app before sending.
          </p>
        </div>
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

  // Default minutes to 00
  document.getElementById('log-from-m').value  = '00';
  document.getElementById('log-until-m').value = '00';

  ['log-from-h','log-from-m','log-until-h','log-until-m'].forEach(id => {
    document.getElementById(id).addEventListener('change', updateDuration);
  });

  document.getElementById('log-save-btn').addEventListener('click', saveEntry);

  ['log-name', 'log-date'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', e => {
      if (e.key === 'Enter') saveEntry();
    });
  });

  // Quick-add client
  document.getElementById('log-quick-add-btn').addEventListener('click', () => {
    document.getElementById('log-quick-add-form').style.display = 'block';
    document.getElementById('log-quick-add-name').focus();
  });

  document.getElementById('log-quick-add-cancel-btn').addEventListener('click', () => {
    document.getElementById('log-quick-add-form').style.display = 'none';
    document.getElementById('log-quick-add-name').value = '';
  });

  document.getElementById('log-quick-add-save-btn').addEventListener('click', quickAddClient);
  document.getElementById('log-quick-add-name').addEventListener('keydown', e => {
    if (e.key === 'Enter') quickAddClient();
  });
}

async function quickAddClient() {
  const name = document.getElementById('log-quick-add-name').value.trim();
  if (!name) { document.getElementById('log-quick-add-name').classList.add('error'); return; }

  const btn = document.getElementById('log-quick-add-save-btn');
  setLoading(btn, true, '');

  const { data, error } = await sb.from('clients').insert({
    user_id:         currentUser.id,
    name,
    email:           'incomplete@placeholder.is', // required field, must be updated in invoices app
    invoice_prefix:  'INV',
    invoice_counter: 1000,
    hourly_rate:     0,
  }).select('id, name').single();

  setLoading(btn, false, 'Save');

  if (error) { showToast('Could not create client', 'error'); return; }

  // Add to dropdown and select it
  const sel = document.getElementById('log-client');
  if (sel) {
    // Replace the "no clients" placeholder if it exists
    const placeholder = document.getElementById('log-no-clients');
    if (placeholder) {
      placeholder.remove();
      const newSel = document.createElement('select');
      newSel.className = 'input';
      newSel.id = 'log-client';
      newSel.innerHTML = `<option value="">— Select client —</option>`;
      placeholder.parentNode.insertBefore(newSel, placeholder.nextSibling);
    }

    const opt = document.createElement('option');
    opt.value    = data.id;
    opt.text     = data.name;
    opt.selected = true;
    document.getElementById('log-client').appendChild(opt);
  } else {
    // Rebuild the whole form with new client list
    mount(document.getElementById('page-log'));
    return;
  }

  localStorage.setItem(LAST_CLIENT_KEY, data.id);
  document.getElementById('log-quick-add-form').style.display = 'none';
  document.getElementById('log-quick-add-name').value = '';
  showToast(`"${name}" added — complete billing details in the invoices app`);
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
  localStorage.setItem(LAST_CLIENT_KEY, clientId);
  document.getElementById('log-client').value  = clientId;
  document.getElementById('log-name').value    = '';
  document.getElementById('log-from-h').value  = '';
  document.getElementById('log-from-m').value  = '00';
  document.getElementById('log-until-h').value = '';
  document.getElementById('log-until-m').value = '00';
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
