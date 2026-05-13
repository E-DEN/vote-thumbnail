/**
 * reactions テーブルにダミーデータを投入するスクリプト
 *
 * セッションIDは "seed-YYYYMMDDHHMMSS-XXXX" 形式でデバッグ投入と識別可能。
 * --clear-seed で seed データのみ削除できる。
 *
 * 使い方:
 *   node db/seed-reactions.mjs [options]
 *
 * オプション:
 *   --video   <id[,id...]>      対象動画ID（カンマ区切り or 複数回指定）
 *   --channel <channel_id[,...]> DBのchannelに紐づく全動画を対象（複数回指定可）
 *   --count   <n>               1動画あたりの投入件数 (default: 10)
 *   --outlier <f>               外れピン率 0–1 (default: 0.08)
 *   --clear                     投入前に対象動画の既存データを削除
 *   --clear-seed                投入前に対象動画のseedデータのみ削除
 *   --db      <path>            DBファイルのパスを直接指定
 *
 * 例:
 *   node db/seed-reactions.mjs --video abc123
 *   node db/seed-reactions.mjs --channel UCxxxxxxx --count 30
 *   node db/seed-reactions.mjs --channel UCxxxxxxx --clear-seed
 *   node db/seed-reactions.mjs --video abc123 --video def456 --count 50
 *   node db/seed-reactions.mjs --video abc123,def456,ghi789 --count 40 --clear
 */

import { execSync } from 'child_process';
import { readdirSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// seed セッションIDのプレフィックス（この文字列から始まるものがseedデータ）
const SEED_PREFIX = 'seed-';

// 実行時刻をIDに埋め込む（YYYYMMDDHHmmss）
const runTs = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);

function makeSeedId(seq) {
  return `${SEED_PREFIX}${runTs}-${String(seq).padStart(4, '0')}`;
}

// --- CLI 引数パース ---
const args = process.argv.slice(2);
const cliVideos   = [];
const cliChannels = [];
let cliCount     = null;
let cliOutlier   = null;
let cliClear     = false;
let cliClearSeed = false;
let cliDb        = null;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--video':      cliVideos.push(...args[++i].split(',')); break;
    case '--channel':    cliChannels.push(...args[++i].split(',')); break;
    case '--count':      cliCount     = Number(args[++i]); break;
    case '--outlier':    cliOutlier   = Number(args[++i]); break;
    case '--clear':      cliClear     = true; break;
    case '--clear-seed': cliClearSeed = true; break;
    case '--db':         cliDb        = args[++i]; break;
    default:
      console.error(`Unknown option: ${args[i]}`);
      process.exit(1);
  }
}

// --- DB 自動検出 ---
function findDb() {
  const base = '.wrangler/state/v3/d1';
  try {
    for (const dir of readdirSync(base)) {
      const sub = join(base, dir);
      if (!statSync(sub).isDirectory()) continue;
      for (const f of readdirSync(sub)) {
        if (f.endsWith('.sqlite')) return join(sub, f);
      }
    }
  } catch { /* ディレクトリなし */ }
  return null;
}

const DB = cliDb ?? findDb();
if (!DB) {
  console.error('DBファイルが見つかりません。--db <path> で指定するか、wrangler dev を起動してください。');
  process.exit(1);
}
console.log(`DB: ${DB}`);

// --- sqlite3 クエリヘルパー（JSON Lines出力） ---
function sqlQuery(sql) {
  const out = execSync(
    `sqlite3 -json "${DB}" ${JSON.stringify(sql)}`,
    { shell: 'cmd.exe', encoding: 'utf8' }
  ).trim();
  return out ? JSON.parse(out) : [];
}

// --- チャンネル配下の動画IDをDBから取得 ---
function videoIdsForChannel(channelId) {
  const rows = sqlQuery(`SELECT video_id FROM videos WHERE channel_id = '${channelId.replace(/'/g, "''")}';`);
  return rows.map(r => r.video_id);
}

// --- 動画リスト確定 ---
if (!cliVideos.length && !cliChannels.length) {
  console.error('--video <id> か --channel <channel_id> が必要です。');
  process.exit(1);
}

const videoIds = [...cliVideos];

for (const ch of cliChannels) {
  const ids = videoIdsForChannel(ch);
  if (!ids.length) {
    console.warn(`Warning: channel "${ch}" の動画がDBに見つかりません。`);
  } else {
    console.log(`Channel ${ch}: ${ids.length} videos`);
    videoIds.push(...ids);
  }
}

// 重複排除
const uniqueVideoIds = [...new Set(videoIds)];
if (!uniqueVideoIds.length) {
  console.error('対象動画が0件です。');
  process.exit(1);
}

const COUNT   = cliCount   ?? 10;
const OUTLIER = cliOutlier ?? 0.08;

// ランダムなホットスポットを生成（16:9 サムネイル、動画ごとに異なる分布）
function randomHotspots() {
  const n = 3 + Math.floor(Math.random() * 3);
  return Array.from({ length: n }, () => ({
    x:  0.1 + Math.random() * 0.8,
    y:  0.1 + Math.random() * 0.8,
    sx: 0.05 + Math.random() * 0.05,
    sy: 0.05 + Math.random() * 0.05,
    w:  1 + Math.random() * 3,
  }));
}

const VIDEOS = uniqueVideoIds.map(id => ({
  id,
  count:    COUNT,
  hotspots: randomHotspots(),
}));

// --- 乱数ユーティリティ ---
function gauss(mean, sd) {
  let u, v;
  do { u = Math.random(); } while (u === 0);
  do { v = Math.random(); } while (v === 0);
  const n = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  return Math.max(0.01, Math.min(0.99, mean + n * sd));
}

function samplePin(hotspots) {
  if (Math.random() < OUTLIER) return { x: Math.random(), y: Math.random() };
  const total = hotspots.reduce((s, h) => s + h.w, 0);
  let r = Math.random() * total;
  for (const h of hotspots) {
    r -= h.w;
    if (r <= 0) return { x: gauss(h.x, h.sx), y: gauss(h.y, h.sy) };
  }
  const h = hotspots[hotspots.length - 1];
  return { x: gauss(h.x, h.sx), y: gauss(h.y, h.sy) };
}

// --- SQL 生成 ---
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
const sqls = [];
const inList = uniqueVideoIds.map(id => `'${id}'`).join(', ');

if (cliClear) {
  sqls.push(`DELETE FROM reactions WHERE video_id IN (${inList});`);
  console.log(`Clearing ALL rows for ${uniqueVideoIds.length} video(s)`);
} else if (cliClearSeed) {
  sqls.push(`DELETE FROM reactions WHERE video_id IN (${inList}) AND session_id LIKE '${SEED_PREFIX}%';`);
  console.log(`Clearing SEED rows for ${uniqueVideoIds.length} video(s)`);
}

let seq = 0;
const rows = [];
for (const video of VIDEOS) {
  for (let i = 0; i < video.count; i++) {
    const { x, y } = samplePin(video.hotspots);
    const sid = makeSeedId(seq++);
    rows.push(`('${video.id}', '${sid}', ${x.toFixed(6)}, ${y.toFixed(6)}, '${now}')`);
  }
}
sqls.push(`INSERT OR IGNORE INTO reactions (video_id, session_id, x, y, updated_at) VALUES\n${rows.join(',\n')};`);

// --- 実行 ---
const tmpFile = join(tmpdir(), 'seed-reactions.sql');
writeFileSync(tmpFile, sqls.join('\n'), 'utf8');
execSync(`sqlite3 "${DB}" ".read ${tmpFile}"`, { stdio: 'inherit', shell: 'cmd.exe' });
unlinkSync(tmpFile);

console.log(`Done: inserted ${rows.length} rows (${VIDEOS.length} video(s), ${COUNT} each).`);
console.log(`Session ID prefix: ${SEED_PREFIX}${runTs}-*`);
