// --- Depth Gallery ---
// app.js の state・channels・filteredVideos を参照して動作する
// renderList() から _listMode === 'depth' のとき initDepthGallery() が呼ばれる

/* global state, channels, filteredVideos */

(function() {

  // --- 定数 ---
  const DEPTH_STEP      = 1400;
  const MAX_VIDEOS      = 20;
  const FADE_SMOOTHING  = 0.10;
  const XFADE           = 0.5;

  const OFFSETS = [
    { x: -0.05, y:  0.015 },
    { x:  0.05, y: -0.015 },
    { x: -0.04, y:  0.02  },
    { x:  0.06, y: -0.005 },
    { x: -0.05, y:  0.01  },
    { x:  0.04, y:  0.02  },
    { x: -0.06, y: -0.01  },
    { x:  0.05, y:  0.005 },
  ];

  // --- 状態 ---
  let _cards        = [];
  let _opacities    = [];
  let _scrollTarget = 0;
  let _scrollCurrent = 0;
  let _focusedIndex = 0;
  let _breathPhase  = 0;
  let _mouseX = 0, _mouseY = 0;
  let _smoothMouseX = 0, _smoothMouseY = 0;
  let _lastTs       = 0;
  let _rafId        = null;
  let _bgCurrentIdx = -1;
  let _bgNextIdx    = -1;
  let _active       = false;
  let _isDragging   = false;

  // --- 背景要素 ---
  let _bgA, _bgB, _scene, _overlay;
  let _flIndex, _flTitle, _flSub, _flStats, _fixedLabel;
  let _progressThumb;
  let _holoOverlay = null;
  let _holoDepth   = 0;

  const LABEL_MODES  = ['follow', 'bottom', 'left-right', 'none'];
  const LABEL_LABELS = { follow: 'follow', bottom: 'bottom', 'left-right': 'left / right', none: 'none' };
  let _labelMode = 'follow';
  let _flFadeTimer = null;

  // --- ユーティリティ ---
  function lerp(a, b, t) { return a + (b - a) * t; }

  function _thumbUrl(v) {
    return v.thumb || ('https://i.ytimg.com/vi/' + v.id + '/mqdefault.jpg');
  }

  function _bgSrcOf(idx) {
    const c = _cards[idx];
    return c ? _thumbUrl(c.video) : '';
  }

  // --- オーバーレイ DOM 構築 ---
  function _buildOverlay(container) {
    const target = container || document.getElementById('rankingScreen') || document.body;
    // 既存のオーバーレイが別の親にある場合は移動
    let ov = document.getElementById('dgOverlay');
    if (ov) {
      if (ov.parentElement !== target) target.appendChild(ov);
      return;
    }

    ov = document.createElement('div');
    ov.id = 'dgOverlay';
    ov.innerHTML = [
      '<div id="dg-bg">',
      '  <img id="dg-bg-a" alt="" crossorigin="anonymous">',
      '  <img id="dg-bg-b" alt="" crossorigin="anonymous">',
      '</div>',
      '<div id="dg-noise"></div>',
      '<div id="dg-holo-overlay"></div>',,
      '<div id="dg-scene-wrap"><div id="dg-scene"></div></div>',
      '<div id="dg-progress"><div id="dg-progress-thumb"></div></div>',
      '<div id="dg-fixed-label">',
      '  <div id="dg-fl-index"></div>',
      '  <div id="dg-fl-title"></div>',
      '  <div id="dg-fl-sub"></div>',
      '  <div id="dg-fl-stats"></div>',
      '</div>',
    ].join('');
    target.appendChild(ov);
  }

  function _bindElements() {
    _overlay    = document.getElementById('dgOverlay');
    _bgA        = document.getElementById('dg-bg-a');
    _bgB        = document.getElementById('dg-bg-b');
    _scene      = document.getElementById('dg-scene');
    _fixedLabel = document.getElementById('dg-fixed-label');
    _flIndex    = document.getElementById('dg-fl-index');
    _flTitle    = document.getElementById('dg-fl-title');
    _flSub      = document.getElementById('dg-fl-sub');
    _flStats    = document.getElementById('dg-fl-stats');
    _progressThumb = document.getElementById('dg-progress-thumb');
    _holoOverlay   = document.getElementById('dg-holo-overlay');
    _holoDepth     = 0;
    // 画像ロード後にフェードイン
    var _holoImg = new Image();
    _holoImg.onload = function() {
      if (_holoOverlay) _holoOverlay.style.opacity = '0.75';
    };
    _holoImg.src = '/img/holo.png';
  }

  // --- ラベルモード ---
  function _applyLabelMode(focusIdx) {
    const idx = (focusIdx !== undefined) ? focusIdx : _focusedIndex;
    // カードラベルは常に非表示（FOLLOWも含め全モードで固定ラベルを使う）
    _overlay.querySelectorAll('.dg-card-label').forEach(function(el) {
      el.style.display = 'none';
    });
    _fixedLabel.style.display = '';
    _fixedLabel.className = '';
    if (_labelMode === 'follow') {
      _fixedLabel.className = 'mode-follow';
      _fixedLabel.style.transform = '';
      // position は _positionFollowLabel でフォーカス変化時に設定
    } else if (_labelMode === 'bottom') {
      _fixedLabel.className = 'mode-bottom';
    } else if (_labelMode === 'left-right') {
      const off = OFFSETS[idx % OFFSETS.length];
      _fixedLabel.className = off.x < 0 ? 'mode-right' : 'mode-left';
    } else {
      _fixedLabel.style.display = 'none';
    }
  }

  function _positionFollowLabel(focusIdx) {
    if (_labelMode !== 'follow' || !_fixedLabel) return;
    const fc = _cards[focusIdx];
    if (!fc) return;
    const off    = OFFSETS[focusIdx % OFFSETS.length];
    const onLeft = off.x < 0;
    const _ref   = (_overlay.offsetHeight > 0) ? _overlay : (_overlay.parentElement || _overlay);
    const areaW  = _ref.offsetWidth  || window.innerWidth;
    const areaH  = _ref.offsetHeight || window.innerHeight;
    const isShorts = fc.video.category === 'shorts';
    const cardH  = isShorts ? Math.round(areaH * 0.80) : Math.round(areaH * 0.70);
    _fixedLabel.style.top    = 'auto';
    _fixedLabel.style.bottom = Math.max(0, Math.round(areaH - (fc.baseY + cardH))) + 'px';
    if (onLeft) {
      _fixedLabel.style.left  = Math.round(fc.baseX + fc.cardW + 20) + 'px';
      _fixedLabel.style.right = '0';
      _fixedLabel.style.textAlign = 'left';
      _fixedLabel.style.width = '';
    } else {
      _fixedLabel.style.left  = '0';
      _fixedLabel.style.right = Math.round(areaW - fc.baseX + 20) + 'px';
      _fixedLabel.style.textAlign = 'right';
      _fixedLabel.style.width = '';
    }
  }

  function _statsText(v) {
    if (!v._battles) return v._rating ? String(v._rating) : '';
    return v._wins + 'W / ' + v._battles + ' · ' + v._wr + '%' + (v._rating ? ' · ' + v._rating : '');
  }

  function _updateFixedLabel(focusIdx) {
    const c = _cards[focusIdx];
    if (!c) return;
    if (_labelMode === 'left-right' || _labelMode === 'bottom') {
      _fixedLabel.style.opacity = '0';
      clearTimeout(_flFadeTimer);
      _flFadeTimer = setTimeout(function() {
        _applyLabelMode(focusIdx);
        _flIndex.textContent = String(c.video._rank || (focusIdx + 1)).padStart(2, '0');
        _flTitle.textContent = c.video.title;
        _flSub.textContent   = c.channelTitle || '';
        if (_flStats) _flStats.textContent = _statsText(c.video);
        _fixedLabel.style.opacity = '1';
        _flFadeTimer = null;
      }, 220);
    } else if (_labelMode === 'follow') {
      _flIndex.textContent = String(c.video._rank || (focusIdx + 1)).padStart(2, '0');
      _flTitle.textContent = c.video.title;
      _flSub.textContent   = c.channelTitle || '';
      if (_flStats) _flStats.textContent = _statsText(c.video);
      _positionFollowLabel(focusIdx);
    } else {
      _flIndex.textContent = String(c.video._rank || (focusIdx + 1)).padStart(2, '0');
      _flTitle.textContent = c.video.title;
      _flSub.textContent   = c.channelTitle || '';
      if (_flStats) _flStats.textContent = _statsText(c.video);
    }
  }

  // --- シーン構築 ---
  function _buildScene(videos, channelTitle) {
    _scene.innerHTML = '';
    _cards = [];
    _opacities = [];

    // _overlay は buildScene 時点でまだ display:none なので parentElement から寸法を取る
    const _ref  = (_overlay.offsetHeight > 0) ? _overlay : (_overlay.parentElement || _overlay);
    const areaW = _ref.offsetWidth  || window.innerWidth;
    const areaH = _ref.offsetHeight || window.innerHeight;

    const cardH       = Math.round(areaH * 0.70);
    const cardHShorts  = Math.round(areaH * 0.80);
    const cardW        = Math.round(cardH * (16 / 9));
    const cardWShorts  = Math.round(cardHShorts * (9 / 16));

    videos.forEach(function(v, i) {
      const isShorts = v.category === 'shorts';
      const cW = isShorts ? cardWShorts : cardW;
      const cH = isShorts ? cardHShorts : cardH;
      const off = OFFSETS[i % OFFSETS.length];
      const z   = -i * DEPTH_STEP;
      const cx  = areaW / 2;
      const cy  = areaH / 2;
      const x   = cx - cW / 2 + off.x * areaW;
      const y   = cy - cH / 2 + off.y * areaH;

      const card = document.createElement('div');
      card.className = 'dg-card' + (isShorts ? ' dg-card--shorts' : '');
      card.style.cssText = [
        'width:' + cW + 'px',
        'height:' + cH + 'px',
        'left:' + x + 'px',
        'top:' + y + 'px',
        'transform:translateZ(' + z + 'px)',
      ].join(';');

      const img = document.createElement('img');
      img.src     = _thumbUrl(v);
      img.alt     = v.title;
      img.loading = i < 3 ? 'eager' : 'lazy';
      card.appendChild(img);

      // 再生ボタン（ホバー時に表示）
      const play = document.createElement('div');
      play.className = 'dg-card-play';
      play.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>';
      card.appendChild(play);

      // ラベル（左右交互）
      const isOnLeft = off.x < 0;
      const lbl = document.createElement('div');
      lbl.className = 'dg-card-label dg-card-label--' + (isOnLeft ? 'right' : 'left');
      const statsHtml = (v._battles > 0)
        ? '<div class="dg-lbl-stats">' + v._wins + 'W / ' + v._battles + ' · ' + v._wr + '%'
          + (v._rating ? ' · ' + v._rating : '') + '</div>'
        : (v._rating ? '<div class="dg-lbl-stats">' + v._rating + '</div>' : '');
      lbl.innerHTML =
        '<div class="dg-lbl-index">' + String(v._rank || (i + 1)).padStart(2, '0') + '</div>' +
        '<div class="dg-lbl-title">' + _esc(v.title) + '</div>' +
        '<div class="dg-lbl-sub">'   + _esc(channelTitle || '') + '</div>' +
        statsHtml;
      card.appendChild(lbl);

      _scene.appendChild(card);
      _cards.push({ el: card, video: v, channelTitle, baseX: x, baseY: y, baseZ: z, cardW: cW });
      _opacities.push(0);
    });
  }

  function _esc(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // --- 背景クロスフェード ---
  function _updateBg(currentIdx, nextIdx, blend) {
    if (currentIdx !== _bgCurrentIdx || nextIdx !== _bgNextIdx) {
      _bgCurrentIdx = currentIdx;
      _bgNextIdx    = nextIdx;
      const curSrc = _bgSrcOf(currentIdx);
      const nxtSrc = _bgSrcOf(nextIdx);
      if (_bgA.dataset.src !== curSrc) { _bgA.src = curSrc; _bgA.dataset.src = curSrc; }
      if (_bgB.dataset.src !== nxtSrc) { _bgB.src = nxtSrc; _bgB.dataset.src = nxtSrc; }
      // ショートサムネの黒帯を隠すためズームクラスを付け外し
      const curIsShorts = _cards[currentIdx] && _cards[currentIdx].video.category === 'shorts';
      const nxtIsShorts = _cards[nextIdx]    && _cards[nextIdx].video.category    === 'shorts';
      _bgA.classList.toggle('is-shorts', curIsShorts);
      _bgB.classList.toggle('is-shorts', nxtIsShorts);
    }
    _bgA.style.opacity = 1 - blend;
    _bgB.style.opacity = blend;
  }

  // --- フォーカス更新 ---
  function _updateFocus() {
    const cameraRatio  = _scrollCurrent / DEPTH_STEP;
    const currentIdx   = Math.max(0, Math.min(Math.floor(cameraRatio), _cards.length - 1));
    const nextIdx      = Math.min(currentIdx + 1, _cards.length - 1);
    const blend        = cameraRatio - Math.floor(cameraRatio);

    _updateBg(currentIdx, nextIdx, blend);

    const focusIdx = blend < 0.5 ? currentIdx : nextIdx;
    if (focusIdx !== _focusedIndex) {
      if (_cards[_focusedIndex]) _cards[_focusedIndex].el.classList.remove('is-focused');
      _focusedIndex = focusIdx;
      if (_cards[_focusedIndex]) _cards[_focusedIndex].el.classList.add('is-focused');
      _updateFixedLabel(focusIdx);
    }

    // 中央50%のみクロスフェード
    const b0 = 0.5 - XFADE / 2;
    const b1 = 0.5 + XFADE / 2;
    const eb = blend < b0 ? 0 : blend > b1 ? 1 : (blend - b0) / XFADE;

    _cards.forEach(function(c, i) {
      let target = 0;
      if (i === currentIdx) target = 1 - eb;
      if (i === nextIdx)    target = Math.max(target, eb);

      const prev = _opacities[i];
      const next = lerp(prev, target, FADE_SMOOTHING);
      if (Math.abs(next - prev) > 0.001) {
        _opacities[i] = next;
        c.el.style.opacity       = next < 0.001 ? 0 : next;
        c.el.style.pointerEvents = next > 0.05 ? '' : 'none';
      }
    });

    // bottom モードはスクロール連動で opacity 更新（フェード中はスキップ）
    if (_labelMode === 'bottom' && !_flFadeTimer) {
      const flOp = _opacities[_focusedIndex] || 0;
      _fixedLabel.style.opacity = flOp < 0.001 ? 0 : flOp;
    }
  }

  // --- アニメーションループ ---
  function _animate(ts) {
    if (!_active) return;
    _rafId = requestAnimationFrame(_animate);

    const dt = Math.min((ts - _lastTs) / 1000, 0.05);
    _lastTs = ts;

    _scrollCurrent += (_scrollTarget - _scrollCurrent) * (_isDragging ? 0.18 : 0.09);
    _smoothMouseX  += (_mouseX - _smoothMouseX) * 0.07;
    _smoothMouseY  += (_mouseY - _smoothMouseY) * 0.07;
    _breathPhase   += dt * 0.35;

    // ホロ深度: 1〜30位でブラー・ズーム完了（ゆっくり lerp）
    var _holoMaxScroll = 29 * DEPTH_STEP;
    var _holoTarget = Math.min(_scrollCurrent / _holoMaxScroll, 1);
    _holoDepth += (_holoTarget - _holoDepth) * 0.025;

    const breathSin = Math.sin(_breathPhase);
    const camZ   = _scrollCurrent;
    const camX   = _smoothMouseX * -30;
    const camY   = _smoothMouseY * -20;
    const camRotZ = _smoothMouseX * -0.4;

    _scene.style.transform = [
      'translateX(' + camX + 'px)',
      'translateY(' + camY + 'px)',
      'translateZ(' + camZ + 'px)',
      'rotateZ(' + camRotZ + 'deg)',
    ].join(' ');

    _cards.forEach(function(c, i) {
      const dist = Math.abs(i - _focusedIndex);
      const s  = dist === 0 ? 1 + breathSin * 0.008 : 1;
      const bz = c.baseZ + (dist === 0 ? breathSin * 4 : 0);
      c.el.style.transform = 'translateZ(' + bz + 'px) scale(' + s + ')';
    });

    _updateFocus();

    // FOLLOWモード: パララックス分のみ transform で毎フレーム更新（ジャギなし）
    if (_labelMode === 'follow' && _fixedLabel) {
      const tx = _smoothMouseX * -30;
      const ty = _smoothMouseY * -20;
      _fixedLabel.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
    }

    // インジケーター更新（連続スクロール値ベース）
    if (_progressThumb && _cards.length > 1) {
      const pct = (_scrollCurrent / ((_cards.length - 1) * DEPTH_STEP)) * 100;
      _progressThumb.style.top = Math.max(0, Math.min(100, pct)) + '%';
    }

    // ホロオーバーレイ: 深度連動サイズ・ブラー + 極小マウス追従
    if (_holoOverlay) {
      var _ox = _smoothMouseX * 2;
      var _oy = _smoothMouseY * 1.5;
      var _tileSize = (200 + _holoDepth * 150).toFixed(2); // 200px → 350px
      var _blurAmt  = (0.6 + _holoDepth * 2.5).toFixed(2); // 0.6px → 3.1px
      var _cx = 'calc(50% + ' + _ox.toFixed(2) + 'px)';
      var _cy = 'calc(50% + ' + _oy.toFixed(2) + 'px)';
      _holoOverlay.style.backgroundSize     = _tileSize + 'px ' + _tileSize + 'px, ' + _tileSize + 'px ' + _tileSize + 'px, 300% 300%';
      _holoOverlay.style.backgroundPosition = _cx + ' ' + _cy + ', ' + _cx + ' ' + _cy + ', center';
      _holoOverlay.style.filter             = 'blur(' + _blurAmt + 'px) brightness(1.45) contrast(1)';
    }
  }

  let _progressBar = null;

  // --- イベント ---
  let _onWheel, _onTouchStart, _onTouchMove, _onMouseMove, _onMouseLeave, _onKeyDown, _onClick;
  let _touchStartY = 0;

  let _onProgressPointerDown, _onProgressPointerMove, _onProgressPointerUp;

  function _progressPosToScroll(clientY) {
    const rect = _progressBar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return Math.round(ratio * (_cards.length - 1)) * DEPTH_STEP;
  }

  function _bindProgressBar() {
    _progressBar = document.getElementById('dg-progress');
    if (!_progressBar) return;

    _onProgressPointerDown = function(e) {
      e.stopPropagation();
      _isDragging = true;
      _progressThumb.setPointerCapture(e.pointerId);
      _scrollTarget = _progressPosToScroll(e.clientY);
    };
    _onProgressPointerMove = function(e) {
      if (e.buttons === 0) return;
      _scrollTarget = _progressPosToScroll(e.clientY);
    };
    _onProgressPointerUp = function(e) {
      _isDragging = false;
      _scrollTarget = _progressPosToScroll(e.clientY);
      // ドラッグ終了後に発火する click がサムネに届かないよう1回だけ吸収
      _overlay.addEventListener('click', function absorbClick(ev) {
        ev.stopImmediatePropagation();
      }, { capture: true, once: true });
    };
    _progressThumb.style.pointerEvents = 'auto';
    _progressThumb.style.cursor = 'grab';
    _progressThumb.addEventListener('pointerdown', _onProgressPointerDown);
    _progressThumb.addEventListener('pointermove', _onProgressPointerMove);
    _progressThumb.addEventListener('pointerup',   _onProgressPointerUp);
  }

  function _buildProgressTicks() {
    if (!_progressBar || _cards.length < 2) return;
    // 既存の目盛りを削除
    _progressBar.querySelectorAll('.dg-progress-tick').forEach(function(el) { el.remove(); });
    const n = _cards.length;
    // 表示する目盛り位置（1位は0%、最後は100%、中間は均等に最大5点）
    const steps = [0];
    const intervals = [0.25, 0.5, 0.75];
    intervals.forEach(function(r) {
      const idx = Math.round(r * (n - 1));
      if (idx > 0 && idx < n - 1) steps.push(idx);
    });
    steps.push(n - 1);
    steps.forEach(function(idx) {
      const pct = idx / (n - 1) * 100;
      const tick = document.createElement('div');
      tick.className = 'dg-progress-tick';
      tick.style.top = pct + '%';
      // _rank があればそれを使う（asc/desc どちらでも正しいランク番号）
      const rank = (_cards[idx] && _cards[idx].video && _cards[idx].video._rank)
        ? _cards[idx].video._rank
        : idx + 1;
      tick.textContent = rank + '';
      _progressBar.appendChild(tick);
    });
  }

  function _bindEvents() {
    const maxScroll = function() { return (_cards.length - 1) * DEPTH_STEP; };

    let _wheelAccum = 0;
    let _wheelTimer = null;
    _onWheel = function(e) {
      e.preventDefault();
      const normalized = e.deltaMode === 1 ? e.deltaY * 40
                       : e.deltaMode === 2 ? e.deltaY * 800
                       : e.deltaY;
      _wheelAccum += normalized;
      const THRESH = 30;
      if (Math.abs(_wheelAccum) >= THRESH) {
        const dir = _wheelAccum > 0 ? 1 : -1;
        _wheelAccum = 0;
        const currentStep = Math.round(_scrollTarget / DEPTH_STEP);
        const next = Math.max(0, Math.min(currentStep + dir, _cards.length - 1));
        _scrollTarget = next * DEPTH_STEP;
      }
      clearTimeout(_wheelTimer);
      _wheelTimer = setTimeout(function() { _wheelAccum = 0; }, 200);
    };
    _onTouchStart = function(e) { _touchStartY = e.touches[0].clientY; };
    _onTouchMove = function(e) {
      e.preventDefault();
      const dy = _touchStartY - e.touches[0].clientY;
      _scrollTarget += dy * 1.6;
      _scrollTarget = Math.max(0, Math.min(_scrollTarget, maxScroll()));
      _touchStartY = e.touches[0].clientY;
    };
    _onMouseMove = function(e) {
      const fc = _cards[_focusedIndex];
      if (fc) {
        const r = fc.el.getBoundingClientRect();
        _overlay.style.cursor = (e.clientX >= r.left && e.clientX <= r.right &&
                                  e.clientY >= r.top  && e.clientY <= r.bottom)
          ? 'pointer' : 'default';
      }
      _mouseX = (e.clientX / window.innerWidth  - 0.5) * 2;
      _mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    _onMouseLeave = function(e) {
      // rankViewBar 上に移動した場合はリセットしない
      var rvb = document.getElementById('rankViewBar');
      if (rvb && e.relatedTarget && rvb.contains(e.relatedTarget)) return;
      _mouseX = 0; _mouseY = 0;
    };
    _onKeyDown = function(e) {
      if (e.key === 'Escape' && _active) {
        const galBtn = document.getElementById('listModeGalleryBtn');
        if (galBtn) galBtn.click();
      }
    };

    _overlay.addEventListener('wheel',      _onWheel,      { passive: false });
    _overlay.addEventListener('touchstart', _onTouchStart, { passive: true });
    _overlay.addEventListener('touchmove',  _onTouchMove,  { passive: false });
    _overlay.addEventListener('mousemove',  _onMouseMove);
    _overlay.addEventListener('mouseleave', _onMouseLeave);
    _onClick = function(e) {
      const c = _cards[_focusedIndex];
      if (!c) return;
      const rect = c.el.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right ||
          e.clientY < rect.top  || e.clientY > rect.bottom) return;
      window.openModalReactions(c.video);
    };
    _overlay.addEventListener('click', _onClick);
    document.addEventListener('keydown',    _onKeyDown);
  }

  function _unbindEvents() {
    if (_overlay) {
      _overlay.removeEventListener('wheel',      _onWheel);
      _overlay.removeEventListener('touchstart', _onTouchStart);
      _overlay.removeEventListener('touchmove',  _onTouchMove);
      _overlay.removeEventListener('mousemove',  _onMouseMove);
      _overlay.removeEventListener('mouseleave', _onMouseLeave);
      if (_onClick) _overlay.removeEventListener('click', _onClick);
    }
    if (_onKeyDown) document.removeEventListener('keydown', _onKeyDown);
  }

  // --- 公開 API ---
  window.initDepthGallery = function(videos, channelTitle, container, resumeScroll) {
    // 前回のRAF・イベントを必ず破棄してからやり直す
    _active = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    _unbindEvents();
    clearTimeout(_flFadeTimer);

    _buildOverlay(container);
    _bindElements();
    _bindEvents();

    // 状態リセット（resumeScrollがあればその位置から再開）
    const initScroll = (resumeScroll > 0) ? resumeScroll : 0;
    _scrollTarget  = initScroll;
    _scrollCurrent = initScroll;
    _focusedIndex  = 0;
    _breathPhase   = 0;
    _mouseX = 0; _mouseY = 0;
    _smoothMouseX = 0; _smoothMouseY = 0;
    _bgCurrentIdx = -1; _bgNextIdx = -1;
    _lastTs = 0;

    _buildScene(videos, channelTitle);
    _bindProgressBar();
    _buildProgressTicks();

    // 初期フォーカスをスクロール位置から計算
    const initFocusIdx = Math.max(0, Math.min(Math.round(initScroll / DEPTH_STEP), _cards.length - 1));
    _focusedIndex = initFocusIdx;

    // 初期背景
    const firstSrc = _bgSrcOf(initFocusIdx);
    const nextSrc  = _bgSrcOf(Math.min(initFocusIdx + 1, _cards.length - 1));
    _bgA.src = firstSrc; _bgA.dataset.src = firstSrc; _bgA.style.opacity = '1';
    _bgA.classList.toggle('is-shorts', _cards[initFocusIdx] && _cards[initFocusIdx].video.category === 'shorts');
    if (_cards.length > 1) {
      _bgB.src = nextSrc; _bgB.dataset.src = nextSrc;
      const nextIdx2 = Math.min(initFocusIdx + 1, _cards.length - 1);
      _bgB.classList.toggle('is-shorts', _cards[nextIdx2] && _cards[nextIdx2].video.category === 'shorts');
    }
    _bgCurrentIdx = initFocusIdx; _bgNextIdx = Math.min(initFocusIdx + 1, _cards.length - 1);

    _updateFixedLabel(initFocusIdx);
    _fixedLabel.style.opacity = '1';
    _applyLabelMode(initFocusIdx);
    if (_labelMode === 'follow') _positionFollowLabel(initFocusIdx);

    if (_cards[initFocusIdx]) {
      _opacities[initFocusIdx] = 1;
      _cards[initFocusIdx].el.style.opacity = '1';
      _cards[initFocusIdx].el.classList.add('is-focused');
    }

    _overlay.style.display = 'block';
    _active = true;
    _rafId  = requestAnimationFrame(_animate);

    // サイドバーリサイズ時にシーンを再構築
    if (window._dgResizeObserver) window._dgResizeObserver.disconnect();
    var _lastW = 0;
    window._dgResizeObserver = new ResizeObserver(function(entries) {
      if (!_active) return;
      var w = entries[0].contentRect.width;
      if (Math.abs(w - _lastW) < 2) return; // 微小変化は無視
      _lastW = w;
      var savedScroll = _scrollCurrent;
      _buildScene(_cards.map(function(c) { return c.video; }), channelTitle);
      _bindProgressBar();
      _buildProgressTicks();
      _scrollTarget = savedScroll;
      _scrollCurrent = savedScroll;
      _applyLabelMode(_focusedIndex);
      _positionFollowLabel(_focusedIndex);
    });
    window._dgResizeObserver.observe(_overlay.parentElement || _overlay);
  };

  window.getDepthGalleryScroll = function() {
    return _scrollCurrent;
  };

  window.setDepthLabelMode = function(mode) {
    if (!_active) return;
    _labelMode = mode;
    _applyLabelMode(_focusedIndex);
  };

  window.getDepthLabelMode = function() {
    return _labelMode;
  };

  window.destroyDepthGallery = function() {
    _active = false;
    if (_rafId) { cancelAnimationFrame(_rafId); _rafId = null; }
    _unbindEvents();
    if (window._dgResizeObserver) { window._dgResizeObserver.disconnect(); window._dgResizeObserver = null; }
    if (_overlay) _overlay.style.display = 'none';
    clearTimeout(_flFadeTimer);
  };

})();
