#!/usr/bin/env node
// db/import.js
// ブラウザの「DBエクスポート」で保存した JSON を SQLite に投入する
//
// 使い方:
//   node db/import.js <export.json> [--db db/vote] [--reset]
//
// オプション:
//   --db <path>   DBファイルのパス (デフォルト: db/vote)
//   --reset       投入前に全テーブルを DELETE する

'use strict';

const fs           = require('fs');
const path         = require('path');
const { execSync } = require('child_process');

// --- 引数解析 ---
const args   = process.argv.slice(2);
const jsonPath = args.find(a => !a.startsWith('--'));
const dbPath   = (args[args.indexOf('--db') + 1]) ?? 'db/vote';
const doReset  = args.includes('--reset');

if (!jsonPath) {
  console.error('Usage: node db/import.js <export.json> [--db db/vote] [--reset]');
  process.exit(1);
}

// --- JSONロード ---
const raw  = fs.readFileSync(path.resolve(jsonPath), 'utf8');
const data = JSON.parse(raw);

if (!Array.isArray(data.channels) || !Array.isArray(data.videos)) {
  console.error('JSON の形式が正しくありません (channels / videos 配列が必要)');
  process.exit(1);
}

// --- SQL エスケープ ---
function esc(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number')         return String(v);
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// --- SQL 組み立て ---
const lines = [];

if (doReset) {
  lines.push(
    'DELETE FROM daily_votes;',
    'DELETE FROM votes;',
    'DELETE FROM videos;',
    'DELETE FROM channels;',
  );
}

// channels
for (const ch of data.channels) {
  lines.push(
    `INSERT OR IGNORE INTO channels (channel_id, handle, title, icon_url, last_checked, last_accessed) VALUES (` +
    `${esc(ch.channel_id)}, ${esc(ch.handle)}, ${esc(ch.title)}, ${esc(ch.icon_url)}, ` +
    `${esc(ch.last_checked ?? new Date().toISOString())}, ${esc(ch.last_accessed ?? new Date().toISOString())});`
  );
}

// videos
for (const v of data.videos) {
  lines.push(
    `INSERT OR REPLACE INTO videos ` +
    `(video_id, channel_id, title, thumbnail_url, category, duration, view_count, published_at, ` +
    ` rating, rd, volatility, wins, battles, rating_updated_at) VALUES (` +
    `${esc(v.video_id)}, ${esc(v.channel_id)}, ${esc(v.title)}, ${esc(v.thumbnail_url)}, ` +
    `${esc(v.category ?? 'videos')}, ${esc(v.duration ?? 0)}, ${esc(v.view_count ?? 0)}, ${esc(v.published_at)}, ` +
    `${esc(v.rating ?? 1500)}, ${esc(v.rd ?? 350)}, ${esc(v.volatility ?? 0.06)}, ` +
    `${esc(v.wins ?? 0)}, ${esc(v.battles ?? 0)}, ${esc(v.rating_updated_at ?? null)});`
  );
}

const sql = lines.join('\n');

// --- sqlite3 に流す ---
try {
  execSync(`sqlite3 ${dbPath}`, { input: sql, stdio: ['pipe', 'inherit', 'inherit'] });
} catch (e) {
  console.error('sqlite3 の実行に失敗しました:', e.message);
  process.exit(1);
}

console.log(`完了: channels ${data.channels.length} 件, videos ${data.videos.length} 件 -> ${dbPath}`);
