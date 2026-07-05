// PC版(public/index.html):         <script src="js/reactions-utils.js">
// モバイル版(public/mobile/index.html): <script src="../js/reactions-utils.js">
//
// グローバルスコープ (var / function) で公開することで、
// <script type="module"> な app.js 双方から参照可能にする。

// ピンカラーパレット [key, light, dark]
// key: アクセントカラー / light: 低密度ピン / dark: 高密度ピン
var PIN_PALETTES = {
  '#ec4899': ['#ec4899', '#f472b6', '#db2777'],  // pink:   key→light→dark
  '#00b0f4': ['#00b0f4', '#38bdf8', '#0284c7'],  // sky
  '#57f287': ['#57f287', '#4ade80', '#16a34a'],  // green
  '#f59e0b': ['#f59e0b', '#fbbf24', '#d97706'],  // amber
  '#a855f7': ['#a855f7', '#c084fc', '#9333ea'],  // purple
};

// ピン落下アニメーション定数
var PIN_DROP_HEIGHT  = 55;    // px: ピン落下高さ
var PIN_DROP_SPEED   = 1.5;   // s:  落下アニメーション時間
var PIN_FADE_IN_FRAC = 0.05;  // Web Animations フェードイン開始割合

// density (0-1) とパレット [key, light, dark] からピン色を RGB 文字列で返す
function pinColorFromDensity(d, palette) {
  function hexToRgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  const cLight = hexToRgb(palette[1]);
  const cDark  = hexToRgb(palette[2]);
  const t = Math.max(0, (d - 0.1) / 0.9);
  const r = Math.round(cLight[0] + (cDark[0] - cLight[0]) * t);
  const g = Math.round(cLight[1] + (cDark[1] - cLight[1]) * t);
  const b = Math.round(cLight[2] + (cDark[2] - cLight[2]) * t);
  return 'rgb(' + r + ',' + g + ',' + b + ')';
}

// KDE 重み計算（bandwidth=0.07）
// 戻り値: { cum: 累積分布配列, total: 合計 }
// cum/total は pinSampleFromKde でルーレット選択に使用
function pinComputeKde(pins) {
  const n = pins.length;
  if (n < 2) return null;
  const bw2 = 0.07 * 0.07;
  const noiseFloor = 0.15;
  const w = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const dx = pins[i].x - pins[j].x;
      const dy = pins[i].y - pins[j].y;
      w[i] += Math.exp(-(dx * dx + dy * dy) / (2 * bw2));
    }
  }
  const maxW = Math.max.apply(null, w) || 1;
  const cum  = new Array(n);
  let acc = 0;
  for (let i = 0; i < n; i++) {
    acc += w[i] / maxW + noiseFloor;
    cum[i] = acc;
  }
  return { cum, total: acc };
}

// グリッドクラスタリング（表示ピン密度計算に使用）
// 戻り値: [{ pin, pins, count, cent }] 降順ソート済み
function pinComputeClusters(pins) {
  const GRID = 10;
  const cellPins = {};
  for (const p of pins) {
    const cx = Math.min(GRID - 1, Math.floor(p.x * GRID));
    const cy = Math.min(GRID - 1, Math.floor(p.y * GRID));
    const key = cx + ',' + cy;
    if (!cellPins[key]) cellPins[key] = [];
    cellPins[key].push(p);
  }
  const clusters = [];
  for (const cell of Object.values(cellPins)) {
    let sumX = 0, sumY = 0;
    for (const p of cell) { sumX += p.x; sumY += p.y; }
    const centX = sumX / cell.length, centY = sumY / cell.length;
    let best = cell[0], bestDist = Infinity;
    for (const p of cell) {
      const dx = p.x - centX, dy = p.y - centY;
      const d = dx * dx + dy * dy;
      if (d < bestDist) { bestDist = d; best = p; }
    }
    clusters.push({ pin: best, pins: cell, count: cell.length, cent: { x: centX, y: centY } });
  }
  clusters.sort((a, b) => b.count - a.count);
  return clusters;
}

// 表示ピン一覧を構築（密集度重みで最大 count 本を選択）
// pins: 全ピン配列（コピーして使用）, count: 最大表示数
// 戻り値: [{ x, y, density }] シャッフル済み
function pinBuildPlaced(pins, count) {
  const allPins = pins.slice();
  if (!allPins.length) return [];
  const clusters = pinComputeClusters(allPins);
  const maxCount = clusters.length > 0 ? clusters[0].count : 1;
  const GRID = 10;
  const cellWeight = {};
  for (const cl of clusters) {
    const cx = Math.min(GRID - 1, Math.floor(cl.pin.x * GRID));
    const cy = Math.min(GRID - 1, Math.floor(cl.pin.y * GRID));
    cellWeight[cx + ',' + cy] = cl.count / maxCount;
  }
  const weighted = allPins.map(p => {
    const cx = Math.min(GRID - 1, Math.floor(p.x * GRID));
    const cy = Math.min(GRID - 1, Math.floor(p.y * GRID));
    return { p, w: Math.sqrt(cellWeight[cx + ',' + cy] || 0.01) };
  });
  weighted.sort((a, b) => Math.pow(Math.random(), 1 / b.w) - Math.pow(Math.random(), 1 / a.w));
  const placed = weighted.slice(0, count).map(item => ({ x: item.p.x, y: item.p.y, density: 0, dummy: item.p.dummy || false }));
  const BW2 = 0.09 * 0.09;
  let maxKde = 0;
  const kdeDensities = placed.map(pin => {
    let kde = 0;
    for (const p of allPins) {
      const dx = p.x - pin.x, dy = p.y - pin.y;
      kde += Math.exp(-(dx * dx + dy * dy) / (2 * BW2));
    }
    if (kde > maxKde) maxKde = kde;
    return kde;
  });
  if (maxKde > 0) {
    for (let i = 0; i < placed.length; i++) placed[i].density = kdeDensities[i] / maxKde;
  }
  for (let i = placed.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [placed[i], placed[j]] = [placed[j], placed[i]];
  }
  return placed;
}

// ピン DOM 要素を生成（落下アニメーション付き）
// palette: PIN_PALETTES の値 [key, light, dark]
function pinMakeElement(x, y, density, skipDropAnim, pinProps, palette) {
  const d = density != null ? density : 0.5;
  const baseScale = 0.6 + 0.8 * d;
  const scale = (pinProps && pinProps._scale != null) ? pinProps._scale : baseScale + (Math.random() - 0.5) * 0.4;
  const sz  = Math.round(20 * scale);
  const szH = Math.round(sz * 1.25);
  const shadeIdx = d >= 0.67 ? 2 : d >= 0.34 ? 1 : 0;
  const pinColor = pinColorFromDensity(d, palette);
  // viewBox 0 0 24 30 でピン先端は y=29、translate(-50%,-100%) は底辺を座標に合わせる
  // → 先端は底辺より szH/30 px 上にある分を top に加算して補正
  const tipGap = szH / 30;
  const el = document.createElement('div');
  el.className = 'reactions-pin shade-' + shadeIdx;
  el.dataset.x = x;
  el.dataset.y = y;
  el.dataset.density = d.toFixed(4);
  el.style.cssText = 'left:' + (x * 100) + '%;top:calc(' + (y * 100) + '% + ' + tipGap.toFixed(2) + 'px);--drop-h:' + PIN_DROP_HEIGHT + 'px;';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'reactions-pin-svg');
  svg.setAttribute('viewBox', '0 0 24 30');
  svg.setAttribute('width', sz);
  svg.setAttribute('height', szH);
  svg.innerHTML =
    '<path class="pin-balloon" style="fill:' + pinColor + '" d="M12,29 C5.5,21.5 1.5,17 1.5,11 a10.5,10.5,0,0,1,21,0 C22.5,17 18.5,21.5 12,29 Z"/>'
    + '<g transform="translate(12 11) scale(0.38) translate(-12 -12)">'
    + '<path class="pin-icon" d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>'
    + '</g>';
  el.appendChild(svg);
  const floatDur = ((pinProps && pinProps._floatDur != null) ? pinProps._floatDur : (2.4 + Math.random() * 0.8).toFixed(2)) + 's ease-in-out infinite';
  if (skipDropAnim) {
    el.style.transform  = 'translate(-50%, -100%)';
    el.style.opacity    = '1';
    el.style.animation  = 'reactionsPinFloat ' + floatDur;
    svg.style.animation = 'none';
    el.classList.add('rs-floating');
  } else {
    el.style.animation  = 'reactionsPinDrop ' + PIN_DROP_SPEED + 's linear forwards';
    svg.style.animation = 'reactionsPinSvgSquash ' + PIN_DROP_SPEED + 's linear forwards';
    el.animate(
      [{ opacity: 0, offset: 0 }, { opacity: 1, offset: PIN_FADE_IN_FRAC }, { opacity: 1, offset: 1 }],
      { duration: PIN_DROP_SPEED * 1000, fill: 'forwards', easing: 'linear' }
    );
    el.addEventListener('animationend', function(e) {
      if (e.animationName === 'reactionsPinDrop') {
        el.style.animation  = 'reactionsPinFloat ' + floatDur;
        svg.style.animation = 'none';
        el.classList.add('rs-floating');
      }
    }, { once: true });
  }
  return el;
}

// ローカル環境のみ: ピン数が少ない場合にダミーで補完（表示確認用）
// pins: 対象配列（破壊的変更あり）, target: 目標件数
function pinFillDummy(pins, target) {
  if (pins.length >= target) return;
  function gauss(mean, sd) {
    let u, v;
    do { u = Math.random(); } while (u === 0);
    do { v = Math.random(); } while (v === 0);
    const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.max(0.01, Math.min(0.99, mean + n * sd));
  }
  function samplePin(hotspots) {
    if (Math.random() < 0.08) return { x: Math.random(), y: Math.random() };
    const total = hotspots.reduce((s, h) => s + h.w, 0);
    let r = Math.random() * total;
    for (const h of hotspots) {
      r -= h.w;
      if (r <= 0) return { x: gauss(h.x, h.sx), y: gauss(h.y, h.sy) };
    }
    const h = hotspots[hotspots.length - 1];
    return { x: gauss(h.x, h.sx), y: gauss(h.y, h.sy) };
  }
  let hotspots;
  if (pins.length >= 3) {
    const clusters = pinComputeClusters(pins);
    hotspots = clusters.map(cl => ({
      x: cl.pin.x, y: cl.pin.y,
      sx: 0.06, sy: 0.06,
      w: cl.count,
    }));
  } else {
    const nc = 3 + Math.floor(Math.random() * 3);
    hotspots = Array.from({ length: nc }, () => ({
      x:  0.1 + Math.random() * 0.8,
      y:  0.1 + Math.random() * 0.8,
      sx: 0.05 + Math.random() * 0.05,
      sy: 0.05 + Math.random() * 0.05,
      w:  1 + Math.random() * 3,
    }));
  }
  const needed = target - pins.length;
  for (let i = 0; i < needed; i++) pins.push({ ...samplePin(hotspots), dummy: true });
}
