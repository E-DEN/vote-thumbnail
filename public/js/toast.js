// public/js/toast.js
// Gooey トースト通知（desktop / mobile 共用モジュール）
// export: showToast(msg, type?), showToastPromise(promise, opts), closeToast()
//
// type: 'ok' | 'info' | 'warn' | 'err' | 'loading' | true (= 'err') | false (= 'ok')
// showToast 第3引数 opts: { action: { label, onClick } }  アクションボタン
// showToastPromise opts: { loading, success, error }  各値は文字列 or (result) => string

// ============================================================
//  Spring Physics
// ============================================================
class _GooSpring {
  constructor(v, k = 180, d = 15) { this.cur = v; this.target = v; this.vel = 0; this.k = k; this.d = d; }
  set(t) { this.target = t; }
  tick(dt) {
    const steps = Math.ceil(dt / 0.004), sub = dt / steps;
    for (let i = 0; i < steps; i++) {
      const acc = -this.k * (this.cur - this.target) - this.d * this.vel;
      this.vel += acc * sub; this.cur += this.vel * sub;
    }
    const ok = Math.abs(this.vel) < 0.01 && Math.abs(this.cur - this.target) < 0.01;
    if (ok) { this.cur = this.target; this.vel = 0; }
    return ok;
  }
}

// ============================================================
//  Constants
// ============================================================
const _GT_H   = 40;   // pill 通常高さ
const _GT_EXH = 67;   // 展開時のピル高さ (HEIGHT + BLUR*3)
const _GT_BH  = 52;   // 展開時の body 高さ

const _GT_IA = 'xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"';
const _GT_ICONS = {
  ok:      `<svg ${_GT_IA}><path d="M20 6 9 17l-5-5"/></svg>`,
  err:     `<svg ${_GT_IA}><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>`,
  info:    `<svg ${_GT_IA}><circle cx="12" cy="12" r="9"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  warn:    `<svg ${_GT_IA}><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
  loading: `<svg ${_GT_IA}><circle cx="12" cy="12" r="9" stroke-dasharray="20 40"><animateTransform attributeName="transform" type="rotate" dur="1s" from="0 12 12" to="360 12 12" repeatCount="indefinite"/></circle></svg>`,
};

function _gtTypeInfo(type) {
  switch (type) {
    case 'err':     return { color: '#f85149', title: 'エラー' };
    case 'warn':    return { color: '#f59e0b', title: '注意' };
    case 'info':    return { color: '#3b82f6', title: '情報' };
    case 'loading': return { color: '#8e8e93', title: '処理中' };
    default:        return { color: '#3fb950', title: '完了' };
  }
}

// ============================================================
//  Module-level state
// ============================================================
let _gtW = 350, _gtE = null, _gtSp = null, _gtRaf = null, _gtLt = null;
let _gtCb = null, _gtMh = null, _gtActionCb = null;
let _gtCollapsing = false, _gtCollapseTimer = null, _gtCloseFailsafe = null, _gtXfadeTimer = null;
let _gtType = null, _gtTimers = [], _gtHovered = false, _gtDragY = null;

// ============================================================
//  Internal helpers
// ============================================================
function _gtMeasure(t) {
  if (!_gtMh) {
    _gtMh = document.createElement('div');
    Object.assign(_gtMh.style, {
      position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
      top: '-9999px', left: '-9999px', whiteSpace: 'nowrap',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    });
    document.body.appendChild(_gtMh);
  }
  _gtMh.innerHTML = `<span style="display:inline-flex;align-items:center;gap:8px;padding:0 12px;"><span style="width:24px;height:24px;flex-shrink:0"></span><span style="font-size:13px;font-weight:500">${t}</span></span>`;
  return Math.max(_gtMh.firstElementChild.scrollWidth + 10, _GT_H);
}

function _gtRgba(h, a) {
  return `rgba(${parseInt(h.slice(1,3),16)},${parseInt(h.slice(3,5),16)},${parseInt(h.slice(5,7),16)},${a})`;
}

function _gtInit() {
  if (_gtE) return;
  _gtW = Math.min(350, (window.innerWidth || 375) - 24);
  if (!document.getElementById('gt-filter')) {
    const sv = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    sv.id = 'gt-filter'; sv.setAttribute('aria-hidden', 'true');
    sv.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
    sv.innerHTML = `<defs><filter id="gt-goo" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB"><feGaussianBlur in="SourceGraphic" stdDeviation="9" result="blur"/><feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 20 -10" result="goo"/><feComposite in="SourceGraphic" in2="goo" operator="atop"/></filter></defs>`;
    document.body.appendChild(sv);
  }
  const ct = document.getElementById('app-toast-container');
  if (!ct) return;
  const W = _gtW;
  ct.style.width = W + 'px'; ct.innerHTML = '';
  const wrap = document.createElement('div'); wrap.className = 'gt-wrap';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'gt-svg'); svg.setAttribute('width', W);
  svg.setAttribute('height', _GT_BH + _GT_H); svg.setAttribute('viewBox', `0 0 ${W} ${_GT_BH + _GT_H}`);
  svg.setAttribute('filter', 'url(#gt-goo)');
  const bodyR = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bodyR.setAttribute('rx', '18'); bodyR.setAttribute('ry', '18'); bodyR.setAttribute('class', 'gt-pill-bg');
  bodyR.setAttribute('x', '0'); bodyR.setAttribute('y', '0'); bodyR.setAttribute('width', W);
  bodyR.setAttribute('height', '0'); bodyR.setAttribute('opacity', '0');
  const pillR = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  pillR.setAttribute('rx', '18'); pillR.setAttribute('ry', '18'); pillR.setAttribute('class', 'gt-pill-bg');
  pillR.setAttribute('x', Math.round((W - 120) / 2)); pillR.setAttribute('y', _GT_BH);
  pillR.setAttribute('width', '120'); pillR.setAttribute('height', _GT_H);
  svg.appendChild(bodyR); svg.appendChild(pillR);
  const ov = document.createElement('div'); ov.className = 'gt-overlay'; ov.style.width = W + 'px';
  const hd = document.createElement('div'); hd.className = 'gt-header';
  const badge = document.createElement('div'); badge.className = 'gt-badge';
  const ttl = document.createElement('span'); ttl.className = 'gt-title';
  hd.append(badge, ttl);
  const body = document.createElement('div'); body.className = 'gt-body'; body.style.width = W + 'px';
  const msgEl = document.createElement('span'); msgEl.className = 'gt-msg';
  const actBtn = document.createElement('button'); actBtn.className = 'gt-action'; actBtn.style.display = 'none';
  actBtn.addEventListener('click', () => {
    if (!_gtActionCb) return;
    const cb = _gtActionCb; _gtActionCb = null;
    closeToast(); cb();
  });
  const cls = document.createElement('button'); cls.className = 'gt-close';
  cls.innerHTML = '&#x2715;'; cls.addEventListener('click', closeToast);
  body.append(msgEl, actBtn, cls); ov.append(hd, body); wrap.append(svg, ov); ct.appendChild(wrap);
  _gtE = { wrap, pillR, bodyR, hd, badge, ttl, body, msgEl, action: actBtn, cls };

  // ホバー: ok/info タイプのタイマー一時停止 + body 展開/収縮
  wrap.addEventListener('mouseenter', () => {
    if (_gtCollapsing || !_gtSp || (_gtType !== 'ok' && _gtType !== 'info')) return;
    _gtHovered = true;
    _gtPauseTimers();
    _gtAnim(_GT_EXH, _GT_BH, 1);
  });
  wrap.addEventListener('mouseleave', () => {
    if (_gtCollapsing || !_gtSp || (_gtType !== 'ok' && _gtType !== 'info')) return;
    _gtHovered = false;
    _gtAnim(_GT_H, 0, 0);
    _gtResumeTimers();
  });

  // スワイプで dismiss（DEMO 準拠: translate のみ、ドラッグ中はタイマー停止）
  wrap.addEventListener('pointerdown', e => {
    if (e.target.closest('.gt-close') || _gtCollapsing) return;
    _gtDragY = e.clientY;
    wrap.setPointerCapture(e.pointerId);
    wrap.style.transition = '';
    // ドラッグ中にオートパイロットが発火しないようタイマーを停止
    if (_gtSp && (_gtType === 'ok' || _gtType === 'info') && !_gtHovered) {
      _gtPauseTimers();
    }
  });
  wrap.addEventListener('pointermove', e => {
    if (_gtDragY === null) return;
    const dy = e.clientY - _gtDragY;
    const sign = dy > 0 ? 1 : -1;
    const clamped = Math.min(Math.abs(dy), 20) * sign;
    wrap.style.transform = 'translateY(' + clamped + 'px)';
  });
  wrap.addEventListener('pointerup', e => {
    if (_gtDragY === null) return;
    const dy = e.clientY - _gtDragY;
    _gtDragY = null;
    if (Math.abs(dy) > 30 && _gtType !== 'loading') {
      _gtSwipeDismiss(dy);
    } else {
      wrap.style.transition = 'transform 250ms ease';
      wrap.style.transform  = '';
      setTimeout(() => { wrap.style.transition = ''; }, 260);
      // ホバー中でなければタイマーを再開
      if (_gtSp && (_gtType === 'ok' || _gtType === 'info') && !_gtHovered) {
        _gtResumeTimers();
      }
    }
  });
  wrap.addEventListener('pointercancel', () => {
    if (_gtDragY === null) return;
    _gtDragY = null;
    wrap.style.transform = '';
    if (_gtSp && (_gtType === 'ok' || _gtType === 'info') && !_gtHovered) {
      _gtResumeTimers();
    }
  });
}

function _gtAnim(ph, bh, bo, done) {
  if (!_gtSp) {
    _gtSp = {
      p: new _GooSpring(parseFloat(_gtE.pillR.getAttribute('height')), 180, 15),
      b: new _GooSpring(parseFloat(_gtE.bodyR.getAttribute('height')), 180, 15),
      o: new _GooSpring(parseFloat(_gtE.bodyR.getAttribute('opacity')), 150, 20),
    };
  }
  _gtSp.p.set(ph); _gtSp.b.set(bh); _gtSp.o.set(bo);
  _gtCb = done || null;
  if (!_gtRaf) { _gtLt = null; _gtRaf = requestAnimationFrame(_gtLoop); }
}

function _gtLoop(now) {
  if (!_gtLt) _gtLt = now;
  const dt = Math.min((now - _gtLt) / 1000, 0.064); _gtLt = now;
  const d1 = _gtSp.p.tick(dt), d2 = _gtSp.b.tick(dt), d3 = _gtSp.o.tick(dt);
  _gtApply();
  if (d1 && d2 && d3) { _gtRaf = null; const cb = _gtCb; _gtCb = null; if (cb) cb(); }
  else _gtRaf = requestAnimationFrame(_gtLoop);
}

function _gtApply() {
  const { p, b, o } = _gtSp, e = _gtE;
  const pY = _GT_BH - (p.cur - _GT_H);
  e.pillR.setAttribute('y', pY.toFixed(2));
  e.pillR.setAttribute('height', p.cur.toFixed(2));
  const bH = Math.max(0, b.cur), bOp = Math.max(0, Math.min(1, o.cur));
  e.bodyR.setAttribute('height', bH.toFixed(2)); e.bodyR.setAttribute('opacity', bOp.toFixed(3));
  // body テキストのフェードイン（収縮中は closeToast が制御するため触れない）
  if (!_gtCollapsing) {
    const r = Math.max(0, Math.min(1, (bH / _GT_BH - 0.65) / 0.35));
    e.body.style.opacity = r.toFixed(3); e.body.style.pointerEvents = r > 0.05 ? 'auto' : 'none';
  }
}

// ============================================================
//  Autopilot timer helpers
// ============================================================
function _gtAddTimer(fn, delay) {
  const t = { fn, delay, start: Date.now(), tid: null, fired: false };
  t.tid = setTimeout(() => { t.fired = true; fn(); }, delay);
  _gtTimers.push(t);
}

function _gtPauseTimers() {
  const now = Date.now();
  for (const t of _gtTimers) {
    if (!t.fired) {
      clearTimeout(t.tid);
      t.remaining = Math.max(0, t.delay - (now - t.start));
    }
  }
}

function _gtResumeTimers() {
  for (const t of _gtTimers) {
    if (!t.fired && t.remaining > 0) {
      t.start = Date.now();
      t.delay = t.remaining;
      t.tid = setTimeout(() => { t.fired = true; t.fn(); }, t.remaining);
    }
  }
}

function _gtClearTimers() {
  for (const t of _gtTimers) clearTimeout(t.tid);
  _gtTimers = [];
}

function _gtDoHide() {
  clearTimeout(_gtCloseFailsafe); _gtCloseFailsafe = null;
  _gtClearTimers(); _gtHovered = false; _gtDragY = null;
  if (_gtRaf) { cancelAnimationFrame(_gtRaf); _gtRaf = null; }
  _gtCb = null; _gtActionCb = null; _gtCollapsing = false;
  if (_gtE) { _gtE.action.style.display = 'none'; _gtE.action.textContent = ''; }
  _gtE.wrap.style.transition    = '';
  _gtE.body.style.transition    = '';
  _gtE.wrap.style.opacity       = '0';
  _gtE.wrap.style.transform     = 'translateY(6px) scale(0.95)';
  _gtE.wrap.style.pointerEvents = 'none';
  _gtSp = null; _gtType = null;
}

// スワイプ dismiss: wrap ごと即時フェード（message も status も一緒に消える）
function _gtSwipeDismiss(dy) {
  _gtClearTimers();
  clearTimeout(_gtCloseFailsafe); clearTimeout(_gtCollapseTimer); clearTimeout(_gtXfadeTimer);
  _gtXfadeTimer = null; _gtHovered = false; _gtCollapsing = true;
  if (!_gtE) return;
  if (_gtRaf) { cancelAnimationFrame(_gtRaf); _gtRaf = null; }
  _gtCb = null;
  const slideY = (dy > 0 ? 1 : -1) * 20;
  _gtE.wrap.style.transition    = 'opacity 180ms ease, transform 180ms ease';
  _gtE.wrap.style.opacity       = '0';
  _gtE.wrap.style.transform     = `translateY(${slideY}px) scale(0.95)`;
  _gtE.wrap.style.pointerEvents = 'none';
  setTimeout(_gtDoHide, 230);
}

// ============================================================
//  Public API
// ============================================================

// × ボタンおよび外部からトーストを閉じる
export function closeToast() {
  _gtSwipeDismiss(-1); // 上方向スライド + 即時フェード
}

// トースト表示
// type: 'ok'(緑,自動) | 'info'(青,自動) | 'warn'(黄,手動) | 'err'(赤,手動) | 'loading'(グレー,手動)
// 後方互換: true → 'err' / false → 'ok'
// opts.action: { label: string, onClick: fn }  アクションボタン
export function showToast(msg, type = 'ok', opts = {}) {
  if (type === true)                    type = 'err';
  if (type === false || type == null)   type = 'ok';

  _gtClearTimers(); clearTimeout(_gtCloseFailsafe); clearTimeout(_gtCollapseTimer); clearTimeout(_gtXfadeTimer); _gtXfadeTimer = null; _gtHovered = false;
  _gtCollapseTimer = null; _gtCb = null; _gtCollapsing = false;

  _gtInit();
  if (!_gtE) return;

  const { color, title } = _gtTypeInfo(type);

  const _prevType = _gtType;
  _gtType = type;
  const _xfade = _gtSp && _prevType && _prevType !== type;

  if (_xfade) {
    // 型が変わるとき: バッジ・タイトル・メッセージをフェード+ブラーでクロスフェード
    [_gtE.badge, _gtE.ttl, _gtE.msgEl].forEach(el => {
      el.style.transition = 'opacity 120ms ease, filter 120ms ease';
      el.style.opacity    = '0';
      el.style.filter     = 'blur(4px)';
    });
    _gtXfadeTimer = setTimeout(() => {
      _gtXfadeTimer = null;
      _gtE.badge.style.color      = color;
      _gtE.badge.style.background = _gtRgba(color, 0.18);
      _gtE.badge.innerHTML        = _GT_ICONS[type] || _GT_ICONS.ok;
      _gtE.ttl.textContent        = title;
      _gtE.ttl.style.color        = color;
      _gtE.msgEl.textContent      = msg;
      _gtE.cls.style.display      = type === 'loading' ? 'none' : '';
      _gtActionCb = opts.action?.onClick || null;
      _gtE.action.textContent = opts.action?.label || '';
      _gtE.action.style.display = opts.action ? '' : 'none';
      [_gtE.badge, _gtE.ttl, _gtE.msgEl].forEach(el => {
        el.style.transition = 'opacity 200ms ease, filter 200ms ease';
        el.style.opacity    = '';
        el.style.filter     = '';
      });
    }, 130);
  } else {
    _gtE.badge.style.color      = color;
    _gtE.badge.style.background = _gtRgba(color, 0.18);
    _gtE.badge.innerHTML        = _GT_ICONS[type] || _GT_ICONS.ok;
    _gtE.ttl.textContent        = title;
    _gtE.ttl.style.color        = color;
    _gtE.msgEl.textContent      = msg;
    _gtE.cls.style.display      = type === 'loading' ? 'none' : '';
    _gtActionCb = opts.action?.onClick || null;
    _gtE.action.textContent = opts.action?.label || '';
    _gtE.action.style.display = opts.action ? '' : 'none';
  }

  // closeToast 途中に上書きされた transition をリセット
  _gtE.body.style.transition = '';

  const pillW = _gtMeasure(title), pillX = Math.round((_gtW - pillW) / 2);
  _gtE.pillR.setAttribute('x', pillX); _gtE.pillR.setAttribute('width', pillW);
  _gtE.hd.style.left = pillX + 'px'; _gtE.hd.style.width = pillW + 'px';

  if (!_gtSp) {
    _gtE.pillR.setAttribute('y', _GT_BH);
    _gtE.pillR.setAttribute('height', _GT_H);
    _gtE.bodyR.setAttribute('height', '0'); _gtE.bodyR.setAttribute('opacity', '0');
    _gtE.body.style.opacity = '0'; _gtE.body.style.pointerEvents = 'none';
  }

  _gtE.wrap.style.opacity   = '';
  _gtE.wrap.style.transform = '';
  _gtE.wrap.classList.add('gt-visible');
  _gtE.wrap.style.pointerEvents = 'auto';

  if (type === 'ok' || type === 'info') {
    // autopilot: ok=6000ms, info=4000ms
    const dur = type === 'info' ? 4000 : 6000;
    const expandDelay = Math.max(Math.round(dur * 0.025), 100); // 150ms
    const collapseAt  = Math.max(dur - 2000, Math.round(dur * 0.5)); // 4000ms
    setTimeout(() => _gtAnim(_GT_EXH, _GT_BH, 1), expandDelay);
    _gtAddTimer(() => _gtAnim(_GT_H, 0, 0), collapseAt);
    _gtAddTimer(closeToast, dur);
  } else {
    setTimeout(() => _gtAnim(_GT_EXH, _GT_BH, 1), 200);
  }
}

// Promise をラップして loading → ok / err へ自動遷移
// opts.loading / success / error: 文字列 または (result/err) => string
export async function showToastPromise(promise, opts) {
  const { loading, success, error } = opts;
  showToast(typeof loading === 'function' ? loading() : loading, 'loading');
  try {
    const result = await promise;
    showToast(typeof success === 'function' ? success(result) : success, 'ok');
    return result;
  } catch (err) {
    showToast(typeof error === 'function' ? error(err) : error, 'err');
    throw err;
  }
}
