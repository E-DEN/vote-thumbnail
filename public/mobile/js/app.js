// mobile/js/app.js
// モバイル専用アプリケーションロジック
import { state, LS_CAT, LS_SORT, LS_CHANNELS, LS_API_KEY, LS_RSS_ONLY, LS_SIDEBAR_ORDER, WASHOKU_PALETTE } from '../../js/state.js';
import { loadRating, applyVoteLocal, syncVoteToServer, getVotePair, setVotePair, pickPair, _playedPairs, _pairKey, getRating, getRd, getWins, getBattles } from '../../js/rating.js';
import { loadChannels, saveChannels, loadVideosForChannel, saveVideosForChannel, fetchChannelVideos, filteredVideos } from '../../js/storage.js';
import { formatViews, formatRelTime, formatViewsShort } from '../../js/format.js';
import { showToast, showToastPromise, closeToast } from '../../js/toast.js';
import { _M_SVG_EYE, _M_SVG_CLK, _M_SVG_STAR, _M_SVG_PLAY, _M_SVG_PAUSE, _M_SVG_FULLSCREEN, _M_SVG_FULLSCREEN_EXIT, _M_SVG_PIN, _mBuildMeta, _mBuildPinDot } from './ui-helpers.js';
import { _suppressHistory, setSuppressHistory } from './shared-state.js';
import { loadMyPins, mRsApplyPalette, mRsShowMyPin, mRsOpenMode, openVideoInReaction, renderReaction, mRsRenderPlaylist, mRsSaveCatState, _mRsMyPins, _mRsPinColor, _mRsMaxPins, _mRsPinOpacity, _mRsTransportVisible, _mRsCurrentVideoId, _mRsUpdateSortUI, initReaction, resetCurrentVideo, initReactionUI } from './reaction.js';

const LS_LIST_SORT_DIR = 'thumb-sort-dir';
const LS_VOTE_SHOW_TITLE = 'thumb-vote-show-title';
let _voteShowTitle = localStorage.getItem(LS_VOTE_SHOW_TITLE) === 'true';


// オブジェクトエイリアス（参照が同一なので変更は state に反映される）
const ratingData = state.ratingData;
const channels   = state.channels;

// --- サイドバー順序管理 ---
let sidebarOrder = [];

function loadSidebarOrder() {
  const raw = localStorage.getItem(LS_SIDEBAR_ORDER);
  sidebarOrder = raw ? JSON.parse(raw) : [];
}
function saveSidebarOrder() {
  try { localStorage.setItem(LS_SIDEBAR_ORDER, JSON.stringify(sidebarOrder)); } catch {}
}
function syncSidebarOrder() {
  const known = new Set(Object.keys(channels));
  sidebarOrder = sidebarOrder.filter(item => {
    if (item.type === 'channel') return known.has(item.key);
    if (item.type === 'folder') {
      item.children = item.children.filter(k => known.has(k));
      return item.children.length > 0;
    }
    return false;
  });
  // 子が1件のフォルダを解除
  sidebarOrder = sidebarOrder.map(item =>
    (item.type === 'folder' && item.children.length === 1)
      ? { type: 'channel', key: item.children[0] } : item
  );
  // order 未登録チャンネルを末尾に追加
  const inOrder = new Set();
  sidebarOrder.forEach(item => {
    if (item.type === 'channel') inOrder.add(item.key);
    else if (item.type === 'folder') item.children.forEach(k => inOrder.add(k));
  });
  Object.keys(channels).forEach(k => {
    if (!inOrder.has(k)) sidebarOrder.push({ type: 'channel', key: k });
  });
}

// モバイル固有状態
let currentTab      = 'list';

// --- URL ハッシュ管理（PC版と同様） ---
function buildHash(channelKey, tab, vid) {
  if (!channelKey) return location.pathname;
  const p = new URLSearchParams();
  p.set('ch', channelKey);
  p.set('tab', tab || 'list');
  if (vid) p.set('vid', vid);
  return '#' + p.toString();
}

function parseHash() {
  const hash = location.hash.slice(1);
  if (!hash) return { channelKey: null, tab: null, vid: null };
  try {
    const p = new URLSearchParams(hash);
    return { channelKey: p.get('ch') || null, tab: p.get('tab') || null, vid: p.get('vid') || null };
  } catch {
    return { channelKey: null, tab: null, vid: null };
  }
}
let _currentVotePair = null;

// 無限スクロール
let _listPage       = 0;
const LIST_PAGE_SIZE = 40;
let _listPool       = [];
let _listObserver   = null;

// チャンネルキーをURL/ハンドルから解析
function channelKeyFromInput(input) {
  const trimmed = input.trim();
  // @handle 形式（日本語など Unicode ハンドルにも対応）
  const mHandle = trimmed.match(/@([^\s/?#&]+)/);
  if (mHandle) return { type: 'handle', value: '@' + mHandle[1] };
  // channel URL
  const mId = trimmed.match(/UC([\w-]{22})/);
  if (mId) return { type: 'id', value: 'UC' + mId[1] };
  // 単純ハンドル名（@ なし）
  if (/^[^\s/?#&]+$/.test(trimmed)) return { type: 'handle', value: '@' + trimmed };
  return null;
}

// --- チャンネル選択 ---
async function selectChannel(key) {
  const ch = channels[key];
  if (!ch) return;
  state.currentChannelKey = key;
  resetCurrentVideo();
  localStorage.setItem('m-last-channel', key);
  // チャンネル確定時点でハッシュも即更新（リロード時に旧チャンネルが復元されるのを防ぐ）
  // _suppressHistory 中（_restoreFromUrl 内）は呼ばない（currentTab が初期値 list のままでタブを上書きしてしまうため）
  if (!_suppressHistory) {
    history.replaceState({ tab: currentTab, channelKey: key, vid: null }, '', buildHash(key, currentTab, null));
  }

  // ヘッダーのチャンネル名・表示状態を更新（renderList 以外のタブでリフレッシュした場合も確実に反映）
  const displayName = ch.displayName || ch.handle || key;
  document.getElementById('mChNameDisplay').textContent = displayName;
  document.getElementById('mChPanelBtn').hidden = false;
  document.getElementById('mHeaderAppName').hidden = true;

  // キャッシュを先に反映して旧チャンネルのコンテンツを即座にクリア
  // 新規チャンネルはキャッシュなし → [] → 空状態を表示
  state.allVideos = loadVideosForChannel(key) || [];
  renderCurrentTab();

  try {
    state.allVideos = await fetchChannelVideos(key);
    saveVideosForChannel(key, state.allVideos);
  } catch {
    // オフライン時: キャッシュ (or []) が既に state.allVideos にセット済み
  }

  // 現在カテゴリに動画がなければ有効なカテゴリに切り替え
  const counts = { videos: 0, shorts: 0, live: 0 };
  state.allVideos.forEach(v => { if (counts[v.category] !== undefined) counts[v.category]++; });
  if (!counts[state.currentCat]) {
    state.currentCat = counts.live >= counts.videos && counts.live >= counts.shorts ? 'live'
               : counts.shorts > counts.videos ? 'shorts' : 'videos';
    localStorage.setItem(LS_CAT, state.currentCat);
  }

  // カテゴリボタンのアクティブ状態を同期
  document.querySelectorAll('.m-cat-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === state.currentCat);
  });

  // アクティブなタブを再描画
  await loadMyPins();
  renderCurrentTab();

  // サーバーからチャンネルメタを更新（バックグラウンド）
  syncChannelMeta(key, ch);
}

function syncChannelMeta(key, ch) {
  fetch('/api/channels').then(r => r.ok ? r.json() : null).then(list => {
    if (!list) return;
    const sc = list.find(c => c.channel_id === key);
    if (!sc) return;
    let changed = false;
    if (ch.displayName !== sc.title) { ch.displayName = sc.title; changed = true; }
    if (ch.avatar !== sc.icon_url)   { ch.avatar = sc.icon_url;   changed = true; }
    if (ch.handle !== sc.handle)     { ch.handle = sc.handle;     changed = true; }
    if (changed) {
      saveChannels();
      renderChannelPanel();
      document.getElementById('mChNameDisplay').textContent = ch.displayName || ch.handle || key;
    }
  }).catch(() => {});
}



// --- チャンネルパネル ---

// チャンネルカードのHTML要素を生成
function _makeChCard(key) {
  const ch = channels[key];
  const name = ch ? (ch.displayName || ch.handle || key) : key;
  const card = document.createElement('div');
  card.className = 'sidebar-channel-item' + (key === state.currentChannelKey ? ' active' : '');
  card.dataset.key = key;

  // アバター
  const avatarWrap = document.createElement('div');
  avatarWrap.className = 'sidebar-ch-avatar-wrap';
  if (ch && ch.avatar) {
    const img = document.createElement('img');
    img.className = 'sidebar-ch-avatar';
    img.src = ch.avatar;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onerror = function() { this.style.display = 'none'; };
    avatarWrap.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'sidebar-ch-avatar-ph';
    avatarWrap.appendChild(ph);
  }
  card.appendChild(avatarWrap);

  // チャンネル名
  const nameEl = document.createElement('span');
  nameEl.className = 'sidebar-ch-name';
  nameEl.textContent = name;
  card.appendChild(nameEl);

  // 設定ボタン（⋮）
  const menuBtn = document.createElement('button');
  menuBtn.className = 'm-ch-card-menu-btn';
  menuBtn.setAttribute('aria-label', t('settings-open-title'));
  menuBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
  menuBtn.addEventListener('click', e => {
    e.stopPropagation();
    _openChMenu(key, menuBtn);
  });
  card.appendChild(menuBtn);

  card.addEventListener('click', async () => {
    if (_mDragging) return;
    closeChannelPanel();
    await selectChannel(key);
  });

  return card;
}

// フォルダ⋮メニューを表示
function _openFolderMenu(item, anchorEl) {
  document.querySelectorAll('.m-folder-popup-menu').forEach(m => m.remove());

  const menu = document.createElement('div');
  menu.className = 'm-ch-card-menu m-folder-popup-menu';

  // リネーム
  const renameBtn = document.createElement('button');
  renameBtn.className = 'm-ch-card-menu-item';
  { const _i = document.createElement('i'); _i.setAttribute('data-lucide','pencil'); renameBtn.append(_i, t('folder-rename')); }
  renameBtn.addEventListener('click', e => {
    e.stopPropagation();
    menu.remove();
    _mOpenFolderDialog(newName => {
      const it = sidebarOrder.find(it => it.type === 'folder' && it.id === item.id);
      if (it) { it.name = newName; saveSidebarOrder(); renderChannelPanel(); }
    }, item.name || '');
  });

  // フォルダの色（ボタン＋トグル展開）
  const colorBtn = document.createElement('button');
  colorBtn.className = 'm-ch-card-menu-item';
  { const _i = document.createElement('i'); _i.setAttribute('data-lucide','palette'); colorBtn.append(_i, t('folder-color')); }
  const colorRow = document.createElement('div');
  colorRow.className = 'm-folder-color-row';
  colorRow.hidden = true;
  colorBtn.addEventListener('click', e => {
    e.stopPropagation();
    colorRow.hidden = !colorRow.hidden;
  });
  const _isJa = () => (localStorage.getItem('thumb-lang') || 'ja') === 'ja';
  WASHOKU_PALETTE.forEach(entry => {
    const sw = document.createElement('button');
    const isNone = entry.hue == null;
    sw.className = 'm-folder-color-swatch' + (isNone ? ' m-folder-color-swatch--none' : '') + (isNone ? (item.hue == null ? ' active' : '') : (item.hue === entry.hue ? ' active' : ''));
    if (!isNone) sw.style.background = 'hsl(' + entry.hue + ',40%,52%)';
    sw.title = _isJa() ? entry.name : entry.en;
    sw.addEventListener('click', e => {
      e.stopPropagation();
      const hue = isNone ? null : entry.hue;
      const it = sidebarOrder.find(it => it.type === 'folder' && it.id === item.id);
      if (it) { it.hue = hue; item.hue = hue; saveSidebarOrder(); renderChannelPanel(); }
      colorRow.querySelectorAll('.m-folder-color-swatch').forEach(s => s.classList.remove('active'));
      sw.classList.add('active');
    });
    colorRow.appendChild(sw);
  });

  // リフレッシュ
  const sep1 = document.createElement('div');
  sep1.className = 'm-ch-card-menu-sep';
  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'm-ch-card-menu-item';
  { const _i = document.createElement('i'); _i.setAttribute('data-lucide','refresh-cw'); refreshBtn.append(_i, t('m-ch-refresh')); }
  refreshBtn.addEventListener('click', e => {
    e.stopPropagation();
    menu.remove();
    const keys = [...(item.children || [])];
    const count = keys.length;
    if (!count) return;
    const msg = t('folder-refresh-confirm').replace('{name}', item.name || '').replace('{count}', count);
    const folderEl = document.querySelector('.sidebar-folder[data-folder-id="' + item.id + '"]');
    _mShowDelPopup(anchorEl, msg, async () => {
      if (folderEl) folderEl.classList.add('m-ch-refreshing');
      let totalVideos = 0;
      for (const key of keys) {
        if (!channels[key]) continue;
        const cardEl = document.querySelector('.sidebar-channel-item[data-key="' + key + '"]');
        if (cardEl) cardEl.classList.add('m-ch-refreshing');
        try {
          const res = await fetch('/api/channels/' + key + '/refresh', { method: 'POST' });
          const data = res.ok ? await res.json().catch(() => ({})) : {};
          if (data.total != null) totalVideos += data.total;
          if (res.ok && key === state.currentChannelKey) {
            state.allVideos = await fetchChannelVideos(key);
            saveVideosForChannel(key, state.allVideos);
            renderCurrentTab();
          }
        } catch (_) { /* ignore */ }
        if (cardEl) cardEl.classList.remove('m-ch-refreshing');
      }
      if (folderEl) folderEl.classList.remove('m-ch-refreshing');
      showToast(t('status-refresh-api', { total: totalVideos || '?' }));
    }, t('folder-refresh-ok'), undefined, 'ch-del-popup-ok--refresh');
  });

  // 削除（フォルダ解除）
  const sep2 = document.createElement('div');
  sep2.className = 'm-ch-card-menu-sep';
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'm-ch-card-menu-item m-ch-menu-danger';
  { const _i = document.createElement('i'); _i.setAttribute('data-lucide','x'); deleteBtn.append(_i, t('folder-delete')); }
  deleteBtn.addEventListener('click', e => {
    e.stopPropagation();
    menu.remove();
    const anchorRect = anchorEl.getBoundingClientRect();
    _mShowDelPopup(anchorEl,
      t('folder-delete-confirm').replace('{name}', item.name || t('folder-new-name')),
      () => {
        const idx = sidebarOrder.findIndex(it => it.type === 'folder' && it.id === item.id);
        if (idx !== -1) {
          const children = sidebarOrder[idx].children.map(k => ({ type: 'channel', key: k }));
          sidebarOrder.splice(idx, 1, ...children);
          saveSidebarOrder();
          renderChannelPanel();
        }
      },
      t('folder-delete'),
      anchorRect
    );
  });

  menu.append(renameBtn, refreshBtn, sep1, colorBtn, colorRow, sep2, deleteBtn);
  document.body.appendChild(menu);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [menu] });

  const r = anchorEl.getBoundingClientRect();
  const mw = menu.offsetWidth || 160;
  const mh = menu.offsetHeight || 150;
  let left = r.right - mw;
  let top  = r.bottom + 4;
  if (left < 4) left = 4;
  if (top + mh > window.innerHeight - 8) top = r.top - mh - 4;
  menu.style.left = left + 'px';
  menu.style.top  = top  + 'px';

  setTimeout(() => {
    const outside = ev => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', outside, true);
      }
    };
    document.addEventListener('click', outside, true);
  }, 0);
}

// フォルダ要素を生成
function _makeFolderEl(item) {
  const folder = document.createElement('div');
  folder.className = 'sidebar-folder';
  if (item.open !== false) folder.classList.add('sidebar-folder--open');
  folder.dataset.folderId = item.id;
  folder.dataset.hue = item.hue != null ? item.hue : '';
  if (item.hue != null) {
    folder.style.setProperty('--folder-tint', 'hsla(' + item.hue + ',55%,42%,0.10)');
  }

  // ヘッダー
  const header = document.createElement('div');
  header.className = 'sidebar-folder-header';

  // プレビュー（子チャンネルの最初の2つ）
  const preview = document.createElement('div');
  preview.className = 'sidebar-folder-preview';
  const keys = item.children || [];
  [0, 1].forEach(i => {
    const img = document.createElement('div');
    img.className = 'sidebar-folder-preview-img';
    const ch = keys[i] ? channels[keys[i]] : null;
    if (ch && ch.avatar) {
      img.style.backgroundImage = 'url(' + ch.avatar + ')';
      img.style.backgroundSize = 'cover';
    } else {
      img.style.background = 'hsl(' + ((item.hue || 0) + i * 30) + ',40%,35%)';
    }
    preview.appendChild(img);
  });
  const openIcon = document.createElement('div');
  openIcon.className = 'sidebar-folder-open-icon';
  openIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  preview.appendChild(openIcon);
  header.appendChild(preview);

  const nameEl = document.createElement('span');
  nameEl.className = 'sidebar-folder-name';
  nameEl.textContent = item.name || t('folder-new-name');
  header.appendChild(nameEl);

  // ⋮メニューボタン
  const folderMenuBtn = document.createElement('button');
  folderMenuBtn.className = 'm-ch-card-menu-btn';
  folderMenuBtn.setAttribute('aria-label', t('settings-open-title'));
  folderMenuBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>';
  folderMenuBtn.addEventListener('click', e => {
    e.stopPropagation();
    _openFolderMenu(item, folderMenuBtn);
  });
  header.appendChild(folderMenuBtn);

  // トグル
  header.addEventListener('click', () => {
    if (_mDragging) return;
    const open = folder.classList.toggle('sidebar-folder--open');
    const ch = folder.querySelector('.sidebar-folder-children');
    if (ch) {
      if (open) {
        ch.style.maxHeight = ch.scrollHeight + 'px';
        ch.addEventListener('transitionend', () => {
          if (folder.classList.contains('sidebar-folder--open')) ch.style.maxHeight = 'none';
        }, { once: true });
      } else {
        ch.style.maxHeight = ch.scrollHeight + 'px';
        requestAnimationFrame(() => requestAnimationFrame(() => { ch.style.maxHeight = '0'; }));
      }
    }
    // sidebarOrder に open 状態を保存
    const it = sidebarOrder.find(it => it.type === 'folder' && it.id === item.id);
    if (it) { it.open = open; saveSidebarOrder(); }
  });

  folder.appendChild(header);

  // 子チャンネルリスト
  const children = document.createElement('div');
  children.className = 'sidebar-folder-children';
  children.style.maxHeight = (item.open !== false) ? 'none' : '0';
  keys.forEach(k => {
    const card = _makeChCard(k);
    children.appendChild(card);
  });
  folder.appendChild(children);

  return folder;
}

function renderChannelPanel() {
  syncSidebarOrder();
  const list = document.getElementById('mChList');
  list.innerHTML = '';

  if (Object.keys(channels).length === 0) {
    const msg = document.createElement('div');
    msg.className = 'm-empty-msg';
    msg.style.padding = '24px 16px';
    msg.style.fontSize = '12px';
    msg.textContent = t('m-ch-empty');
    list.appendChild(msg);
    return;
  }

  sidebarOrder.forEach(item => {
    if (item.type === 'channel') {
      list.appendChild(_makeChCard(item.key));
    } else if (item.type === 'folder') {
      list.appendChild(_makeFolderEl(item));
    }
  });
}

function openChannelPanel() {
  renderChannelPanel();
  document.getElementById('mChPanel').classList.add('open');
  document.getElementById('mChOverlay').classList.add('open');
  // パネルを開いたとき編集モードを自動的に有効化（すぐ長押しでドラッグできるように）
  _mEditMode = true;
  document.getElementById('mEditModeBtn')?.classList.add('edit-active');
  document.getElementById('mChList')?.classList.add('edit-mode');
  // パネルを開いたとき、戻るボタンで閉じられるよう履歴を追加
  if (!_suppressHistory) {
    history.pushState({ ...(history.state || {}), panelOpen: true }, '');
  }
}

function closeChannelPanel() {
  document.getElementById('mChPanel').classList.remove('open');
  document.getElementById('mChOverlay').classList.remove('open');
  _mEditMode = false;
  document.getElementById('mEditModeBtn')?.classList.remove('edit-active');
  document.getElementById('mChList')?.classList.remove('edit-mode');
}

// サイドバーをスワイプで閉じる
(function() {
  const panel = document.getElementById('mChPanel');
  let _swipeStartX = 0, _swipeStartY = 0;
  panel.addEventListener('touchstart', e => {
    _swipeStartX = e.touches[0].clientX;
    _swipeStartY = e.touches[0].clientY;
  }, { passive: true });
  panel.addEventListener('touchend', e => {
    if (_mDragging) return;
    const dx = e.changedTouches[0].clientX - _swipeStartX;
    const dy = e.changedTouches[0].clientY - _swipeStartY;
    if (dx < -50 && Math.abs(dy) < Math.abs(dx)) closeChannelPanel();
  }, { passive: true });
})();

// --- 削除確認ポップアップ (PC版 _showChDelPopup と同等) ---
function _mShowDelPopup(anchorEl, msg, onConfirm, okLabel, anchorRect, okClass) {
  const rect = anchorRect || anchorEl.getBoundingClientRect();
  document.querySelectorAll('.ch-del-popup').forEach(p => p.remove());
  const popup = document.createElement('div');
  popup.className = 'ch-del-popup';
  popup.style.visibility = 'hidden';
  const msgEl = document.createElement('span');
  msgEl.className = 'ch-del-popup-msg';
  msgEl.textContent = msg;
  const btnRow = document.createElement('div');
  btnRow.className = 'ch-del-popup-btns';
  const okBtn = document.createElement('button');
  okBtn.className = 'ch-del-popup-ok' + (okClass ? ' ' + okClass : '');
  okBtn.textContent = okLabel || t('ch-delete-ok');
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'ch-del-popup-cancel';
  cancelBtn.textContent = t('cancel');
  btnRow.append(okBtn, cancelBtn);
  popup.append(msgEl, btnRow);
  document.body.appendChild(popup);
  const pw = popup.offsetWidth, ph = popup.offsetHeight;
  let left = rect.left;
  let top  = rect.bottom + 6;
  if (left + pw > window.innerWidth  - 4) left = window.innerWidth  - pw - 4;
  if (left < 4) left = 4;
  if (top  + ph > window.innerHeight - 4) top  = rect.top - ph - 6;
  if (top  < 4) top = 4;
  popup.style.left = left + 'px';
  popup.style.top  = top  + 'px';
  popup.style.visibility = '';
  const close = () => {
    popup.remove();
    document.removeEventListener('keydown', escHandler);
  };
  const escHandler = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', escHandler);
  okBtn.addEventListener('click', e => { e.stopPropagation(); close(); onConfirm(); });
  cancelBtn.addEventListener('click', e => { e.stopPropagation(); close(); });
  setTimeout(() => {
    const outside = e => { if (!popup.contains(e.target)) { close(); document.removeEventListener('click', outside, true); } };
    document.addEventListener('click', outside, true);
  }, 0);
}

// --- フォルダ名ダイアログ ---
let _mFolderDialogCb = null;

function _mOpenFolderDialog(cb, initialValue) {
  _mFolderDialogCb = cb;
  const overlay = document.getElementById('mFolderOverlay');
  const input = document.getElementById('mFolderNameInput');
  input.value = initialValue || '';
  overlay.classList.add('open');
  setTimeout(() => { input.focus(); input.select(); }, 50);
}
function _mCloseFolderDialog() {
  document.getElementById('mFolderOverlay').classList.remove('open');
  _mFolderDialogCb = null;
}
(function() {
  document.getElementById('mFolderOkBtn').addEventListener('click', () => {
    if (!_mFolderDialogCb) return;
    const name = document.getElementById('mFolderNameInput').value.trim();
    _mFolderDialogCb(name || t('folder-new-name'));
    _mCloseFolderDialog();
  });
  document.getElementById('mFolderCancelBtn').addEventListener('click', _mCloseFolderDialog);
  document.getElementById('mFolderNameInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('mFolderOkBtn').click();
    if (e.key === 'Escape') _mCloseFolderDialog();
  });
  document.getElementById('mFolderOverlay').addEventListener('click', e => {
    if (e.target === document.getElementById('mFolderOverlay')) _mCloseFolderDialog();
  });
})();

// --- ドラッグ&ドロップ (チャンネルリスト) ---
let _mDragging = false;
let _mEditMode = false;
let _mGhost = null;
let _mSrcEl = null;
let _mLongpressTimer = null;
let _mLongpressHint = null;
let _mTouchActiveEl = null;
let _mDragStartX = 0, _mDragStartY = 0;
let _mIndicator = null;
let _mOffX = 0, _mOffY = 0;
let _mDragFolderWasOpen = false;
let _mAutoScrollDir = 0;
let _mAutoScrollSpeed = 6;
let _mAutoScrollRaf = null;

function _mShowIndicator(refEl, before) {
  if (!_mIndicator) {
    _mIndicator = document.createElement('div');
    _mIndicator.className = 'm-drop-indicator';
    _mIndicator.style.cssText = 'position:fixed;left:0;right:0;height:2px;background:var(--accent);z-index:9999;pointer-events:none;border-radius:2px;';
    document.body.appendChild(_mIndicator);
  }
  const r = refEl.getBoundingClientRect();
  const chList = document.getElementById('mChList');
  const lr = chList.getBoundingClientRect();
  _mIndicator.style.display = 'block';
  _mIndicator.style.top  = (before ? r.top - 1 : r.bottom - 1) + 'px';
  _mIndicator.style.left = lr.left + 'px';
  _mIndicator.style.right = (window.innerWidth - lr.right) + 'px';
  _mIndicator.style.width = '';
}
function _mHideIndicator() {
  if (_mIndicator) _mIndicator.style.display = 'none';
}

function _mGetDropInfo(cy, noMerge = false) {
  const chList = document.getElementById('mChList');
  const items = [...chList.querySelectorAll(':scope > .sidebar-channel-item:not(.dragging), :scope > .sidebar-folder:not(.dragging)')];
  if (!items.length) return null;
  const first = items[0].getBoundingClientRect();
  if (cy < first.top + first.height * 0.3) return { before: items[0] };
  const last = items[items.length - 1].getBoundingClientRect();
  if (cy > last.bottom) return { after: items[items.length - 1] };
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    if (cy >= r.top && cy <= r.bottom) {
      const relY = (cy - r.top) / r.height;
      if (relY < 0.3) {
        const prev = items[i - 1];
        return prev ? { after: prev } : { before: items[i] };
      } else if (relY > 0.7) {
        return { after: items[i] };
      } else {
        if (noMerge) return { after: items[i] }; // フォルダドラッグ時は merge zone を after として扱う
        return null; // merge zone
      }
    }
  }
  if (items.length > 1) {
    const prev = items[items.length - 2];
    const cur  = items[items.length - 1];
    if (cy > prev.getBoundingClientRect().bottom && cy < cur.getBoundingClientRect().top) {
      return { after: prev };
    }
  }
  return null;
}

function _mUpdateFeedback(cx, cy) {
  if (!_mDragging || !_mSrcEl) return;
  // パネル外（X座標がサイドバー外）ではインジケーターを非表示
  const _panelEl = document.getElementById('mChPanel');
  if (_panelEl) {
    const _pr = _panelEl.getBoundingClientRect();
    if (cx < _pr.left || cx > _pr.right) { _mHideIndicator(); return; }
  }
  document.querySelectorAll('.merge-hover').forEach(el => el.classList.remove('merge-hover'));
  document.querySelectorAll('.drop-bottom').forEach(el => el.classList.remove('drop-bottom'));

  // リスト全体の最後のアイテムより下の空白にある場合は先に確定
  const _chListEl = document.getElementById('mChList');
  const _topItems = [..._chListEl.querySelectorAll(':scope > .sidebar-channel-item:not(.dragging), :scope > .sidebar-folder:not(.dragging)')];
  if (_topItems.length) {
    const _lastRect = _topItems[_topItems.length - 1].getBoundingClientRect();
    if (cy > _lastRect.bottom) {
      _mShowIndicator(_topItems[_topItems.length - 1], false);
      return;
    }
  }

  const under = document.elementFromPoint(cx, cy);
  const srcIsCard  = _mSrcEl.classList.contains('sidebar-channel-item');
  const targetCard = under?.closest('.sidebar-channel-item:not(.dragging)');
  const targetFolHdr = under?.closest('.sidebar-folder-header');

  if (srcIsCard && targetCard) {
    const inChildren    = !!targetCard.closest('.sidebar-folder-children');
    const srcInChildren = !!_mSrcEl.closest('.sidebar-folder-children');
    const r = targetCard.getBoundingClientRect();
    const relY = (cy - r.top) / r.height;
    // フォルダ内最後チャンネルの下半分 → インジケーターは後続処理で表示
    if (inChildren && relY > 0.5) {
      const siblings = [...targetCard.closest('.sidebar-folder-children').querySelectorAll('.sidebar-channel-item:not(.dragging)')];
      if (targetCard === siblings[siblings.length - 1]) {
        // drop-bottom クラスは使わない（高さ変動でガタつくため）
      }
    }
    if (inChildren) {
      if (relY < 0.5) {
        const prev = targetCard.previousElementSibling;
        if (prev && prev.classList.contains('sidebar-channel-item') && !prev.classList.contains('dragging')) {
          _mShowIndicator(prev, false);
        } else { _mShowIndicator(targetCard, true); }
      } else { _mShowIndicator(targetCard, false); }
    } else {
      if (relY < 0.3) {
        const prev = targetCard.previousElementSibling;
        if (prev && prev.classList.contains('sidebar-channel-item') && !prev.classList.contains('dragging')) {
          _mShowIndicator(prev, false);
        } else { _mShowIndicator(targetCard, true); }
      } else if (relY > 0.7) { _mShowIndicator(targetCard, false); }
      else { targetCard.classList.add('merge-hover'); _mHideIndicator(); }
    }
  } else if (srcIsCard && targetFolHdr && !_mSrcEl.closest('.sidebar-folder-children')) {
    targetFolHdr.classList.add('merge-hover'); _mHideIndicator();
  } else {
    const targetFolder = under?.closest('.sidebar-folder--open');
    if (srcIsCard && targetFolder) {
      const kids = [...targetFolder.querySelectorAll('.sidebar-folder-children > .sidebar-channel-item:not(.dragging)')];
      const lastKid = kids[kids.length - 1];
      if (lastKid && cy > lastKid.getBoundingClientRect().bottom && lastKid.nextElementSibling !== _mSrcEl) {
        _mShowIndicator(lastKid, false); return;
      }
    }
    if (_mSrcEl.closest('.sidebar-folder-children')) {
      // フォルダの外（上下）に出た場合はトップレベルへのドロップを許可
      const parentFolder = _mSrcEl.closest('.sidebar-folder');
      if (parentFolder) {
        const fr = parentFolder.getBoundingClientRect();
        if (cy < fr.top || cy > fr.bottom) {
          const info = _mGetDropInfo(cy);
          if (info) { if (info.before) _mShowIndicator(info.before, true); else _mShowIndicator(info.after, false); }
          else _mHideIndicator();
          return;
        }
      }
      _mHideIndicator(); return;
    }
    const info = _mGetDropInfo(cy);
    if (info) { if (info.before) _mShowIndicator(info.before, true); else _mShowIndicator(info.after, false); }
    else _mHideIndicator();
  }
}

function _mMergeIntoNewFolder(srcEl, targetEl, name) {
  const srcKey    = srcEl.dataset.key;
  const targetKey = targetEl.dataset.key;
  // sidebarOrder を更新
  const srcIdx    = _mFindOrderIdx(srcKey);
  const targetIdx = _mFindOrderIdx(targetKey);
  const hue = Math.floor(Math.random() * 360);
  const fid = 'f' + Date.now();
  const newFolder = { type: 'folder', id: fid, name, hue, children: [targetKey, srcKey], open: true };
  // targetIdx に folder を挿入、srcIdx を削除
  sidebarOrder.splice(Math.min(srcIdx, targetIdx), 0, newFolder);
  sidebarOrder = sidebarOrder.filter((it, i) => {
    if (i === Math.min(srcIdx, targetIdx)) return true; // 新フォルダ
    if (it.type === 'channel' && (it.key === srcKey || it.key === targetKey)) return false;
    return true;
  });
  // フォルダ children からも src/target を除去（フォルダ内からドラッグした場合に対応）
  sidebarOrder.forEach(it => {
    if (it.type === 'folder' && it.id !== fid) {
      it.children = it.children.filter(k => k !== srcKey && k !== targetKey);
    }
  });
  // 空になったフォルダを除去
  sidebarOrder = sidebarOrder.filter(it => it.type !== 'folder' || it.children.length > 0);
  // インデックスがずれているので再フィルタ
  const seen = new Set();
  const deduped = [];
  for (const it of sidebarOrder) {
    const uid = it.type === 'folder' ? it.id : it.key;
    if (!seen.has(uid)) { seen.add(uid); deduped.push(it); }
  }
  sidebarOrder = deduped;
  saveSidebarOrder();
  renderChannelPanel();
}

function _mCleanEmptyFolders() {
  const chList = document.getElementById('mChList');
  let changed = false;
  // 1子フォルダ → チャンネル直置きに昇格（PCと同じ挙動）
  for (const folderEl of [...chList.querySelectorAll('.sidebar-folder')]) {
    const kids = [...folderEl.querySelectorAll(':scope > .sidebar-folder-children > .sidebar-channel-item')];
    if (kids.length === 1) {
      folderEl.replaceWith(kids[0]);
      changed = true;
    } else if (kids.length === 0) {
      folderEl.remove();
      changed = true;
    }
  }
  if (changed) {
    sidebarOrder = sidebarOrder.map(it =>
      (it.type === 'folder' && it.children.length === 1)
        ? { type: 'channel', key: it.children[0] } : it
    );
    sidebarOrder = sidebarOrder.filter(it => it.type !== 'folder' || it.children.length > 0);
    saveSidebarOrder();
  }
}

function _mFindOrderIdx(key) {
  for (let i = 0; i < sidebarOrder.length; i++) {
    const it = sidebarOrder[i];
    if (it.type === 'channel' && it.key === key) return i;
    if (it.type === 'folder' && it.children.includes(key)) return i;
  }
  return sidebarOrder.length;
}

function _mAddToFolder(srcEl, fid) {
  const srcKey = srcEl.dataset.key;
  // src を既存 order から除去
  sidebarOrder = sidebarOrder.filter(it => !(it.type === 'channel' && it.key === srcKey));
  sidebarOrder.forEach(it => {
    if (it.type === 'folder' && it.id !== fid) {
      it.children = it.children.filter(k => k !== srcKey);
    }
  });
  // 対象フォルダに追加
  const folder = sidebarOrder.find(it => it.type === 'folder' && it.id === fid);
  if (folder && !folder.children.includes(srcKey)) folder.children.push(srcKey);
  saveSidebarOrder();
  renderChannelPanel();
}

function _mSaveSidebarOrderFromDOM() {
  const chList = document.getElementById('mChList');
  const newOrder = [];
  for (const el of chList.children) {
    if (el.classList.contains('sidebar-channel-item')) {
      newOrder.push({ type: 'channel', key: el.dataset.key });
    } else if (el.classList.contains('sidebar-folder')) {
      const fid = el.dataset.folderId;
      const fname = el.querySelector('.sidebar-folder-name')?.textContent || '';
      const hue = el.dataset.hue !== '' ? parseInt(el.dataset.hue) : null;
      const open = el.classList.contains('sidebar-folder--open');
      const children = [...el.querySelectorAll('.sidebar-folder-children > .sidebar-channel-item')].map(c => c.dataset.key);
      newOrder.push({ type: 'folder', id: fid, name: fname, hue, children, open });
    }
  }
  sidebarOrder = newOrder;
  saveSidebarOrder();
}

function _mAutoScrollStep() {
  if (!_mDragging || _mAutoScrollDir === 0) { _mAutoScrollRaf = null; return; }
  document.getElementById('mChList').scrollTop += _mAutoScrollDir * _mAutoScrollSpeed;
  _mAutoScrollRaf = requestAnimationFrame(_mAutoScrollStep);
}

function _mEndDrag(cx, cy) {
  if (!_mDragging) return;
  _mAutoScrollDir = 0;
  if (_mAutoScrollRaf) { cancelAnimationFrame(_mAutoScrollRaf); _mAutoScrollRaf = null; }
  _mDragging = false;
  document.getElementById('mChList').classList.remove('sidebar--dragging');
  document.querySelectorAll('.merge-hover').forEach(el => el.classList.remove('merge-hover'));
  document.querySelectorAll('.drop-bottom').forEach(el => el.classList.remove('drop-bottom'));
  if (_mGhost) { _mGhost.remove(); _mGhost = null; }
  // パネル外（X座標がサイドバー外）でのリリースはキャンセル
  const _panelElEnd = document.getElementById('mChPanel');
  if (_panelElEnd) {
    const _prEnd = _panelElEnd.getBoundingClientRect();
    if (cx < _prEnd.left || cx > _prEnd.right) {
      _mSrcEl.style.touchAction = '';
      _mSrcEl.classList.remove('dragging');
      if (_mDragFolderWasOpen) {
        const childrenEl = _mSrcEl.querySelector('.sidebar-folder-children');
        if (childrenEl) { childrenEl.style.display = ''; childrenEl.style.maxHeight = 'none'; }
        _mSrcEl.classList.add('sidebar-folder--open');
      }
      _mDragFolderWasOpen = false;
      _mHideIndicator();
      _mSrcEl = null;
      return;
    }
  }
  _mSrcEl.style.touchAction = '';
  _mSrcEl.classList.remove('dragging');
  // NOTE: _mDragFolderWasOpen の children 復元はドロップ先確定後に行う（位置計算がズレるのを防ぐ）
  _mHideIndicator();

  // リスト全体の最後のアイテムより下にドロップ → フォルダ内外問わずトップレベル末尾へ
  {
    const _dropChList = document.getElementById('mChList');
    const _dropItems  = [..._dropChList.querySelectorAll(':scope > .sidebar-channel-item, :scope > .sidebar-folder')].filter(el => el !== _mSrcEl);
    if (_dropItems.length && cy > _dropItems[_dropItems.length - 1].getBoundingClientRect().bottom) {
      _dropChList.appendChild(_mSrcEl);
      if (_mDragFolderWasOpen) {
        const childrenEl = _mSrcEl.querySelector('.sidebar-folder-children');
        if (childrenEl) { childrenEl.style.display = ''; childrenEl.style.maxHeight = 'none'; }
        _mSrcEl.classList.add('sidebar-folder--open');
        _mDragFolderWasOpen = false;
      }
      _mSaveSidebarOrderFromDOM();
      _mCleanEmptyFolders();
      _mSrcEl = null; return;
    }
  }

  _mSrcEl.style.visibility = 'hidden';
  const under = document.elementFromPoint(cx, cy);
  _mSrcEl.style.visibility = '';

  if (under) {
    const targetCard   = under.closest('.sidebar-channel-item');
    const targetFolHdr = under.closest('.sidebar-folder-header');
    const srcIsCard    = _mSrcEl.classList.contains('sidebar-channel-item');
    if (srcIsCard && targetCard && targetCard !== _mSrcEl) {
      const inChildren    = !!targetCard.closest('.sidebar-folder-children');
      const srcInChildren = !!_mSrcEl.closest('.sidebar-folder-children');
      const r = targetCard.getBoundingClientRect();
      const relY = (cy - r.top) / r.height;
      if (inChildren) {
        if (relY < 0.5) {
          const prev = targetCard.previousElementSibling;
          if (prev && prev.classList.contains('sidebar-channel-item') && !prev.classList.contains('dragging')) {
            prev.after(_mSrcEl);
          } else { targetCard.before(_mSrcEl); }
        } else { targetCard.after(_mSrcEl); }
        _mSaveSidebarOrderFromDOM(); _mCleanEmptyFolders(); _mSrcEl = null; return;
      } else {
        if (relY < 0.3) {
          const prev = targetCard.previousElementSibling;
          if (prev && prev.classList.contains('sidebar-channel-item') && !prev.classList.contains('dragging')) {
            prev.after(_mSrcEl);
          } else { targetCard.before(_mSrcEl); }
          _mSaveSidebarOrderFromDOM(); _mCleanEmptyFolders(); _mSrcEl = null; return;
        } else if (relY > 0.7) {
          targetCard.after(_mSrcEl);
          _mSaveSidebarOrderFromDOM(); _mCleanEmptyFolders(); _mSrcEl = null; return;
        } else {
          // merge
          const paired  = targetCard;
          const srcSnap = _mSrcEl;
          _mOpenFolderDialog(name => { _mMergeIntoNewFolder(srcSnap, paired, name); });
          _mSrcEl = null; return;
        }
      }
    } else if (srcIsCard && targetFolHdr && !_mSrcEl.closest('.sidebar-folder-children')) {
      const fid = targetFolHdr.closest('.sidebar-folder').dataset.folderId;
      _mAddToFolder(_mSrcEl, fid);
      _mSrcEl = null; return;
    }
    const targetFolder2 = under.closest('.sidebar-folder--open');
    if (srcIsCard && targetFolder2) {
      const kids2 = [...targetFolder2.querySelectorAll('.sidebar-folder-children > .sidebar-channel-item')].filter(el => el !== _mSrcEl);
      const lastKid2 = kids2[kids2.length - 1];
      if (lastKid2 && cy > lastKid2.getBoundingClientRect().bottom && lastKid2.nextElementSibling !== _mSrcEl) {
        lastKid2.after(_mSrcEl);
        _mSaveSidebarOrderFromDOM(); _mCleanEmptyFolders(); _mSrcEl = null; return;
      }
    }
  }

  if (_mSrcEl && _mSrcEl.closest('.sidebar-folder-children')) {
    // フォルダ外にドロップした場合はトップレベルに取り出す
    const parentFolder2 = _mSrcEl.closest('.sidebar-folder');
    if (parentFolder2) {
      const fr2 = parentFolder2.getBoundingClientRect();
      if (cy < fr2.top || cy > fr2.bottom) {
        const info = _mGetDropInfo(cy);
        const chList = document.getElementById('mChList');
        if (info) {
          if (info.before && info.before !== _mSrcEl) chList.insertBefore(_mSrcEl, info.before);
          else if (info.after && info.after !== _mSrcEl) info.after.after(_mSrcEl);
        } else {
          chList.appendChild(_mSrcEl);
        }
        _mSaveSidebarOrderFromDOM(); _mCleanEmptyFolders(); _mSrcEl = null; return;
      }
    }
    _mSrcEl = null; return;
  }
  const _srcIsFolder = _mSrcEl.classList.contains('sidebar-folder');
  const info = _mGetDropInfo(cy, _srcIsFolder);
  const chList = document.getElementById('mChList');
  if (info) {
    if (info.before && info.before !== _mSrcEl) chList.insertBefore(_mSrcEl, info.before);
    else if (info.after && info.after !== _mSrcEl) info.after.after(_mSrcEl);
  }
  if (_mDragFolderWasOpen) {
    const childrenEl = _mSrcEl.querySelector('.sidebar-folder-children');
    if (childrenEl) { childrenEl.style.display = ''; childrenEl.style.maxHeight = 'none'; }
    _mSrcEl.classList.add('sidebar-folder--open');
    _mDragFolderWasOpen = false;
  }
  _mSaveSidebarOrderFromDOM(); _mCleanEmptyFolders(); _mSrcEl = null;
}

(function() {
  const chList = document.getElementById('mChList');
  let _mListMomentumRaf = null;

  function _mStartDrag(srcEl, startX, startY) {
    if (_mLongpressHint) { _mLongpressHint.remove(); _mLongpressHint = null; }
    _mDragging = true;
    document.body.style.touchAction = 'none';
    srcEl.style.touchAction = 'none';
    _mSrcEl = srcEl;
    chList.classList.add('sidebar--dragging');
    if (_mTouchActiveEl) { _mTouchActiveEl.classList.remove('touch-hover'); _mTouchActiveEl = null; }
    _mDragFolderWasOpen = false;
    if (srcEl.classList.contains('sidebar-folder') && srcEl.classList.contains('sidebar-folder--open')) {
      _mDragFolderWasOpen = true;
      srcEl.classList.remove('sidebar-folder--open');
      const childrenEl = srcEl.querySelector('.sidebar-folder-children');
      if (childrenEl) childrenEl.style.display = 'none';
    }
    srcEl.classList.add('dragging');
    const r = srcEl.getBoundingClientRect();
    _mOffX = startX - r.left;
    _mOffY = startY - r.top;
    _mGhost = srcEl.cloneNode(true);
    _mGhost.classList.add('m-drag-ghost');
    _mGhost.classList.remove('active', 'dragging', 'touch-hover');
    _mGhost.style.cssText = 'position:fixed;z-index:9998;pointer-events:none;width:' + r.width + 'px;left:' + (startX - _mOffX) + 'px;top:' + (startY - _mOffY) + 'px;';
    _mGhost.querySelectorAll('.m-ch-card-menu-btn, .ch-actions').forEach(el => el.remove());
    document.body.appendChild(_mGhost);
  }

  chList.addEventListener('touchstart', e => {
    if (_mDragging) { e.preventDefault(); return; }
    // 慣性スクロール中でも即座に反応できるようキャンセル
    if (_mListMomentumRaf) { cancelAnimationFrame(_mListMomentumRaf); _mListMomentumRaf = null; }
    const touch = e.touches[0];
    const srcEl = e.target.closest('.sidebar-channel-item, .sidebar-folder');
    if (!srcEl || e.target.closest('.ch-action-btn, .m-ch-card-menu-btn')) return;
    // 編集モードOFFの時：ネイティブスクロールを維持しつつ長押し検知のみ行う
    if (!_mEditMode) {
      const startX = touch.clientX, startY = touch.clientY;
      _mDragStartX = startX; _mDragStartY = startY;
      let _longpressFired = false;
      const longpressTimer = setTimeout(() => {
        _longpressFired = true;
        _mEditMode = true;
        const _editBtn = document.getElementById('mEditModeBtn');
        if (_editBtn) _editBtn.classList.add('edit-active');
        chList.classList.add('edit-mode');
        // touchmove のみ削除（touchend は残し、指を離した時に edit-mode を解除できるようにする）
        document.removeEventListener('touchmove', onLongpressMove);
      }, 500);
      const cleanup = () => {
        clearTimeout(longpressTimer);
        document.removeEventListener('touchmove', onLongpressMove);
        document.removeEventListener('touchend', onLongpressEnd);
        document.removeEventListener('touchcancel', onLongpressEnd);
      };
      const onLongpressMove = ev => {
        const t = [...ev.touches].find(t => t.identifier === touch.identifier);
        if (!t) return;
        if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) cleanup();
      };
      const onLongpressEnd = () => {
        cleanup();
        // ロングプレス成立後は edit-mode クラスを維持する
        // （remove するとネイティブスクロールが優先され次のタッチでドラッグできなくなる）
      };
      document.addEventListener('touchmove', onLongpressMove, { passive: true });
      document.addEventListener('touchend', onLongpressEnd);
      document.addEventListener('touchcancel', onLongpressEnd);
      return; // e.preventDefault() は呼ばない → ネイティブスクロール維持
    }
    // edit-mode クラスがある時のみ preventDefault（スクロール禁止）
    // edit-mode クラスがない時（ドラッグ後）はスクロール可能にして touchcancel を受け入れる
    if (chList.classList.contains('edit-mode')) {
      e.preventDefault();
    }
    const touchId = touch.identifier;
    const startX = touch.clientX, startY = touch.clientY;
    _mDragStartX = startX; _mDragStartY = startY;
    let _prevScrollY = startY;
    let _prevScrollTime = performance.now();
    let _scrollVY = 0;
    _mLongpressTimer = setTimeout(() => {
      // 長押しで自動的に編集モードを有効化
      if (!_mEditMode) {
        _mEditMode = true;
        const _editBtn = document.getElementById('mEditModeBtn');
        if (_editBtn) _editBtn.classList.add('edit-active');
        chList.classList.add('edit-mode');
      }
      _mStartDrag(srcEl, startX, startY);
    }, 400);

    const onMove = ev => {
      const t = [...ev.touches].find(t => t.identifier === touchId);
      if (!t) return;
      if ((_mDragging || chList.classList.contains('edit-mode')) && ev.cancelable) {
        ev.preventDefault();
      }
      if (_mLongpressTimer && !_mDragging) {
        const dx = Math.abs(t.clientX - _mDragStartX);
        const dy = Math.abs(t.clientY - _mDragStartY);
        if (dy > 30 || dx > 20) {
          clearTimeout(_mLongpressTimer); _mLongpressTimer = null;
        }
      }
      if (!_mDragging) {
        // edit-mode クラスがない時はネイティブスクロールに任せる
        if (!chList.classList.contains('edit-mode')) return;
        // edit-mode あり（長押し待機中）→ 手動スクロール
        const now = performance.now();
        const dt = Math.max(1, now - _prevScrollTime);
        const dy = t.clientY - _prevScrollY;
        chList.scrollTop -= dy;
        _scrollVY = dy / dt;
        _prevScrollY = t.clientY;
        _prevScrollTime = now;
        return;
      }
      if (!_mGhost) return;
      _mGhost.style.left = (t.clientX - _mOffX) + 'px';
      _mGhost.style.top  = (t.clientY - _mOffY) + 'px';
      _mUpdateFeedback(t.clientX, t.clientY);
      // オートスクロール方向の更新（端に近いほど加速）
      const listRect = chList.getBoundingClientRect();
      const zone = 80;
      if (t.clientY < listRect.top + zone) {
        _mAutoScrollDir = -1;
        const dist = Math.max(0, t.clientY - listRect.top);
        _mAutoScrollSpeed = Math.round(4 + (1 - dist / zone) * 16);
      } else if (t.clientY > listRect.bottom - zone) {
        _mAutoScrollDir = 1;
        const dist = Math.max(0, listRect.bottom - t.clientY);
        _mAutoScrollSpeed = Math.round(4 + (1 - dist / zone) * 16);
      } else {
        _mAutoScrollDir = 0;
        _mAutoScrollSpeed = 6;
      }
      if (_mAutoScrollDir !== 0 && !_mAutoScrollRaf) {
        _mAutoScrollRaf = requestAnimationFrame(_mAutoScrollStep);
      }
    };
    const onEnd = ev => {
      const t = [...ev.changedTouches].find(t => t.identifier === touchId);
      if (!t) return;
      document.body.style.touchAction = '';
      srcEl.style.touchAction = '';
      document.removeEventListener('touchmove',   onMove);
      document.removeEventListener('touchend',    onEnd);
      document.removeEventListener('touchcancel', onCancel);
      clearTimeout(_mLongpressTimer); _mLongpressTimer = null;
      if (_mDragging) {
        _mEndDrag(t.clientX, t.clientY);
        // ドラッグ後も edit-mode を維持して次もすぐ掴める状態に保つ
        chList.classList.add('edit-mode');
      } else {
        const _tapDx = Math.abs(t.clientX - _mDragStartX);
        const _tapDy = Math.abs(t.clientY - _mDragStartY);
        if (_tapDx < 10 && _tapDy < 10) {
          // タップ判定: edit-mode 中のみ手動 click（preventDefault でネイティブが消えているため）
          // edit-mode なし（ドラッグ後）はネイティブ click に任せる
          if (chList.classList.contains('edit-mode')) {
            if (srcEl.classList.contains('sidebar-folder')) {
              const hdr = srcEl.querySelector('.sidebar-folder-header');
              if (hdr) hdr.click();
            } else {
              srcEl.click();
            }
          }
        } else {
          // 慣性スクロール（edit-mode クラスがある時のみ。なし = ネイティブに任せる）
          if (chList.classList.contains('edit-mode')) {
            cancelAnimationFrame(_mListMomentumRaf);
            let v = _scrollVY * 16;
            const step = () => {
              v *= 0.92;
              if (Math.abs(v) < 0.5) { _mListMomentumRaf = null; return; }
              chList.scrollTop -= v;
              _mListMomentumRaf = requestAnimationFrame(step);
            };
            _mListMomentumRaf = requestAnimationFrame(step);
          }
        }
      }
    };
    const onCancel = ev => {
      document.body.style.touchAction = '';
      srcEl.style.touchAction = '';
      document.removeEventListener('touchmove',   onMove);
      document.removeEventListener('touchend',    onEnd);
      document.removeEventListener('touchcancel', onCancel);
      clearTimeout(_mLongpressTimer); _mLongpressTimer = null;
      // touchcancel はドロップではなく中断 — ゴーストだけ片付ける
      if (_mDragging) {
        _mAutoScrollDir = 0;
        if (_mAutoScrollRaf) { cancelAnimationFrame(_mAutoScrollRaf); _mAutoScrollRaf = null; }
        _mDragging = false;
        if (_mGhost) { _mGhost.remove(); _mGhost = null; }
        if (_mSrcEl) {
          _mSrcEl.style.touchAction = '';
          _mSrcEl.classList.remove('dragging');
          if (_mDragFolderWasOpen) {
            const childrenEl = _mSrcEl.querySelector('.sidebar-folder-children');
            if (childrenEl) childrenEl.style.display = '';
            _mSrcEl.classList.add('sidebar-folder--open');
          }
          _mSrcEl = null;
        }
        _mDragFolderWasOpen = false;
        chList.classList.remove('sidebar--dragging');
        document.querySelectorAll('.merge-hover').forEach(el => el.classList.remove('merge-hover'));
        document.querySelectorAll('.drop-bottom').forEach(el => el.classList.remove('drop-bottom'));
        _mHideIndicator();
        // キャンセル時も touch-action を解除（EditMode は維持）
        chList.classList.remove('edit-mode');
      }
    };
    document.addEventListener('touchmove',   onMove, { passive: false });
    document.addEventListener('touchend',    onEnd);
    document.addEventListener('touchcancel', onCancel);
  }, { passive: false });

})();
let _chMenuTarget = null;


let _chMenuIconsCreated = false;
function _openChMenu(key, anchorEl) {
  _chMenuTarget = { key };
  const menu = document.getElementById('mChCardMenu');
  menu.hidden = false;
  if (!_chMenuIconsCreated) {
    if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [menu] });
    _chMenuIconsCreated = true;
  }
  const r = anchorEl.getBoundingClientRect();
  const mw = menu.offsetWidth || 148;
  const mh = menu.offsetHeight || 120;
  let top  = r.bottom + 4;
  let left = r.right - mw;
  if (left < 4) left = 4;
  if (top + mh > window.innerHeight - 8) top = r.top - mh - 4;
  menu.style.top  = top  + 'px';
  menu.style.left = left + 'px';
}

function _closeChMenu() {
  document.getElementById('mChCardMenu').hidden = true;
  _chMenuTarget = null;
}

async function _refreshMobileChannel(key) {
  const ch = channels[key];
  if (!ch) return;
  showToast(t('status-fetching'), 'loading');
  openChannelPanel();
  // アバターにスピナーを表示
  const cardEl = document.querySelector('.sidebar-channel-item[data-key="' + key + '"]');
  if (cardEl) cardEl.classList.add('m-ch-refreshing');
  try {
    const res = await fetch('/api/channels/' + key + '/refresh', { method: 'POST' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || t('fetch-failed'), true);
      // 失敗してもDBに既存動画があれば反映する
      const fallback = await fetchChannelVideos(key).catch(() => null);
      if (fallback && fallback.length > 0) {
        state.allVideos = fallback;
        saveVideosForChannel(key, state.allVideos);
        renderCurrentTab();
      }
      return;
    }
    showToast(t('status-refresh-api', {total: data.total ?? '?'}));
    state.allVideos = await fetchChannelVideos(key);
    saveVideosForChannel(key, state.allVideos);
    renderCurrentTab();
  } catch (e) {
    showToast(t('status-connection-err'), true);
  } finally {
    // スピナーを除去（renderChannelPanel 再描画前に外しておく）
    const card = document.querySelector('.sidebar-channel-item[data-key="' + key + '"]');
    if (card) card.classList.remove('m-ch-refreshing');
  }
}

function _deleteMobileChannel(key) {
  const wasActive = key === state.currentChannelKey;
  fetch('/api/channels/' + key, { method: 'DELETE' }).catch(() => {});
  delete channels[key];
  saveChannels();
  syncSidebarOrder();
  saveSidebarOrder();
  renderChannelPanel();
  if (wasActive) {
    state.currentChannelKey = null;
    state.allVideos = [];
    document.getElementById('mChNameDisplay').textContent = t('m-ch-select');
    renderCurrentTab();
  }
}

// チャンネル追加
async function addChannel(input) {
  let raw = input;
  try { raw = decodeURIComponent(input); } catch { raw = input; }
  const ch = channelKeyFromInput(raw);
  if (!ch) {
    showToast(t('status-invalid-input'), 'err');
    return;
  }
  // 既登録チェック（ハンドルの場合）
  if (ch.type === 'handle') {
    const existing = Object.values(channels).find(c => c.handle === ch.value);
    if (existing) {
      showToast(t('ch-already-added', { name: existing.displayName || ch.value }), 'info');
      return;
    }
  }

  showToast(t('status-fetching'), 'loading');
  try {
    const body = ch.type === 'id' ? { channelId: ch.value } : { handle: ch.value };
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showToast(data.error || t('status-add-failed'), 'err');
      return;
    }
    const serverCh = data.channel;
    const key = serverCh.channel_id;
    // 既登録チェック（サーバー応答のチャンネルID基準）
    if (channels[key]) {
      showToast(t('ch-already-added', { name: channels[key].displayName || ch.value }), 'info');
      return;
    }
    channels[key] = {
      key,
      handle:      serverCh.handle,
      displayName: serverCh.title,
      avatar:      serverCh.icon_url,
    };
    saveChannels();
    syncSidebarOrder();
    saveSidebarOrder();
    renderChannelPanel();
    const _inp = document.getElementById('mChAddInput');
    _inp.value = '';
    _inp.blur();
    await selectChannel(key);
    showToast(t('status-ch-added', { name: serverCh.title || ch.value }));
    setTimeout(closeChannelPanel, 400);
  } catch (e) {
    showToast(t('status-connection-err') + ': ' + e.message, 'err');
  }
}

// --- タブ切り替え ---
const CAT_TABS = new Set(['list', 'vote', 'ranking', 'reaction']);

function switchTab(tab) {
  if (tab === currentTab) return;
  currentTab = tab;

  // ボトムナビのアクティブ状態を更新
  document.querySelectorAll('.m-nav-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === tab);
  });

  // 画面を切り替え
  document.querySelectorAll('.m-screen').forEach(s => s.classList.remove('active'));
  const screen = document.getElementById('mScreen' + tab.charAt(0).toUpperCase() + tab.slice(1));
  if (screen) screen.classList.add('active');

  // カテゴリサブバーの表示切り替え
  const catBar = document.getElementById('mCatBar');
  const content = document.getElementById('mContent');
  if (CAT_TABS.has(tab)) {
    catBar.hidden = false;
  } else {
    catBar.hidden = true;
  }

  if (!_suppressHistory) {
    const vid = tab === 'reaction' ? (_mRsCurrentVideoId || null) : null;
    const curSt = history.state;
    const isDuplicate = curSt &&
      curSt.tab === tab &&
      curSt.channelKey === state.currentChannelKey &&
      curSt.vid === (vid || null);
    if (!isDuplicate) {
      history.pushState({ tab, channelKey: state.currentChannelKey, vid: vid || null }, '', buildHash(state.currentChannelKey, tab, vid));
    }
  }

  renderCurrentTab();
}

function renderCurrentTab() {
  if (currentTab === 'list')     renderList();
  else if (currentTab === 'vote')    renderVote();
  else if (currentTab === 'ranking') renderRanking();
  else if (currentTab === 'reaction') renderReaction();
}

const _EMPTY_ICON = '<svg class="m-empty-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/><path d="M22 12h-6l-2 3H10l-2-3H2"/></svg>';

function _emptyHtml(cls, text) {
  return '<div class="' + cls + '">' + _EMPTY_ICON + '<p class="m-empty-text">' + text + '</p></div>';
}

function _descToHtml(text) {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
  const linked = escaped.replace(/https?:\/\/[^\s<>"]+/g, raw => {
    let href = raw;
    let display = raw;
    // YouTube リダイレクト URL の場合、q= パラメータの実 URL を使う
    if (raw.includes('youtube.com/redirect')) {
      try {
        const qs = raw.replace(/&amp;/g, '&').split('?')[1] || '';
        const dest = new URLSearchParams(qs).get('q');
        if (dest) { href = dest; display = dest; }
      } catch (_) { /* fallthrough */ }
    }
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${display}</a>`;
  });
  return linked.replace(/(<a [^>]+>[\s\S]*?<\/a>)|#([\w\u3041-\u9FFF\uFF10-\uFF5E]+)/g, (match, anchor, tag) => {
    if (anchor) return anchor;
    const enc = encodeURIComponent(tag);
    return `<a class="desc-hashtag" href="https://www.youtube.com/hashtag/${enc}" target="_blank" rel="noopener noreferrer">#${tag}</a>`;
  });
}

// チャンネル未選択・動画なし共通メッセージ
function renderNoChannel(containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = _emptyHtml('m-empty-msg', t('m-ch-select-prompt'));
}

function renderNoCat(containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = _emptyHtml('m-empty-msg', t('cat-empty'));
}

// --- Tab1: 一覧 ---
function _updateListSortUI() {
  const sort = localStorage.getItem(LS_SORT) || 'rating';
  const dir  = localStorage.getItem(LS_LIST_SORT_DIR) || 'desc';
  document.querySelectorAll('#mListSortBar .m-rs-sort-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.sort === sort);
  });
  const dirBtn = document.getElementById('mListSortDir');
  if (dirBtn) dirBtn.classList.toggle('asc', dir === 'asc');
}

function renderList() {
  const grid = document.getElementById('mListGrid');
  const sentinel = document.getElementById('mListSentinel');
  const sortBar = document.getElementById('mListSortBar');
  const welcome = document.getElementById('mWelcome');
  const scrollBody = document.querySelector('#mScreenList .m-list-scroll-body');

  // 早期 return しても古い Observer が残らないよう先にリセット
  if (_listObserver) { _listObserver.disconnect(); _listObserver = null; }
  _listPool = [];
  _listPage = 0;
  grid.innerHTML = '';

  if (!state.currentChannelKey) {
    sortBar.style.display = 'none';
    document.getElementById('mCatBar').hidden = true;
    const noChannels = Object.keys(channels).length === 0;
    if (noChannels) {
      document.getElementById('mChPanelBtn').hidden = true;
      document.getElementById('mHeaderAppName').hidden = false;
      document.getElementById('mBottomNav').hidden = true;
      welcome.hidden = false;
      scrollBody.hidden = true;
    } else {
      document.getElementById('mChPanelBtn').hidden = false;
      document.getElementById('mHeaderAppName').hidden = true;
      document.getElementById('mBottomNav').hidden = false;
      welcome.hidden = true;
      scrollBody.hidden = false;
      renderNoChannel('mListGrid');
    }
    return;
  }
  document.getElementById('mChPanelBtn').hidden = false;
  document.getElementById('mHeaderAppName').hidden = true;
  document.getElementById('mBottomNav').hidden = false;
  welcome.hidden = true;
  scrollBody.hidden = false;
  sortBar.style.display = '';
  document.getElementById('mCatBar').hidden = false;
  _updateListSortUI();

  const pool = _buildListPool();
  if (pool.length === 0) { sortBar.style.display = 'none'; renderNoCat('mListGrid'); return; }

  _listPage = 0;
  _listPool = pool;

  // IntersectionObserver リセット
  if (_listObserver) _listObserver.disconnect();
  _listObserver = new IntersectionObserver(entries => {
    if (entries[0].isIntersecting) _appendListPage();
  }, { rootMargin: '200px' });
  _listObserver.observe(sentinel);

  _appendListPage();
}

function _buildListPool() {
  const sort = localStorage.getItem(LS_SORT) || 'rating';
  const dir  = localStorage.getItem(LS_LIST_SORT_DIR) || 'desc';
  const pool = filteredVideos().slice();
  if (sort === 'date') {
    pool.sort((a, b) => (b.publishedAt || '') < (a.publishedAt || '') ? -1 : 1);
  } else if (sort === 'rating') {
    pool.sort((a, b) => getRating(b.id) - getRating(a.id));
  } else {
    // views (デフォルト)
    pool.sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0));
  }
  if (dir === 'asc') pool.reverse();
  return pool;
}

function _appendListPage() {
  const grid = document.getElementById('mListGrid');
  const start = _listPage * LIST_PAGE_SIZE;
  if (start >= _listPool.length) return;
  const slice = _listPool.slice(start, start + LIST_PAGE_SIZE);
  _listPage++;

  slice.forEach(v => {
    const item = document.createElement('div');
    item.className = 'm-list-item';

    const thumb = document.createElement('img');
    thumb.className = 'm-list-thumb';
    thumb.src = v.thumb;
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.referrerPolicy = 'no-referrer';
    thumb.onerror = function() { this.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'; };

    const info = document.createElement('div');
    info.className = 'm-list-info';

    const title = document.createElement('div');
    title.className = 'm-list-title';
    title.textContent = v.title;

    const meta = document.createElement('div');
    meta.className = 'm-list-meta';
    meta.innerHTML = _mBuildMeta(v) + _mBuildPinDot(v, _mRsMyPins, _mRsPinColor);

    info.appendChild(title);
    info.appendChild(meta);
    item.appendChild(thumb);
    item.appendChild(info);

    item.addEventListener('click', () => openVideoInReaction(v));
    grid.appendChild(item);
  });
}

// --- Tab2: 投票 ---
function renderVote() {
  const wrap = document.getElementById('mVoteWrap');
  const optBtn = document.getElementById('mVoteOptionsPanelBtn');
  if (!state.currentChannelKey) {
    wrap.innerHTML = _emptyHtml('m-vote-empty', t('m-ch-select-prompt'));
    if (optBtn) optBtn.hidden = true;
    return;
  }
  if (optBtn) optBtn.hidden = false;

  // 保存済みペアを復元（現在のプールに含まれるか検証）
  let pair = getVotePair();
  if (pair) {
    const ids = new Set(filteredVideos().map(v => v.id));
    if (!ids.has(pair[0].id) || !ids.has(pair[1].id)) {
      pair = null;
      setVotePair(null);
    }
  }
  if (!pair) pair = pickPair(filteredVideos);

  if (!pair) {
    const pool = filteredVideos();
    if (optBtn) optBtn.hidden = true;
    wrap.innerHTML = pool.length >= 2
      ? _emptyHtml('m-vote-empty', t('vote-all-done'))
      : pool.length > 0
      ? _emptyHtml('m-vote-empty', t('vote-need-more'))
      : _emptyHtml('m-vote-empty', t('cat-empty'));
    return;
  }

  setVotePair(pair);
  _currentVotePair = pair;
  const [pairA, pairB] = pair;

  wrap.innerHTML = '';
  const frag = document.createDocumentFragment();

  [pairA, pairB].forEach((v, idx) => {
    const card = _buildVoteCard(v);
    frag.appendChild(card);

    if (idx === 0) {
      const vs = document.createElement('div');
      vs.className = 'm-vote-vs';
      vs.textContent = 'VS';
      frag.appendChild(vs);
    }
  });

  wrap.appendChild(frag);
}

function _buildVoteCard(v) {
  const card = document.createElement('div');
  card.className = 'm-vote-card';
  card.dataset.id = v.id;

  const img = document.createElement('img');
  img.className = 'm-vote-card-img';
  img.src = v.thumb;
  img.alt = '';
  img.referrerPolicy = 'no-referrer';
  img.onerror = function() { this.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'; };

  const title = document.createElement('div');
  title.className = 'm-vote-card-title';
  title.textContent = v.title;

  card.appendChild(img);
  if (_voteShowTitle) card.appendChild(title);

  card.addEventListener('click', () => {
    if (!_currentVotePair) return;
    const [pairA, pairB] = _currentVotePair;
    const isA = card.dataset.id === pairA.id;
    const winner = isA ? pairA : pairB;
    const loser  = isA ? pairB : pairA;

    applyVoteLocal(winner.id, loser.id);
    syncVoteToServer(winner.id, loser.id);
    _playedPairs.add(_pairKey(winner.id, loser.id));
    _currentVotePair = null;
    setVotePair(null);

    // 勝敗アニメーション
    const wrap = document.getElementById('mVoteWrap');
    wrap.querySelectorAll('.m-vote-card').forEach(c => {
      if (c.dataset.id === winner.id) {
        c.classList.add('m-winner');
        const ov = document.createElement('div');
        ov.className = 'm-vote-good-overlay';
        ov.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1.91l-.01-.01L23 10z"/></svg>';
        c.appendChild(ov);
      } else {
        c.classList.add('m-loser');
      }
    });

    setTimeout(renderVote, 600);
  });

  return card;
}

// --- Tab3: ランキング ---
function renderRanking() {
  const list = document.getElementById('mRankList');
  if (!state.currentChannelKey) { renderNoChannel('mRankList'); return; }

  const pool = filteredVideos();
  if (pool.length === 0) { renderNoCat('mRankList'); return; }

  const sorted = pool.slice().sort((a, b) => getRating(b.id) - getRating(a.id));
  const maxRating = getRating(sorted[0].id);
  const minRating = getRating(sorted[sorted.length - 1].id);
  const range = maxRating - minRating || 1;

  list.innerHTML = '';
  const frag = document.createDocumentFragment();

  sorted.slice(0, 100).forEach((v, idx) => {
    const rank    = idx + 1;
    const rating  = Math.round(getRating(v.id));
    const wins    = getWins(v.id);
    const battles = getBattles(v.id);
    const wr      = battles > 0 ? Math.round(wins / battles * 100) : 0;
    const barPct  = Math.round((getRating(v.id) - minRating) / range * 100);

    const item = document.createElement('div');
    item.className = 'm-rank-item';

    // サムネイル + バッジ
    const thumbWrap = document.createElement('div');
    thumbWrap.className = 'm-rank-thumb-wrap';

    const thumb = document.createElement('img');
    thumb.className = 'm-rank-thumb';
    thumb.src = v.thumb;
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.referrerPolicy = 'no-referrer';
    thumb.onerror = function() { this.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'; };

    const badge = document.createElement('div');
    badge.className = 'm-rank-badge'
      + (rank === 1 ? ' top-1' : rank === 2 ? ' top-2' : rank === 3 ? ' top-3' : '');
    badge.textContent = rank;

    thumbWrap.appendChild(thumb);
    thumbWrap.appendChild(badge);

    // メタ情報
    const info = document.createElement('div');
    info.className = 'm-rank-info';

    const title = document.createElement('div');
    title.className = 'm-rank-title';
    title.textContent = v.title;

    const score = document.createElement('div');
    score.className = 'm-rank-score';
    const scoreParts = ['<span class="m-meta-item">' + _M_SVG_STAR + Math.round(rating) + '</span>'];
    if (battles > 0) scoreParts.push('<span>' + t('rank-wins-fmt', {w: wins, b: battles}) + ' (' + wr + '%)</span>');
    score.innerHTML = scoreParts.join('') + _mBuildPinDot(v, _mRsMyPins, _mRsPinColor);

    const barBg = document.createElement('div');
    barBg.className = 'm-rank-bar-bg';
    const barFill = document.createElement('div');
    barFill.className = 'm-rank-bar-fill';
    barFill.style.width = barPct + '%';
    barBg.appendChild(barFill);

    info.appendChild(title);
    info.appendChild(score);
    info.appendChild(barBg);

    item.appendChild(thumbWrap);
    item.appendChild(info);
    item.addEventListener('click', () => openVideoInReaction(v));
    frag.appendChild(item);
  });

  list.appendChild(frag);
}

// --- Tab4: リアクション (ReactionPin) ---

// セッション ID（サーバー側でユーザーを区別するためのランダム文字列）
// --- 動画概要シート ---
let _mVmenuVideo = null;
let _mVmenuDescExpanded = false;

function mOpenVideoMenu(v) {
  _mVmenuVideo = v;
  _mVmenuDescExpanded = true;
  const wrap = document.getElementById('mVideoMenu');
  if (!wrap) return;
  closeChannelPanel();

  // タイトル
  const titleEl = document.getElementById('mVmenuTitle');
  if (titleEl) titleEl.textContent = v.title || '';

  // 統計ブロック
  const ratingEl  = document.getElementById('mVmenuRating');
  const viewsEl    = document.getElementById('mVmenuViews');
  const dateYearEl = document.getElementById('mVmenuDateYear');
  const dateMDEl   = document.getElementById('mVmenuDateMD');
  if (ratingEl) ratingEl.textContent = Math.round(getRating(v.id));
  if (viewsEl) viewsEl.textContent = v.viewCount ? v.viewCount.toLocaleString() : '-';
  if (v.publishedAt) {
    const d = new Date(v.publishedAt);
    if (dateYearEl) dateYearEl.textContent = t('m-date-md-fmt', {m: d.getMonth() + 1, d: d.getDate()});
    if (dateMDEl)   dateMDEl.textContent   = t('m-date-year-fmt', {y: d.getFullYear()});
  } else {
    if (dateYearEl) dateYearEl.textContent = '-';
    if (dateMDEl)   dateMDEl.textContent   = '';
  }

  // 概要欄
  const descEl  = document.getElementById('mVmenuDesc');
  const moreBtn = document.getElementById('mVmenuMore');
  if (descEl) {
    descEl.classList.add('expanded');
    if (v.description === null || v.description === undefined) {
      descEl.textContent = '';
      descEl.hidden = true;
      if (moreBtn) moreBtn.hidden = true;
    } else if (v.description === '') {
      descEl.textContent = t('m-video-no-desc');
      descEl.dataset.empty = '1';
      descEl.hidden = false;
      if (moreBtn) moreBtn.hidden = true;
    } else {
      descEl.removeAttribute('data-empty');
      descEl.innerHTML = _descToHtml(v.description);
      descEl.hidden = false;
      if (moreBtn) { moreBtn.textContent = t('modal-close'); moreBtn.hidden = false; }
    }
  }

  // チャンネル情報
  const ch = channels && channels[state.currentChannelKey];
  const chNameEl = document.getElementById('mVmenuChName');
  if (chNameEl) chNameEl.textContent = ch?.title || '';

  // 動画の詳細行
  const detailDateEl   = document.getElementById('mVmenuDetailDateVal');
  const detailViewsEl  = document.getElementById('mVmenuDetailViewsVal');
  const detailRatingEl = document.getElementById('mVmenuDetailRatingVal');
  if (detailDateEl) { const _d = v.publishedAt ? new Date(v.publishedAt) : null; detailDateEl.textContent = _d ? `${_d.getFullYear()}/${String(_d.getMonth()+1).padStart(2,'0')}/${String(_d.getDate()).padStart(2,'0')}` : ''; }
  if (detailViewsEl)  detailViewsEl.textContent  = v.viewCount   ? v.viewCount.toLocaleString() : '';
  if (detailRatingEl) detailRatingEl.textContent = Math.round(getRating(v.id)).toLocaleString();

  // シートのtopをサムネ下端にアンカー
  const imgWrap = document.getElementById('mRsImgWrap');
  if (imgWrap) {
    wrap.style.setProperty('--desc-anchor', imgWrap.getBoundingClientRect().bottom + 'px');
  }

  wrap.hidden = false;
  // hidden 解除後にスクロール位置をリセット（display:none 中は scrollTop が反映されないブラウザ対策）
  const body = document.getElementById('mDescBody');
  requestAnimationFrame(() => {
    if (body) body.scrollTop = 0;
    wrap.classList.add('open');
  });
}

function mCloseVideoMenu() {
  const wrap = document.getElementById('mVideoMenu');
  if (!wrap) return;
  wrap.classList.remove('open');
  const sheet = document.getElementById('mDescSheet');
  if (sheet) {
    sheet.addEventListener('transitionend', function handler() {
      wrap.hidden = true;
      sheet.removeEventListener('transitionend', handler);
    }, { once: true });
  } else {
    wrap.hidden = true;
  }
}

// --- テーマ切り替え ---
const THEME_KEY = 'thumb-theme';

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  // 設定モーダル内のテーマボタンのアクティブ状態を更新
  const darkBtn  = document.getElementById('mSettingsThemeDark');
  const lightBtn = document.getElementById('mSettingsThemeLight');
  if (darkBtn)  darkBtn.classList.toggle('active',  theme === 'dark');
  if (lightBtn) lightBtn.classList.toggle('active', theme === 'light');
}

// --- 設定モーダル ---

function openSettings() {
  const modal = document.getElementById('mSettingsModal');
  if (!modal) return;
  modal.hidden = false;
  mCloseSub(true);
  applyTheme(document.documentElement.dataset.theme || 'dark');
  mApikeySettingsOpen();
  mSyncLangSeg();
}

function closeSettings() {
  const modal = document.getElementById('mSettingsModal');
  if (modal) modal.hidden = true;
}

function mSyncLangSeg() {
  const cur = localStorage.getItem('thumb-lang') || 'ja';
  const ja = document.getElementById('mLangBtnJa');
  const en = document.getElementById('mLangBtnEn');
  if (ja) ja.classList.toggle('active', cur === 'ja');
  if (en) en.classList.toggle('active', cur === 'en');
}

function mOpenSub(name) {
  const sub = document.getElementById('mSettingsSub');
  if (!sub) return;
  const panels = ['apikey', 'data'];
  panels.forEach(function(n) {
    const p = document.getElementById('mSettingsPanel-' + n);
    if (p) p.hidden = (n !== name);
  });
  const titleEl = document.getElementById('mSetSubTitle');
  if (titleEl) {
    const labels = {
      apikey: typeof t === 'function' ? t('settings-tab-apikey') : 'APIキー',
      data: typeof t === 'function' ? t('settings-tab-data') : 'データ'
    };
    titleEl.textContent = labels[name] || name;
  }
  if (name === 'apikey') mApikeySettingsOpen();
  sub.classList.add('open');
}

function mCloseSub(instant) {
  const sub = document.getElementById('mSettingsSub');
  if (!sub) return;
  if (instant) {
    sub.style.transition = 'none';
    sub.classList.remove('open');
    sub.offsetHeight; // reflow
    sub.style.transition = '';
  } else {
    sub.classList.remove('open');
  }
}

function mApikeySettingsOpen() {
  const savedKey = localStorage.getItem(LS_API_KEY) || '';
  const input = document.getElementById('mApikeyInput');
  if (input) {
    input.classList.add('m-apikey-input--masked');
    input.value = savedKey;
  }
  const delBtn = document.getElementById('mApikeyDelete');
  if (delBtn) delBtn.hidden = !savedKey;
  const statusEl = document.getElementById('mApikeyStatus');
  if (statusEl) statusEl.textContent = '';
  const rssToggle = document.getElementById('mRssOnlyToggle');
  if (rssToggle) rssToggle.checked = localStorage.getItem(LS_RSS_ONLY) === 'true';
}

// --- 初期化 ---
document.addEventListener('DOMContentLoaded', function() {
  // URL から初期タブを読んでビジュアルを即時設定（FOUC防止: module スクリプトの非同期実行より先に反映）
  const _initHash = parseHash();
  if (_initHash.tab && _initHash.tab !== currentTab) {
    currentTab = _initHash.tab;
    document.querySelectorAll('.m-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === _initHash.tab));
    document.querySelectorAll('.m-screen').forEach(s => s.classList.remove('active'));
    const _initSc = document.getElementById('mScreen' + _initHash.tab.charAt(0).toUpperCase() + _initHash.tab.slice(1));
    if (_initSc) _initSc.classList.add('active');
  }
  // ソート UI をローカルストレージの値で即時反映（HTML デフォルトとのズレを防ぐ）
  _updateListSortUI();
  initReaction(switchTab);
  // ブラウザバック / スワイプバックで前の画面に戻る
  window.addEventListener('popstate', async function(e) {
    const st = e.state;
    if (!st || st.swipeGuard) return;
    // チャンネルパネルが開いているとき → 閉じるだけ
    if (document.getElementById('mChPanel').classList.contains('open')) {
      closeChannelPanel();
      return;
    }
    setSuppressHistory(true);
    try {
      if (!st.channelKey) {
        // チャンネル未選択状態（welcome）に戻る
        state.currentChannelKey = null;
        state.allVideos = [];
        document.getElementById('mChNameDisplay').textContent = t('m-ch-select');
        renderCurrentTab();
      } else {
        if (st.channelKey !== state.currentChannelKey) {
          await selectChannel(st.channelKey);
        }
        if (st.tab && st.tab !== currentTab) {
          switchTab(st.tab);
        }
        // リアクションタブで動画が指定されていれば切り替え
        if (st.tab === 'reaction' && st.vid && st.vid !== _mRsCurrentVideoId) {
          mRsOpenMode(st.vid);
        }
      }
    } finally {
      setSuppressHistory(false);
    }
  });

  // テーマ・言語を localStorage から復元
  const savedTheme = localStorage.getItem(THEME_KEY) || 'dark';
  applyTheme(savedTheme);

  if (typeof applyLang === 'function') {
    const savedLang = localStorage.getItem('thumb-lang') || 'ja';
    applyLang(savedLang);
  }

  // チャンネル・レーティングをロード
  loadChannels();
  loadRating();
  loadSidebarOrder();

  // チャンネルパネルを構築
  renderChannelPanel();

  // イベントリスナー: チャンネルパネルボタン
  document.getElementById('mChPanelBtn').addEventListener('click', openChannelPanel);
  document.getElementById('mChOverlay').addEventListener('click', e => { if (_mDragging) return; closeChannelPanel(); });

  // ウェルカム入力フォーム
  document.getElementById('mWelcomeAddSubmitBtn').addEventListener('click', () => {
    const val = document.getElementById('mWelcomeAddInput').value.trim();
    if (val) addChannel(val);
  });
  document.getElementById('mWelcomeAddInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') { const val = e.target.value.trim(); if (val) addChannel(val); }
  });
  (function() {
    const el = document.getElementById('mWelcomeAddInput');
    el.addEventListener('paste', e => {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      let decoded; try { decoded = decodeURIComponent(text); } catch { decoded = text; }
      if (decoded !== text) {
        e.preventDefault();
        const start = el.selectionStart, end = el.selectionEnd;
        el.value = el.value.slice(0, start) + decoded + el.value.slice(end);
        el.selectionStart = el.selectionEnd = start + decoded.length;
      }
    });
  })();

  // paste 時に URL エンコード文字を自動デコード
  (function() {
    const el = document.getElementById('mChAddInput');
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
  })();

  // イベントリスナー: チャンネル追加
  document.getElementById('mChAddBtn').addEventListener('click', () => {
    const val = document.getElementById('mChAddInput').value.trim();
    if (val) addChannel(val);
  });
  document.getElementById('mChAddInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      const val = e.target.value.trim();
      if (val) addChannel(val);
    }
  });

  // チャンネルメニューイベント
  document.getElementById('mChMenuRefresh').addEventListener('click', () => {
    const key = _chMenuTarget?.key;
    _closeChMenu();
    if (key) _refreshMobileChannel(key);
  });
  document.getElementById('mChMenuDelete').addEventListener('click', () => {
    if (!_chMenuTarget) return;
    const key  = _chMenuTarget.key;
    const name = channels[key]?.displayName || channels[key]?.handle || key;
    const menuBtn = document.getElementById('mChMenuDelete');
    const anchorRect = menuBtn.getBoundingClientRect();
    _closeChMenu();
    _mShowDelPopup(menuBtn,
      t('ch-delete-confirm').replace('{name}', name),
      () => _deleteMobileChannel(key),
      t('ch-delete-ok'),
      anchorRect
    );
  });
  document.addEventListener('click', e => {
    const menu = document.getElementById('mChCardMenu');
    if (!menu.hidden && !menu.contains(e.target)) _closeChMenu();
  }, { capture: true });

  // イベントリスナー: カテゴリフィルタ
  document.querySelectorAll('.m-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      if (cat === state.currentCat) return;
      // リアクションタブにいる場合、切り替え前に現在の選択動画を保存
      if (currentTab === 'reaction') mRsSaveCatState(state.currentCat);
      state.currentCat = cat;
      localStorage.setItem(LS_CAT, cat);
      document.querySelectorAll('.m-cat-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.cat === cat);
      });
      _currentVotePair = null;
      requestAnimationFrame(() => renderCurrentTab());
    });
  });

  // イベントリスナー: ボトムナビゲーション
  document.querySelectorAll('.m-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // イベントリスナー: 一覧画面ソート
  (function() {
    const bar = document.getElementById('mListSortBar');
    if (!bar) return;
    bar.addEventListener('click', e => {
      const chip = e.target.closest('.m-rs-sort-chip');
      if (chip) {
        localStorage.setItem(LS_SORT, chip.dataset.sort);
        _updateListSortUI();
        renderList();
      }
    });
    const dirBtn = document.getElementById('mListSortDir');
    if (dirBtn) {
      dirBtn.addEventListener('click', () => {
        const dir = localStorage.getItem(LS_LIST_SORT_DIR) || 'desc';
        localStorage.setItem(LS_LIST_SORT_DIR, dir === 'desc' ? 'asc' : 'desc');
        _updateListSortUI();
        renderList();
      });
    }
    _updateListSortUI();
  })();

  initReactionUI();

  // イベントリスナー: 投票オプションパネル
  (function() {
    const btn = document.getElementById('mVoteOptionsPanelBtn');
    const panel = document.getElementById('mVoteOptionsPanel');
    const titleToggle = document.getElementById('mVoteTitleToggle');
    if (!btn || !panel || !titleToggle) return;
    titleToggle.classList.toggle('on', _voteShowTitle);
    titleToggle.setAttribute('aria-checked', String(_voteShowTitle));
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const open = panel.classList.toggle('open');
      btn.classList.toggle('open', open);
    });
    document.addEventListener('click', () => {
      if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        btn.classList.remove('open');
      }
    });
    titleToggle.addEventListener('click', e => {
      e.stopPropagation();
      _voteShowTitle = !_voteShowTitle;
      localStorage.setItem(LS_VOTE_SHOW_TITLE, _voteShowTitle);
      titleToggle.classList.toggle('on', _voteShowTitle);
      titleToggle.setAttribute('aria-checked', String(_voteShowTitle));
      renderVote();
    });
  })();

  // イベントリスナー: 設定ボタン
  document.getElementById('mSettingsBtn').addEventListener('click', openSettings);
  document.getElementById('mSettingsClose').addEventListener('click', closeSettings);

  // イベントリスナー: 並び替えモードボタン
  (function() {
    const btn = document.getElementById('mEditModeBtn');
    const list = document.getElementById('mChList');
    btn.addEventListener('click', () => {
      _mEditMode = !_mEditMode;
      btn.classList.toggle('edit-active', _mEditMode);
      list.classList.toggle('edit-mode', _mEditMode);
      if (!_mEditMode && _mDragging) {
        // モード解除時にドラッグ中なら中断
        _mAutoScrollDir = 0;
        if (_mAutoScrollRaf) { cancelAnimationFrame(_mAutoScrollRaf); _mAutoScrollRaf = null; }
        _mDragging = false;
        if (_mGhost) { _mGhost.remove(); _mGhost = null; }
        if (_mSrcEl) { _mSrcEl.classList.remove('dragging'); _mSrcEl = null; }
        document.body.style.touchAction = '';
      }
    });
  })();

  // 動画詳細メニュー: タイトルタップ
  document.getElementById('mRsVideoTitle').addEventListener('click', function(e) {
    e.preventDefault();
    const v = filteredVideos().find(vid => vid.id === _mRsCurrentVideoId);
    if (v) mOpenVideoMenu(v);
  });

  // 動画概要シート: Xボタンで閉じる
  document.getElementById('mVmenuClose').addEventListener('click', mCloseVideoMenu);

  // 動画概要シート: もっと見る
  document.getElementById('mVmenuMore').addEventListener('click', function() {
    _mVmenuDescExpanded = !_mVmenuDescExpanded;
    const descEl = document.getElementById('mVmenuDesc');
    if (descEl) descEl.classList.toggle('expanded', _mVmenuDescExpanded);
    this.textContent = _mVmenuDescExpanded ? t('modal-close') : t('m-video-show-more');
  });

  // 動画概要シート: スワイプで閉じる
  (function() {
    const sheet = document.getElementById('mDescSheet');
    const body  = document.getElementById('mDescBody');
    if (!sheet || !body) return;
    let _sy = 0, _ty = 0, _dragging = false;
    sheet.addEventListener('touchstart', function(e) {
      if (body.scrollTop > 0) return;
      _sy = e.touches[0].clientY;
      _ty = 0;
      _dragging = true;
      sheet.style.transition = 'none';
    }, { passive: true });
    sheet.addEventListener('touchmove', function(e) {
      if (!_dragging) return;
      if (body.scrollTop > 0) {
        _dragging = false;
        sheet.style.transform = '';
        sheet.style.transition = '';
        return;
      }
      const dy = e.touches[0].clientY - _sy;
      if (dy > 0) {
        _ty = dy;
        sheet.style.transform = 'translateY(' + dy + 'px)';
        e.preventDefault();
      }
    }, { passive: false });
    sheet.addEventListener('touchend', function() {
      if (!_dragging) return;
      _dragging = false;
      sheet.style.transition = '';
      sheet.style.transform = '';
      if (_ty > 80) mCloseVideoMenu();
      _ty = 0;
    });
  })();

  // 動画概要シート: YouTubeで開く
  document.getElementById('mVmenuOpenYt').addEventListener('click', function() {
    if (_mVmenuVideo) window.open('https://www.youtube.com/watch?v=' + _mVmenuVideo.id, '_blank', 'noopener');
    mCloseVideoMenu();
  });

  // 動画詳細メニュー: URLをコピー
  document.getElementById('mVmenuCopyUrl').addEventListener('click', function() {
    if (!_mVmenuVideo) return;
    const url = 'https://www.youtube.com/watch?v=' + _mVmenuVideo.id;
    navigator.clipboard.writeText(url).then(() => {
      showToast(t('m-video-copy-ok'));
    }).catch(() => {
      showToast(t('m-video-copy-err'), true);
    });
    mCloseVideoMenu();
  });

  // 動画詳細メニュー: チャンネルを開く
  document.getElementById('mVmenuOpenChannel').addEventListener('click', function() {
    const key = state.currentChannelKey;
    if (key) {
      const ch = channels[key];
      const url = ch && ch.handle
        ? 'https://www.youtube.com/' + ch.handle
        : 'https://www.youtube.com/channel/' + key;
      window.open(url, '_blank', 'noopener');
    }
    mCloseVideoMenu();
  });

  // 設定モーダル: バックドロップクリックで閉じる
  document.getElementById('mSettingsModal').addEventListener('click', function(e) {
    if (e.target === this) closeSettings();
  });

  // 設定モーダル: テーマ切り替え
  document.getElementById('mSettingsThemeDark').addEventListener('click', () => applyTheme('dark'));
  document.getElementById('mSettingsThemeLight').addEventListener('click', () => applyTheme('light'));

  // 設定モーダル: 言語切り替え
  document.getElementById('mLangBtnJa').addEventListener('click', function() {
    if (typeof applyLang === 'function') applyLang('ja');
    mSyncLangSeg();
  });
  document.getElementById('mLangBtnEn').addEventListener('click', function() {
    if (typeof applyLang === 'function') applyLang('en');
    mSyncLangSeg();
  });

  // 設定モーダル: ドリルダウン
  document.getElementById('mSetItemApikey').addEventListener('click', () => mOpenSub('apikey'));
  document.getElementById('mSetItemData').addEventListener('click', () => mOpenSub('data'));
  document.getElementById('mSetSubBack').addEventListener('click', () => mCloseSub(false));

  // 設定モーダル: APIキー 表示切り替え
  document.getElementById('mApikeyToggle').addEventListener('click', function() {
    const input = document.getElementById('mApikeyInput');
    input.classList.toggle('m-apikey-input--masked');
  });

  // 設定モーダル: APIキー 保存
  document.getElementById('mApikeySave').addEventListener('click', function() {
    const input = document.getElementById('mApikeyInput');
    const statusEl = document.getElementById('mApikeyStatus');
    const val = input.value.trim();
    if (!val) {
      if (statusEl) { statusEl.textContent = typeof t === 'function' ? t('apikey-err-empty') : 'APIキーを入力してください'; statusEl.style.color = 'var(--err)'; }
      return;
    }
    if (!/^AIzaSy[A-Za-z0-9_-]{33}$/.test(val)) {
      if (statusEl) { statusEl.textContent = typeof t === 'function' ? t('apikey-err-format') : 'APIキーの形式が正しくありません'; statusEl.style.color = 'var(--err)'; }
      return;
    }
    localStorage.setItem(LS_API_KEY, val);
    const delBtn = document.getElementById('mApikeyDelete');
    if (delBtn) delBtn.hidden = false;
    if (statusEl) {
      statusEl.textContent = typeof t === 'function' ? t('apikey-saved') : '保存しました';
      statusEl.style.color = 'var(--ok)';
      setTimeout(() => { statusEl.textContent = ''; statusEl.style.color = ''; }, 2000);
    }
  });

  // 設定モーダル: APIキー 削除
  document.getElementById('mApikeyDelete').addEventListener('click', function() {
    localStorage.removeItem(LS_API_KEY);
    const input = document.getElementById('mApikeyInput');
    if (input) input.value = '';
    this.hidden = true;
    const statusEl = document.getElementById('mApikeyStatus');
    if (statusEl) { statusEl.textContent = ''; statusEl.style.color = ''; }
  });

  // 設定モーダル: RSSのみ トグル
  document.getElementById('mRssOnlyToggle').addEventListener('change', function() {
    if (this.checked) {
      localStorage.setItem(LS_RSS_ONLY, 'true');
    } else {
      localStorage.removeItem(LS_RSS_ONLY);
    }
  });

  // 設定モーダル: データ エクスポート
  document.getElementById('mDataExportBtn').addEventListener('click', function() {
    const exportData = {
      channels: JSON.parse(localStorage.getItem(LS_CHANNELS) || '{}'),
      sidebarOrder: JSON.parse(localStorage.getItem(LS_SIDEBAR_ORDER) || 'null'),
    };
    const blob = new Blob(['\uFEFF' + JSON.stringify(exportData, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'channels-backup.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    const statusEl = document.getElementById('mDataStatus');
    if (statusEl) {
      statusEl.textContent = typeof t === 'function' ? t('settings-data-exported') : 'エクスポートしました';
      statusEl.style.color = '';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    }
  });

  // 設定モーダル: データ インポート
  document.getElementById('mDataImportBtn').addEventListener('click', function() {
    document.getElementById('mDataImportFile').click();
  });
  document.getElementById('mDataImportFile').addEventListener('change', function() {
    const file = this.files[0];
    if (!file) return;
    const reader = new FileReader();
    const statusEl = document.getElementById('mDataStatus');
    reader.onload = function(ev) {
      try {
        const parsed = JSON.parse(ev.target.result.replace(/^\uFEFF/, ''));
        if (!parsed || typeof parsed.channels !== 'object') throw new Error();
        Object.assign(channels, parsed.channels);
        saveChannels();
        if (parsed.sidebarOrder && Array.isArray(parsed.sidebarOrder)) {
          sidebarOrder = parsed.sidebarOrder;
          saveSidebarOrder();
        }
        renderChannelPanel();
        if (statusEl) {
          statusEl.textContent = typeof t === 'function' ? t('settings-data-imported') : 'インポートしました';
          statusEl.style.color = 'var(--ok)';
        }
      } catch (err) {
        if (statusEl) {
          statusEl.textContent = typeof t === 'function' ? t('settings-data-import-err') : 'インポートに失敗しました';
          statusEl.style.color = 'var(--err)';
        }
      }
      this.value = '';
      setTimeout(() => { if (statusEl) statusEl.textContent = ''; }, 2500);
    };
    reader.readAsText(file);
  });

  // コードコピー: channels + sidebarOrder を vt~ Base64url に変換してクリップボードへ
  const _B64U = b => { const arr = new Uint8Array(b); let bin = ''; const CHUNK = 8192; for (let i = 0; i < arr.length; i += CHUNK) bin += String.fromCharCode(...arr.subarray(i, i + CHUNK)); return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, ''); };
  const _B64D = s => { const b64 = s.replace(/-/g,'+').replace(/_/g,'/'); return Uint8Array.from(atob(b64.padEnd(Math.ceil(b64.length/4)*4,'=')), c => c.charCodeAt(0)); };

  async function _vtEncodeData() {
    const rawChannels = JSON.parse(localStorage.getItem(LS_CHANNELS) || '{}');
    const channels = {};
    for (const [id, ch] of Object.entries(rawChannels)) {
      const entry = {};
      if (ch.tags && ch.tags.length) entry.tags = ch.tags;
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

  const _mCodeStatusEl = document.getElementById('mDataCodeStatus');
  function _mCodeStatusMsg(msg, ok) {
    if (!_mCodeStatusEl) return;
    _mCodeStatusEl.textContent = msg;
    _mCodeStatusEl.style.color = ok ? 'var(--ok)' : 'var(--err)';
    setTimeout(() => { _mCodeStatusEl.textContent = ''; }, ok ? 3000 : 5000);
  }
  document.getElementById('mDataCopyCodeBtn').addEventListener('click', async function() {
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
      _mCodeStatusMsg(t('preset-copied'), true);
    } catch (e) {
      _mCodeStatusMsg(t('preset-import-err'), false);
    }
  });

  document.getElementById('mDataApplyCodeBtn').addEventListener('click', async function() {
    const inp = document.getElementById('mDataCodeInput');
    const raw = inp.value.trim();
    inp.classList.remove('error');
    try {
      const parsed = await _vtDecodeData(raw);
      if (!parsed || typeof parsed.channels !== 'object') throw new Error('invalid data');
      // フォルダ構成を先に復元
      if (parsed.sidebarOrder && Array.isArray(parsed.sidebarOrder)) {
        sidebarOrder = parsed.sidebarOrder;
        saveSidebarOrder();
      }
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
      renderChannelPanel();
      inp.value = '';
      // バックグラウンドでDB未登録チャンネルをrefresh（アイコン・名前を補完）
      const missingIds = importIds.filter(id => !dbMap[id]);
      if (missingIds.length > 0) {
        (async () => {
          const _list = document.getElementById('mChList');
          for (const id of missingIds) {
            const card = _list.querySelector(`.sidebar-channel-item[data-key="${id}"]`);
            if (card) card.classList.add('m-ch-refreshing');
            try {
              const res = await fetch('/api/channels/' + id + '/refresh', { method: 'POST' });
              const data = await res.json().catch(() => ({}));
              if (data.channel) {
                channels[id] = {
                  ...channels[id],
                  handle: data.channel.handle,
                  displayName: data.channel.title,
                  avatar: data.channel.icon_url,
                };
                saveChannels();
                const newCard = _makeChCard(id);
                const cur = _list.querySelector(`.sidebar-channel-item[data-key="${id}"]`);
                if (cur) cur.replaceWith(newCard);
                else _list.appendChild(newCard);
              }
            } catch { /* ignore */ }
            const fin = _list.querySelector(`.sidebar-channel-item[data-key="${id}"]`);
            if (fin) fin.classList.remove('m-ch-refreshing');
          }
          showToast(t('preset-imported'));
        })();
      } else {
        showToast(t('preset-imported'));
      }
    } catch (e) {
      inp.classList.add('error');
      showToast(t('preset-import-err'), 'err');
    }
  });

  // lucide アイコンを初期化
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // カテゴリボタンの初期状態
  document.querySelectorAll('.m-cat-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === state.currentCat);
  });

  // リアクション: スウォッチ・セグメント・ソートの初期状態
  document.querySelectorAll('.m-rs-swatch').forEach(b => {
    b.classList.toggle('active', b.dataset.color === _mRsPinColor);
  });
  (function() {
    const seg = document.getElementById('mRsPinCountSegment');
    if (!seg) return;
    seg.querySelectorAll('.m-rs-seg-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.value, 10) === _mRsMaxPins);
    });
  })();
  const layer = document.getElementById('mRsPinsLayer');
  if (layer) layer.style.opacity = String(_mRsPinOpacity);
  _mRsUpdateSortUI();
  // トランスポート行とシークバーの初期表示
  const transport = document.getElementById('mRsTransport');
  if (transport) transport.hidden = !_mRsTransportVisible;
  const seekBar = document.getElementById('mRsSeek');
  if (seekBar) seekBar.hidden = !_mRsTransportVisible;
  document.getElementById('mRsTransportBtn').classList.toggle('active', _mRsTransportVisible);
  // サブバーを表示しコンテンツ領域を下げる
  const catBar = document.getElementById('mCatBar');
  catBar.hidden = false;

  // URL から初期状態を復元（ページリロード対応）、なければ前回チャンネルを使用
  (async function _restoreFromUrl() {
    const st = parseHash();
    setSuppressHistory(true);
    try {
      if (st.channelKey && channels[st.channelKey]) {
        // URL にチャンネルが指定されている → 復元
        await selectChannel(st.channelKey);
        if (st.tab && st.tab !== currentTab) switchTab(st.tab);
        if (st.tab === 'reaction' && st.vid) mRsOpenMode(st.vid);
        history.replaceState(
          { tab: currentTab, channelKey: state.currentChannelKey, vid: st.vid || null },
          '',
          location.hash || buildHash(state.currentChannelKey, currentTab, null)
        );
      } else {
        const lastChannel = localStorage.getItem('m-last-channel');
        if (lastChannel && channels[lastChannel]) {
          await selectChannel(lastChannel);
          history.replaceState(
            { tab: currentTab, channelKey: state.currentChannelKey, vid: null },
            '',
            buildHash(state.currentChannelKey, currentTab, null)
          );
        } else {
          // チャンネル未選択時も初期描画を行い「チャンネルを選択してください」を表示する
          renderCurrentTab();
          history.replaceState({ tab: currentTab, channelKey: null, vid: null }, '', location.pathname);
        }
      }
    } finally {
      setSuppressHistory(false);
    }
  })();
});
