// ---
const BASE = 'https://www.googleapis.com/youtube/v3';
const LS_ELO = 'thumb-ranking-elo';
const LS_VIDEOS = 'thumb-ranking-videos';
const LS_CHANNELS = 'thumb-ranking-channels';
const LS_GROUPS = 'thumb-ranking-groups';

let allVideos = [];
let currentCat = 'videos';
let currentView = 'welcome';
let eloData = {};
let voteTotal = 0;
let channels = {};
let currentChannelKey = null;
let groups = [];
let selectedGroupId = null;

// --- Glicko-2 ---
const G2_TAU   = 0.5;
const G2_SCALE = 173.7178;

function g2Init() {
  return { rating: 1500, rd: 350, volatility: 0.06, wins: 0, battles: 0 };
}

function getRating(id)  { return eloData[id]?.rating   ?? 1500; }
function getRd(id)      { return eloData[id]?.rd        ?? 350; }
function getBattles(id) { return eloData[id]?.battles   ?? 0; }
function getWins(id)    { return eloData[id]?.wins      ?? 0; }

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

  // volatility update (Illinois algorithm)
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
  if (!eloData[winnerId]) eloData[winnerId] = g2Init();
  if (!eloData[loserId])  eloData[loserId]  = g2Init();
  const w = eloData[winnerId];
  const l = eloData[loserId];
  const wUp = g2Update(w, l, 1);
  const lUp = g2Update(l, w, 0);
  eloData[winnerId] = { ...wUp, wins: w.wins + 1, battles: w.battles + 1 };
  eloData[loserId]  = { ...lUp, wins: l.wins,     battles: l.battles + 1 };
  saveElo();
  voteTotal++;
  document.getElementById('voteCount').textContent = voteTotal;
  updatePaceGauge();
}

function saveElo() {
  localStorage.setItem(LS_ELO, JSON.stringify({ eloData, voteTotal }));
}

function loadElo() {
  const raw = localStorage.getItem(LS_ELO);
  if (!raw) return;
  const d = JSON.parse(raw);
  const raw2 = d.eloData ?? {};
  // 旧Eloデータ（.elo フィールド）をGlicko-2形式に移行
  eloData = Object.fromEntries(Object.entries(raw2).map(([id, v]) => [
    id,
    v.rating != null ? v : { ...g2Init(), rating: v.elo ?? 1500, wins: v.wins ?? 0, battles: v.battles ?? 0 },
  ]));
  voteTotal = d.voteTotal ?? 0;
  document.getElementById('voteCount').textContent = voteTotal;
}

// --- Channel storage ---
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
function loadGroups() {
  const raw = localStorage.getItem(LS_GROUPS);
  groups = raw ? JSON.parse(raw) : [];
}
function saveGroups() {
  try { localStorage.setItem(LS_GROUPS, JSON.stringify(groups)); } catch {}
}
function getGroupPath(gid) {
  const parts = [];
  let cur = groups.find(g => g.id === gid);
  while (cur) {
    parts.unshift(cur.label);
    cur = cur.parentId ? groups.find(g => g.id === cur.parentId) : null;
  }
  return parts.join(' ? ');
}
function getAllDescendantLabels(label) {
  const root = groups.find(g => g.label === label);
  if (!root) return new Set([label]);
  const result = new Set();
  const queue = [root.id];
  while (queue.length) {
    const id = queue.shift();
    const g = groups.find(g => g.id === id);
    if (!g) continue;
    result.add(g.label);
    groups.filter(g2 => g2.parentId === id).forEach(c => queue.push(c.id));
  }
  return result;
}
function renderGroupFilterBar() {
  // グループフィルタはサイドバーで管理するため不要
}
function saveVideosForChannel(key, videos) {
  try { localStorage.setItem(LS_VIDEOS + '_' + key, JSON.stringify(videos)); } catch {}
}
function loadVideosForChannel(key) {
  const raw = localStorage.getItem(LS_VIDEOS + '_' + key);
  return raw ? JSON.parse(raw) : null;
}

// --- DB エクスポート (ローカル開発用) ---
function exportForDb() {
  const chs = Object.values(channels).map(ch => ({
    channel_id:    ch.key,
    handle:        ch.handle ? '@' + ch.handle : null,
    title:         ch.displayName ?? ch.handle ?? ch.key,
    icon_url:      ch.avatar ?? '',
    last_accessed: new Date().toISOString(),
  }));

  const vids = [];
  for (const ch of Object.values(channels)) {
    const stored = loadVideosForChannel(ch.key);
    if (!stored) continue;
    for (const v of stored) {
      const g2 = eloData[v.id];
      vids.push({
        video_id:      v.id,
        channel_id:    ch.key,
        title:         v.title ?? '',
        thumbnail_url: v.thumb ?? '',
        category:      v.category ?? 'videos',
        duration:      v.duration ?? 0,
        view_count:    v.viewCount ?? 0,
        published_at:  v.publishedAt ?? null,
        rating:        g2?.rating    ?? 1500,
        rd:            g2?.rd        ?? 350,
        volatility:    g2?.volatility ?? 0.06,
        wins:          g2?.wins      ?? 0,
        battles:       g2?.battles   ?? 0,
        rating_updated_at: g2 ? new Date().toISOString() : null,
      });
    }
  }

  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), channels: chs, videos: vids }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `db-export-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

// --- API helpers ---
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

// --- Category filter ---
function filteredVideos() {
  return allVideos.filter(v => v.category === currentCat);
}

// --- Vote ---
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

const PACE_LEVELS = [
  { max: 5,        label: 'Stable',  cls: '' },
  { max: 12,       label: 'Busy',    cls: 'pace-warm' },
  { max: Infinity, label: 'Cooling', cls: 'pace-hot' },
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
  lbl.textContent = level.label;
}

function renderVote() {
  const pair = pickPair();
  const container = document.getElementById('votePair');
  if (!pair) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;grid-column:1/-1;padding:60px 0;font-size:14px;">このカテゴリには動画がありません。</p>';
    return;
  }
  const [pairA, pairB] = pair;
  container.innerHTML = '';
  [pairA, pairB].forEach((v, idx) => {
    const card = document.createElement('div');
    card.className = 'vote-card';
    card.dataset.id = v.id;
    const ch = channels[currentChannelKey];
    card.innerHTML = `
      <img class="card-banner" src="${v.thumb}" alt="" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${v.id}/hqdefault.jpg'">
      <div class="card-body"><div class="card-title">${v.title}</div></div>`;
    card.addEventListener('click', () => {
      const winner = idx === 0 ? pairA : pairB;
      const loser  = idx === 0 ? pairB : pairA;
      applyVote(winner.id, loser.id);
      container.querySelectorAll('.vote-card').forEach(c => {
        c.classList.add(c.dataset.id === winner.id ? 'winner' : 'loser');
      });
      setTimeout(renderVote, 500);
    });
    container.appendChild(card);
  });
}

// --- Helpers: format ---
function fmtViews(n) {
  if (!n) return '';
  if (n >= 100000000) return (n / 100000000).toFixed(1).replace(/\.0$/, '') + '億回視聴';
  if (n >= 10000)     return Math.floor(n / 10000) + '万回視聴';
  if (n >= 1000)      return (n / 1000).toFixed(1).replace(/\.0$/, '') + '千回視聴';
  return n.toLocaleString() + '回視聴';
}
function fmtRelTime(isoStr) {
  if (!isoStr) return '';
  const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
  if (diff < 60)         return 'たった今';
  if (diff < 3600)       return Math.floor(diff / 60) + '分前';
  if (diff < 86400)      return Math.floor(diff / 3600) + '時間前';
  if (diff < 86400 * 7)  return Math.floor(diff / 86400) + '日前';
  if (diff < 86400 * 30) return Math.floor(diff / (86400 * 7)) + '週間前';
  if (diff < 86400 * 365)return Math.floor(diff / (86400 * 30)) + 'ヶ月前';
  return Math.floor(diff / (86400 * 365)) + '年前';
}
function fmtDuration(sec) {
  if (!sec) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

// --- List ---
let _listHoverTimer = null;

function renderList() {
  const pool = filteredVideos();
  const grid = document.getElementById('listGrid');
  grid.innerHTML = '';
  for (const v of pool) {
    const a = document.createElement('a');
    a.className = 'list-card';
    a.href = v.url ?? `https://www.youtube.com/watch?v=${v.id}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    const durHtml = v.duration ? `<span class="list-duration">${fmtDuration(v.duration)}</span>` : '';
    const views = v.viewCount ? fmtViews(v.viewCount) : '';
    const date  = v.publishedAt ? fmtRelTime(v.publishedAt) : '';
    const meta  = [views, date].filter(Boolean).join(' · ');
    a.innerHTML = `
      <div class="list-thumb-wrap">
        <img src="${v.thumb}" alt="" loading="lazy" onerror="this.src='https://i.ytimg.com/vi/${v.id}/hqdefault.jpg'">
        ${durHtml}
      </div>
      <div class="list-info">
        <div class="list-info-text">
          <div class="list-info-title">${v.title}</div>
          ${meta ? `<div class="list-info-meta">${meta}</div>` : ''}
        </div>
      </div>`;
    const wrap = a.querySelector('.list-thumb-wrap');
    a.addEventListener('mouseenter', () => {
      _listHoverTimer = setTimeout(() => {
        if (a.querySelector('.list-preview-iframe')) return;
        const iframe = document.createElement('iframe');
        iframe.className = 'list-preview-iframe';
        iframe.src = `https://www.youtube.com/embed/${v.id}?autoplay=1&mute=1&start=15&controls=0&modestbranding=1&loop=1&playlist=${v.id}&rel=0&enablejsapi=1&origin=${location.origin}`;
        iframe.allow = 'autoplay';
        iframe.title = v.title;
        // エラー153（埋め込み禁止）検知: postMessage でプレーヤーエラーを受信
        const onMsg = e => {
          try {
            const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data;
            if (data?.event === 'infoDelivery' && data?.info?.playerState === -1) return;
            if (data?.event === 'onError') {
              iframe.remove();
              window.removeEventListener('message', onMsg);
            }
          } catch {}
        };
        window.addEventListener('message', onMsg);
        iframe._msgHandler = onMsg;
        wrap.appendChild(iframe);
      }, 700);
    });
    a.addEventListener('mouseleave', () => {
      clearTimeout(_listHoverTimer);
      const iframe = a.querySelector('.list-preview-iframe');
      if (iframe) {
        if (iframe._msgHandler) window.removeEventListener('message', iframe._msgHandler);
        iframe.remove();
      }
    });
    grid.appendChild(a);
  }
}

// --- Ranking ---
const RANK_PAGE = 50;
let rankShowCount = RANK_PAGE;

function renderRankingItems(sorted, maxElo, minElo, range, from, to) {
  const list = document.getElementById('rankList');
  sorted.slice(from, to).forEach((v, i) => {
    const idx = from + i;
    const rating = getRating(v.id);
    const rd     = getRd(v.id);
    const wins = getWins(v.id);
    const battles = getBattles(v.id);
    const wr = battles > 0 ? Math.round(wins / battles * 100) : 0;
    const barPct = Math.round((rating - minElo) / range * 100);
    const lowRd = rd > 150;
    const videoUrl = v.url ?? `https://www.youtube.com/watch?v=${v.id}`;
    const medalEmoji = idx === 0 ? '??' : idx === 1 ? '??' : idx === 2 ? '??' : '';
    const medal = medalEmoji || (idx + 1);
    const rankNum = idx < 3 ? medalEmoji : idx + 1;
    const views = v.viewCount ? fmtViews(v.viewCount) : '';
    const date  = v.publishedAt ? fmtRelTime(v.publishedAt) : '';
    const viewDate = [views, date].filter(Boolean).join(' · ');
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
          <span class="elo${lowRd ? ' low-battles' : ''}">${Math.round(rating)} pts</span>
          <span>${wins}勝 / ${battles}戦${battles > 0 ? ' · ' + wr + '%' : ''}</span>
        </div>
        ${viewDate ? `<div class="rank-stats">${viewDate}</div>` : ''}
        <div class="rank-bar-bg"><div class="rank-bar-fill" style="width:${barPct}%"></div></div>
      </div>
    `;
    list.appendChild(item);
  });
}

function renderRanking() {
  const pool = filteredVideos();
  const sorted = [...pool].sort((a, b) => getRating(b.id) - getRating(a.id));
  const maxElo = sorted.length ? getRating(sorted[0].id) : 1500;
  const minElo = sorted.length ? getRating(sorted[sorted.length - 1].id) : 1500;
  const range = maxElo - minElo || 1;

  rankShowCount = RANK_PAGE;
  document.getElementById('rankSubtitle').textContent = `${pool.length} 件 / ${currentCat}`;
  const list = document.getElementById('rankList');
  list.innerHTML = '';

  renderRankingItems(sorted, maxElo, minElo, range, 0, Math.min(rankShowCount, sorted.length));

  // もっと見るボタン
  if (sorted.length > rankShowCount) {
    const btn = document.createElement('button');
    btn.id = 'rankMoreBtn';
    btn.textContent = `もっと見る（あと ${sorted.length - rankShowCount} 件）`;
    btn.style.cssText = 'display:block;width:100%;margin-top:12px;padding:10px;border:1px solid var(--border);border-radius:6px;background:transparent;color:var(--text-muted);font-size:13px;cursor:pointer;transition:all 0.15s;';
    btn.onmouseenter = () => { btn.style.borderColor = 'var(--accent)'; btn.style.color = 'var(--accent)'; };
    btn.onmouseleave = () => { btn.style.borderColor = 'var(--border)'; btn.style.color = 'var(--text-muted)'; };
    btn.addEventListener('click', () => {
      const prev = rankShowCount;
      rankShowCount = Math.min(rankShowCount + RANK_PAGE, sorted.length);
      btn.remove();
      renderRankingItems(sorted, maxElo, minElo, range, prev, rankShowCount);
      if (rankShowCount < sorted.length) {
        btn.textContent = `もっと見る（あと ${sorted.length - rankShowCount} 件）`;
        list.appendChild(btn);
      }
    });
    list.appendChild(btn);
  }
}

// --- Top-ranked video helper ---
function getTopRankedVideo(key) {
  const videos = loadVideosForChannel(key);
  if (!videos?.length) return null;
  const active = videos.filter(v => v.category !== 'shorts');
  if (!active.length) return null;
  return active.reduce((best, v) => getRating(v.id) >= getRating(best.id) ? v : best, active[0]);
}

// --- Sidebar ---
// コンパクト状態を維持

function buildChannelItem(ch) {
  const item = document.createElement('div');
  item.className = 'sidebar-channel-item' + (currentChannelKey === ch.key ? ' active' : '');
  item.dataset.key = ch.key;
  const avatarEl = ch.avatar
    ? `<img class="sidebar-ch-avatar" src="${ch.avatar}" alt="" referrerpolicy="no-referrer" onerror="this.style.display='none'">`
    : `<div class="sidebar-ch-avatar"></div>`;
  item.innerHTML = `${avatarEl}<span class="sidebar-ch-name">${ch.displayName || ch.handle || ch.key}</span>`;
  item.addEventListener('click', () => selectChannel(ch.key));
  return item;
}

function renderSidebar() {
  const nav = document.getElementById('sidebarNav');
  nav.innerHTML = '';

  const allChs = Object.values(channels).sort((a, b) => (b.addedAt > a.addedAt ? 1 : -1));
  const topLevelGroups = groups.filter(g => !g.parentId);

  topLevelGroups.forEach(g => {
    const chsInGroup = allChs.filter(ch => (ch.tags || []).includes(g.label));
    if (chsInGroup.length === 0) return;
    const collapsed = !!_sidebarCollapsed[g.id];
    const header = document.createElement('div');
    header.className = 'sidebar-group-header';
    const toggle = document.createElement('span');
    toggle.className = 'sidebar-group-toggle' + (collapsed ? ' collapsed' : '');
    toggle.textContent = '▾';
    header.appendChild(document.createTextNode(g.label));
    header.addEventListener('click', () => {
      _sidebarCollapsed[g.id] = !_sidebarCollapsed[g.id];
      renderSidebar();
    });
    nav.appendChild(header);
    if (!collapsed) {
      chsInGroup.forEach(ch => nav.appendChild(buildChannelItem(ch)));
    }
  });

  // グループに属していないチャンネル
  const ungrouped = allChs.filter(ch =>
    !(ch.tags || []).some(t => topLevelGroups.some(g => g.label === t))
  );
  if (ungrouped.length > 0) {
    if (topLevelGroups.length > 0) {
      const header = document.createElement('div');
      header.className = 'sidebar-group-header';
      const collapsed = !!_sidebarCollapsed['_ungrouped'];
      const toggle = document.createElement('span');
      toggle.className = 'sidebar-group-toggle' + (collapsed ? ' collapsed' : '');
      toggle.textContent = '▾';
      header.appendChild(document.createTextNode('チャンネル'));
      header.addEventListener('click', () => {
        _sidebarCollapsed['_ungrouped'] = !_sidebarCollapsed['_ungrouped'];
        renderSidebar();
      });
      nav.appendChild(header);
      if (!collapsed) {
        ungrouped.forEach(ch => nav.appendChild(buildChannelItem(ch)));
      }
    } else {
      ungrouped.forEach(ch => nav.appendChild(buildChannelItem(ch)));
    }
  }
}

// --- チャンネル選択 ---
function selectChannel(key) {
  const ch = channels[key];
  if (!ch) return;
  currentChannelKey = key;

  // サイドバーのアクティブ状態を更新
  document.querySelectorAll('.sidebar-channel-item').forEach(el => {
    el.classList.toggle('active', el.dataset.key === key);
  });

  // チャンネルヘッダーを表示
  const header = document.getElementById('channelHeader');
  header.style.display = 'flex';
  const avatarEl = document.getElementById('chAvatar');
  avatarEl.src = ch.avatar || '';
  avatarEl.style.display = ch.avatar ? '' : 'none';
  document.getElementById('chName').textContent = ch.displayName || ch.handle || ch.key;

  if (!loadChannelVideos(key)) {
    // データなし: ウェルカム画面でメッセージ表示
    return;
  }
  showView('vote');
}

// --- View switch ---
const SCREENS = ['welcome', 'vote', 'list', 'ranking'];

// --- Thumb Modal ---
function openThumbModal({ v, idx, rating, wins, battles, wr, barPct, videoUrl, medal }) {
  const modal = document.getElementById('thumbModal');
  document.getElementById('modalImg').src = v.thumb;
  document.getElementById('modalImg').onerror = function() { this.src = `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg`; };
  document.getElementById('modalBadge').textContent = medal;
  document.getElementById('modalTitle').textContent = v.title;
  document.getElementById('modalStats').innerHTML =
    `<div><strong>${Math.round(rating)}</strong><br>レーティング</div>` +
    `<div><strong>${battles}</strong><br>戦数</div>` +
    `<div><strong>${wins}</strong><br>勝利</div>` +
    (battles > 0 ? `<div><strong>${wr}%</strong><br>勝率</div>` : '') +
    `<div><strong>#${idx + 1}</strong><br>順位</div>`;
  document.getElementById('modalYtBtn').href = videoUrl;
  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeThumbModal() {
  document.getElementById('thumbModal').classList.remove('open');
  document.body.style.overflow = '';
}

document.getElementById('modalClose').addEventListener('click', closeThumbModal);
document.getElementById('thumbModal').addEventListener('click', e => {
  if (e.target === document.getElementById('thumbModal')) closeThumbModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeThumbModal();
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
  const raw = document.getElementById('sidebarSearchInput').value.trim();
  if (!raw) return;

  const statusEl = document.getElementById('sidebarSearchStatus');
  const url = raw.startsWith('http') ? raw
    : `https://www.youtube.com/${raw.startsWith('@') ? raw : '@' + raw}`;
  const key = channelKeyFromUrl(url);

  // 既登録の場合はそのまま選択
  if (channels[key]) {
    statusEl.textContent = '';
    statusEl.className = 'sidebar-search-status';
    renderSidebar();
    selectChannel(key);
    return;
  }

  const apiKey = (typeof CONFIG !== 'undefined' ? CONFIG.youtubeApiKey : '');
  if (!apiKey || apiKey === 'YOUR_API_KEY_HERE') {
    // APIキーなし: メタデータなしで仮登録
    const handle = handleMatch ? handleMatch[1] : key;
    channels[key] = {
      key, url, handle, displayName: handle,
      avatar: '', thumb: '', videoCount: 0,
      tags: [], addedAt: new Date().toISOString()
    };
    saveChannels();
    document.getElementById('sidebarSearchInput').value = '';
    statusEl.textContent = '追加しました (APIキーなし)';
    renderSidebar();
    selectChannel(key);
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'sidebar-search-status'; }, 3000);
    return;
  }

  const parsed = parseChannel(url);
  if (!parsed) {
    statusEl.textContent = 'URLの形式が不正です';
    return;
  }

  const searchBtn = document.getElementById('sidebarSearchBtn');
  searchBtn.disabled = true;
  statusEl.className = 'sidebar-search-status';

  try {
    statusEl.textContent = 'チャンネル情報を取得中...';

    const videoIds = await getAllVideoIds(apiKey, playlistId, (cur, total) => {
      statusEl.textContent = `動画ID取得中: ${cur}/${total}`;
    });

    statusEl.textContent = '動画詳細を取得中...';
    const videos = await getVideoDetails(apiKey, videoIds, (cur, total) => {
      statusEl.textContent = `詳細取得中: ${cur}/${total}`;
    });

    const handleMatch = url.match(/@([\w.-]+)/);
    channels[key] = {
      key, url,
      handle: handleMatch?.[1] || '',
      displayName: channelName || handleMatch?.[1] || key,
      avatar: avatar || '',
      thumb: videos.find(v => v.thumb)?.thumb || '',
      videoCount: videos.length,
      tags: [],
      addedAt: new Date().toISOString()
    };
    saveChannels();
    saveVideosForChannel(key, videos);

    statusEl.textContent = `追加: ${channelName} (${videos.length}件)`;
    document.getElementById('sidebarSearchInput').value = '';
    renderSidebar();
    selectChannel(key);
    setTimeout(() => { statusEl.textContent = ''; statusEl.className = 'sidebar-search-status'; }, 4000);
  } catch (err) {
    statusEl.textContent = `エラー: ${err.message}`;
  } finally {
    searchBtn.disabled = false;
  }
}

// --- Init ---
function init() {
  loadElo();
  loadChannels();
  loadGroups();
  renderSidebar();
  showView('welcome');
}

// --- サイドバーイベント ---
document.getElementById('sidebarSearchInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') addChannelFromSidebarInput();
});
document.getElementById('sidebarManageBtn').addEventListener('click', () => {
  selectedGroupId = null;
  openGroupModal();
});

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

// --- スキップ・リセット ---

document.getElementById('resetBtn').addEventListener('click', () => {
  if (!confirm('全投票データをリセットしますか？')) return;
  saveElo();
  document.getElementById('voteCount').textContent = 0;
  renderRanking();
});



// --- Group modal ---
function openGroupModal() {
  renderGroupModal();
  document.getElementById('groupModal').classList.add('open');
}
function closeGroupModal() {
  document.getElementById('groupModal').classList.remove('open');
}

function renderGroupModal() {
  // Left panel: group list
  const listEl = document.getElementById('gmGroupList');
  listEl.innerHTML = '';
  if (groups.length === 0) {
    listEl.innerHTML = '<div style="padding:12px 10px;font-size:12px;color:var(--text-muted)">グループはまだありません</div>';
  }
  groups.forEach(g => {
    const item = document.createElement('div');
    item.className = 'gm-group-item' + (g.id === selectedGroupId ? ' active' : '');
    const nameEl = document.createElement('span');
    nameEl.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    nameEl.textContent = '?? ' + g.label;
    const delBtn = document.createElement('button');
    delBtn.className = 'gm-gdel';
    delBtn.title = '削除';
    delBtn.textContent = '×';
    item.appendChild(delBtn);
    item.addEventListener('click', e => {
      if (e.target === delBtn) return;
      selectedGroupId = g.id;
      renderGroupModal();
    });
    delBtn.addEventListener('click', () => {
      if (!confirm(`「${g.label}」を削除しますか？`)) return;
      const q = [g.id];
      while (q.length) {
        const id = q.shift(); toDelete.add(id);
        groups.filter(g2 => g2.parentId === id).forEach(c => q.push(c.id));
      }
      groups = groups.filter(g2 => !toDelete.has(g2.id));
      saveGroups();
      if (toDelete.has(selectedGroupId)) selectedGroupId = null;
      renderGroupModal();
      renderSidebar();
    });
    listEl.appendChild(item);
  });

  // Right panel: selected group detail
  const detail = document.getElementById('gmDetail');
  const g = selectedGroupId ? groups.find(g2 => g2.id === selectedGroupId) : null;
  if (!g) {
    detail.innerHTML = '<div class="gm-right-empty">&larr; グループを選択してください</div>';
    return;
  }
  const inGroup = Object.values(channels).filter(ch => (ch.tags || []).includes(g.label));
  const notInGroup = Object.values(channels).filter(ch => !(ch.tags || []).includes(g.label));
  detail.innerHTML = `
    <div class="gm-detail-header"><div class="gm-detail-name">${g.label} &mdash; <span style="font-size:12px;font-weight:400;color:var(--text-muted)">${inGroup.length}チャンネル</span></div></div>
    <div class="gm-section-label">グループ内のチャンネル</div>
    <div class="gm-channel-scroll" id="gmChList"></div>
    <div class="gm-section-label" style="border-top:1px solid var(--border);padding-top:10px">追加できるチャンネル</div>
    <div class="gm-channel-scroll" id="gmAddList" style="max-height:160px"></div>
    <div class="gm-url-add">
      <input id="gmUrlInput" type="text" placeholder="URLまたは@handleで新規登録（Enterで連続追加）" autocomplete="off">
      <button id="gmUrlAddBtn">登録</button>
    </div>` 
  const chScroll = detail.querySelector('#gmChList');
  if (inGroup.length === 0) {
    chScroll.innerHTML = '<div style="padding:8px 10px;font-size:12px;color:var(--text-muted)">まだチャンネルがありません</div>';
  }
  inGroup.forEach(ch => {
    const item = document.createElement('div');
    item.className = 'gm-ch-item';
    if (ch.avatar) {
      const img = document.createElement('img');
      img.className = 'gm-ch-avatar';
      img.src = ch.avatar;
      img.referrerPolicy = 'no-referrer';
      img.onerror = function() { this.style.display = 'none'; };
      item.appendChild(img);
    } else {
      const ph = document.createElement('div');
      ph.className = 'gm-ch-avatar';
      item.appendChild(ph);
    }
    const nameEl = document.createElement('span');
    nameEl.className = 'gm-ch-name';
    nameEl.textContent = ch.displayName || ch.handle || ch.key;
    item.appendChild(nameEl);
    const delBtn = document.createElement('button');
    delBtn.className = 'gm-ch-del';
    delBtn.title = 'グループから削除';
    delBtn.textContent = '×';
    delBtn.addEventListener('click', () => {
      channels[ch.key].tags = (channels[ch.key].tags || []).filter(t => t !== g.label);
      saveChannels();
      renderGroupModal();
      renderSidebar();
    });
    item.appendChild(delBtn);
    chScroll.appendChild(item);
  });

  // "Add" list: channels not yet in this group
  const addScroll = detail.querySelector('#gmAddList');
  if (notInGroup.length === 0) {
    addScroll.innerHTML = '<div style="padding:6px 10px;font-size:12px;color:var(--text-muted)">全チャンネルが追加済みです</div>';
  }
  notInGroup.forEach(ch => {
    const item = document.createElement('div');
    item.className = 'gm-add-item';
    const nameEl = document.createElement('span');
    nameEl.className = 'gm-ch-name';
    nameEl.textContent = ch.displayName || ch.handle || ch.key;
    const addBtn = document.createElement('button');
    addBtn.className = 'gm-add-btn';
    addBtn.textContent = '＋ 追加';
    addBtn.addEventListener('click', () => {
      channels[ch.key].tags = [...(channels[ch.key].tags || []), g.label];
      saveChannels();
      renderGroupModal();
      renderSidebar();
    });
    item.appendChild(nameEl);
    item.appendChild(addBtn);
    addScroll.appendChild(item);
  });

  const addUrl = () => {
    const raw = urlInput.value.trim();
    if (!raw) return;
    const url = raw.startsWith('http') ? raw
      : `https://www.youtube.com/${raw.startsWith('@') ? raw : '@' + raw}`;
    const key = channelKeyFromUrl(url);
    if (!channels[key]) {
      const handle = url.match(/@([\w.-]+)/)?.[1] || '';
      channels[key] = {
        key, url, handle,
        displayName: handle || key,
        avatar: '', thumb: '', videoCount: 0,
        tags: [g.label],
        addedAt: new Date().toISOString()
      };
    } else if (!(channels[key].tags || []).includes(g.label)) {
      channels[key].tags = [...(channels[key].tags || []), g.label];
    }
    saveChannels();
    urlInput.value = '';
    urlInput.focus();
    renderGroupModal();
    renderSidebar();
  };
  detail.querySelector('#gmUrlAddBtn').addEventListener('click', addUrl);
  urlInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); addUrl(); } });
}

document.getElementById('groupAddConfirmBtn').addEventListener('click', () => {
  const label = document.getElementById('groupLabelInput').value.trim();
  if (!label) return;
  if (groups.some(g => g.label === label)) { alert(`「${label}」は既に存在します`); return; }
  const ng = { id: 'g_' + Date.now(), label, parentId: null };
  groups.push(ng);
  saveGroups();
  selectedGroupId = ng.id;
  document.getElementById('groupLabelInput').value = '';
  renderGroupModal();
  renderSidebar();
});
document.getElementById('groupLabelInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('groupAddConfirmBtn').click();
});
document.getElementById('groupModalCloseBtn').addEventListener('click', closeGroupModal);
document.getElementById('groupModal').addEventListener('click', e => {
  if (e.target === document.getElementById('groupModal')) closeGroupModal();
});

// --- サイドバーリサイズ ---
(function() {
  const handle = document.getElementById('sidebarResizeHandle');
  const sidebar = document.getElementById('sidebar');
  const STORAGE_KEY = 'sidebar-width';
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) sidebar.style.width = saved + 'px';

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
    const w = Math.min(400, Math.max(140, startW + e.clientX - startX));
    sidebar.style.width = w + 'px';
  }
  function onUp() {
    handle.classList.remove('dragging');
    localStorage.setItem(STORAGE_KEY, sidebar.offsetWidth);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  }
})();

init();
