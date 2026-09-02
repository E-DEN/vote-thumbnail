import { state, LS_CAT } from './state.js';
import { saveChannels, fetchChannelVideos } from './storage.js';
import { showToast } from './toast.js';
import { getStoredApiKey, getRssOnly, apiKeyHeaders } from './channel.js';
import { importAllChannelVideos } from './youtube-api.js';
import { sidebarOrder, saveSidebarOrder } from './sidebar-order.js';
import { renderCurrentView } from './router.js';
import { importFromShareCode } from './share.js';
import { markApiKeyError } from './settings.js';
import { buildChannelItem } from './sidebar.js';
import { setListSortOrder, _updateSortUI } from './list-view.js';

const channels = state.channels;

let selectChannel;

export function configureChannelAdd(config) {
  selectChannel = config.selectChannel;
}

// --- サイドバー検索・チャンネル追加 ---
export async function addChannelFromSidebarInput() {
  const input = document.getElementById('sidebarSearchInput');
  const rawInput = input?.value?.trim();
  if (!rawInput) return;

  // 共有リンク（#s=XXXXXXXX または URL に含まれる場合）を優先処理
  const shareCode = rawInput.match(/(?:[#?&]|^)s=([A-Za-z0-9]{8})(?:[^A-Za-z0-9]|$)/)?.[1];
  if (shareCode) {
    document.getElementById('sidebarSearchInput').value = '';
    await importFromShareCode(shareCode);
    return;
  }

  let raw;
  try { raw = decodeURIComponent(rawInput); } catch { raw = rawInput; }

  const statusEl  = document.getElementById('sidebarSearchStatus');
  const searchBtn = document.getElementById('sidebarSearchBtn');

  // @handle を正規化 (URL入力にも対応)
  const handleMatch = raw.match(/@([^\s/?#&]+)/);
  // channel/UCxxx 形式の URL を抽出
  const channelIdMatch = !handleMatch && raw.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  // 動画 URL から video ID を抽出（watch はクエリ順不同に対応）
  const videoIdMatch = !handleMatch && !channelIdMatch && raw.match(
    /(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:shorts\/|live\/|embed\/|v\/)|youtube(?:-nocookie)?\.com\/watch\?(?:[^#\s]*?&)?v=)([A-Za-z0-9_-]{11})/
  );
  // @なし・URLなし → 単純文字列をハンドルとして扱う
  const plainHandle = !handleMatch && !channelIdMatch && !videoIdMatch && /^[^\s/?#&]+$/.test(raw)
    ? '@' + raw : null;

  if (!handleMatch && !channelIdMatch && !videoIdMatch && !plainHandle) {
    statusEl.textContent = t('status-invalid-url');
    return;
  }

  const postBody = handleMatch
    ? { handle: '@' + handleMatch[1] }
    : channelIdMatch
      ? { channelId: channelIdMatch[1] }
    : plainHandle
      ? { handle: plainHandle }
      : { videoId: videoIdMatch[1] };

  // 既登録チェック: 存在すればリフレッシュボタンと同じ挙動にする
  if (postBody.handle) {
    const existing = Object.values(channels).find(ch => ch.handle === postBody.handle);
    if (existing) {
      document.getElementById('sidebarSearchInput').value = '';
      statusEl.textContent = '';
      const _existingEl = document.querySelector(`.sidebar-channel-item[data-key="${existing.key}"]`);
      const _existingRefBtn = _existingEl && _existingEl.querySelector('.ch-action-refresh');
      if (_existingRefBtn) {
        _existingRefBtn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
      return;
    }
  }

  searchBtn.disabled = true;
  showToast(t('status-ch-fetching'), 'loading');

  try {
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(getRssOnly() ? { 'X-RSS-Only': '1' } : apiKeyHeaders()) },
      body: JSON.stringify(postBody),
    });
    const data = await res.json();
    if (!res.ok) {
      showToast(t('status-error', { msg: data.error ?? res.status }), 'err');
      return;
    }
    const ch = data.channel;
    const isExisting = !!channels[ch.channel_id];
    // channels に保存 (既存の tags/addedAt を維持)
    channels[ch.channel_id] = {
      key:         ch.channel_id,
      channelId:   ch.channel_id,
      handle:      ch.handle,
      displayName: ch.title,
      avatar:      ch.icon_url,
      tags:        channels[ch.channel_id]?.tags    ?? [],
      addedAt:     channels[ch.channel_id]?.addedAt ?? new Date().toISOString(),
    };
    saveChannels();
    if (!sidebarOrder.some(i => (i.type === 'channel' && i.key === ch.channel_id) || (i.type === 'folder' && i.children.includes(ch.channel_id)))) {
      sidebarOrder.push({ type: 'channel', key: ch.channel_id });
      saveSidebarOrder();
    }
    document.getElementById('sidebarSearchInput').value = '';
    // nav.innerHTML='' による全破棄を避け、既存アイテムは置き換え・新規は追加（ホバー状態保持）
    const _nav = document.getElementById('sidebarNav');
    const _newItem = buildChannelItem(channels[ch.channel_id]);
    const _existingItem = _nav.querySelector(`.sidebar-channel-item[data-key="${ch.channel_id}"]`);
    if (_existingItem) {
      _existingItem.replaceWith(_newItem);
    } else {
      _nav.appendChild(_newItem);
    }
    setListSortOrder('date');
    _updateSortUI();
    await selectChannel(ch.channel_id);
    // チャンネル追加後: 最多カテゴリに強制切り替え
    if (state.allVideos.length) {
      const _ac = { videos: 0, shorts: 0, live: 0 };
      state.allVideos.forEach(function(v) { if (_ac[v.category] !== undefined) _ac[v.category]++; });
      state.currentCat = ['live','shorts','videos'].reduce(function(a, b) { return _ac[b] > _ac[a] ? b : a; });
      localStorage.setItem(LS_CAT, state.currentCat);
      document.querySelectorAll('.cat-seg-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.cat === state.currentCat); });
      renderCurrentView();
    }
    // API キーが設定されていれば全件取得を自動実行
    if (getStoredApiKey() && !getRssOnly()) {
      try {
        const count = await importAllChannelVideos(ch.channel_id, msg => { showToast(msg, 'loading'); });
        state.allVideos = await fetchChannelVideos(ch.channel_id);
        // 全件取得後も最多カテゴリを維持
        const _ac2 = { videos: 0, shorts: 0, live: 0 };
        state.allVideos.forEach(function(v) { if (_ac2[v.category] !== undefined) _ac2[v.category]++; });
        state.currentCat = ['live','shorts','videos'].reduce(function(a, b) { return _ac2[b] > _ac2[a] ? b : a; });
        localStorage.setItem(LS_CAT, state.currentCat);
        document.querySelectorAll('.cat-seg-btn').forEach(function(b) { b.classList.toggle('active', b.dataset.cat === state.currentCat); });
        renderCurrentView();
        showToast(isExisting
          ? t('status-refresh-api').replace('{total}', count)
          : t('ch-import-done', { count }));
      } catch (importErr) {
        if (importErr.code === 'API_KEY_INVALID') {
          markApiKeyError();
          showToast(t('apikey-err-details'), 'err');
        } else {
          showToast(importErr.message, 'err');
        }
      }
    } else {
      // RSS Only または API キーなしの場合は loading トーストを成功表示に切り替える
      showToast(isExisting
        ? t('status-refresh-rss').replace('{changed}', 0)
        : t('status-ch-added', { name: ch.title || postBody.handle || ch.channel_id }));
    }
  } catch (e) {
    showToast(t('status-error', { msg: e.message }), 'err');
  } finally {
    searchBtn.disabled = false;
  }
}

// --- URL デコードペースト（全チャンネルURL入力欄共通） ---
export function applyUrlDecodePaste(el) {
  el.addEventListener('paste', e => {
    const text = (e.clipboardData || window.clipboardData).getData('text');
    let decoded;
    try { decoded = decodeURIComponent(text); } catch { decoded = text; }
    if (decoded !== text) {
      e.preventDefault();
      const start = el.selectionStart, end = el.selectionEnd;
      el.value = el.value.slice(0, start) + decoded + el.value.slice(end);
      el.selectionStart = el.selectionEnd = start + decoded.length;
    }
  });
}

// サイドバー入力欄・ウェルカムフォームのイベント配線
export function initChannelAdd() {
  applyUrlDecodePaste(document.getElementById('sidebarSearchInput'));
  applyUrlDecodePaste(document.getElementById('welcomeHandleInput'));

  // --- サイドバーイベント ---
  document.getElementById('sidebarSearchInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') addChannelFromSidebarInput();
  });
  document.getElementById('sidebarSearchBtn').addEventListener('click', () => {
    addChannelFromSidebarInput();
  });

  // --- ウェルカムフォーム ---
  const handleInput    = document.getElementById('welcomeHandleInput');
  const addBtn         = document.getElementById('welcomeAddBtn');
  const clearBtn       = document.getElementById('welcomeClearBtn');
  const statusEl       = document.getElementById('welcomeAddStatus');

  handleInput.addEventListener('input', () => {
    clearBtn.hidden = handleInput.value.length === 0;
  });
  clearBtn.addEventListener('click', () => {
    handleInput.value = '';
    clearBtn.hidden = true;
    statusEl.textContent = '';
    handleInput.focus();
  });

  async function submitWelcomeAdd() {
    const raw = handleInput.value.trim();
    if (!raw) return;
    document.getElementById('sidebarSearchInput').value = raw;
    statusEl.textContent = '';
    addBtn.disabled = true;
    await addChannelFromSidebarInput();
    addBtn.disabled = false;
    handleInput.value = '';
    clearBtn.hidden = true;
    // サイドバーステータスをウェルカムにも反映
    const sidebarStatus = document.getElementById('sidebarSearchStatus');
    statusEl.textContent = sidebarStatus.textContent;
    sidebarStatus.textContent = '';
  }

  addBtn.addEventListener('click', submitWelcomeAdd);
  handleInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitWelcomeAdd(); });
}
