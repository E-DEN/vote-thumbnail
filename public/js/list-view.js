import { state, LS_SORT } from './state.js';
import { filteredVideos } from './storage.js';
import { formatDuration } from './format.js';
import { getRating } from './rating.js';

// --- 一覧状態 ---
let _listMode = localStorage.getItem('thumb-list-mode') || 'grid';
let _galleryObserver = null;
let _listSortOrder = localStorage.getItem(LS_SORT) || 'rating';  // 'date' | 'views' | 'rating' | 'random'
let _sortDir = localStorage.getItem('thumb-sort-dir') || 'desc'; // 'asc' | 'desc'
export const _SVG_SORT_DESC = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="M11 4h10"/><path d="M11 8h7"/><path d="M11 12h4"/></svg>';
export const _SVG_SORT_ASC  = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8 4-4 4 4"/><path d="M7 4v16"/><path d="M11 12h4"/><path d="M11 16h7"/><path d="M11 20h10"/></svg>';
let _listPage = 0;                // 読み込み済みページ数
const _LIST_PAGE_SIZE = 50;
let _listSortedPool = [];         // ソート済み全件キャッシュ
let _listScrollObserver = null;   // 無限スクロール用 observer

let _rebuildRatingRankMap;
let _renderEmptyCat;
let _buildVideoMeta;
let _buildPinDot;
let _openModalReactions;
let _getI18nDicts;
let _destroyDepthGallery;

export function configureListView(config) {
  _rebuildRatingRankMap = config.rebuildRatingRankMap;
  _renderEmptyCat = config.renderEmptyCat;
  _buildVideoMeta = config.buildVideoMeta;
  _buildPinDot = config.buildPinDot;
  _openModalReactions = config.openModalReactions;
  _getI18nDicts = config.getI18nDicts;
  _destroyDepthGallery = config.destroyDepthGallery;
}

export function getListMode() {
  return _listMode;
}

export function setListMode(mode) {
  _listMode = mode;
}

export function getListSortOrder() {
  return _listSortOrder;
}

export function setListSortOrder(order) {
  _listSortOrder = order;
}

export function getSortDir() {
  return _sortDir;
}

export function setSortDir(dir) {
  _sortDir = dir;
}

export function toggleSortDir() {
  _sortDir = _sortDir === 'desc' ? 'asc' : 'desc';
  return _sortDir;
}

const _SORT_LABELS = { views: '再生数', date: '投稿日', rating: '得票率' };
export function _updateSortUI() {
  const label = _SORT_LABELS[_listSortOrder] || _SORT_LABELS.views;
  const sl = document.getElementById('sortSplitLabel');
  const sp = document.getElementById('sortPopup');
  const sd = document.getElementById('sortSplitDir');
  if (sl) sl.textContent = label;
  if (sd) { sd.innerHTML = _sortDir === 'asc' ? _SVG_SORT_ASC : _SVG_SORT_DESC; sd.classList.toggle('asc', _sortDir === 'asc'); }
  if (sp) sp.querySelectorAll('[data-sort]').forEach(function(el) { el.classList.toggle('active', el.dataset.sort === _listSortOrder); });
  const rl = document.getElementById('rsSortLabel');
  const rp = document.getElementById('rsSortPopup');
  const rd = document.getElementById('rsSortDir');
  if (rl) rl.textContent = label;
  if (rd) { rd.innerHTML = _sortDir === 'asc' ? _SVG_SORT_ASC : _SVG_SORT_DESC; rd.classList.toggle('asc', _sortDir === 'asc'); }
  if (rp) rp.querySelectorAll('[data-sort]').forEach(function(el) { el.classList.toggle('active', el.dataset.sort === _listSortOrder); });
}

// 行パターン: [列数, flex-grow 重みの配列]
const _GALLERY_PATTERNS = [
  [3, [3, 2, 3]],
  [4, [2, 3, 2, 3]],
  [3, [2, 4, 2]],
  [4, [3, 2, 3, 2]],
];

export function renderList() {
  _rebuildRatingRankMap();
  const _listViewBar = document.getElementById('listViewBar');
  // depth以外のモードに切り替わったときはdepthを破棄
  if (_destroyDepthGallery) _destroyDepthGallery();
  if (_listMode === 'grid') { _renderGrid(); return; }
  // ギャラリーモード
  const grid = document.getElementById('listGrid');
  grid.innerHTML = '';
  grid.classList.remove('mode-grid', 'mode-shorts');

  // ソート済みプール構築
  _listPage = 0;
  _listSortedPool = _buildSortedPool();
  if (_listSortedPool.length === 0) {
    if (_listViewBar) _listViewBar.style.display = 'none';
    _renderEmptyCat(grid);
    return;
  }
  if (_listViewBar) _listViewBar.style.display = '';
  // 無限スクロール observer リセット
  if (_listScrollObserver) { _listScrollObserver.disconnect(); }
  _listScrollObserver = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting) { _appendGalleryPage(); }
  }, { rootMargin: '200px' });
  const sentinel = document.getElementById('shortsSentinel');
  if (sentinel) { _listScrollObserver.observe(sentinel); }

  // ギャラリーアニメーション observer（カテゴリ共通）
  if (_galleryObserver) { _galleryObserver.disconnect(); }
  const _scrollRoot = document.getElementById('listScrollBody');
  _galleryObserver = new IntersectionObserver(function(entries) {
    entries.forEach(function(e) {
      if (e.intersectionRatio >= 0.15) {
        e.target.classList.add('inbound');
      } else {
        e.target.classList.remove('inbound');
      }
    });
  }, { root: _scrollRoot, threshold: [0, 0.15] });

  if (state.currentCat === 'shorts') {
    grid.classList.add('mode-shorts');
  } else {
    grid.classList.remove('mode-shorts');
  }
  // 初回ロード
  _appendGalleryPage();
}

// 全カテゴリ共通: ソート済み全件プールを構築する
export function _buildSortedPool() {
  const pool = filteredVideos().slice();
  const asc = (_sortDir === 'asc');
  if (_listSortOrder === 'date') {
    pool.sort(function(a, b) {
      const cmp = (b.publishedAt || '') < (a.publishedAt || '') ? -1 : 1;
      return asc ? -cmp : cmp;
    });
  } else if (_listSortOrder === 'views') {
    pool.sort(function(a, b) {
      const cmp = (b.viewCount || 0) - (a.viewCount || 0);
      return asc ? -cmp : cmp;
    });
  } else if (_listSortOrder === 'rating') {
    pool.sort(function(a, b) {
      const cmp = getRating(b.id) - getRating(a.id);
      return asc ? -cmp : cmp;
    });
  }
  return pool;
}

// 全カテゴリ共通: 次ページ分のセルをグリッドに追記する
function _appendGalleryPage() {
  const grid = document.getElementById('listGrid');
  if (!grid) return;
  const start = _listPage * _LIST_PAGE_SIZE;
  if (start >= _listSortedPool.length) return;
  const slice = _listSortedPool.slice(start, start + _LIST_PAGE_SIZE);
  _listPage++;
  if (state.currentCat === 'shorts') {
    // ショート: waterfall セル
    slice.forEach(function(v) {
      const cell = document.createElement('div');
      cell.className = 'gallery-cell--short';
      const _meta = _buildVideoMeta(v) + _buildPinDot(v);
      cell.innerHTML =
        '<div class="short-crop">' +
          '<img src="' + v.thumb + '" alt="" loading="lazy"' +
          ' onerror="this.src=\'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg\'"' +
          ' referrerpolicy="no-referrer">' +
        '</div>' +
        '<div class="gallery-overlay">' +
          '<div class="gallery-title">' + v.title + '</div>' +
          (_meta ? '<div class="gallery-meta">' + _meta + '</div>' : '') +
        '</div>';
      cell.addEventListener('click', (function(vid) {
        return function() { _openModalReactions(vid); };
      }(v)));
      grid.appendChild(cell);
      if (_galleryObserver) { _galleryObserver.observe(cell); }
    });
  } else {
    // 通常: galleryレイアウト（行パターン）
    let pat = Math.floor(start / _LIST_PAGE_SIZE) % _GALLERY_PATTERNS.length;
    let i = 0;
    while (i < slice.length) {
      const conf    = _GALLERY_PATTERNS[pat % _GALLERY_PATTERNS.length];
      const count   = conf[0];
      const weights = conf[1];
      const row     = document.createElement('div');
      row.className = 'gallery-row';
      slice.slice(i, i + count).forEach(function(v, j) {
        const cell = document.createElement('div');
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
              (function(){ const m = _buildVideoMeta(v) + _buildPinDot(v); return m ? '<div class="gallery-meta">' + m + '</div>' : ''; }()) +
            '</div>' +
          '</div>';
        cell.addEventListener('click', (function(vid) {
          return function() { _openModalReactions(vid); };
        }(v)));
        row.appendChild(cell);
      });
      grid.appendChild(row);
      if (_galleryObserver) { _galleryObserver.observe(row); }
      i += Math.min(count, slice.length - i);
      pat++;
    }
  }
}

// ソートボタン・タブボタン: 全登録言語で計測し最大幅を min-width に設定する
const _sortBtnMaxWidths = {};
const _tabBtnMaxWidths  = {};
export function _normalizeSortBtnWidths() {
  const i18nDicts = _getI18nDicts();
  const codes = Object.keys(i18nDicts);

  function _measureGroup(btns, maxMap, keyAttr, i18nAttr) {
    // 元の状態を一括保存
    const origTxts = btns.map(function(b) { return b.textContent; });
    const origMins = btns.map(function(b) { return b.style.minWidth; });
    codes.forEach(function(code) {
      const dict = i18nDicts[code] || {};
      // 一括書き込み
      btns.forEach(function(b, i) {
        b.style.minWidth = '';
        b.textContent    = dict[b.dataset[i18nAttr]] || origTxts[i];
      });
      // 一括読み取り（強制リフローをここ1回にまとめる）
      btns.forEach(function(b) {
        const key = b.dataset[keyAttr];
        const w = b.offsetWidth;
        if (!maxMap[key] || w > maxMap[key]) { maxMap[key] = w; }
      });
      // 一括復元
      btns.forEach(function(b, i) {
        b.textContent    = origTxts[i];
        b.style.minWidth = origMins[i];
      });
    });
    // maxWidth を一括適用
    btns.forEach(function(b) {
      const key = b.dataset[keyAttr];
      if (maxMap[key]) { b.style.minWidth = maxMap[key] + 'px'; }
    });
  }

  _measureGroup(
    Array.from(document.querySelectorAll('.ch-tab[data-i18n]')),
    _tabBtnMaxWidths, 'view', 'i18n'
  );
  // スキップボタン（単独） -- 削除済み
  // const skipBtn = document.getElementById('skipBtn');
  // if (skipBtn && skipBtn.dataset.i18n) { _measureGroup([skipBtn], {}, 'id', 'i18n'); }
}

// グリッドモード（カード一覧）
function _renderGrid() {
  const grid = document.getElementById('listGrid');
  grid.innerHTML = '';
  grid.classList.remove('mode-shorts');
  grid.classList.add('mode-grid');
  grid.classList.toggle('mode-grid-shorts', state.currentCat === 'shorts');
  // ソート済みプール構築
  _listPage = 0;
  _listSortedPool = _buildSortedPool();
  if (_listSortedPool.length === 0) {
    const bar = document.getElementById('listViewBar');
    if (bar) bar.style.display = 'none';
    _renderEmptyCat(grid);
    return;
  }
  const bar = document.getElementById('listViewBar');
  if (bar) bar.style.display = '';
  // 無限スクロール observer リセット
  if (_listScrollObserver) { _listScrollObserver.disconnect(); }
  _listScrollObserver = new IntersectionObserver(function(entries) {
    if (entries[0].isIntersecting) { _appendGridPage(); }
  }, { rootMargin: '200px' });
  const sentinel = document.getElementById('shortsSentinel');
  if (sentinel) { _listScrollObserver.observe(sentinel); }
  _appendGridPage();
}

function _appendGridPage() {
  const grid = document.getElementById('listGrid');
  if (!grid) return;
  const start = _listPage * _LIST_PAGE_SIZE;
  if (start >= _listSortedPool.length) return;
  const slice = _listSortedPool.slice(start, start + _LIST_PAGE_SIZE);
  _listPage++;
  slice.forEach(function(v) {
    const durHtml = v.duration
      ? '<span class="list-duration">' + formatDuration(v.duration) + '</span>'
      : '';
    const metaHtml = _buildVideoMeta(v) + _buildPinDot(v);
    const card = document.createElement('div');
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
      return function() { _openModalReactions(vid); };
    }(v)));
    grid.appendChild(card);
  });
}