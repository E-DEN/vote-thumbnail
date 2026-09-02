import { state, LS_CHANNELS, LS_SIDEBAR_ORDER, LS_API_KEY, LS_RSS_ONLY } from './state.js';
import { loadChannels, saveChannels } from './storage.js';
import { loadSidebarOrder } from './sidebar-order.js';
import { currentTheme, applyTheme } from './theme.js';
import { getStoredApiKey, getRssOnly, apiKeyHeaders } from './channel.js';
import { showToast } from './toast.js';

const LS_SETTINGS_TAB = 'thumb-settings-tab';
const channels = state.channels;

let _apiKeyErrorState = false;

export function markApiKeyError() {
  _apiKeyErrorState = true;
  const ind = document.getElementById('apikeyIndicator');
  if (ind) ind.style.background = 'var(--err)';
  const badge = document.getElementById('apikeyNavBadge');
  if (badge) badge.hidden = false;
}

export function initSettings({
  renderSidebar,
  buildChannelItem,
  updateFolderPreview,
  refreshingKeys,
}) {
  const settingsBtn   = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeBtn      = document.getElementById('settingsModalClose');
  const heading       = document.getElementById('settingsModalHeading');

  let _currentTab = localStorage.getItem(LS_SETTINGS_TAB) || 'display';

  // ---- タブ切り替え ----
  function switchTab(name) {
    _currentTab = name;
    localStorage.setItem(LS_SETTINGS_TAB, name);
    document.querySelectorAll('.settings-nav-item').forEach(function(el) {
      el.classList.toggle('active', el.dataset.tab === name);
    });
    document.querySelectorAll('.settings-tab').forEach(function(el) {
      el.hidden = (el.id !== 'settingsTab-' + name);
    });
    heading.textContent = t('settings-tab-' + name);
    heading.dataset.tab = name;
    if (name === 'lang' && typeof rebuildLangDialog === 'function') rebuildLangDialog();
    if (name === 'apikey') {
      showDisplayMode();
    }
  }

  // ---- 開閉 ----
  const _mainArea = document.querySelector('.app-layout');
  function openSettings() {
    applyTheme(currentTheme);
    if (typeof rebuildLangDialog === 'function') rebuildLangDialog();
    switchTab(_currentTab);
    settingsModal.hidden = false;
    if (_mainArea) _mainArea.classList.add('modal-blur');
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function closeSettings() {
    settingsModal.hidden = true;
    if (_mainArea) _mainArea.classList.remove('modal-blur');
  }

  settingsBtn.addEventListener('click', function() {
    if (!settingsModal.hidden) { closeSettings(); return; }
    openSettings();
  });

  // バックドロップクリックで閉じる
  settingsModal.addEventListener('click', function(e) {
    if (e.target === settingsModal) closeSettings();
  });

  // 閉じるボタン
  closeBtn.addEventListener('click', closeSettings);

  // ESC
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape' || settingsModal.hidden) return;
    closeSettings();
  });

  // 左ナビ
  document.querySelectorAll('.settings-nav-item').forEach(function(el) {
    el.addEventListener('click', function() { switchTab(el.dataset.tab); });
  });

  // ---- テーマ ----
  document.getElementById('settingsThemeDark').addEventListener('click', function() { applyTheme('dark'); });
  document.getElementById('settingsThemeLight').addEventListener('click', function() { applyTheme('light'); });

  // ---- API Key ----
  const input     = document.getElementById('apikeyPopoverInput');
  const toggleBtn = document.getElementById('apikeyToggleBtn');
  const statusEl  = document.getElementById('apikeyPopoverStatus');
  const deleteBtn = document.getElementById('apikeyDeleteBtn');
  const saveBtn   = document.getElementById('apikeyPopoverSave');
  const indicator = document.getElementById('apikeyIndicator');

  const EYE     = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-10-8-10-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function updateIndicator() {
    const hasKey = !!getStoredApiKey();
    const rssOnly = getRssOnly();
    indicator.hidden = !hasKey && !rssOnly;
    if (_apiKeyErrorState) indicator.style.background = 'var(--err)';
    else indicator.style.background = rssOnly ? 'var(--warn)' : 'var(--ok)';
  }

  function showDisplayMode() {
    input.value = getStoredApiKey() || '';
    input.classList.add('apikey-input--masked');
    toggleBtn.innerHTML = EYE;
    const badge = document.getElementById('apikeyNavBadge');
    if (_apiKeyErrorState) {
      statusEl.textContent = t('apikey-err-details');
      statusEl.style.color = 'var(--err)';
      if (badge) badge.hidden = false;
    } else {
      statusEl.textContent = '';
      statusEl.style.color = '';
      if (badge) badge.hidden = true;
    }
    deleteBtn.hidden = !getStoredApiKey();
  }

  toggleBtn.addEventListener('click', function() {
    const masked = input.classList.toggle('apikey-input--masked');
    toggleBtn.innerHTML = masked ? EYE : EYE_OFF;
  });

  input.addEventListener('input', function() {
    _apiKeyErrorState = false;
    statusEl.textContent = '';
    statusEl.style.color = '';
    const badge = document.getElementById('apikeyNavBadge');
    if (badge) badge.hidden = true;
  });

  deleteBtn.addEventListener('click', function() {
    localStorage.removeItem(LS_API_KEY);
    _apiKeyErrorState = false;
    updateIndicator();
    showDisplayMode();
  });

  saveBtn.addEventListener('click', function() {
    const val = input.value.trim();
    if (!val) {
      statusEl.textContent = t('apikey-err-empty');
      statusEl.style.color = 'var(--err)';
      return;
    }
    if (!/^AIzaSy[A-Za-z0-9_-]{33}$/.test(val)) {
      statusEl.textContent = t('apikey-err-format');
      statusEl.style.color = 'var(--err)';
      return;
    }
    localStorage.setItem(LS_API_KEY, val);
    _apiKeyErrorState = false;
    const badge = document.getElementById('apikeyNavBadge');
    if (badge) badge.hidden = true;
    updateIndicator();
    deleteBtn.hidden = false;
    statusEl.textContent = t('apikey-saved');
    statusEl.style.color = 'var(--ok)';
    setTimeout(function() { statusEl.textContent = ''; statusEl.style.color = ''; }, 2000);
  });

  // ---- RSS のみオプション ----
  const rssOnlyToggle = document.getElementById('rssOnlyToggle');
  if (rssOnlyToggle) {
    rssOnlyToggle.checked = getRssOnly();
    rssOnlyToggle.addEventListener('change', function() {
      if (rssOnlyToggle.checked) localStorage.setItem(LS_RSS_ONLY, '1');
      else localStorage.removeItem(LS_RSS_ONLY);
      updateIndicator();
    });
  }

  // ---- サイドバーデータ ----
  const exportBtn    = document.getElementById('sidebarExportBtn');
  const importBtn    = document.getElementById('sidebarImportBtn');
  const importFile   = document.getElementById('sidebarImportFile');
  const dataStatusEl = document.getElementById('sidebarDataStatus');

  exportBtn.addEventListener('click', function() {
    const exportData = {
      sidebarOrder: JSON.parse(localStorage.getItem(LS_SIDEBAR_ORDER) || '[]'),
      channels: JSON.parse(localStorage.getItem(LS_CHANNELS) || '{}'),
    };
    const blob = new Blob(['\uFEFF' + JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'sidebar-backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    dataStatusEl.textContent = t('settings-data-exported');
    dataStatusEl.style.color = '';
    setTimeout(function() { dataStatusEl.textContent = ''; }, 2000);
  });

  importBtn.addEventListener('click', function() { importFile.click(); });

  importFile.addEventListener('change', function() {
    const file = importFile.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(ev) {
      try {
        const parsed = JSON.parse(ev.target.result.replace(/^\uFEFF/, ''));
        if (!parsed || !Array.isArray(parsed.sidebarOrder)) throw new Error();
        localStorage.setItem(LS_SIDEBAR_ORDER, JSON.stringify(parsed.sidebarOrder));
        if (parsed.channels) {
          loadChannels();
          Object.assign(channels, parsed.channels);
          saveChannels();
        }
        loadSidebarOrder();
        renderSidebar();
        dataStatusEl.textContent = t('settings-data-imported');
        dataStatusEl.style.color = 'var(--ok)';
      } catch {
        dataStatusEl.textContent = t('settings-data-import-err');
        dataStatusEl.style.color = 'var(--err)';
      }
      importFile.value = '';
      setTimeout(function() {
        dataStatusEl.textContent = '';
        dataStatusEl.style.color = '';
      }, 3000);
    };
    reader.readAsText(file, 'utf-8');
  });

  // コードコピー / コード取り込み
  const _B64U = b => { const arr = new Uint8Array(b); let bin = ''; const CHUNK = 8192; for (let i = 0; i < arr.length; i += CHUNK) bin += String.fromCharCode(...arr.subarray(i, i + CHUNK)); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); };
  const _B64D = s => { const b64 = s.replace(/-/g,'+').replace(/_/g,'/'); return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length/4)*4,'=')), c => c.charCodeAt(0)); };

  async function _vtEncodeData() {
    const rawChannels = JSON.parse(localStorage.getItem(LS_CHANNELS) || '{}');
    const channels = {};
    for (const [id, ch] of Object.entries(rawChannels)) {
      const entry = {};
      if (ch.tags && ch.tags.length) entry.tags = ch.tags;
      if (ch.avatar) entry.avatar = ch.avatar;
      channels[id] = entry;
    }
    const data = {
      channels,
      sidebarOrder: JSON.parse(localStorage.getItem(LS_SIDEBAR_ORDER) || 'null'),
    };
    const cs = new CompressionStream('deflate-raw');
    const cw = cs.writable.getWriter();
    cw.write(new TextEncoder().encode(JSON.stringify(data))); cw.close();
    const chunks = []; const cr = cs.readable.getReader();
    for (;;) { const {done, value} = await cr.read(); if (done) break; chunks.push(value); }
    const buf = new Uint8Array(chunks.reduce((n,c) => n+c.length, 0));
    let off = 0; for (const c of chunks) { buf.set(c, off); off += c.length; }
    return 'vt~' + _B64U(buf);
  }
  async function _vtDecodeData(code) {
    if (!code.startsWith('vt~')) throw new Error('invalid code');
    const bytes = _B64D(code.slice(3));
    const ds = new DecompressionStream('deflate-raw');
    const dw = ds.writable.getWriter(); dw.write(bytes); dw.close();
    const chunks = []; const dr = ds.readable.getReader();
    for (;;) { const {done, value} = await dr.read(); if (done) break; chunks.push(value); }
    const buf = new Uint8Array(chunks.reduce((n,c) => n+c.length, 0));
    let off = 0; for (const c of chunks) { buf.set(c, off); off += c.length; }
    return JSON.parse(new TextDecoder().decode(buf));
  }

  const codeStatusEl = document.getElementById('sidebarCodeStatus');
  function _vtCodeStatusMsg(msg, ok) {
    if (!codeStatusEl) return;
    codeStatusEl.textContent = msg;
    codeStatusEl.style.color = ok ? 'var(--ok)' : 'var(--err)';
    setTimeout(() => { codeStatusEl.textContent = ''; }, ok ? 3000 : 5000);
  }
  document.getElementById('sidebarCopyCodeBtn').addEventListener('click', async function() {
    try {
      const code = await _vtEncodeData();
      try {
        await navigator.clipboard.writeText(code);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = code; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      _vtCodeStatusMsg(t('preset-copied'), true);
    } catch {
      _vtCodeStatusMsg(t('preset-import-err'), false);
    }
  });

  document.getElementById('sidebarApplyCodeBtn').addEventListener('click', async function() {
    const inp = document.getElementById('sidebarCodeInput');
    const raw = inp.value.trim();
    inp.classList.remove('error');
    try {
      const parsed = await _vtDecodeData(raw);
      if (!parsed || typeof parsed.channels !== 'object') throw new Error('invalid data');
      loadChannels();
      // フォルダ構成を先に復元
      if (parsed.sidebarOrder && Array.isArray(parsed.sidebarOrder)) {
        localStorage.setItem(LS_SIDEBAR_ORDER, JSON.stringify(parsed.sidebarOrder));
      }
      loadSidebarOrder();
      const importIds = Object.keys(parsed.channels);
      // DBにある全チャンネルを一括取得
      showToast(t('preset-fetching'), 'loading');
      let dbMap = {};
      try {
        const allRes = await fetch('/api/channels');
        if (allRes.ok) {
          const allChannels = await allRes.json();
          dbMap = Object.fromEntries(allChannels.map(c => [c.channel_id, c]));
        }
      } catch { /* ignore */ }
      // 全チャンネルをLocalStorageに設定（DB未登録はプレースホルダー）
      for (const id of importIds) {
        if (dbMap[id]) {
          channels[id] = {
            key: id, channelId: id,
            handle: dbMap[id].handle,
            displayName: dbMap[id].title,
            avatar: dbMap[id].icon_url,
            tags: parsed.channels[id]?.tags || channels[id]?.tags || [],
            addedAt: channels[id]?.addedAt || new Date().toISOString(),
          };
        } else {
          channels[id] = {
            key: id, channelId: id,
            handle: channels[id]?.handle || '',
            displayName: channels[id]?.displayName || '',
            avatar: channels[id]?.avatar || parsed.channels[id]?.avatar || '',
            tags: parsed.channels[id]?.tags || channels[id]?.tags || [],
            addedAt: channels[id]?.addedAt || new Date().toISOString(),
          };
        }
      }
      // フォルダ構成+チャンネルアイコンを先に描画
      saveChannels();
      renderSidebar();
      inp.value = '';
      // バックグラウンドでDB未登録チャンネルをrefresh（アイコン・名前を補完）
      const missingIds = importIds.filter(id => !dbMap[id]);
      if (missingIds.length > 0) {
        const _nav = document.getElementById('sidebarNav');
        // 全件のスピナーを一括で先付け（プレビューアイコンも即時スピナー）
        for (const id of missingIds) {
          refreshingKeys.add(id);
          const item = _nav.querySelector(`.sidebar-channel-item[data-key="${id}"]`);
          if (item) {
            item.classList.add('compact-refreshing');
            const btn = item.querySelector('.ch-action-refresh');
            if (btn) btn.disabled = true;
          }
          updateFolderPreview(id);
        }
        (async () => {
          for (const id of missingIds) {
            try {
              const res = await fetch('/api/channels/' + id + '/refresh', { method: 'POST', headers: getRssOnly() ? { 'X-RSS-Only': '1' } : apiKeyHeaders() });
              const data = await res.json().catch(() => ({}));
              if (data.channel) {
                channels[id] = {
                  ...channels[id],
                  handle: data.channel.handle,
                  displayName: data.channel.title,
                  avatar: data.channel.icon_url,
                };
                saveChannels();
                const newItem = buildChannelItem(channels[id]);
                const cur = _nav.querySelector(`.sidebar-channel-item[data-key="${id}"]`);
                if (cur) cur.replaceWith(newItem);
                else _nav.appendChild(newItem);
                if (typeof lucide !== 'undefined') lucide.createIcons({ root: newItem });
                updateFolderPreview(id);
              }
            } catch { /* ignore */ }
            refreshingKeys.delete(id);
            const fin = _nav.querySelector(`.sidebar-channel-item[data-key="${id}"]`);
            if (fin) {
              fin.classList.remove('compact-refreshing');
              const btn = fin.querySelector('.ch-action-refresh');
              if (btn) btn.disabled = false;
            }
            updateFolderPreview(id);
          }
          showToast(t('preset-imported'));
        })();
      } else {
        showToast(t('preset-imported'));
      }
    } catch {
      inp.classList.add('error');
      showToast(t('preset-import-err'), 'err');
    }
  });

  updateIndicator();
}
