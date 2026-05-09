// ---
const BASE = 'https://www.googleapis.com/youtube/v3';
const LS_RATING = 'thumb-ranking-elo';
const LS_VIDEOS = 'thumb-ranking-videos';
const LS_CHANNELS = 'thumb-ranking-channels';
const LS_SIDEBAR_ORDER = 'thumb-sidebar-order';
const LS_API_KEY = 'yt-api-key';

function getStoredApiKey() { return localStorage.getItem(LS_API_KEY) || ''; }
function apiKeyHeaders() {
  const k = getStoredApiKey();
  return k ? { 'X-YouTube-Api-Key': k } : {};
}

let allVideos = [];
let currentCat = 'videos';
let currentView = 'welcome';
let _prevView = 'vote';
let _pollTimer = null;
let ratingData = {};
let voteTotal = 0;
let channels = {};
let currentChannelKey = null;
let sidebarOrder = [];
let _chTooltip = null;
let _ctxMenu = null;
let _ctxMenuKey = null;

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
let _reactionsMode = 'pins';
let _reactionsTimer = null;
let _reactionsSeeds = [];
let _reactionsMyPins = {};  // videoId → { x, y }

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
    throw new Error(body.error?.message ?? res.status);
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
    const data = await apiFetch(`${BASE}/playlistItems?${params}`);
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

// --- チャンネルデータをアプリにロード ---
function loadChannelVideos(key) {
  const videos = loadVideosForChannel(key);
  if (!videos?.length) return false;
  allVideos = videos;
  const counts = { videos: 0, shorts: 0, live: 0 };
  allVideos.forEach(v => { if (counts[v.category] !== undefined) counts[v.category]++; });
  currentCat = counts.live >= counts.videos && counts.live >= counts.shorts ? 'live'
             : counts.shorts > counts.videos ? 'shorts' : 'videos';
  document.querySelectorAll('.cat-btn').forEach(b => {
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
function pickPair() {
  const pool = filteredVideos();
  if (pool.length < 2) return null;
  // 重み = rdの大きさ（対戦数が少ないほど高い）、最少値を1として正規化
  const weights = pool.map(v => Math.max(1, getRd(v.id)));
  const totalW  = weights.reduce((s, w) => s + w, 0);
  function weightedPick(excludeIdx) {
    let r = Math.random() * (totalW - (excludeIdx != null ? weights[excludeIdx] : 0));
    for (let k = 0; k < pool.length; k++) {
      if (k === excludeIdx) continue;
      r -= weights[k];
      if (r <= 0) return k;
    }
    return pool.length - 1 === excludeIdx ? pool.length - 2 : pool.length - 1;
  }
  const i = weightedPick(null);
  const j = weightedPick(i);
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

var _currentVotePair = null; // 画面遷移で再抽選しないためキャッシュ

// --- 傾き強度 ---
var _tiltScale = 0.5;

function renderVote() {
  // 投票後または初回のみ新ペアを抽選。画面戻りではそのまま表示。
  if (!_currentVotePair) {
    _currentVotePair = pickPair();
  }
  const pair = _currentVotePair;
  const container = document.getElementById('votePair');
  if (!pair) {
    container.innerHTML = `<p style="color:var(--text-muted);text-align:center;grid-column:1/-1;padding:60px 0;font-size:14px;">${t('no-videos-in-cat')}</p>`;
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
        '<img class="card-banner" src="' + v.thumb + '" alt="" loading="lazy"' +
        ' onerror="this.src=\'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg\'">' +
        '<div class="tilter__deco tilter__deco--shine"><div></div></div>' +
        '<figcaption class="tilter__caption">' + v.title + '</figcaption>' +
      '</figure>';

    var fig     = card.querySelector('.tilter__figure');
    var caption = card.querySelector('.tilter__caption');
    var shine   = card.querySelector('.tilter__deco--shine > div');

    card.addEventListener('mouseenter', function() {
      // 戻りアニメが進行中ならキャンセルし、CSS transitionを有効化
      anime.remove([fig, caption, shine]);
      fig.classList.add('tilt-smooth');
      caption.classList.add('tilt-smooth');
      shine.classList.add('tilt-smooth');
    });

    card.addEventListener('mousemove', function(e) {
      var rect = card.getBoundingClientRect();
      // -0.5〜0.5に正規化（CSS transitionが滑らかに追いつく）
      var nx = (e.clientX - rect.left) / rect.width  - 0.5;
      var ny = (e.clientY - rect.top)  / rect.height - 0.5;
      fig.style.transform     = 'rotateX(' + (-ny * 12 * _tiltScale) + 'deg) rotateY(' + (nx * 16 * _tiltScale) + 'deg)';
      caption.style.transform = 'translateX(' + (nx * 28 * _tiltScale) + 'px) translateY(' + (ny * 28 * _tiltScale) + 'px)';
      shine.style.transform   = 'translateX(' + (nx * 100 * _tiltScale) + 'px) translateY(' + (ny * 100 * _tiltScale) + 'px)';
    });

    card.addEventListener('mouseleave', function() {
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
function _buildVideoMeta(v) {
  var items = [];
  if (v.viewCount) {
    items.push('<span class="gallery-meta-item">' + _SVG_EYE + fmtViewsShort(v.viewCount) + '</span>');
  }
  if (v.publishedAt) {
    items.push('<span class="gallery-meta-item">' + _SVG_CLK + fmtRelTime(v.publishedAt) + '</span>');
  }
  var rating = getRating(v.id);
  if (rating !== 1500) {
    items.push('<span class="gallery-meta-item">' + _SVG_STAR + Math.round(rating) + '</span>');
  }
  return items.join('');
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
var _listSortOrder = 'views';     // 'date' | 'views' | 'rating' | 'random'
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
    }, { threshold: [0, 1] });
  } else {
    grid.classList.remove('mode-shorts');
  }
  // 初回ロード
  _appendGalleryPage();
}

// 全カテゴリ共通: ソート済み全件プールを構築する
function _buildSortedPool() {
  var pool = filteredVideos().slice();
  if (_listSortOrder === 'date') {
    pool.sort(function(a, b) {
      return (b.publishedAt || '') < (a.publishedAt || '') ? -1 : 1;
    });
  } else if (_listSortOrder === 'views') {
    pool.sort(function(a, b) { return (b.viewCount || 0) - (a.viewCount || 0); });
  } else if (_listSortOrder === 'rating') {
    pool.sort(function(a, b) { return getRating(b.id) - getRating(a.id); });
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
      var _meta = _buildVideoMeta(v);
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
              (function(){ var m = _buildVideoMeta(v); return m ? '<div class="gallery-meta">' + m + '</div>' : ''; }()) +
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

// ソートボタン・カテゴリボタン: 全登録言語で計測し最大幅を min-width に設定する
var _sortBtnMaxWidths = {};
var _catBtnMaxWidths  = {};
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
    Array.from(document.querySelectorAll('.shorts-sort-btn[data-i18n]')),
    _sortBtnMaxWidths, 'sort', 'i18n'
  );
  _measureGroup(
    Array.from(document.querySelectorAll('.cat-btn[data-i18n]')),
    _catBtnMaxWidths, 'cat', 'i18n'
  );
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
    var metaHtml = _buildVideoMeta(v);
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
          '<div class="list-info-title">' + v.title + '</div>' +
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
    const medalEmoji = idx === 0 ? '??' : idx === 1 ? '??' : idx === 2 ? '??' : '';
    const medal = medalEmoji || (idx + 1);
    const rankNum = idx < 3 ? medalEmoji : idx + 1;
    const views = v.viewCount ? fmtViews(v.viewCount) : '';
    const date  = v.publishedAt ? fmtRelTime(v.publishedAt) : '';
    const viewDate = [views, date].filter(Boolean).join(' · ');
    const metaHtml = _buildVideoMeta(v);
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
        <div class="rank-title"><a href="${videoUrl}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:none;" onmouseover="this.style.color='var(--accent)'" onmouseout="this.style.color='inherit'">${v.title}</a></div>
        <div class="rank-stats">
          <span>${t('wins-fmt', { w: wins, b: battles })}${battles > 0 ? t('winrate-fmt', { r: wr }) : ''}</span>
        </div>
        ${metaHtml ? `<div class="rank-stats gallery-meta rank-meta-gallery">${metaHtml}</div>` : ''}
        <div class="rank-bar-bg"><div class="rank-bar-fill" style="width:${barPct}%"></div></div>
      </div>
    `;
    list.appendChild(item);
  });
}

function renderRanking() {
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

function _hideChCtxMenu() {
  if (_ctxMenu) _ctxMenu.hidden = true;
  _ctxMenuKey = null;
}

function _showChCtxMenu(key, x, y) {
  _ctxMenuKey = key;
  if (!_ctxMenu) return;
  _ctxMenu.hidden = false;
  // 画面端に収まるよう位置調整
  const mw = _ctxMenu.offsetWidth || 160;
  const mh = _ctxMenu.offsetHeight || 80;
  _ctxMenu.style.left = (x + mw > window.innerWidth ? x - mw : x) + 'px';
  _ctxMenu.style.top  = (y + mh > window.innerHeight ? y - mh : y) + 'px';
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

function buildChannelItem(ch) {
  const item = document.createElement('div');
  item.className = 'sidebar-channel-item' + (currentChannelKey === ch.key ? ' active' : '');
  item.dataset.key = ch.key;
  const name = ch.displayName || ch.handle || ch.key;
  const avatarEl = ch.avatar
    ? `<img class="sidebar-ch-avatar" src="${ch.avatar}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : `<div class="sidebar-ch-avatar"></div>`;
  item.innerHTML = `${avatarEl}<span class="sidebar-ch-name">${name}</span>`;
  item.addEventListener('click', () => selectChannel(ch.key));
  item.addEventListener('contextmenu', e => {
    e.preventDefault();
    _showChCtxMenu(ch.key, e.clientX, e.clientY);
  });
  // コンパクト時のチャンネル名ツールチップ
  item.addEventListener('mouseenter', () => {
    if (!_chTooltip || !document.getElementById('sidebar').classList.contains('sidebar--compact')) return;
    const rect = item.getBoundingClientRect();
    _chTooltip.textContent = name;
    _chTooltip.style.top = (rect.top + rect.height / 2) + 'px';
    _chTooltip.style.left = (rect.right + 10) + 'px';
    _chTooltip.classList.add('visible');
  });
  item.addEventListener('mouseleave', () => {
    if (_chTooltip) _chTooltip.classList.remove('visible');
  });
  return item;
}

function buildFolderItem(folder) {
  const wrap = document.createElement('div');
  wrap.className = 'sidebar-folder' + (folder.open ? ' sidebar-folder--open' : '');
  wrap.dataset.folderId = folder.id;

  const header = document.createElement('div');
  header.className = 'sidebar-folder-header';
  header.dataset.folderId = folder.id;
  header.tabIndex = 0;

  const preview = document.createElement('div');
  preview.className = 'sidebar-folder-preview';
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
  nameEl.textContent = folder.name || '';
  header.appendChild(nameEl);

  const badge = document.createElement('span');
  badge.className = 'sidebar-folder-badge';
  badge.textContent = folder.children.length;
  header.appendChild(badge);

  const renameBtn = document.createElement('button');
  renameBtn.type = 'button';
  renameBtn.className = 'sidebar-folder-rename-btn';
  renameBtn.title = 'リネーム';
  renameBtn.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
  renameBtn.addEventListener('click', function(e) { e.stopPropagation(); startRename(); });
  header.appendChild(renameBtn);

  const chevron = document.createElement('span');
  chevron.className = 'sidebar-folder-chevron';
  chevron.textContent = folder.open ? '\u25b4' : '\u25be';
  header.appendChild(chevron);

  function startRename() {
    if (nameEl.contentEditable === 'plaintext-only' || nameEl.contentEditable === 'true') return;
    const prev = folder.name || '';
    nameEl.contentEditable = 'plaintext-only';
    nameEl.focus();
    const sel = window.getSelection(), range = document.createRange();
    range.selectNodeContents(nameEl); sel.removeAllRanges(); sel.addRange(range);
    function onMouseDown(e) { e.stopPropagation(); }
    function onKeyDown(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); nameEl.blur(); }
      if (ev.key === 'Escape') {
        nameEl.textContent = prev;
        nameEl.contentEditable = 'false';
        nameEl.removeEventListener('blur', commit);
        nameEl.removeEventListener('keydown', onKeyDown);
        nameEl.removeEventListener('mousedown', onMouseDown);
      }
    }
    function commit() {
      nameEl.contentEditable = 'false';
      const next = nameEl.textContent.trim().slice(0, 50) || prev;
      nameEl.textContent = next;
      folder.name = next;
      saveSidebarOrder();
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

  header.addEventListener('mouseenter', () => {
    if (!_chTooltip || !document.getElementById('sidebar').classList.contains('sidebar--compact')) return;
    const rect = header.getBoundingClientRect();
    _chTooltip.textContent = (folder.name ? folder.name + ' ' : '') + folder.children.length + 'ch';
    _chTooltip.style.top = (rect.top + rect.height / 2) + 'px';
    _chTooltip.style.left = (rect.right + 10) + 'px';
    _chTooltip.classList.add('visible');
  });
  header.addEventListener('mouseleave', () => { if (_chTooltip) _chTooltip.classList.remove('visible'); });

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

  header.addEventListener('click', e => {
    if (e.target.closest('button, [contenteditable]:not([contenteditable="false"])')) return;
    folder.open = !folder.open;
    saveSidebarOrder();
    wrap.classList.toggle('sidebar-folder--open', folder.open);
    chevron.textContent = folder.open ? '\u25b4' : '\u25be';
  });

  wrap.appendChild(header);
  wrap.appendChild(childrenEl);
  return wrap;
}

function renderSidebar() {
  syncSidebarOrder();
  const nav = document.getElementById('sidebarNav');
  nav.innerHTML = '';
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

  const _ind = document.createElement('div');
  _ind.className = 'sidebar-drag-indicator';
  _ind.style.display = 'none';
  document.body.appendChild(_ind);

  function _clearState() {
    _ind.style.display = 'none';
    nav.querySelectorAll('.sidebar-merge-hover').forEach(el => el.classList.remove('sidebar-merge-hover'));
    nav.querySelectorAll('.sidebar-folder-drop-hover').forEach(el => el.classList.remove('sidebar-folder-drop-hover'));
  }

  function _hitTest(mouseY) {
    for (const el of nav.querySelectorAll('.sidebar-channel-item')) {
      if (_dragType === 'channel' && el.dataset.key === _srcKey) continue;
      // 閉じたフォルダ内のアイテムはスキップ
      const parentChildren = el.closest('.sidebar-folder-children');
      if (parentChildren) {
        const folder = parentChildren.closest('.sidebar-folder');
        if (folder && !folder.classList.contains('sidebar-folder--open')) continue;
        // ドラッグ中のフォルダ内のアイテムもスキップ
        if (_dragType === 'folder' && folder && folder.dataset.folderId === _srcFolderId) continue;
      }
      const r = el.getBoundingClientRect();
      if (mouseY < r.top || mouseY > r.bottom) continue;
      const relY = (mouseY - r.top) / r.height;
      const folderId = parentChildren ? parentChildren.dataset.folderId : null;
      if (relY < 0.3) return { action: 'before', targetKey: el.dataset.key, folderId, el };
      if (relY > 0.7) return { action: 'after', targetKey: el.dataset.key, folderId, el };
      if (_dragType === 'channel') return { action: 'merge', targetKey: el.dataset.key, folderId, el };
      return { action: 'before', targetKey: el.dataset.key, folderId, el };
    }
    for (const el of nav.querySelectorAll('.sidebar-folder-header')) {
      const folderId = el.dataset.folderId;
      if (_dragType === 'folder' && folderId === _srcFolderId) continue;
      const r = el.getBoundingClientRect();
      if (mouseY < r.top || mouseY > r.bottom) continue;
      if (_dragType === 'channel') return { action: 'add-to-folder', folderId, el };
      const wrap = el.closest('.sidebar-folder');
      return (mouseY - r.top) / r.height < 0.5
        ? { action: 'folder-before', folderId, el }
        : { action: 'folder-after', folderId, el: wrap || el };
    }
    for (const el of nav.querySelectorAll('.sidebar-folder-drop-zone')) {
      // 閉じたフォルダ内のドロップゾーンはスキップ
      const pc = el.closest('.sidebar-folder-children');
      if (pc) {
        const pf = pc.closest('.sidebar-folder');
        if (pf && !pf.classList.contains('sidebar-folder--open')) continue;
      }
      const r = el.getBoundingClientRect();
      if (mouseY >= r.top - 8 && mouseY <= r.bottom + 8 && _dragType === 'channel') {
        return { action: 'add-to-folder', folderId: el.dataset.folderId, el };
      }
    }
    return { action: 'end' };
  }

  function _showDrop(mouseY) {
    _clearState();
    _dropInfo = _hitTest(mouseY);
    if (!_dropInfo) return;
    const { action, el } = _dropInfo;
    const indStyle = (r, atTop) =>
      `display:block;position:fixed;left:${r.left}px;top:${atTop ? r.top - 2 : r.bottom - 1}px;width:${r.width}px;height:3px;background:var(--accent,#4f9cf9);border-radius:2px;pointer-events:none;z-index:9998;`;
    if (action === 'before') _ind.style.cssText = indStyle(el.getBoundingClientRect(), true);
    else if (action === 'after') _ind.style.cssText = indStyle(el.getBoundingClientRect(), false);
    else if (action === 'merge') el.classList.add('sidebar-merge-hover');
    else if (action === 'add-to-folder') {
      const h = nav.querySelector(`.sidebar-folder-header[data-folder-id="${_dropInfo.folderId}"]`);
      if (h) h.classList.add('sidebar-folder-drop-hover');
    }
    else if (action === 'folder-before') _ind.style.cssText = indStyle(el.getBoundingClientRect(), true);
    else if (action === 'folder-after') _ind.style.cssText = indStyle(el.getBoundingClientRect(), false);
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
            sidebarOrder.splice(tgtIdx, 1, { type: 'folder', id: 'f_' + Date.now(), open: false, name: defaultName, children: [targetKey, srcKey] });
          } else { sidebarOrder.push({ type: 'channel', key: srcKey }); }
        }
      } else if (action === 'add-to-folder') {
        const f = sidebarOrder.find(i => i.type === 'folder' && i.id === folderId);
        if (f && !f.children.includes(srcKey)) f.children.push(srcKey);
        else if (!f) sidebarOrder.push({ type: 'channel', key: srcKey });
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
    if (_draggedEl) { _draggedEl.style.opacity = ''; _draggedEl = null; }
    _clearState();
    _dragType = _srcKey = _srcFolderId = _dropInfo = _pending = null;
  }

  function _startDrag(p) {
    const { unit, rect, downY, type, srcKey, srcFolderId } = p;
    _draggedEl = unit;
    _dragType = type;
    _srcKey = srcKey;
    _srcFolderId = srcFolderId;
    _pointerOffsetY = downY - rect.top;
    _ghost = unit.cloneNode(true);
    _ghost.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;pointer-events:none;z-index:9999;opacity:0.85;box-shadow:0 6px 24px rgba(0,0,0,0.55);border-radius:8px;transition:none;`;
    document.body.appendChild(_ghost);
    unit.style.opacity = '0.2';
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
      srcKey: chItem ? chItem.dataset.key : null, srcFolderId: fldHdr ? fldHdr.dataset.folderId : null };
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
      srcKey: chItem ? chItem.dataset.key : null, srcFolderId: fldHdr ? fldHdr.dataset.folderId : null };
    document.addEventListener('touchmove', _onPendingMove, { passive: false });
    document.addEventListener('touchend', _onPendingUp);
  }, { passive: false });
}



// --- チャンネル選択 ---
async function selectChannel(key) {
  const ch = channels[key];
  if (!ch) return;
  currentChannelKey = key;

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
    _currentVotePair = null; // チャンネル切り替え時はペアをリセット
    const counts = { videos: 0, shorts: 0, live: 0 };
    allVideos.forEach(v => { if (counts[v.category] !== undefined) counts[v.category]++; });
    currentCat = counts.live >= counts.videos && counts.live >= counts.shorts ? 'live'
               : counts.shorts > counts.videos ? 'shorts' : 'videos';
    document.querySelectorAll('.cat-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.cat === currentCat);
    });
    showView('vote');
  } catch (e) {
    console.error('selectChannel:', e);
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

async function loadReactionSeeds(videoId) {
  try {
    const resp = await fetch('/api/pins/' + videoId + '/seeds');
    if (!resp.ok) return [];
    const data = await resp.json();
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

function renderReactionsHeatmap(seeds) {
  const layer = document.getElementById('reactionsHeatmapLayer');
  layer.innerHTML = '';
  for (const p of seeds) {
    const blob = document.createElement('div');
    blob.className = 'reactions-heatmap-blob';
    const size = 100 * p.density + 60;
    blob.style.cssText = 'left:' + (p.x * 100) + '%;top:' + (p.y * 100) + '%;width:' + size + 'px;height:' + size + 'px;';
    layer.appendChild(blob);
  }
}

const REACTIONS_MAX_PINS = 48;

function startReactionsLoop(seeds) {
  clearTimeout(_reactionsTimer);
  const pinsLayer = document.getElementById('reactionsPinsLayer');
  if (!pinsLayer) return;
  pinsLayer.innerHTML = '';
  if (seeds.length === 0) return;

  const totalDuration = 9000;
  const clusters = seeds.map(function(seed) {
    const targetCount = Math.max(3, Math.floor(4 + seed.density * 14));
    return {
      seed,
      targetCount,
      avgInterval: totalDuration / targetCount,
      emitted: 0,
      nextFire: performance.now() + (1 - seed.density) * 1400 + Math.random() * 1200,
    };
  });

  function tick() {
    const now = performance.now();
    let allDone = true;
    for (const cluster of clusters) {
      if (cluster.emitted >= cluster.targetCount) continue;
      allDone = false;
      if (cluster.nextFire > now) continue;
      const { seed } = cluster;
      const spread = 0.012 + (1 - seed.density) * 0.03;
      const x = reactionsClamp(seed.x + reactionsRandGauss() * spread, 0.04, 0.96);
      const y = reactionsClamp(seed.y + reactionsRandGauss() * spread, 0.04, 0.96);
      const existing = pinsLayer.querySelectorAll('.reactions-pin');
      let nearbyCount = 0;
      for (const el of existing) {
        const dx = parseFloat(el.dataset.x) - x;
        const dy = parseFloat(el.dataset.y) - y;
        if (Math.sqrt(dx * dx + dy * dy) < 0.04) nearbyCount++;
      }
      const skipChance = Math.min(0.78, nearbyCount * 0.06 * (1 - seed.density * 0.55));
      if (Math.random() > skipChance) {
        while (pinsLayer.children.length >= REACTIONS_MAX_PINS) pinsLayer.removeChild(pinsLayer.firstChild);
        const scale = 0.8 + seed.density * 0.8;
        const sz = Math.round(20 * scale);
        const szH = Math.round(sz * 1.25);
        const pin = document.createElement('div');
        pin.className = 'reactions-pin';
        pin.dataset.x = x;
        pin.dataset.y = y;
        pin.style.cssText = 'left:' + (x * 100) + '%;top:' + (y * 100) + '%;translate:-50% -100%;scale:' + scale + ';';
        pin.innerHTML =
          '<svg class="reactions-pin-svg" viewBox="0 0 24 30" width="' + sz + '" height="' + szH + '" xmlns="http://www.w3.org/2000/svg">' +
            '<path class="pin-balloon" d="M12,29 C5.5,21.5 1.5,17 1.5,11 a10.5,10.5,0,0,1,21,0 C22.5,17 18.5,21.5 12,29 Z"/>' +
            '<g transform="translate(12 11) scale(0.38) translate(-12 -12)">' +
              '<path class="pin-icon" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>' +
            '</g>' +
          '</svg>';
        pinsLayer.appendChild(pin);
      }
      cluster.emitted++;
      const progress = cluster.emitted / cluster.targetCount;
      cluster.nextFire = now + cluster.avgInterval * (0.9 + progress * 0.55) * (0.7 + Math.random() * 0.6);
    }
    if (allDone) {
      _reactionsTimer = setTimeout(function() { startReactionsLoop(seeds); }, 1800);
      return;
    }
    _reactionsTimer = setTimeout(tick, 70);
  }
  tick();
}

function setReactionsMode(mode) {
  _reactionsMode = mode;
  const heatmapLayer = document.getElementById('reactionsHeatmapLayer');
  const pinsLayer    = document.getElementById('reactionsPinsLayer');
  if (!heatmapLayer) return;
  heatmapLayer.style.display = mode === 'heatmap' ? '' : 'none';
  pinsLayer.style.display    = mode === 'pins' ? '' : 'none';
  document.getElementById('reactionsPinsModeBtn').classList.toggle('active', mode === 'pins');
  document.getElementById('reactionsHeatmapModeBtn').classList.toggle('active', mode === 'heatmap');
  if (mode === 'heatmap') {
    clearTimeout(_reactionsTimer);
    renderReactionsHeatmap(_reactionsSeeds);
  } else {
    startReactionsLoop(_reactionsSeeds);
  }
}

function showMyReactionsPin(x, y) {
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
    top  = ((iy + y * ih) / wRect.height * 100) + '%';
  } else {
    left = (x * 100) + '%';
    top  = (y * 100) + '%';
  }
  pin.style.left = left;
  pin.style.top  = top;
  pin.hidden = false;
  // 上から刺さるアニメーション
  var svg = document.getElementById('reactionsMyPinSvg');
  anime.remove(svg);
  anime({
    targets: svg,
    translateY: [-28, 0],
    duration: 750,
    easing: 'easeOutElastic',
    elasticity: 600
  });
}

function openReactionsMode(videoId) {
  if (!videoId) return;
  _reactionsCurrentVideoId = videoId;
  _reactionsMode = 'pins';
  document.getElementById('reactionsPinsModeBtn').classList.add('active');
  document.getElementById('reactionsHeatmapModeBtn').classList.remove('active');
  document.getElementById('reactionsHeatmapLayer').style.display = 'none';
  document.getElementById('reactionsPinsLayer').style.display    = '';
  document.getElementById('reactionsMyPin').hidden = true;
  // 自分の保存済みピンを復元
  var saved = _reactionsMyPins[videoId];
  if (saved) showMyReactionsPin(saved.x, saved.y);
  // seeds 取得してアニメーション開始
  loadReactionSeeds(videoId).then(function(seeds) {
    _reactionsSeeds = seeds;
    startReactionsLoop(seeds);
  });
}

function closeReactionsMode() {
  clearTimeout(_reactionsTimer);
  document.getElementById('reactionsPinsLayer').innerHTML = '';
  document.getElementById('reactionsMyPin').hidden = true;
  if (currentView === 'reactions') {
    showView(_prevView || 'vote');
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
  closeReactionsMode();
  document.getElementById('thumbModal').classList.remove('open');
  document.body.style.overflow = '';
}

// ギャラリーからリアクション全画面で開く
function openModalReactions(v) {
  _prevView = currentView;
  var img = document.getElementById('reactionsImg');
  img.src = v.thumb;
  img.onerror = function() { this.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'; };
  document.getElementById('reactionsYtBtn').href = v.url || 'https://www.youtube.com/watch?v=' + v.id;
  document.getElementById('reactionsTitle').textContent = v.title || '';
  openReactionsMode(v.id);
  showView('reactions');
}

document.getElementById('modalClose').addEventListener('click', closeThumbModal);
document.getElementById('thumbModal').addEventListener('click', e => {
  if (e.target === document.getElementById('thumbModal')) closeThumbModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (currentView === 'reactions') { closeReactionsMode(); return; }
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
  SCREENS.forEach(s => {
    const el = document.getElementById(s + 'Screen');
    if (el) el.style.display = s === view ? '' : 'none';
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
      headers: { 'Content-Type': 'application/json', ...apiKeyHeaders() },
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
    renderSidebar();
    await selectChannel(ch.channel_id);
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

  // ソートボタン（全モード共通）
  document.querySelectorAll('.shorts-sort-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      _listSortOrder = btn.dataset.sort;
      document.querySelectorAll('.shorts-sort-btn').forEach(function(b) {
        b.classList.toggle('active', b === btn);
      });
      if (_listMode === 'grid') { _renderGrid(); } else { renderList(); }
    });
  });

  // チャンネル名ツールチップ要素を一度だけ生成
  _chTooltip = document.createElement('div');
  _chTooltip.className = 'ch-tooltip';
  document.body.appendChild(_chTooltip);

  // サイドバーチャンネル右クリックメニュー
  _ctxMenu = document.createElement('div');
  _ctxMenu.className = 'ch-ctx-menu';
  _ctxMenu.hidden = true;
  _ctxMenu.innerHTML =
    '<button class="ch-ctx-item" data-action="refresh">動画を再取得</button>' +
    '<button class="ch-ctx-item ch-ctx-item--danger" data-action="delete">削除</button>';
  document.body.appendChild(_ctxMenu);
  _ctxMenu.addEventListener('click', async e => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !_ctxMenuKey) return;
    const key = _ctxMenuKey;
    _hideChCtxMenu();
    if (btn.dataset.action === 'delete') {
      deleteChannel(key);
    } else if (btn.dataset.action === 'refresh') {
      if (key !== currentChannelKey) await selectChannel(key);
      try {
        await fetch('/api/channels/' + key + '/refresh', { method: 'POST', headers: apiKeyHeaders() });
        allVideos = await fetchChannelVideos(key);
        _currentVotePair = null;
        if (currentView === 'vote') renderVote();
        else if (currentView === 'list') renderList();
        else if (currentView === 'ranking') renderRanking();
      } catch (e) { console.error('refresh:', e); }
    }
  });
  document.addEventListener('click', _hideChCtxMenu);
  document.addEventListener('contextmenu', e => {
    if (!e.target.closest('.sidebar-channel-item')) _hideChCtxMenu();
  });

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
  loadRating();
  loadChannels();
  loadSidebarOrder();
  renderSidebar();
  initSidebarDrag();
  showView('welcome');

  // ReactionPin: モード切り替え・戻る
  document.getElementById('reactionsPinsModeBtn').addEventListener('click', function() { setReactionsMode('pins'); });
  document.getElementById('reactionsHeatmapModeBtn').addEventListener('click', function() { setReactionsMode('heatmap'); });
  document.getElementById('reactionsBackBtn').addEventListener('click', closeReactionsMode);

  // ReactionPin: imgWrap クリックで pin 配置
  var _rsImgWrap = document.getElementById('reactionsImgWrap');
  _rsImgWrap.addEventListener('click', function(e) {
    if (currentView !== 'reactions' || _reactionsMode !== 'pins') return;
    var rect = _rsImgWrap.getBoundingClientRect();
    var cx = e.clientX - rect.left;
    var cy = e.clientY - rect.top;
    // 実際に表示されている画像の領域を計算（object-fit:contain のレターボックス分を除外）
    var img = document.getElementById('reactionsImg');
    var nw = img.naturalWidth, nh = img.naturalHeight;
    // 画像サイズ未取得時はピン不可
    if (!nw || !nh) return;
    var scale = Math.min(rect.width / nw, rect.height / nh);
    var iw = nw * scale, ih = nh * scale;
    var ix = (rect.width - iw) / 2, iy = (rect.height - ih) / 2;
    if (cx < ix || cx > ix + iw || cy < iy || cy > iy + ih) return;
    // 座標を画像内の相対位置（0〜1）として保持
    var xp = reactionsClamp((cx - ix) / iw, 0.01, 0.99);
    var yp = reactionsClamp((cy - iy) / ih, 0.01, 0.99);
    _reactionsMyPins[_reactionsCurrentVideoId] = { x: xp, y: yp };
    showMyReactionsPin(xp, yp);
    if (_reactionsCurrentVideoId) postReaction(_reactionsCurrentVideoId, xp, yp);
  });

  // 1分ごとに list/ranking 画面の動画を再取得して新着を反映
  setInterval(_pollRefresh, 60000);
}

// --- サイドバーイベント ---
document.getElementById('sidebarSearchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') addChannelFromSidebarInput();
});
document.getElementById('sidebarSearchInput').addEventListener('paste', e => {
  const text = (e.clipboardData || window.clipboardData).getData('text');
  let decoded;
  try { decoded = decodeURIComponent(text); } catch { decoded = text; }
  if (decoded !== text) {
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart, end = el.selectionEnd;
    el.value = el.value.slice(0, start) + decoded + el.value.slice(end);
    el.selectionStart = el.selectionEnd = start + decoded.length;
  }
});
document.getElementById('sidebarSearchBtn').addEventListener('click', () => {
  addChannelFromSidebarInput();
});

// --- ウェルカムフォーム ---
(function() {
  const apiKeyInput    = document.getElementById('welcomeApiKeyInput');
  const handleInput    = document.getElementById('welcomeHandleInput');
  const addBtn         = document.getElementById('welcomeAddBtn');
  const saveBtn        = document.getElementById('welcomeApiKeySave');
  const statusEl       = document.getElementById('welcomeAddStatus');
  const apiKeyStatusEl = document.getElementById('welcomeApiKeyStatus');

  // 保存済み API キーを復元
  const stored = getStoredApiKey();
  if (stored) apiKeyInput.value = stored;

  apiKeyInput.addEventListener('input', () => {
    apiKeyStatusEl.textContent = '';
    apiKeyStatusEl.style.color = '';
  });

  saveBtn.addEventListener('click', () => {
    const val = apiKeyInput.value.trim();
    if (val && !/^AIzaSy[A-Za-z0-9_-]{33}$/.test(val)) {
      apiKeyStatusEl.textContent = 'APIキーの形式が正しくありません（AIzaSy... で始まる39文字）';
      apiKeyStatusEl.style.color = 'var(--red, #ed4245)';
      return;
    }
    apiKeyStatusEl.textContent = '';
    apiKeyStatusEl.style.color = '';
    if (val) localStorage.setItem(LS_API_KEY, val);
    else localStorage.removeItem(LS_API_KEY);
    saveBtn.textContent = '保存しました';
    setTimeout(() => { saveBtn.textContent = '保存'; }, 1500);
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

  var _currentTab = 'display';

  // ---- タブ切り替え ----
  function switchTab(name) {
    _currentTab = name;
    document.querySelectorAll('.settings-nav-item').forEach(function(el) {
      el.classList.toggle('active', el.dataset.tab === name);
    });
    document.querySelectorAll('.settings-tab').forEach(function(el) {
      el.hidden = (el.id !== 'settingsTab-' + name);
    });
    heading.textContent = t('settings-tab-' + name);
    heading.dataset.tab = name;
    if (name === 'apikey') showDisplayMode();
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
    indicator.hidden = !getStoredApiKey();
  }

  function showDisplayMode() {
    input.value = getStoredApiKey() || '';
    input.type = 'password';
    toggleBtn.innerHTML = EYE;
    statusEl.textContent = '';
    statusEl.style.color = '';
    deleteBtn.hidden = !getStoredApiKey();
  }

  toggleBtn.addEventListener('click', function() {
    const isPassword = input.type === 'password';
    input.type = isPassword ? 'text' : 'password';
    toggleBtn.innerHTML = isPassword ? EYE_OFF : EYE;
  });

  input.addEventListener('input', function() {
    statusEl.textContent = '';
    statusEl.style.color = '';
  });

  deleteBtn.addEventListener('click', function() {
    localStorage.removeItem(LS_API_KEY);
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
    updateIndicator();
    deleteBtn.hidden = false;
    statusEl.textContent = t('settings-apikey-saved');
    statusEl.style.color = 'var(--ok)';
    setTimeout(function() { statusEl.textContent = ''; statusEl.style.color = ''; }, 2000);
  });

  // ---- サイドバーデータ ----
  const exportBtn    = document.getElementById('sidebarExportBtn');
  const importBtn    = document.getElementById('sidebarImportBtn');
  const importFile   = document.getElementById('sidebarImportFile');
  const dataStatusEl = document.getElementById('sidebarDataStatus');

  exportBtn.addEventListener('click', function() {
    const data = localStorage.getItem(LS_SIDEBAR_ORDER) || '[]';
    const blob = new Blob([data], { type: 'application/json' });
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
        if (!Array.isArray(parsed)) throw new Error();
        localStorage.setItem(LS_SIDEBAR_ORDER, JSON.stringify(parsed));
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
  if (tab) showView(tab.dataset.view);
});

// --- カテゴリフィルタ ---
document.getElementById('catFilter').addEventListener('click', e => {
  const btn = e.target.closest('.cat-btn');
  if (!btn) return;
  currentCat = btn.dataset.cat;
  document.querySelectorAll('.cat-btn').forEach(b => b.classList.toggle('active', b === btn));
  if (currentView === 'vote') renderVote();
  else if (currentView === 'list') renderList();
  else if (currentView === 'ranking') renderRanking();
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

  function applyCompact(w) {
    sidebar.classList.toggle('sidebar--compact', w <= COMPACT_WIDTH);
  }

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const w = parseInt(saved);
    sidebar.style.width = w + 'px';
    applyCompact(w);
  }

  let startX, startW;
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    startX = e.clientX;
    startW = sidebar.offsetWidth;
    handle.classList.add('dragging');
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
  function onMove(e) {
    let w = startW + e.clientX - startX;
    if (w < COMPACT_THRESHOLD) w = COMPACT_WIDTH;
    w = Math.min(400, Math.max(COMPACT_WIDTH, w));
    sidebar.style.width = w + 'px';
    applyCompact(w);
  }
  function onUp() {
    handle.classList.remove('dragging');
    localStorage.setItem(STORAGE_KEY, sidebar.offsetWidth);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
})();

init();
