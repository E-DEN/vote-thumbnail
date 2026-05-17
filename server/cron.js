// server/cron.js
// Cloudflare Worker: RSS Cron ポーリング専用
// デプロイ: npx wrangler deploy -c wrangler-cron.toml
// ローカルテスト: npx wrangler dev -c wrangler-cron.toml --test-scheduled

export default {
  async scheduled(_event, env) {
    const batchSize = parseInt(env.CRON_BATCH_SIZE ?? '10');
    const { results } = await env.DB.prepare(
      `SELECT channel_id FROM channels WHERE inactive = 0 AND (last_checked IS NULL OR last_checked < datetime('now', '-1 hour')) ORDER BY last_checked ASC LIMIT ${batchSize}`
    ).all();
    for (const ch of results) {
      const { newVideoIds } = await fetchAndSaveRss(ch.channel_id, env).catch(() => ({ newVideoIds: [] }));
      if (newVideoIds.length > 0) {
        await detectShortsCategories(newVideoIds, env).catch(() => {});
        await fetchVideoDetails(newVideoIds, env).catch(() => {});
      }
    }
  },
};

// ---------------------------------------------------------------------------
// RSS フェッチ & DB 保存
// ---------------------------------------------------------------------------
async function fetchAndSaveRss(channelId, env) {
  const res = await fetch(
    `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`,
    { headers: { 'User-Agent': 'Mozilla/5.0' } }
  );
  if (!res.ok) return { added: 0, rssStatus: res.status, newVideoIds: [], allVideoIds: [] };
  const xml = await res.text();

  // <entry> ブロックをすべて抽出
  const entries = [...xml.matchAll(/<entry>([\/\s\S]*?)<\/entry>/g)];

  const items = [];
  for (const [, entry] of entries) {
    const videoIdMatch   = entry.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/);
    const titleMatch     = entry.match(/<title>([^<]*)<\/title>/);
    const publishedMatch = entry.match(/<published>([^<]+)<\/published>/);
    const viewsMatch     = entry.match(/<media:statistics views="(\d+)"/);
    if (!videoIdMatch) continue;
    const videoId = videoIdMatch[1];
    items.push({
      videoId,
      title:        titleMatch     ? titleMatch[1]     : '',
      publishedAt:  publishedMatch ? publishedMatch[1] : null,
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`,
      viewCount:    viewsMatch     ? parseInt(viewsMatch[1]) : 0,
    });
  }

  if (items.length === 0) return { added: 0, rssStatus: 200, newVideoIds: [], allVideoIds: [] };

  // 新規動画のみ INSERT (category は後でバックグラウンド判定)
  const placeholders = items.map(() => '?').join(',');
  const existing = await env.DB.prepare(
    `SELECT video_id FROM videos WHERE video_id IN (${placeholders})`
  ).bind(...items.map(i => i.videoId)).all();
  const existingIds = new Set(existing.results.map(r => r.video_id));
  const newItems = items.filter(i => !existingIds.has(i.videoId));

  for (const { videoId, title, publishedAt, thumbnailUrl, viewCount } of newItems) {
    await env.DB.prepare(
      `INSERT INTO videos (video_id, channel_id, title, thumbnail_url, category, published_at, view_count)
       VALUES (?, ?, ?, ?, 'videos', ?, ?)
       ON CONFLICT(video_id) DO NOTHING`
    ).bind(videoId, channelId, title, thumbnailUrl, publishedAt, viewCount).run();
  }

  // 既存動画の view_count も RSS 値で更新 (API キーなし環境向け)
  const existingItems = items.filter(i => existingIds.has(i.videoId) && i.viewCount > 0);
  let updated = 0;
  for (const { videoId, viewCount } of existingItems) {
    const r = await env.DB.prepare(
      'UPDATE videos SET view_count = ? WHERE video_id = ? AND view_count < ?'
    ).bind(viewCount, videoId, viewCount).run();
    updated += r.meta?.changes ?? 0;
  }

  // last_checked を更新
  await env.DB.prepare(
    "UPDATE channels SET last_checked = datetime('now') WHERE channel_id = ?"
  ).bind(channelId).run();

  return { added: newItems.length, updated, rssStatus: 200, newVideoIds: newItems.map(i => i.videoId), allVideoIds: items.map(i => i.videoId) };
}

// ---------------------------------------------------------------------------
// YouTube Data API v3 の playlistItems でチャンネル全動画を取得・保存
// RSSは最新15件のみなので、APIキーがある場合はこちらで全件補完する
// Shorts/Live専用プレイリストも取得してカテゴリを正確に設定する
// ---------------------------------------------------------------------------
async function _fetchPlaylistVideoIds(playlistId, apiKey) {
  const ids = new Set();
  let pageToken = '';
  try {
    do {
      let url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&playlistId=${playlistId}&maxResults=50&key=${apiKey}`;
      if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
      const res = await fetch(url);
      if (!res.ok) break;
      const data = await res.json();
      for (const item of (data.items ?? [])) {
        const videoId = item.snippet?.resourceId?.videoId;
        if (videoId && videoId.length === 11) ids.add(videoId);
      }
      pageToken = data.nextPageToken ?? '';
    } while (pageToken);
  } catch { /* サイレント失敗 */ }
  return ids;
}

async function fetchAllVideosViaApi(channelId, env) {
  if (!env.YOUTUBE_API_KEY) return { ok: true, videoIds: [] };
  const suffix = channelId.slice(2);
  // uploads / shorts / live の各プレイリストを並行取得
  const [allIds, shortsIds, liveIds] = await Promise.all([
    _fetchPlaylistVideoIds('UU' + suffix, env.YOUTUBE_API_KEY),
    _fetchPlaylistVideoIds('UUSH' + suffix, env.YOUTUBE_API_KEY),
    _fetchPlaylistVideoIds('UULV' + suffix, env.YOUTUBE_API_KEY),
  ]);
  if (allIds.size === 0) {
    // apiKeyError かどうかは uploads プレイリストが空の場合で区別できないためスキップ
    return { ok: true, videoIds: [] };
  }

  const allItems = [...allIds].map(videoId => ({
    videoId,
    category: liveIds.has(videoId) ? 'live' : shortsIds.has(videoId) ? 'shorts' : 'videos',
  }));

  // 既存チェック (D1 バインド上限100件ずつ)
  const CHUNK = 100;
  const existingIds = new Set();
  for (let i = 0; i < allItems.length; i += CHUNK) {
    const chunk = allItems.slice(i, i + CHUNK);
    const placeholders = chunk.map(() => '?').join(',');
    const rows = await env.DB.prepare(
      `SELECT video_id FROM videos WHERE video_id IN (${placeholders})`
    ).bind(...chunk.map(x => x.videoId)).all();
    rows.results.forEach(r => existingIds.add(r.video_id));
  }
  const newItems = allItems.filter(i => !existingIds.has(i.videoId));

  for (const { videoId, category } of newItems) {
    await env.DB.prepare(
      `INSERT INTO videos (video_id, channel_id, title, thumbnail_url, category, published_at)
       VALUES (?, ?, '', ?, ?, NULL)
       ON CONFLICT(video_id) DO NOTHING`
    ).bind(videoId, channelId, `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`, category).run();
  }

  // 既存動画のカテゴリも更新 (shorts/live の場合のみ上書き)
  for (const { videoId, category } of allItems.filter(i => existingIds.has(i.videoId) && i.category !== 'videos')) {
    await env.DB.prepare(
      "UPDATE videos SET category = ? WHERE video_id = ? AND category = 'videos'"
    ).bind(category, videoId).run();
  }

  return { ok: true, videoIds: allItems.map(i => i.videoId) };
}

// ---------------------------------------------------------------------------
// カテゴリ判定: duration=0 かつ category='videos' の動画を分類
// /shorts/{id} へのリクエスト1本でショート・ライブ・通常動画を判定
//   - ショート  → /shorts/ のURLのまま
//   - 通常/ライブ → /watch?v= にリダイレクト → HTMLでライブ判定
// ctx.waitUntil から呼ぶ (レスポンスをブロックしない)
// ---------------------------------------------------------------------------
async function detectShortsCategories(videoIds, env, { updateDuration = true } = {}) {
  // 一度に処理する上限 (subrequest制限の考慮: 無料50件/回)
  const batch = videoIds.slice(0, 20);
  await Promise.allSettled(batch.map(async videoId => {
    try {
      const r = await fetch(`https://www.youtube.com/shorts/${videoId}`, {
        redirect: 'follow',
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      let category;
      if (r.url.includes('/shorts/')) {
        category = 'shorts';
      } else {
        // リダイレクト先の watch ページ HTML でライブ判定
        const html = await r.text();
        const isLive = /"isLiveContent":true/.test(html) || /"liveBroadcastDetails"/.test(html);
        category = isLive ? 'live' : 'videos';
      }
      if (updateDuration) {
        await env.DB.prepare(
          'UPDATE videos SET category = ?, duration = -1 WHERE video_id = ?'
        ).bind(category, videoId).run();
      } else {
        await env.DB.prepare(
          'UPDATE videos SET category = ? WHERE video_id = ?'
        ).bind(category, videoId).run();
      }
    } catch { /* サイレント失敗: 次回アクセス時に再試行 */ }
  }));
}

// ---------------------------------------------------------------------------
// YouTube Data API v3 で視聴回数・再生時間を取得して DB に保存
// YOUTUBE_API_KEY が未設定の場合は無音でスキップ
// ---------------------------------------------------------------------------
function parseISODuration(iso) {
  // PT1H2M3S / PT30S / PT5M などを秒に変換
  const m = (iso || '').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0) * 3600) + (parseInt(m[2] || 0) * 60) + parseInt(m[3] || 0);
}

async function validateApiKey(env) {
  if (!env.YOUTUBE_API_KEY) return { ok: true };
  const res = await fetch(`https://www.googleapis.com/youtube/v3/videos?part=id&id=dQw4w9WgXcQ&key=${env.YOUTUBE_API_KEY}`);
  if (res.status === 400 || res.status === 403) return { ok: false, apiKeyError: true };
  return { ok: true };
}

async function fetchVideoDetails(videoIds, env) {
  if (!env.YOUTUBE_API_KEY || videoIds.length === 0) return { ok: true };
  // Data API は最大50件/リクエスト
  const CHUNK = 50;
  for (let i = 0; i < videoIds.length; i += CHUNK) {
    const chunk = videoIds.slice(i, i + CHUNK);
    try {
      const apiUrl = `https://www.googleapis.com/youtube/v3/videos?part=statistics%2CcontentDetails%2Csnippet&id=${chunk.join(',')}&key=${env.YOUTUBE_API_KEY}`;
      const res = await fetch(apiUrl);
      if (!res.ok) {
        if (res.status === 400 || res.status === 403) return { ok: false, apiKeyError: true };
        continue;
      }
      const data = await res.json();
      for (const item of (data.items ?? [])) {
        const viewCount    = parseInt(item.statistics?.viewCount ?? 0);
        const duration     = parseISODuration(item.contentDetails?.duration);
        const title        = String(item.snippet?.title ?? '').slice(0, 500);
        const publishedAt  = item.snippet?.publishedAt ?? null;
        const thumbnailUrl = (
          item.snippet?.thumbnails?.maxres?.url ||
          item.snippet?.thumbnails?.high?.url ||
          item.snippet?.thumbnails?.medium?.url ||
          `https://i.ytimg.com/vi/${item.id}/maxresdefault.jpg`
        );
        // liveBroadcastContent でライブ判定 (カテゴリはプレイリスト判定優先のため live のみ上書き)
        const lbc = item.snippet?.liveBroadcastContent ?? 'none';
        if (lbc === 'live' || lbc === 'upcoming') {
          await env.DB.prepare(
            "UPDATE videos SET title = ?, thumbnail_url = ?, published_at = ?, view_count = ?, duration = ?, category = 'live' WHERE video_id = ?"
          ).bind(title, thumbnailUrl, publishedAt, viewCount, duration, item.id).run();
        } else {
          await env.DB.prepare(
            'UPDATE videos SET title = ?, thumbnail_url = ?, published_at = ?, view_count = ?, duration = ? WHERE video_id = ?'
          ).bind(title, thumbnailUrl, publishedAt, viewCount, duration, item.id).run();
        }
      }
    } catch { /* API障害時はスキップ */ }
  }
  return { ok: true };
}

