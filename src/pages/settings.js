// src/pages/settings.js

import { sb } from '../supabase.js';
import { currentUser } from '../auth.js';
import { showToast } from '../components/toast.js';
import { setLoading } from '../components/spinner.js';
import { getCycleForDate, cyclePeriodLabel, isoDate } from '../utils.js';

export function mount(container, profile) {
  const startDay = profile?.cycle_start_day ?? 21;
  const preview  = buildCyclePreview(startDay);
  const previewEmail = profile?.preview_email ?? '';
  const copyToSelf   = profile?.copy_to_self  ?? false;

  container.innerHTML = `
    <div class="card settings-section">
      <div class="section-label">Payment cycle</div>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-name">Cycle start day</div>
          <div class="setting-desc">
            The day of the month your pay period begins.
            The cycle ends the day before this in the following month.
          </div>
        </div>
        <div class="setting-control">
          <select class="input" id="s-cycle-day" style="width:72px">
            ${Array.from({ length: 28 }, (_, i) => i + 1)
              .map(d => `<option value="${d}"${d === startDay ? ' selected' : ''}>${d}</option>`)
              .join('')}
          </select>
        </div>
      </div>
      <div class="cycle-preview" id="s-cycle-preview">${preview}</div>
    </div>

    <div class="card settings-section">
      <div class="section-label">Invoice notifications</div>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-name">Draft preview email</div>
          <div class="setting-desc">
            Staging invoices generated on the 22nd will be sent here for review
            before the real invoice goes out on the 25th.
          </div>
        </div>
      </div>
      <div class="field" style="margin-top:0.5rem">
        <input class="input" type="email" id="s-preview-email"
          placeholder="you@example.com" value="${escHtml(previewEmail)}" />
      </div>
      <div class="setting-row">
        <div class="setting-info">
          <div class="setting-name">Copy to self on send</div>
          <div class="setting-desc">
            Receive a copy of every real invoice when it's sent to the client.
          </div>
        </div>
        <div class="setting-control">
          <input type="checkbox" id="s-copy-self"${copyToSelf ? ' checked' : ''}
            style="width:18px;height:18px;accent-color:var(--accent);cursor:pointer" />
        </div>
      </div>
    </div>

    <button class="btn btn-primary" id="s-save-btn">Save settings</button>
  `;

  document.getElementById('s-cycle-day').addEventListener('change', () => {
    const d = parseInt(document.getElementById('s-cycle-day').value);
    document.getElementById('s-cycle-preview').textContent = buildCyclePreview(d);
  });

  document.getElementById('s-save-btn').addEventListener('click', () => saveSettings(profile));
}

async function saveSettings(profile) {
  const cycleDay     = parseInt(document.getElementById('s-cycle-day').value);
  const previewEmail = document.getElementById('s-preview-email').value.trim();
  const copyToSelf   = document.getElementById('s-copy-self').checked;
  const btn          = document.getElementById('s-save-btn');

  setLoading(btn, true, 'Saving…');

  const { error } = await sb.from('profiles').upsert({
    id:               currentUser.id,
    cycle_start_day:  cycleDay,
    preview_email:    previewEmail || null,
    copy_to_self:     copyToSelf,
  });

  setLoading(btn, false, 'Save settings');

  if (error) { showToast('Could not save settings', 'error'); return; }

  // Update in-memory profile so other pages pick it up without reload
  if (profile) {
    profile.cycle_start_day = cycleDay;
    profile.preview_email   = previewEmail;
    profile.copy_to_self    = copyToSelf;
  }

  showToast('Settings saved');
}

function buildCyclePreview(day) {
  const { start, end } = getCycleForDate(new Date(), day);
  return `Current cycle: ${cyclePeriodLabel(isoDate(start), isoDate(end))}`;
}

function escHtml(str) {
  return String(str ?? '').replace(/"/g, '&quot;');
}
