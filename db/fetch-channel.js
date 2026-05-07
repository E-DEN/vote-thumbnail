// db/fetch-channel.js
// YouTube API でチャンネル情報・動画一覧を取得して SQLite に登録する
//
// 使い方:
//   node db/fetch-channel.js <チャンネルURL> [--db db/vote]
//
// 例:
//   node db/fetch-channel.js https://www.youtube.com/@yokomoridayo
//   node db/fetch-channel.js https://www.youtube.com/@yokomoridayo --db db/vote

'use strict';

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

// --- config.js から APIキーを取得 ---
const configPath = path.resolve(__dirname, '../config.js');
if (!fs.existsSync(configPath)) {
  console.error('config.js が見つかりません。config.example.js を参考に作成してください。');
  process.exit(1);
}
// config.js は const CONFIG = {...} という形式
const configSrc = fs.readFileSync(configPath, 'utf8');
const keyMatch  = configSrc.match(/youtubeApiKey\s*:\s*['"]([^'"]+)['"]/);
if (!keyMatch || keyMatch[1] === 'YOUR_YOUTUBE_API_KEY_HERE') {
  console.error('config.js に有効な youtubeApiKey が設定されていません。');
  process.exit(1);
}
const API_KEY = keyMatch[1];

// --- 引数解析 ---
const args       = process.argv.slice(2);
const channelUrl = args.find(a => !a.startsWith('--'));
const dbIdx      = args.indexOf('--db');
const dbPath     = dbIdx !== -1 ? args[dbIdx + 1] : 'db/vote';

if (!channelUrl) {
  console.error('Usage: node db/fetch-channel.js <チャンネルURL> [--db db/vote]');
  process.exit(1);
}

const BASE = 'https://www.googleapis.com/youtube/v3';

// --- チャンネルURL解析 ---
function parseChannel(url) {
  const mHandle = url.match(/@([\w.-]+)/);
  if (mHandle) return { type: 'handle', value: mHandle[1] };
  const mId = url.match(/channel\/(UC[\w-]+)/);
  if (mId) return { type: 'id', value: mId[1] };
  return null;
}

// --- チャンネルキー生成 ---
function channelKeyFromUrl(url) {
  const m = url.match(/@([\w.-]+)/);
  if (m) return m[1].toLowerCase();
  const mi = url.match(/UC([\w-]+)/);
  if (mi) return 'UC' + mi[1];
  return url.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 20) || 'channel';
}

// --- fetch (Node.js 18+内蔵) ---
async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error?.message ?? String(res.status));
  }
  return res.json();
}

async function getChannelMeta(channel) {
  const params = new URLSearchParams({ part: 'contentDetails,snippet', key: API_KEY });
  if (channel.type === 'handle') params.set('forHandle', channel.value);
  else params.set('id', channel.value);
  const data = await apiFetch(`${BASE}/channels?${params}`);
  const item = data.items?.[0];
  if (!item) throw new Error('チャンネルが見つかりませんでした');
  return {
    playlistId:  item.contentDetails.relatedPlaylists.uploads,
    channelName: item.snippet.title ?? '',
    channelId:   item.id ?? '',
    handle:      item.snippet.customUrl ?? null, // @handle 形式
    avatar:      item.snippet.thumbnails?.default?.url
                 ?? item.snippet.thumbnails?.medium?.url ?? '',
  };
}

async function getAllVideoIds(playlistId) {
  const ids = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ part: 'contentDetails', playlistId, maxResults: 50, key: API_KEY });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await apiFetch(`${BASE}/playlistItems?${params}`);
    for (const item of data.items ?? []) ids.push(item.contentDetails.videoId);
    pageToken = data.nextPageToken ?? '';
    process.stdout.write(`\r動画ID取得中: ${ids.length} 件...`);
  } while (pageToken);
  process.stdout.write('\n');
  return ids;
}

function parseDurationSec(iso) {
  const m = iso?.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] ?? 0) * 3600) + (parseInt(m[2] ?? 0) * 60) + parseInt(m[3] ?? 0);
}

async function getVideoDetails(videoIds) {
  const results = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch  = videoIds.slice(i, i + 50);
    const params = new URLSearchParams({
      part: 'snippet,contentDetails,liveStreamingDetails,statistics',
      id: batch.join(','),
      key: API_KEY,
    });
    const data = await apiFetch(`${BASE}/videos?${params}`);
    for (const v of data.items ?? []) {
      const dur    = parseDurationSec(v.contentDetails.duration);
      const isLive = !!v.liveStreamingDetails;
      const isShort = !isLive && dur <= 180;
      const category = isLive ? 'live' : isShort ? 'shorts' : 'videos';
      const thumbs = v.snippet.thumbnails;
      const thumb  = thumbs.maxres?.url ?? thumbs.standard?.url ?? thumbs.high?.url ?? thumbs.medium?.url ?? '';
      results.push({
        id:          v.id,
        title:       v.snippet.title,
        thumb,
        category,
        duration:    dur,
        viewCount:   parseInt(v.statistics?.viewCount ?? 0),
        publishedAt: v.snippet.publishedAt ?? '',
      });
    }
    process.stdout.write(`\r動画詳細取得中: ${Math.min(i + 50, videoIds.length)} / ${videoIds.length}`);
  }
  process.stdout.write('\n');
  return results;
}

// --- SQL エスケープ ---
function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number')         return isNaN(v) ? '0' : String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// --- メイン ---
(async () => {
  const channel = parseChannel(channelUrl);
  if (!channel) {
    console.error('URLの形式が不正です (@handle または /channel/UC... 形式にしてください)');
    process.exit(1);
  }

  console.log(`チャンネル情報を取得中: ${channelUrl}`);
  const meta = await getChannelMeta(channel);
  console.log(`チャンネル名: ${meta.channelName} (${meta.channelId})`);

  console.log('動画ID一覧を取得中...');
  const videoIds = await getAllVideoIds(meta.playlistId);
  console.log(`動画ID: ${videoIds.length} 件`);

  console.log('動画詳細を取得中...');
  const videos = await getVideoDetails(videoIds);
  console.log(`取得完了: ${videos.length} 件`);

  const channelKey = channelKeyFromUrl(channelUrl);
  const now        = new Date().toISOString();
  const handle     = meta.handle ?? ('@' + channel.value);

  const lines = [];

  // channel
  lines.push(
    `INSERT OR REPLACE INTO channels (channel_id, handle, title, icon_url, last_checked, last_accessed) VALUES (` +
    `${esc(channelKey)}, ${esc(handle)}, ${esc(meta.channelName)}, ${esc(meta.avatar)}, ${esc(now)}, ${esc(now)});`
  );

  // videos (INSERT OR IGNORE: 既存のレーティングは上書きしない)
  for (const v of videos) {
    lines.push(
      `INSERT OR IGNORE INTO videos (video_id, channel_id, title, thumbnail_url, category, duration, view_count, published_at) VALUES (` +
      `${esc(v.id)}, ${esc(channelKey)}, ${esc(v.title)}, ${esc(v.thumb)}, ` +
      `${esc(v.category)}, ${esc(v.duration)}, ${esc(v.viewCount)}, ${esc(v.publishedAt)});`
    );
    // 既存レコードはタイトル・サムネ・view_count のみ更新 (レーティングは保持)
    lines.push(
      `UPDATE videos SET title=${esc(v.title)}, thumbnail_url=${esc(v.thumb)}, view_count=${esc(v.viewCount)} ` +
      `WHERE video_id=${esc(v.id)};`
    );
  }

  const sql = lines.join('\n');

  try {
    execSync(`sqlite3 ${dbPath}`, { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
  } catch (e) {
    console.error('sqlite3 の実行に失敗しました:', e.message);
    process.exit(1);
  }

  // 結果確認
  const result = execSync(`sqlite3 ${dbPath} "SELECT COUNT(*) FROM videos WHERE channel_id=${esc(channelKey)};"`, { encoding: 'utf8' }).trim();
  console.log(`DB登録完了: ${channelKey} -> ${result} 件`);
})();
