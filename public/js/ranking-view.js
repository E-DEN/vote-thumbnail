import { state } from './state.js';
import { filteredVideos, loadVideosForChannel } from './storage.js';
import { formatViews, formatRelTime } from './format.js';
import { getRating, getRd, getWins, getBattles } from './rating.js';

// --- ランキング状態 ---
let _rankMode = localStorage.getItem('thumb-rank-mode') || 'list'; // 'list' | 'depth'
let _depthScrollSaved = 0;
const _rankDepthOrder = localStorage.getItem('thumb-rank-depth-order') || 'desc';

const RANK_MAX = 30;

let _buildVideoMeta;
let _buildPinDot;
let _renderEmptyCat;
let _rebuildRatingRankMap;
let _openModalReactions;
let initDepthGallery;
let destroyDepthGallery;

export function configureRankingView(config) {
  _buildVideoMeta = config.buildVideoMeta;
  _buildPinDot = config.buildPinDot;
  _renderEmptyCat = config.renderEmptyCat;
  _rebuildRatingRankMap = config.rebuildRatingRankMap;
  _openModalReactions = config.openModalReactions;
  initDepthGallery = config.initDepthGallery;
  destroyDepthGallery = config.destroyDepthGallery;
}

export function getRankMode() {
  return _rankMode;
}

export function setRankMode(mode) {
  _rankMode = mode;
}

export function getDepthScrollSaved() {
  return _depthScrollSaved;
}

export function setDepthScrollSaved(scroll) {
  _depthScrollSaved = scroll;
}

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
    const _lowRd = rd > 150;
    const _videoUrl = v.url ?? `https://www.youtube.com/watch?v=${v.id}`;
    const rankNum = idx < 3 ? idx + 1 : idx + 1;
    const views = v.viewCount ? formatViews(v.viewCount) : '';
    const date  = v.publishedAt ? formatRelTime(v.publishedAt) : '';
    const _viewDate = [views, date].filter(Boolean).join(' · ');
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
          <span>${t('rank-wins-fmt', { w: wins, b: battles })}${battles > 0 ? t('rank-winrate-fmt', { r: wr }) : ''}</span>
        </div>
        ${metaHtml ? `<div class="rank-stats gallery-meta rank-meta-gallery">${metaHtml}</div>` : ''}
        <div class="rank-bar-bg"><div class="rank-bar-fill" style="width:${barPct}%"></div></div>
      </div>
    `;
    item.style.cursor = 'pointer';
    item.addEventListener('click', () => _openModalReactions(v));
    list.appendChild(item);
  });
}

export function renderRanking() {
  const _rs = document.getElementById('rankingScreen');
  // ボタン状態をモードに同期
  const _rlb = document.getElementById('rankModeListBtn');
  const _rdb = document.getElementById('rankModeDepthBtn');
  if (_rlb) _rlb.classList.toggle('active', _rankMode === 'list');
  if (_rdb) _rdb.classList.toggle('active', _rankMode === 'depth');
  if (_rankMode === 'depth') {
    if (_rs) _rs.classList.add('depth-mode');
    _renderRankingDepth();
    return;
  }
  if (typeof destroyDepthGallery === 'function') destroyDepthGallery();
  if (_rs) _rs.classList.remove('depth-mode');
  _rebuildRatingRankMap();
  const pool = filteredVideos();
  const sorted = [...pool].sort((a, b) => getRating(b.id) - getRating(a.id));
  const maxRating = sorted.length ? getRating(sorted[0].id) : 1500;
  const minRating = sorted.length ? getRating(sorted[sorted.length - 1].id) : 1500;
  const range = maxRating - minRating || 1;

  const list = document.getElementById('rankList');
  list.innerHTML = '';
  const _rankHeader = document.querySelector('.ranking-header');

  if (pool.length === 0) {
    if (_rankHeader) _rankHeader.style.display = 'none';
    _renderEmptyCat(list);
    return;
  }
  if (_rankHeader) _rankHeader.style.display = '';

  renderRankingItems(sorted, maxRating, minRating, range, 0, Math.min(RANK_MAX, sorted.length));
}

// ランキング画面のデプスギャラリーモード
export function _renderRankingDepth() {
  if (typeof initDepthGallery !== 'function') return;
  const pool = filteredVideos().slice().sort(function(a, b) { return getRating(b.id) - getRating(a.id); });
  const limited = pool.slice(0, Math.min(RANK_MAX, pool.length));
  if (!limited.length) return;
  // 表示順（asc = 1位が手前）
  const ordered = (_rankDepthOrder === 'asc') ? limited.slice().reverse() : limited;
  // 統計情報を付加した拡張オブジェクトを渡す
  const withStats = ordered.map(function(v, i) {
    const rank = (_rankDepthOrder === 'asc') ? (ordered.length - i) : (i + 1);
    const wins    = getWins(v.id);
    const battles = getBattles(v.id);
    const rating  = Math.round(getRating(v.id));
    const wr      = battles > 0 ? Math.round(wins / battles * 100) : null;
    return Object.assign({}, v, { _rank: rank, _wins: wins, _battles: battles, _rating: rating, _wr: wr });
  });
  const ch = state.channels[state.currentChannelKey];
  const channelTitle = ch ? (ch.name || ch.title || '') : '';
  const rankingScreen = document.getElementById('rankingScreen');
  initDepthGallery(withStats, channelTitle, rankingScreen, _depthScrollSaved);
  _depthScrollSaved = 0;
  // ラベルモードは follow 固定
  if (typeof window.setDepthLabelMode === 'function') window.setDepthLabelMode('follow');
}

// --- 最高レート動画ヘルパー ---
export function getTopRankedVideo(key) {
  const videos = loadVideosForChannel(key);
  if (!videos?.length) return null;
  const active = videos.filter(v => v.category !== 'shorts');
  if (!active.length) return null;
  return active.reduce((best, v) => getRating(v.id) >= getRating(best.id) ? v : best, active[0]);
}