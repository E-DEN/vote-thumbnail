// storage.js — チャンネル・動画ストレージ + API ヘルパー
import { state, LS_CHANNELS, LS_VIDEOS } from './state.js';
import { saveRating } from './rating.js';

// --- チャンネル ---
export function loadChannels() {
  const raw = localStorage.getItem(LS_CHANNELS);
  const loaded = raw ? JSON.parse(raw) : {};
  // state.channels の参照を壊さず中身を置き換える
  Object.keys(state.channels).forEach(k => delete state.channels[k]);
  Object.assign(state.channels, loaded);
}

export function saveChannels() {
  try { localStorage.setItem(LS_CHANNELS, JSON.stringify(state.channels)); } catch {}
}

// --- 動画キャッシュ ---
export function saveVideosForChannel(key, videos) {
  try { localStorage.setItem(LS_VIDEOS + '_' + key, JSON.stringify(videos)); } catch {}
}

export function loadVideosForChannel(key) {
  const raw = localStorage.getItem(LS_VIDEOS + '_' + key);
  return raw ? JSON.parse(raw) : null;
}

// --- API レスポンス変換 ---
/** サーバーのビデオ行をフロントエンド形式に変換する */
export function apiVideoToFrontend(v) {
  return {
    id:          v.video_id,
    title:       v.title,
    thumb:       v.thumbnail_url,
    category:    v.category,
    url:         'https://www.youtube.com/watch?v=' + v.video_id,
    viewCount:   v.view_count  ?? 0,
    publishedAt: v.published_at ?? '',
    duration:    v.duration    ?? 0,
    description: v.description ?? null,
  };
}

/** サーバーレスポンスから state.ratingData を更新する */
export function updateRatingFromApi(apiVideos) {
  for (const v of apiVideos) {
    state.ratingData[v.video_id] = {
      rating:     v.rating,
      rd:         v.rd,
      volatility: v.volatility,
      wins:       v.wins,
      battles:    v.battles,
    };
  }
}

/** チャンネルの全動画をサーバーから取得し state.ratingData も更新する */
export async function fetchChannelVideos(channelId) {
  const res = await fetch('/api/channels/' + channelId + '/videos');
  if (!res.ok) throw new Error('videos fetch failed: ' + res.status);
  const apiVideos = await res.json();
  updateRatingFromApi(apiVideos);
  return apiVideos.map(apiVideoToFrontend);
}

// --- カテゴリフィルタ ---
export function filteredVideos() {
  return state.allVideos.filter(v => v.category === state.currentCat);
}
