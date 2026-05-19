// rating.js — Glicko-2 レーティング + 投票ヘルパー
import { state, LS_RATING, LS_VOTE_PAIR } from './state.js';

// --- Glicko-2 定数 ---
export const G2_TAU        = 0.5;
export const G2_SCALE      = 173.7178;
export const G2_SETTLED_RD = 80;

// --- Glicko-2 コア ---
export function g2Init() {
  return { rating: 1500, rd: 350, volatility: 0.06, wins: 0, battles: 0 };
}

export function getRating(id)  { return state.ratingData[id]?.rating   ?? 1500; }
export function getRd(id)      { return state.ratingData[id]?.rd        ?? 350; }
export function getWins(id)    { return state.ratingData[id]?.wins      ?? 0; }
export function getBattles(id) { return state.ratingData[id]?.battles   ?? 0; }

export function g2Update(player, opponent, score) {
  const mu    = (player.rating - 1500) / G2_SCALE;
  const phi   = player.rd / G2_SCALE;
  const sigma = player.volatility;
  const muJ   = (opponent.rating - 1500) / G2_SCALE;
  const phiJ  = opponent.rd / G2_SCALE;
  const gPhiJ = 1 / Math.sqrt(1 + 3 * phiJ * phiJ / (Math.PI * Math.PI));
  const E     = 1 / (1 + Math.exp(-gPhiJ * (mu - muJ)));
  const v     = 1 / (gPhiJ * gPhiJ * E * (1 - E));
  const delta = v * gPhiJ * (score - E);
  // ボラティリティ更新（Illinois アルゴリズム）
  const a = Math.log(sigma * sigma);
  const f = x => {
    const ex = Math.exp(x);
    const d2 = phi * phi + v + ex;
    return (ex * (delta * delta - d2)) / (2 * d2 * d2) - (x - a) / (G2_TAU * G2_TAU);
  };
  let A = a;
  let B = delta * delta > phi * phi + v
    ? Math.log(delta * delta - phi * phi - v)
    : (() => { let k = 1; while (f(a - k * G2_TAU) < 0) k++; return a - k * G2_TAU; })();
  let fA = f(A), fB = f(B);
  for (let i = 0; Math.abs(B - A) > 1e-6 && i < 100; i++) {
    const C = A + (A - B) * fA / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else { fA /= 2; }
    B = C; fB = fC;
  }
  const sigmaPrime = Math.exp(A / 2);
  const phiStar    = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime   = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime    = mu + phiPrime * phiPrime * gPhiJ * (score - E);
  return {
    rating:     G2_SCALE * muPrime + 1500,
    rd:         G2_SCALE * phiPrime,
    volatility: sigmaPrime,
  };
}

// --- ストレージ ---
export function saveRating() {
  localStorage.setItem(LS_RATING, JSON.stringify({
    ratingData: state.ratingData,
    voteTotal:  state.voteTotal,
  }));
}

/** レーティングを localStorage から読み込む。
 *  @param {function} [onLoaded] - 読み込み後に呼ばれるコールバック (voteTotal を受け取る)
 */
export function loadRating(onLoaded) {
  const raw = localStorage.getItem(LS_RATING);
  if (!raw) return;
  const d = JSON.parse(raw);
  const raw2 = d.ratingData ?? d['eloData'] ?? {};
  // 旧 Elo 形式からの移行も処理。state.ratingData の参照を壊さず中身を置き換える。
  Object.keys(state.ratingData).forEach(k => delete state.ratingData[k]);
  Object.entries(raw2).forEach(([id, v]) => {
    state.ratingData[id] = v.rating != null
      ? v
      : { ...g2Init(), rating: v.elo ?? 1500, wins: v.wins ?? 0, battles: v.battles ?? 0 };
  });
  state.voteTotal = d.voteTotal ?? 0;
  if (onLoaded) onLoaded(state.voteTotal);
}

// --- 投票ローカル適用（Glicko-2 更新 + 保存） ---
export function applyVoteLocal(winnerId, loserId) {
  if (!state.ratingData[winnerId]) state.ratingData[winnerId] = g2Init();
  if (!state.ratingData[loserId])  state.ratingData[loserId]  = g2Init();
  const w  = state.ratingData[winnerId];
  const l  = state.ratingData[loserId];
  const wUp = g2Update(w, l, 1);
  const lUp = g2Update(l, w, 0);
  state.ratingData[winnerId] = { ...wUp, wins: w.wins + 1, battles: w.battles + 1 };
  state.ratingData[loserId]  = { ...lUp, wins: l.wins,     battles: l.battles + 1 };
  saveRating();
}

/** 投票をサーバーに送信し、返却された Glicko-2 値でローカルを上書きする */
export function syncVoteToServer(winnerId, loserId) {
  if (!state.currentChannelKey) return;
  fetch('/api/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      winner_id:  winnerId,
      loser_id:   loserId,
      channel_id: state.currentChannelKey,
    }),
  }).then(res => res.ok ? res.json() : null)
    .then(data => {
      if (!data?.ok) return;
      if (data.winner) {
        state.ratingData[winnerId] = {
          ...state.ratingData[winnerId],
          rating:     data.winner.rating,
          rd:         data.winner.rd,
          volatility: data.winner.volatility,
        };
      }
      if (data.loser) {
        state.ratingData[loserId] = {
          ...state.ratingData[loserId],
          rating:     data.loser.rating,
          rd:         data.loser.rd,
          volatility: data.loser.volatility,
        };
      }
      saveRating();
    })
    .catch(() => { /* サイレント失敗 */ });
}

// --- 投票ペア管理 ---
export const _playedPairs = new Set();

export function _pairKey(idA, idB) {
  return idA < idB ? idA + '|' + idB : idB + '|' + idA;
}

function _loadVotePairByCat() {
  try { return JSON.parse(localStorage.getItem(LS_VOTE_PAIR)) || {}; } catch { return {}; }
}
function _saveVotePairByCat(d) {
  try { localStorage.setItem(LS_VOTE_PAIR, JSON.stringify(d)); } catch {}
}
export const _votePairByCat = _loadVotePairByCat();

export function getVotePair() {
  return _votePairByCat[(state.currentChannelKey || '') + ':' + state.currentCat] ?? null;
}
export function setVotePair(v) {
  const k = (state.currentChannelKey || '') + ':' + state.currentCat;
  if (v === null) { delete _votePairByCat[k]; }
  else { _votePairByCat[k] = v; }
  _saveVotePairByCat(_votePairByCat);
}

// --- ペア抽選 ---
// filteredVideos は storage.js にあるが、循環インポートを避けるため引数で受け取る
export function pickPair(filteredVideos) {
  const pool = filteredVideos();
  if (pool.length < 2) return null;

  function buildCandidates() {
    const list = [];
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        if (getRd(pool[i].id) <= G2_SETTLED_RD && getRd(pool[j].id) <= G2_SETTLED_RD) continue;
        if (_playedPairs.has(_pairKey(pool[i].id, pool[j].id))) continue;
        list.push([i, j]);
      }
    }
    return list;
  }

  let candidates = buildCandidates();
  if (candidates.length === 0) {
    _playedPairs.clear();
    candidates = buildCandidates();
  }
  if (candidates.length === 0) return null;

  const weights = candidates.map(([i, j]) => getRd(pool[i].id) + getRd(pool[j].id));
  const totalW  = weights.reduce((s, w) => s + w, 0);
  let r = Math.random() * totalW;
  for (let k = 0; k < candidates.length; k++) {
    r -= weights[k];
    if (r <= 0) {
      const [i, j] = candidates[k];
      return [pool[i], pool[j]];
    }
  }
  const [i, j] = candidates[candidates.length - 1];
  return [pool[i], pool[j]];
}
