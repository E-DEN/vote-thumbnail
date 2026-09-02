import { filteredVideos } from './storage.js';
import { getRating } from './rating.js';
import { formatRelTime, formatViewsShort, descToHtml } from './format.js';

// ギャラリーオーバーレイ用: 再生数・投稿日・レーティングのメタHTML
const _SVG_EYE  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const _SVG_CLK  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
const _SVG_STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>';
const _SVG_PIN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/></svg>';

let _getMyPins;
let _getPinColor;

export function configureVideoMeta(config) {
  _getMyPins = config.getMyPins;
  _getPinColor = config.getPinColor;
}

let _ratingRankMap = {};
export function _rebuildRatingRankMap() {
  const pool = filteredVideos().slice().sort(function(a, b) { return getRating(b.id) - getRating(a.id); });
  _ratingRankMap = {};
  pool.forEach(function(v, i) { _ratingRankMap[v.id] = i + 1; });
}

// --- 概要欄ユーティリティ ---
function _descToHtml(text) { return descToHtml(text); }

export function openVideoDesc(v) {
  const descEl = document.getElementById('rsDescText');
  if (!descEl) return;
  if (v.description === null || v.description === undefined || v.description === '') {
    descEl.textContent = '';
    return;
  }
  descEl.innerHTML = _descToHtml(v.description);
}

export function closeVideoDesc() {
  const descEl = document.getElementById('rsDescText');
  if (descEl) descEl.textContent = '';
}

export function _buildVideoMeta(v) {
  const items = [];
  if (v.viewCount) {
    items.push('<span class="gallery-meta-item">' + _SVG_EYE + formatViewsShort(v.viewCount) + '</span>');
  }
  if (v.scheduledAt) {
    items.push('<span class="gallery-meta-item">' + _SVG_CLK + formatRelTime(v.scheduledAt) + '</span>');
  } else if (v.publishedAt) {
    items.push('<span class="gallery-meta-item">' + _SVG_CLK + formatRelTime(v.publishedAt) + '</span>');
  }
  const rating = getRating(v.id);
  const rank = _ratingRankMap[v.id];
  const rankStr = rank ? '<span class="gallery-meta-rank">(#' + rank + ')</span>' : '';
  items.push('<span class="gallery-meta-item">' + _SVG_STAR + Math.round(rating) + rankStr + '</span>');
  return items.join('');
}

export function _buildPinDot(v) {
  const hasPinned = !!_getMyPins()[v.id];
  if (!hasPinned) return '';
  const dot = '<span class="gallery-meta-pin-dot" style="background:' + (_getPinColor() || '#ec4899') + '"></span>';
  return '<span class="gallery-meta-item">' + _SVG_PIN + dot + '</span>';
}

export function _buildReactionsVideoMeta(v) {
  const items = [];
  if (v.viewCount) {
    items.push('<span class="gallery-meta-item">' + _SVG_EYE + v.viewCount.toLocaleString() + '</span>');
  }
  if (v.scheduledAt) {
    const sd = new Date(v.scheduledAt);
    const sdStr = sd.getFullYear() + '/' + String(sd.getMonth()+1).padStart(2,'0') + '/' + String(sd.getDate()).padStart(2,'0');
    items.push('<span class="gallery-meta-item">' + _SVG_CLK + sdStr + ' ' + t('fmt-live-scheduled') + '</span>');
  } else if (v.publishedAt) {
    const d = new Date(v.publishedAt);
    const dateStr = d.getFullYear() + '/' + String(d.getMonth()+1).padStart(2,'0') + '/' + String(d.getDate()).padStart(2,'0');
    items.push('<span class="gallery-meta-item">' + _SVG_CLK + dateStr + '</span>');
  }
  const rating = getRating(v.id);
  const rank = _ratingRankMap[v.id];
  const rankStr = rank ? '<span class="gallery-meta-rank">(#' + rank + ')</span>' : '';
  items.push('<span class="gallery-meta-item">' + _SVG_STAR + Math.round(rating) + rankStr + '</span>');
  const metaHtml = '<div class="rs-meta-row">' + items.join('') + '</div>';
  return metaHtml;
}
