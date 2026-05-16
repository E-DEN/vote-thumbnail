// ---
const BASE = 'https://www.googleapis.com/youtube/v3';

// --- トースト通知 ---
function showToast(msg, isError) {
  const container = document.getElementById('app-toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'app-toast ' + (isError ? 'err' : 'ok');
  const remove = function() { toast.classList.add('out'); setTimeout(function() { toast.remove(); }, 320); };
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
const LS_RATING = 'thumb-ranking-elo';
const LS_VIDEOS = 'thumb-ranking-videos';
const LS_CHANNELS = 'thumb-ranking-channels';
const LS_SIDEBAR_ORDER = 'thumb-sidebar-order';
const LS_API_KEY  = 'yt-api-key';
const LS_RSS_ONLY = 'yt-rss-only';
const LS_CAT      = 'thumb-cat';
const LS_VIEW     = 'thumb-view';
const LS_VOTE_PAIR = 'thumb-vote-pair';
const LS_SORT = 'thumb-sort';
const LS_MAX_PINS       = 'thumb-max-pins';
const LS_PINS_VISIBLE   = 'thumb-pins-visible';
const LS_HEATMAP_VISIBLE = 'thumb-heatmap-visible';
const LS_SETTINGS_TAB   = 'thumb-settings-tab';

function getStoredApiKey() { return localStorage.getItem(LS_API_KEY) || ''; }
function getRssOnly() { return localStorage.getItem(LS_RSS_ONLY) === '1'; }
let _apiKeyErrorState = false;
function markApiKeyError() {
  _apiKeyErrorState = true;
  const ind = document.getElementById('apikeyIndicator');
  if (ind) ind.style.background = 'var(--err)';
  const badge = document.getElementById('apikeyNavBadge');
  if (badge) badge.hidden = false;
}
function apiKeyHeaders() {
  const k = getStoredApiKey();
  return k ? { 'X-YouTube-Api-Key': k } : {};
}

let allVideos = [];
let currentCat = localStorage.getItem(LS_CAT) || 'videos';
let currentView = 'welcome';
let _prevView = 'list';
let _pollTimer = null;
let ratingData = {};
let voteTotal = 0;
let channels = {};
let currentChannelKey = null;
let sidebarOrder = [];
let _chTooltip = null;
let _chTooltipNameEl = null;
let _chTooltipActionsEl = null;
let _chTooltipHideTimer = null;
let _chTooltipOutsideHandler = null;
let _chTooltipLocked = false;
let _chTooltipGearEscHandler = null;
let _chTooltipF2Action = null;
let _shiftHeld = false;
const _refreshingKeys = new Set();

// --- ReactionPin グローバル状態 ---
var _reactionsSessionId = (function() {
  let id = localStorage.getItem('thumb-session-id');
  if (!id) {
    id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    localStorage.setItem('thumb-session-id', id);
  }
  return id;
})();
let _reactionsCurrentVideoId = null;
let _reactionsActive = false;     // 投下ストリーム制御フラグ
let _reactionsPinsVisible    = localStorage.getItem(LS_PINS_VISIBLE) !== '0';
let _reactionsHeatmapVisible = localStorage.getItem(LS_HEATMAP_VISIBLE) === '1';
let _reactionsSeeds = [];
let _reactionsPins  = [];       // DB全ピン座標 (KDEサンプリング用)
let _reactionsKde   = null;     // KDE重みキャッシュ
let _reactionsMyPins = {};      // videoId → { x, y }
let _myPinOnDrop    = null;     // animationend リスナー参照（重複登録防止）
let _reactionsStartPlayback = null; // Transport IIFE から注入
let _reactionsStopPlayback  = null; // Transport IIFE から注入: RAFループを即停止
let _reactionsResetTransport = null; // Transport IIFE から注入: トランスポートを初期状態にリセット
let _reactionsAdjustPins    = null; // Transport IIFE から注入: ピン表示数を再アニメなしで増減
let _reactionsRestoreMyPin  = null; // Transport IIFE から注入: 現在時刻に応じてあなたピンを復元
let _reactionsSetVolFromPins = null; // Transport IIFE から注入: ピン数→vol変換してUIを更新
let _isPlaylistSwitch = false; // 再生リストからの切り替えかどうか
const PIN_SNAPS = [0, 1, 5, 10, 15, 20, 25, 30]; // スナップ値: 1=あなたピンのみ表示
let _reactionsPinColor  = localStorage.getItem('reactions-pin-color')  || '#ec4899';

// ピンカラーパレット（各色につき3段階シェード）
const PIN_PALETTES = {
  '#ec4899': ['#ec4899', '#f472b6', '#db2777'],  // pink:   400→600
  '#00b0f4': ['#00b0f4', '#38bdf8', '#0284c7'],  // sky:    400→600
  '#57f287': ['#57f287', '#4ade80', '#16a34a'],  // green:  400→600
  '#f59e0b': ['#f59e0b', '#fbbf24', '#d97706'],  // amber:  400→600
  '#a855f7': ['#a855f7', '#c084fc', '#9333ea'],  // purple: 400→600
};

let DROP_HEIGHT  = 55;    // px: ピン落下高さ
let DROP_SPEED   = 1.5;   // s: 落下アニメーション時間
const FADE_IN_FRAC = 0.05;  // Web Animations フェードイン開始割合

function applyPinPalette() {
  const wrap = document.getElementById('reactionsImgWrap');
  if (!wrap) return;
  const palette = PIN_PALETTES[_reactionsPinColor] || PIN_PALETTES['#ec4899'];
  wrap.style.setProperty('--pin-c0', palette[0]);
  wrap.style.setProperty('--pin-c1', palette[1]);
  wrap.style.setProperty('--pin-c2', palette[2]);
}

// KDE 重み計算（bandwidth=0.07）
function reactionsComputeKde(pins) {
  const n = pins.length;
  if (n < 2) return null;
  const bw2 = 0.07 * 0.07;
  const noiseFloor = 0.15;
  const w = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = pins[i].x - pins[j].x;
      const dy = pins[i].y - pins[j].y;
      w[i] += Math.exp(-(dx * dx + dy * dy) / (2 * bw2));
    }
  }
  const maxW = Math.max.apply(null, w) || 1;
  const cum  = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += w[i] / maxW + noiseFloor;
    cum[i] = acc;
  }
  return { cum, total: acc };
}

// KDE重み付きルーレットサンプリング → 実ピン座標を返す
function reactionsSampleFromKde() {
  if (!_reactionsKde || _reactionsPins.length === 0) return null;
  const r   = Math.random() * _reactionsKde.total;
  const cum = _reactionsKde.cum;
  let lo = 0, hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] < r) lo = mid + 1; else hi = mid;
  }
  return _reactionsPins[lo];
}

// --- Glicko-2 レーティング ---
const G2_TAU   = 0.5;
const G2_SCALE = 173.7178;

function g2Init() {
  return { rating: 1500, rd: 350, volatility: 0.06, wins: 0, battles: 0 };
}

function getRating(id)  { return ratingData[id]?.rating   ?? 1500; }
function getRd(id)      { return ratingData[id]?.rd        ?? 350; }
function getBattles(id) { return ratingData[id]?.battles   ?? 0; }
function getWins(id)    { return ratingData[id]?.wins      ?? 0; }

function g2Update(player, opponent, score) {
  const mu    = (player.rating - 1500) / G2_SCALE;
  const phi   = player.rd / G2_SCALE;
  const sigma = player.volatility;
  const muJ   = (opponent.rating - 1500) / G2_SCALE;
  const phiJ  = opponent.rd / G2_SCALE;

  const gPhiJ = 1 / Math.sqrt(1 + 3 * phiJ * phiJ / (Math.PI * Math.PI));
  const E     = 1 / (1 + Math.exp(-gPhiJ * (mu - muJ)));
  const v     = 1 / (gPhiJ * gPhiJ * E * (1 - E));
  const delta = v * gPhiJ * (score - E);

  // ボラティリティ更新（Illinois アルゴリズム）
  const a = Math.log(sigma * sigma);
  const f = x => {
    const ex = Math.exp(x);
    const d2 = phi * phi + v + ex;
    return (ex * (delta * delta - d2)) / (2 * d2 * d2) - (x - a) / (G2_TAU * G2_TAU);
  };
  let A = a;
  let B = delta * delta > phi * phi + v
    ? Math.log(delta * delta - phi * phi - v)
    : (() => { let k = 1; while (f(a - k * G2_TAU) < 0) k++; return a - k * G2_TAU; })();
  let fA = f(A), fB = f(B);
  for (let i = 0; Math.abs(B - A) > 1e-6 && i < 100; i++) {
    const C = A + (A - B) * fA / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else { fA /= 2; }
    B = C; fB = fC;
  }
  const sigmaPrime = Math.exp(A / 2);
  const phiStar    = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime   = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime    = mu + phiPrime * phiPrime * gPhiJ * (score - E);

  return {
    rating:     G2_SCALE * muPrime + 1500,
    rd:         G2_SCALE * phiPrime,
    volatility: sigmaPrime,
  };
}

function applyVote(winnerId, loserId) {
  // ローカルを楽観的に更新（即時UI反映用）
  if (!ratingData[winnerId]) ratingData[winnerId] = g2Init();
  if (!ratingData[loserId])  ratingData[loserId]  = g2Init();
  const w = ratingData[winnerId];
  const l = ratingData[loserId];
  const wUp = g2Update(w, l, 1);
  const lUp = g2Update(l, w, 0);
  ratingData[winnerId] = { ...wUp, wins: w.wins + 1, battles: w.battles + 1 };
  ratingData[loserId]  = { ...lUp, wins: l.wins,     battles: l.battles + 1 };
  saveRating();
  voteTotal++;
  document.getElementById('voteCount').textContent = voteTotal;
  updatePaceGauge();

  // サーバーへ送信してグローバル統計を更新
  if (currentChannelKey) {
    fetch('/api/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ winner_id: winnerId, loser_id: loserId, channel_id: currentChannelKey }),
    }).then(function(res) {
      if (!res.ok) return;
      return res.json();
    }).then(function(data) {
      if (!data || !data.ok) return;
      // サーバー計算値でローカルを上書き（全ユーザーの投票が反映された値）
      if (data.winner) {
        ratingData[winnerId] = {
          rating: data.winner.rating, rd: data.winner.rd, volatility: data.winner.volatility,
          wins: (ratingData[winnerId]?.wins ?? 0), battles: (ratingData[winnerId]?.battles ?? 0),
        };
      }
      if (data.loser) {
        ratingData[loserId] = {
          rating: data.loser.rating, rd: data.loser.rd, volatility: data.loser.volatility,
          wins: (ratingData[loserId]?.wins ?? 0), battles: (ratingData[loserId]?.battles ?? 0),
        };
      }
      saveRating();
    }).catch(function() { /* サイレント失敗 */ });
  }
}

function saveRating() {
  localStorage.setItem(LS_RATING, JSON.stringify({ ratingData, voteTotal }));
}

// --- API動画ヘルパー ---
// サーバーレスポンスをフロントエンドの allVideos 形式に変換
function apiVideoToFrontend(v) {
  return {
    id:          v.video_id,
    title:       v.title,
    thumb:       v.thumbnail_url,
    category:    v.category,
    url:         'https://www.youtube.com/watch?v=' + v.video_id,
    viewCount:   v.view_count  ?? 0,
    publishedAt: v.published_at ?? '',
    duration:    v.duration    ?? 0,
  };
}

// サーバーレスポンスから ratingData を更新
function updateRatingFromApi(apiVideos) {
  for (const v of apiVideos) {
    ratingData[v.video_id] = {
      rating:     v.rating,
      rd:         v.rd,
      volatility: v.volatility,
      wins:       v.wins,
      battles:    v.battles,
    };
  }
}

// チャンネルの全動画を取得して allVideos と ratingData を更新する
async function fetchChannelVideos(channelId) {
  const res = await fetch('/api/channels/' + channelId + '/videos');
  if (!res.ok) throw new Error('videos fetch failed: ' + res.status);
  const apiVideos = await res.json();
  updateRatingFromApi(apiVideos);
  return apiVideos.map(apiVideoToFrontend);
}

// list/ranking 表示中に 1 分ごとサーバーから動画を再取得して再描画する
async function _pollRefresh() {
  if (!currentChannelKey) return;
  if (currentView !== 'list' && currentView !== 'ranking') return;
  try {
    allVideos = await fetchChannelVideos(currentChannelKey);
    if (currentView === 'list') renderList();
    else if (currentView === 'ranking') renderRanking();
  } catch { /* サイレント失敗 */ }
}

function loadRating() {
  const raw = localStorage.getItem(LS_RATING);
  if (!raw) return;
  const d = JSON.parse(raw);
  const raw2 = d.ratingData ?? d['eloData'] ?? {};
  // 旧Eloデータ（.elo フィールド）をGlicko-2形式に移行
  ratingData = Object.fromEntries(Object.entries(raw2).map(([id, v]) => [
    id,
    v.rating != null ? v : { ...g2Init(), rating: v.elo ?? 1500, wins: v.wins ?? 0, battles: v.battles ?? 0 },
  ]));
  voteTotal = d.voteTotal ?? 0;
  document.getElementById('voteCount').textContent = voteTotal;
}

// --- チャンネルストレージ ---
function channelKeyFromUrl(url) {
  const m = url.match(/@([\w.-]+)/);
  if (m) return m[1].toLowerCase();
  const mi = url.match(/UC([\w-]+)/);
  if (mi) return 'UC' + mi[1];
  return url.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20) || 'channel';
}
function loadChannels() {
  const raw = localStorage.getItem(LS_CHANNELS);
  channels = raw ? JSON.parse(raw) : {};
}
function saveChannels() {
  try { localStorage.setItem(LS_CHANNELS, JSON.stringify(channels)); } catch {}
}
function loadSidebarOrder() {
  const raw = localStorage.getItem(LS_SIDEBAR_ORDER);
  sidebarOrder = raw ? JSON.parse(raw) : [];
}
function saveSidebarOrder() {
  try { localStorage.setItem(LS_SIDEBAR_ORDER, JSON.stringify(sidebarOrder)); } catch {}
}
function syncSidebarOrder() {
  const known = new Set(Object.keys(channels));
  // Remove entries for deleted channels
  sidebarOrder = sidebarOrder.filter(item => {
    if (item.type === 'channel') return known.has(item.key);
    if (item.type === 'folder') {
      item.children = item.children.filter(k => known.has(k));
      return item.children.length > 0;
    }
    return false;
  });
  // Dissolve single-child folders
  sidebarOrder = sidebarOrder.map(item =>
    (item.type === 'folder' && item.children.length === 1)
      ? { type: 'channel', key: item.children[0] } : item
  );
  // Add any channels not yet in order
  const inOrder = new Set();
  sidebarOrder.forEach(item => {
    if (item.type === 'channel') inOrder.add(item.key);
    else if (item.type === 'folder') item.children.forEach(k => inOrder.add(k));
  });
  Object.keys(channels).forEach(k => {
    if (!inOrder.has(k)) sidebarOrder.push({ type: 'channel', key: k });
  });
}
function saveVideosForChannel(key, videos) {
  try { localStorage.setItem(LS_VIDEOS + '_' + key, JSON.stringify(videos)); } catch {}
}
function loadVideosForChannel(key) {
  const raw = localStorage.getItem(LS_VIDEOS + '_' + key);
  return raw ? JSON.parse(raw) : null;
}

// --- API ヘルパー ---
async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const e = new Error(body.error?.message ?? res.status);
    if (res.status === 400 || res.status === 403) e.code = 'API_KEY_INVALID';
    throw e;
  }
  return res.json();
}

function parseChannel(url) {
  const mHandle = url.match(/@([\w.-]+)/);
  if (mHandle) return { type: 'handle', value: mHandle[1] };
  const mId = url.match(/channel\/(UC[\w-]+)/);
  if (mId) return { type: 'id', value: mId[1] };
  return null;
}

// 動画URLから動画IDを抜く
function parseVideoId(url) {
  const mWatch = url.match(/[?&]v=([\w-]{11})/);
  if (mWatch) return mWatch[1];
  const mShort = url.match(/youtu\.be\/([\w-]{11})/);
  if (mShort) return mShort[1];
  const mShorts = url.match(/\/shorts\/([\w-]{11})/);
  if (mShorts) return mShorts[1];
  return null;
}

// 動画ID → チャンネルIDを取得
async function getChannelIdFromVideo(apiKey, videoId) {
  const params = new URLSearchParams({ part: 'snippet', id: videoId, key: apiKey });
  const data = await apiFetch(`${BASE}/videos?${params}`);
  const channelId = data.items?.[0]?.snippet?.channelId;
  if (!channelId) throw new Error('動画が見つかりませんでした');
  return channelId;
}

async function getUploadsPlaylistId(apiKey, channel) {
  const params = new URLSearchParams({ part: 'contentDetails,snippet', key: apiKey });
  if (channel.type === 'handle') params.set('forHandle', channel.value);
  else params.set('id', channel.value);
  const data = await apiFetch(`${BASE}/channels?${params}`);
  const item = data.items?.[0];
  if (!item) throw new Error('チャンネルが見つかりませんでした');
  return {
    playlistId:  item.contentDetails.relatedPlaylists.uploads,
    channelName: item.snippet.title ?? '',
    channelId:   item.id ?? '',
    avatar:      item.snippet.thumbnails?.default?.url ?? item.snippet.thumbnails?.medium?.url ?? '',
  };
}

async function getAllVideoIds(apiKey, playlistId, onProgress) {
  const ids = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ part: 'contentDetails', playlistId, maxResults: 50, key: apiKey });
    if (pageToken) params.set('pageToken', pageToken);
    const res = await fetch(`${BASE}/playlistItems?${params}`);
    if (!res.ok) {
      // 404 = プレイリストが空または非公開 → 0件として正常扱い
      if (res.status === 404) break;
      const body = await res.json().catch(() => ({}));
      const e = new Error(body.error?.message ?? String(res.status));
      if (res.status === 400 || res.status === 403) e.code = 'API_KEY_INVALID';
      throw e;
    }
    const data = await res.json();
    for (const item of data.items ?? []) ids.push(item.contentDetails.videoId);
    pageToken = data.nextPageToken ?? '';
    onProgress(ids.length, data.pageInfo?.totalResults ?? 0);
  } while (pageToken);
  return ids;
}

function parseDurationSec(iso) {
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] ?? 0) * 3600) + (parseInt(m[2] ?? 0) * 60) + parseInt(m[3] ?? 0);
}

async function getVideoDetails(apiKey, videoIds, onProgress) {
  const results = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const params = new URLSearchParams({ part: 'snippet,contentDetails,liveStreamingDetails,statistics', id: batch.join(','), key: apiKey });
    const data = await apiFetch(`${BASE}/videos?${params}`);
    for (const v of data.items ?? []) {
      const dur = parseDurationSec(v.contentDetails.duration);
      const isLive = !!v.liveStreamingDetails;
      const isShort = !isLive && dur <= 180;
      const category = isLive ? 'live' : isShort ? 'shorts' : 'videos';
      const thumbs = v.snippet.thumbnails;
      const thumb = thumbs.maxres?.url ?? thumbs.standard?.url ?? thumbs.high?.url ?? thumbs.medium?.url ?? '';
      results.push({
        id: v.id,
        title: v.snippet.title,
        thumb,
        category,
        url: `https://www.youtube.com/watch?v=${v.id}`,
        viewCount: parseInt(v.statistics?.viewCount ?? 0),
        publishedAt: v.snippet.publishedAt ?? '',
        duration: dur,
      });
    }
    onProgress(Math.min(i + 50, videoIds.length), videoIds.length);
  }
  return results;
}

// --- YouTube API で全動画を取得してサーバーに一括保存 ---
async function importAllChannelVideos(channelId, onStatus) {
  const apiKey = getStoredApiKey();
  if (!apiKey) throw new Error('API キーが設定されていません（設定 > API Key）');

  onStatus('プレイリスト ID を取得中...');
  const { playlistId } = await getUploadsPlaylistId(apiKey, { type: 'id', value: channelId });

  onStatus('動画 ID を取得中 (0 件)...');
  const videoIds = await getAllVideoIds(apiKey, playlistId, (done, total) => {
    onStatus('動画 ID を取得中 (' + done + ' / ' + total + ' 件)...');
  });

  onStatus('動画情報を取得中 (0 / ' + videoIds.length + ' 件)...');
  const videos = await getVideoDetails(apiKey, videoIds, (done, total) => {
    onStatus('動画情報を取得中 (' + done + ' / ' + total + ' 件)...');
  });

  const BATCH = 200;
  for (let i = 0; i < videos.length; i += BATCH) {
    const chunk = videos.slice(i, i + BATCH);
    onStatus('サーバーに保存中 (' + Math.min(i + BATCH, videos.length) + ' / ' + videos.length + ' 件)...');
    const res = await fetch('/api/channels/' + channelId + '/videos/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videos: chunk }),
    });
    if (!res.ok) throw new Error('保存エラー: ' + res.status);
  }
  return videos.length;
}

// --- チャンネルデータをアプリにロード ---
function loadChannelVideos(key) {
  const videos = loadVideosForChannel(key);
  if (!videos?.length) return false;
  allVideos = videos;
  const counts = { videos: 0, shorts: 0, live: 0 };
  allVideos.forEach(v => { if (counts[v.category] !== undefined) counts[v.category]++; });
  currentCat = counts.live >= counts.videos && counts.live >= counts.shorts ? 'live'
             : counts.shorts > counts.videos ? 'shorts' : 'videos';
  document.querySelectorAll('.cat-seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === currentCat);
  });
  return true;
}

// --- カテゴリフィルタ ---
function filteredVideos() {
  return allVideos.filter(v => v.category === currentCat);
}

// --- 投票 ---
// RDが高い（対戦数が少ない）サムネを優先的に選出
// RDがこの値以下なら「評価確定」= 両者確定のペアは再戦不要
const G2_SETTLED_RD = 80;

function pickPair() {
  const pool = filteredVideos();
  if (pool.length < 2) return null;

  // 候補リスト: 少なくとも一方が未確定 かつ このセッションで未対戦
  function buildCandidates() {
    const list = [];
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        if (getRd(pool[i].id) <= G2_SETTLED_RD && getRd(pool[j].id) <= G2_SETTLED_RD) continue;
        if (_playedPairs.has(_pairKey(pool[i].id, pool[j].id))) continue;
        list.push([i, j]);
      }
    }
    return list;
  }

  let candidates = buildCandidates();
  if (candidates.length === 0) {
    // セッション内の記録をリセットして2周目へ（確定済みは引き続き除外）
    _playedPairs.clear();
    candidates = buildCandidates();
  }
  if (candidates.length === 0) return null; // 全ペア確定済み

  // 重み = 両者のRD合計（不確かなペアを優先）
  const weights = candidates.map(([i, j]) => getRd(pool[i].id) + getRd(pool[j].id));
  const totalW  = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * totalW;
  for (let k = 0; k < candidates.length; k++) {
    r -= weights[k];
    if (r <= 0) {
      const [i, j] = candidates[k];
      return [pool[i], pool[j]];
    }
  }
  const [i, j] = candidates[candidates.length - 1];
  return [pool[i], pool[j]];
}

// --- 投票ペースゲージ ---
const voteTimes = [];

const PACE_WINDOW_MS = 10000;
const PACE_LEVELS = [
  { max: 5,        labelKey: 'pace-stable',  cls: '' },
  { max: 12,       labelKey: 'pace-fast',    cls: 'pace-warm' },
  { max: Infinity, labelKey: 'pace-blazing', cls: 'pace-hot' },
];

function updatePaceGauge() {
  const now = Date.now();
  while (voteTimes.length && now - voteTimes[0] > PACE_WINDOW_MS) voteTimes.shift();
  voteTimes.push(now);
  const count = voteTimes.length;
  const level = PACE_LEVELS.find(l => count <= l.max) ?? PACE_LEVELS[PACE_LEVELS.length - 1];
  const pct = Math.min(100, Math.round(count / 12 * 100));
  const fill = document.getElementById('paceFill');
  const lbl  = document.getElementById('paceLabel');
  if (!fill || !lbl) return;
  fill.style.width = pct + '%';
  fill.className = 'vote-pace-bar-fill' + (level.cls ? ' ' + level.cls : '');
  lbl.textContent = t(level.labelKey);
}

function _loadVotePairByCat() {
  try { return JSON.parse(localStorage.getItem(LS_VOTE_PAIR)) || {}; } catch(e) { return {}; }
}
function _saveVotePairByCat(d) {
  try { localStorage.setItem(LS_VOTE_PAIR, JSON.stringify(d)); } catch(e) {}
}
var _votePairByCat = _loadVotePairByCat(); // カテゴリごとのペアキャッシュ（localStorage永続化）
var _playedPairs = new Set(); // セッション内の対戦済みペア

function _pairKey(idA, idB) {
  return idA < idB ? idA + '|' + idB : idB + '|' + idA;
}

// _currentVotePair の get/set をチャンネル+カテゴリ別に委譲
Object.defineProperty(window, '_currentVotePair', {
  get() { return _votePairByCat[(currentChannelKey || '') + ':' + currentCat] ?? null; },
  set(v) {
    const k = (currentChannelKey || '') + ':' + currentCat;
    if (v === null) { delete _votePairByCat[k]; }
    else { _votePairByCat[k] = v; }
    _saveVotePairByCat(_votePairByCat);
  },
  configurable: true,
});

// --- 傾き強度 ---
var _tiltScale = 0.5;

function renderVote() {
  // 投票後または初回のみ新ペアを抽選。画面戻りではそのまま表示。
  // リロード復元時: ペアの動画が現在のリストに存在するか検証
  if (_currentVotePair) {
    const ids = new Set(filteredVideos().map(v => v.id));
    if (!ids.has(_currentVotePair[0].id) || !ids.has(_currentVotePair[1].id)) {
      _currentVotePair = null;
    }
  }
  if (!_currentVotePair) {
    _currentVotePair = pickPair();
  }
  const pair = _currentVotePair;
  const container = document.getElementById('votePair');
  if (!pair) {
    const isSettled = filteredVideos().length >= 2;
    container.innerHTML = `<p style="color:var(--text-muted);text-align:center;grid-column:1/-1;padding:60px 0;font-size:14px;">${t(isSettled ? 'ranking-settled' : 'no-videos-in-cat')}</p>`;
    return;
  }
  const [pairA, pairB] = pair;
  container.innerHTML = '';
  [pairA, pairB].forEach((v, idx) => {
    const card = document.createElement('div');
    card.className = 'vote-card';
    card.dataset.id = v.id;
    card.innerHTML =
      '<figure class="tilter__figure">' +
        '<img class="card-banner" src="' + v.thumb + '" alt=""' +
        ' onerror="this.src=\'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg\'">' +
        '<div class="tilter__deco tilter__deco--shine"><div></div></div>' +
        '<figcaption class="tilter__caption"></figcaption>' +
      '</figure>';
    card.querySelector('.tilter__caption').textContent = v.title;

    var fig     = card.querySelector('.tilter__figure');
    var caption = card.querySelector('.tilter__caption');
    var shine   = card.querySelector('.tilter__deco--shine > div');

    var _tiltRaf = null;
    var _tiltNx = 0, _tiltNy = 0;

    card.addEventListener('mouseenter', function() {
      // 戻りアニメが進行中ならキャンセルし、CSS transitionを有効化
      anime.remove([fig, caption, shine]);
      fig.classList.add('tilt-smooth');
      caption.classList.add('tilt-smooth');
      shine.classList.add('tilt-smooth');
    });

    card.addEventListener('mousemove', function(e) {
      var rect = card.getBoundingClientRect();
      // -0.5〜0.5に正規化
      _tiltNx = (e.clientX - rect.left) / rect.width  - 0.5;
      _tiltNy = (e.clientY - rect.top)  / rect.height - 0.5;
      if (_tiltRaf) return;
      _tiltRaf = requestAnimationFrame(function() {
        _tiltRaf = null;
        fig.style.transform     = 'rotateX(' + (-_tiltNy * 12 * _tiltScale) + 'deg) rotateY(' + (_tiltNx * 16 * _tiltScale) + 'deg)';
        caption.style.transform = 'translateX(' + (_tiltNx * 28 * _tiltScale) + 'px) translateY(' + (_tiltNy * 28 * _tiltScale) + 'px)';
        shine.style.transform   = 'translateX(' + (_tiltNx * 100 * _tiltScale) + 'px) translateY(' + (_tiltNy * 100 * _tiltScale) + 'px)';
      });
    });

    card.addEventListener('mouseleave', function() {
      // 進行中の RAF をキャンセル
      if (_tiltRaf) { cancelAnimationFrame(_tiltRaf); _tiltRaf = null; }
      // CSS transitionを無効化してからanime.jsのelasticで戻す
      fig.classList.remove('tilt-smooth');
      caption.classList.remove('tilt-smooth');
      shine.classList.remove('tilt-smooth');
      // figureの傾きをelasticで戻す
      anime({ targets: fig,
        rotateX: 0, rotateY: 0,
        duration: 1200, easing: 'easeOutElastic', elasticity: 600 });
      // captionの視差をelasticで戻す
      anime({ targets: caption,
        translateX: 0, translateY: 0,
        duration: 1500, easing: 'easeOutElastic', elasticity: 600 });
      // shineをelasticで中心に戻す
      anime({ targets: shine,
        translateX: 0, translateY: 0,
        duration: 1200, easing: 'easeOutElastic', elasticity: 600 });
    });

    card.addEventListener('click', () => {
      const winner = idx === 0 ? pairA : pairB;
      const loser  = idx === 0 ? pairB : pairA;
      applyVote(winner.id, loser.id);
      _playedPairs.add(_pairKey(winner.id, loser.id));
      container.querySelectorAll('.vote-card').forEach(c => {
        c.classList.add(c.dataset.id === winner.id ? 'winner' : 'loser');
      });
      _currentVotePair = null; // 投票完了後は次のペアを抽選
      setTimeout(renderVote, 500);
    });
    container.appendChild(card);
  });
}

// --- フォーマットユーティリティ ---
function fmtViews(n) {
  if (!n) return '';
  if (n >= 100000000) return t('views-100m', { n: (n / 100000000).toFixed(1).replace(/\.0$/, '') });
  if (n >= 10000)     return t('views-10k',  { n: Math.floor(n / 10000) });
  if (n >= 1000)      return t('views-1k',   { n: (n / 1000).toFixed(1).replace(/\.0$/, '') });
  return t('views-raw', { n: n.toLocaleString() });
}
// ギャラリーオーバーレイ用: 再生数・投稿日・レーティングのメタHTML
var _SVG_EYE  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
var _SVG_CLK  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
var _SVG_STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
var _SVG_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';
var _ratingRankMap = {};
function _rebuildRatingRankMap() {
  var pool = filteredVideos().slice().sort(function(a, b) { return getRating(b.id) - getRating(a.id); });
  _ratingRankMap = {};
  pool.forEach(function(v, i) { _ratingRankMap[v.id] = i + 1; });
}
function _buildVideoMeta(v) {
  var items = [];
  if (v.viewCount) {
    items.push('<span class="gallery-meta-item">' + _SVG_EYE + fmtViewsShort(v.viewCount) + '</span>');
  }
  if (v.publishedAt) {
    items.push('<span class="gallery-meta-item">' + _SVG_CLK + fmtRelTime(v.publishedAt) + '</span>');
  }
  var rating = getRating(v.id);
  var rank = _ratingRankMap[v.id];
  var rankStr = rank ? '<span class="gallery-meta-rank">(#' + rank + ')</span>' : '';
  items.push('<span class="gallery-meta-item">' + _SVG_STAR + Math.round(rating) + rankStr + '</span>');
  return items.join('');
}
function _buildPinDot(v) {
  var hasPinned = !!_reactionsMyPins[v.id];
  if (!hasPinned) return '';
  var dot = '<span class="gallery-meta-pin-dot" style="background:' + (_reactionsPinColor || '#ec4899') + '"></span>';
  return '<span class="gallery-meta-item">' + _SVG_PIN + dot + '</span>';
}
// ギャラリーオーバーレイ用: 単位なし短縮表記
function fmtViewsShort(n) {
  if (!n) return '';
  if (n >= 100000000) return t('views-short-100m', { n: (n / 100000000).toFixed(1).replace(/\.0$/, '') });
  if (n >= 10000)     return t('views-short-10k',  { n: (n / 10000).toFixed(1).replace(/\.0$/, '') });
  return t('views-short-raw', { n: n.toLocaleString() });
}
function fmtRelTime(isoStr) {
  if (!isoStr) return '';
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60)         return t('time-now');
  if (diff < 3600)       return t('time-min',   { n: Math.floor(diff / 60) });
  if (diff < 86400)      return t('time-hour',  { n: Math.floor(diff / 3600) });
  if (diff < 86400 * 7)  return t('time-day',   { n: Math.floor(diff / 86400) });
  if (diff < 86400 * 30) return t('time-week',  { n: Math.floor(diff / (86400 * 7)) });
  if (diff < 86400 * 365)return t('time-month', { n: Math.floor(diff / (86400 * 30)) });
  return t('time-year', { n: Math.floor(diff / (86400 * 365)) });
}
function fmtDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

// --- 一覧 ---
var _listMode = localStorage.getItem('thumb-list-mode') || 'gallery';
var _shortsObserver = null;
var _listSortOrder = localStorage.getItem(LS_SORT) || 'views';  // 'date' | 'views' | 'rating' | 'random'
var _sortDir = localStorage.getItem('thumb-sort-dir') || 'desc'; // 'asc' | 'desc'
var _listPage = 0;                // 読み込み済みページ数
var _LIST_PAGE_SIZE = 50;
var _listSortedPool = [];         // ソート済み全件キャッシュ
var _listScrollObserver = null;   // 無限スクロール用 observer

// 行パターン: [列数, flex-grow 重みの配列]
var _GALLERY_PATTERNS = [
  [3, [3, 2, 3]],
  [4, [2, 3, 2, 3]],
  [3, [2, 4, 2]],
  [4, [3, 2, 3, 2]],
];

function renderList() {
  _rebuildRatingRankMap();
  if (_listMode === 'grid') { _renderGrid(); return; }
  // ギャラリーモード
  var grid = document.getElementById('listGrid');
  grid.innerHTML = '';
  grid.classList.remove('mode-grid');

  // ソート済みプール構築
  _listPage = 0;
  _listSortedPool = _buildSortedPool();
  // 無限スクロール observer リセット
  if (_listScrollObserver) { _listScrollObserver.disconnect(); }
  _listScrollObserver = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting) { _appendGalleryPage(); }
  }, { rootMargin: '200px' });
  var sentinel = document.getElementById('shortsSentinel');
  if (sentinel) { _listScrollObserver.observe(sentinel); }

  if (currentCat === 'shorts') {
    // ショート: waterfall + IntersectionObserver
    grid.classList.add('mode-shorts');
    if (_shortsObserver) { _shortsObserver.disconnect(); }
    _shortsObserver = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        entry.target.classList.toggle('inbound', entry.intersectionRatio >= 1);
      });
    }, { root: document.getElementById('listScrollBody'), threshold: [0, 1], rootMargin: '100px 0px' });
  } else {
    grid.classList.remove('mode-shorts');
  }
  // 初回ロード
  _appendGalleryPage();
}

// 全カテゴリ共通: ソート済み全件プールを構築する
function _buildSortedPool() {
  var pool = filteredVideos().slice();
  var asc = (_sortDir === 'asc');
  if (_listSortOrder === 'date') {
    pool.sort(function(a, b) {
      var cmp = (b.publishedAt || '') < (a.publishedAt || '') ? -1 : 1;
      return asc ? -cmp : cmp;
    });
  } else if (_listSortOrder === 'views') {
    pool.sort(function(a, b) {
      var cmp = (b.viewCount || 0) - (a.viewCount || 0);
      return asc ? -cmp : cmp;
    });
  } else if (_listSortOrder === 'rating') {
    pool.sort(function(a, b) {
      var cmp = getRating(b.id) - getRating(a.id);
      return asc ? -cmp : cmp;
    });
  } else {
    // ランダム: Fisher–Yates
    for (var i = pool.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
  }
  return pool;
}

// 全カテゴリ共通: 次ページ分のセルをグリッドに追記する
function _appendGalleryPage() {
  var grid = document.getElementById('listGrid');
  if (!grid) return;
  var start = _listPage * _LIST_PAGE_SIZE;
  if (start >= _listSortedPool.length) return;
  var slice = _listSortedPool.slice(start, start + _LIST_PAGE_SIZE);
  _listPage++;
  if (currentCat === 'shorts') {
    // ショート: waterfall セル
    slice.forEach(function(v) {
      var cell = document.createElement('div');
      cell.className = 'gallery-cell--short';
      var _meta = _buildVideoMeta(v) + _buildPinDot(v);
      cell.innerHTML =
        '<img src="' + v.thumb + '" alt="" loading="lazy"' +
        ' onerror="this.src=\'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg\'"' +
        ' referrerpolicy="no-referrer">' +
        '<div class="gallery-overlay">' +
          '<div class="gallery-title">' + v.title + '</div>' +
          (_meta ? '<div class="gallery-meta">' + _meta + '</div>' : '') +
        '</div>';
      cell.addEventListener('click', (function(vid) {
        return function() { openModalReactions(vid); };
      }(v)));
      grid.appendChild(cell);
      if (_shortsObserver) { _shortsObserver.observe(cell); }
    });
  } else {
    // 通常: galleryレイアウト（行パターン）
    var pat = Math.floor(start / _LIST_PAGE_SIZE) % _GALLERY_PATTERNS.length;
    var i = 0;
    while (i < slice.length) {
      var conf    = _GALLERY_PATTERNS[pat % _GALLERY_PATTERNS.length];
      var count   = conf[0];
      var weights = conf[1];
      var row     = document.createElement('div');
      row.className = 'gallery-row';
      slice.slice(i, i + count).forEach(function(v, j) {
        var cell = document.createElement('div');
        cell.className  = 'gallery-cell';
        cell.style.flexGrow  = weights[j] || 1;
        cell.style.flexBasis = (weights[j] || 1) * 80 + 'px';
        cell.innerHTML =
          '<div class="gallery-img-wrap">' +
            '<img src="' + v.thumb + '" alt="" loading="lazy"' +
            ' onerror="this.src=\'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg\'"' +
            ' referrerpolicy="no-referrer">' +
            '<div class="gallery-overlay">' +
              '<div class="gallery-title">' + v.title + '</div>' +
              (function(){ var m = _buildVideoMeta(v) + _buildPinDot(v); return m ? '<div class="gallery-meta">' + m + '</div>' : ''; }()) +
            '</div>' +
          '</div>';
        cell.addEventListener('click', (function(vid) {
          return function() { openModalReactions(vid); };
        }(v)));
        row.appendChild(cell);
      });
      grid.appendChild(row);
      i += Math.min(count, slice.length - i);
      pat++;
    }
  }
}

// ソートボタン・タブボタン: 全登録言語で計測し最大幅を min-width に設定する
var _sortBtnMaxWidths = {};
var _tabBtnMaxWidths  = {};
function _normalizeSortBtnWidths() {
  var codes = Object.keys(_I18N_DICTS);

  function _measureGroup(btns, maxMap, keyAttr, i18nAttr) {
    codes.forEach(function(code) {
      var dict = _I18N_DICTS[code] || {};
      btns.forEach(function(b) {
        var key     = b.dataset[keyAttr];
        var i18nKey = b.dataset[i18nAttr];
        var origMin = b.style.minWidth;
        var origTxt = b.textContent;
        b.style.minWidth = '';
        b.textContent    = dict[i18nKey] || b.textContent;
        var w = b.offsetWidth;
        b.textContent    = origTxt;
        b.style.minWidth = origMin;
        if (!maxMap[key] || w > maxMap[key]) { maxMap[key] = w; }
      });
    });
    btns.forEach(function(b) {
      var key = b.dataset[keyAttr];
      if (maxMap[key]) { b.style.minWidth = maxMap[key] + 'px'; }
    });
  }

  _measureGroup(
    Array.from(document.querySelectorAll('.ch-tab[data-i18n]')),
    _tabBtnMaxWidths, 'view', 'i18n'
  );
  // スキップボタン（単独） -- 削除済み
  // var skipBtn = document.getElementById('skipBtn');
  // if (skipBtn && skipBtn.dataset.i18n) { _measureGroup([skipBtn], {}, 'id', 'i18n'); }
}

// グリッドモード（カード一覧）
function _renderGrid() {
  var grid = document.getElementById('listGrid');
  grid.innerHTML = '';
  grid.classList.remove('mode-shorts');
  grid.classList.add('mode-grid');
  // ソート済みプール構築
  _listPage = 0;
  _listSortedPool = _buildSortedPool();
  // 無限スクロール observer リセット
  if (_listScrollObserver) { _listScrollObserver.disconnect(); }
  _listScrollObserver = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting) { _appendGridPage(); }
  }, { rootMargin: '200px' });
  var sentinel = document.getElementById('shortsSentinel');
  if (sentinel) { _listScrollObserver.observe(sentinel); }
  _appendGridPage();
}

function _appendGridPage() {
  var grid = document.getElementById('listGrid');
  if (!grid) return;
  var start = _listPage * _LIST_PAGE_SIZE;
  if (start >= _listSortedPool.length) return;
  var slice = _listSortedPool.slice(start, start + _LIST_PAGE_SIZE);
  _listPage++;
  slice.forEach(function(v) {
    var durHtml = v.duration
      ? '<span class="list-duration">' + fmtDuration(v.duration) + '</span>'
      : '';
    var metaHtml = _buildVideoMeta(v) + _buildPinDot(v);
    var card = document.createElement('div');
    card.className = 'list-card' + (v.category === 'shorts' ? ' list-card--short' : '');
    card.innerHTML =
      '<div class="list-thumb-wrap">' +
        '<img src="' + v.thumb + '" alt="" loading="lazy"' +
        ' onerror="this.src=\'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg\'"' +
        ' referrerpolicy="no-referrer">' +
        durHtml +
      '</div>' +
      '<div class="list-info">' +
        '<div class="list-info-text">' +
          '<div class="list-info-title" title="' + v.title.replace(/"/g, '&quot;') + '">' + v.title + '</div>' +
          (metaHtml ? '<div class="list-info-meta gallery-meta">' + metaHtml + '</div>' : '') +
        '</div>' +
      '</div>';
    card.addEventListener('click', (function(vid) {
      return function() { openModalReactions(vid); };
    }(v)));
    grid.appendChild(card);
  });
}
const RANK_PAGE = 50;
let rankShowCount = RANK_PAGE;

function renderRankingItems(sorted, maxRating, minRating, range, from, to) {
  const list = document.getElementById('rankList');
  sorted.slice(from, to).forEach((v, i) => {
    const idx = from + i;
    const rating = getRating(v.id);
    const rd     = getRd(v.id);
    const wins = getWins(v.id);
    const battles = getBattles(v.id);
    const wr = battles > 0 ? Math.round(wins / battles * 100) : 0;
    const barPct = Math.round((rating - minRating) / range * 100);
    const lowRd = rd > 150;
    const videoUrl = v.url ?? `https://www.youtube.com/watch?v=${v.id}`;
    const rankNum = idx < 3 ? idx + 1 : idx + 1;
    const views = v.viewCount ? fmtViews(v.viewCount) : '';
    const date  = v.publishedAt ? fmtRelTime(v.publishedAt) : '';
    const viewDate = [views, date].filter(Boolean).join(' · ');
    const metaHtml = _buildVideoMeta(v) + _buildPinDot(v);
    const item = document.createElement('div');
    item.className = `rank-item${idx < 3 ? ` rank-${idx+1}` : ''}`;
    item.innerHTML = `
      <div class="rank-num-col">
        <div class="rank-num">${rankNum}</div>
      </div>
      <div class="rank-thumb-wrap">
        <img src="${v.thumb}" alt="" loading="lazy" class="${rd > 200 ? 'rd-high' : rd > 100 ? 'rd-mid' : 'rd-low'}" onerror="this.src='https://i.ytimg.com/vi/${v.id}/hqdefault.jpg'">
      </div>
      <div class="rank-meta">
        <div class="rank-title">${v.title}</div>
        <div class="rank-stats">
          <span>${t('wins-fmt', { w: wins, b: battles })}${battles > 0 ? t('winrate-fmt', { r: wr }) : ''}</span>
        </div>
        ${metaHtml ? `<div class="rank-stats gallery-meta rank-meta-gallery">${metaHtml}</div>` : ''}
        <div class="rank-bar-bg"><div class="rank-bar-fill" style="width:${barPct}%"></div></div>
      </div>
    `;
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => openModalReactions(v));
    list.appendChild(item);
  });
}

function renderRanking() {
  _rebuildRatingRankMap();
  const pool = filteredVideos();
  const sorted = [...pool].sort((a, b) => getRating(b.id) - getRating(a.id));
  const maxRating = sorted.length ? getRating(sorted[0].id) : 1500;
  const minRating = sorted.length ? getRating(sorted[sorted.length - 1].id) : 1500;
  const range = maxRating - minRating || 1;

  rankShowCount = RANK_PAGE;
  document.getElementById('rankSubtitle').textContent = t('rank-subtitle', { count: pool.length, cat: currentCat });
  const list = document.getElementById('rankList');
  list.innerHTML = '';

  renderRankingItems(sorted, maxRating, minRating, range, 0, Math.min(rankShowCount, sorted.length));

  // もっと見るボタン
  if (sorted.length > rankShowCount) {
    const btn = document.createElement('button');
    btn.id = 'rankMoreBtn';
    btn.textContent = t('more-btn', { n: sorted.length - rankShowCount });
    btn.style.cssText = 'display:block;width:100%;margin-top:12px;padding:10px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text-muted);font-size:13px;cursor:pointer;transition:all 0.15s;';
    btn.onmouseenter = () => { btn.style.borderColor = 'var(--accent)'; btn.style.color = 'var(--accent)'; };
    btn.onmouseleave = () => { btn.style.borderColor = 'var(--border)'; btn.style.color = 'var(--text-muted)'; };
    btn.addEventListener('click', () => {
      const prev = rankShowCount;
      rankShowCount = Math.min(rankShowCount + RANK_PAGE, sorted.length);
      btn.remove();
      renderRankingItems(sorted, maxRating, minRating, range, prev, rankShowCount);
      if (rankShowCount < sorted.length) {
        btn.textContent = t('more-btn', { n: sorted.length - rankShowCount });
        list.appendChild(btn);
      }
    });
    list.appendChild(btn);
  }
}

// --- 最高レート動画ヘルパー ---
function getTopRankedVideo(key) {
  const videos = loadVideosForChannel(key);
  if (!videos?.length) return null;
  const active = videos.filter(v => v.category !== 'shorts');
  if (!active.length) return null;
  return active.reduce((best, v) => getRating(v.id) >= getRating(best.id) ? v : best, active[0]);
}

// --- サイドバー ---
// コンパクト状態を維持

document.addEventListener('keydown', e => {
  if (e.key !== 'Shift' || _shiftHeld) return;
  _shiftHeld = true;
  const hov = document.querySelector('.ch-action-delete:hover');
  if (hov) _setChDelBtnIcon(hov, 'trash-2');
});
document.addEventListener('keyup', e => {
  if (e.key !== 'Shift') return;
  _shiftHeld = false;
  const hov = document.querySelector('.ch-action-delete:hover');
  if (hov) _setChDelBtnIcon(hov, 'x');
});

function _setChDelBtnIcon(btn, icon) {
  if (!btn) return;
  btn.innerHTML = `<i data-lucide="${icon}"></i>`;
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [btn] });
}

function _startRefreshSpinner(btn) {
  btn.disabled = true;
}

function _stopRefreshSpinner(btn) {
  btn.disabled = false;
}

function _showChDelPopup(anchorBtn, msg, onConfirm, okClass) {
  document.querySelectorAll('.ch-del-popup').forEach(p => p.remove());
  const popup = document.createElement('div');
  popup.className = 'ch-del-popup';
  const msgEl = document.createElement('span');
  msgEl.className = 'ch-del-popup-msg';
  msgEl.textContent = msg;
  const btnRow = document.createElement('div');
  btnRow.className = 'ch-del-popup-btns';
  const okBtn = document.createElement('button');
  okBtn.className = 'ch-del-popup-ok' + (okClass ? ' ' + okClass : '');
  okBtn.textContent = okClass === 'ch-del-popup-ok--refresh' ? t('folder-refresh-confirm-btn') : t('ch-delete-confirm-btn');
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'ch-del-popup-cancel';
  cancelBtn.textContent = t('ch-delete-cancel-btn');
  btnRow.append(okBtn, cancelBtn);
  popup.append(msgEl, btnRow);
  document.body.appendChild(popup);
  const rect = anchorBtn.getBoundingClientRect();
  const pw = popup.offsetWidth, ph = popup.offsetHeight;
  let left = rect.right - pw;
  let top = rect.bottom + 4;
  if (left < 4) left = 4;
  if (top + ph > window.innerHeight - 4) top = rect.top - ph - 4;
  popup.style.left = left + 'px';
  popup.style.top = top + 'px';
  const close = () => popup.remove();
  okBtn.addEventListener('click', e => { e.stopPropagation(); close(); onConfirm(); });
  cancelBtn.addEventListener('click', e => { e.stopPropagation(); close(); });
  setTimeout(() => {
    const outside = e => { if (!popup.contains(e.target)) { close(); document.removeEventListener('click', outside, true); } };
    document.addEventListener('click', outside, true);
  }, 0);
}

function deleteChannel(key) {
  delete channels[key];
  saveChannels();
  // Remove from sidebarOrder
  sidebarOrder = sidebarOrder.filter(item => {
    if (item.type === 'channel') return item.key !== key;
    if (item.type === 'folder') {
      item.children = item.children.filter(k => k !== key);
      return item.children.length > 0;
    }
    return true;
  });
  // Dissolve single-child folders
  sidebarOrder = sidebarOrder.map(item =>
    (item.type === 'folder' && item.children.length === 1)
      ? { type: 'channel', key: item.children[0] } : item
  );
  saveSidebarOrder();
  if (currentChannelKey === key) {
    currentChannelKey = null;
    document.getElementById('chNoSelect').style.display = '';
    document.getElementById('chAvatar').style.display = 'none';
    document.getElementById('chName').style.display = 'none';
    document.getElementById('chTabs').style.display = 'none';
    document.getElementById('catFilter').style.display = 'none';
    showView('welcome');
  }
  renderSidebar();
}

function deleteFolder(folderId) {
  const idx = sidebarOrder.findIndex(item => item.type === 'folder' && item.id === folderId);
  if (idx === -1) return;
  const folder = sidebarOrder[idx];
  const channelItems = folder.children.map(key => ({ type: 'channel', key }));
  sidebarOrder.splice(idx, 1, ...channelItems);
  saveSidebarOrder();
  renderSidebar();
}

function _calcSidebarSlide(el) {
  el.querySelectorAll('.name-inner').forEach(inner => {
    const outer = inner.parentElement;
    if (!outer || !outer.clientWidth) return;
    const overflow = inner.scrollWidth - outer.clientWidth;
    if (overflow > 2) {
      inner.classList.add('overflows');
      const fadeZone = outer.clientWidth * 0.08;
      inner.style.setProperty('--slide-dist', `-${overflow + fadeZone}px`);
    } else {
      inner.classList.remove('overflows');
      inner.style.removeProperty('--slide-dist');
    }
  });
}

// コンパクトモード: チャンネル名ホバーパネルのヘルパー関数
function _showCompactTooltip(anchorRect, name, buttons) {
  if (_chTooltipLocked) return;
  if (_chTooltipHideTimer) { clearTimeout(_chTooltipHideTimer); _chTooltipHideTimer = null; }
  if (_chTooltipOutsideHandler) { document.removeEventListener('click', _chTooltipOutsideHandler); _chTooltipOutsideHandler = null; }
  _chTooltip.style.width = '';
  _chTooltipF2Action = null;
  // 名前ヘッダー: テキスト + 歯車ボタン
  _chTooltipNameEl.innerHTML = '';
  var nameSpan = document.createElement('span');
  nameSpan.className = 'ch-tooltip-name-text';
  nameSpan.textContent = name;
  var gearBtn = document.createElement('button');
  gearBtn.className = 'ch-tooltip-gear';
  gearBtn.innerHTML = '<i data-lucide="settings"></i>';
  _chTooltipNameEl.appendChild(nameSpan);
  _chTooltipNameEl.appendChild(gearBtn);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [gearBtn] });
  // アクションボタン: 非表示で構築、歯車クリックで表示
  _chTooltipActionsEl.style.display = 'none';
  _chTooltipActionsEl.style.visibility = '';
  _chTooltipActionsEl.innerHTML = '';
  buttons.forEach(function(b) {
    var btn = document.createElement('button');
    btn.className = 'ch-tooltip-btn' + (b.danger ? ' danger' : '');
    btn.title = b.title || '';
    var iconEl = document.createElement('i');
    iconEl.setAttribute('data-lucide', b.icon);
    var labelEl = document.createElement('span');
    labelEl.textContent = b.label || '';
    btn.appendChild(iconEl);
    btn.appendChild(labelEl);
    if (b.shiftIcon) {
      btn.addEventListener('mouseenter', function() {
        if (_shiftHeld) { iconEl.setAttribute('data-lucide', b.shiftIcon); if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [iconEl] }); }
      });
      btn.addEventListener('mouseleave', function() {
        iconEl.setAttribute('data-lucide', b.icon); if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [iconEl] });
      });
    }
    btn.addEventListener('click', function(e) { e.stopPropagation(); if (!_chTooltipLocked) b.onClick(btn, e); });
    _chTooltipActionsEl.appendChild(btn);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: Array.from(_chTooltipActionsEl.querySelectorAll('[data-lucide]')) });
  gearBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    _chTooltipActionsEl.style.display = '';
    _chTooltipActionsEl.style.visibility = '';
    if (_chTooltipGearEscHandler) { document.removeEventListener('keydown', _chTooltipGearEscHandler); }
    _chTooltipGearEscHandler = function(ke) { if (ke.key === 'Escape') { _hideCompactTooltip(0); } };
    document.addEventListener('keydown', _chTooltipGearEscHandler);
  });
  _chTooltip.style.top = anchorRect.top + 'px';
  _chTooltip.style.left = (anchorRect.right + 10) + 'px';
  _chTooltip.classList.add('visible');
}

function _hideCompactTooltip(delay) {
  if (_chTooltipLocked) return;
  if (_chTooltipHideTimer) { clearTimeout(_chTooltipHideTimer); _chTooltipHideTimer = null; }
  function _doHide() {
    _chTooltip.classList.remove('visible');
    if (_chTooltipOutsideHandler) { document.removeEventListener('click', _chTooltipOutsideHandler); _chTooltipOutsideHandler = null; }
    if (_chTooltipGearEscHandler) { document.removeEventListener('keydown', _chTooltipGearEscHandler); _chTooltipGearEscHandler = null; }
    _chTooltipF2Action = null;
  }
  if (delay) {
    _chTooltipHideTimer = setTimeout(function() { _doHide(); _chTooltipHideTimer = null; }, delay);
  } else {
    _doHide();
  }
}

function _showCompactRename(anchorBtn, currentName, onCommit) {
  document.querySelectorAll('.ch-compact-rename-pop').forEach(function(p) { p.remove(); });
  var pop = document.createElement('div');
  pop.className = 'ch-compact-rename-pop';
  var inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'ch-compact-rename-input';
  inp.value = currentName;
  inp.maxLength = 40;
  var submit = document.createElement('button');
  submit.className = 'ch-compact-rename-submit';
  submit.innerHTML = '<i data-lucide="check"></i>';
  pop.append(inp, submit);
  document.body.appendChild(pop);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [submit] });
  var rect = anchorBtn.getBoundingClientRect();
  pop.style.top  = (rect.top + rect.height / 2 - pop.offsetHeight / 2) + 'px';
  pop.style.left = (rect.right + 8) + 'px';
  inp.focus();
  inp.select();
  function commit() {
    var v = inp.value.trim().slice(0, 40);
    pop.remove();
    document.removeEventListener('click', outside, true);
    if (v) onCommit(v);
  }
  function outside(e) { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('click', outside, true); } }
  submit.addEventListener('click', function(e) { e.stopPropagation(); commit(); });
  inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { pop.remove(); document.removeEventListener('click', outside, true); }
  });
  setTimeout(function() { document.addEventListener('click', outside, true); }, 0);
}

function _startTooltipInlineRename(currentName, onCommit) {
  var _done = false;
  _chTooltipLocked = true;
  // 自然幅を測定するためアクションパネルが非表示なら一時展開する(F2経由時)
  if (_chTooltipActionsEl.style.display === 'none') {
    _chTooltipActionsEl.style.visibility = 'hidden';
    _chTooltipActionsEl.style.display = '';
  }
  var _naturalWidth = _chTooltip.getBoundingClientRect().width;
  _chTooltipActionsEl.style.display = 'none';
  _chTooltipActionsEl.style.visibility = '';
  _chTooltip.style.width = Math.max(_naturalWidth, 160) + 'px';
  if (_chTooltipGearEscHandler) { document.removeEventListener('keydown', _chTooltipGearEscHandler); _chTooltipGearEscHandler = null; }
  _chTooltipNameEl.innerHTML = '';
  var inp = document.createElement('input');
  inp.type = 'text';
  inp.className = 'ch-tooltip-rename-input';
  inp.value = currentName;
  inp.maxLength = 40;
  var confirmBtn = document.createElement('button');
  confirmBtn.className = 'ch-tooltip-gear';
  confirmBtn.innerHTML = '<i data-lucide="check"></i>';
  _chTooltipNameEl.appendChild(inp);
  _chTooltipNameEl.appendChild(confirmBtn);
  if (typeof lucide !== 'undefined') {
    lucide.createIcons({ nodes: [confirmBtn] });
    var checkSvg = confirmBtn.querySelector('svg');
    if (checkSvg) { checkSvg.setAttribute('width', '13'); checkSvg.setAttribute('height', '13'); }
  }
  function finish(save) {
    if (_done) return;
    _done = true;
    _chTooltipLocked = false;
    document.removeEventListener('click', outsideHandler, true);
    var v = save ? inp.value.trim().slice(0, 40) : '';
    if (v && v !== currentName) onCommit(v);
    _hideCompactTooltip(0);
  }
  function outsideHandler(e) {
    if (!_chTooltip.contains(e.target)) { finish(true); }
  }
  confirmBtn.addEventListener('mousedown', function(e) { e.preventDefault(); });
  confirmBtn.addEventListener('click', function(e) { e.stopPropagation(); finish(true); });
  inp.addEventListener('keydown', function(e) {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { finish(false); }
  });
  setTimeout(function() {
    inp.focus();
    inp.select();
    document.addEventListener('click', outsideHandler, true);
  }, 0);
}

function buildChannelItem(ch) {
  const item = document.createElement('div');
  item.className = 'sidebar-channel-item' + (currentChannelKey === ch.key ? ' active' : '');
  item.dataset.key = ch.key;
  if (_refreshingKeys.has(ch.key)) item.classList.add('compact-refreshing');
  const name = ch.displayName || ch.handle || ch.key;
  const avatarEl = ch.avatar
    ? `<img class="sidebar-ch-avatar" src="${ch.avatar}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : `<div class="sidebar-ch-avatar"></div>`;
  item.innerHTML = `<div class="sidebar-ch-avatar-wrap">${avatarEl}</div><span class="sidebar-ch-name"><span class="name-inner">${name}</span></span>`;

  // アクションボタン
  const actions = document.createElement('div');
  actions.className = 'ch-actions';

  const refreshBtn = document.createElement('button');
  refreshBtn.className = 'ch-action-btn ch-action-refresh';
  refreshBtn.title = t('ch-refresh-title');
  refreshBtn.innerHTML = '<i data-lucide="refresh-cw"></i>';

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'ch-action-btn ch-action-delete';
  deleteBtn.title = t('ch-delete-title');
  deleteBtn.innerHTML = '<i data-lucide="x"></i>';

  actions.append(refreshBtn, deleteBtn);
  item.appendChild(actions);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [refreshBtn, deleteBtn] });

  item.addEventListener('click', () => selectChannel(ch.key));

  refreshBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const key = ch.key;
    if (_refreshingKeys.has(key)) return;
    _refreshingKeys.add(key);
    item.classList.add('compact-refreshing');
    if (key !== currentChannelKey) await selectChannel(key);
    _startRefreshSpinner(refreshBtn);
    // リフレッシュ中に定期ポーリングしてギャラリーをライブ更新
    const _pollRefresh = setInterval(async () => {
      if (key !== currentChannelKey) return;
      const videos = await fetchChannelVideos(key);
      if (videos.length !== allVideos.length) {
        allVideos = videos;
        if (currentView === 'list') renderList();
        else if (currentView === 'ranking') renderRanking();
      }
    }, 2500);
    try {
      const res = await fetch('/api/channels/' + key + '/refresh', { method: 'POST', headers: getRssOnly() ? { 'X-RSS-Only': '1' } : apiKeyHeaders() });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { showToast(data.error || t('err-refresh-failed'), true); return; }
      if (data.apiKeyError) { markApiKeyError(); showToast(t('err-apikey-invalid-details'), true); }
      const toastMsg = getRssOnly()
        ? t('refresh-done-rss').replace('{changed}', (data.added ?? 0) + (data.updated ?? 0))
        : t('refresh-done-api').replace('{total}', data.total ?? '?');
      showToast(toastMsg);
      allVideos = await fetchChannelVideos(key);
      if (currentView === 'vote') renderVote();
      else if (currentView === 'list') renderList();
      else if (currentView === 'ranking') renderRanking();
    } catch (err) { showToast(t('err-refresh-failed'), true); console.error('refresh:', err); }
    finally {
      clearInterval(_pollRefresh);
      _refreshingKeys.delete(key);
      _stopRefreshSpinner(refreshBtn);
      document.querySelectorAll(`.sidebar-channel-item[data-key="${key}"]`).forEach(el => el.classList.remove('compact-refreshing'));
    }
  });

  deleteBtn.addEventListener('mouseenter', () => { if (_shiftHeld) _setChDelBtnIcon(deleteBtn, 'trash-2'); });
  deleteBtn.addEventListener('mouseleave', () => { _setChDelBtnIcon(deleteBtn, 'x'); });
  deleteBtn.addEventListener('click', e => {
    e.stopPropagation();
    const key = ch.key;
    const doDelete = () => deleteChannel(key);
    if (e.shiftKey) {
      doDelete();
    } else {
      _showChDelPopup(deleteBtn, t('ch-delete-confirm').replace('{name}', name), doDelete);
    }
  });
  // コンパクト時のチャンネル名ツールチップ + アクションパネル
  item.addEventListener('mouseenter', () => {
    _calcSidebarSlide(item);
    if (!_chTooltip || !document.getElementById('sidebar').classList.contains('sidebar--compact')) return;
    if (document.getElementById('sidebarNav').classList.contains('sidebar--folder-dragging')) return;
    if (item.classList.contains('sidebar--drag-source')) return;
    const rect = item.getBoundingClientRect();
    _showCompactTooltip(rect, name, [
      { icon: 'refresh-cw', label: t('ch-refresh-title'), title: t('ch-refresh-title'), onClick: (btn) => {
        _hideCompactTooltip(0);
        refreshBtn.dispatchEvent(new MouseEvent('click'));
      }},
      { icon: 'x', shiftIcon: 'trash-2', label: t('ch-delete-title'), title: t('ch-delete-title'), danger: true, onClick: (btn, e) => {
        _hideCompactTooltip(0);
        if (e.shiftKey) { deleteChannel(key); }
        else { _showChDelPopup(btn, t('ch-delete-confirm').replace('{name}', name), () => deleteChannel(key)); }
      }}
    ]);
  });
  item.addEventListener('mouseleave', () => { if (_chTooltip) _hideCompactTooltip(200); });
  return item;
}

function randomFolderColor() {
  return Math.floor(Math.random() * 360);
}

function buildFolderItem(folder) {
  const wrap = document.createElement('div');
  wrap.className = 'sidebar-folder' + (folder.open ? ' sidebar-folder--open' : '');
  wrap.dataset.folderId = folder.id;

  const header = document.createElement('div');
  header.className = 'sidebar-folder-header';
  header.dataset.folderId = folder.id;
  header.tabIndex = 0;
  if (folder.children.some(k => _refreshingKeys.has(k))) header.classList.add('compact-refreshing');

  const preview = document.createElement('div');
  preview.className = 'sidebar-folder-preview';
  if (folder.color != null) {
    wrap.style.setProperty('--folder-tint', 'hsla(' + folder.color + ',60%,45%,0.18)');
  }
  folder.children.slice(0, 2).forEach(key => {
    const ch = channels[key];
    if (!ch) return;
    const el = ch.avatar
      ? Object.assign(document.createElement('img'), { className: 'sidebar-folder-preview-img', src: ch.avatar, referrerPolicy: 'no-referrer' })
      : Object.assign(document.createElement('div'), { className: 'sidebar-folder-preview-img sidebar-folder-preview-ph' });
    if (ch.avatar) el.onerror = () => el.style.display = 'none';
    preview.appendChild(el);
  });
  const folderIcon = document.createElement('div');
  folderIcon.className = 'sidebar-folder-open-icon';
  folderIcon.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>';
  preview.appendChild(folderIcon);
  header.appendChild(preview);

  const nameEl = document.createElement('span');
  nameEl.className = 'sidebar-folder-name';
  const nameInnerEl = document.createElement('span');
  nameInnerEl.className = 'name-inner';
  nameInnerEl.textContent = folder.name || '';
  nameEl.appendChild(nameInnerEl);
  header.appendChild(nameEl);

  const folderActions = document.createElement('div');
  folderActions.className = 'ch-actions';

  const folderRenameBtn = document.createElement('button');
  folderRenameBtn.className = 'ch-action-btn ch-action-rename';
  folderRenameBtn.title = t('folder-rename-title');
  folderRenameBtn.innerHTML = '<i data-lucide="pencil"></i>';

  const folderRefreshBtn = document.createElement('button');
  folderRefreshBtn.className = 'ch-action-btn ch-action-refresh';
  folderRefreshBtn.title = t('folder-refresh-title');
  folderRefreshBtn.innerHTML = '<i data-lucide="refresh-cw"></i>';

  const folderDeleteBtn = document.createElement('button');
  folderDeleteBtn.className = 'ch-action-btn ch-action-delete';
  folderDeleteBtn.title = t('folder-delete-title');
  folderDeleteBtn.innerHTML = '<i data-lucide="x"></i>';

  folderActions.append(folderRenameBtn, folderRefreshBtn, folderDeleteBtn);
  header.appendChild(folderActions);
  if (typeof lucide !== 'undefined') lucide.createIcons({ nodes: [folderRenameBtn, folderRefreshBtn, folderDeleteBtn] });

  folderRenameBtn.addEventListener('click', e => { e.stopPropagation(); startRename(); });

  folderRefreshBtn.addEventListener('click', async e => {
    e.stopPropagation();
    const doRefresh = async () => {
      const keys = [...folder.children].filter(k => !_refreshingKeys.has(k));
      if (!keys.length) return;
      keys.forEach(k => _refreshingKeys.add(k));
      _startRefreshSpinner(folderRefreshBtn);
      header.classList.add('compact-refreshing');
      try {
        let totalVideos = 0;
        let addedVideos = 0;
        let updatedVideos = 0;
        for (const key of keys) {
          // 子チャンネルアイテムのリフレッシュボタンにもスピナーを表示
          const chItem = document.querySelector(`.sidebar-channel-item[data-key="${key}"]`);
          const chRefBtn = chItem?.querySelector('.ch-action-refresh');
          if (chRefBtn) _startRefreshSpinner(chRefBtn);
          if (chItem) chItem.classList.add('compact-refreshing');
          try {
            const res = await fetch('/api/channels/' + key + '/refresh', { method: 'POST', headers: getRssOnly() ? { 'X-RSS-Only': '1' } : apiKeyHeaders() });
            const data = await res.json().catch(() => ({}));
            if (data.apiKeyError) { markApiKeyError(); showToast(t('err-apikey-invalid-details'), true); if (chRefBtn) _stopRefreshSpinner(chRefBtn); _refreshingKeys.delete(key); document.querySelectorAll(`.sidebar-channel-item[data-key="${key}"]`).forEach(el => el.classList.remove('compact-refreshing')); break; }
            if (data.total != null) totalVideos += data.total;
            if (data.added != null) addedVideos += data.added;
            if (data.updated != null) updatedVideos += data.updated;
          } catch (err) { console.error('folder refresh:', err); }
          _refreshingKeys.delete(key);
          if (chRefBtn) _stopRefreshSpinner(chRefBtn);
          document.querySelectorAll(`.sidebar-channel-item[data-key="${key}"]`).forEach(el => el.classList.remove('compact-refreshing'));
          // チャンネル完了ごとに即UIへ反映
          if (key === currentChannelKey) {
            allVideos = await fetchChannelVideos(key);
            if (currentView === 'vote') renderVote();
            else if (currentView === 'list') renderList();
            else if (currentView === 'ranking') renderRanking();
          }
        }
        const toastMsg = getRssOnly()
          ? t('refresh-done-rss').replace('{changed}', addedVideos + updatedVideos)
          : t('refresh-done-api').replace('{total}', totalVideos);
        showToast(toastMsg);
      } finally {
        _stopRefreshSpinner(folderRefreshBtn);
        document.querySelector(`.sidebar-folder-header[data-folder-id="${folder.id}"]`)?.classList.remove('compact-refreshing');
      }
    };
    if (e.shiftKey) {
      await doRefresh();
    } else {
      const count = folder.children.length;
      const msg = t('folder-refresh-confirm').replace('{name}', folder.name || '').replace('{count}', count);
      _showChDelPopup(folderRefreshBtn, msg, doRefresh, 'ch-del-popup-ok--refresh');
    }
  });

  folderDeleteBtn.addEventListener('mouseenter', () => { if (_shiftHeld) _setChDelBtnIcon(folderDeleteBtn, 'trash-2'); });
  folderDeleteBtn.addEventListener('mouseleave', () => { _setChDelBtnIcon(folderDeleteBtn, 'x'); });
  folderDeleteBtn.addEventListener('click', e => {
    e.stopPropagation();
    const fid = folder.id;
    const fname = folder.name || '';
    const doDelete = () => deleteFolder(fid);
    if (e.shiftKey) {
      doDelete();
    } else {
      _showChDelPopup(folderDeleteBtn, t('folder-delete-confirm').replace('{name}', fname), doDelete);
    }
  });

  function startRename() {
    if (nameEl.contentEditable === 'plaintext-only' || nameEl.contentEditable === 'true') return;
    const prev = folder.name || '';
    nameEl.textContent = prev;
    nameEl.contentEditable = 'plaintext-only';
    nameEl.focus();
    const sel = window.getSelection(), range = document.createRange();
    range.selectNodeContents(nameEl); sel.removeAllRanges(); sel.addRange(range);
    function onMouseDown(e) { e.stopPropagation(); }
    function onKeyDown(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); }
      if (ev.key === 'Escape') {
        nameEl.contentEditable = 'false';
        nameEl.innerHTML = '';
        const ni = document.createElement('span');
        ni.className = 'name-inner';
        ni.textContent = prev;
        nameEl.appendChild(ni);
        nameEl.removeEventListener('blur', commit);
        nameEl.removeEventListener('keydown', onKeyDown);
        nameEl.removeEventListener('mousedown', onMouseDown);
      }
    }
    function commit() {
      nameEl.contentEditable = 'false';
      const next = nameEl.textContent.trim().slice(0, 40) || prev;
      nameEl.innerHTML = '';
      const ni = document.createElement('span');
      ni.className = 'name-inner';
      ni.textContent = next;
      nameEl.appendChild(ni);
      folder.name = next;
      saveSidebarOrder();
      _calcSidebarSlide(header);
      nameEl.removeEventListener('keydown', onKeyDown);
      nameEl.removeEventListener('mousedown', onMouseDown);
    }
    nameEl.addEventListener('blur', commit, { once: true });
    nameEl.addEventListener('keydown', onKeyDown);
    nameEl.addEventListener('mousedown', onMouseDown);
  }

  header.addEventListener('keydown', e => {
    if (e.key === 'F2') { e.preventDefault(); startRename(); }
  });

  // コンパクト時のフォルダ名ツールチップ + アクションパネル
  header.addEventListener('mouseenter', () => {
    _calcSidebarSlide(header);
    if (!_chTooltip || !document.getElementById('sidebar').classList.contains('sidebar--compact')) return;
    if (document.getElementById('sidebarNav').classList.contains('sidebar--folder-dragging')) return;
    if (header.classList.contains('sidebar--drag-source') || wrap.classList.contains('sidebar--drag-source')) return;
    const rect = header.getBoundingClientRect();
    _showCompactTooltip(rect, folder.name || '', [
      { icon: 'pencil', label: t('folder-rename-title'), title: t('folder-rename-title'), onClick: () => {
        _startTooltipInlineRename(folder.name || '', function(newName) {
          folder.name = newName;
          saveSidebarOrder();
          renderSidebar();
        });
      }},
      { icon: 'refresh-cw', label: t('ch-refresh-title'), title: t('folder-refresh-title'), onClick: (btn) => {
        _hideCompactTooltip(0);
        folderRefreshBtn.dispatchEvent(new MouseEvent('click', { shiftKey: true }));
      }},
      { icon: 'x', shiftIcon: 'trash-2', label: t('folder-delete-title'), title: t('folder-delete-title'), danger: true, onClick: (btn, e) => {
        _hideCompactTooltip(0);
        if (e.shiftKey) { deleteFolder(folder.id); }
        else { _showChDelPopup(btn, t('folder-delete-confirm').replace('{name}', folder.name || ''), () => deleteFolder(folder.id)); }
      }}
    ]);
    _chTooltipF2Action = function() {
      _startTooltipInlineRename(folder.name || '', function(newName) {
        folder.name = newName;
        saveSidebarOrder();
        renderSidebar();
      });
    };
  });
  header.addEventListener('mouseleave', () => { if (_chTooltip) _hideCompactTooltip(200); });

  const childrenEl = document.createElement('div');
  childrenEl.className = 'sidebar-folder-children';
  childrenEl.dataset.folderId = folder.id;

  folder.children.forEach(key => {
    const ch = channels[key];
    if (ch) childrenEl.appendChild(buildChannelItem(ch));
  });

  const dropZone = document.createElement('div');
  dropZone.className = 'sidebar-folder-drop-zone';
  dropZone.dataset.folderId = folder.id;
  childrenEl.appendChild(dropZone);

  function applyFolderOpen(animated) {
    if (folder.open) {
      childrenEl.style.maxHeight = childrenEl.scrollHeight + 'px';
    } else {
      if (animated) childrenEl.style.maxHeight = childrenEl.scrollHeight + 'px';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { childrenEl.style.maxHeight = '0'; });
      });
    }
  }
  if (folder.open) {
    // 即座に大きな値でスナップ表示（DOM挿入前でも見た目は開いた状態に）
    childrenEl.style.maxHeight = '9999px';
    requestAnimationFrame(() => {
      // DOM挿入後に正確な値へ（transition無効化でアニメなし）
      childrenEl.style.transition = 'none';
      childrenEl.style.maxHeight = childrenEl.scrollHeight + 'px';
      requestAnimationFrame(() => {
        // 以降のトグル操作でtransitionが有効になる
        childrenEl.style.transition = '';
      });
    });
  }

  header.addEventListener('click', e => {
    if (e.target.closest('button, [contenteditable]:not([contenteditable="false"])')) return;
    folder.open = !folder.open;
    saveSidebarOrder();
    wrap.classList.toggle('sidebar-folder--open', folder.open);
    applyFolderOpen(true);
  });

  wrap.appendChild(header);
  wrap.appendChild(childrenEl);
  return wrap;
}

function renderSidebar() {
  syncSidebarOrder();
  const nav = document.getElementById('sidebarNav');
  const sidebar = document.getElementById('sidebar');
  const isCompact = sidebar.classList.contains('sidebar--compact');
  const addWrap = document.getElementById('sidebarCompactAddWrap');

  // nav内に移動済みなら先に救出する（nav.innerHTML=''で消えないよう）
  if (addWrap && addWrap.parentNode === nav) {
    sidebar.insertBefore(addWrap, nav);
  }

  nav.innerHTML = '';

  // コンパクト時: add-wrapをチャンネル一覧の先頭に配置
  if (isCompact && addWrap) {
    nav.appendChild(addWrap);
  }

  sidebarOrder.forEach(item => {
    if (item.type === 'channel') {
      const ch = channels[item.key];
      if (ch) nav.appendChild(buildChannelItem(ch));
    } else if (item.type === 'folder') {
      nav.appendChild(buildFolderItem(item));
    }
  });
}

function initSidebarDrag() {
  const nav = document.getElementById('sidebarNav');
  const THRESHOLD = 5;
  let _pending = null;
  let _draggedEl = null;
  let _ghost = null;
  let _dragType = null;
  let _srcKey = null;
  let _srcFolderId = null;
  let _pointerOffsetY = 0;
  let _dropInfo = null;
  let _mergeTimer = null;
  let _mergeTargetKey = null;

  const _ind = document.createElement('div');
  _ind.className = 'sidebar-drag-indicator';
  _ind.style.display = 'none';
  document.body.appendChild(_ind);

  function _clearState() {
    _ind.style.display = 'none';
    nav.querySelectorAll('.sidebar-merge-hover').forEach(el => el.classList.remove('sidebar-merge-hover'));
    nav.querySelectorAll('.sidebar-folder-drop-hover').forEach(el => el.classList.remove('sidebar-folder-drop-hover'));
    nav.querySelectorAll('.merge-preview').forEach(el => el.classList.remove('merge-preview'));
    clearTimeout(_mergeTimer); _mergeTimer = null;
    _mergeTargetKey = null;
  }

  function _hitTest(mouseY) {
    // 表示中の全対象を DOM 順で収集
    const items = [];
    for (const el of nav.querySelectorAll('.sidebar-channel-item, .sidebar-folder-header')) {
      const isHeader = el.classList.contains('sidebar-folder-header');
      const fid = isHeader ? el.dataset.folderId : null;
      // 自身: 要素上にいる場合は null（インジケータなし）
      if (_dragType === 'channel' && !isHeader && el.dataset.key === _srcKey) {
        const r = el.getBoundingClientRect();
        if (mouseY >= r.top && mouseY <= r.bottom) return null;
        continue;
      }
      if (_dragType === 'folder' && fid === _srcFolderId) {
        const r = el.getBoundingClientRect();
        if (mouseY >= r.top && mouseY <= r.bottom) return null;
        continue;
      }
      // 閉じたフォルダ内はスキップ
      const pc = el.closest('.sidebar-folder-children');
      if (pc) {
        const pf = pc.closest('.sidebar-folder');
        if (pf && !pf.classList.contains('sidebar-folder--open')) continue;
        if (_dragType === 'folder' && pf && pf.dataset.folderId === _srcFolderId) continue;
      }
      items.push({ el, isHeader, fid, pc });
    }

    for (let i = 0; i < items.length; i++) {
      const { el, isHeader, fid, pc } = items[i];
      const r = el.getBoundingClientRect();
      const folderId = pc ? pc.dataset.folderId : null;
      const wrap = isHeader ? el.closest('.sidebar-folder') : null;

      // テリトリー: 常に要素の実際の底辺で計算（フォルダラッパー底辺は使わない）
      const prevBot = i > 0 ? items[i - 1].el.getBoundingClientRect().bottom : -Infinity;
      const nextTop = i < items.length - 1 ? items[i + 1].el.getBoundingClientRect().top : Infinity;
      const topBound = (prevBot + r.top) / 2;
      const botBound = (r.bottom + nextTop) / 2;

      if (mouseY < topBound || mouseY > botBound) continue;

      // フォルダドラッグ中はフォルダ内チャンネルへのヒット判定を抑制（フォルダinフォルダ不可）
      // ただしフォルダラッパー下端より下はフォルダ後ろへの脱出ゾーンとして folder-after を返す
      if (_dragType === 'folder' && !isHeader && pc) {
        const folderWrap = el.closest('.sidebar-folder');
        const naturalBot = folderWrap ? folderWrap.getBoundingClientRect().bottom : r.bottom;
        if (mouseY <= naturalBot) return null;
        return { action: 'folder-after', folderId: pc.dataset.folderId, el: folderWrap || el };
      }

      // ── テリトリー上端の隙間: このアイテムの before ──
      if (mouseY < r.top) {
        // ソース要素がこのギャップに DOM 上存在する → 挿入しても移動なし → null
        if (_draggedEl) {
          const prev = items[i - 1];
          const afterPrev = !prev || !!(prev.el.compareDocumentPosition(_draggedEl) & Node.DOCUMENT_POSITION_FOLLOWING);
          const beforeEl = !!(_draggedEl.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
          if (afterPrev && beforeEl) return null;
        }
        if (isHeader) return _dragType === 'folder'
          ? { action: 'folder-before', folderId: fid, el }
          : { action: 'channel-before-folder', folderId: fid, el };
        return { action: 'before', targetKey: el.dataset.key, folderId, el };
      }

      // ── テリトリー下端の隙間（r.bottom 〜 botBound）──
      if (mouseY > r.bottom) {
        if (isHeader) {
          // フォルダヘッダー底辺〜フォルダラッパー底辺: フォルダ内部
          const wrapBot = wrap ? wrap.getBoundingClientRect().bottom : r.bottom;
          if (mouseY <= wrapBot) {
            if (_dragType === 'channel') {
              if (_srcFolderId === fid) return null; // 自分のフォルダ内部 → null
              return { action: 'add-to-folder', folderId: fid, el };
            }
            continue;
          }
          // フォルダラッパー底辺より下: 次アイテムの before に統一
          const next = items[i + 1];
          if (next) {
            const nFolderId = next.pc ? next.pc.dataset.folderId : null;
            if (next.isHeader) return _dragType === 'folder'
              ? { action: 'folder-before', folderId: next.fid, el: next.el }
              : { action: 'channel-before-folder', folderId: next.fid, el: next.el };
            return { action: 'before', targetKey: next.el.dataset.key, folderId: nFolderId, el: next.el };
          }
          return { action: _dragType === 'folder' ? 'folder-after' : 'channel-after-folder', folderId: fid, el: wrap || el };
        }
        // チャンネルアイテムの下ギャップ
        if (folderId) {
          const folderWrap = el.closest('.sidebar-folder');
          // drop-bottom 付与中はパディング分(28px)を引いて自然な底辺で判定
          const DROP_PAD = 28;
          const rawBot = folderWrap ? folderWrap.getBoundingClientRect().bottom : r.bottom;
          const naturalBot = (folderWrap && folderWrap.classList.contains('sidebar-folder--drop-bottom')) ? rawBot - DROP_PAD : rawBot;
          if (mouseY > naturalBot) {
            return { action: 'channel-after-folder', folderId, el: folderWrap || el };
          }
          // 同フォルダ内に次のアイテムがあれば before に統一（フォルダ末尾ではない）
          const next = items[i + 1];
          if (next && next.pc && next.pc.dataset.folderId === folderId) {
            // ソースが el と next の間に DOM 上存在する → 挿入しても移動なし → null
            if (_srcFolderId === folderId && _draggedEl) {
              const afterEl   = !!(el.compareDocumentPosition(_draggedEl) & Node.DOCUMENT_POSITION_FOLLOWING);
              const beforeNext = !!(_draggedEl.compareDocumentPosition(next.el) & Node.DOCUMENT_POSITION_FOLLOWING);
              if (afterEl && beforeNext) return null;
            }
            return { action: 'before', targetKey: next.el.dataset.key, folderId, el: next.el };
          }
          // フォルダ内最後の可視アイテムのギャップ
          // next がない = ソースがこのアイテムの直後 → ドロップしても移動なし → null
          if (_srcFolderId === folderId) return null;
          return { action: 'after', targetKey: el.dataset.key, folderId, el };
        }
        // トップレベルチャンネル: 次アイテムの before に統一
        const next = items[i + 1];
        if (next) {
          // ソースが el と next の間に DOM 上存在する → 挿入しても移動なし → null
          if (_draggedEl) {
            const afterEl    = !!(el.compareDocumentPosition(_draggedEl) & Node.DOCUMENT_POSITION_FOLLOWING);
            const beforeNext = !!(_draggedEl.compareDocumentPosition(next.el) & Node.DOCUMENT_POSITION_FOLLOWING);
            if (afterEl && beforeNext) return null;
          }
          const nFolderId = next.pc ? next.pc.dataset.folderId : null;
          if (next.isHeader) return _dragType === 'folder'
            ? { action: 'folder-before', folderId: next.fid, el: next.el }
            : { action: 'channel-before-folder', folderId: next.fid, el: next.el };
          return { action: 'before', targetKey: next.el.dataset.key, folderId: nFolderId, el: next.el };
        }
        return { action: 'after', targetKey: el.dataset.key, folderId, el };
      }

      // ── アイテム本体上 ──
      const relY = (mouseY - r.top) / r.height;
      if (isHeader) {
        if (_dragType === 'channel') {
          if (_srcFolderId && _srcFolderId === fid) return null;
          if (relY < 0.5) return { action: 'channel-before-folder', folderId: fid, el };
          return { action: 'add-to-folder', folderId: fid, el };
        }
        if (relY < 0.5) return { action: 'folder-before', folderId: fid, el };
        // 下半分: ギャップゾーンと統一するため次のトップレベルアイテムの before を返す
        {
          const next = items[i + 1];
          if (next && !next.pc) {
            // 次がトップレベルアイテム（フォルダ内ではない）
            if (next.isHeader) return { action: 'folder-before', folderId: next.fid, el: next.el };
            return { action: 'before', targetKey: next.el.dataset.key, folderId: null, el: next.el };
          }
          // 開いたフォルダ（次が子チャンネル）か最後のアイテム
          // フォルダドラッグ時はヘッダー下半分にインジケーターを出さない（ラッパー下端に出ると誤認されるため）
          if (_dragType === 'folder') return null;
          return { action: 'folder-after', folderId: fid, el: wrap || el };
        }
      }
      // チャンネルアイテム
      if (_dragType === 'channel') {
        const canMerge = !folderId;

        // フォルダ内の最後のアイテムかどうか
        const nextItem = items[i + 1];
        const isLastInFolder = folderId && (
          !nextItem || !nextItem.pc || nextItem.pc.dataset.folderId !== folderId
        );

        // 上端: before
        if (relY < 0.2) return { action: 'before', targetKey: el.dataset.key, folderId, el };

        // フォルダ内最後のアイテム下半分: add-to-folder ゾーン
        if (isLastInFolder && relY >= 0.5) {
          // ラッパー超えチェック
          const folderWrap = el.closest('.sidebar-folder');
          const DROP_PAD = 28;
          const rawBot = folderWrap ? folderWrap.getBoundingClientRect().bottom : r.bottom;
          const naturalBot = (folderWrap && folderWrap.classList.contains('sidebar-folder--drop-bottom')) ? rawBot - DROP_PAD : rawBot;
          if (mouseY > naturalBot) return { action: 'channel-after-folder', folderId, el: folderWrap || el };

          // no-op チェック: ソースが el の直後に DOM 上存在
          if (_draggedEl && nextItem) {
            const afterEl    = !!(el.compareDocumentPosition(_draggedEl) & Node.DOCUMENT_POSITION_FOLLOWING);
            const beforeNext = !!(_draggedEl.compareDocumentPosition(nextItem.el) & Node.DOCUMENT_POSITION_FOLLOWING);
            if (afterEl && beforeNext) return null;
          }
          if (_srcFolderId === folderId && !nextItem) return null; // ソースが同フォルダの最後

          return { action: 'after', targetKey: el.dataset.key, folderId, el };
        }

        if (relY > 0.8) {
          // フォルダ内最終チャンネルでラッパー超え → 脱出
          if (folderId) {
            const folderWrap = el.closest('.sidebar-folder');
            const DROP_PAD = 28;
            const rawBot = folderWrap ? folderWrap.getBoundingClientRect().bottom : r.bottom;
            const naturalBot = (folderWrap && folderWrap.classList.contains('sidebar-folder--drop-bottom')) ? rawBot - DROP_PAD : rawBot;
            if (mouseY > naturalBot) return { action: 'channel-after-folder', folderId, el: folderWrap || el };
          }
          if (nextItem) {
            if (_draggedEl) {
              const afterEl    = !!(el.compareDocumentPosition(_draggedEl) & Node.DOCUMENT_POSITION_FOLLOWING);
              const beforeNext = !!(_draggedEl.compareDocumentPosition(nextItem.el) & Node.DOCUMENT_POSITION_FOLLOWING);
              if (afterEl && beforeNext) return null;
            }
            const nFolderId = nextItem.pc ? nextItem.pc.dataset.folderId : null;
            if (nextItem.isHeader) return { action: 'channel-before-folder', folderId: nextItem.fid, el: nextItem.el };
            return { action: 'before', targetKey: nextItem.el.dataset.key, folderId: nFolderId, el: nextItem.el };
          }
          return { action: 'after', targetKey: el.dataset.key, folderId, el };
        }

        if (canMerge) return { action: 'merge', targetKey: el.dataset.key, folderId, el };
        return { action: 'before', targetKey: el.dataset.key, folderId, el };
      }
      // フォルダドラッグ on チャンネルアイテム
      if (relY < 0.5) return { action: 'before', targetKey: el.dataset.key, folderId, el };
      // 下半分: 次アイテムの before に統一（ギャップゾーンと同じ位置）
      {
        const next = items[i + 1];
        if (next) {
          const nFolderId = next.pc ? next.pc.dataset.folderId : null;
          if (next.isHeader) return { action: 'folder-before', folderId: next.fid, el: next.el };
          return { action: 'before', targetKey: next.el.dataset.key, folderId: nFolderId, el: next.el };
        }
        return { action: 'after', targetKey: el.dataset.key, folderId, el };
      }
    }

    // フォルダ内ドロップゾーン（フォルダ末尾への追加 or 脱出）
    for (const el of nav.querySelectorAll('.sidebar-folder-drop-zone')) {
      const pc = el.closest('.sidebar-folder-children');
      if (pc) {
        const pf = pc.closest('.sidebar-folder');
        if (pf && !pf.classList.contains('sidebar-folder--open')) continue;
      }
      const r = el.getBoundingClientRect();
      if (mouseY >= r.top - 12 && mouseY <= r.bottom + 12 && _dragType === 'channel') {
        const zFolderId = el.dataset.folderId;
        // 自分が所属するフォルダのドロップゾーン → フォルダの後ろに脱出
        if (_srcFolderId && _srcFolderId === zFolderId) {
          const hdr = nav.querySelector(`.sidebar-folder-header[data-folder-id="${zFolderId}"]`);
          const wrap = hdr ? hdr.closest('.sidebar-folder') : el;
          return { action: 'channel-after-folder', folderId: zFolderId, el: wrap || el };
        }
        return { action: 'add-to-folder', folderId: zFolderId, el };
      }
    }

    return { action: 'end' };
  }

  function _showDrop(mouseY) {
    const prev = _dropInfo;
    const newInfo = _hitTest(mouseY);

    // _hitTest の結果に基づいて drop-bottom を付与（ポスト判定）
    // 付与後は次フレームの _hitTest が自然底辺で正しく再判定する
    if (_dragType === 'channel') {
      nav.querySelectorAll('.sidebar-folder--drop-bottom').forEach(el => el.classList.remove('sidebar-folder--drop-bottom'));
      if (newInfo && newInfo.action === 'after' && newInfo.folderId) {
        const folder = nav.querySelector(`.sidebar-folder[data-folder-id="${newInfo.folderId}"]`);
        if (folder) folder.classList.add('sidebar-folder--drop-bottom');
      }
    }
    // ドラッグ元フォルダ上ではインジケータなし
    if (newInfo === null) {
      _clearState();
      _dropInfo = null;
      return;
    }
    // 同じmergeターゲットなら状態を維持
    if (prev && prev.action === 'merge' && newInfo && newInfo.action === 'merge' && newInfo.targetKey === prev.targetKey) {
      _dropInfo = newInfo;
      _ind.style.display = 'none';
      return;
    }
    _clearState();
    _dropInfo = newInfo;
    if (!_dropInfo) return;
    const { action, el } = _dropInfo;
    const indStyle = (r, atTop) =>
      `display:block;position:fixed;left:${r.left}px;top:${atTop ? r.top - 2 : r.bottom - 1}px;width:${r.width}px;height:3px;background:var(--accent,#4f9cf9);border-radius:2px;pointer-events:none;z-index:9998;`;
    if (action === 'before') _ind.style.cssText = indStyle(el.getBoundingClientRect(), true);
    else if (action === 'after') _ind.style.cssText = indStyle(el.getBoundingClientRect(), false);
    else if (action === 'merge') {
      el.classList.add('sidebar-merge-hover');
      _mergeTargetKey = _dropInfo.targetKey;
      _mergeTimer = setTimeout(() => { el.classList.add('merge-preview'); }, 100);
    }
    else if (action === 'add-to-folder') {
      const h = nav.querySelector(`.sidebar-folder-header[data-folder-id="${_dropInfo.folderId}"]`);
      if (h) h.classList.add('sidebar-folder-drop-hover');
    }
    else if (action === 'folder-before') _ind.style.cssText = indStyle(el.getBoundingClientRect(), true);
    else if (action === 'folder-after') _ind.style.cssText = indStyle(el.getBoundingClientRect(), false);
    else if (action === 'channel-before-folder') _ind.style.cssText = indStyle(el.getBoundingClientRect(), true);
    else if (action === 'channel-after-folder') {
      const wrap = el.closest('.sidebar-folder');
      _ind.style.cssText = indStyle((wrap || el).getBoundingClientRect(), false);
    }
    else if (action === 'end') {
      const navR = nav.getBoundingClientRect();
      let bottom = navR.top;
      // トップレベルのチャンネルアイテム（フォルダ外）
      nav.querySelectorAll('.sidebar-channel-item').forEach(el => {
        if (!el.closest('.sidebar-folder-children')) {
          const b = el.getBoundingClientRect().bottom;
          if (b > bottom) bottom = b;
        }
      });
      // 各フォルダの視覚的な末尾（開いている場合はフォルダ全体、閉じている場合はヘッダー）
      nav.querySelectorAll('.sidebar-folder-header').forEach(el => {
        const folder = el.closest('.sidebar-folder');
        const isOpen = folder && folder.classList.contains('sidebar-folder--open');
        const ref = isOpen ? folder : el;
        const b = ref.getBoundingClientRect().bottom;
        if (b > bottom) bottom = b;
      });
      _ind.style.cssText = `display:block;position:fixed;left:${navR.left}px;top:${bottom}px;width:${navR.width}px;height:3px;background:var(--accent,#4f9cf9);border-radius:2px;pointer-events:none;z-index:9998;`;
    }
  }

  function _removeFromOrder(key) {
    for (let i = sidebarOrder.length - 1; i >= 0; i--) {
      const item = sidebarOrder[i];
      if (item.type === 'channel' && item.key === key) { sidebarOrder.splice(i, 1); return; }
      if (item.type === 'folder') {
        const ci = item.children.indexOf(key);
        if (ci !== -1) { item.children.splice(ci, 1); return; }
      }
    }
  }

  function _applyDrop() {
    if (!_dropInfo) return;
    const { action, targetKey, folderId } = _dropInfo;
    if (_dragType === 'channel') {
      const srcKey = _srcKey;
      _removeFromOrder(srcKey);
      if (action === 'before') {
        if (folderId) {
          const f = sidebarOrder.find(i => i.type === 'folder' && i.id === folderId);
          if (f) { const idx = f.children.indexOf(targetKey); f.children.splice(Math.max(0, idx), 0, srcKey); }
        } else {
          const idx = sidebarOrder.findIndex(i => i.type === 'channel' && i.key === targetKey);
          sidebarOrder.splice(idx < 0 ? 0 : idx, 0, { type: 'channel', key: srcKey });
        }
      } else if (action === 'after') {
        if (folderId) {
          const f = sidebarOrder.find(i => i.type === 'folder' && i.id === folderId);
          if (f) { const idx = f.children.indexOf(targetKey); f.children.splice(idx + 1, 0, srcKey); }
        } else {
          const idx = sidebarOrder.findIndex(i => i.type === 'channel' && i.key === targetKey);
          sidebarOrder.splice(idx < 0 ? sidebarOrder.length : idx + 1, 0, { type: 'channel', key: srcKey });
        }
      } else if (action === 'merge') {
        if (folderId) {
          const f = sidebarOrder.find(i => i.type === 'folder' && i.id === folderId);
          if (f && !f.children.includes(srcKey)) f.children.push(srcKey);
          else if (!f) sidebarOrder.push({ type: 'channel', key: srcKey });
        } else {
          const tgtIdx = sidebarOrder.findIndex(i => i.type === 'channel' && i.key === targetKey);
          if (tgtIdx >= 0) {
            const tgtCh = channels[targetKey];
            const defaultName = tgtCh ? (tgtCh.displayName || tgtCh.handle || targetKey) : '';
            sidebarOrder.splice(tgtIdx, 1, { type: 'folder', id: 'f_' + Date.now(), open: false, name: defaultName, color: randomFolderColor(), children: [targetKey, srcKey] });
          } else { sidebarOrder.push({ type: 'channel', key: srcKey }); }
        }
      } else if (action === 'add-to-folder') {
        const f = sidebarOrder.find(i => i.type === 'folder' && i.id === folderId);
        if (f && !f.children.includes(srcKey)) f.children.push(srcKey);
        else if (!f) sidebarOrder.push({ type: 'channel', key: srcKey });
      } else if (action === 'channel-before-folder') {
        const ti = sidebarOrder.findIndex(i => i.type === 'folder' && i.id === folderId);
        sidebarOrder.splice(ti < 0 ? 0 : ti, 0, { type: 'channel', key: srcKey });
      } else if (action === 'channel-after-folder') {
        const ti = sidebarOrder.findIndex(i => i.type === 'folder' && i.id === folderId);
        sidebarOrder.splice(ti < 0 ? sidebarOrder.length : ti + 1, 0, { type: 'channel', key: srcKey });
      } else {
        sidebarOrder.push({ type: 'channel', key: srcKey });
      }
      sidebarOrder = sidebarOrder.map(item =>
        (item.type === 'folder' && item.children.length === 1)
          ? { type: 'channel', key: item.children[0] } : item
      );
      sidebarOrder = sidebarOrder.filter(item => item.type !== 'folder' || item.children.length > 0);
    } else if (_dragType === 'folder') {
      const fi = sidebarOrder.findIndex(i => i.type === 'folder' && i.id === _srcFolderId);
      if (fi < 0) return;
      const [folder] = sidebarOrder.splice(fi, 1);
      if (action === 'folder-before') {
        const ti = sidebarOrder.findIndex(i => i.type === 'folder' && i.id === folderId);
        sidebarOrder.splice(ti < 0 ? 0 : ti, 0, folder);
      } else if (action === 'folder-after') {
        const ti = sidebarOrder.findIndex(i => i.type === 'folder' && i.id === folderId);
        sidebarOrder.splice(ti < 0 ? sidebarOrder.length : ti + 1, 0, folder);
      } else if (action === 'before') {
        const ti = sidebarOrder.findIndex(i => i.type === 'channel' && i.key === targetKey);
        sidebarOrder.splice(ti < 0 ? 0 : ti, 0, folder);
      } else if (action === 'after') {
        const ti = sidebarOrder.findIndex(i => i.type === 'channel' && i.key === targetKey);
        sidebarOrder.splice(ti < 0 ? sidebarOrder.length : ti + 1, 0, folder);
      } else {
        sidebarOrder.push(folder);
      }
    }
    saveSidebarOrder();
  }

  function _cleanup() {
    document.removeEventListener('mousemove', _onMove);
    document.removeEventListener('mouseup', _onUp);
    document.removeEventListener('touchmove', _onTouchMove);
    document.removeEventListener('touchend', _onUp);
    if (_ghost) { _ghost.remove(); _ghost = null; }
    if (_draggedEl) { _draggedEl.style.opacity = ''; _draggedEl.classList.remove('sidebar--drag-source'); _draggedEl = null; }
    _clearState();
    nav.querySelectorAll('.sidebar-folder--drop-bottom').forEach(el => el.classList.remove('sidebar-folder--drop-bottom'));
    nav.classList.remove('sidebar--dragging');
    nav.classList.remove('sidebar--folder-dragging');
    document.body.style.cursor = '';
    _dragType = _srcKey = _srcFolderId = _dropInfo = _pending = null;
  }

  function _startDrag(p) {
    const { unit, rect, downY, type, srcKey, srcFolderId } = p;
    _draggedEl = unit;
    _dragType = type;
    _srcKey = srcKey;
    _srcFolderId = srcFolderId;
    _pointerOffsetY = downY - rect.top;
    // 開いているフォルダをドラッグする場合は先に視覚的に閉じる（データは変更しない→ドロップ後に元の状態に戻る）
    if (type === 'folder' && unit.classList.contains('sidebar-folder--open')) {
      unit.classList.remove('sidebar-folder--open');
      const chevron = unit.querySelector('.sidebar-folder-chevron');
      if (chevron) chevron.textContent = '\u25be';
      // 子要素を即座に閉じる（transition無効化）
      const childrenEl = unit.querySelector('.sidebar-folder-children');
      if (childrenEl) {
        childrenEl.style.transition = 'none';
        childrenEl.style.maxHeight = '0';
        void childrenEl.offsetHeight;
        setTimeout(() => { childrenEl.style.transition = ''; }, 0);
      }
    }
    // ゴースト生成（コンパクト時はヘッダのみ）
    let ghostSrc = unit;
    if (type === 'folder' && document.getElementById('sidebar').classList.contains('sidebar--compact')) {
      ghostSrc = unit.querySelector('.sidebar-folder-header') || unit;
    }
    _ghost = ghostSrc.cloneNode(true);
    const ghostRect = ghostSrc.getBoundingClientRect();
    _ghost.style.cssText = `position:fixed;top:${ghostRect.top}px;left:${ghostRect.left}px;width:${ghostRect.width}px;pointer-events:none;z-index:9999;opacity:0.85;box-shadow:0 6px 24px rgba(0,0,0,0.55);border-radius:8px;transition:none;`;
    _pointerOffsetY = downY - ghostRect.top;
    document.body.appendChild(_ghost);
    unit.style.opacity = '0.2';
    unit.classList.add('sidebar--drag-source');
    if (_chTooltip) _chTooltip.classList.remove('visible');
    nav.classList.add('sidebar--dragging');
    if (type === 'folder') nav.classList.add('sidebar--folder-dragging');
    document.body.style.cursor = 'grabbing';
    document.addEventListener('mousemove', _onMove);
    document.addEventListener('mouseup', _onUp);
    document.addEventListener('touchmove', _onTouchMove, { passive: false });
    document.addEventListener('touchend', _onUp);
  }

  function _onMove(e) {
    if (!_draggedEl) return;
    e.preventDefault();
    const src = e.touches ? e.touches[0] : e;
    _ghost.style.top = (src.clientY - _pointerOffsetY) + 'px';
    _showDrop(src.clientY);
  }
  const _onTouchMove = e => { if (_draggedEl) { e.preventDefault(); _onMove(e); } };
  function _onUp() {
    if (!_draggedEl) return;
    _applyDrop();
    _cleanup();
    renderSidebar();
  }
  function _cancelPending() {
    document.removeEventListener('mousemove', _onPendingMove);
    document.removeEventListener('mouseup', _onPendingUp);
    document.removeEventListener('touchmove', _onPendingMove);
    document.removeEventListener('touchend', _onPendingUp);
    _pending = null;
  }
  function _onPendingMove(e) {
    if (!_pending) return;
    const src = e.touches ? e.touches[0] : e;
    if (Math.abs(src.clientY - _pending.downY) < THRESHOLD && Math.abs(src.clientX - _pending.downX) < THRESHOLD) return;
    const p = _pending;
    _cancelPending();
    _startDrag(p);
    e.preventDefault();
    _onMove(e);
  }
  function _onPendingUp() { _cancelPending(); }

  nav.addEventListener('mousedown', e => {
    if (e.target.closest('button, input, select, textarea')) return;
    const chItem = e.target.closest('.sidebar-channel-item');
    const fldHdr = !chItem && e.target.closest('.sidebar-folder-header');
    if (!chItem && !fldHdr) return;
    const type = chItem ? 'channel' : 'folder';
    const unit = chItem || fldHdr.closest('.sidebar-folder');
    _pending = { downY: e.clientY, downX: e.clientX, unit, rect: unit.getBoundingClientRect(), type,
      srcKey: chItem ? chItem.dataset.key : null,
      srcFolderId: fldHdr ? fldHdr.dataset.folderId
        : (chItem ? (chItem.closest('.sidebar-folder-children') || {}).dataset?.folderId || null : null) };
    document.addEventListener('mousemove', _onPendingMove);
    document.addEventListener('mouseup', _onPendingUp);
  });
  nav.addEventListener('touchstart', e => {
    if (e.target.closest('button, input, select, textarea')) return;
    const chItem = e.target.closest('.sidebar-channel-item');
    const fldHdr = !chItem && e.target.closest('.sidebar-folder-header');
    if (!chItem && !fldHdr) return;
    const type = chItem ? 'channel' : 'folder';
    const unit = chItem || fldHdr.closest('.sidebar-folder');
    const touch = e.touches[0];
    _pending = { downY: touch.clientY, downX: touch.clientX, unit, rect: unit.getBoundingClientRect(), type,
      srcKey: chItem ? chItem.dataset.key : null,
      srcFolderId: fldHdr ? fldHdr.dataset.folderId
        : (chItem ? (chItem.closest('.sidebar-folder-children') || {}).dataset?.folderId || null : null) };
    document.addEventListener('touchmove', _onPendingMove, { passive: false });
    document.addEventListener('touchend', _onPendingUp);
  }, { passive: false });
}



// --- チャンネル選択 ---
async function selectChannel(key) {
  const ch = channels[key];
  if (!ch) return;
  currentChannelKey = key;
  _reactionsCurrentVideoId = null;

  // サイドバーのアクティブ状態を更新
  document.querySelectorAll('.sidebar-channel-item').forEach(el => {
    el.classList.toggle('active', el.dataset.key === key);
  });

  // チャンネルヘッダーを表示
  document.getElementById('chNoSelect').style.display = 'none';
  const avatarEl = document.getElementById('chAvatar');
  avatarEl.src = ch.avatar || '';
  avatarEl.style.display = ch.avatar ? '' : 'none';
  const chNameEl = document.getElementById('chName');
  chNameEl.textContent = ch.displayName || ch.handle || ch.key;
  chNameEl.style.display = '';
  document.getElementById('chTabs').style.display = '';
  document.getElementById('catFilter').style.display = '';

  try {
    allVideos = await fetchChannelVideos(key);
    await loadMyPins();
    const counts = { videos: 0, shorts: 0, live: 0 };
    allVideos.forEach(v => { if (counts[v.category] !== undefined) counts[v.category]++; });
    // currentCat を維持。ただし現在のカテゴリに動画が 0 件なら有効なカテゴリに切り替え
    if (!counts[currentCat]) {
      currentCat = counts.live >= counts.videos && counts.live >= counts.shorts ? 'live'
                 : counts.shorts > counts.videos ? 'shorts' : 'videos';
      localStorage.setItem(LS_CAT, currentCat);
    }
    document.querySelectorAll('.cat-seg-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.cat === currentCat);
    });
    const savedView = localStorage.getItem(LS_VIEW) || 'list';
    const keepView = CAT_VIEWS.includes(currentView) ? currentView : savedView;
    showView(keepView);
  } catch (e) {
    console.error('[selectChannel] FETCH ERROR:', e);
    allVideos = [];
    const savedView = localStorage.getItem(LS_VIEW) || 'list';
    const keepView = CAT_VIEWS.includes(currentView) ? currentView : savedView;
    showView(keepView);
  }
}

// --- 画面切り替え ---
const SCREENS = ['welcome', 'vote', 'list', 'ranking', 'reactions'];

// --- サムネモーダル ---
// --- ReactionPin ---
function reactionsClamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function reactionsRandGauss() {
  let u = 0, g = 0;
  while (u === 0) u = Math.random();
  while (g === 0) g = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * g);
}

async function loadMyPins() {
  try {
    var resp = await fetch('/api/pins/my?session=' + encodeURIComponent(_reactionsSessionId));
    if (!resp.ok) return;
    var data = await resp.json();
    (data.pins || []).forEach(function(p) {
      if (!_reactionsMyPins[p.video_id]) {
        _reactionsMyPins[p.video_id] = { x: p.x, y: p.y };
      }
    });
  } catch(e) {}
}

async function loadReactionSeeds(videoId) {
  try {
    const resp = await fetch('/api/pins/' + videoId + '/seeds?session=' + encodeURIComponent(_reactionsSessionId));
    if (!resp.ok) return [];
    const data = await resp.json();
    _reactionsPins = data.pins  || [];
    _reactionsKde  = reactionsComputeKde(_reactionsPins);
    // サーバーから自分のピンを復元（ローカルに未保存の場合）
    if (data.my_pin && !_reactionsMyPins[videoId]) {
      _reactionsMyPins[videoId] = { x: data.my_pin.x, y: data.my_pin.y };
    }
    return data.seeds || [];
  } catch { return []; }
}

async function postReaction(videoId, x, y) {
  try {
    await fetch('/api/pins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: videoId, session_id: _reactionsSessionId, x, y }),
    });
  } catch { /* サイレント失敗 */ }
}

// ピンをグリッドでクラスタリングし、各セルの代表点(重心に最も近いDB値)と件数を返す
// → ヒートマップ描画とピン表示で同じ結果を共有するために切り出し
function computeReactionClusters(pins) {
  var GRID = 10;
  var cellPins = {};
  for (var pi = 0; pi < pins.length; pi++) {
    var p = pins[pi];
    var cx = Math.min(GRID - 1, Math.floor(p.x * GRID));
    var cy = Math.min(GRID - 1, Math.floor(p.y * GRID));
    var ckey = cx + ',' + cy;
    if (!cellPins[ckey]) cellPins[ckey] = [];
    cellPins[ckey].push(p);
  }
  var cellKeys = Object.keys(cellPins);
  var clusters = [];
  for (var ci = 0; ci < cellKeys.length; ci++) {
    var cell = cellPins[cellKeys[ci]];
    var sumX = 0, sumY = 0;
    for (var k = 0; k < cell.length; k++) { sumX += cell[k].x; sumY += cell[k].y; }
    var centX = sumX / cell.length, centY = sumY / cell.length;
    var best = cell[0], bestDist = Infinity;
    for (var k = 0; k < cell.length; k++) {
      var dx = cell[k].x - centX, dy = cell[k].y - centY;
      var d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = cell[k]; }
    }
    clusters.push({ pin: best, pins: cell, count: cell.length, cent: { x: centX, y: centY } });
  }
  clusters.sort(function(a, b) { return b.count - a.count; });
  return clusters;
}

// ヒートマップ用 offscreen canvas（ピン度数取得に常時使用）
var _heatmapOffscreenCanvas = null;

function renderReactionsHeatmap() {
  var layer = document.getElementById('reactionsHeatmapLayer');
  var w = layer.offsetWidth;
  var h = layer.offsetHeight;
  if (!w || !h) return;

  // DOMを使い回してフリックを防ぐ（innerHTMLクリアしない）
  var canvas = layer.querySelector('canvas');
  if (!canvas) {
    layer.innerHTML = '';
    var underlay = document.createElement('div');
    underlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.70);pointer-events:none;';
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;filter:blur(18px);';
    layer.appendChild(underlay);
    layer.appendChild(canvas);
  }

  // ピンがなければ canvas をクリアするだけ（underlay は残す）
  if (!_reactionsPins || _reactionsPins.length === 0) {
    canvas.width  = w;
    canvas.height = h;
    canvas.getContext('2d').clearRect(0, 0, w, h);
    return;
  }

  canvas.width  = w;
  canvas.height = h;

  var ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';

  var hex = (_reactionsPinColor || '#ec4899').replace('#', '');
  var cr = parseInt(hex.slice(0, 2), 16);
  var cg = parseInt(hex.slice(2, 4), 16);
  var cb = parseInt(hex.slice(4, 6), 16);

  var radius = Math.min(w, h) * 0.22;
  var alpha = Math.min(0.25, 4.0 / _reactionsPins.length);

  for (var i = 0; i < _reactionsPins.length; i++) {
    var p  = _reactionsPins[i];
    var cx = p.x * w;
    var cy = p.y * h;
    var grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0,   'rgba(' + cr + ',' + cg + ',' + cb + ',' + alpha.toFixed(4) + ')');
    grad.addColorStop(0.3, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (alpha * 0.6).toFixed(4) + ')');
    grad.addColorStop(0.7, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (alpha * 0.15).toFixed(4) + ')');
    grad.addColorStop(1,   'rgba(' + cr + ',' + cg + ',' + cb + ',0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }

  // offscreenコピーを保持（ヒートマップ非表示時もdensity参照用）
  _heatmapOffscreenCanvas = document.createElement('canvas');
  _heatmapOffscreenCanvas.width  = w;
  _heatmapOffscreenCanvas.height = h;
  var oCtx = _heatmapOffscreenCanvas.getContext('2d');
  oCtx.filter = 'blur(18px)';
  oCtx.drawImage(canvas, 0, 0);
  oCtx.filter = 'none';
}

let REACTIONS_MAX_PINS = parseInt(localStorage.getItem(LS_MAX_PINS), 10) || 10;

function setSquashIntensity(v) {
  var sx = (1 + 0.24 * v).toFixed(3);
  var sy = Math.max(0.6, 1 - 0.20 * v).toFixed(3);
  var rule = '@keyframes reactionsPinSvgSquash {' +
    '0%{transform:none}' +
    '6%{transform:scaleX(' + sx + ') scaleY(' + sy + ');animation-timing-function:cubic-bezier(0.2,0,0.4,1)}' +
    '14%{transform:none}' +
    '100%{transform:none}}';
  for (var _si = 0; _si < document.styleSheets.length; _si++) {
    try {
      var _rules = document.styleSheets[_si].cssRules;
      for (var _ri = 0; _ri < _rules.length; _ri++) {
        if (_rules[_ri].name === 'reactionsPinSvgSquash') {
          document.styleSheets[_si].deleteRule(_ri);
          document.styleSheets[_si].insertRule(rule, _ri);
          return;
        }
      }
    } catch(e) {}
  }
}

function _pinColorFromDensity(d) {
  var palette = PIN_PALETTES[_reactionsPinColor] || PIN_PALETTES['#ec4899'];
  function hexToRgb(h) {
    h = h.replace('#','');
    return [parseInt(h.slice(0,2),16), parseInt(h.slice(2,4),16), parseInt(h.slice(4,6),16)];
  }
  var cLight = hexToRgb(palette[1]);
  var cDark  = hexToRgb(palette[2]);
  var t = Math.max(0, (d - 0.1) / 0.9);
  var r = Math.round(cLight[0] + (cDark[0] - cLight[0]) * t);
  var g = Math.round(cLight[1] + (cDark[1] - cLight[1]) * t);
  var b = Math.round(cLight[2] + (cDark[2] - cLight[2]) * t);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

function updatePinColors() {
  var pinsLayer = document.getElementById('reactionsPinsLayer');
  if (!pinsLayer) return;
  pinsLayer.querySelectorAll('.reactions-pin').forEach(function(el) {
    var d = parseFloat(el.dataset.density) || 0.5;
    var shadeIdx = d >= 0.67 ? 2 : d >= 0.34 ? 1 : 0;
    el.className = 'reactions-pin shade-' + shadeIdx;
    var balloon = el.querySelector('.pin-balloon');
    if (balloon) balloon.style.fill = _pinColorFromDensity(d);
  });
}

function makeReactionsPinEl(x, y, density, skipDropAnim, pinProps) {
  // density(0〜1): 高いほど大きい・濃い色。ランダム幅は±20%
  var d = density != null ? density : 0.5;
  var baseScale = 0.6 + 0.8 * d;
  const scale    = (pinProps && pinProps._scale != null) ? pinProps._scale : baseScale + (Math.random() - 0.5) * 0.4;
  const sz       = Math.round(20 * scale);
  const szH      = Math.round(sz * 1.25);
  // densityでシェード頭数を連続値として決定
  var shadeIdx = d >= 0.67 ? 2 : d >= 0.34 ? 1 : 0;
  var pinColor = _pinColorFromDensity(d);
  const el       = document.createElement('div');
  el.className   = 'reactions-pin shade-' + shadeIdx;
  el.dataset.x       = x;
  el.dataset.y       = y;
  el.dataset.density = d.toFixed(4);
  // viewBox 0 0 24 30 でピン先端は y=29、translate(-50%,-100%) は底辺を座標に合わせる
  // → 先端は底辺より szH/30 px 上にある分を top に加算して補正
  var tipGap = szH / 30;
  el.style.cssText = 'left:' + (x * 100) + '%;top:calc(' + (y * 100) + '% + ' + tipGap.toFixed(2) + 'px);--drop-h:' + DROP_HEIGHT + 'px;';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'reactions-pin-svg');
  svg.setAttribute('viewBox', '0 0 24 30');
  svg.setAttribute('width', sz);
  svg.setAttribute('height', szH);
  svg.innerHTML =
    '<path class="pin-balloon" style="fill:' + pinColor + '" d="M12,29 C5.5,21.5 1.5,17 1.5,11 a10.5,10.5,0,0,1,21,0 C22.5,17 18.5,21.5 12,29 Z"/>' +
    '<g transform="translate(12 11) scale(0.38) translate(-12 -12)">' +
      '<path class="pin-icon" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>' +
    '</g>';
  el.appendChild(svg);
  var _floatDur = ((pinProps && pinProps._floatDur != null) ? pinProps._floatDur : (2.4 + Math.random() * 0.8).toFixed(2)) + 's ease-in-out infinite';
  if (skipDropAnim) {
    el.style.transform  = 'translate(-50%, -100%)';
    el.style.opacity    = '1';
    el.style.animation  = 'reactionsPinFloat ' + _floatDur;
    svg.style.animation = 'none';
    el.classList.add('rs-floating');
  } else {
    el.style.animation  = 'reactionsPinDrop ' + DROP_SPEED + 's linear forwards';
    svg.style.animation = 'reactionsPinSvgSquash ' + DROP_SPEED + 's linear forwards';
    el.addEventListener('animationend', function(e) {
      if (e.animationName === 'reactionsPinDrop') {
        el.style.animation  = 'reactionsPinFloat ' + _floatDur;
        svg.style.animation = 'none';
        el.classList.add('rs-floating');
      }
    }, { once: true });
    el.animate(
      [
        { opacity: 0, offset: 0 },
        { opacity: 1, offset: FADE_IN_FRAC },
        { opacity: 1, offset: 1 },
      ],
      { duration: DROP_SPEED * 1000, fill: 'forwards', easing: 'linear' }
    );
  }
  return el;
}

function buildPlacedPins(limit) {
  var pins = _reactionsPins.slice();
  if (pins.length === 0) return [];
  var clusters = computeReactionClusters(pins);
  var maxCount = clusters.length > 0 ? clusters[0].count : 1;
  var GRID = 10;
  var cellWeight = {};
  for (var ci = 0; ci < clusters.length; ci++) {
    var cl = clusters[ci];
    var cx0 = Math.min(GRID - 1, Math.floor(cl.pin.x * GRID));
    var cy0 = Math.min(GRID - 1, Math.floor(cl.pin.y * GRID));
    cellWeight[cx0 + ',' + cy0] = cl.count / maxCount;
  }
  var weighted = pins.map(function(p) {
    var cx = Math.min(GRID - 1, Math.floor(p.x * GRID));
    var cy = Math.min(GRID - 1, Math.floor(p.y * GRID));
    var w = cellWeight[cx + ',' + cy] || 0.01;
    return { p: p, w: Math.sqrt(w) };
  });
  weighted.sort(function(a, b) {
    return Math.pow(Math.random(), 1 / b.w) - Math.pow(Math.random(), 1 / a.w);
  });
  var placed = weighted.slice(0, limit != null ? limit : REACTIONS_MAX_PINS).map(function(item) {
    return { x: item.p.x, y: item.p.y, density: 0 };
  });
  var BW2 = 0.09 * 0.09;
  var maxKde = 0;
  var kdeDensities = placed.map(function(pin) {
    var kde = 0;
    for (var i = 0; i < pins.length; i++) {
      var dx = pins[i].x - pin.x, dy = pins[i].y - pin.y;
      kde += Math.exp(-(dx * dx + dy * dy) / (2 * BW2));
    }
    if (kde > maxKde) maxKde = kde;
    return kde;
  });
  if (maxKde > 0) {
    for (var ai = 0; ai < placed.length; ai++) {
      placed[ai].density = kdeDensities[ai] / maxKde;
    }
  }
  for (var si = placed.length - 1; si > 0; si--) {
    var sj = Math.floor(Math.random() * (si + 1));
    var st = placed[si]; placed[si] = placed[sj]; placed[sj] = st;
  }
  return placed;
}

function startReactionsLoop() {
  _reactionsActive = false;
  var pinsLayer = document.getElementById('reactionsPinsLayer');
  if (!pinsLayer) return;
  pinsLayer.innerHTML = '';
  var placed = buildPlacedPins();
  if (!placed.length) return;
  _reactionsActive = true;
  var emitted = 0;
  function spawnOne() {
    if (!_reactionsActive || emitted >= placed.length) {
      _reactionsActive = false;
      return;
    }
    var pin = placed[emitted++];
    pinsLayer.appendChild(makeReactionsPinEl(pin.x, pin.y, pin.density));
    var delay = 80 + Math.random() * 200;
    setTimeout(spawnOne, delay);
  }
  for (var s = 0; s < 5; s++) {
    (function(offset) {
      setTimeout(function() { if (_reactionsActive) spawnOne(); }, offset * 80);
    })(s);
  }
}

// pinsレイヤーを画像の実際描画領域に合わせる
function adjustReactionsLayers() {
  // img は width:100%;height:auto なので wrap と同サイズ
  // レイヤーは CSS inset:0 のまま、ヒートマップcanvasのみ再描画
  if (_reactionsHeatmapVisible) renderReactionsHeatmap();
}

var _reactionsResizeObserver = null;

function startReactionsResizeObserver() {
  if (_reactionsResizeObserver) return;
  var wrap = document.getElementById('reactionsImgWrap');
  if (!wrap || typeof ResizeObserver === 'undefined') return;
  _reactionsResizeObserver = new ResizeObserver(function() {
    adjustReactionsLayers();
    var saved = _reactionsMyPins[_reactionsCurrentVideoId];
    if (saved && !document.getElementById('reactionsMyPin').hidden) {
      showMyReactionsPin(saved.x, saved.y, false);
    }
  });
  _reactionsResizeObserver.observe(wrap);
}

function stopReactionsResizeObserver() {
  if (_reactionsResizeObserver) {
    _reactionsResizeObserver.disconnect();
    _reactionsResizeObserver = null;
  }
}

function showMyReactionsPin(x, y, withAnim) {
  // x, y は画像内の相対位置（0〜1）。wrap内のレターボックスを考慮して変換
  var wrap = document.getElementById('reactionsImgWrap');
  var img  = document.getElementById('reactionsImg');
  var pin  = document.getElementById('reactionsMyPin');
  var nw = img.naturalWidth, nh = img.naturalHeight;
  var wRect = wrap.getBoundingClientRect();
  var left, top;
  if (nw && nh && wRect.width && wRect.height) {
    var scale = Math.min(wRect.width / nw, wRect.height / nh);
    var iw = nw * scale, ih = nh * scale;
    var ix = (wRect.width  - iw) / 2;
    var iy = (wRect.height - ih) / 2;
    left = ((ix + x * iw) / wRect.width  * 100) + '%';
    // 先端座標計算: SVGの先端は底辺から 1.5px 上なので top に +1.5px みずかす (36x45のpin height/30 = 1.5)
    top  = 'calc(' + ((iy + y * ih) / wRect.height * 100) + '% + 1.5px)';
  } else {
    left = (x * 100) + '%';
    top  = 'calc(' + (y * 100) + '% + 1.5px)';
  }
  pin.style.left = left;
  pin.style.top  = top;
  pin.style.setProperty('--drop-h', DROP_HEIGHT + 'px');
  pin.hidden = false;
  // 影をクリック地点に固定
  var shadow = document.getElementById('reactionsMyPinShadow');
  if (shadow) {
    shadow.style.left = left;
    shadow.style.top  = top;
    shadow.hidden = false;
  }
  var svg = document.getElementById('reactionsMyPinSvg');
  // 既存タイマーを必ずクリアしてから設定（再クリック時の重複防止）
  if (_myPinOnDrop) {
    pin.removeEventListener('animationend', _myPinOnDrop);
    _myPinOnDrop = null;
  }

  // 既存アニメーションをキャンセルしてリセット
  pin.classList.remove('color-cycling');
  pin.getAnimations().forEach(function(a) { a.cancel(); });
  svg.getAnimations().forEach(function(a) { a.cancel(); });
  pin.style.transform = '';
  pin.style.opacity   = '';
  pin.style.animation = 'none';
  svg.style.animation = 'none';
  pin.offsetWidth; // reflow

  if (withAnim) {
    pin.style.animation = 'reactionsPinDrop ' + DROP_SPEED + 's linear forwards';
    svg.style.animation = 'reactionsPinSvgSquash ' + DROP_SPEED + 's linear forwards';
    pin.animate(
      [
        { opacity: 0, offset: 0 },
        { opacity: 1, offset: FADE_IN_FRAC },
        { opacity: 1, offset: 1 },
      ],
      { duration: DROP_SPEED * 1000, fill: 'forwards', easing: 'linear' }
    );
    // drop完了後にフロート + カラーサイクルへ切り替え、rs-floating 付与
    _myPinOnDrop = function(e) {
      if (e.animationName !== 'reactionsPinDrop') return;
      _myPinOnDrop = null;
      var floatDur = (2.4 + Math.random() * 0.8).toFixed(2) + 's';
      pin.style.animation = 'reactionsPinFloat ' + floatDur + ' ease-in-out infinite';
      svg.style.animation = '';
      pin.classList.add('color-cycling', 'rs-floating');
    };
    pin.addEventListener('animationend', _myPinOnDrop);
  } else {
    // 復元時: 即座に着地位置に表示 + float + カラーサイクル
    pin.style.transform = 'translate(-50%, -100%)';
    pin.style.opacity   = '1';
    var floatDur = (2.4 + Math.random() * 0.8).toFixed(2) + 's';
    pin.style.animation = 'reactionsPinFloat ' + floatDur + ' ease-in-out infinite';
    svg.style.animation = '';
    pin.classList.add('color-cycling', 'rs-floating');
  }
}

function openReactionsMode(videoId) {
  if (!videoId) return;
  if (_reactionsStopPlayback) _reactionsStopPlayback();
  _reactionsCurrentVideoId = videoId;
  _reactionsPins = [];
  _reactionsKde  = null;
  // 再生リスト以外からの遷移は初期状態に戻す
  if (!_isPlaylistSwitch) {
    _reactionsPinsVisible    = true;
    _reactionsHeatmapVisible = false;
    if (_reactionsResetTransport) _reactionsResetTransport();
  }
  _isPlaylistSwitch = false;
  document.getElementById('reactionsPinsModeBtn').classList.toggle('active', _reactionsPinsVisible);
  document.getElementById('reactionsHeatmapModeBtn').classList.toggle('active', _reactionsHeatmapVisible);
  var _hmLayerReset = document.getElementById('reactionsHeatmapLayer');
  _hmLayerReset.style.cssText = 'opacity:0;visibility:hidden;';  // 旧inline styleを完全クリア
  _hmLayerReset.innerHTML = '';  // 動画切り替え時に前の canvas を破棄
  var _pinsLayerReset = document.getElementById('reactionsPinsLayer');
  _pinsLayerReset.style.cssText = 'visibility:' + (_reactionsPinsVisible ? 'visible' : 'hidden') + ';';  // 旧inline styleを完全クリア
  _pinsLayerReset.innerHTML = '';
  document.getElementById('reactionsMyPin').hidden = true;
  var myPinShadow = document.getElementById('reactionsMyPinShadow');
  if (myPinShadow) myPinShadow.hidden = true;
  // 前回の注目エリア透過状態・一時停止状態をリセットし、現在の状態で再適用
  var _imgWrap = document.getElementById('reactionsImgWrap');
  if (_imgWrap) {
    _imgWrap.classList.remove('rs-paused');
  }
  // パレットをCSS変数に適用（ヒートマップ・ピン両方が --pin-c0/1/2 を継承）
  applyPinPalette();
  // seeds 取得してアニメーション開始（サーバーからの自分のピン復元も含む）
  loadReactionSeeds(videoId).then(function(seeds) {
    _reactionsSeeds = seeds;
    if (_reactionsHeatmapVisible) {
      var _hmEl = document.getElementById('reactionsHeatmapLayer');
      _hmEl.style.visibility = 'visible';
      _hmEl.style.opacity    = '1';
      renderReactionsHeatmap();
    }
    // ピン表示状態に関わらず常に再生開始（非表示中も裏で降り続ける）
    setTimeout(function() {
      if (_reactionsStartPlayback) _reactionsStartPlayback(); else startReactionsLoop();
    }, 200);
  });
}

function closeReactionsMode() {
  _reactionsActive = false;
  stopReactionsResizeObserver();
  document.getElementById('reactionsPinsLayer').innerHTML = '';
  document.getElementById('reactionsMyPin').hidden = true;
  var shadow = document.getElementById('reactionsMyPinShadow');
  if (shadow) shadow.hidden = true;
  var imgWrap = document.getElementById('reactionsImgWrap');
  if (imgWrap) imgWrap.classList.remove('heatmap-visible');
  if (currentView === 'reactions') {
    showView(_prevView || 'list');
  }
}

let _modalCurrentV = null;
function openThumbModal({ v, idx, rating, wins, battles, wr, barPct, videoUrl, medal }) {
  _modalCurrentV = v;
  _reactionsCurrentVideoId = v.id;
  closeReactionsMode();
  const modal = document.getElementById('thumbModal');
  document.getElementById('modalImg').src = v.thumb;
  document.getElementById('modalImg').onerror = function() { this.src = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`; };
  document.getElementById('modalBadge').textContent = medal;
  document.getElementById('modalTitle').textContent = v.title;
  document.getElementById('modalStats').innerHTML =
    `<div><strong>${Math.round(rating)}</strong><br>${t('rating-label')}</div>` +
    `<div><strong>${battles}</strong><br>${t('battles-label')}</div>` +
    `<div><strong>${wins}</strong><br>${t('wins-label')}</div>` +
    (battles > 0 ? `<div><strong>${wr}%</strong><br>${t('winrate-label')}</div>` : '') +
    `<div><strong>#${idx + 1}</strong><br>${t('rank-label')}</div>`;
  document.getElementById('modalYtBtn').href = videoUrl;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeThumbModal() {
  document.getElementById('thumbModal').classList.remove('open');
  document.body.style.overflow = '';
}

// ギャラリーからリアクション全画面で開く
function openModalReactions(v) {
  if (currentView !== 'reactions') _prevView = currentView;
  var img = document.getElementById('reactionsImg');
  img.onload = function() {
    requestAnimationFrame(function() {
      adjustReactionsLayers();
      startReactionsResizeObserver();
    });
  };
  img.src = v.thumb;
  img.onerror = function() {
    this.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg';
    requestAnimationFrame(adjustReactionsLayers);
  };
  var ytUrl = v.url || 'https://www.youtube.com/watch?v=' + v.id;
  var titleEl = document.getElementById('reactionsTitle');
  titleEl.textContent = v.title || '';
  titleEl.href = ytUrl;
  document.getElementById('reactionsVideoMeta').innerHTML = _buildVideoMeta(v) + _buildPinDot(v);
  if (v.id !== _reactionsCurrentVideoId) openReactionsMode(v.id);
  showView('reactions');
  renderReactionsPlaylist(v.id);
}

function _refreshVideoMeta() {
  var v = (allVideos || []).find(function(x) { return x.id === _reactionsCurrentVideoId; });
  var el = document.getElementById('reactionsVideoMeta');
  if (v && el) el.innerHTML = _buildVideoMeta(v) + _buildPinDot(v);
}

function renderReactionsPlaylist(selectedId) {
  _rebuildRatingRankMap();
  var pool = _buildSortedPool();
  var countEl = document.getElementById('reactionsPlaylistCount');
  var labelEl = document.getElementById('rsPanelLabel');
  var body = document.getElementById('reactionsPlaylistBody');
  if (!body) return;
  body.innerHTML = '';
  if (countEl) countEl.textContent = pool.length;
  if (labelEl) {
    var CAT_LABELS = { videos: '動画', shorts: 'ショート', live: 'ライブ' };
    labelEl.textContent = CAT_LABELS[currentCat] || '動画';
  }
  pool.forEach(function(v, i) {
    var card = document.createElement('div');
    card.className = 'rs-playlist-card' + (v.id === selectedId ? ' selected' : '');
    var metaHtml = _buildVideoMeta(v);
    var pinDot = _buildPinDot(v);
    card.innerHTML =
      '<div class="rs-playlist-thumb">' +
        '<img src="' + v.thumb + '" alt="" loading="lazy" referrerpolicy="no-referrer"' +
        ' onerror="this.src=\'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg\'">' +
      '</div>' +
      '<div class="rs-playlist-info" title="' + v.title.replace(/"/g, '&quot;') + '">' +
        '<div class="rs-playlist-title">' + v.title + '</div>' +
        '<div class="rs-playlist-meta gallery-meta">' + metaHtml + pinDot + '</div>' +
      '</div>';
    card.addEventListener('click', (function(vid) {
      return function() { _isPlaylistSwitch = true; openModalReactions(vid); };
    }(v)));
    body.appendChild(card);
  });
  var selected = body.querySelector('.selected');
  if (selected) selected.scrollIntoView({ block: 'nearest' });
}

document.getElementById('modalClose').addEventListener('click', closeThumbModal);
document.getElementById('thumbModal').addEventListener('click', e => {
  if (e.target === document.getElementById('thumbModal')) closeThumbModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeThumbModal();
  }
});
document.getElementById('modalReactionsBtn').addEventListener('click', function() {
  if (!_modalCurrentV) return;
  var v = _modalCurrentV;
  closeThumbModal();
  openModalReactions(v);
});

const TAB_IDS  = {};
const CAT_VIEWS = ['vote', 'list', 'ranking'];

function showView(view) {
  currentView = view;
  if (CAT_VIEWS.includes(view)) localStorage.setItem(LS_VIEW, view);
  SCREENS.forEach(s => {
    const el = document.getElementById(s + 'Screen');
    if (!el) return;
    if (s === view) {
      el.style.removeProperty('display');
    } else {
      el.style.display = 'none';
    }
  });
  document.querySelectorAll('.ch-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === view);
  });
  if (view === 'vote') renderVote();
  else if (view === 'list') renderList();
  else if (view === 'ranking') renderRanking();
}

// --- サイドバー検索・チャンネル追加 ---
async function addChannelFromSidebarInput() {
  const rawInput = document.getElementById('sidebarSearchInput').value.trim();
  if (!rawInput) return;
  let raw;
  try { raw = decodeURIComponent(rawInput); } catch { raw = rawInput; }

  const statusEl  = document.getElementById('sidebarSearchStatus');
  const searchBtn = document.getElementById('sidebarSearchBtn');

  // @handle を正規化 (URL入力にも対応)
  const handleMatch = raw.match(/@([^\s/?#&]+)/);
  // 動画 URL から video ID を抽出
  const videoIdMatch = !handleMatch && raw.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/|v\/))([A-Za-z0-9_-]{11})/
  );

  if (!handleMatch && !videoIdMatch) {
    statusEl.textContent = t('invalid-url');
    return;
  }

  const postBody = handleMatch
    ? { handle: '@' + handleMatch[1] }
    : { videoId: videoIdMatch[1] };

  // DB 既登録チェック (handle の場合のみ)
  if (postBody.handle) {
    const handle = postBody.handle;
    const existing = Object.values(channels).find(ch => ch.handle === handle);
    if (existing) {
      showToast(t('channel-already-added', { name: existing.displayName || existing.handle || handle }));
      statusEl.textContent = '';
      statusEl.className = 'sidebar-search-status';
      renderSidebar();
      await selectChannel(existing.key);
      return;
    }
  }

  searchBtn.disabled = true;
  statusEl.textContent = t('fetching-channel');
  statusEl.className = 'sidebar-search-status';

  try {
    const res = await fetch('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(getRssOnly() ? { 'X-RSS-Only': '1' } : apiKeyHeaders()) },
      body: JSON.stringify(postBody),
    });
    const data = await res.json();
    if (!res.ok) {
      statusEl.textContent = t('error-msg', { msg: data.error ?? res.status });
      return;
    }
    const ch = data.channel;
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
    statusEl.textContent = '';
    // nav.innerHTML='' による全破棄を避け、新規アイテムのみ追加する（ホバー状態保持）
    const _nav = document.getElementById('sidebarNav');
    const _newItem = buildChannelItem(channels[ch.channel_id]);
    _nav.appendChild(_newItem);
    await selectChannel(ch.channel_id);
    // API キーが設定されていれば全件取得を自動実行
    if (getStoredApiKey() && !getRssOnly()) {
      try {
        const count = await importAllChannelVideos(ch.channel_id, msg => { statusEl.textContent = msg; });
        allVideos = await fetchChannelVideos(ch.channel_id);
        if (currentView === 'vote') renderVote();
        else if (currentView === 'list') renderList();
        else if (currentView === 'ranking') renderRanking();
        statusEl.textContent = count + ' 件取得完了';
        setTimeout(() => { statusEl.textContent = ''; }, 3000);
      } catch (importErr) {
        if (importErr.code === 'API_KEY_INVALID') {
          markApiKeyError();
          statusEl.textContent = t('err-apikey-invalid-details');
        } else {
          statusEl.textContent = importErr.message;
        }
        statusEl.className = 'sidebar-search-status error';
      }
    }
  } catch (e) {
    statusEl.textContent = t('error-msg', { msg: e.message });
  } finally {
    searchBtn.disabled = false;
  }
}

// --- テーマ ---
var _theme = localStorage.getItem('thumb-theme') || 'dark';

function applyTheme(theme) {
  _theme = theme;
  localStorage.setItem('thumb-theme', theme);
  document.documentElement.dataset.theme = theme;
  const darkBtn  = document.getElementById('settingsThemeDark');
  const lightBtn = document.getElementById('settingsThemeLight');
  if (darkBtn)  darkBtn.classList.toggle('active', theme === 'dark');
  if (lightBtn) lightBtn.classList.toggle('active', theme === 'light');
  if (typeof lucide !== 'undefined') lucide.createIcons();
}

// --- 初期化 ---
function init() {
  // 保存済み状態を即座に DOM へ反映（チャンネル選択前の切り替わりを防ぐ）
  document.querySelectorAll('.cat-seg-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.cat === currentCat);
  });
  // ソートスプリットボタン初期化
  var _sortLabel  = document.getElementById('sortSplitLabel');
  var _sortDirBtn = document.getElementById('sortSplitDir');
  var _SVG_SORT_DESC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/></svg>';
  var _SVG_SORT_ASC  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M11 12h4"/><path d="M11 16h7"/><path d="M11 20h10"/></svg>';
  var _sortPopup  = document.getElementById('sortPopup');
  var SORT_INFO = {
    views:  { label: '再生数順', hasDir: true },
    date:   { label: '投稿日順', hasDir: true },
    rating: { label: '得票率順', hasDir: true },
    random: { label: 'ランダム', hasDir: false },
  };
  function _updateSortUI() {
    var info = SORT_INFO[_listSortOrder] || SORT_INFO.views;
    if (_sortLabel)  _sortLabel.textContent = info.label;
    if (_sortDirBtn) {
      _sortDirBtn.style.visibility = info.hasDir ? '' : 'hidden';
      _sortDirBtn.innerHTML = (_sortDir === 'asc') ? _SVG_SORT_ASC : _SVG_SORT_DESC;
      _sortDirBtn.classList.toggle('asc', _sortDir === 'asc');
    }
    if (_sortPopup) {
      _sortPopup.querySelectorAll('[data-sort]').forEach(function(el) {
        el.classList.toggle('active', el.dataset.sort === _listSortOrder);
      });
    }
    var _rsLabel  = document.getElementById('rsSortLabel');
    var _rsDirBtn = document.getElementById('rsSortDir');
    var _rsPopup  = document.getElementById('rsSortPopup');
    if (_rsLabel) _rsLabel.textContent = info.label;
    if (_rsDirBtn) {
      _rsDirBtn.style.visibility = info.hasDir ? '' : 'hidden';
      _rsDirBtn.innerHTML = (_sortDir === 'asc') ? _SVG_SORT_ASC : _SVG_SORT_DESC;
      _rsDirBtn.classList.toggle('asc', _sortDir === 'asc');
    }
    if (_rsPopup) {
      _rsPopup.querySelectorAll('[data-sort]').forEach(function(el) {
        el.classList.toggle('active', el.dataset.sort === _listSortOrder);
      });
    }
  }
  function _triggerSortRender() {
    if (currentView === 'reactions') renderReactionsPlaylist(_reactionsCurrentVideoId);
    else if (currentView === 'ranking') renderRanking();
    else if (_listMode === 'grid') _renderGrid();
    else renderList();
  }
  _updateSortUI();
  if (document.getElementById('sortSplitKey')) {
    document.getElementById('sortSplitKey').addEventListener('click', function(e) {
      e.stopPropagation();
      _sortPopup.classList.toggle('open');
    });
  }
  if (_sortPopup) {
    _sortPopup.addEventListener('click', function(e) {
      var item = e.target.closest('[data-sort]');
      if (!item) return;
      _listSortOrder = item.dataset.sort;
      _sortDir = 'desc';
      localStorage.setItem(LS_SORT, _listSortOrder);
      localStorage.setItem('thumb-sort-dir', _sortDir);
      _sortPopup.classList.remove('open');
      _updateSortUI();
      _triggerSortRender();
    });
  }
  if (_sortDirBtn) {
    _sortDirBtn.addEventListener('click', function() {
      if (!(SORT_INFO[_listSortOrder] || {}).hasDir) return;
      _sortDir = (_sortDir === 'asc') ? 'desc' : 'asc';
      localStorage.setItem('thumb-sort-dir', _sortDir);
      _updateSortUI();
      _triggerSortRender();
    });
  }
  document.addEventListener('click', function() {
    if (_sortPopup) _sortPopup.classList.remove('open');
    var _rsPopupClose = document.getElementById('rsSortPopup');
    if (_rsPopupClose) _rsPopupClose.classList.remove('open');
  });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
      if (_sortPopup) _sortPopup.classList.remove('open');
      var _rsPopupEsc = document.getElementById('rsSortPopup');
      if (_rsPopupEsc) _rsPopupEsc.classList.remove('open');
    }
  });

  // reactions プレイリスト ソート
  var _rsSortKey = document.getElementById('rsSortKey');
  var _rsSortDir = document.getElementById('rsSortDir');
  var _rsSortPopup = document.getElementById('rsSortPopup');
  if (_rsSortKey) {
    _rsSortKey.addEventListener('click', function(e) {
      e.stopPropagation();
      if (_rsSortPopup) _rsSortPopup.classList.toggle('open');
    });
  }
  if (_rsSortPopup) {
    _rsSortPopup.addEventListener('click', function(e) {
      var item = e.target.closest('[data-sort]');
      if (!item) return;
      _listSortOrder = item.dataset.sort;
      _sortDir = 'desc';
      localStorage.setItem(LS_SORT, _listSortOrder);
      localStorage.setItem('thumb-sort-dir', _sortDir);
      _rsSortPopup.classList.remove('open');
      _updateSortUI();
      _triggerSortRender();
    });
  }
  if (_rsSortDir) {
    _rsSortDir.addEventListener('click', function() {
      if (!(SORT_INFO[_listSortOrder] || {}).hasDir) return;
      _sortDir = (_sortDir === 'asc') ? 'desc' : 'asc';
      localStorage.setItem('thumb-sort-dir', _sortDir);
      _updateSortUI();
      _triggerSortRender();
    });
  }

  // 一覧モード切り替えボタンの初期状態を反映
  var _galBtn  = document.getElementById('listModeGalleryBtn');
  var _gridBtn = document.getElementById('listModeGridBtn');
  if (_listMode === 'grid') {
    _galBtn.classList.remove('active');
    _gridBtn.classList.add('active');
  }
  _galBtn.addEventListener('click', function() {
    _listMode = 'gallery';
    localStorage.setItem('thumb-list-mode', 'gallery');
    _galBtn.classList.add('active');
    _gridBtn.classList.remove('active');
    renderList();
  });
  _gridBtn.addEventListener('click', function() {
    _listMode = 'grid';
    localStorage.setItem('thumb-list-mode', 'grid');
    _gridBtn.classList.add('active');
    _galBtn.classList.remove('active');
    renderList();
  });

  // チャンネル名ツールチップ要素を一度だけ生成
  _chTooltip = document.createElement('div');
  _chTooltip.className = 'ch-tooltip';
  _chTooltipNameEl = document.createElement('div');
  _chTooltipNameEl.className = 'ch-tooltip-name';
  _chTooltipActionsEl = document.createElement('div');
  _chTooltipActionsEl.className = 'ch-tooltip-actions';
  _chTooltip.appendChild(_chTooltipNameEl);
  _chTooltip.appendChild(_chTooltipActionsEl);
  _chTooltip.addEventListener('mouseenter', function() {
    if (_chTooltipHideTimer) { clearTimeout(_chTooltipHideTimer); _chTooltipHideTimer = null; }
  });
  _chTooltip.addEventListener('mouseleave', function() { _hideCompactTooltip(150); });
  document.addEventListener('keydown', function(e) {
    if (e.key === 'F2' && _chTooltip.classList.contains('visible') && _chTooltipF2Action && !_chTooltipLocked) {
      e.preventDefault();
      e.stopPropagation();
      _chTooltipF2Action();
    }
  }, true);
  document.body.appendChild(_chTooltip);


  // コンパクトモード: チャンネル追加ポップオーバーを生成
  const _compactAddBtn = document.getElementById('sidebarCompactAddBtn');
  const _compactAddPop = document.createElement('div');
  _compactAddPop.className = 'sidebar-compact-add-pop';
  _compactAddPop.hidden = true;
  _compactAddPop.innerHTML =
    '<div class="sidebar-compact-add-input-row">' +
    '<input class="sidebar-compact-add-input" id="sidebarCompactInput" type="text" autocomplete="off" placeholder="URL / @handle">' +
    '<button class="sidebar-compact-add-submit" id="sidebarCompactSubmit">' +
    '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>' +
    '</button></div>' +
    '<div class="sidebar-compact-add-status" id="sidebarCompactStatus"></div>';
  document.body.appendChild(_compactAddPop);

  // sidebarSearchStatus の変化をコンパクトステータスに転写
  new MutationObserver(function() {
    const cst = document.getElementById('sidebarCompactStatus');
    if (!cst || _compactAddPop.hidden) return;
    const src = document.getElementById('sidebarSearchStatus');
    cst.textContent = src.textContent;
    cst.className = 'sidebar-compact-add-status' +
      (src.classList.contains('error') ? ' error' : src.classList.contains('ok') ? ' ok' : '');
  }).observe(document.getElementById('sidebarSearchStatus'), { childList: true, characterData: true, subtree: true });

  function _openCompactPop() {
    const rect = _compactAddBtn.getBoundingClientRect();
    _compactAddPop.hidden = false;
    _compactAddPop.style.top  = rect.top + 'px';
    _compactAddPop.style.left = (rect.right + 8) + 'px';
    requestAnimationFrame(function() { _compactAddPop.classList.add('visible'); });
    const inp = document.getElementById('sidebarCompactInput');
    inp.value = '';
    document.getElementById('sidebarCompactStatus').textContent = '';
    inp.focus();
  }
  function _closeCompactPop() {
    _compactAddPop.classList.remove('visible');
    setTimeout(function() { _compactAddPop.hidden = true; }, 160);
  }
  async function _submitCompactAdd() {
    const inp = document.getElementById('sidebarCompactInput');
    const val = inp.value.trim();
    if (!val) return;
    inp.value = '';
    document.getElementById('sidebarSearchInput').value = val;
    await addChannelFromSidebarInput();
    setTimeout(_closeCompactPop, 2500);
  }

  _compactAddBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (_compactAddPop.hidden) _openCompactPop();
    else _closeCompactPop();
  });
  document.getElementById('sidebarCompactInput').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') _submitCompactAdd();
    if (e.key === 'Escape') { e.stopPropagation(); _closeCompactPop(); }
  });
  applyUrlDecodePaste(document.getElementById('sidebarCompactInput'));
  document.getElementById('sidebarCompactSubmit').addEventListener('click', _submitCompactAdd);
  document.addEventListener('click', function(e) {
    if (!_compactAddPop.hidden && !_compactAddPop.contains(e.target) && e.target !== _compactAddBtn) {
      _closeCompactPop();
    }
  });

  applyTheme(_theme);
  applyLang(_lang);
  _normalizeSortBtnWidths();
  if (typeof lucide !== 'undefined') lucide.createIcons();

  // F2 キー: フォーカス中のフォルダヘッダーをリネーム
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'F2') return;
    const focused = document.activeElement;
    if (!focused) return;
    const header = focused.closest('.sidebar-folder-header');
    if (!header) return;
    e.preventDefault();
    const btn = header.querySelector('.sidebar-folder-rename-btn');
    if (btn) btn.click();
  });

  loadRating();
  loadChannels();
  loadSidebarOrder();
  renderSidebar();
  initSidebarDrag();
  showView('welcome');

  // タイトルクリック → welcome 画面へ戻る
  document.querySelector('.app-logo').addEventListener('click', function() {
    currentChannelKey = null;
    allVideos = [];
    document.querySelectorAll('.sidebar-channel-item').forEach(el => el.classList.remove('active'));
    document.getElementById('chNoSelect').style.display = '';
    document.getElementById('chAvatar').style.display = 'none';
    document.getElementById('chName').style.display = 'none';
    document.getElementById('chTabs').style.display = 'none';
    document.getElementById('catFilter').style.display = 'none';
    showView('welcome');
  });

  // チャンネルヘッダー（アバター・チャンネル名）クリック → YouTube を別タブで開く
  function _openChannelOnYouTube() {
    if (!currentChannelKey) return;
    const ch = channels[currentChannelKey];
    if (!ch) return;
    const url = ch.handle
      ? 'https://www.youtube.com/' + ch.handle
      : 'https://www.youtube.com/channel/' + currentChannelKey;
    window.open(url, '_blank', 'noopener');
  }
  document.getElementById('chAvatar').addEventListener('click', _openChannelOnYouTube);
  document.getElementById('chName').addEventListener('click', _openChannelOnYouTube);

  // サーバーのチャンネルリストをローカルストレージへ自動同期（DBに登録済みのチャンネルを追加）
  (async function _syncChannelsFromServer() {
    try {
      const res = await fetch('/api/channels');
      if (!res.ok) return;
      const serverChannels = await res.json();
      let changed = false;
      for (const sc of serverChannels) {
        if (!channels[sc.channel_id]) {
          channels[sc.channel_id] = {
            key: sc.channel_id,
            channelId: sc.channel_id,
            handle: sc.handle,
            displayName: sc.title,
            avatar: sc.icon_url,
            tags: [],
            addedAt: new Date().toISOString(),
          };
          changed = true;
        }
        if (!sidebarOrder.some(i =>
          (i.type === 'channel' && i.key === sc.channel_id) ||
          (i.type === 'folder' && Array.isArray(i.children) && i.children.includes(sc.channel_id))
        )) {
          sidebarOrder.push({ type: 'channel', key: sc.channel_id });
          changed = true;
        }
      }
      if (changed) {
        saveChannels();
        saveSidebarOrder();
        renderSidebar();
      }
    } catch { /* サイレント失敗 */ }
  })();

  // ピン最大数スライダ
  (function() {
    var slider = document.getElementById('reactionsPinCountSlider');
    var valEl  = document.getElementById('reactionsPinCountVal');
    if (!slider) return;
    slider.value = REACTIONS_MAX_PINS;
    valEl.textContent = REACTIONS_MAX_PINS;
    function updateFill(v) {
      var pct = (v - parseFloat(slider.min)) / (parseFloat(slider.max) - parseFloat(slider.min)) * 100;
      slider.style.setProperty('--fill', pct.toFixed(1) + '%');
    }
    updateFill(REACTIONS_MAX_PINS);
    var _pinSliderDebounce = null;
    slider.addEventListener('input', function() {
      var raw = parseInt(this.value, 10);
      var snapped = PIN_SNAPS.reduce(function(a, b) {
        return Math.abs(b - raw) < Math.abs(a - raw) ? b : a;
      });
      this.value = snapped;
      var oldMax = REACTIONS_MAX_PINS;
      REACTIONS_MAX_PINS = snapped;
      localStorage.setItem(LS_MAX_PINS, snapped);
      valEl.textContent = snapped;
      updateFill(snapped);
      if (_reactionsSetVolFromPins) _reactionsSetVolFromPins(REACTIONS_MAX_PINS);
      if (_reactionsPinsVisible) {
        if (_reactionsAdjustPins) {
          _reactionsAdjustPins(oldMax, REACTIONS_MAX_PINS);
        } else {
          startReactionsLoop();
        }
      }
    });
  })();

  // ReactionPin: Pins / Heatmap 独立トグル
  document.getElementById('reactionsPinsModeBtn').addEventListener('click', function() {
    _reactionsPinsVisible = !_reactionsPinsVisible;
    localStorage.setItem(LS_PINS_VISIBLE, _reactionsPinsVisible ? '1' : '0');
    this.classList.toggle('active', _reactionsPinsVisible);
    // ミュートボタンと連動
    _mutedAll = !_reactionsPinsVisible;
    var _muteBtn = document.getElementById('rsMuteBtn');
    if (_muteBtn) _muteBtn.innerHTML = _mutedAll
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';
    var pinsLayer   = document.getElementById('reactionsPinsLayer');
    var myPin       = document.getElementById('reactionsMyPin');
    var myPinShadow = document.getElementById('reactionsMyPinShadow');
    if (_reactionsPinsVisible) {
      pinsLayer.style.visibility = 'visible';
      if (_reactionsRestoreMyPin) _reactionsRestoreMyPin();
    } else {
      pinsLayer.style.visibility = 'hidden';
      myPin.hidden = true;
      if (myPinShadow) myPinShadow.hidden = true;
    }
  });
  document.getElementById('reactionsHeatmapModeBtn').addEventListener('click', function() {
    _reactionsHeatmapVisible = !_reactionsHeatmapVisible;
    localStorage.setItem(LS_HEATMAP_VISIBLE, _reactionsHeatmapVisible ? '1' : '0');
    this.classList.toggle('active', _reactionsHeatmapVisible);
    var heatmapLayer = document.getElementById('reactionsHeatmapLayer');
    var imgWrap = document.getElementById('reactionsImgWrap');
    if (_reactionsHeatmapVisible) {
      heatmapLayer.style.visibility = 'visible';
      heatmapLayer.style.opacity    = '1';
      adjustReactionsLayers();
    } else {
      heatmapLayer.style.opacity    = '0';
      heatmapLayer.style.visibility = 'hidden';
      heatmapLayer.innerHTML = '';
    }
  });
  // reactionsBackBtn removed (reactions is now a tab)

  // ReactionPin: カラースウォッチ（統一パレット）
  document.querySelectorAll('.rs-swatch').forEach(function(btn) {
    var color = btn.dataset.color;
    if (color === _reactionsPinColor) {
      document.querySelectorAll('.rs-swatch').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
    }
    btn.addEventListener('click', function() {
      document.querySelectorAll('.rs-swatch').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      _reactionsPinColor = color;
      localStorage.setItem('reactions-pin-color', color);
      applyPinPalette();
      if (_reactionsHeatmapVisible) renderReactionsHeatmap();
      if (_reactionsPinsVisible) updatePinColors();
      // プレイリストのピンドット色を即時更新
      renderReactionsPlaylist(_reactionsCurrentVideoId);
      _refreshVideoMeta();
    });
  });

  // ReactionPin: imgWrap クリックで pin 配置（好きピン OFF 時はクリックで自動 ON）
  var _rsImgWrap = document.getElementById('reactionsImgWrap');
  var _rsDragFromTransport = false;
  _rsImgWrap.addEventListener('dragstart', function(e) { e.preventDefault(); });
  _rsImgWrap.addEventListener('mousedown', function(e) {
    _rsDragFromTransport = !!e.target.closest('#rsTransport');
  });
  // ---- 画像エリア: クリック = ピン配置（トランスポート要素上は除外） ----
  _rsImgWrap.addEventListener('click', function(e) {
    if (currentView !== 'reactions') return;
    if (e.target.closest('#rsTransport, #rsTransportToggleBtn')) return;
    if (_rsDragFromTransport) { _rsDragFromTransport = false; return; }
    // トランスポート強制非表示中のみピン配置
    if (!_reactionsPinsVisible) {
      _reactionsPinsVisible = true;
      localStorage.setItem(LS_PINS_VISIBLE, '1');
      document.getElementById('reactionsPinsModeBtn').classList.add('active');
      document.getElementById('reactionsPinsLayer').style.visibility = 'visible';
      var saved0 = _reactionsMyPins[_reactionsCurrentVideoId];
      if (saved0) showMyReactionsPin(saved0.x, saved0.y, true);
    }
    // 最大ピン数0→1: じぶんピンだけ表示できる状態にする
    if (REACTIONS_MAX_PINS === 0) {
      var _muteBtn2 = document.getElementById('rsMuteBtn');
      if (_muteBtn2) _muteBtn2.classList.remove('active');
      _mutedAll = false;
      REACTIONS_MAX_PINS = 1;
      localStorage.setItem(LS_MAX_PINS, 1);
      if (_reactionsAdjustPins) _reactionsAdjustPins(0, 1);
      if (_reactionsSetVolFromPins) _reactionsSetVolFromPins(1);
    }
    var rect = _rsImgWrap.getBoundingClientRect();
    var cx = e.clientX - rect.left;
    var cy = e.clientY - rect.top;
    var img = document.getElementById('reactionsImg');
    var nw = img.naturalWidth, nh = img.naturalHeight;
    if (!nw || !nh) return;
    var scale = Math.min(rect.width / nw, rect.height / nh);
    var iw = nw * scale, ih = nh * scale;
    var ix = (rect.width - iw) / 2, iy = (rect.height - ih) / 2;
    if (cx < ix || cx > ix + iw || cy < iy || cy > iy + ih) return;
    var xp = reactionsClamp((cx - ix) / iw, 0.01, 0.99);
    var yp = reactionsClamp((cy - iy) / ih, 0.01, 0.99);
    _reactionsMyPins[_reactionsCurrentVideoId] = { x: xp, y: yp };
    showMyReactionsPin(xp, yp, true);
    if (_reactionsCurrentVideoId) postReaction(_reactionsCurrentVideoId, xp, yp);
    renderReactionsPlaylist(_reactionsCurrentVideoId);
    _refreshVideoMeta();
  });

  // 1分ごとに list/ranking 画面の動画を再取得して新着を反映
  setInterval(_pollRefresh, 60000);
}

// --- URL デコードペースト（全チャンネルURL入力欄共通） ---
function applyUrlDecodePaste(el) {
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
(function() {
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
}());

// --- 設定モーダル ---
(function() {
  const settingsBtn   = document.getElementById('settingsBtn');
  const settingsModal = document.getElementById('settingsModal');
  const closeBtn      = document.getElementById('settingsModalClose');
  const heading       = document.getElementById('settingsModalHeading');

  var _currentTab = localStorage.getItem(LS_SETTINGS_TAB) || 'display';

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
    if (name === 'apikey') {
      showDisplayMode();
    }
    if (name === 'lang' && typeof rebuildLangDialog === 'function') rebuildLangDialog();
  }

  // ---- 開閉 ----
  function openSettings() {
    applyTheme(_theme);
    if (typeof rebuildLangDialog === 'function') rebuildLangDialog();
    switchTab(_currentTab);
    settingsModal.hidden = false;
    if (typeof lucide !== 'undefined') lucide.createIcons();
  }

  function closeSettings() {
    settingsModal.hidden = true;
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
      statusEl.textContent = t('err-apikey-invalid-details');
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
      statusEl.textContent = t('settings-apikey-err-empty');
      statusEl.style.color = 'var(--err)';
      return;
    }
    if (!/^AIzaSy[A-Za-z0-9_-]{33}$/.test(val)) {
      statusEl.textContent = t('settings-apikey-err-format');
      statusEl.style.color = 'var(--err)';
      return;
    }
    localStorage.setItem(LS_API_KEY, val);
    _apiKeyErrorState = false;
    const badge = document.getElementById('apikeyNavBadge');
    if (badge) badge.hidden = true;
    updateIndicator();
    deleteBtn.hidden = false;
    statusEl.textContent = t('settings-apikey-saved');
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
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
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
        const parsed = JSON.parse(ev.target.result);
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
      } catch (err) {
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

  updateIndicator();
}());

// --- チャンネルヘッダーのタブ ---
document.getElementById('channelHeader').addEventListener('click', e => {
  const tab = e.target.closest('.ch-tab');
  if (!tab) return;
  const view = tab.dataset.view;
  if (view === 'reactions') {
    if (!_reactionsCurrentVideoId) {
      const pool = filteredVideos();
      if (pool.length > 0) openModalReactions(pool[0]);
      return;
    }
    showView('reactions');
    renderReactionsPlaylist(_reactionsCurrentVideoId);
    return;
  }
  showView(view);
});

// --- カテゴリフィルタ ---
document.getElementById('catFilter').addEventListener('click', e => {
  const btn = e.target.closest('.cat-seg-btn');
  if (!btn) return;
  const newCat = btn.dataset.cat;
  currentCat = newCat;
  localStorage.setItem(LS_CAT, currentCat);
  document.querySelectorAll('.cat-seg-btn').forEach(b => b.classList.toggle('active', b === btn));
  if (currentView === 'vote') renderVote();
  else if (currentView === 'list') renderList();
  else if (currentView === 'ranking') renderRanking();
  else if (currentView === 'reactions') renderReactionsPlaylist(_reactionsCurrentVideoId);
});

// --- チュートリアル ---
(function() {
  var el = document.getElementById('voteTutorial');
  if (!el) return;
  var LS_KEY = 'thumb-vote-tutorial-seen';
  if (localStorage.getItem(LS_KEY)) {
    el.style.display = 'none';
    return;
  }
  document.getElementById('voteTutorialClose').addEventListener('click', function() {
    localStorage.setItem(LS_KEY, '1');
    el.style.display = 'none';
  });
})();

// --- サイドバーリサイズ ---
(function() {
  const handle = document.getElementById('sidebarResizeHandle');
  const sidebar = document.getElementById('sidebar');
  const STORAGE_KEY = 'sidebar-width';
  const COMPACT_THRESHOLD = 100;
  const COMPACT_WIDTH = 72;

  function applyCompact(w, rerender) {
    const wasCompact = sidebar.classList.contains('sidebar--compact');
    const isNowCompact = w <= COMPACT_WIDTH;
    sidebar.classList.toggle('sidebar--compact', isNowCompact);
    if (rerender && wasCompact !== isNowCompact) renderSidebar();
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const w = parseInt(saved);
    sidebar.style.width = w + 'px';
    applyCompact(w, false);
  }

  let startX, startW, _rafId = null;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  function onMove(e) {
    var clientX = e.clientX;
    if (_rafId) return;
    _rafId = requestAnimationFrame(function() {
      _rafId = null;
      var w = startW + clientX - startX;
      if (w < COMPACT_THRESHOLD) w = COMPACT_WIDTH;
      w = Math.min(400, Math.max(COMPACT_WIDTH, w));
      sidebar.style.width = w + 'px';
      applyCompact(w, true);
    });
  }
  function onUp() {
    handle.classList.remove('dragging');
    localStorage.setItem(STORAGE_KEY, sidebar.offsetWidth);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
})();

// --- リアクションプレイリストリサイズ（無効）---

// ===== Reactions Transport =====
(function() {
  var transportEl   = document.getElementById('rsTransport');
  var toggleBtn     = document.getElementById('rsTransportToggleBtn');
  var playBtn       = document.getElementById('rsPlayBtn');
  var stopBtn       = document.getElementById('rsStopBtn');
  var muteBtn       = document.getElementById('rsMuteBtn');
  var screenshotBtn = document.getElementById('rsScreenshotBtn');
  var theaterBtn    = document.getElementById('rsTheaterBtn');
  var fullscreenBtn = document.getElementById('rsFullscreenBtn');
  var imgWrap       = document.getElementById('reactionsImgWrap');
  var volTrack      = document.getElementById('rsVolTrack');
  var volFill       = document.getElementById('rsVolFill');
  var volThumb      = document.getElementById('rsVolThumb');
  var volWrap       = document.getElementById('rsTransportVol');
  var progressTrack = document.getElementById('rsProgressTrack');
  var progressFill  = document.getElementById('rsProgressFill');
  var progressThumb = document.getElementById('rsProgressThumb');
  var timeLabel     = document.getElementById('rsTimeLabel');

  var _transportVisible = true;
  var _playing   = false;
  // vol 0-100 にピン最大数をマッピング: PIN_SNAPS インデックス基準で初期化
  var _pinInitIdx = PIN_SNAPS.indexOf(REACTIONS_MAX_PINS);
  var _vol = _pinInitIdx >= 0
    ? Math.round(_pinInitIdx / (PIN_SNAPS.length - 1) * 100)
    : Math.round(REACTIONS_MAX_PINS / 30 * 100);
  var _fsIdleTimer = null;
  var _peekTimer    = null;
  var _duration     = 4;
  var _currentTime  = 0;
  var _rafId        = null;
  var _lastRafTs    = null;
  var _placedPins   = [];
  var _emittedCount = 0;
  var _myPinEmitAt  = -1;  // あなたピンのemitAt (-1=ピンなし)
  var _myPinEmitted = false;

  var _SVG_PLAY  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
  var _SVG_PAUSE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
  var _SVG_VOLX  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>';
  var _SVG_VOL2  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>';

  // 初期状態を適用
  transportEl.classList.add('visible');

  // Transport 表示切替
  toggleBtn.addEventListener('click', function() {
    _transportVisible = !_transportVisible;
    toggleBtn.classList.toggle('active', _transportVisible);
    transportEl.classList.toggle('rs-transport-off', !_transportVisible);
    if (_transportVisible) {
      clearTimeout(_peekTimer);
      transportEl.classList.remove('rs-transport-peek');
      void transportEl.offsetWidth;
      transportEl.classList.add('rs-transport-peek');
      _peekTimer = setTimeout(function() { transportEl.classList.remove('rs-transport-peek'); }, 1000);
    }
  });

  imgWrap.addEventListener('mouseenter', function() {
    if (transportEl.classList.contains('rs-transport-peek')) {
      clearTimeout(_peekTimer);
      transportEl.classList.remove('rs-transport-peek');
    }
  });

  // ---- タイムライン: 再生進行・シーク ----
  function _fmtTime(s) {
    var m   = Math.floor(s / 60);
    var sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
  }
  function _updateProgressUI() {
    var pct = _duration > 0 ? _currentTime / _duration * 100 : 0;
    progressFill.style.width = pct + '%';
    progressThumb.style.left = pct + '%';
    timeLabel.textContent = _fmtTime(_currentTime) + ' / ' + _fmtTime(_duration);
  }
  // max=1 はあなたピン専用: みんなピンは表示しない
  function _communityLimit(max) { return max === 1 ? 0 : max; }

  function _emitPinsUpTo(time) {
    var pinsLayer = document.getElementById('reactionsPinsLayer');
    if (!pinsLayer) return;
    var cLimit = _communityLimit(REACTIONS_MAX_PINS);
    while (_emittedCount < _placedPins.length && _emittedCount < cLimit && _placedPins[_emittedCount].emitAt <= time) {
      var p = _placedPins[_emittedCount++];
      pinsLayer.appendChild(makeReactionsPinEl(p.x, p.y, p.density, false, p));
    }
    // あなたピン (max=0のときは非表示)
    if (!_myPinEmitted && _myPinEmitAt >= 0 && time >= _myPinEmitAt && REACTIONS_MAX_PINS > 0) {
      var saved = _reactionsMyPins[_reactionsCurrentVideoId];
      if (saved && _reactionsPinsVisible) {
        showMyReactionsPin(saved.x, saved.y, true);
        _myPinEmitted = true;
      }
    }
  }
  function _seekTo(time) {
    _currentTime  = Math.max(0, Math.min(_duration, time));
    _emittedCount = 0;
    var pinsLayer = document.getElementById('reactionsPinsLayer');
    if (pinsLayer) {
      pinsLayer.innerHTML = '';
      var cLimit = _communityLimit(REACTIONS_MAX_PINS);
      for (var i = 0; i < _placedPins.length; i++) {
        if (i >= cLimit) break;
        if (_currentTime > 0 && _placedPins[i].emitAt <= _currentTime) {
          pinsLayer.appendChild(makeReactionsPinEl(_placedPins[i].x, _placedPins[i].y, _placedPins[i].density, true, _placedPins[i]));
          _emittedCount++;
        } else {
          break;
        }
      }
    }
    // あなたピン: emitAt を過ぎていれば即表示、まだなら非表示（t=0またはmax=0は常に非表示）
    var myPin = document.getElementById('reactionsMyPin');
    var myPinShadow = document.getElementById('reactionsMyPinShadow');
    if (_myPinEmitAt >= 0 && _currentTime > 0 && _currentTime >= _myPinEmitAt && REACTIONS_MAX_PINS > 0) {
      var saved = _reactionsMyPins[_reactionsCurrentVideoId];
      if (saved && _reactionsPinsVisible && myPin && myPin.hidden) {
        showMyReactionsPin(saved.x, saved.y, false);
      }
      _myPinEmitted = true;
    } else {
      if (myPin) myPin.hidden = true;
      if (myPinShadow) myPinShadow.hidden = true;
      _myPinEmitted = false;
    }
    _updateProgressUI();
  }
  function _tick(ts) {
    if (!_playing) return;
    var dt = _lastRafTs != null ? (ts - _lastRafTs) / 1000 : 0;
    _lastRafTs   = ts;
    _currentTime = Math.min(_duration, _currentTime + dt);
    _updateProgressUI();
    _emitPinsUpTo(_currentTime);
    if (_currentTime < _duration) {
      _rafId = requestAnimationFrame(_tick);
    } else {
      _playing   = false;
      _lastRafTs = null;
      _rafId     = null;
      playBtn.innerHTML = _SVG_PLAY;
      // 再生完了後はアニメーションをそのまま継続
    }
  }
  function _startPlayback() {
    _reactionsActive = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    _playing = false;
    var pinsLayer = document.getElementById('reactionsPinsLayer');
    if (pinsLayer) pinsLayer.innerHTML = '';
    _placedPins = buildPlacedPins(30);
    if (!_placedPins.length) return;
    // あなたピンのemitAtをランダムに設定
    var saved = _reactionsMyPins[_reactionsCurrentVideoId];
    _myPinEmitted = false;
    var myPin = document.getElementById('reactionsMyPin');
    var myPinShadow = document.getElementById('reactionsMyPinShadow');
    if (myPin) myPin.hidden = true;
    if (myPinShadow) myPinShadow.hidden = true;
    // 5ストリームの先頭スロット(stream[0]=0ms)をあなたピンに割り当て、
    // stream[0] をその分だけ進めてからみんなピンに使う
    var streams = [0, 80, 160, 240, 320]; // ms
    if (saved) {
      _myPinEmitAt = streams[0] / 1000; // = 0
      streams[0] += 80 + Math.random() * 200;
    } else {
      _myPinEmitAt = -1;
    }
    for (var si = 0; si < _placedPins.length; si++) {
      var minIdx = 0;
      for (var k = 1; k < streams.length; k++) {
        if (streams[k] < streams[minIdx]) minIdx = k;
      }
      _placedPins[si].emitAt = streams[minIdx] / 1000;
      streams[minIdx] += 80 + Math.random() * 200;
    }
    _placedPins.sort(function(a, b) { return a.emitAt - b.emitAt; });
    // シーク時にピンの見た目が変わらないよう、乱数値を事前に固定する
    _placedPins.forEach(function(p) {
      var baseScale = 0.6 + 0.8 * p.density;
      p._scale    = baseScale + (Math.random() - 0.5) * 0.4;
      p._floatDur = (2.4 + Math.random() * 0.8).toFixed(2);
    });
    // duration をピン最後の emitAt に合わせる（最低1秒）
    var lastEmit = _placedPins.length > 0 ? _placedPins[_placedPins.length - 1].emitAt : 0;
    _duration = Math.max(1.0, lastEmit + 0.5);
    _emittedCount = 0;
    _currentTime  = 0;
    _playing      = true;
    _lastRafTs    = null;
    playBtn.innerHTML = _SVG_PAUSE;
    _updateProgressUI();
    var imgWrap = document.getElementById('reactionsImgWrap');
    if (imgWrap) imgWrap.classList.remove('rs-paused');
    _rafId = requestAnimationFrame(_tick);
  }
  _reactionsStartPlayback = _startPlayback;
  _reactionsStopPlayback = function() {
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    _playing = false;
  };
  _reactionsResetTransport = function() {
    _transportVisible = true;
    toggleBtn.classList.add('active');
    transportEl.classList.remove('rs-transport-off');
  };

  // ---- ピン表示数調整: 再アニメなしで増減 ----
  function _adjustPinDisplay(oldMax, newMax) {
    var pinsLayer = document.getElementById('reactionsPinsLayer');
    var myPin = document.getElementById('reactionsMyPin');
    var myPinShadow = document.getElementById('reactionsMyPinShadow');
    // あなたピンの表示: _placedPins の有無に関わらず先に処理
    if (newMax === 0) {
      if (myPin) myPin.hidden = true;
      if (myPinShadow) myPinShadow.hidden = true;
    } else if (oldMax === 0 || (oldMax > 1 && newMax === 1)) {
      // 0から復元、または 5以上→1 でもmyPinを復元
      var saved = _reactionsMyPins[_reactionsCurrentVideoId];
      if (saved && _reactionsPinsVisible && myPin && myPin.hidden) {
        // _myPinEmitAt < 0 は手動配置(即時表示)、>= 0 はタイムライン管理(時刻チェック)
        var shouldShow = _myPinEmitAt < 0 || (_currentTime > 0 && _currentTime >= _myPinEmitAt);
        if (shouldShow) showMyReactionsPin(saved.x, saved.y, false);
      }
    }
    if (!pinsLayer || !_placedPins.length) return;
    var oldLimit = _communityLimit(oldMax);
    var newLimit = _communityLimit(newMax);
    if (newLimit < oldLimit) {
      var rendered = pinsLayer.querySelectorAll('.reactions-pin');
      for (var i = rendered.length - 1; i >= newLimit; i--) {
        rendered[i].remove();
      }
      if (_emittedCount > newLimit) _emittedCount = newLimit;
    } else if (newLimit > oldLimit) {
      var toAdd = Math.min(newLimit, _placedPins.length);
      for (var i = _emittedCount; i < toAdd; i++) {
        if (_placedPins[i].emitAt <= _currentTime) {
          pinsLayer.appendChild(makeReactionsPinEl(_placedPins[i].x, _placedPins[i].y, _placedPins[i].density, true, _placedPins[i]));
          _emittedCount++;
        } else {
          break;
        }
      }
    }
  }
  _reactionsAdjustPins = _adjustPinDisplay;

  // ピン数 → vol に逆変換してボリュームUIを更新 (ツールバーIIFEから呼べるよう注入)
  _reactionsSetVolFromPins = function(pins) {
    var idx = PIN_SNAPS.indexOf(pins);
    _vol = idx >= 0 ? Math.round(idx / (PIN_SNAPS.length - 1) * 100) : Math.round(pins / 30 * 100);
    _applyVolAsPinCount();
    _updateVolUI();
  };

  // 現在時刻に応じてあなたピンを復元 (ツールバーIIFEから呼べるよう注入)
  _reactionsRestoreMyPin = function() {
    if (REACTIONS_MAX_PINS > 0) {
      var saved = _reactionsMyPins[_reactionsCurrentVideoId];
      if (saved && _reactionsPinsVisible) {
        var myPin = document.getElementById('reactionsMyPin');
        // _myPinEmitAt < 0 は手動配置(即時)、>= 0 はタイムライン管理(時刻チェック)
        var shouldShow = _myPinEmitAt < 0 || (_currentTime > 0 && _currentTime >= _myPinEmitAt);
        if (shouldShow && myPin && myPin.hidden) showMyReactionsPin(saved.x, saved.y, false);
      }
    }
    var imgWrap = document.getElementById('reactionsImgWrap');
    if (imgWrap) imgWrap.classList.remove('rs-paused');
  };

  // ---- 再生/一時停止 ----
  playBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (!_playing) {
      if (!_reactionsPinsVisible) return;
      if (_placedPins.length === 0 || _currentTime >= _duration) {
        _startPlayback();
      } else {
        // 再生中にピンを新規配置した場合 _myPinEmitAt が -1 のままなので更新
        if (_myPinEmitAt < 0 && _reactionsMyPins[_reactionsCurrentVideoId]) {
          _myPinEmitAt = 0;
          _myPinEmitted = false;
        }
        _playing   = true;
        _lastRafTs = null;
        playBtn.innerHTML = _SVG_PAUSE;
        var imgWrap = document.getElementById('reactionsImgWrap');
        if (imgWrap) imgWrap.classList.remove('rs-paused');
        // 自分ピン: フロート・カラーサイクルを再開
        var _myPinEl = document.getElementById('reactionsMyPin');
        if (_myPinEl && _myPinEl.classList.contains('rs-floating')) {
          _myPinEl.getAnimations({ subtree: true }).forEach(function(a) { a.play(); });
        }
        _rafId = requestAnimationFrame(_tick);
      }
    } else {
      if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
      _playing   = false;
      _lastRafTs = null;
      playBtn.innerHTML = _SVG_PLAY;
      var imgWrap = document.getElementById('reactionsImgWrap');
      if (imgWrap) imgWrap.classList.add('rs-paused');
      // 自分ピン: フロート・カラーサイクルだけ停止（ドロップ中は対象外）
      var _myPinEl = document.getElementById('reactionsMyPin');
      if (_myPinEl && _myPinEl.classList.contains('rs-floating')) {
        _myPinEl.getAnimations({ subtree: true }).forEach(function(a) { a.pause(); });
      }
    }
  });

  // ---- 停止: タイムラインリセット ----
  stopBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    _reactionsActive = false;
    _playing      = false;
    _currentTime  = 0;
    _emittedCount = 0;
    _placedPins   = [];
    _myPinEmitAt  = -1;
    _myPinEmitted = false;
    _lastRafTs    = null;
    playBtn.innerHTML = _SVG_PLAY;
    var pinsLayer = document.getElementById('reactionsPinsLayer');
    if (pinsLayer) pinsLayer.innerHTML = '';
    var myPin = document.getElementById('reactionsMyPin');
    var myPinShadow = document.getElementById('reactionsMyPinShadow');
    if (myPin) myPin.hidden = true;
    if (myPinShadow) myPinShadow.hidden = true;
    _updateProgressUI();
  });

  // ---- プログレスバー: シーク ----
  var _progressDragging = false;
  function _progressSeek(clientX) {
    if (_duration <= 0) return;
    var r = progressTrack.getBoundingClientRect();
    var pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    _seekTo(pct * _duration);
  }
  progressTrack.addEventListener('mousedown', function(e) {
    if (_duration <= 0) return;
    _progressDragging = true;
    progressTrack.classList.add('dragging');
    var pinsLayer = document.getElementById('reactionsPinsLayer');
    if (pinsLayer) pinsLayer.classList.add('rs-seeking');
    _progressSeek(e.clientX);
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener('mousemove', function(e) { if (_progressDragging) _progressSeek(e.clientX); });
  document.addEventListener('mouseup', function() {
    if (_progressDragging) {
      _progressDragging = false;
      progressTrack.classList.remove('dragging');
      var pinsLayer = document.getElementById('reactionsPinsLayer');
      if (pinsLayer) pinsLayer.classList.remove('rs-seeking');
    }
  });

  // ---- 音量UI: 好きピン表示状態を反映 ----
  function _updateVolUI() {
    var displayVol = _mutedAll ? 0 : _vol;
    volFill.style.height  = displayVol + '%';
    volThumb.style.bottom = displayVol + '%';
    muteBtn.innerHTML = _mutedAll ? _SVG_VOLX : _SVG_VOL2;
  }
  _updateVolUI();

  // ---- ミュートボタン: 自ピン + みんなピンレイヤー表示切替 ----
  var _mutedAll = false;
  muteBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    // pinsModeBtnと連動: ミュート = ピン非表示
    _reactionsPinsVisible = !_reactionsPinsVisible;
    localStorage.setItem(LS_PINS_VISIBLE, _reactionsPinsVisible ? '1' : '0');
    var pinsModeBtn = document.getElementById('reactionsPinsModeBtn');
    if (pinsModeBtn) pinsModeBtn.classList.toggle('active', _reactionsPinsVisible);
    var myPin       = document.getElementById('reactionsMyPin');
    var myPinShadow = document.getElementById('reactionsMyPinShadow');
    var pinsLayer   = document.getElementById('reactionsPinsLayer');
    _mutedAll = !_reactionsPinsVisible;
    if (_mutedAll) {
      if (myPin) myPin.hidden = true;
      if (myPinShadow) myPinShadow.hidden = true;
      if (pinsLayer) pinsLayer.style.visibility = 'hidden';
      // RAFループは継続（裏で降り続ける）
    } else {
      if (pinsLayer) pinsLayer.style.visibility = 'visible';
      _reactionsRestoreMyPin();
    }
    _updateVolUI();
    _applyVolAsPinCount();
  });

  // ---- 音量スライダー: 最大ピン数を調整 ----
  function _volToMaxPins(v) {
    var idx = Math.round(v / 100 * (PIN_SNAPS.length - 1));
    return PIN_SNAPS[Math.max(0, Math.min(PIN_SNAPS.length - 1, idx))];
  }
  function _applyVolAsPinCount() {
    var pins = _volToMaxPins(_vol);
    REACTIONS_MAX_PINS = pins;
    localStorage.setItem(LS_MAX_PINS, pins);
    var slider = document.getElementById('reactionsPinCountSlider');
    var valEl  = document.getElementById('reactionsPinCountVal');
    var displayPins = _mutedAll ? 0 : pins;
    if (slider) {
      slider.value = displayPins;
      var pct = (displayPins - parseFloat(slider.min)) / (parseFloat(slider.max) - parseFloat(slider.min)) * 100;
      slider.style.setProperty('--fill', pct.toFixed(1) + '%');
    }
    if (valEl) valEl.textContent = displayPins;
  }

  var _volDragging = false;
  function _volSeek(clientY) {
    var r = volTrack.getBoundingClientRect();
    _vol = Math.round(Math.min(100, Math.max(0, (1 - (clientY - r.top) / r.height) * 100)));
    _updateVolUI();
    var oldMax = REACTIONS_MAX_PINS;
    _applyVolAsPinCount();
    if (_reactionsPinsVisible) {
      _adjustPinDisplay(oldMax, REACTIONS_MAX_PINS);
    }
  }
  volTrack.addEventListener('mousedown', function(e) {
    _volDragging = true;
    volTrack.classList.add('dragging');
    volWrap.classList.add('vol-open');
    _volSeek(e.clientY);
    e.preventDefault();
    e.stopPropagation();
  });
  document.addEventListener('mousemove', function(e) { if (_volDragging) _volSeek(e.clientY); });
  document.addEventListener('mouseup', function() {
    if (_volDragging) { _volDragging = false; volTrack.classList.remove('dragging'); volWrap.classList.remove('vol-open'); }
  });
  volTrack.addEventListener('wheel', function(e) {
    e.preventDefault();
    _vol = Math.min(100, Math.max(0, _vol - Math.sign(e.deltaY) * (e.shiftKey ? 10 : 1)));
    _updateVolUI();
    var oldMax = REACTIONS_MAX_PINS;
    _applyVolAsPinCount();
    if (_reactionsPinsVisible) {
      _adjustPinDisplay(oldMax, REACTIONS_MAX_PINS);
    }
  }, { passive: false });

  // 初期ボリュームUI・プログレスバーを適用
  _applyVolAsPinCount();
  _updateProgressUI();

  // ---- スクリーンショット: 画像 + ヒートマップ + ピンを合成して保存 ----
  var _BALLOON_PATH = new Path2D('M12,29 C5.5,21.5 1.5,17 1.5,11 a10.5,10.5,0,0,1,21,0 C22.5,17 18.5,21.5 12,29 Z');
  var _HEART_PATH   = new Path2D('M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z');

  function _drawPinOnCanvas(ctx, px, py, sz, szH, color, lW, lH) {
    var elX = px * lW - sz / 2;
    var elY = py * lH + szH / 30 - szH;
    ctx.save();
    ctx.translate(elX, elY);
    ctx.scale(sz / 24, szH / 30);
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 8;
    ctx.shadowOffsetY = 3;
    ctx.fillStyle = color;
    ctx.fill(_BALLOON_PATH);
    ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.translate(12, 11);
    ctx.scale(0.38, 0.38);
    ctx.translate(-12, -12);
    ctx.fill(_HEART_PATH);
    ctx.restore();
  }

  screenshotBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    var rsImg = document.getElementById('reactionsImg');
    if (!rsImg || !rsImg.src) return;
    var pinsLayer    = document.getElementById('reactionsPinsLayer');
    var heatmapLayer = document.getElementById('reactionsHeatmapLayer');
    var lW = parseFloat(pinsLayer.style.width)  || pinsLayer.offsetWidth;
    var lH = parseFloat(pinsLayer.style.height) || pinsLayer.offsetHeight;
    if (!lW || !lH) return;

    var canvas = document.createElement('canvas');
    canvas.width  = lW;
    canvas.height = lH;
    var ctx = canvas.getContext('2d');

    function _compositeAndExport(blobUrl) {
      var tmp = new Image();
      tmp.onload = function() {
        ctx.drawImage(tmp, 0, 0, lW, lH);
        if (blobUrl.startsWith('blob:')) URL.revokeObjectURL(blobUrl);

        // ヒートマップ（CSS filter:blur と同じブラーをかけて描画）
        if (_reactionsHeatmapVisible) {
          var hmCanvas = heatmapLayer.querySelector('canvas');
          if (hmCanvas) {
            // 下地: 暗オーバーレイ
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.60)';
            ctx.fillRect(0, 0, lW, lH);
            ctx.restore();
            // ヒートマップ本体
            ctx.save();
            ctx.filter = 'blur(18px)';
            ctx.drawImage(hmCanvas, 0, 0, lW, lH);
            ctx.restore();
          }
        }

        // みんなピン
        if (_reactionsPinsVisible) {
          pinsLayer.querySelectorAll('.reactions-pin').forEach(function(pinEl) {
            var px = parseFloat(pinEl.dataset.x);
            var py = parseFloat(pinEl.dataset.y);
            var svgEl = pinEl.querySelector('svg');
            if (!svgEl) return;
            var sz  = parseFloat(svgEl.getAttribute('width'));
            var szH = parseFloat(svgEl.getAttribute('height'));
            var balloonEl = pinEl.querySelector('.pin-balloon');
            var color = balloonEl ? (balloonEl.style.fill || '#ec4899') : '#ec4899';
            _drawPinOnCanvas(ctx, px, py, sz, szH, color, lW, lH);
          });
        }

        // 好きピン
        var myPin = document.getElementById('reactionsMyPin');
        if (myPin && !myPin.hidden) {
          var saved = _reactionsMyPins[_reactionsCurrentVideoId];
          if (saved) {
            var myPinSvg = document.getElementById('reactionsMyPinSvg');
            var mySz  = myPinSvg ? parseFloat(myPinSvg.getAttribute('width'))  : 36;
            var mySzH = myPinSvg ? parseFloat(myPinSvg.getAttribute('height')) : 45;
            var myBalloon = myPinSvg ? myPinSvg.querySelector('.pin-balloon') : null;
            var myColor = myBalloon ? (myBalloon.style.fill || getComputedStyle(myBalloon).fill || '#ec4899') : '#ec4899';
            _drawPinOnCanvas(ctx, saved.x, saved.y, mySz, mySzH, myColor, lW, lH);
            // 「あなた」ラベルをピンの吹き出し内に描画
            var labelText = t('reactions-you');
            var pinCx = saved.x * lW;
            var pinTop = saved.y * lH + mySzH / 30 - mySzH;
            var labelFs = Math.max(7, Math.round(mySz * 0.22));
            ctx.save();
            ctx.font = '800 ' + labelFs + 'px "Segoe UI",sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.shadowColor = 'rgba(0,0,0,0.95)';
            ctx.shadowBlur = 3;
            ctx.fillStyle = 'rgba(255,255,255,0.96)';
            ctx.fillText(labelText, pinCx, pinTop + Math.round(mySzH * 0.06));
            ctx.restore();
          }
        }

        // 透かし: チャンネルアイコン・チャンネル名・動画タイトル
        var _ltCh  = channels[currentChannelKey];
        var _ltVid = allVideos.find(function(v) { return v.id === _reactionsCurrentVideoId; });

        function _roundRectPath(c, x, y, w, h, r) {
          c.beginPath();
          c.moveTo(x + r, y);
          c.lineTo(x + w - r, y); c.quadraticCurveTo(x + w, y, x + w, y + r);
          c.lineTo(x + w, y + h - r); c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
          c.lineTo(x + r, y + h); c.quadraticCurveTo(x, y + h, x, y + h - r);
          c.lineTo(x, y + r); c.quadraticCurveTo(x, y, x + r, y);
          c.closePath();
        }
        function _truncText(c, text, maxW) {
          if (c.measureText(text).width <= maxW) return text;
          var t = text;
          while (t.length > 1 && c.measureText(t + '\u2026').width > maxW) t = t.slice(0, -1);
          return t + '\u2026';
        }
        function _wrapText(c, text, maxW, maxLines) {
          if (c.measureText(text).width <= maxW) return [text];
          // 文字単位ラップ: 行頭禁則（】」）。、など）は前行末に追加して改行
          var forbiddenLineStart = '）】」』〉》｝)！？。、…‥';
          var lines = []; var cur = '';
          for (var j = 0; j < text.length; j++) {
            var ch = text[j];
            if (!cur && ch === ' ') continue; // 行頭スペースはスキップ
            var test = cur + ch;
            if (c.measureText(test).width > maxW && cur) {
              if (forbiddenLineStart.indexOf(ch) !== -1) {
                // 禁則文字は前行に含めてから改行
                lines.push(cur + ch); cur = '';
              } else {
                lines.push(cur); cur = ch;
              }
              if (lines.length >= maxLines) { cur = text.slice(j + 1); break; }
            } else { cur = test; }
          }
          if (cur) {
            var trimmed = cur.trim();
            if (lines.length < maxLines) lines.push(trimmed);
            else lines[lines.length - 1] += trimmed;
          }
          lines[lines.length - 1] = _truncText(c, lines[lines.length - 1], maxW);
          return lines;
        }
        function _drawLowerThird(avatarImg, snap) {
          // ADスタイル: 左アクセントバー + 局所背景 + テキストグロー + 2行折り返し
          var chName   = _ltCh  ? (_ltCh.displayName  || '') : '';
          var titleStr = _ltVid ? (_ltVid.title || '') : '';
          if (!chName && !titleStr) return;

          var padX    = Math.round(lW * 0.010);
          var padBot  = padX;                          // 左と下を同ピクセルに揃える
          var padV    = Math.round(lH * 0.011);
          var barW    = Math.round(lW * 0.0025);
          var barGap  = Math.round(padX * 0.75);
          var iconSz  = Math.round(lW * 0.028);
          var iconGap = avatarImg ? Math.round(iconSz + barGap) : 0;
          var fsSub   = Math.round(lW * 0.009);
          var fsMai   = Math.round(lW * 0.016);
          var subGap  = Math.round(fsSub * 0.45);
          var lineGap = Math.round(fsMai * 0.22);

          // テキスト開始X
          var textX  = padX + barW + barGap + iconGap;
          var availW = Math.round(lW * 0.62);

          // タイトル: フォントサイズを縮小しながら全文字が収まるまで試行（最大2行）
          var fsMaiMin = Math.round(lW * 0.009);
          var fsMaiActual = fsMai;
          var titleLines = [];
          if (titleStr) {
            while (fsMaiActual >= fsMaiMin) {
              ctx.font = '900 ' + fsMaiActual + 'px "Segoe UI",sans-serif';
              var _tl = _wrapText(ctx, titleStr, availW, 2);
              if (_tl.join(' ') === titleStr) { titleLines = _tl; break; }
              fsMaiActual--;
            }
            // 最小サイズでも入らない場合は最小サイズで2行表示（truncate許容）
            if (!titleLines.length) {
              ctx.font = '900 ' + fsMaiMin + 'px "Segoe UI",sans-serif';
              titleLines = _wrapText(ctx, titleStr, availW, 2);
              fsMaiActual = fsMaiMin;
            }
          }

          // 実際のテキスト幅を計測して blockW を決定
          var actualTextW = 0;
          if (chName) {
            ctx.font = '600 ' + fsSub + 'px "Segoe UI",sans-serif';
            actualTextW = Math.max(actualTextW, ctx.measureText(chName).width);
          }
          if (titleLines.length) {
            ctx.font = '900 ' + fsMaiActual + 'px "Segoe UI",sans-serif';
            titleLines.forEach(function(line) {
              actualTextW = Math.max(actualTextW, ctx.measureText(line).width);
            });
          }
          var blockW = textX + Math.ceil(actualTextW) + Math.round(padX * 1.8);

          // ブロック全体の高さ計算
          // padV * 2 に加えてベースライン下のディセンダー分を加算
          var descend = Math.round(fsMaiActual * 0.25);
          var subH   = chName   ? fsSub + subGap : 0;
          var mainH  = titleLines.length * fsMaiActual + Math.max(0, titleLines.length - 1) * lineGap;
          var blockH = subH + mainH + padV * 2 + descend;

          // 左下マージン付き配置
          var bx = padX;
          var by = lH - padBot - blockH;

          // --- 背景: 元画像ブラー + 右端フェード ---
          // offscreen に描いて destination-out でブラーごと右端をフェードアウト
          var blurPx  = Math.round(lW * 0.0022);
          var fadeExt = Math.round(lW * 0.08);
          var wbCvs   = document.createElement('canvas');
          wbCvs.width = lW; wbCvs.height = lH;
          var wbCtx   = wbCvs.getContext('2d');
          wbCtx.save();
          wbCtx.beginPath();
          wbCtx.rect(bx, by, blockW + fadeExt, blockH);
          wbCtx.clip();
          wbCtx.filter = 'blur(' + blurPx + 'px)';
          wbCtx.drawImage(snap, 0, 0, lW, lH);
          wbCtx.filter = 'none';
          var bgGrd = wbCtx.createLinearGradient(bx, 0, bx + blockW + fadeExt, 0);
          bgGrd.addColorStop(0,    'rgba(0,0,0,0.28)');
          bgGrd.addColorStop(0.86, 'rgba(0,0,0,0.20)');
          bgGrd.addColorStop(1,    'rgba(0,0,0,0)');
          wbCtx.fillStyle = bgGrd;
          wbCtx.fillRect(bx, by, blockW + fadeExt, blockH);
          var fadeStart = bx + blockW * 0.82;
          var fadeGrd   = wbCtx.createLinearGradient(fadeStart, 0, bx + blockW + fadeExt, 0);
          fadeGrd.addColorStop(0, 'rgba(0,0,0,0)');
          fadeGrd.addColorStop(1, 'rgba(0,0,0,1)');
          wbCtx.globalCompositeOperation = 'destination-out';
          wbCtx.fillStyle = fadeGrd;
          wbCtx.fillRect(fadeStart, by, blockW * 0.18 + fadeExt, blockH);
          wbCtx.restore();
          ctx.drawImage(wbCvs, 0, 0);

          // --- 左アクセントバー ---
          ctx.save();
          ctx.fillStyle = _reactionsPinColor || '#ec4899';
          ctx.fillRect(bx, by, barW, blockH);
          ctx.restore();

          // --- アバター ---
          if (avatarImg) {
            var ax = bx + barW + barGap + iconSz / 2;
            var ay = by + blockH / 2;
            ctx.save();
            ctx.beginPath();
            ctx.arc(ax, ay, iconSz / 2, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.80)';
            ctx.lineWidth   = Math.round(lW * 0.002);
            ctx.stroke();
            ctx.clip();
            ctx.drawImage(avatarImg, ax - iconSz / 2, ay - iconSz / 2, iconSz, iconSz);
            ctx.restore();
          }

          // --- テキスト ---
          ctx.save();
          var tY = by + padV;

          // チャンネル名 (sub)
          if (chName) {
            ctx.font = '600 ' + fsSub + 'px "Segoe UI",sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.72)';
            var subText = _truncText(ctx, chName, availW);
            var subY = tY + fsSub;
            // グロー
            ctx.shadowColor = 'rgba(200,230,255,0.65)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 0;
            ctx.fillText(subText, textX, subY);
            // シェード
            ctx.shadowColor = 'rgba(0,0,0,0.96)'; ctx.shadowBlur = 9; ctx.shadowOffsetY = 2;
            ctx.fillText(subText, textX, subY);
            // クリーンフィル
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
            ctx.fillText(subText, textX, subY);
            tY += fsSub + subGap;
          }

          // タイトル (main)
          ctx.font = '900 ' + fsMaiActual + 'px "Segoe UI",sans-serif';
          ctx.fillStyle = 'rgba(255,255,255,0.97)';
          titleLines.forEach(function(line, i) {
            var yPos = tY + fsMaiActual + i * (fsMaiActual + lineGap);
            // グロー
            ctx.shadowColor = 'rgba(200,230,255,0.65)'; ctx.shadowBlur = 22; ctx.shadowOffsetY = 0;
            ctx.fillText(line, textX, yPos);
            // シェード
            ctx.shadowColor = 'rgba(0,0,0,0.96)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3;
            ctx.fillText(line, textX, yPos);
            // クリーンフィル
            ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;
            ctx.fillText(line, textX, yPos);
          });

          ctx.restore();
        }

        function _finishExport(avatarImg) {
          // ピンを含む描画済み状態をスナップ → ブラー背景に使う
          var snap = document.createElement('canvas');
          snap.width = lW; snap.height = lH;
          snap.getContext('2d').drawImage(canvas, 0, 0);
          _drawLowerThird(avatarImg, snap);
          canvas.toBlob(function(blob) {
            var url = URL.createObjectURL(blob);
            var _dlSanitize = function(s) { return s.replace(/[\\/:*?"<>|]/g, '_').trim().slice(0, 60); };
            var _dlChName  = _ltCh  ? (_ltCh.displayName  || '') : '';
            var _dlTitle   = _ltVid ? (_ltVid.title || '') : '';
            var _dlName = [_dlChName, _dlTitle].filter(Boolean).map(_dlSanitize).join(' - ') || (_reactionsCurrentVideoId || 'screenshot');
            var a = document.createElement('a');
            a.href = url;
            a.download = _dlName + '.png';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function() { URL.revokeObjectURL(url); }, 10000);
          }, 'image/png');
        }

        if (_ltCh && _ltCh.avatar) {
          var avImg = new Image();
          avImg.crossOrigin = 'anonymous';
          avImg.onload  = function() { _finishExport(avImg); };
          avImg.onerror = function() { _finishExport(null); };
          avImg.src = _ltCh.avatar;
        } else {
          _finishExport(null);
        }
      };
      tmp.src = blobUrl;
    }

    fetch(rsImg.src)
      .then(function(r) { return r.blob(); })
      .then(function(blob) { _compositeAndExport(URL.createObjectURL(blob)); })
      .catch(function() { _compositeAndExport(rsImg.src); });
  });

  // ---- シアターモード: プレイリストを非表示 ----
  // margin-right: -400px と transform: translateX(100%) を同時アニメーション
  // → 画像拡大とスライドが同時、かつ playlist 内部レイアウトは 400px 固定 (リフロー不要)
  function _setTheater(enable) {
    var rsScreen = document.getElementById('reactionsScreen');
    rsScreen.classList.toggle('rs-theater-active', enable);
    theaterBtn.innerHTML = enable
      ? '<i data-lucide="panel-right-open"></i>'
      : '<i data-lucide="panel-right-close"></i>';
    theaterBtn.title = typeof t === 'function'
      ? t(enable ? 'theater-close' : 'theater-open')
      : (enable ? 'プレイリストを表示' : 'シアターモード');
    if (window.lucide) lucide.createIcons();
  }
  theaterBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    var rsScreen = document.getElementById('reactionsScreen');
    _setTheater(!rsScreen.classList.contains('rs-theater-active'));
  });

  // ---- フルスクリーン ----
  fullscreenBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
      var req = imgWrap.requestFullscreen || imgWrap.webkitRequestFullscreen;
      if (req) req.call(imgWrap);
    } else {
      var ex = document.exitFullscreen || document.webkitExitFullscreen;
      if (ex) ex.call(document);
    }
  });
  function onFullscreenChange() {
    var isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
    fullscreenBtn.classList.toggle('active', isFs);
    if (!isFs) { imgWrap.classList.remove('fs-idle'); clearTimeout(_fsIdleTimer); }
  }
  document.addEventListener('fullscreenchange', onFullscreenChange);
  document.addEventListener('webkitfullscreenchange', onFullscreenChange);

  imgWrap.addEventListener('mousemove', function() {
    if (document.fullscreenElement === imgWrap || document.webkitFullscreenElement === imgWrap) {
      imgWrap.classList.remove('fs-idle');
      clearTimeout(_fsIdleTimer);
      _fsIdleTimer = setTimeout(function() {
        if (document.fullscreenElement === imgWrap || document.webkitFullscreenElement === imgWrap) {
          imgWrap.classList.add('fs-idle');
        }
      }, 3000);
    }
  });
})();

init();