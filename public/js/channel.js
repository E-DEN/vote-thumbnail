// channel.js — チャンネル追加・API キー関連の共通ユーティリティ
// PC (js/app.js) とモバイル (mobile/js/app.js) の両方から import して使用する

import { LS_API_KEY, LS_RSS_ONLY } from './state.js';

/** localStorage から YouTube API キーを取得する */
export function getStoredApiKey() { return localStorage.getItem(LS_API_KEY) || ''; }

/** RSS Only モードかどうかを返す */
export function getRssOnly() { return localStorage.getItem(LS_RSS_ONLY) === '1'; }

/** API キーが設定されていれば X-YouTube-Api-Key ヘッダーを返す */
export function apiKeyHeaders() {
  const k = getStoredApiKey();
  return k ? { 'X-YouTube-Api-Key': k } : {};
}

/**
 * 入力文字列（URL・ハンドル・チャンネルID）を解析してチャンネル特定情報を返す。
 * 返り値: { type: 'handle'|'id'|'videoId', value: string } または null
 */
export function channelKeyFromInput(input) {
  let trimmed;
  try { trimmed = decodeURIComponent(input.trim()); } catch { trimmed = input.trim(); }

  // @handle 形式（Unicode ハンドルにも対応）
  const mHandle = trimmed.match(/@([^\s/?#&]+)/);
  if (mHandle) return { type: 'handle', value: '@' + mHandle[1] };

  // youtube.com/channel/UCxxx
  const mChannelUrl = trimmed.match(/youtube\.com\/channel\/(UC[\w-]{22})/);
  if (mChannelUrl) return { type: 'id', value: mChannelUrl[1] };

  // 動画 URL → videoId（youtu.be / watch?v= / shorts / live / embed / v）
  const mVideo = trimmed.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|live\/|embed\/|v\/))([A-Za-z0-9_-]{11})/
  );
  if (mVideo) return { type: 'videoId', value: mVideo[1] };

  // URL 以外で UCxxx パターン
  const mUC = trimmed.match(/^(UC[\w-]{22})$/);
  if (mUC) return { type: 'id', value: mUC[1] };

  // 単純文字列 → ハンドルとして扱う（スペース・記号なし）
  if (/^[^\s/?#&]+$/.test(trimmed)) return { type: 'handle', value: '@' + trimmed };

  return null;
}
