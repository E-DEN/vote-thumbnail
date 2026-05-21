// mobile/js/app.js
// モバイル専用アプリケーションロジック
import { state, LS_CAT, LS_SORT, LS_CHANNELS, LS_API_KEY, LS_RSS_ONLY } from '../../js/state.js';
import { loadRating, applyVoteLocal, syncVoteToServer, getVotePair, setVotePair, pickPair, _playedPairs, _pairKey, getRating, getRd, getWins, getBattles } from '../../js/rating.js';
import { loadChannels, saveChannels, loadVideosForChannel, saveVideosForChannel, fetchChannelVideos, filteredVideos } from '../../js/storage.js';
import { formatViews, formatRelTime, formatViewsShort } from '../../js/format.js';

const LS_LIST_SORT_DIR = 'thumb-sort-dir';

// メタ表示用 SVGアイコン
const _M_SVG_EYE  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const _M_SVG_CLK  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
const _M_SVG_STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const _M_SVG_PLAY  = '<svg viewBox="0 0 24 24" fill="currentColor" width="38" height="38"><path d="M8 5v14l11-7z"/></svg>';
const _M_SVG_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" width="38" height="38"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
const _M_SVG_FULLSCREEN      = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
const _M_SVG_FULLSCREEN_EXIT = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>';
const _M_SVG_PIN  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';

// オブジェクトエイリアス（参照が同一なので変更は state に反映される）
const ratingData = state.ratingData;
const channels   = state.channels;

// モバイル固有状態
let currentTab      = 'list';
let _currentVotePair = null;

// 無限スクロール
let _listPage       = 0;
const LIST_PAGE_SIZE = 40;
let _listPool       = [];
let _listObserver   = null;

// --- トースト通知 ---
function showToast(msg, isError) {
  const container = document.getElementById('app-toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'app-toast ' + (isError ? 'err' : 'ok');
  const remove = () => { toast.classList.add('out'); setTimeout(() => toast.remove(), 320); };
  if (isError) {
    const span = document.createElement('span');
    span.textContent = msg;
    const btn = document.createElement('button');
    btn.className = 'app-toast-close';
    btn.textContent = '\u00d7';
    btn.addEventListener('click', remove);
    toast.appendChild(span);
    toast.appendChild(btn);
  } else {
    toast.textContent = msg;
    setTimeout(remove, 3000);
  }
  container.appendChild(toast);
}

// チャンネルキーをURL/ハンドルから解析
function channelKeyFromInput(input) {
  const trimmed = input.trim();
  // @handle 形式
  const mHandle = trimmed.match(/@([\w.-]+)/);
  if (mHandle) return { type: 'handle', value: '@' + mHandle[1] };
  // channel URL
  const mId = trimmed.match(/UC([\w-]{22})/);
  if (mId) return { type: 'id', value: 'UC' + mId[1] };
  // 単純ハンドル名（@ なし）
  if (/^[\w.-]+$/.test(trimmed)) return { type: 'handle', value: '@' + trimmed };
  return null;
}

// --- チャンネル選択 ---
async function selectChannel(key) {
  const ch = channels[key];
  if (!ch) return;
  state.currentChannelKey = key;
  _mRsCurrentVideoId = null;
  _mRsLoadedVideoId  = null;
  localStorage.setItem('m-last-channel', key);

  // ヘッダーのチャンネル名を更新
  const displayName = ch.displayName || ch.handle || key;
  document.getElementById('mChNameDisplay').textContent = displayName;

  try {
    state.allVideos = await fetchChannelVideos(key);
    saveVideosForChannel(key, state.allVideos);
    // 現在カテゴリに動画がなければ有効なカテゴリに切り替え
    const counts = { videos: 0, shorts: 0, live: 0 };
    state.allVideos.forEach(v => { if (counts[v.category] !== undefined) counts[v.category]++; });
    if (!counts[state.currentCat]) {
      state.currentCat = counts.live >= counts.videos && counts.live >= counts.shorts ? 'live'
                 : counts.shorts > counts.videos ? 'shorts' : 'videos';
      localStorage.setItem(LS_CAT, state.currentCat);
    }
  } catch {
    // オフライン時: ローカルキャッシュを使用
    const cached = loadVideosForChannel(key);
    if (cached) state.allVideos = cached;
    else state.allVideos = [];
  }

  // カテゴリボタンのアクティブ状態を同期
  document.querySelectorAll('.m-cat-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === state.currentCat);
  });

  // アクティブなタブを再描画
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
function renderChannelPanel() {
  const list = document.getElementById('mChList');
  list.innerHTML = '';

  const keys = Object.keys(channels);
  if (keys.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'm-empty-msg';
    msg.style.padding = '24px 16px';
    msg.style.fontSize = '12px';
    msg.textContent = 'チャンネルが未登録です。下の入力欄から追加してください。';
    list.appendChild(msg);
    return;
  }

  keys.forEach(key => {
    const ch = channels[key];
    const name = ch.displayName || ch.handle || key;
    const card = document.createElement('div');
    card.className = 'm-ch-card' + (key === state.currentChannelKey ? ' active' : '');
    card.dataset.key = key;

    // アバター
    if (ch.avatar) {
      const img = document.createElement('img');
      img.className = 'm-ch-avatar';
      img.src = ch.avatar;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.onerror = function() { this.style.display = 'none'; };
      card.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'm-ch-avatar-placeholder';
      card.appendChild(ph);
    }

    // チャンネル名
    const nameEl = document.createElement('span');
    nameEl.className = 'm-ch-card-name';
    nameEl.textContent = name;
    card.appendChild(nameEl);

    // 外部リンク
    const ytUrl = ch.handle
      ? 'https://www.youtube.com/' + ch.handle
      : 'https://www.youtube.com/channel/' + key;
    const link = document.createElement('a');
    link.className = 'm-ch-card-link';
    link.href = ytUrl;
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('aria-label', 'YouTubeで開く');
    link.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>';
    link.addEventListener('click', e => e.stopPropagation());
    card.appendChild(link);

    card.addEventListener('click', async () => {
      closeChannelPanel();
      await selectChannel(key);
    });

    list.appendChild(card);
  });
}

function openChannelPanel() {
  document.getElementById('mChPanel').classList.add('open');
  document.getElementById('mChOverlay').classList.add('open');
}

function closeChannelPanel() {
  document.getElementById('mChPanel').classList.remove('open');
  document.getElementById('mChOverlay').classList.remove('open');
}

// チャンネル追加
async function addChannel(input) {
  const statusEl = document.getElementById('mChAddStatus');
  const ch = channelKeyFromInput(input);
  if (!ch) {
    statusEl.textContent = '無効な入力です';
    return;
  }
  statusEl.textContent = '取得中...';
  try {
    const body = ch.type === 'handle' ? { handle: ch.value } : { handle: ch.value };
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      statusEl.textContent = data.error || '追加に失敗しました';
      return;
    }
    const serverCh = data.channel;
    const key = serverCh.channel_id;
    if (!channels[key]) {
      channels[key] = {
        key,
        handle:      serverCh.handle,
        displayName: serverCh.title,
        avatar:      serverCh.icon_url,
      };
      saveChannels();
    }
    statusEl.textContent = (serverCh.title || ch.value) + ' を追加しました';
    renderChannelPanel();
    document.getElementById('mChAddInput').value = '';
    setTimeout(() => { statusEl.textContent = ''; }, 3000);
    await selectChannel(key);
    setTimeout(closeChannelPanel, 400);
  } catch (e) {
    statusEl.textContent = '接続エラー: ' + e.message;
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

  renderCurrentTab();
}

function renderCurrentTab() {
  if (currentTab === 'list')     renderList();
  else if (currentTab === 'vote')    renderVote();
  else if (currentTab === 'ranking') renderRanking();
  else if (currentTab === 'reaction') renderReaction();
}

// チャンネル未選択・動画なし共通メッセージ
function renderNoChannel(containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = '<div class="m-empty-msg">チャンネルを選択してください</div>';
}

function renderNoCat(containerId) {
  const el = document.getElementById(containerId);
  el.innerHTML = '<div class="m-empty-msg">このカテゴリには動画がありません</div>';
}

// --- Tab1: 一覧 ---
function _updateListSortUI() {
  const sort = localStorage.getItem(LS_SORT) || 'views';
  const dir  = localStorage.getItem(LS_LIST_SORT_DIR) || 'desc';
  const dirBtn = document.getElementById('mListSortDir');
  if (dirBtn) dirBtn.classList.toggle('asc', dir === 'asc');
  document.querySelectorAll('#mListSortBar .m-rs-sort-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.sort === sort);
  });
}

function renderList() {
  _updateListSortUI();
  const grid = document.getElementById('mListGrid');
  const sentinel = document.getElementById('mListSentinel');
  grid.innerHTML = '';

  if (!state.currentChannelKey) { renderNoChannel('mListGrid'); return; }

  const pool = _buildListPool();
  if (pool.length === 0) { renderNoCat('mListGrid'); return; }

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
  const sort = localStorage.getItem(LS_SORT) || 'views';
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
    const metaParts = [];
    if (v.viewCount) metaParts.push('<span class="m-meta-item">' + _M_SVG_EYE + formatViewsShort(v.viewCount) + '</span>');
    if (v.publishedAt) metaParts.push('<span class="m-meta-item">' + _M_SVG_CLK + formatRelTime(v.publishedAt) + '</span>');
    metaParts.push('<span class="m-meta-item">' + _M_SVG_STAR + Math.round(getRating(v.id)) + '</span>');
    if (_mRsMyPins[v.id]) {
      metaParts.push('<span class="m-meta-item m-meta-pinned">' + _M_SVG_PIN + '<span class="m-meta-pin-dot" style="background:' + (_mRsPinColor || '#ec4899') + '"></span></span>');
    }
    meta.innerHTML = metaParts.join('');

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
  if (!state.currentChannelKey) {
    wrap.innerHTML = '<div class="m-vote-empty">チャンネルを選択してください</div>';
    return;
  }

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
    wrap.innerHTML = pool.length >= 2
      ? '<div class="m-vote-empty">全組み合わせの評価が確定しました</div>'
      : '<div class="m-vote-empty">このカテゴリには動画が2本以上必要です</div>';
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
  card.appendChild(title);

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
        const badge = document.createElement('div');
        badge.className = 'm-vote-winner-badge';
        badge.textContent = 'WIN';
        c.appendChild(badge);
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
    if (battles > 0) scoreParts.push(wins + '勝 / ' + battles + '戦 (' + wr + '%)');
    if (v.viewCount) scoreParts.push('<span class="m-meta-item">' + _M_SVG_EYE + formatViewsShort(v.viewCount) + '</span>');
    score.innerHTML = scoreParts.join('');

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
var _mRsSessionId = (function() {
  var k = 'reactions-session-id';
  var s = localStorage.getItem(k);
  if (!s) { s = Date.now().toString(36) + Math.random().toString(36).slice(2); localStorage.setItem(k, s); }
  return s;
})();

let _mRsCurrentVideoId = null;
let _mRsLoadedVideoId  = null; // mRsOpenMode が実際に初期化した動画 ID
let _mRsActive         = false;
let _mRsPinsVisible    = true;
let _mRsHeatmapVisible = false;
let _mRsPins           = [];
let _mRsKde            = null;
let _mRsMyPins         = {};
let _mRsPinColor       = localStorage.getItem('reactions-pin-color') || '#ec4899';
let _mRsMyPinOnDrop    = null;
let _mRsMyPinAnimRaf   = 0;
// ピンドラッグ状態
let _mRsPinDragging  = false;
let _mRsPinDragId    = null;

// 最大ピン数
const LS_RS_MAX_PINS = 'thumb-rs-max-pins';
let _mRsMaxPins = parseInt(localStorage.getItem(LS_RS_MAX_PINS) || '10', 10);
// 時間表示設定
const LS_RS_SHOW_TIME = 'thumb-rs-show-time';
let _mRsShowSeekTime = localStorage.getItem(LS_RS_SHOW_TIME) === 'true';

// プレイリストソート状態
const LS_RS_SORT     = 'thumb-rs-sort';
const LS_RS_SORT_DIR = 'thumb-rs-sort-dir';
let _mRsSortOrder = localStorage.getItem(LS_RS_SORT)     || 'views';
let _mRsSortDir   = localStorage.getItem(LS_RS_SORT_DIR) || 'desc';

// トランスポート状態
let _mRsTransportVisible = true;
let _mRsPlaying      = false;
let _mRsOverlayTimer = null;  // オーバーレイ自動非表示タイマー
let _mRsSeekFadeTimer = null; // 再生後のシークバーフェードタイマー
let _mRsRafId        = null;
let _mRsLastRafTs    = null;
let _mRsDuration     = 4;
let _mRsCurrentTime  = 0;
let _mRsPlacedPins   = [];
let _mRsEmittedCount = 0;
let _mRsMyPinEmitAt  = -1;
let _mRsMyPinEmitted = false;

const PIN_SNAPS_M = [0, 1, 5, 10, 15, 20, 25, 30];
const M_RS_DROP_HEIGHT  = 55;
const M_RS_DROP_SPEED   = 1.5;
const M_RS_FADE_IN_FRAC = 0.05;
const M_RS_PIN_PALETTES = {
  '#ec4899': ['#ec4899', '#f472b6', '#db2777'],
  '#00b0f4': ['#00b0f4', '#38bdf8', '#0284c7'],
  '#57f287': ['#57f287', '#4ade80', '#16a34a'],
  '#f59e0b': ['#f59e0b', '#fbbf24', '#d97706'],
  '#a855f7': ['#a855f7', '#c084fc', '#9333ea'],
};

function mRsApplyPalette() {
  const wrap = document.getElementById('mRsImgWrap');
  if (!wrap) return;
  const palette = M_RS_PIN_PALETTES[_mRsPinColor] || M_RS_PIN_PALETTES['#ec4899'];
  wrap.style.setProperty('--pin-c0', palette[0]);
  wrap.style.setProperty('--pin-c1', palette[1]);
  wrap.style.setProperty('--pin-c2', palette[2]);
}

// KDE 重み計算（bandwidth=0.07）
function mRsComputeKde(pins) {
  const n = pins.length;
  if (n < 2) return null;
  const bw2 = 0.07 * 0.07;
  const noiseFloor = 0.15;
  const w = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = pins[i].x - pins[j].x, dy = pins[i].y - pins[j].y;
      w[i] += Math.exp(-(dx * dx + dy * dy) / (2 * bw2));
    }
  }
  const max = Math.max(...w) || 1;
  return w.map(v => noiseFloor + (1 - noiseFloor) * (v / max));
}

// グリッドクラスタリング（表示ピン密度計算に使用）
function mRsComputeClusters(pins) {
  const GRID = 10;
  const cellPins = {};
  for (const p of pins) {
    const cx = Math.min(GRID - 1, Math.floor(p.x * GRID));
    const cy = Math.min(GRID - 1, Math.floor(p.y * GRID));
    const key = cx + ',' + cy;
    if (!cellPins[key]) cellPins[key] = [];
    cellPins[key].push(p);
  }
  const clusters = [];
  for (const cell of Object.values(cellPins)) {
    let sumX = 0, sumY = 0;
    for (const p of cell) { sumX += p.x; sumY += p.y; }
    const centX = sumX / cell.length, centY = sumY / cell.length;
    let best = cell[0], bestDist = Infinity;
    for (const p of cell) {
      const dx = p.x - centX, dy = p.y - centY;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = p; }
    }
    clusters.push({ pin: best, pins: cell, count: cell.length });
  }
  clusters.sort((a, b) => b.count - a.count);
  return clusters;
}

// 表示するピン一覧を構築（密集度重みで最大 count 本を選択）
function mRsBuildPlacedPins(count) {
  if (count == null) count = _mRsMaxPins;
  const pins = _mRsPins.slice();
  if (!pins.length) return [];
  const clusters = mRsComputeClusters(pins);
  const maxCount = clusters.length > 0 ? clusters[0].count : 1;
  const GRID = 10;
  const cellWeight = {};
  for (const cl of clusters) {
    const cx = Math.min(GRID - 1, Math.floor(cl.pin.x * GRID));
    const cy = Math.min(GRID - 1, Math.floor(cl.pin.y * GRID));
    cellWeight[cx + ',' + cy] = cl.count / maxCount;
  }
  const weighted = pins.map(p => {
    const cx = Math.min(GRID - 1, Math.floor(p.x * GRID));
    const cy = Math.min(GRID - 1, Math.floor(p.y * GRID));
    return { p, w: Math.sqrt(cellWeight[cx + ',' + cy] || 0.01) };
  });
  weighted.sort((a, b) => Math.pow(Math.random(), 1 / b.w) - Math.pow(Math.random(), 1 / a.w));
  const placed = weighted.slice(0, count).map(item => ({ x: item.p.x, y: item.p.y, density: 0 }));
  const BW2 = 0.09 * 0.09;
  let maxKde = 0;
  const kdeDensities = placed.map(pin => {
    let kde = 0;
    for (const p of pins) {
      const dx = p.x - pin.x, dy = p.y - pin.y;
      kde += Math.exp(-(dx * dx + dy * dy) / (2 * BW2));
    }
    if (kde > maxKde) maxKde = kde;
    return kde;
  });
  if (maxKde > 0) {
    for (let i = 0; i < placed.length; i++) placed[i].density = kdeDensities[i] / maxKde;
  }
  for (let i = placed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [placed[i], placed[j]] = [placed[j], placed[i]];
  }
  return placed;
}

// ピン DOM 要素を生成（アニメーション付き）
function mRsMakePinEl(x, y, density, skipDropAnim, pinProps) {
  const d = density != null ? density : 0.5;
  const baseScale = 0.6 + 0.8 * d;
  const scale = (pinProps && pinProps._scale != null) ? pinProps._scale : baseScale + (Math.random() - 0.5) * 0.4;
  const sz = Math.round(20 * scale);
  const szH = Math.round(sz * 1.25);
  const shadeIdx = d >= 0.67 ? 2 : d >= 0.34 ? 1 : 0;
  const palette = M_RS_PIN_PALETTES[_mRsPinColor] || M_RS_PIN_PALETTES['#ec4899'];
  function hexToRgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const cLight = hexToRgb(palette[0]);
  const cDark  = hexToRgb(palette[2]);
  const t      = Math.max(0, (d - 0.1) / 0.9);
  const pr     = Math.round(cLight[0] + (cDark[0] - cLight[0]) * t);
  const pg     = Math.round(cLight[1] + (cDark[1] - cLight[1]) * t);
  const pb     = Math.round(cLight[2] + (cDark[2] - cLight[2]) * t);
  const pinColor = 'rgb(' + pr + ',' + pg + ',' + pb + ')';
  const tipGap = szH / 30;
  const el = document.createElement('div');
  el.className   = 'reactions-pin shade-' + shadeIdx;
  el.dataset.x   = x;
  el.dataset.y   = y;
  el.dataset.density = d.toFixed(4);
  el.style.cssText   = 'left:' + (x * 100) + '%;top:calc(' + (y * 100) + '% + ' + tipGap.toFixed(2) + 'px);--drop-h:' + M_RS_DROP_HEIGHT + 'px;';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'reactions-pin-svg');
  svg.setAttribute('viewBox', '0 0 24 30');
  svg.setAttribute('width', sz);
  svg.setAttribute('height', szH);
  svg.innerHTML =
    '<path class="pin-balloon" style="fill:' + pinColor + '" d="M12,29 C5.5,21.5 1.5,17 1.5,11 a10.5,10.5,0,0,1,21,0 C22.5,17 18.5,21.5 12,29 Z"/>'
    + '<g transform="translate(12 11) scale(0.38) translate(-12 -12)">'
    + '<path class="pin-icon" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>'
    + '</g>';
  el.appendChild(svg);
  const floatDur = ((pinProps && pinProps._floatDur != null) ? pinProps._floatDur : (2.4 + Math.random() * 0.8).toFixed(2)) + 's ease-in-out infinite';
  if (skipDropAnim) {
    el.style.transform  = 'translate(-50%, -100%)';
    el.style.opacity    = '1';
    el.style.animation  = 'reactionsPinFloat ' + floatDur;
    svg.style.animation = 'none';
    el.classList.add('rs-floating');
  } else {
    el.style.animation  = 'reactionsPinDrop ' + M_RS_DROP_SPEED + 's linear forwards';
    svg.style.animation = 'reactionsPinSvgSquash ' + M_RS_DROP_SPEED + 's linear forwards';
    el.animate(
      [{ opacity: 0, offset: 0 }, { opacity: 1, offset: M_RS_FADE_IN_FRAC }, { opacity: 1, offset: 1 }],
      { duration: M_RS_DROP_SPEED * 1000, fill: 'forwards', easing: 'linear' }
    );
    el.addEventListener('animationend', function(e) {
      if (e.animationName === 'reactionsPinDrop') {
        el.style.animation  = 'reactionsPinFloat ' + floatDur;
        svg.style.animation = 'none';
        el.classList.add('rs-floating');
      }
    }, { once: true });
  }
  return el;
}

// ヒートマップを canvas に描画
function mRsRenderHeatmap() {
  const layer = document.getElementById('mRsHeatmapLayer');
  if (!layer) return;
  const w = layer.offsetWidth, h = layer.offsetHeight;
  if (!w || !h) return;
  let canvas = layer.querySelector('canvas');
  if (!canvas) {
    layer.innerHTML = '';
    const underlay = document.createElement('div');
    underlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.70);pointer-events:none;';
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;filter:blur(18px);';
    layer.appendChild(underlay);
    layer.appendChild(canvas);
  }
  if (!_mRsPins.length) {
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').clearRect(0, 0, w, h);
    return;
  }
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  const hex = (_mRsPinColor || '#ec4899').replace('#', '');
  const cr = parseInt(hex.slice(0, 2), 16);
  const cg = parseInt(hex.slice(2, 4), 16);
  const cb = parseInt(hex.slice(4, 6), 16);
  const radius = Math.min(w, h) * 0.22;
  const alpha  = Math.min(0.25, 4.0 / _mRsPins.length);
  for (const p of _mRsPins) {
    const cx = p.x * w, cy = p.y * h;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0,   'rgba(' + cr + ',' + cg + ',' + cb + ',' + alpha.toFixed(4) + ')');
    grad.addColorStop(0.3, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (alpha * 0.6).toFixed(4) + ')');
    grad.addColorStop(0.7, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (alpha * 0.15).toFixed(4) + ')');
    grad.addColorStop(1,   'rgba(' + cr + ',' + cg + ',' + cb + ',0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// コミュニティピンを順次降下アニメーションで表示
function mRsStartLoop() {
  _mRsActive = false;
  const pinsLayer = document.getElementById('mRsPinsLayer');
  if (!pinsLayer) return;
  pinsLayer.innerHTML = '';
  const placed = mRsBuildPlacedPins();
  if (!placed.length) {
    const saved = _mRsMyPins[_mRsCurrentVideoId];
    if (saved && _mRsPinsVisible) mRsShowMyPin(saved.x, saved.y, false);
    return;
  }
  _mRsActive = true;
  let emitted = 0;
  function spawnOne() {
    if (!_mRsActive || emitted >= placed.length) { _mRsActive = false; return; }
    const pin = placed[emitted++];
    pinsLayer.appendChild(mRsMakePinEl(pin.x, pin.y, pin.density));
    setTimeout(spawnOne, 80 + Math.random() * 200);
  }
  for (let s = 0; s < 5; s++) setTimeout(() => { if (_mRsActive) spawnOne(); }, s * 80);
  // 自分のピンを復元（既に打っていれば）
  const saved = _mRsMyPins[_mRsCurrentVideoId];
  if (saved) mRsShowMyPin(saved.x, saved.y, false);
}

// ドラッグ中: ピンを「刺さった状態」で即時移動（アニメーションなし）
function _mRsMovePinDrag(x, y) {
  const pin    = document.getElementById('mRsMyPin');
  const svg    = document.getElementById('mRsMyPinSvg');
  const shadow = document.getElementById('mRsMyPinShadow');
  if (!pin || !svg) return;
  const tipGap = (45 / 30).toFixed(2);
  if (_mRsMyPinOnDrop) { pin.removeEventListener('animationend', _mRsMyPinOnDrop); _mRsMyPinOnDrop = null; }
  if (_mRsMyPinAnimRaf) { cancelAnimationFrame(_mRsMyPinAnimRaf); _mRsMyPinAnimRaf = 0; }
  pin.getAnimations().forEach(a => a.cancel());
  svg.getAnimations().forEach(a => a.cancel());
  pin.style.left      = (x * 100) + '%';
  pin.style.top       = 'calc(' + (y * 100) + '% + ' + tipGap + 'px)';
  pin.style.transform = 'translate(-50%, -100%)';
  pin.style.opacity   = '1';
  pin.style.animation = 'none';
  svg.style.animation = 'none';
  pin.classList.remove('color-cycling', 'rs-floating');
  pin.hidden = false;
  if (shadow) shadow.hidden = true;
}

// 自分のピンを指定位置に表示（withAnim=true で落下アニメーション）
function mRsShowMyPin(x, y, withAnim) {
  // 好きOFF時はピンを表示しない
  if (!_mRsPinsVisible) return;
  const pin    = document.getElementById('mRsMyPin');
  const svg    = document.getElementById('mRsMyPinSvg');
  const shadow = document.getElementById('mRsMyPinShadow');
  const tipGap = (45 / 30).toFixed(2);
  pin.style.left = (x * 100) + '%';
  pin.style.top  = 'calc(' + (y * 100) + '% + ' + tipGap + 'px)';
  pin.style.setProperty('--drop-h', M_RS_DROP_HEIGHT + 'px');
  pin.hidden = false;
  if (shadow) {
    shadow.style.left = (x * 100) + '%';
    shadow.style.top  = 'calc(' + (y * 100) + '% + ' + tipGap + 'px)';
    shadow.hidden = false;
  }
  if (_mRsMyPinOnDrop) { pin.removeEventListener('animationend', _mRsMyPinOnDrop); _mRsMyPinOnDrop = null; }
  if (_mRsMyPinAnimRaf) { cancelAnimationFrame(_mRsMyPinAnimRaf); _mRsMyPinAnimRaf = 0; }
  pin.classList.remove('color-cycling');
  pin.getAnimations().forEach(a => a.cancel());
  svg.getAnimations().forEach(a => a.cancel());
  pin.style.transform = '';
  pin.style.opacity   = '';
  pin.style.animation = 'none';
  svg.style.animation = 'none';
  _mRsMyPinAnimRaf = requestAnimationFrame(() => {
    _mRsMyPinAnimRaf = 0;
    const floatDur = (2.4 + Math.random() * 0.8).toFixed(2) + 's';
    if (withAnim) {
      pin.style.animation = 'reactionsPinDrop ' + M_RS_DROP_SPEED + 's linear forwards';
      svg.style.animation = 'reactionsPinSvgSquash ' + M_RS_DROP_SPEED + 's linear forwards';
      pin.animate(
        [{ opacity: 0, offset: 0 }, { opacity: 1, offset: M_RS_FADE_IN_FRAC }, { opacity: 1, offset: 1 }],
        { duration: M_RS_DROP_SPEED * 1000, fill: 'forwards', easing: 'linear' }
      );
      _mRsMyPinOnDrop = e => {
        if (e.animationName !== 'reactionsPinDrop') return;
        _mRsMyPinOnDrop = null;
        pin.style.animation = 'reactionsPinFloat ' + floatDur + ' ease-in-out infinite';
        svg.style.animation = '';
        pin.classList.add('color-cycling', 'rs-floating');
      };
      pin.addEventListener('animationend', _mRsMyPinOnDrop);
    } else {
      pin.style.transform = 'translate(-50%, -100%)';
      pin.style.opacity   = '1';
      pin.style.animation = 'reactionsPinFloat ' + floatDur + ' ease-in-out infinite';
      svg.style.animation = '';
      pin.classList.add('color-cycling', 'rs-floating');
    }
  });
}

// 指定動画の seeds を API から取得してアニメーションを開始
async function mRsOpenMode(videoId) {
  if (!videoId) return;
  _mRsActive         = false;
  _mRsLoadedVideoId  = videoId; // 描画済み ID を更新（早い段階でセット）
  _mRsCurrentVideoId = videoId;
  _mRsPins          = [];
  _mRsKde           = null;
  const pinsLayer   = document.getElementById('mRsPinsLayer');
  const hmLayer     = document.getElementById('mRsHeatmapLayer');
  const myPin       = document.getElementById('mRsMyPin');
  const myPinShadow = document.getElementById('mRsMyPinShadow');
  if (pinsLayer)    pinsLayer.innerHTML = '';
  if (hmLayer)      { hmLayer.style.cssText = 'opacity:0;visibility:hidden;'; hmLayer.innerHTML = ''; }
  if (myPin)        myPin.hidden = true;
  if (myPinShadow)  myPinShadow.hidden = true;
  mRsApplyPalette();
  // サムネイルを表示
  const v = filteredVideos().find(vid => vid.id === videoId);
  const img         = document.getElementById('mRsImg');
  const placeholder = document.getElementById('mRsPlaceholder');
  const toolbar     = document.getElementById('mRsToolbar');
  const titleEl     = document.getElementById('mRsVideoTitle');
  if (v) {
    img.src     = v.thumb;
    img.onerror = function() { this.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'; };
    if (placeholder) placeholder.hidden = true;
    if (toolbar)  toolbar.hidden = false;
    const seekEl = document.getElementById('mRsSeek');
    if (seekEl) seekEl.hidden = !_mRsTransportVisible;
    if (titleEl)  { titleEl.textContent = v.title || ''; titleEl.href = 'https://www.youtube.com/watch?v=' + v.id; }
    mRsRenderVideoMeta(v);
  }
  // seeds ロード後にピン・ヒートマップを開始
  try {
    const resp = await fetch('/api/pins/' + videoId + '/seeds?session=' + encodeURIComponent(_mRsSessionId));
    if (resp.ok) {
      const data = await resp.json();
      _mRsPins = data.pins || [];
      _mRsKde  = mRsComputeKde(_mRsPins);
      if (data.my_pin && !_mRsMyPins[videoId]) {
        _mRsMyPins[videoId] = { x: data.my_pin.x, y: data.my_pin.y };
      }
    }
  } catch { /* オフライン時はピンなしで続行 */ }
  if (_mRsCurrentVideoId !== videoId) return; // タブ切替等で別動画に変わっていれば無視
  if (_mRsHeatmapVisible) {
    const hm = document.getElementById('mRsHeatmapLayer');
    if (hm) { hm.style.visibility = 'visible'; hm.style.opacity = '1'; }
    mRsRenderHeatmap();
  }
  // 初期表示は再生なし。ピンアニメーションのみ開始（ユーザーが再生ボタンを押したときに開始）
  _mRsCurrentTime  = 0;
  _mRsDuration     = 0;
  _mRsEmittedCount = 0;
  _mRsPlacedPins   = [];
  _mRsUpdateProgressUI();
  if (_mRsPinsVisible) {
    mRsStartLoop();
  }
}

// ランキング行クリックからリアクション画面に遷移
function openVideoInReaction(v) {
  _mRsCurrentVideoId = v.id;
  switchTab('reaction');
}

// リアクションタブ描画
function renderReaction() {
  if (!state.currentChannelKey) {
    const placeholder = document.getElementById('mRsPlaceholder');
    const toolbar     = document.getElementById('mRsToolbar');
    if (placeholder) { placeholder.hidden = false; placeholder.textContent = 'チャンネルを選択してください'; }
    if (toolbar) toolbar.hidden = true;
    const seekElNoC = document.getElementById('mRsSeek');
    if (seekElNoC) seekElNoC.hidden = true;
    document.getElementById('mRsImg').src = '';
    mRsRenderPlaylist();
    return;
  }
  mRsRenderPlaylist();
  _mRsUpdateSortUI();
  const pool = _mRsBuildSortedPool();
  if (pool.length === 0) {
    const placeholder = document.getElementById('mRsPlaceholder');
    if (placeholder) { placeholder.hidden = false; placeholder.textContent = 'このカテゴリには動画がありません'; }
    const toolbar = document.getElementById('mRsToolbar');
    if (toolbar) toolbar.hidden = true;
    const seekElNoV = document.getElementById('mRsSeek');
    if (seekElNoV) seekElNoV.hidden = true;
    return;
  }
  const targetId = (_mRsCurrentVideoId && pool.find(v => v.id === _mRsCurrentVideoId))
    ? _mRsCurrentVideoId
    : pool[0].id;
  if (targetId !== _mRsLoadedVideoId) {
    mRsOpenMode(targetId);
  }
}

// 動画メタを .m-rs-video-meta に描画
function mRsRenderVideoMeta(v) {
  const el = document.getElementById('mRsVideoMeta');
  if (!el || !v) return;
  const parts = [];
  if (v.viewCount)  parts.push('<span class="m-meta-item">' + _M_SVG_EYE  + formatViewsShort(v.viewCount) + '</span>');
  if (v.publishedAt) parts.push('<span class="m-meta-item">' + _M_SVG_CLK + formatRelTime(v.publishedAt) + '</span>');
  el.innerHTML = parts.join('');
}

// --- トランスポート ---

function _mRsFmtTime(s) {
  var m = Math.floor(s / 60);
  var sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

function _mRsUpdateProgressUI() {
  var fill     = document.getElementById('mRsProgressFill');
  var thumb    = document.getElementById('mRsProgressThumb');
  var label    = document.getElementById('mRsTimeLabel');
  var seekTime = document.getElementById('mRsSeekTime');
  var pct = _mRsDuration > 0 ? _mRsCurrentTime / _mRsDuration * 100 : 0;
  if (fill)     fill.style.width = pct + '%';
  if (thumb)    thumb.style.left = pct + '%';
  var timeText = _mRsFmtTime(_mRsCurrentTime) + ' / ' + _mRsFmtTime(_mRsDuration);
  if (label)    label.textContent = timeText;
  if (seekTime) seekTime.textContent = timeText;
}

function _mRsUpdatePlayBtnUI() {
  var btn = document.getElementById('mRsPlayBtn');
  if (btn) btn.classList.toggle('playing', _mRsPlaying);
}

function _mRsShowOverlay() {
  var el = document.getElementById('mRsOverlay');
  if (!el || !_mRsTransportVisible) return;
  el.classList.add('visible');
  clearTimeout(_mRsOverlayTimer);
  _mRsOverlayTimer = setTimeout(_mRsHideOverlay, 1500);
}

function _mRsHideOverlay() {
  clearTimeout(_mRsOverlayTimer);
  _mRsOverlayTimer = null;
  var el = document.getElementById('mRsOverlay');
  if (el) el.classList.remove('visible');
}

function _mRsPlayPrev() {
  var pool = _mRsBuildSortedPool();
  if (!pool.length) return;
  var idx = pool.findIndex(function(v) { return v.id === _mRsCurrentVideoId; });
  var prev = pool[(idx - 1 + pool.length) % pool.length];
  if (prev) mRsOpenMode(prev.id);
}

function _mRsPlayNext() {
  var pool = _mRsBuildSortedPool();
  if (!pool.length) return;
  var idx = pool.findIndex(function(v) { return v.id === _mRsCurrentVideoId; });
  var next = pool[(idx + 1) % pool.length];
  if (next) mRsOpenMode(next.id);
}

function _mRsToggleFullscreen() {
  var wrap = document.getElementById('mRsImgWrap');
  if (!wrap) return;
  if (!document.fullscreenElement) {
    (wrap.requestFullscreen || wrap.webkitRequestFullscreen).call(wrap).catch(function() {});
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document).catch(function() {});
  }
}

// max=1 は自分ピン専用: コミュニティピンは表示しない
function _mRsCommLimit(max) { return max === 1 ? 0 : max; }

function _mRsEmitUpTo(time) {
  var pinsLayer = document.getElementById('mRsPinsLayer');
  if (!pinsLayer) return;
  var cLimit = _mRsCommLimit(_mRsMaxPins);
  while (_mRsEmittedCount < _mRsPlacedPins.length && _mRsEmittedCount < cLimit && _mRsPlacedPins[_mRsEmittedCount].emitAt <= time) {
    var p = _mRsPlacedPins[_mRsEmittedCount++];
    pinsLayer.appendChild(mRsMakePinEl(p.x, p.y, p.density, false, p));
  }
  if (!_mRsMyPinEmitted && _mRsMyPinEmitAt >= 0 && time >= _mRsMyPinEmitAt && _mRsMaxPins > 0) {
    var saved = _mRsMyPins[_mRsCurrentVideoId];
    if (saved && _mRsPinsVisible) {
      mRsShowMyPin(saved.x, saved.y, true);
      _mRsMyPinEmitted = true;
    }
  }
}

function _mRsTickFn(ts) {
  if (!_mRsPlaying) return;
  var dt = _mRsLastRafTs != null ? (ts - _mRsLastRafTs) / 1000 : 0;
  _mRsLastRafTs   = ts;
  _mRsCurrentTime = Math.min(_mRsDuration, _mRsCurrentTime + dt);
  _mRsUpdateProgressUI();
  _mRsEmitUpTo(_mRsCurrentTime);
  if (_mRsCurrentTime < _mRsDuration) {
    _mRsRafId = requestAnimationFrame(_mRsTickFn);
  } else {
    _mRsPlaying   = false;
    _mRsLastRafTs = null;
    _mRsRafId     = null;
    var btn = document.getElementById('mRsPlayBtn');
    if (btn) btn.classList.remove('playing');
    // 再生終了後3秒でシークバーをフェードアウト
    if (_mRsSeekFadeTimer) clearTimeout(_mRsSeekFadeTimer);
    _mRsSeekFadeTimer = setTimeout(function() {
      var seekEl = document.getElementById('mRsSeek');
      if (seekEl && !seekEl.hidden) seekEl.classList.add('faded');
      _mRsSeekFadeTimer = null;
    }, 3000);
  }
}

function _mRsSeekTo(time) {
  _mRsCurrentTime  = Math.max(0, Math.min(_mRsDuration, time));
  _mRsEmittedCount = 0;
  var pinsLayer = document.getElementById('mRsPinsLayer');
  if (pinsLayer) {
    pinsLayer.innerHTML = '';
    var cLimit = _mRsCommLimit(_mRsMaxPins);
    for (var i = 0; i < _mRsPlacedPins.length; i++) {
      if (i >= cLimit) break;
      if (_mRsCurrentTime > 0 && _mRsPlacedPins[i].emitAt <= _mRsCurrentTime) {
        pinsLayer.appendChild(mRsMakePinEl(_mRsPlacedPins[i].x, _mRsPlacedPins[i].y, _mRsPlacedPins[i].density, true, _mRsPlacedPins[i]));
        _mRsEmittedCount++;
      } else {
        break;
      }
    }
  }
  var myPin = document.getElementById('mRsMyPin');
  var myPinShadow = document.getElementById('mRsMyPinShadow');
  if (_mRsMyPinEmitAt >= 0 && _mRsCurrentTime > 0 && _mRsCurrentTime >= _mRsMyPinEmitAt && _mRsMaxPins > 0) {
    var saved = _mRsMyPins[_mRsCurrentVideoId];
    if (saved && _mRsPinsVisible && myPin && myPin.hidden) mRsShowMyPin(saved.x, saved.y, false);
    _mRsMyPinEmitted = true;
  } else {
    if (myPin) myPin.hidden = true;
    if (myPinShadow) myPinShadow.hidden = true;
    _mRsMyPinEmitted = false;
  }
  _mRsUpdateProgressUI();
}

function _mRsStartPlayback() {
  _mRsActive = false;
  if (_mRsRafId) { cancelAnimationFrame(_mRsRafId); _mRsRafId = null; }
  _mRsPlaying = false;
  var pinsLayer   = document.getElementById('mRsPinsLayer');
  var myPin       = document.getElementById('mRsMyPin');
  var myPinShadow = document.getElementById('mRsMyPinShadow');
  if (pinsLayer)    pinsLayer.innerHTML = '';
  if (myPin)        myPin.hidden = true;
  if (myPinShadow)  myPinShadow.hidden = true;
  _mRsMyPinEmitted = false;
  _mRsPlacedPins   = mRsBuildPlacedPins(30);
  var saved = _mRsMyPins[_mRsCurrentVideoId];
  if (!_mRsPlacedPins.length) {
    _mRsMyPinEmitAt = -1;
    if (saved && _mRsPinsVisible && _mRsMaxPins > 0) {
      mRsShowMyPin(saved.x, saved.y, true);
      _mRsMyPinEmitted = true;
    }
    // ピンがなくてもタイマーを動かしシークを更新する
    _mRsDuration     = 4;
    _mRsCurrentTime  = 0;
    _mRsEmittedCount = 0;
    _mRsPlaying      = true;
    _mRsLastRafTs    = null;
    _mRsUpdateProgressUI();
    _mRsRafId = requestAnimationFrame(_mRsTickFn);
    return;
  }
  var streams = [0, 80, 160, 240, 320];
  if (saved) {
    _mRsMyPinEmitAt = streams[0] / 1000;
    streams[0] += 80 + Math.random() * 200;
  } else {
    _mRsMyPinEmitAt = -1;
  }
  for (var si = 0; si < _mRsPlacedPins.length; si++) {
    var minIdx = 0;
    for (var k = 1; k < streams.length; k++) {
      if (streams[k] < streams[minIdx]) minIdx = k;
    }
    _mRsPlacedPins[si].emitAt = streams[minIdx] / 1000;
    streams[minIdx] += 80 + Math.random() * 200;
  }
  _mRsPlacedPins.sort(function(a, b) { return a.emitAt - b.emitAt; });
  _mRsPlacedPins.forEach(function(p) {
    var baseScale = 0.6 + 0.8 * p.density;
    p._scale    = baseScale + (Math.random() - 0.5) * 0.4;
    p._floatDur = (2.4 + Math.random() * 0.8).toFixed(2);
  });
  var lastEmit = _mRsPlacedPins[_mRsPlacedPins.length - 1].emitAt;
  _mRsDuration     = Math.max(1.0, lastEmit + 0.5);
  _mRsEmittedCount = 0;
  _mRsCurrentTime  = 0;
  _mRsPlaying      = true;
  _mRsLastRafTs    = null;
  var btn = document.getElementById('mRsPlayBtn');
  if (btn) btn.classList.add('playing');
  _mRsUpdateProgressUI();
  _mRsRafId = requestAnimationFrame(_mRsTickFn);
}

// --- プレイリスト用ソート ---

function _mRsBuildSortedPool() {
  const pool = filteredVideos().slice();
  const asc = _mRsSortDir === 'asc';
  if (_mRsSortOrder === 'date') {
    pool.sort((a, b) => asc
      ? ((a.publishedAt || '') < (b.publishedAt || '') ? -1 : 1)
      : ((b.publishedAt || '') > (a.publishedAt || '') ? 1 : -1)
    );
  } else if (_mRsSortOrder === 'views') {
    pool.sort((a, b) => asc
      ? (a.viewCount || 0) - (b.viewCount || 0)
      : (b.viewCount || 0) - (a.viewCount || 0)
    );
  } else if (_mRsSortOrder === 'rating') {
    pool.sort((a, b) => asc
      ? getRating(a.id) - getRating(b.id)
      : getRating(b.id) - getRating(a.id)
    );
  }
  return pool;
}

function _mRsUpdateSortUI() {
  const dirBtn = document.getElementById('mRsSortDir');
  if (dirBtn) dirBtn.classList.toggle('asc', _mRsSortDir === 'asc');
  document.querySelectorAll('.m-rs-sort-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.sort === _mRsSortOrder);
  });
}

// プレイリストを描画
function mRsRenderPlaylist() {
  const listEl = document.getElementById('mRsPlaylist');
  if (!listEl) return;
  const pool = _mRsBuildSortedPool();
  listEl.innerHTML = '';
  if (!pool.length) return;
  const frag = document.createDocumentFragment();
  pool.forEach(v => {
    const item = document.createElement('div');
    item.className = 'm-rs-playlist-item' + (v.id === _mRsCurrentVideoId ? ' selected' : '');
    const thumb = document.createElement('img');
    thumb.className       = 'm-rs-playlist-thumb';
    thumb.src             = v.thumb;
    thumb.alt             = '';
    thumb.loading         = 'lazy';
    thumb.referrerPolicy  = 'no-referrer';
    thumb.onerror = function() { this.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'; };
    const info = document.createElement('div');
    info.className = 'm-rs-playlist-info';
    const title = document.createElement('div');
    title.className   = 'm-rs-playlist-title';
    title.textContent = v.title;
    const meta = document.createElement('div');
    meta.className = 'm-rs-playlist-meta';
    const parts = [];
    if (v.viewCount)   parts.push('<span class="m-meta-item">' + _M_SVG_EYE + formatViewsShort(v.viewCount) + '</span>');
    if (v.publishedAt) parts.push('<span class="m-meta-item">' + _M_SVG_CLK + formatRelTime(v.publishedAt) + '</span>');
    const _rating = Math.round(getRating(v.id));
    parts.push('<span class="m-meta-item">' + _M_SVG_STAR + _rating + '</span>');
    if (_mRsMyPins[v.id]) {
      const _pinColor = _mRsPinColor || '#ec4899';
      parts.push('<span class="m-meta-item m-meta-pinned">' + _M_SVG_PIN + '<span class="m-meta-pin-dot" style="background:' + _pinColor + '"></span></span>');
    }
    meta.innerHTML = parts.join('');
    info.appendChild(title);
    info.appendChild(meta);
    item.appendChild(thumb);
    item.appendChild(info);
    item.addEventListener('click', () => {
      if (v.id === _mRsCurrentVideoId) return;
      listEl.querySelectorAll('.m-rs-playlist-item').forEach(el => el.classList.remove('selected'));
      item.classList.add('selected');
      mRsOpenMode(v.id);
    });
    frag.appendChild(item);
  });
  listEl.appendChild(frag);
  // 選択中アイテムを表示範囲内に調整
  requestAnimationFrame(() => {
    const selected = listEl.querySelector('.m-rs-playlist-item.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  });
}

// --- 動画概要シート ---
let _mVmenuVideo = null;
let _mVmenuDescExpanded = false;

function mOpenVideoMenu(v) {
  _mVmenuVideo = v;
  _mVmenuDescExpanded = false;
  const wrap = document.getElementById('mVideoMenu');
  if (!wrap) return;

  // タイトル
  const titleEl = document.getElementById('mVmenuTitle');
  if (titleEl) titleEl.textContent = v.title || '';

  // 統計ブロック
  const ratingEl  = document.getElementById('mVmenuRating');
  const viewsEl    = document.getElementById('mVmenuViews');
  const dateYearEl = document.getElementById('mVmenuDateYear');
  const dateMDEl   = document.getElementById('mVmenuDateMD');
  if (ratingEl) ratingEl.textContent = Math.round(getRating(v.id));
  if (viewsEl) viewsEl.textContent = v.viewCount ? formatViewsShort(v.viewCount) : '-';
  if (v.publishedAt) {
    const d = new Date(v.publishedAt);
    if (dateYearEl) dateYearEl.textContent = d.getFullYear() + '年';
    if (dateMDEl)   dateMDEl.textContent   = (d.getMonth() + 1) + '月' + d.getDate() + '日';
  } else {
    if (dateYearEl) dateYearEl.textContent = '-';
    if (dateMDEl)   dateMDEl.textContent   = '';
  }

  // 概要欄
  const descEl  = document.getElementById('mVmenuDesc');
  const moreBtn = document.getElementById('mVmenuMore');
  if (descEl) {
    descEl.classList.remove('expanded');
    if (v.description === null || v.description === undefined) {
      descEl.textContent = '';
      descEl.hidden = true;
      if (moreBtn) moreBtn.hidden = true;
    } else if (v.description === '') {
      descEl.textContent = 'この動画には説明が追加されていません。';
      descEl.dataset.empty = '1';
      descEl.hidden = false;
      if (moreBtn) moreBtn.hidden = true;
    } else {
      descEl.removeAttribute('data-empty');
      descEl.textContent = v.description;
      descEl.hidden = false;
      if (moreBtn) { moreBtn.textContent = 'もっと見る'; moreBtn.hidden = false; }
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
  if (detailDateEl)   detailDateEl.textContent   = v.publishedAt ? new Date(v.publishedAt).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
  if (detailViewsEl)  detailViewsEl.textContent  = v.viewCount   ? v.viewCount.toLocaleString() + ' 回' : '';
  if (detailRatingEl) detailRatingEl.textContent = Math.round(getRating(v.id)).toLocaleString();

  // シートのtopをサムネ下端にアンカー
  const imgWrap = document.getElementById('mRsImgWrap');
  if (imgWrap) {
    wrap.style.setProperty('--desc-anchor', imgWrap.getBoundingClientRect().bottom + 'px');
  }

  // スクロール位置リセット
  const body = document.getElementById('mDescBody');
  if (body) body.scrollTop = 0;

  wrap.hidden = false;
  requestAnimationFrame(() => wrap.classList.add('open'));
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
      data: typeof t === 'function' ? t('settings-tab-sidebar') : 'データ'
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
    input.type = 'password';
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
  // ブラウザのスワイプバック（左端スワイプで戻る）を防止するためダミー履歴エントリを積む。
  // popstate が発生した場合は再度積み直して同一ページに留まる。
  history.pushState({ swipeGuard: true }, '');
  window.addEventListener('popstate', function() {
    history.pushState({ swipeGuard: true }, '');
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

  // チャンネルパネルを構築
  renderChannelPanel();

  // イベントリスナー: チャンネルパネルボタン
  document.getElementById('mChPanelBtn').addEventListener('click', openChannelPanel);
  document.getElementById('mChOverlay').addEventListener('click', closeChannelPanel);

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

  // イベントリスナー: カテゴリフィルタ
  document.querySelectorAll('.m-cat-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const cat = btn.dataset.cat;
      if (cat === state.currentCat) return;
      state.currentCat = cat;
      localStorage.setItem(LS_CAT, cat);
      document.querySelectorAll('.m-cat-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.cat === cat);
      });
      _currentVotePair = null;
      renderCurrentTab();
    });
  });

  // イベントリスナー: ボトムナビゲーション
  document.querySelectorAll('.m-nav-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  // イベントリスナー: 一覧画面ソート
  (function() {
    const bar    = document.getElementById('mListSortBar');
    const dirBtn = document.getElementById('mListSortDir');
    if (!bar) return;
    bar.addEventListener('click', e => {
      const chip = e.target.closest('.m-rs-sort-chip');
      if (chip) {
        localStorage.setItem(LS_SORT, chip.dataset.sort);
        _updateListSortUI();
        renderList();
      }
    });
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

  // イベントリスナー: リアクション画面タップ → 再生トグル またはピン差し
  document.getElementById('mRsImgWrap').addEventListener('click', e => {
    if (!_mRsCurrentVideoId) return;
    // 再生ON: タップは再生/一時停止トグル（ピン差しより優先）
    if (_mRsTransportVisible) {
      _mRsShowOverlay();
      if (!_mRsPlaying) {
        if (_mRsCurrentTime >= _mRsDuration) {
          _mRsStartPlayback();
        } else {
          _mRsPlaying   = true;
          _mRsLastRafTs = null;
          _mRsRafId = requestAnimationFrame(_mRsTickFn);
          _mRsUpdatePlayBtnUI();
        }
      } else {
        if (_mRsRafId) { cancelAnimationFrame(_mRsRafId); _mRsRafId = null; }
        _mRsPlaying   = false;
        _mRsLastRafTs = null;
        _mRsUpdatePlayBtnUI();
      }
      return;
    }
    // ピンモードはpointerdownハンドラで処理するためclickでは何もしない
  });

  // イベントリスナー: ピン差し（pointerdown/move/up でドラッグ追従）
  (function() {
    const imgWrap = document.getElementById('mRsImgWrap');
    function _pinCoords(e) {
      const r = imgWrap.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
        y: Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height)),
      };
    }
    function _finishPin(x, y) {
      _mRsMyPins[_mRsCurrentVideoId] = { x, y };
      mRsShowMyPin(x, y, true);
      fetch('/api/pins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: _mRsCurrentVideoId, session_id: _mRsSessionId, x, y }),
      }).catch(() => {});
      mRsRenderPlaylist();
    }
    imgWrap.addEventListener('pointerdown', e => {
      if (!_mRsCurrentVideoId || _mRsTransportVisible || !_mRsPinsVisible) return;
      const { x, y } = _pinCoords(e);
      _mRsPinDragging = true;
      _mRsPinDragId   = e.pointerId;
      imgWrap.setPointerCapture(e.pointerId);
      _mRsMovePinDrag(x, y);
      e.preventDefault();
    }, { passive: false });
    imgWrap.addEventListener('pointermove', e => {
      if (!_mRsPinDragging || e.pointerId !== _mRsPinDragId) return;
      const { x, y } = _pinCoords(e);
      _mRsMovePinDrag(x, y);
      e.preventDefault();
    }, { passive: false });
    imgWrap.addEventListener('pointerup', e => {
      if (!_mRsPinDragging || e.pointerId !== _mRsPinDragId) return;
      _mRsPinDragging = false;
      _mRsPinDragId   = null;
      const { x, y } = _pinCoords(e);
      _finishPin(x, y);
      e.preventDefault();
    }, { passive: false });
    imgWrap.addEventListener('pointercancel', e => {
      if (e.pointerId !== _mRsPinDragId) return;
      _mRsPinDragging = false;
      _mRsPinDragId   = null;
    });
  })();

  // イベントリスナー: ピン表示切り替え（表示のみ。ループ・再生の再初期化なし）
  document.getElementById('mRsPinsBtn').addEventListener('click', () => {
    _mRsPinsVisible = !_mRsPinsVisible;
    document.getElementById('mRsPinsBtn').classList.toggle('active', _mRsPinsVisible);
    const pinsLayer   = document.getElementById('mRsPinsLayer');
    if (pinsLayer) pinsLayer.style.visibility = _mRsPinsVisible ? '' : 'hidden';
    const myPin       = document.getElementById('mRsMyPin');
    const myPinShadow = document.getElementById('mRsMyPinShadow');
    if (!_mRsPinsVisible) {
      if (myPin)       myPin.hidden = true;
      if (myPinShadow) myPinShadow.hidden = true;
    } else if (_mRsCurrentVideoId) {
      // 自分のピンをその場に再表示（落下アニメーションなし）
      const saved = _mRsMyPins[_mRsCurrentVideoId];
      if (saved) mRsShowMyPin(saved.x, saved.y, false);
    }
  });

  // イベントリスナー: ヒートマップ切り替え
  document.getElementById('mRsHeatmapBtn').addEventListener('click', () => {
    _mRsHeatmapVisible = !_mRsHeatmapVisible;
    document.getElementById('mRsHeatmapBtn').classList.toggle('active', _mRsHeatmapVisible);
    const hmLayer = document.getElementById('mRsHeatmapLayer');
    if (!hmLayer) return;
    if (_mRsHeatmapVisible) {
      hmLayer.style.visibility = 'visible';
      hmLayer.style.opacity    = '1';
      mRsRenderHeatmap();
    } else {
      hmLayer.style.opacity    = '0';
      hmLayer.style.visibility = 'hidden';
    }
  });

  // イベントリスナー: トランスポート表示切り替え
  document.getElementById('mRsTransportBtn').addEventListener('click', () => {
    _mRsTransportVisible = !_mRsTransportVisible;
    document.getElementById('mRsTransportBtn').classList.toggle('active', _mRsTransportVisible);
    const seek = document.getElementById('mRsSeek');
    if (seek) {
      seek.hidden = !_mRsTransportVisible;
      seek.classList.remove('faded');
    }
    if (_mRsSeekFadeTimer) { clearTimeout(_mRsSeekFadeTimer); _mRsSeekFadeTimer = null; }
    if (_mRsTransportVisible) {
      _mRsShowOverlay();
    } else {
      _mRsHideOverlay();
    }
    if (_mRsCurrentVideoId) {
      if (_mRsTransportVisible) {
        // シーク位置を保持したまま初期化（自動再生なし）
        var savedTime = _mRsCurrentTime;
        _mRsStartPlayback();
        _mRsPlaying = false;
        if (_mRsRafId) { cancelAnimationFrame(_mRsRafId); _mRsRafId = null; }
        _mRsUpdatePlayBtnUI();
        if (savedTime > 0 && savedTime < _mRsDuration) {
          _mRsSeekTo(savedTime);
        } else if (_mRsPinsVisible) {
          mRsStartLoop(); // ピンをリストア（時間0または終端の場合はループアニメーションで復元）
        }
      } else {
        // トランスポートOFF: RAFを止めてピンONなら通常ループに戻す
        if (_mRsRafId) { cancelAnimationFrame(_mRsRafId); _mRsRafId = null; }
        _mRsPlaying = false;
        if (_mRsPinsVisible) mRsStartLoop();
      }
    }
  });

  // イベントリスナー: カラースウォッチ
  document.querySelectorAll('.m-rs-swatch').forEach(btn => {
    const color = btn.dataset.color;
    if (color === _mRsPinColor) {
      document.querySelectorAll('.m-rs-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    }
    btn.addEventListener('click', e => {
      e.stopPropagation();
      document.querySelectorAll('.m-rs-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _mRsPinColor = color;
      localStorage.setItem('reactions-pin-color', color);
      mRsApplyPalette();
      if (_mRsHeatmapVisible) mRsRenderHeatmap();
      // プレイリストのピンドットの色だけインライン更新（全再描画なし）
      document.querySelectorAll('.m-meta-pin-dot').forEach(el => { el.style.background = color; });
    });
  });

  // イベントリスナー: 最大ピン数セグメント
  (function() {
    const seg = document.getElementById('mRsPinCountSegment');
    if (!seg) return;
    const vals = [1, 5, 10, 20, 30];
    const nearest = vals.reduce((a, b) => Math.abs(b - _mRsMaxPins) < Math.abs(a - _mRsMaxPins) ? b : a);
    _mRsMaxPins = nearest;
    seg.querySelectorAll('.m-rs-seg-btn').forEach(btn => {
      btn.classList.toggle('active', parseInt(btn.dataset.value, 10) === nearest);
    });
    seg.addEventListener('click', e => {
      e.stopPropagation();
      const btn = e.target.closest('.m-rs-seg-btn');
      if (!btn) return;
      seg.querySelectorAll('.m-rs-seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _mRsMaxPins = parseInt(btn.dataset.value, 10);
      localStorage.setItem(LS_RS_MAX_PINS, _mRsMaxPins);
      if (_mRsPinsVisible && _mRsCurrentVideoId) {
        if (_mRsTransportVisible) _mRsSeekTo(_mRsCurrentTime);
        else mRsStartLoop();
      }
    });
  })();

  // イベントリスナー: 設定パネル開閉
  document.getElementById('mRsSettingsPanelBtn').addEventListener('click', e => {
    e.stopPropagation();
    var panel = document.getElementById('mRsSettingsPanel');
    var open = panel.classList.toggle('open');
    document.getElementById('mRsSettingsPanelBtn').classList.toggle('open', open);
  });

  // イベントリスナー: 時間表示トグル
  (function() {
    var toggle = document.getElementById('mRsTimeToggle');
    if (!toggle) return;
    toggle.classList.toggle('on', _mRsShowSeekTime);
    toggle.setAttribute('aria-checked', String(_mRsShowSeekTime));
    toggle.addEventListener('click', e => {
      e.stopPropagation();
      _mRsShowSeekTime = !_mRsShowSeekTime;
      localStorage.setItem(LS_RS_SHOW_TIME, _mRsShowSeekTime);
      toggle.classList.toggle('on', _mRsShowSeekTime);
      toggle.setAttribute('aria-checked', String(_mRsShowSeekTime));
      var timeEl = document.getElementById('mRsSeekTime');
      if (timeEl) timeEl.classList.toggle('visible', _mRsShowSeekTime);
    });
  })();

  // イベントリスナー: プログレスバー（タッチ・マウス共通）
  // seekDiv 全体（パディング含む）をヒット領域にし、端でノブが隠れないようにする
  (function() {
    const seekDiv = document.getElementById('mRsSeek');
    const track   = document.getElementById('mRsProgressTrack');
    if (!seekDiv || !track) return;
    let _dragging = false;
    let _lastSeekX = 0;
    function _calcPct(clientX) {
      const r = track.getBoundingClientRect();
      return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    }
    function _seekFull(clientX) {
      if (_mRsDuration <= 0) return;
      _mRsSeekTo(_calcPct(clientX) * _mRsDuration);
    }
    function _seekVisual(clientX) {
      // ドラッグ中はプログレスUIのみ更新（ピン再描画なし）
      if (_mRsDuration <= 0) return;
      _mRsCurrentTime = _calcPct(clientX) * _mRsDuration;
      _mRsUpdateProgressUI();
    }
    // passive:false で touchstart を止める → Chrome モバイルの左端スワイプバック防止
    seekDiv.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
    seekDiv.addEventListener('pointerdown', e => {
      if (e.target.closest('button')) return;  // ボタンタップはシーク開始しない
      // ヒット判定をプログレストラック周辺（上下14px）に限定
      var tr = track.getBoundingClientRect();
      if (e.clientY < tr.top - 14 || e.clientY > tr.bottom + 14) return;
      // フェードタイマーをキャンセルし表示を維持
      if (_mRsSeekFadeTimer) { clearTimeout(_mRsSeekFadeTimer); _mRsSeekFadeTimer = null; }
      var seekEl = document.getElementById('mRsSeek');
      if (seekEl) seekEl.classList.remove('faded');
      // 再生中なら一時停止
      if (_mRsPlaying) {
        _mRsPlaying = false;
        if (_mRsRafId) { cancelAnimationFrame(_mRsRafId); _mRsRafId = null; }
        _mRsUpdatePlayBtnUI();
      }
      _dragging = true;
      _lastSeekX = e.clientX;
      track.classList.add('dragging');
      seekDiv.setPointerCapture(e.pointerId);
      _seekFull(e.clientX);  // タップ時は即時フル更新
      _mRsShowOverlay();
      e.preventDefault();
      e.stopPropagation();
    });
    seekDiv.addEventListener('pointermove', e => {
      if (_dragging) { _lastSeekX = e.clientX; _seekVisual(e.clientX); }
    });
    seekDiv.addEventListener('pointerup', () => {
      if (_dragging) {
        _dragging = false;
        track.classList.remove('dragging');
        _seekFull(_lastSeekX);  // ドラッグ終了時にピン等を確定描画
        _mRsShowOverlay();
      }
    });
    seekDiv.addEventListener('pointercancel', () => { _dragging = false; track.classList.remove('dragging'); });
  })();

  // イベントリスナー: トランスポートオーバーレイボタン
  document.getElementById('mRsPrevBtn').addEventListener('click', e => {
    e.stopPropagation();
    _mRsPlayPrev();
    _mRsShowOverlay();
  });
  document.getElementById('mRsPlayBtn').addEventListener('click', e => {
    e.stopPropagation();
    if (!_mRsCurrentVideoId) return;
    // フェードタイマーをキャンセルし表示を復元
    if (_mRsSeekFadeTimer) { clearTimeout(_mRsSeekFadeTimer); _mRsSeekFadeTimer = null; }
    var seekEl2 = document.getElementById('mRsSeek');
    if (seekEl2) seekEl2.classList.remove('faded');
    if (!_mRsPlaying) {
      if (_mRsCurrentTime >= _mRsDuration) {
        _mRsStartPlayback();
      } else {
        _mRsPlaying   = true;
        _mRsLastRafTs = null;
        _mRsRafId = requestAnimationFrame(_mRsTickFn);
        _mRsUpdatePlayBtnUI();
      }
    } else {
      if (_mRsRafId) { cancelAnimationFrame(_mRsRafId); _mRsRafId = null; }
      _mRsPlaying   = false;
      _mRsLastRafTs = null;
      _mRsUpdatePlayBtnUI();
    }
    _mRsShowOverlay();
  });
  document.getElementById('mRsNextBtn').addEventListener('click', e => {
    e.stopPropagation();
    _mRsPlayNext();
    _mRsShowOverlay();
  });
  // フルスクリーン変更時のボタンアイコン更新（webkit prefix 対応）
  ['fullscreenchange', 'webkitfullscreenchange'].forEach(evName => {
    document.addEventListener(evName, function() {
      var btn = document.getElementById('mRsFullscreenBtn');
      if (!btn) return;
      btn.innerHTML = (document.fullscreenElement || document.webkitFullscreenElement)
        ? _M_SVG_FULLSCREEN_EXIT
        : _M_SVG_FULLSCREEN;
    });
  });

  // イベントリスナー: ソートセクション（設定パネル内）
  (function() {
    const section = document.getElementById('mRsSortSection');
    if (!section) return;
    section.addEventListener('click', e => {
      const chip = e.target.closest('.m-rs-sort-chip');
      if (!chip) return;
      _mRsSortOrder = chip.dataset.sort;
      localStorage.setItem(LS_RS_SORT, _mRsSortOrder);
      _mRsUpdateSortUI();
      mRsRenderPlaylist();
    });
  })();
  document.getElementById('mRsSortDir').addEventListener('click', () => {
    _mRsSortDir = _mRsSortDir === 'desc' ? 'asc' : 'desc';
    localStorage.setItem(LS_RS_SORT_DIR, _mRsSortDir);
    _mRsUpdateSortUI();
    mRsRenderPlaylist();
  });

  // イベントリスナー: 設定ボタン
  document.getElementById('mSettingsBtn').addEventListener('click', openSettings);
  document.getElementById('mSettingsClose').addEventListener('click', closeSettings);

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
    this.textContent = _mVmenuDescExpanded ? '閉じる' : 'もっと見る';
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
      showToast('URLをコピーしました');
    }).catch(() => {
      showToast('コピーに失敗しました', true);
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
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // 設定モーダル: APIキー 保存
  document.getElementById('mApikeySave').addEventListener('click', function() {
    const input = document.getElementById('mApikeyInput');
    const statusEl = document.getElementById('mApikeyStatus');
    const val = input.value.trim();
    if (val) {
      localStorage.setItem(LS_API_KEY, val);
    } else {
      localStorage.removeItem(LS_API_KEY);
    }
    const delBtn = document.getElementById('mApikeyDelete');
    if (delBtn) delBtn.hidden = !val;
    if (statusEl) {
      statusEl.textContent = typeof t === 'function' ? t('settings-apikey-saved') : '保存しました';
      statusEl.style.color = 'var(--ok)';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    }
  });

  // 設定モーダル: APIキー 削除
  document.getElementById('mApikeyDelete').addEventListener('click', function() {
    localStorage.removeItem(LS_API_KEY);
    const input = document.getElementById('mApikeyInput');
    if (input) input.value = '';
    this.hidden = true;
    const statusEl = document.getElementById('mApikeyStatus');
    if (statusEl) {
      statusEl.textContent = typeof t === 'function' ? t('settings-apikey-deleted') : '削除しました';
      statusEl.style.color = 'var(--text-muted)';
      setTimeout(() => { statusEl.textContent = ''; }, 2000);
    }
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
  var _initSeekTimeEl = document.getElementById('mRsSeekTime');
  if (_initSeekTimeEl) _initSeekTimeEl.classList.toggle('visible', _mRsShowSeekTime);
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

  // 前回のチャンネルを復元
  const lastChannel = localStorage.getItem('m-last-channel');
  if (lastChannel && channels[lastChannel]) {
    selectChannel(lastChannel);
  }
});
