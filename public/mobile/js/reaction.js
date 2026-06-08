// mobile/js/reaction.js
// リアクション機能（ピン・ヒートマップ・トランスポート・プレイリスト）

const _M_PLACEHOLDER_SVG_MONITOR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg>';
function _mRsPlaceholderHtml(text) {
  return _M_PLACEHOLDER_SVG_MONITOR + '<p>' + text + '</p>';
}
import { state } from '../../js/state.js';
import { filteredVideos } from '../../js/storage.js';
import { getRating } from '../../js/rating.js';
import { formatViewsShort, formatRelTime } from '../../js/format.js';
import { _suppressHistory } from './shared-state.js';
import { _M_SVG_EYE, _M_SVG_CLK, _M_SVG_PIN, _M_SVG_FULLSCREEN, _M_SVG_FULLSCREEN_EXIT, _mBuildMeta, _mBuildPinDot } from './ui-helpers.js';

// switchTab コールバック（app.js からの循環依存を避ける）
let _switchTab = null;
export function initReaction(fn) { _switchTab = fn; }

var _mRsSessionId = (function() {
  var k = 'thumb-session-id';
  var s = localStorage.getItem(k);
  if (!s) {
    s = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
    localStorage.setItem(k, s);
  }
  return s;
})();

let _mRsCurrentVideoId = null;
let _mRsLoadedVideoId  = null; // mRsOpenMode が実際に初期化した動画 ID
let _mRsCatVideoState  = {};    // カテゴリ別の最後に選択した動画 ID
let _mRsActive         = false;
let _mRsPinsVisible    = true;
let _mRsHeatmapVisible = false;
let _mRsPins           = [];
let _mRsKde            = null;
let _mRsMyPins         = {};
let _mRsPinColor       = localStorage.getItem('react-pin-color') || '#ec4899';
let _mRsMyPinOnDrop    = null;
let _mRsMyPinAnimRaf   = 0;

// 自分のピン一括取得（loadMyPins と同等）
async function loadMyPins() {
  try {
    const resp = await fetch('/api/pins/my?session=' + encodeURIComponent(_mRsSessionId));
    if (!resp.ok) return;
    const data = await resp.json();
    (data.pins || []).forEach(p => {
      if (!_mRsMyPins[p.video_id]) {
        _mRsMyPins[p.video_id] = { x: p.x, y: p.y };
      }
    });
  } catch {}
}

// ピンドラッグ状態
let _mRsPinDragging   = false;
let _mRsPinDragId     = null;
let _mRsPinDropped    = false;  // 落下アニメーション完了フラグ
let _mRsPinDropTarget = null;   // タッチ時の初期座標 {x, y}
let _mRsNormalPlaced  = [];     // 通常モードの全計算済みコミュニティピン（最大30本）

// 最大ピン数
const LS_RS_MAX_PINS = 'thumb-rs-max-pins';
let _mRsMaxPins = parseInt(localStorage.getItem(LS_RS_MAX_PINS) || '10', 10);
// ピン透過度
const LS_RS_PIN_OPACITY = 'thumb-rs-pin-opacity';
let _mRsPinOpacity = parseFloat(localStorage.getItem(LS_RS_PIN_OPACITY) || '1');

// プレイリストソート状慁E
const LS_RS_SORT     = 'thumb-rs-sort';
const LS_RS_SORT_DIR = 'thumb-rs-sort-dir';
let _mRsSortOrder = localStorage.getItem(LS_RS_SORT)     || 'views';
let _mRsSortDir   = localStorage.getItem(LS_RS_SORT_DIR) || 'desc';

// トランスポート状態
let _mRsTransportVisible = true;
let _mRsPlaying      = false;
let _mRsOverlayTimer = null;  // オーバーレイ自動非表示タイマー
let _mRsSeekFadeTimer = null; // 再生後のシークバーフェードタイマー
let _mRsRafId        = null;
let _mRsLastRafTs    = null;
let _mRsDuration     = 4;
let _mRsCurrentTime  = 0;
let _mRsPlacedPins   = [];
let _mRsEmittedCount = 0;
let _mRsMyPinEmitAt  = -1;
let _mRsMyPinEmitted = false;

const PIN_SNAPS_M = [0, 1, 5, 10, 15, 20, 25, 30];
// PIN_PALETTES / PIN_DROP_HEIGHT / PIN_DROP_SPEED / PIN_FADE_IN_FRAC は
// reactions-utils.js でグローバル定義済み

function mRsApplyPalette() {
  const wrap = document.getElementById('mRsImgWrap');
  if (!wrap) return;
  const palette = PIN_PALETTES[_mRsPinColor] || PIN_PALETTES['#ec4899'];
  wrap.style.setProperty('--pin-c0', palette[0]);
  wrap.style.setProperty('--pin-c1', palette[1]);
  wrap.style.setProperty('--pin-c2', palette[2]);
}

// KDE 重み計箁EↁEreactions-utils.js の pinComputeKde に委譲
function mRsComputeKde(pins) {
  return pinComputeKde(pins);
}

// グリッドクラスタリング → reactions-utils.js の pinComputeClusters に委譲
function mRsComputeClusters(pins) {
  return pinComputeClusters(pins);
}

// ダミーピン補完 → reactions-utils.js の pinFillDummy に委譲
function _mRsFillDummyPins(pins) {
  pinFillDummy(pins, 30);
}

// 表示ピン一覧を構篁EↁEreactions-utils.js の pinBuildPlaced に委譲
function mRsBuildPlacedPins(count) {
  if (count == null) count = _mRsMaxPins;
  return pinBuildPlaced(_mRsPins, count);
}

// ピン DOM 要素を生戁EↁEreactions-utils.js の pinMakeElement に委譲
function mRsMakePinEl(x, y, density, skipDropAnim, pinProps) {
  return pinMakeElement(x, y, density, skipDropAnim, pinProps, PIN_PALETTES[_mRsPinColor] || PIN_PALETTES['#ec4899']);
}

// ヒートマップを canvas に描画
function mRsRenderHeatmap() {
  const layer = document.getElementById('mRsHeatmapLayer');
  if (!layer) return;
  const w = layer.offsetWidth, h = layer.offsetHeight;
  if (!w || !h) return;
  let canvas = layer.querySelector('canvas');
  if (!canvas) {
    layer.innerHTML = '';
    const underlay = document.createElement('div');
    underlay.style.cssText = 'position:absolute;inset:0;background:rgba(0,0,0,0.70);pointer-events:none;';
    canvas = document.createElement('canvas');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
    layer.appendChild(underlay);
    layer.appendChild(canvas);
  }
  // blur をキャンバスサイズに比例させる（絶対値だとモバイルで相対的に大きくなりすぎる）
  canvas.style.filter = 'blur(' + Math.round(Math.min(w, h) * 0.052) + 'px)';
  if (!_mRsPins.length) {
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').clearRect(0, 0, w, h);
    return;
  }
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  ctx.globalCompositeOperation = 'lighter';
  const hex = (_mRsPinColor || '#ec4899').replace('#', '');
  const cr = parseInt(hex.slice(0, 2), 16);
  const cg = parseInt(hex.slice(2, 4), 16);
  const cb = parseInt(hex.slice(4, 6), 16);
  const radius = Math.min(w, h) * 0.22;
  const alpha  = Math.min(0.25, 4.0 / _mRsPins.length);
  for (const p of _mRsPins) {
    const cx = p.x * w, cy = p.y * h;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0,   'rgba(' + cr + ',' + cg + ',' + cb + ',' + alpha.toFixed(4) + ')');
    grad.addColorStop(0.3, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (alpha * 0.6).toFixed(4) + ')');
    grad.addColorStop(0.7, 'rgba(' + cr + ',' + cg + ',' + cb + ',' + (alpha * 0.15).toFixed(4) + ')');
    grad.addColorStop(1,   'rgba(' + cr + ',' + cg + ',' + cb + ',0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();
  }
}

// コミュニティピンを順次降下アニメーションで表示
function mRsStartLoop(skipMyPin) {
  _mRsActive = false;
  const pinsLayer = document.getElementById('mRsPinsLayer');
  if (!pinsLayer) return;
  pinsLayer.innerHTML = '';
  // 後でピン数増減する際に使えるよう30本分先行計算
  _mRsNormalPlaced = mRsBuildPlacedPins(30);
  const commLimit = _mRsCommLimit(_mRsMaxPins);
  const placed = _mRsNormalPlaced.slice(0, commLimit > 0 ? commLimit : 0);
  if (!placed.length) {
    const saved = _mRsMyPins[_mRsCurrentVideoId];
    if (saved && _mRsPinsVisible && !skipMyPin) mRsShowMyPin(saved.x, saved.y, true);
    return;
  }
  _mRsActive = true;
  let emitted = 0;
  function spawnOne() {
    if (!_mRsActive || emitted >= placed.length) { _mRsActive = false; return; }
    const pin = placed[emitted++];
    pinsLayer.appendChild(mRsMakePinEl(pin.x, pin.y, pin.density));
    setTimeout(spawnOne, 80 + Math.random() * 200);
  }
  for (let s = 0; s < 5; s++) setTimeout(() => { if (_mRsActive) spawnOne(); }, s * 80);
  // 自分のピンを落下アニメーション付きで復元
  if (!skipMyPin) {
    const saved = _mRsMyPins[_mRsCurrentVideoId];
    if (saved) mRsShowMyPin(saved.x, saved.y, true);
  }
}

// カラー更新: 既存コミュニティピンの fill をその場で書き換え（アニメーション維持）
function _mRsRefreshPinColors() {
  const pinsLayer = document.getElementById('mRsPinsLayer');
  if (!pinsLayer) return;
  const palette = PIN_PALETTES[_mRsPinColor] || PIN_PALETTES['#ec4899'];
  pinsLayer.querySelectorAll('.reactions-pin').forEach(el => {
    const d = parseFloat(el.dataset.density) || 0.5;
    const balloon = el.querySelector('.pin-balloon');
    if (balloon) balloon.style.fill = pinColorFromDensity(d, palette);
  });
}

// ピン数調整: アニメーションを維持したまま表示数を増減
function _mRsRefreshPinCount() {
  const pinsLayer = document.getElementById('mRsPinsLayer');
  if (!pinsLayer) return;
  _mRsActive = false; // スポーン中のタイマーを止める
  const cLimit = _mRsCommLimit(_mRsMaxPins);
  const existingPins = Array.from(pinsLayer.querySelectorAll('.reactions-pin'));
  const currentCount = existingPins.length;
  if (currentCount > cLimit) {
    for (let i = cLimit; i < currentCount; i++) existingPins[i].remove();
    if (_mRsEmittedCount > cLimit) _mRsEmittedCount = cLimit;
  } else if (currentCount < cLimit) {
    if (_mRsTransportVisible && _mRsPlacedPins && _mRsPlacedPins.length) {
      // トランスポートモード: PC と同様に emitAt <= 現在時刻 のピンのみ追加
      const toAdd = Math.min(cLimit, _mRsPlacedPins.length);
      for (let i = _mRsEmittedCount; i < toAdd; i++) {
        if (_mRsPlacedPins[i].emitAt <= _mRsCurrentTime) {
          const el = mRsMakePinEl(_mRsPlacedPins[i].x, _mRsPlacedPins[i].y, _mRsPlacedPins[i].density, true, _mRsPlacedPins[i]);
          const m = el.style.animation.match(/reactionsPinFloat\s+([\d.]+)/);
          const dur = m ? parseFloat(m[1]) : 2.8;
          el.style.animationDelay = '-' + (Math.random() * dur).toFixed(2) + 's';
          pinsLayer.appendChild(el);
          _mRsEmittedCount++;
        } else {
          break;
        }
      }
    } else {
      // 通常モード: _mRsNormalPlaced から追加
      const toAdd = Math.min(cLimit, _mRsNormalPlaced.length);
      for (let i = currentCount; i < toAdd; i++) {
        const el = mRsMakePinEl(_mRsNormalPlaced[i].x, _mRsNormalPlaced[i].y, _mRsNormalPlaced[i].density, true, _mRsNormalPlaced[i]);
        const m = el.style.animation.match(/reactionsPinFloat\s+([\d.]+)/);
        const dur = m ? parseFloat(m[1]) : 2.8;
        el.style.animationDelay = '-' + (Math.random() * dur).toFixed(2) + 's';
        pinsLayer.appendChild(el);
      }
    }
  }
}

// ドラッグ中: ピンを「刺さった状態」で即時移動（アニメーションなし）
function _mRsMovePinDrag(x, y) {
  const pin    = document.getElementById('mRsMyPin');
  const svg    = document.getElementById('mRsMyPinSvg');
  const shadow = document.getElementById('mRsMyPinShadow');
  if (!pin || !svg) return;
  const tipGap = (45 / 30).toFixed(2);
  if (_mRsMyPinOnDrop) { pin.removeEventListener('animationend', _mRsMyPinOnDrop); _mRsMyPinOnDrop = null; }
  if (_mRsMyPinAnimRaf) { cancelAnimationFrame(_mRsMyPinAnimRaf); _mRsMyPinAnimRaf = 0; }
  // iOS Safari: hidden→repositon→unhide でGPUコンポジット層の残像を確実に破棄
  pin.hidden = true;
  pin.style.animation = 'none';
  svg.style.animation = 'none';
  pin.getAnimations().forEach(a => a.cancel());
  svg.getAnimations().forEach(a => a.cancel());
  pin.style.left      = (x * 100) + '%';
  pin.style.top       = 'calc(' + (y * 100) + '% + ' + tipGap + 'px)';
  pin.style.transform = 'translate(-50%, -100%)';
  pin.style.opacity   = String(_mRsPinOpacity);
  pin.classList.remove('color-cycling', 'rs-floating');
  pin.hidden = false;
  if (shadow) shadow.hidden = true;
}

// 自分のピンを指定位置に表示（withAnim=true で落下アニメーション）
function mRsShowMyPin(x, y, withAnim, onLanded, dropSpeed) {
  // 好きOFF時はピンを表示しない
  if (!_mRsPinsVisible) return;
  const pin    = document.getElementById('mRsMyPin');
  const svg    = document.getElementById('mRsMyPinSvg');
  const shadow = document.getElementById('mRsMyPinShadow');
  const tipGap = (45 / 30).toFixed(2);
  pin.style.left = (x * 100) + '%';
  pin.style.top  = 'calc(' + (y * 100) + '% + ' + tipGap + 'px)';
  pin.style.setProperty('--drop-h', PIN_DROP_HEIGHT + 'px');
  pin.hidden = false;
  if (shadow) {
    shadow.style.left = (x * 100) + '%';
    shadow.style.top  = 'calc(' + (y * 100) + '% + ' + tipGap + 'px)';
    shadow.hidden = false;
  }
  if (_mRsMyPinOnDrop) { pin.removeEventListener('animationend', _mRsMyPinOnDrop); _mRsMyPinOnDrop = null; }
  if (_mRsMyPinAnimRaf) { cancelAnimationFrame(_mRsMyPinAnimRaf); _mRsMyPinAnimRaf = 0; }
  pin.classList.remove('color-cycling');
  pin.getAnimations().forEach(a => a.cancel());
  svg.getAnimations().forEach(a => a.cancel());
  pin.style.transform = '';
  pin.style.opacity   = '';
  pin.style.animation = 'none';
  svg.style.animation = 'none';
  _mRsMyPinAnimRaf = requestAnimationFrame(() => {
    _mRsMyPinAnimRaf = 0;
    const floatDur = (2.4 + Math.random() * 0.8).toFixed(2) + 's';
    const speed = (dropSpeed != null) ? dropSpeed : PIN_DROP_SPEED;
    if (withAnim) {
      pin.style.animation = 'reactionsPinDrop ' + speed + 's linear forwards';
      svg.style.animation = 'reactionsPinSvgSquash ' + speed + 's linear forwards';
      pin.animate(
        [{ opacity: 0, offset: 0 }, { opacity: _mRsPinOpacity, offset: PIN_FADE_IN_FRAC }, { opacity: _mRsPinOpacity, offset: 1 }],
        { duration: speed * 1000, fill: 'forwards', easing: 'linear' }
      );
      _mRsMyPinOnDrop = e => {
        if (e.animationName !== 'reactionsPinDrop') return;
        _mRsMyPinOnDrop = null;
        // CSS アニメーションは style 書き換えで直接切り替え（cancel 不要）
        // ↁEreactionsPinDrop の fill: forwards が外れる空白フレームでピンぁE
        //   45px ずれるバグを回避する
        pin.style.animation = 'reactionsPinFloat ' + floatDur + ' ease-in-out infinite';
        svg.style.animation = '';
        // WAAPI の opacity アニメーション（fill: forwards）だと cancel して inline に固定
        pin.getAnimations().forEach(a => {
          if (!(a instanceof CSSAnimation)) { a.cancel(); }
        });
        pin.style.opacity = String(_mRsPinOpacity);
        pin.classList.add('color-cycling', 'rs-floating');
        if (onLanded) onLanded();
      };
      pin.addEventListener('animationend', _mRsMyPinOnDrop);
    } else {
      pin.style.transform = 'translate(-50%, -100%)';
      pin.style.opacity   = String(_mRsPinOpacity);
      pin.style.animation = 'reactionsPinFloat ' + floatDur + ' ease-in-out infinite';
      svg.style.animation = '';
      pin.classList.add('color-cycling', 'rs-floating');
    }
  });
}

// 現在の動画の seeds を API から取得してアニメーションを開始
async function mRsOpenMode(videoId) {
  if (!videoId) return;
  _mRsActive         = false;
  _mRsLoadedVideoId  = videoId; // 描画済み ID を更新（早い段階でセットする）
  _mRsCurrentVideoId = videoId;

  // プレイリストの selected ハイライトを同期（popstate 等で直接呼ばれる場合もクリック時と同じ状態にする）
  const listEl = document.getElementById('mRsPlaylist');
  if (listEl) {
    let selectedEl = null;
    listEl.querySelectorAll('.m-rs-playlist-item').forEach(el => {
      const match = el.dataset.vid === videoId;
      el.classList.toggle('selected', match);
      if (match) selectedEl = el;
    });
    if (selectedEl) requestAnimationFrame(() => selectedEl.scrollIntoView({ block: 'nearest' }));
  }

  // history エントリの vid を最新化（タブ切替直後は vid=null のまま残るため、戻る時に正しく復元できるようにする）
  if (!_suppressHistory) {
    const curSt = history.state;
    if (curSt && curSt.tab === 'reaction' && curSt.vid !== videoId) {
      history.replaceState(Object.assign({}, curSt, { vid: videoId }), '');
    }
  }

  _mRsPins          = [];
  _mRsKde           = null;
  const pinsLayer   = document.getElementById('mRsPinsLayer');
  const hmLayer     = document.getElementById('mRsHeatmapLayer');
  const myPin       = document.getElementById('mRsMyPin');
  const myPinShadow = document.getElementById('mRsMyPinShadow');
  if (pinsLayer)    pinsLayer.innerHTML = '';
  if (hmLayer)      { hmLayer.style.cssText = 'opacity:0;visibility:hidden;'; hmLayer.innerHTML = ''; }
  if (myPin)        myPin.hidden = true;
  if (myPinShadow)  myPinShadow.hidden = true;
  mRsApplyPalette();
  // サムネイルを表示
  const v = filteredVideos().find(vid => vid.id === videoId);
  const img         = document.getElementById('mRsImg');
  const placeholder = document.getElementById('mRsPlaceholder');
  const toolbar     = document.getElementById('mRsToolbar');
  const titleEl     = document.getElementById('mRsVideoTitle');
  if (v) {
    img.src     = v.thumb;
    img.hidden  = false;
    img.onerror = function() { this.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'; };
    if (placeholder) placeholder.hidden = true;
    if (toolbar)  toolbar.hidden = false;
    const seekEl = document.getElementById('mRsSeek');
    if (seekEl) seekEl.hidden = !_mRsTransportVisible;
    if (titleEl)  { titleEl.textContent = v.title || ''; titleEl.href = 'https://www.youtube.com/watch?v=' + v.id; }
    mRsRenderVideoMeta(v);
  }
  // seeds ロード後にピン・ヒートマップを開始
  try {
    const resp = await fetch('/api/pins/' + videoId + '/seeds?session=' + encodeURIComponent(_mRsSessionId));
    if (resp.ok) {
      const data = await resp.json();
      _mRsPins = data.pins || [];
      if (data.demo_fill || /^(localhost|127\.|192\.168\.)/.test(location.hostname)) _mRsFillDummyPins(_mRsPins);
      _mRsKde  = mRsComputeKde(_mRsPins);
      if (data.my_pin && !_mRsMyPins[videoId]) {
        _mRsMyPins[videoId] = { x: data.my_pin.x, y: data.my_pin.y };
      }
    }
  } catch { /* オフライン時はピンなしで続行 */ }
  if (_mRsCurrentVideoId !== videoId) return; // タブ切替等で別動画に変わっていれば無用
  if (_mRsHeatmapVisible) {
    const hm = document.getElementById('mRsHeatmapLayer');
    if (hm) { hm.style.visibility = 'visible'; hm.style.opacity = '1'; }
    mRsRenderHeatmap();
  }
  // サムネイルのロードを待ってからピンを開始（黒画面にピンが降るのを防ぐ）
  const imgEl = document.getElementById('mRsImg');
  if (imgEl && !imgEl.complete) {
    await new Promise(resolve => {
      const done = () => resolve();
      imgEl.addEventListener('load',  done, { once: true });
      imgEl.addEventListener('error', done, { once: true });
      setTimeout(resolve, 2000);
    });
  }
  if (_mRsCurrentVideoId !== videoId) return; // ロード待ち中に動画が切り替わっていたら無用
  _mRsCurrentTime  = 0;
  _mRsDuration     = 0;
  _mRsEmittedCount = 0;
  _mRsPlacedPins   = [];
  _mRsUpdateProgressUI();
  if (_mRsTransportVisible) {
    _mRsStartPlayback(true); // 新規ローチE ピンを落下アニメ付きで再表示
  } else if (_mRsPinsVisible) {
    mRsStartLoop();
  }
}

// ランキング行クリックからリアクション画面に遷移
function openVideoInReaction(v) {
  _mRsCurrentVideoId = v.id;
  _switchTab('reaction');
}

// リアクションタブ描画
function _mRsClearMyPin() {
  // spawnOne setTimeout チェーンを停止
  _mRsActive = false;
  // transport モードの RAF を停止
  if (_mRsRafId) { cancelAnimationFrame(_mRsRafId); _mRsRafId = null; }
  _mRsPlaying   = false;
  _mRsLastRafTs = null;
  // 自分ピンの落下 RAF / animationend を停止
  if (_mRsMyPinOnDrop) {
    const pin = document.getElementById('mRsMyPin');
    if (pin) pin.removeEventListener('animationend', _mRsMyPinOnDrop);
    _mRsMyPinOnDrop = null;
  }
  if (_mRsMyPinAnimRaf) { cancelAnimationFrame(_mRsMyPinAnimRaf); _mRsMyPinAnimRaf = 0; }
  const myPin = document.getElementById('mRsMyPin');
  const myPinShadow = document.getElementById('mRsMyPinShadow');
  if (myPin) { myPin.getAnimations().forEach(a => a.cancel()); myPin.hidden = true; }
  if (myPinShadow) myPinShadow.hidden = true;
  // コミュニティピンレイヤーをクリア
  const pinsLayer = document.getElementById('mRsPinsLayer');
  if (pinsLayer) pinsLayer.innerHTML = '';
}

function renderReaction() {
  if (!state.currentChannelKey) {
    const placeholder = document.getElementById('mRsPlaceholder');
    const toolbar     = document.getElementById('mRsToolbar');
    if (placeholder) { placeholder.hidden = false; placeholder.innerHTML = _mRsPlaceholderHtml(t('m-ch-select-prompt')); }
    if (toolbar) toolbar.hidden = true;
    const seekElNoC = document.getElementById('mRsSeek');
    if (seekElNoC) seekElNoC.hidden = true;
    _mRsClearMyPin();
    document.getElementById('mRsImg').src = '';
    mRsRenderPlaylist();
    return;
  }
  _mRsUpdateSortUI();
  const pool = _mRsBuildSortedPool();
  if (pool.length === 0) {
    const placeholder = document.getElementById('mRsPlaceholder');
    if (placeholder) { placeholder.hidden = false; placeholder.innerHTML = _mRsPlaceholderHtml(t('cat-empty')); }
    const toolbar = document.getElementById('mRsToolbar');
    if (toolbar) toolbar.hidden = true;
    const seekElNoV = document.getElementById('mRsSeek');
    if (seekElNoV) seekElNoV.hidden = true;
    const imgElNoV = document.getElementById('mRsImg');
    imgElNoV.src = '';
    _mRsClearMyPin();
    _mRsPins = [];
    _mRsKde  = null;
    const hmLayerNoV = document.getElementById('mRsHeatmapLayer');
    if (hmLayerNoV) { hmLayerNoV.style.cssText = 'opacity:0;visibility:hidden;'; hmLayerNoV.innerHTML = ''; }
    _mRsHeatmapVisible = false;
    const hmBtnNoV = document.getElementById('mRsHeatmapBtn');
    if (hmBtnNoV) hmBtnNoV.classList.remove('active');
    _mRsCurrentVideoId = null;
    _mRsLoadedVideoId  = null;
    const titleEl = document.getElementById('mRsVideoTitle');
    if (titleEl) { titleEl.textContent = ''; titleEl.removeAttribute('href'); }
    const metaEl = document.getElementById('mRsVideoMeta');
    if (metaEl) metaEl.innerHTML = '';
    mRsRenderPlaylist();
    return;
  }
  // カテゴリ復元: 前回このカテゴリで選んだ動画があればそれを優先
  const savedId  = _mRsCatVideoState[state.currentCat];
  const targetId = (_mRsCurrentVideoId && pool.find(v => v.id === _mRsCurrentVideoId))
    ? _mRsCurrentVideoId
    : (savedId && pool.find(v => v.id === savedId))
    ? savedId
    : pool[0].id;
  // targetId を先にセットしてからプレイリストを描画（着色のため）
  _mRsCurrentVideoId = targetId;
  mRsRenderPlaylist(pool);
  if (targetId !== _mRsLoadedVideoId) {
    mRsOpenMode(targetId);
  } else {
    // 既にロード済みの場合も placeholder を確実に隠す
    const placeholder = document.getElementById('mRsPlaceholder');
    if (placeholder) placeholder.hidden = true;
  }
}

// 動画メタめE.m-rs-video-meta に描画
function mRsRenderVideoMeta(v) {
  const el = document.getElementById('mRsVideoMeta');
  if (!el || !v) return;
  const parts = [];
  if (v.viewCount)  parts.push('<span class="m-meta-item">' + _M_SVG_EYE  + formatViewsShort(v.viewCount) + '</span>');
  if (v.publishedAt) parts.push('<span class="m-meta-item">' + _M_SVG_CLK + formatRelTime(v.publishedAt) + '</span>');
  el.innerHTML = parts.join('');
}

// --- トランスポート ---

function _mRsFmtTime(s) {
  var m = Math.floor(s / 60);
  var sec = Math.floor(s % 60);
  return m + ':' + (sec < 10 ? '0' : '') + sec;
}

function _mRsUpdateProgressUI() {
  var fill     = document.getElementById('mRsProgressFill');
  var thumb    = document.getElementById('mRsProgressThumb');
  var label    = document.getElementById('mRsTimeLabel');
  var seekTime = document.getElementById('mRsSeekTime');
  var pct = _mRsDuration > 0 ? _mRsCurrentTime / _mRsDuration * 100 : 0;
  if (fill)     fill.style.width = pct + '%';
  if (thumb)    thumb.style.left = pct + '%';
  var timeText = _mRsFmtTime(_mRsCurrentTime) + ' / ' + _mRsFmtTime(_mRsDuration);
  if (label)    label.textContent = timeText;
  if (seekTime) seekTime.textContent = timeText;
}

function _mRsUpdatePlayBtnUI() {
  var btn = document.getElementById('mRsPlayBtn');
  if (btn) btn.classList.toggle('playing', _mRsPlaying);
}

function _mRsShowOverlay() {
  var el = document.getElementById('mRsOverlay');
  if (!el || !_mRsTransportVisible) return;
  el.classList.add('visible');
  clearTimeout(_mRsOverlayTimer);
  _mRsOverlayTimer = setTimeout(_mRsHideOverlay, 1500);
}

function _mRsHideOverlay() {
  clearTimeout(_mRsOverlayTimer);
  _mRsOverlayTimer = null;
  var el = document.getElementById('mRsOverlay');
  if (el) el.classList.remove('visible');
}

function _mRsPlayPrev() {
  var pool = _mRsBuildSortedPool();
  if (!pool.length) return;
  var idx = pool.findIndex(function(v) { return v.id === _mRsCurrentVideoId; });
  var prev = pool[(idx - 1 + pool.length) % pool.length];
  if (prev) mRsOpenMode(prev.id);
}

function _mRsPlayNext() {
  var pool = _mRsBuildSortedPool();
  if (!pool.length) return;
  var idx = pool.findIndex(function(v) { return v.id === _mRsCurrentVideoId; });
  var next = pool[(idx + 1) % pool.length];
  if (next) mRsOpenMode(next.id);
}

function _mRsToggleFullscreen() {
  var wrap = document.getElementById('mRsImgWrap');
  if (!wrap) return;
  if (!document.fullscreenElement) {
    (wrap.requestFullscreen || wrap.webkitRequestFullscreen).call(wrap).catch(function() {});
  } else {
    (document.exitFullscreen || document.webkitExitFullscreen).call(document).catch(function() {});
  }
}

// max=1: 自分のピンがある動画ではコミュニティピンを載せない（自分のピンがなければ 1 件表示）
function _mRsCommLimit(max) {
  if (max === 0) return 0;
  return _mRsMyPins[_mRsCurrentVideoId] ? Math.max(0, max - 1) : max;
}

function _mRsEmitUpTo(time) {
  var pinsLayer = document.getElementById('mRsPinsLayer');
  if (!pinsLayer) return;
  var cLimit = _mRsCommLimit(_mRsMaxPins);
  while (_mRsEmittedCount < _mRsPlacedPins.length && _mRsEmittedCount < cLimit && _mRsPlacedPins[_mRsEmittedCount].emitAt <= time) {
    var p = _mRsPlacedPins[_mRsEmittedCount++];
    pinsLayer.appendChild(mRsMakePinEl(p.x, p.y, p.density, false, p));
  }
  if (!_mRsMyPinEmitted && _mRsMyPinEmitAt >= 0 && time >= _mRsMyPinEmitAt && _mRsMaxPins > 0) {
    var saved = _mRsMyPins[_mRsCurrentVideoId];
    if (saved && _mRsPinsVisible) {
      mRsShowMyPin(saved.x, saved.y, true);
      _mRsMyPinEmitted = true;
    }
  }
}

function _mRsTickFn(ts) {
  if (!_mRsPlaying) return;
  var dt = _mRsLastRafTs != null ? (ts - _mRsLastRafTs) / 1000 : 0;
  _mRsLastRafTs   = ts;
  _mRsCurrentTime = Math.min(_mRsDuration, _mRsCurrentTime + dt);
  _mRsUpdateProgressUI();
  _mRsEmitUpTo(_mRsCurrentTime);
  if (_mRsCurrentTime < _mRsDuration) {
    _mRsRafId = requestAnimationFrame(_mRsTickFn);
  } else {
    _mRsPlaying   = false;
    _mRsLastRafTs = null;
    _mRsRafId     = null;
    var btn = document.getElementById('mRsPlayBtn');
    if (btn) btn.classList.remove('playing');
  }
}

function _mRsSeekTo(time) {
  _mRsCurrentTime  = Math.max(0, Math.min(_mRsDuration, time));
  _mRsEmittedCount = 0;
  var pinsLayer = document.getElementById('mRsPinsLayer');
  if (pinsLayer) {
    pinsLayer.innerHTML = '';
    var cLimit = _mRsCommLimit(_mRsMaxPins);
    for (var i = 0; i < _mRsPlacedPins.length; i++) {
      if (i >= cLimit) break;
      if (_mRsCurrentTime > 0 && _mRsPlacedPins[i].emitAt <= _mRsCurrentTime) {
        pinsLayer.appendChild(mRsMakePinEl(_mRsPlacedPins[i].x, _mRsPlacedPins[i].y, _mRsPlacedPins[i].density, true, _mRsPlacedPins[i]));
        _mRsEmittedCount++;
      } else {
        break;
      }
    }
  }
  var myPin = document.getElementById('mRsMyPin');
  var myPinShadow = document.getElementById('mRsMyPinShadow');
  if (_mRsMyPinEmitAt >= 0 && _mRsCurrentTime > 0 && _mRsCurrentTime >= _mRsMyPinEmitAt && _mRsMaxPins > 0) {
    var saved = _mRsMyPins[_mRsCurrentVideoId];
    if (saved && _mRsPinsVisible && myPin && myPin.hidden) mRsShowMyPin(saved.x, saved.y, false);
    _mRsMyPinEmitted = true;
  } else {
    if (myPin) myPin.hidden = true;
    if (myPinShadow) myPinShadow.hidden = true;
    _mRsMyPinEmitted = false;
  }
  _mRsUpdateProgressUI();
}

function _mRsStartPlayback(dropPin) {
  _mRsActive = false;
  if (_mRsRafId) { cancelAnimationFrame(_mRsRafId); _mRsRafId = null; }
  if (_mRsSeekFadeTimer) { clearTimeout(_mRsSeekFadeTimer); _mRsSeekFadeTimer = null; }
  var seekEl = document.getElementById('mRsSeek');
  if (seekEl) { seekEl.classList.remove('faded'); seekEl.hidden = !_mRsTransportVisible; }
  _mRsPlaying = false;
  var pinsLayer   = document.getElementById('mRsPinsLayer');
  var myPin       = document.getElementById('mRsMyPin');
  var myPinShadow = document.getElementById('mRsMyPinShadow');
  if (pinsLayer)    pinsLayer.innerHTML = '';
  var hasSaved = !!(_mRsMyPins[_mRsCurrentVideoId] && _mRsPinsVisible);
  if (dropPin) {
    // 新規ローチE ピンを隠して tick の落下アニメで再表示させめE
    if (myPin)        myPin.hidden = true;
    if (myPinShadow)  myPinShadow.hidden = true;
    _mRsMyPinEmitted = false;
  } else {
    // 同一動画継続（transport toggle / リプレイ等） ピンを現状維持
    if (!hasSaved) {
      if (myPin)        myPin.hidden = true;
      if (myPinShadow)  myPinShadow.hidden = true;
    }
    _mRsMyPinEmitted = hasSaved;
  }
  _mRsPlacedPins   = mRsBuildPlacedPins(30);
  var saved = _mRsMyPins[_mRsCurrentVideoId];
  if (!_mRsPlacedPins.length) {
    if (saved && _mRsPinsVisible && _mRsMaxPins > 0) {
      _mRsMyPinEmitAt  = 0;
      _mRsDuration     = Math.min(2.5, Math.max(1.0, _mRsMyPinEmitAt + 0.5));
      _mRsCurrentTime  = 0;
      _mRsEmittedCount = 0;
      _mRsPlaying      = true;
      _mRsLastRafTs    = null;
      _mRsUpdatePlayBtnUI();
      _mRsUpdateProgressUI();
      _mRsRafId = requestAnimationFrame(_mRsTickFn);
    } else {
      _mRsMyPinEmitAt = -1;
    }
    return;
  }
  var streams = [0, 80, 160, 240, 320];
  if (saved) {
    _mRsMyPinEmitAt = streams[0] / 1000;
    streams[0] += 80 + Math.random() * 200;
  } else {
    _mRsMyPinEmitAt = -1;
  }
  for (var si = 0; si < _mRsPlacedPins.length; si++) {
    var minIdx = 0;
    for (var k = 1; k < streams.length; k++) {
      if (streams[k] < streams[minIdx]) minIdx = k;
    }
    _mRsPlacedPins[si].emitAt = streams[minIdx] / 1000;
    streams[minIdx] += 80 + Math.random() * 200;
  }
  _mRsPlacedPins.sort(function(a, b) { return a.emitAt - b.emitAt; });
  _mRsPlacedPins.forEach(function(p) {
    var baseScale = 0.6 + 0.8 * p.density;
    p._scale    = baseScale + (Math.random() - 0.5) * 0.4;
    p._floatDur = (2.4 + Math.random() * 0.8).toFixed(2);
  });
  var lastEmit = _mRsPlacedPins[_mRsPlacedPins.length - 1].emitAt;
  if (_mRsMyPinEmitAt >= 0) lastEmit = Math.max(lastEmit, _mRsMyPinEmitAt);
  _mRsDuration     = Math.min(2.5, Math.max(1.0, lastEmit + 0.5));
  _mRsEmittedCount = 0;
  _mRsCurrentTime  = 0;
  _mRsPlaying      = true;
  _mRsLastRafTs    = null;
  var btn = document.getElementById('mRsPlayBtn');
  if (btn) btn.classList.add('playing');
  _mRsUpdateProgressUI();
  _mRsRafId = requestAnimationFrame(_mRsTickFn);
}

// --- プレイリスト用ソーチE---

function _mRsBuildSortedPool() {
  const pool = filteredVideos().slice();
  const asc = _mRsSortDir === 'asc';
  if (_mRsSortOrder === 'date') {
    pool.sort((a, b) => asc
      ? ((a.publishedAt || '') < (b.publishedAt || '') ? -1 : 1)
      : ((b.publishedAt || '') > (a.publishedAt || '') ? 1 : -1)
    );
  } else if (_mRsSortOrder === 'views') {
    pool.sort((a, b) => asc
      ? (a.viewCount || 0) - (b.viewCount || 0)
      : (b.viewCount || 0) - (a.viewCount || 0)
    );
  } else if (_mRsSortOrder === 'rating') {
    pool.sort((a, b) => asc
      ? getRating(a.id) - getRating(b.id)
      : getRating(b.id) - getRating(a.id)
    );
  }
  return pool;
}

function _mRsUpdateSortUI() {
  document.querySelectorAll('.m-rs-sort-chip').forEach(el => {
    el.classList.toggle('active', el.dataset.sort === _mRsSortOrder);
  });
  const dirBtn = document.getElementById('mRsSortDir');
  if (dirBtn) dirBtn.classList.toggle('asc', _mRsSortDir === 'asc');
}

// プレイリストを描画
const _MRS_PAGE_SIZE = 30;
let _mRsPlaylistPage = 0;
let _mRsPlaylistPool = [];
let _mRsPlaylistObs  = null;

function _mRsPlaylistItem(v, listEl) {
  const item = document.createElement('div');
  item.className = 'm-rs-playlist-item' + (v.id === _mRsCurrentVideoId ? ' selected' : '');
  item.dataset.vid = v.id;
  const thumb = document.createElement('img');
  thumb.className       = 'm-rs-playlist-thumb';
  thumb.src             = v.thumb;
  thumb.alt             = '';
  thumb.loading         = 'lazy';
  thumb.referrerPolicy  = 'no-referrer';
  thumb.onerror = function() { this.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'; };
  const info = document.createElement('div');
  info.className = 'm-rs-playlist-info';
  const title = document.createElement('div');
  title.className   = 'm-rs-playlist-title';
  title.textContent = v.title;
  const meta = document.createElement('div');
  meta.className = 'm-rs-playlist-meta';
  meta.innerHTML = _mBuildMeta(v) + _mBuildPinDot(v, _mRsMyPins, _mRsPinColor);
  info.appendChild(title);
  info.appendChild(meta);
  item.appendChild(thumb);
  item.appendChild(info);
  item.addEventListener('click', () => {
    if (v.id === _mRsCurrentVideoId) return;
    listEl.querySelectorAll('.m-rs-playlist-item').forEach(el => el.classList.remove('selected'));
    item.classList.add('selected');
    if (!_suppressHistory) {
      history.pushState({ tab: 'reaction', channelKey: state.currentChannelKey, vid: v.id }, '');
    }
    mRsOpenMode(v.id);
  });
  return item;
}

function _mRsPlaylistAppendPage(listEl) {
  const start = _mRsPlaylistPage * _MRS_PAGE_SIZE;
  const slice = _mRsPlaylistPool.slice(start, start + _MRS_PAGE_SIZE);
  if (!slice.length) return;
  const frag = document.createDocumentFragment();
  slice.forEach(v => frag.appendChild(_mRsPlaylistItem(v, listEl)));
  // センチネルが既にあれば取り除いてから追加
  const old = listEl.querySelector('.m-rs-sentinel');
  if (old) old.remove();
  listEl.appendChild(frag);
  _mRsPlaylistPage++;
  // まだ続きがあればセンチネルを追加
  if (_mRsPlaylistPage * _MRS_PAGE_SIZE < _mRsPlaylistPool.length) {
    const sentinel = document.createElement('div');
    sentinel.className = 'm-rs-sentinel';
    listEl.appendChild(sentinel);
    if (_mRsPlaylistObs) _mRsPlaylistObs.observe(sentinel);
  } else {
    if (_mRsPlaylistObs) { _mRsPlaylistObs.disconnect(); }
  }
}

function mRsRenderPlaylist(prebuiltPool) {
  const listEl = document.getElementById('mRsPlaylist');
  if (!listEl) return;

  // Observer 破棄
  if (_mRsPlaylistObs) { _mRsPlaylistObs.disconnect(); _mRsPlaylistObs = null; }

  _mRsPlaylistPool = prebuiltPool || _mRsBuildSortedPool();
  _mRsPlaylistPage = 0;
  listEl.innerHTML = '';
  if (!_mRsPlaylistPool.length) return;

  // スクロールコンテナを取得（親の .m-rs-scroll-body）
  const scrollEl = listEl.closest('.m-rs-scroll-body') || listEl.parentElement;

  _mRsPlaylistObs = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.remove();
        _mRsPlaylistAppendPage(listEl);
      }
    });
  }, { root: scrollEl, rootMargin: '120px' });

  _mRsPlaylistAppendPage(listEl);

  // 選択中アイテムをスクロール位置に調整
  requestAnimationFrame(() => {
    const selected = listEl.querySelector('.m-rs-playlist-item.selected');
    if (selected) selected.scrollIntoView({ block: 'nearest' });
  });
}


export {
  loadMyPins,
  mRsApplyPalette,
  mRsShowMyPin,
  mRsOpenMode,
  openVideoInReaction,
  renderReaction,
  mRsRenderPlaylist,
};
export { _mRsMyPins, _mRsPinColor, _mRsMaxPins, _mRsPinOpacity, _mRsTransportVisible, _mRsCurrentVideoId, _mRsUpdateSortUI };

export function resetCurrentVideo() {
  _mRsCurrentVideoId = null;
  _mRsLoadedVideoId  = null;
  _mRsCatVideoState  = {};
}

// カテゴリ切り替え前に呼び出し: 現在の選択動画を cat にひも付けて保存
export function mRsSaveCatState(cat) {
  if (_mRsCurrentVideoId) _mRsCatVideoState[cat] = _mRsCurrentVideoId;
}

export function initReactionUI() {
    // イベントリスナー: リアクション画面タップ → 再生トグル またはピン差し
    document.getElementById('mRsImgWrap').addEventListener('click', e => {
      if (!_mRsCurrentVideoId) return;
      // 再生ON: タップは再生/一時停止トグル（ピン差しより優先）
      if (_mRsTransportVisible) {
        _mRsShowOverlay();
        if (!_mRsPlaying) {
          if (_mRsCurrentTime >= _mRsDuration) {
            _mRsStartPlayback();
          } else {
            _mRsPlaying   = true;
            _mRsLastRafTs = null;
            _mRsRafId = requestAnimationFrame(_mRsTickFn);
            _mRsUpdatePlayBtnUI();
          }
        } else {
          if (_mRsRafId) { cancelAnimationFrame(_mRsRafId); _mRsRafId = null; }
          _mRsPlaying   = false;
          _mRsLastRafTs = null;
          _mRsUpdatePlayBtnUI();
        }
        return;
      }
      // ピンモードはpointerdownハンドラで処理するためclickでは何もしない
    });

    // イベントリスナー: ピン差し（pointerdown/move/up でドラッグ追従）
    (function() {
      const imgWrap = document.getElementById('mRsImgWrap');
      function _pinCoords(e) {
        const r = imgWrap.getBoundingClientRect();
        return {
          x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
          y: Math.max(0, Math.min(1, (e.clientY - r.top)  / r.height)),
        };
      }
      function _finishPin(x, y) {
        const isNewPin = !_mRsMyPins[_mRsCurrentVideoId];
        _mRsMyPins[_mRsCurrentVideoId] = { x, y };
        mRsShowMyPin(x, y, false);
        fetch('/api/pins', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ video_id: _mRsCurrentVideoId, session_id: _mRsSessionId, x, y }),
        }).catch(() => {});
        if (isNewPin) mRsRenderPlaylist();
      }
      imgWrap.addEventListener('pointerdown', e => {
        if (!_mRsCurrentVideoId || _mRsTransportVisible) return;
        // 好きOFF時はタップで自動ON（PCと同じ挙動）
        if (!_mRsPinsVisible) {
          _mRsPinsVisible = true;
          document.getElementById('mRsPinsBtn').classList.add('active');
          const pinsLayer = document.getElementById('mRsPinsLayer');
          if (pinsLayer) pinsLayer.style.visibility = '';
        }
        const { x, y } = _pinCoords(e);
        _mRsPinDragging   = true;
        _mRsPinDragId     = e.pointerId;
        _mRsPinDropped    = false;
        _mRsPinDropTarget = { x, y };
        imgWrap.setPointerCapture(e.pointerId);
        // 既存ピンがある場合: 落下アニメーションをスキップして即ドラッグ開始
        // （落下アニメーションがノイズの原因になるため）
        if (_mRsMyPins[_mRsCurrentVideoId]) {
          _mRsPinDropped = true;
          _mRsMovePinDrag(x, y);
        } else {
          mRsShowMyPin(x, y, true, () => { _mRsPinDropped = true; });
        }
        e.preventDefault();
      }, { passive: false });
      imgWrap.addEventListener('pointermove', e => {
        if (!_mRsPinDragging || e.pointerId !== _mRsPinDragId) return;
        if (!_mRsPinDropped) return;
        const { x, y } = _pinCoords(e);
        _mRsMovePinDrag(x, y);
        e.preventDefault();
      }, { passive: false });
      imgWrap.addEventListener('pointerup', e => {
        if (!_mRsPinDragging || e.pointerId !== _mRsPinDragId) return;
        _mRsPinDragging = false;
        _mRsPinDragId   = null;
        let fx, fy;
        if (_mRsPinDropped) {
          // 着地後の追従中 → 現在指がいる位置で確定
          const coords = _pinCoords(e);
          fx = coords.x; fy = coords.y;
        } else {
          // 落下アニメーション中に離した → 初期タップ位置で確定
          fx = _mRsPinDropTarget.x; fy = _mRsPinDropTarget.y;
        }
        _mRsPinDropped    = false;
        _mRsPinDropTarget = null;
        _finishPin(fx, fy);
        e.preventDefault();
      }, { passive: false });
      imgWrap.addEventListener('pointercancel', e => {
        if (e.pointerId !== _mRsPinDragId) return;
        _mRsPinDragging   = false;
        _mRsPinDragId     = null;
        _mRsPinDropped    = false;
        _mRsPinDropTarget = null;
      });
    })();

    // イベントリスナー: ピン表示切り替え（表示のみ。ループ・再生の再初期化なし）
    document.getElementById('mRsPinsBtn').addEventListener('click', () => {
      _mRsPinsVisible = !_mRsPinsVisible;
      document.getElementById('mRsPinsBtn').classList.toggle('active', _mRsPinsVisible);
      const pinsLayer   = document.getElementById('mRsPinsLayer');
      if (pinsLayer) pinsLayer.style.visibility = _mRsPinsVisible ? '' : 'hidden';
      const myPin       = document.getElementById('mRsMyPin');
      const myPinShadow = document.getElementById('mRsMyPinShadow');
      if (!_mRsPinsVisible) {
        if (myPin)       myPin.hidden = true;
        if (myPinShadow) myPinShadow.hidden = true;
      } else if (_mRsCurrentVideoId) {
        // 自分のピンをその場に再表示（落下アニメーションなし）
        const saved = _mRsMyPins[_mRsCurrentVideoId];
        if (saved) mRsShowMyPin(saved.x, saved.y, false);
      }
    });

    // イベントリスナー: ヒートマップ切り替え
    document.getElementById('mRsHeatmapBtn').addEventListener('click', () => {
      _mRsHeatmapVisible = !_mRsHeatmapVisible;
      document.getElementById('mRsHeatmapBtn').classList.toggle('active', _mRsHeatmapVisible);
      const hmLayer = document.getElementById('mRsHeatmapLayer');
      if (!hmLayer) return;
      if (_mRsHeatmapVisible) {
        hmLayer.style.visibility = 'visible';
        hmLayer.style.opacity    = '1';
        mRsRenderHeatmap();
      } else {
        hmLayer.style.opacity    = '0';
        hmLayer.style.visibility = 'hidden';
      }
    });

    // イベントリスナー: トランスポート表示切り替え
    document.getElementById('mRsTransportBtn').addEventListener('click', () => {
      _mRsTransportVisible = !_mRsTransportVisible;
      document.getElementById('mRsTransportBtn').classList.toggle('active', _mRsTransportVisible);
      const seek = document.getElementById('mRsSeek');
      if (seek) {
        seek.hidden = !_mRsTransportVisible;
        seek.classList.remove('faded');
      }
      if (_mRsSeekFadeTimer) { clearTimeout(_mRsSeekFadeTimer); _mRsSeekFadeTimer = null; }
      if (_mRsTransportVisible) {
        _mRsShowOverlay();
      } else {
        _mRsHideOverlay();
      }
    });

    // イベントリスナー: カラースウォッチ
    document.querySelectorAll('.m-rs-swatch').forEach(btn => {
      const color = btn.dataset.color;
      if (color === _mRsPinColor) {
        document.querySelectorAll('.m-rs-swatch').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      }
      btn.addEventListener('click', e => {
        e.stopPropagation();
        document.querySelectorAll('.m-rs-swatch').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _mRsPinColor = color;
        localStorage.setItem('react-pin-color', color);
        mRsApplyPalette();
        if (_mRsHeatmapVisible) mRsRenderHeatmap();
        document.querySelectorAll('.m-meta-pin-dot').forEach(el => { el.style.background = color; });
        // コミュニティピンの色だけ再描画。自分のピンはCSS変数で自動更新されるため再表示不要
        if (_mRsPinsVisible && _mRsCurrentVideoId) {
          _mRsRefreshPinColors();
        }
      });
    });

    // イベントリスナー: 最大ピン数セグメント
    (function() {
      const seg = document.getElementById('mRsPinCountSegment');
      if (!seg) return;
      const vals = [1, 5, 10, 20, 30];
      const nearest = vals.reduce((a, b) => Math.abs(b - _mRsMaxPins) < Math.abs(a - _mRsMaxPins) ? b : a);
      _mRsMaxPins = nearest;
      seg.querySelectorAll('.m-rs-seg-btn').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.value, 10) === nearest);
      });
      seg.addEventListener('click', e => {
        e.stopPropagation();
        const btn = e.target.closest('.m-rs-seg-btn');
        if (!btn) return;
        const newVal = parseInt(btn.dataset.value, 10);
        if (newVal === _mRsMaxPins) return;
        seg.querySelectorAll('.m-rs-seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        _mRsMaxPins = newVal;
        localStorage.setItem(LS_RS_MAX_PINS, _mRsMaxPins);
        if (_mRsPinsVisible && _mRsCurrentVideoId) {
          _mRsRefreshPinCount();
        }
      });
    })();

    // イベントリスナー: 設定パネル開閉
    document.getElementById('mRsSettingsPanelBtn').addEventListener('click', e => {
      e.stopPropagation();
      var panel = document.getElementById('mRsSettingsPanel');
      var open = panel.classList.toggle('open');
      document.getElementById('mRsSettingsPanelBtn').classList.toggle('open', open);
    });

    // イベントリスナー: ピン透過度スライダー
    (function() {
      const slider = document.getElementById('mRsPinOpacitySlider');
      if (!slider) return;
      slider.value = Math.round(_mRsPinOpacity * 100);
      slider.addEventListener('input', e => {
        _mRsPinOpacity = parseInt(e.target.value, 10) / 100;
        localStorage.setItem(LS_RS_PIN_OPACITY, _mRsPinOpacity);
        const layer = document.getElementById('mRsPinsLayer');
        if (layer) layer.style.opacity = String(_mRsPinOpacity);
        const myPin = document.getElementById('mRsMyPin');
        if (myPin && !myPin.hidden) myPin.style.opacity = String(_mRsPinOpacity);
        slider.style.setProperty('--fill', e.target.value + '%');
      });
      slider.style.setProperty('--fill', Math.round(_mRsPinOpacity * 100) + '%');
    })();

    // イベントリスナー: プログレスバー（タッチ・マウス共通）
    // seekDiv 全体（パディング含む）をヒット領域にし、端でノブが隠れないようにする
    (function() {
      const seekDiv = document.getElementById('mRsSeek');
      const track   = document.getElementById('mRsProgressTrack');
      if (!seekDiv || !track) return;
      let _dragging = false;
      let _lastSeekX = 0;
      function _calcPct(clientX) {
        const r = track.getBoundingClientRect();
        return Math.max(0, Math.min(1, (clientX - r.left) / r.width));
      }
      function _seekFull(clientX) {
        if (_mRsDuration <= 0) return;
        _mRsSeekTo(_calcPct(clientX) * _mRsDuration);
      }
      function _seekVisual(clientX) {
        // ドラッグ中はプログレスUIのみ更新（ピン再描画なし）
        if (_mRsDuration <= 0) return;
        _mRsCurrentTime = _calcPct(clientX) * _mRsDuration;
        _mRsUpdateProgressUI();
      }
      // passive:false で touchstart を止める → Chrome モバイルの左端スワイプバック防止
      seekDiv.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
      seekDiv.addEventListener('pointerdown', e => {
        if (e.target.closest('button')) return;  // ボタンタップはシーク開始しない
        // ヒット判定をプログレストラック周辺（上下14px）に限定
        var tr = track.getBoundingClientRect();
        if (e.clientY < tr.top - 14 || e.clientY > tr.bottom + 14) return;
        // フェードタイマーをキャンセルし表示を維持
        if (_mRsSeekFadeTimer) { clearTimeout(_mRsSeekFadeTimer); _mRsSeekFadeTimer = null; }
        var seekEl = document.getElementById('mRsSeek');
        if (seekEl) seekEl.classList.remove('faded');
        // 再生中なら一時停止
        if (_mRsPlaying) {
          _mRsPlaying = false;
          if (_mRsRafId) { cancelAnimationFrame(_mRsRafId); _mRsRafId = null; }
          _mRsUpdatePlayBtnUI();
        }
        _dragging = true;
        _lastSeekX = e.clientX;
        track.classList.add('dragging');
        var _pl = document.getElementById('mRsPinsLayer');
        if (_pl) _pl.classList.add('rs-seeking');
        seekDiv.setPointerCapture(e.pointerId);
        _seekFull(e.clientX);  // タップ時は即時フル更新
        _mRsShowOverlay();
        e.preventDefault();
        e.stopPropagation();
      });
      seekDiv.addEventListener('pointermove', e => {
        if (_dragging) { _lastSeekX = e.clientX; _seekFull(e.clientX); }
      });
      seekDiv.addEventListener('pointerup', () => {
        if (_dragging) {
          _dragging = false;
          track.classList.remove('dragging');
          var pl = document.getElementById('mRsPinsLayer');
          if (pl) pl.classList.remove('rs-seeking');
          _seekFull(_lastSeekX);
          _mRsShowOverlay();
        }
      });
      seekDiv.addEventListener('pointercancel', () => {
        _dragging = false;
        track.classList.remove('dragging');
        var pl = document.getElementById('mRsPinsLayer');
        if (pl) pl.classList.remove('rs-seeking');
      });
    })();

    // イベントリスナー: トランスポートオーバーレイボタン
    document.getElementById('mRsPrevBtn').addEventListener('click', e => {
      e.stopPropagation();
      _mRsPlayPrev();
      _mRsShowOverlay();
    });
    document.getElementById('mRsPlayBtn').addEventListener('click', e => {
      e.stopPropagation();
      if (!_mRsCurrentVideoId) return;
      // フェードタイマーをキャンセルし表示を復元
      if (_mRsSeekFadeTimer) { clearTimeout(_mRsSeekFadeTimer); _mRsSeekFadeTimer = null; }
      var seekEl2 = document.getElementById('mRsSeek');
      if (seekEl2) seekEl2.classList.remove('faded');
      if (!_mRsPlaying) {
        if (_mRsCurrentTime >= _mRsDuration) {
          _mRsStartPlayback();
        } else {
          _mRsPlaying   = true;
          _mRsLastRafTs = null;
          _mRsRafId = requestAnimationFrame(_mRsTickFn);
          _mRsUpdatePlayBtnUI();
        }
      } else {
        if (_mRsRafId) { cancelAnimationFrame(_mRsRafId); _mRsRafId = null; }
        _mRsPlaying   = false;
        _mRsLastRafTs = null;
        _mRsUpdatePlayBtnUI();
      }
      // 再生開始時はピンが見えるようオーバーレイを即時非表示、一時停止時は長めに表示
      if (_mRsPlaying) {
        _mRsHideOverlay();
      } else {
        _mRsShowOverlay();
      }
    });
    document.getElementById('mRsNextBtn').addEventListener('click', e => {
      e.stopPropagation();
      _mRsPlayNext();
      _mRsShowOverlay();
    });
    // フルスクリーン変更時のボタンアイコン更新（webkit prefix 対応）
    ['fullscreenchange', 'webkitfullscreenchange'].forEach(evName => {
      document.addEventListener(evName, function() {
        var btn = document.getElementById('mRsFullscreenBtn');
        if (!btn) return;
        btn.innerHTML = (document.fullscreenElement || document.webkitFullscreenElement)
          ? _M_SVG_FULLSCREEN_EXIT
          : _M_SVG_FULLSCREEN;
      });
    });

    // イベントリスナー: ソートセクション（設定パネル内）
    (function() {
      const section = document.getElementById('mRsSortSection');
      if (!section) return;
      section.addEventListener('click', e => {
        const chip = e.target.closest('.m-rs-sort-chip');
        if (!chip) return;
        _mRsSortOrder = chip.dataset.sort;
        localStorage.setItem(LS_RS_SORT, _mRsSortOrder);
        _mRsUpdateSortUI();
        mRsRenderPlaylist();
      });
      const dirBtn = document.getElementById('mRsSortDir');
      if (dirBtn) {
        dirBtn.addEventListener('click', () => {
          _mRsSortDir = _mRsSortDir === 'desc' ? 'asc' : 'desc';
          localStorage.setItem(LS_RS_SORT_DIR, _mRsSortDir);
          _mRsUpdateSortUI();
          mRsRenderPlaylist();
        });
      }
    })();
}
