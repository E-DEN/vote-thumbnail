import { getStoredApiKey } from './channel.js';

const BASE = 'https://www.googleapis.com/youtube/v3';

// --- API ヘルパー ---
export async function apiFetch(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const e = new Error(body.error?.message ?? res.status);
    if (res.status === 400 || res.status === 403) e.code = 'API_KEY_INVALID';
    throw e;
  }
  return res.json();
}

export function parseChannel(url) {
  const mHandle = url.match(/@([\w.-]+)/);
  if (mHandle) return { type: 'handle', value: mHandle[1] };
  const mId = url.match(/channel\/(UC[\w-]+)/);
  if (mId) return { type: 'id', value: mId[1] };
  return null;
}

// 動画URLから動画IDを抜く
export function parseVideoId(url) {
  const mWatch = url.match(/[?&]v=([\w-]{11})/);
  if (mWatch) return mWatch[1];
  const mShort = url.match(/youtu\.be\/([\w-]{11})/);
  if (mShort) return mShort[1];
  const mShorts = url.match(/\/shorts\/([\w-]{11})/);
  if (mShorts) return mShorts[1];
  return null;
}

// 動画ID → チャンネルIDを取得
export async function getChannelIdFromVideo(apiKey, videoId) {
  const params = new URLSearchParams({ part: 'snippet', id: videoId, key: apiKey });
  const data = await apiFetch(`${BASE}/videos?${params}`);
  const channelId = data.items?.[0]?.snippet?.channelId;
  if (!channelId) throw new Error('動画が見つかりませんでした');
  return channelId;
}

export async function getUploadsPlaylistId(apiKey, channel) {
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

export async function getAllVideoIds(apiKey, playlistId, onProgress) {
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

export function parseDurationSec(iso) {
  if (typeof iso !== 'string') return 0;
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] ?? 0) * 3600) + (parseInt(m[2] ?? 0) * 60) + parseInt(m[3] ?? 0);
}

export async function getVideoDetails(apiKey, videoIds, onProgress) {
  const results = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const params = new URLSearchParams({ part: 'snippet,contentDetails,liveStreamingDetails,statistics', id: batch.join(','), key: apiKey });
    const data = await apiFetch(`${BASE}/videos?${params}`);
    for (const v of data.items ?? []) {
      const dur = parseDurationSec(v.contentDetails?.duration);
      const isLive = !!v.liveStreamingDetails;
      const isShort = !isLive && dur > 0 && dur <= 180;
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
export async function importAllChannelVideos(channelId, onStatus) {
  const apiKey = getStoredApiKey();
  if (!apiKey) throw new Error('API キーが設定されていません（設定 > API Key）');

  onStatus('プレイリスト ID を取得中...');
  const { playlistId } = await getUploadsPlaylistId(apiKey, { type: 'id', value: channelId });

  const suffix = channelId.slice(2);
  onStatus('動画 ID を取得中 (0 件)...');
  // UU・UUSH・UULV を並列取得してプレイリスト所属で正確に振り分け
  const safeIds = (plId) => getAllVideoIds(apiKey, plId, () => {}).catch(() => []);
  const [videoIds, shortsIds, liveIds] = await Promise.all([
    getAllVideoIds(apiKey, playlistId, (done, total) => {
      onStatus('動画 ID を取得中 (' + done + ' / ' + total + ' 件)...');
    }),
    safeIds('UUSH' + suffix),
    safeIds('UULV' + suffix),
  ]);
  const shortsSet = new Set(shortsIds);
  const liveSet = new Set(liveIds);

  onStatus('動画情報を取得中 (0 / ' + videoIds.length + ' 件)...');
  const videos = await getVideoDetails(apiKey, videoIds, (done, total) => {
    onStatus('動画情報を取得中 (' + done + ' / ' + total + ' 件)...');
  });
  const availableIds = new Set(videos.map(v => v.id));
  const hiddenVideoIds = videoIds.filter(id => !availableIds.has(id));

  // プレイリスト所属で分類を上書き (duration 判定より正確)
  for (const v of videos) {
    if (liveSet.has(v.id)) v.category = 'live';
    else if (shortsSet.has(v.id)) v.category = 'shorts';
    else v.category = 'videos';
  }

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
  if (hiddenVideoIds.length > 0) {
    const res = await fetch('/api/channels/' + channelId + '/videos/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hiddenVideoIds }),
    });
    if (!res.ok) throw new Error('非表示動画の保存エラー: ' + res.status);
  }
  return videos.length;
}
