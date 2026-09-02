import { filteredVideos } from './storage.js';
import { getVotePair, setVotePair, pickPair, _playedPairs, _pairKey } from './rating.js';

let _renderEmptyCat;
let _applyVote;

export function configureVoteView(config) {
  _renderEmptyCat = config.renderEmptyCat;
  _applyVote = config.applyVote;
}

// --- 投票ペースゲージ ---
const voteTimes = [];

const PACE_WINDOW_MS = 10000;
const PACE_LEVELS = [
  { max: 5,        labelKey: 'vote-pace-stable',  cls: '' },
  { max: 12,       labelKey: 'vote-pace-fast',    cls: 'pace-warm' },
  { max: Infinity, labelKey: 'vote-pace-blazing', cls: 'pace-hot' },
];

export function updatePaceGauge() {
  const now = Date.now();
  while (voteTimes.length && now - voteTimes[0] > PACE_WINDOW_MS) voteTimes.shift();
  voteTimes.push(now);
  const count = voteTimes.length;
  const level = PACE_LEVELS.find(l => count <= l.max) ?? PACE_LEVELS[PACE_LEVELS.length - 1];
  const pct = Math.min(100, Math.round(count / 12 * 100));
  const fill = document.getElementById('paceFill');
  const lbl  = document.getElementById('paceLabel');
  if (!fill || !lbl) return;
  fill.style.width = pct + '%';
  fill.className = 'vote-pace-bar-fill' + (level.cls ? ' ' + level.cls : '');
  lbl.textContent = t(level.labelKey);
}

// _currentVotePair の get/set を rating.js の getVotePair/setVotePair に委譲
Object.defineProperty(window, '_currentVotePair', {
  get() { return getVotePair(); },
  set(v) { setVotePair(v); },
  configurable: true,
});

// --- 傾き強度 ---
const _tiltScale = 0.5;

export function renderVote() {
  // 投票後または初回のみ新ペアを抽選。画面戻りではそのまま表示。
  // リロード復元時: ペアの動画が現在のリストに存在するか検証
  if (_currentVotePair) {
    const ids = new Set(filteredVideos().map(v => v.id));
    if (!ids.has(_currentVotePair[0].id) || !ids.has(_currentVotePair[1].id)) {
      _currentVotePair = null;
    }
  }
  if (!_currentVotePair) {
    _currentVotePair = pickPair(filteredVideos);
  }
  const pair = _currentVotePair;
  const container = document.getElementById('votePair');
  const _voteCounter = document.querySelector('.vote-counter');
  const _votePace    = document.querySelector('.vote-pace-wrap');
  if (!pair) {
    if (_voteCounter) _voteCounter.style.display = 'none';
    if (_votePace)    _votePace.style.display    = 'none';
    const _tutEl = document.getElementById('voteTutorial');
    if (_tutEl) _tutEl.style.display = 'none';
    if (filteredVideos().length >= 2) {
      // 全組み合わせ評価確定済み
      _renderEmptyCat(container, t('vote-all-done'));
    } else if (filteredVideos().length > 0) {
      // 動画が1本以下
      _renderEmptyCat(container, t('vote-need-more'));
    } else {
      _renderEmptyCat(container);
    }
    return;
  }
  if (_voteCounter) _voteCounter.style.display = '';
  if (_votePace)    _votePace.style.display    = '';
  const _tutEl = document.getElementById('voteTutorial');
  if (_tutEl && !localStorage.getItem('thumb-vote-tutorial-seen')) _tutEl.style.display = '';
  const [pairA, pairB] = pair;

  // カードが既に存在する場合は再利用、なければ初期構築
  const existingCards = container.querySelectorAll('.vote-card');
  if (existingCards.length === 2) {
    // 既存カードを再利用: 状態リセット → データ更新
    existingCards.forEach(function(card, idx) {
      const v = idx === 0 ? pairA : pairB;
      card.className = 'vote-card';
      card.dataset.id = v.id;
      // winner/loser オーバーレイを除去
      const ov = card.querySelector('.vote-good-overlay');
      if (ov) ov.remove();
      // 画像・タイトル更新
      const img = card.querySelector('.card-banner');
      img.src = v.thumb;
      img.onerror = function() { this.src = 'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg'; };
      card.querySelector('.tilter__caption').textContent = v.title;
      // tilt 状態をリセット（前の投票時のアニメが残っている場合があるため）
      const fig = card.querySelector('.tilter__figure');
      const cap = card.querySelector('.tilter__caption');
      const shi = card.querySelector('.tilter__deco--shine > div');
      anime.remove([fig, cap, shi]);
      fig.style.transform = '';
      cap.style.transform = '';
      shi.style.transform = '';
      fig.classList.remove('tilt-smooth');
      cap.classList.remove('tilt-smooth');
      shi.classList.remove('tilt-smooth');
    });
    // クリックハンドラを委譲に切り替え済みなのでここでは何もしない
    return;
  }

  // 初回: カードを構築
  container.innerHTML = '';
  const frag = document.createDocumentFragment();
  [pairA, pairB].forEach((v, idx) => {
    const card = document.createElement('div');
    card.className = 'vote-card';
    card.dataset.id = v.id;
    card.innerHTML =
      '<figure class="tilter__figure">' +
        '<img class="card-banner" src="' + v.thumb + '" alt=""' +
        ' onerror="this.src=\'https://i.ytimg.com/vi/' + v.id + '/hqdefault.jpg\'">' +
        '<div class="tilter__deco tilter__deco--shine"><div></div></div>' +
        '<figcaption class="tilter__caption"></figcaption>' +
      '</figure>';
    card.querySelector('.tilter__caption').textContent = v.title;

    const fig     = card.querySelector('.tilter__figure');
    const caption = card.querySelector('.tilter__caption');
    const shine   = card.querySelector('.tilter__deco--shine > div');

    let _tiltRaf = null;
    let _tiltNx = 0, _tiltNy = 0;

    card.addEventListener('mouseenter', function() {
      // 戻りアニメが進行中ならキャンセルし、CSS transitionを有効化
      anime.remove([fig, caption, shine]);
      fig.classList.add('tilt-smooth');
      caption.classList.add('tilt-smooth');
      shine.classList.add('tilt-smooth');
    });

    card.addEventListener('mousemove', function(e) {
      const rect = card.getBoundingClientRect();
      // -0.5〜0.5に正規化
      _tiltNx = (e.clientX - rect.left) / rect.width  - 0.5;
      _tiltNy = (e.clientY - rect.top)  / rect.height - 0.5;
      if (_tiltRaf) return;
      _tiltRaf = requestAnimationFrame(function() {
        _tiltRaf = null;
        fig.style.transform     = 'rotateX(' + (-_tiltNy * 12 * _tiltScale) + 'deg) rotateY(' + (_tiltNx * 16 * _tiltScale) + 'deg)';
        caption.style.transform = 'translateX(' + (_tiltNx * 28 * _tiltScale) + 'px) translateY(' + (_tiltNy * 28 * _tiltScale) + 'px)';
        shine.style.transform   = 'translateX(' + (_tiltNx * 100 * _tiltScale) + 'px) translateY(' + (_tiltNy * 100 * _tiltScale) + 'px)';
      });
    });

    card.addEventListener('mouseleave', function() {
      // 進行中の RAF をキャンセル
      if (_tiltRaf) { cancelAnimationFrame(_tiltRaf); _tiltRaf = null; }
      // CSS transitionを無効化してからanime.jsのelasticで戻す
      fig.classList.remove('tilt-smooth');
      caption.classList.remove('tilt-smooth');
      shine.classList.remove('tilt-smooth');
      // figureの傾きをelasticで戻す
      anime({ targets: fig,
        rotateX: 0, rotateY: 0,
        duration: 1200, easing: 'easeOutElastic', elasticity: 600 });
      // captionの視差をelasticで戻す
      anime({ targets: caption,
        translateX: 0, translateY: 0,
        duration: 1500, easing: 'easeOutElastic', elasticity: 600 });
      // shineをelasticで中心に戻す
      anime({ targets: shine,
        translateX: 0, translateY: 0,
        duration: 1200, easing: 'easeOutElastic', elasticity: 600 });
    });

    frag.appendChild(card);
    if (idx === 0) {
      const vs = document.createElement('div');
      vs.className = 'vote-vs-sep';
      vs.textContent = 'VS';
      frag.appendChild(vs);
    }
  });
  container.appendChild(frag);
}

// カード再利用版のクリックハンドラ（委譲）
document.addEventListener('click', function(e) {
  const card = e.target.closest('#votePair .vote-card');
  if (!card || !_currentVotePair) return;
  const [pairA, pairB] = _currentVotePair;
  const isA = card.dataset.id === pairA.id;
  const winner = isA ? pairA : pairB;
  const loser  = isA ? pairB : pairA;
  _applyVote(winner.id, loser.id);
  _playedPairs.add(_pairKey(winner.id, loser.id));
  const container = document.getElementById('votePair');
  container.querySelectorAll('.vote-card').forEach(c => {
    c.classList.add(c.dataset.id === winner.id ? 'winner' : 'loser');
    if (c.dataset.id === winner.id) {
      const ov = document.createElement('div');
      ov.className = 'vote-good-overlay';
      ov.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1.91l-.01-.01L23 10z"/></svg>';
      c.appendChild(ov);
    }
  });
  _currentVotePair = null;
  setTimeout(renderVote, 500);
});