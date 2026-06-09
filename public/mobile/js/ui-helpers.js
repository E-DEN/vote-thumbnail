// mobile/js/ui-helpers.js
// モバイル共通 SVGアイコン・メタ構築ヘルパー
import { getRating } from '../../js/rating.js';
import { formatViewsShort, formatRelTime } from '../../js/format.js';

export const _M_SVG_EYE  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
export const _M_SVG_CLK  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
export const _M_SVG_STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
export const _M_SVG_PLAY  = '<svg viewBox="0 0 24 24" fill="currentColor" width="38" height="38"><path d="M8 5v14l11-7z"/></svg>';
export const _M_SVG_PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" width="38" height="38"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
export const _M_SVG_FULLSCREEN      = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';
export const _M_SVG_FULLSCREEN_EXIT = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>';
export const _M_SVG_PIN  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';

// --- メタ構築（PC版の _buildVideoMeta / _buildPinDot に相当）---
export function _mBuildMeta(v) {
  const items = [];
  if (v.viewCount)   items.push('<span class="m-meta-item">' + _M_SVG_EYE + formatViewsShort(v.viewCount) + '</span>');
  if (v.scheduledAt) {
    items.push('<span class="m-meta-item">' + _M_SVG_CLK + formatRelTime(v.scheduledAt) + (globalThis.t ? globalThis.t('fmt-live-scheduled') : 'にライブ配信予定') + '</span>');
  } else if (v.publishedAt) items.push('<span class="m-meta-item">' + _M_SVG_CLK + formatRelTime(v.publishedAt) + '</span>');
  items.push('<span class="m-meta-item">' + _M_SVG_STAR + Math.round(getRating(v.id)) + '</span>');
  return items.join('');
}

// myPins, pinColor は reaction.js の状態を呼び出し元が渡す
export function _mBuildPinDot(v, myPins, pinColor) {
  if (!myPins[v.id]) return '';
  return '<span class="m-meta-item m-meta-pinned">' + _M_SVG_PIN
    + '<span class="m-meta-pin-dot" style="background:' + (pinColor || '#ec4899') + '"></span></span>';
}
