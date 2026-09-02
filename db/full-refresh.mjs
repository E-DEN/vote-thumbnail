/**
 * full-refresh.mjs
 * D1 に登録されている全アクティブチャンネルを Worker 経由で更新する。
 * チャンネル単位の再取得と同じ処理を使うため、SQL は生成しない。
 *
 * 実行:
 *   node db/full-refresh.mjs
 */

import { execSync } from 'child_process';

const BASE_URL = 'https://vote-thumbnail.pages.dev';
const WAIT_MS = Number(process.env.REFRESH_INTERVAL_MS || 1000);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function getActiveChannelIds() {
  const result = JSON.parse(
    execSync(
      'npx wrangler d1 execute vote-thumbnail --remote --json --command "SELECT channel_id FROM channels WHERE inactive = 0 ORDER BY channel_id"',
      { encoding: 'utf8', maxBuffer: 1024 * 1024 }
    )
  );
  return result[0]?.results?.map(row => row.channel_id) ?? [];
}

const channelIds = getActiveChannelIds();
console.log(`対象チャンネル: ${channelIds.length} 件`);
console.log(`更新先: ${BASE_URL}`);

let succeeded = 0;
let failed = 0;

for (const [index, channelId] of channelIds.entries()) {
  const url = `${BASE_URL}/api/channels/${channelId}/refresh`;
  process.stdout.write(`[${index + 1}/${channelIds.length}] ${channelId} 更新中... `);
  try {
    const response = await fetch(url, { method: 'POST' });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body.apiKeyError) {
      failed++;
      console.log(`失敗 (${response.status})`);
      continue;
    }
    succeeded++;
    console.log(`完了 (追加${body.added ?? 0}件 / 合計${body.total ?? 0}件)`);
  } catch (error) {
    failed++;
    console.log(`失敗 (${error.message})`);
  }
  if (index < channelIds.length - 1) await sleep(WAIT_MS);
}

console.log(`\n更新完了: 成功${succeeded}件 / 失敗${failed}件`);
if (failed > 0) process.exitCode = 1;
