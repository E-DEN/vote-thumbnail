/**
 * reactions テーブルにダミーデータを投入するスクリプト
 *
 * 使い方:
 *   node db/seed-reactions.mjs [options]
 *
 * オプション:
 *   --video  <id[,id...]>  対象動画ID（カンマ区切り or 複数回指定）
 *   --count  <n>           1動画あたりの投入件数 (default: 100)
 *   --outlier <f>          外れピン率 0–1 (default: 0.08)
 *   --clear                投入前に対象動画の既存データを削除
 *   --db     <path>        DBファイルのパスを直接指定
 *
 * 例:
 *   node db/seed-reactions.mjs --video abc123
 *   node db/seed-reactions.mjs --video abc123 --video def456 --count 50
 *   node db/seed-reactions.mjs --video abc123 --video def456 --clear
 *   node db/seed-reactions.mjs --video abc123,def456,ghi789 --count 40 --clear
 */

import { execSync } from 'child_process';
import { randomUUID } from 'crypto';
import { readdirSync, writeFileSync, unlinkSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// --- CLI 引数パース ---
const args = process.argv.slice(2);
const cliVideos = [];
let cliCount   = null;
let cliOutlier = null;
let cliClear   = false;
let cliDb      = null;

for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--video':   cliVideos.push(...args[++i].split(',')); break;
    case '--count':   cliCount   = Number(args[++i]); break;
    case '--outlier': cliOutlier = Number(args[++i]); break;
    case '--clear':   cliClear   = true; break;
    case '--db':      cliDb      = args[++i]; break;
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

// --- 動画リスト確定 ---
if (!cliVideos.length) {
  console.error('--video <id> が必要です。例: node db/seed-reactions.mjs --video wKa3ZI9oeuc');
  process.exit(1);
}
const videoIds = cliVideos;
const COUNT     = cliCount   ?? 10;
const OUTLIER   = cliOutlier ?? 0.08;

const VIDEOS = videoIds.map(id => ({
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

if (cliClear) {
  const ids = videoIds.map(id => `'${id}'`).join(', ');
  sqls.push(`DELETE FROM reactions WHERE video_id IN (${ids});`);
  console.log(`Clearing existing rows for: ${videoIds.join(', ')}`);
}

const rows = [];
for (const video of VIDEOS) {
  for (let i = 0; i < video.count; i++) {
    const { x, y } = samplePin(video.hotspots);
    const sid = randomUUID();
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
