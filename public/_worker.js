// public/_worker.js
// Cloudflare Pages Worker - fetch ハンドラ専用
// Cron (RSS ポーリング) は server/cron.js + wrangler-cron.toml の別 Worker で運用
// ローカル開発: npx wrangler pages dev public
// 本番デプロイ: npx wrangler pages deploy public
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API ルーティング
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url, ctx);
    }

    // 静的ファイルは Pages アセットストアから配信する
    return env.ASSETS.fetch(request);
  },

};

// ---------------------------------------------------------------------------
// API ルーター
// ---------------------------------------------------------------------------
async function handleApi(request, env, url, ctx) {
  const method = request.method;
  const path   = url.pathname.replace('/api', '');

  // CORS
  const allowedOrigin = env.ALLOWED_ORIGIN ?? '*';
  const cors = {
    'Access-Control-Allow-Origin':  allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-YouTube-Api-Key, X-RSS-Only',
  };
  if (method === 'OPTIONS') return new Response(null, { headers: cors });

  // クライアントから渡された API キーを優先使用 / X-RSS-Only: 1 なら API キー無効化
  const clientApiKey = request.headers.get('X-YouTube-Api-Key');
  const rssOnly = request.headers.get('X-RSS-Only') === '1';
  const effectiveEnv = rssOnly
    ? { ...env, YOUTUBE_API_KEY: null }
    : clientApiKey ? { ...env, YOUTUBE_API_KEY: clientApiKey } : env;

  function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', ...cors },
    });
  }
  function err(msg, status = 400) {
    return json({ error: msg }, status);
  }

  try {
    // --- POST /api/channels ---
    if (method === 'POST' && path === '/channels') {
      const body = await request.json().catch(() => null);

      // 動画 URL から channel を解決する場合
      if (body?.videoId && !body?.handle) {
        const videoId = String(body.videoId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 11);
        if (videoId.length !== 11) return err('video ID が不正です');
        const vRes = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (!vRes.ok) return err('動画が見つかりません', 404);
        const vHtml = await vRes.text();
        const baseUrlMatch = vHtml.match(/"canonicalBaseUrl":"(\/@[^"]+)"/);
        if (!baseUrlMatch) return err('チャンネル情報の取得に失敗しました', 502);
        const rawPath = baseUrlMatch[1].replace(/^\//, '');
        try { body.handle = decodeURIComponent(rawPath); } catch { body.handle = rawPath; }
      }

      const handle = body?.handle?.trim();
      if (!handle) return err('handle は必須です');

      // @handle を正規化: デコード済み Unicode 文字列として保持
      let channelId = null;
      const rawName = handle.startsWith('@') ? handle.slice(1) : handle;
      let decodedName;
      try { decodedName = decodeURIComponent(rawName); } catch { decodedName = rawName; }
      const channelHandle = '@' + decodedName;
      // フェッチ用: 非ASCII は再エンコード
      const fetchPath = '@' + encodeURIComponent(decodedName);

      // DB に既存チャンネルがあれば即返し
      const existing = await env.DB.prepare(
        'SELECT channel_id, handle, title, icon_url FROM channels WHERE handle = ? AND inactive = 0'
      ).bind(channelHandle).first();
      if (existing) return json({ ok: true, channel: existing, cached: true });

      // youtube.com/@handle をフェッチしてチャンネルIDを取得
      const pageRes = await fetch(`https://www.youtube.com/${fetchPath}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!pageRes.ok) return err('チャンネルが見つかりません', 404);
      const html = await pageRes.text();

      // channel_id を HTML から抽出
      // canonical URL が最も確実 (例: <link rel="canonical" href="https://www.youtube.com/channel/UCxxxx"/>)
      const canonicalMatch = html.match(/rel="canonical"\s+href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/);
      const externalIdMatch = html.match(/"externalId":"(UC[\w-]{22})"/);
      const cidMatch = canonicalMatch || externalIdMatch;
      if (!cidMatch) return err('チャンネルIDの取得に失敗しました', 502);
      channelId = cidMatch[1];

      // タイトル・アイコンを抽出
      const titleMatch = html.match(/<title>([^<]+)<\/title>/);
      const iconMatch  = html.match(/"avatar":\{"thumbnails":\[\{"url":"([^"]+)"/);
      const title   = titleMatch ? titleMatch[1].replace(' - YouTube', '').trim() : channelHandle;
      const iconUrl = iconMatch  ? iconMatch[1] : '';

      // channels に保存
      await env.DB.prepare(
        `INSERT INTO channels (channel_id, handle, title, icon_url, last_checked, last_accessed)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
         ON CONFLICT(channel_id) DO UPDATE SET handle=excluded.handle, title=excluded.title, icon_url=excluded.icon_url, last_accessed=datetime('now')`
      ).bind(channelId, channelHandle, title, iconUrl).run();

      // RSS から最新15件を即時取得 → カテゴリ判定・視聴回数取得も同期実行
      const { newVideoIds } = await fetchAndSaveRss(channelId, effectiveEnv);
      if (newVideoIds.length > 0) {
        await detectShortsCategories(newVideoIds, effectiveEnv);
        await fetchVideoDetails(newVideoIds, effectiveEnv);
      }

      const channel = { channel_id: channelId, handle: channelHandle, title, icon_url: iconUrl };
      return json({ ok: true, channel, cached: false, videoCount: newVideoIds.length });
    }

    // --- GET /api/channels ---
    if (method === 'GET' && path === '/channels') {
      const rows = await env.DB.prepare(
        'SELECT channel_id, handle, title, icon_url FROM channels WHERE inactive = 0 ORDER BY title'
      ).all();
      return json(rows.results);
    }

    // --- DELETE /api/channels/:channelId ---
    const mDelete = path.match(/^\/channels\/(UC[\w-]{22})$/);
    if (method === 'DELETE' && mDelete) {
      const channelId = mDelete[1];
      await env.DB.prepare(
        "UPDATE channels SET inactive = 1 WHERE channel_id = ?"
      ).bind(channelId).run();
      return json({ ok: true });
    }

    // --- POST /api/channels/:channelId/refresh ---
    const mRefresh = path.match(/^\/channels\/(UC[\w-]{22})\/refresh$/);
    if (method === 'POST' && mRefresh) {
      const channelId = mRefresh[1];
      let exists = await env.DB.prepare(
        'SELECT channel_id FROM channels WHERE channel_id = ? AND inactive = 0'
      ).bind(channelId).first();
      if (!exists) {
        // チャンネルがDBにない場合、YouTubeページから情報を取得して自動登録する
        const pageRes = await fetch(`https://www.youtube.com/channel/${channelId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0' },
        });
        if (!pageRes.ok) return err('チャンネルが見つかりません', 404);
        const html = await pageRes.text();
        const titleMatch  = html.match(/<title>([^<]+)<\/title>/);
        const iconMatch   = html.match(/"avatar":\{"thumbnails":\[\{"url":"([^"]+)"/);
        const handleMatch = html.match(/"canonicalBaseUrl":"(\/@[^"]+)"/);
        const title  = titleMatch  ? titleMatch[1].replace(' - YouTube', '').trim() : '';
        const iconUrl = iconMatch  ? iconMatch[1] : '';
        const handle  = handleMatch ? handleMatch[1].replace(/^\//, '') : '';
        await env.DB.prepare(
          `INSERT INTO channels (channel_id, handle, title, icon_url, last_checked, last_accessed)
           VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(channel_id) DO UPDATE SET last_accessed=datetime('now')`
        ).bind(channelId, handle, title, iconUrl).run();
        exists = { channel_id: channelId };
      }
      const { added, updated: rssUpdated, rssStatus, newVideoIds, allVideoIds } = await fetchAndSaveRss(channelId, effectiveEnv);
      // APIキーがあれば全動画をPlaylist APIで取得・補完する (RSSは最新15件のみ)
      let apiAllVideoIds = allVideoIds;
      if (effectiveEnv.YOUTUBE_API_KEY) {
        const apiResult = await fetchAllVideosViaApi(channelId, effectiveEnv);
        if (apiResult?.apiKeyError) return json({ ok: true, added, rssStatus, apiKeyError: true });
        if (apiResult.videoIds.length > 0) apiAllVideoIds = apiResult.videoIds;
      }
      // 新規動画 + 既存の未判定動画 (duration=0) をまとめてカテゴリ判定
      const undetected = await env.DB.prepare(
        "SELECT video_id FROM videos WHERE channel_id = ? AND duration = 0 LIMIT 20"
      ).bind(channelId).all();
      const toDetect = [...new Set([...newVideoIds, ...undetected.results.map(r => r.video_id)])];
      if (toDetect.length > 0) {
        await detectShortsCategories(toDetect, effectiveEnv);
      }
      // APIキーがあれば全動画のview_count/durationを更新
      const toUpdate = [...new Set([...apiAllVideoIds, ...toDetect])];
      if (toUpdate.length > 0) {
        const detailResult = await fetchVideoDetails(toUpdate, effectiveEnv);
        if (detailResult?.apiKeyError) return json({ ok: true, added, rssStatus, apiKeyError: true });
      } else if (clientApiKey) {
        const validResult = await validateApiKey(effectiveEnv);
        if (validResult?.apiKeyError) return json({ ok: true, added, rssStatus, apiKeyError: true });
      }
      // duration が短くカテゴリが videos のまま残っている動画をURL判定で再確認
      // (UUSHプレイリストに入っていないショートの救済)
      const shortCandidates = await env.DB.prepare(
        "SELECT video_id FROM videos WHERE channel_id = ? AND category = 'videos' AND duration > 0 AND duration <= 180 LIMIT 40"
      ).bind(channelId).all();
      if (shortCandidates.results.length > 0) {
        await detectShortsCategories(shortCandidates.results.map(r => r.video_id), effectiveEnv, { updateDuration: false });
      }
      // DB上の総動画数を返す
      const countRow = await env.DB.prepare(
        'SELECT COUNT(*) AS cnt FROM videos WHERE channel_id = ?'
      ).bind(channelId).first();
      return json({ ok: true, added, updated: rssOnly ? rssUpdated : 0, rssStatus, total: countRow?.cnt ?? 0 });
    }

    // --- POST /api/channels/:channelId/videos/batch ---
    // クライアントが YouTube API で取得した全動画データを一括保存する
    const mBatch = path.match(/^\/channels\/(UC[\w-]{22})\/videos\/batch$/);
    if (method === 'POST' && mBatch) {
      const channelId = mBatch[1];
      const body = await request.json().catch(() => null);
      const videos = Array.isArray(body?.videos) ? body.videos : [];
      if (videos.length === 0) return json({ ok: true, upserted: 0 });

      const CHUNK = 50;
      let upserted = 0;
      for (let i = 0; i < videos.length; i += CHUNK) {
        const chunk = videos.slice(i, i + CHUNK);
        const stmts = chunk.map(v => {
          const videoId   = String(v.id || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 11);
          if (videoId.length !== 11) return null;
          const title      = String(v.title      || '').slice(0, 500);
          const thumb      = String(v.thumb      || '').slice(0, 1000);
          const category   = ['videos', 'shorts', 'live'].includes(v.category) ? v.category : 'videos';
          const duration   = parseInt(v.duration)   || 0;
          const viewCount  = parseInt(v.viewCount)  || 0;
          const published  = String(v.publishedAt  || '').slice(0, 30);
          return env.DB.prepare(
            `INSERT INTO videos (video_id, channel_id, title, thumbnail_url, category, duration, view_count, published_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(video_id) DO UPDATE SET
               title          = excluded.title,
               thumbnail_url  = excluded.thumbnail_url,
               category       = excluded.category,
               duration       = excluded.duration,
               view_count     = excluded.view_count,
               published_at   = excluded.published_at`
          ).bind(videoId, channelId, title, thumb, category, duration, viewCount, published);
        }).filter(Boolean);
        if (stmts.length > 0) {
          await env.DB.batch(stmts);
          upserted += stmts.length;
        }
      }
      return json({ ok: true, upserted });
    }

    // --- GET /api/channels/:channelId/videos ---
    // category パラメータ省略時は全カテゴリを返す
    const mVideos = path.match(/^\/channels\/([\w.-]+)\/videos$/);
    if (method === 'GET' && mVideos) {
      const channelId = mVideos[1];
      const category  = url.searchParams.get('category');
      const videosSql = category
        ? 'SELECT video_id, title, thumbnail_url, category, duration, view_count, published_at, rating, rd, volatility, wins, battles FROM videos WHERE channel_id = ? AND category = ? ORDER BY rating DESC, view_count DESC, published_at DESC'
        : 'SELECT video_id, title, thumbnail_url, category, duration, view_count, published_at, rating, rd, volatility, wins, battles FROM videos WHERE channel_id = ? ORDER BY rating DESC, view_count DESC, published_at DESC';
      const videosStmt = category
        ? env.DB.prepare(videosSql).bind(channelId, category)
        : env.DB.prepare(videosSql).bind(channelId);
      const [rows] = await Promise.all([
        videosStmt.all(),
        env.DB.prepare(
          "UPDATE channels SET last_accessed = datetime('now') WHERE channel_id = ?"
        ).bind(channelId).run(),
      ]);
      // duration=0 の動画 (RSS経由・未判定) をバックグラウンドでカテゴリ判定
      const unchecked = rows.results.filter(v => v.duration === 0 && v.category === 'videos');
      if (unchecked.length > 0) {
        ctx.waitUntil((async () => {
          await detectShortsCategories(unchecked.map(v => v.video_id), env);
          await fetchVideoDetails(unchecked.map(v => v.video_id), env);
        })());
      }
      return json(rows.results);
    }

    // --- POST /api/vote ---
    if (method === 'POST' && path === '/vote') {
      const body = await request.json().catch(() => null);
      if (!body?.winner_id || !body?.loser_id || !body?.channel_id) {
        return err('winner_id, loser_id, channel_id は必須です');
      }

      // レート制限チェック (KV)
      const ip       = request.headers.get('CF-Connecting-IP') ?? 'unknown';
      const today    = new Date().toISOString().slice(0, 10);
      const kvKey    = `vote:${ip}:${today}`;  // チャンネルをまたいでサイト全体で集計
      const countStr = await env.RATE_LIMIT_KV.get(kvKey);
      const count    = parseInt(countStr ?? '0');
      const DAILY_LIMIT = 200;
      if (count >= DAILY_LIMIT) {
        return json({ ok: false, limited: true });
      }

      // 動画レーティング取得
      const [w, l] = await Promise.all([
        env.DB.prepare('SELECT rating, rd, volatility FROM videos WHERE video_id = ?').bind(body.winner_id).first(),
        env.DB.prepare('SELECT rating, rd, volatility FROM videos WHERE video_id = ?').bind(body.loser_id).first(),
      ]);
      if (!w || !l) return err('動画が見つかりません', 404);

      // Glicko-2 更新
      const G2_TAU   = 0.5;
      const G2_SCALE = 173.7178;
      const newW = g2Update(w, l, 1, G2_TAU, G2_SCALE);
      const newL = g2Update(l, w, 0, G2_TAU, G2_SCALE);

      const now = new Date().toISOString();
      await env.DB.batch([
        env.DB.prepare(
          'UPDATE videos SET rating=?, rd=?, volatility=?, wins=wins+1, battles=battles+1, rating_updated_at=? WHERE video_id=?'
        ).bind(newW.rating, newW.rd, newW.volatility, now, body.winner_id),
        env.DB.prepare(
          'UPDATE videos SET rating=?, rd=?, volatility=?, battles=battles+1, rating_updated_at=? WHERE video_id=?'
        ).bind(newL.rating, newL.rd, newL.volatility, now, body.loser_id),
      ]);

      // KV カウントアップ (TTL: 翌日0時まで)
      const secondsToMidnight = 86400 - (Math.floor(Date.now() / 1000) % 86400);
      await env.RATE_LIMIT_KV.put(kvKey, String(count + 1), { expirationTtl: secondsToMidnight + 3600 });

      return json({ ok: true, winner: newW, loser: newL });
    }

    // --- GET /api/pins/my ---
    if (method === 'GET' && path === '/pins/my') {
      const sessionId = url.searchParams.get('session') || '';
      if (!sessionId) return json({ pins: [] });
      const rows = await env.DB.prepare(
        'SELECT video_id, x, y FROM reactions WHERE session_id = ?'
      ).bind(sessionId).all();
      return json({ pins: rows.results.map(function(r) { return { video_id: r.video_id, x: r.x, y: r.y }; }) });
    }

    // --- GET /api/pins/:videoId/seeds ---
    const mPinSeeds = path.match(/^\/pins\/([\w-]{11})\/seeds$/);
    if (method === 'GET' && mPinSeeds) {
      const videoId = mPinSeeds[1];
      const sessionId = url.searchParams.get('session') || '';
      const rows = await env.DB.prepare(
        'SELECT x, y, session_id FROM reactions WHERE video_id = ? ORDER BY updated_at DESC LIMIT 1000'
      ).bind(videoId).all();
      const allPins = rows.results;
      // 自分のピンを別途返却し、pins からは除外（startReactionsLoop で重複表示しないため）
      const myRow = sessionId ? allPins.find(function(r) { return r.session_id === sessionId; }) : null;
      const my_pin = myRow ? { x: myRow.x, y: myRow.y } : null;
      const pins = allPins
        .filter(function(r) { return !sessionId || r.session_id !== sessionId; })
        .map(function(r) { return { x: r.x, y: r.y }; });
      // seeds はヒートマップ用に全ピン（自分含む）から計算
      const allCoords = allPins.map(function(r) { return { x: r.x, y: r.y }; });
      return json({ pins, seeds: aggregateToSeeds(allCoords), my_pin });
    }

    // --- POST /api/pins ---
    if (method === 'POST' && path === '/pins') {
      const body = await request.json().catch(() => null);
      if (!body?.video_id || !body?.session_id || body.x == null || body.y == null) {
        return err('video_id, session_id, x, y は必須です');
      }
      const x = parseFloat(body.x);
      const y = parseFloat(body.y);
      if (x < 0 || x > 1 || y < 0 || y > 1) return err('x, y は 0.0–1.0 の範囲です');
      // session_id は最大64文字に制限
      const sessionId = String(body.session_id).slice(0, 64);
      const videoId   = String(body.video_id).slice(0, 20);
      await env.DB.prepare(
        `INSERT INTO reactions (video_id, session_id, x, y, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'))
         ON CONFLICT(video_id, session_id) DO UPDATE SET x = excluded.x, y = excluded.y, updated_at = excluded.updated_at`
      ).bind(videoId, sessionId, x, y).run();
      return json({ ok: true });
    }

    return err('Not Found', 404);
  } catch (e) {
    console.error(e);
    return err('Internal Server Error', 500);
  }
}

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

// ---------------------------------------------------------------------------
// Glicko-2 (app.js と同じアルゴリズム)
// ---------------------------------------------------------------------------
function g2Update(player, opponent, score, TAU, SCALE) {
  const mu    = (player.rating - 1500) / SCALE;
  const phi   = player.rd / SCALE;
  const sigma = player.volatility;
  const muJ   = (opponent.rating - 1500) / SCALE;
  const phiJ  = opponent.rd / SCALE;

  const gPhiJ = 1 / Math.sqrt(1 + 3 * phiJ * phiJ / (Math.PI * Math.PI));
  const E     = 1 / (1 + Math.exp(-gPhiJ * (mu - muJ)));
  const v     = 1 / (gPhiJ * gPhiJ * E * (1 - E));
  const delta = v * gPhiJ * (score - E);

  // σ 更新 (Illinois algorithm)
  const a  = Math.log(sigma * sigma);
  const f  = (x) => {
    const ex  = Math.exp(x);
    const d2  = phi * phi + v + ex;
    return ex * (delta * delta - d2) / (2 * d2 * d2) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B = delta * delta > phi * phi + v
    ? Math.log(delta * delta - phi * phi - v)
    : a - TAU;
  let fA = f(A), fB = f(B);
  const EPS = 1e-6;
  for (let i = 0; i < 100 && Math.abs(B - A) > EPS; i++) {
    const C = A + (A - B) * fA / (fB - fA);
    const fC = f(C);
    if (fC * fB < 0) { A = B; fA = fB; } else { fA /= 2; }
    B = C; fB = fC;
  }
  const sigmaNew = Math.exp(A / 2);
  const phiStar  = Math.sqrt(phi * phi + sigmaNew * sigmaNew);
  const phiNew   = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew    = mu + phiNew * phiNew * gPhiJ * (score - E);

  return {
    rating:     muNew * SCALE + 1500,
    rd:         phiNew * SCALE,
    volatility: sigmaNew,
  };
}

// ---------------------------------------------------------------------------
// pin を 10×10 グリッドでクラスタリングし、密度付きシードを返す
// ---------------------------------------------------------------------------
function aggregateToSeeds(pins) {
  if (!pins || pins.length === 0) return [];
  const GRID = 10;
  const cells = new Map();
  for (const p of pins) {
    const gx  = Math.min(GRID - 1, Math.floor(p.x * GRID));
    const gy  = Math.min(GRID - 1, Math.floor(p.y * GRID));
    const key = `${gx},${gy}`;
    const c   = cells.get(key) || { sumX: 0, sumY: 0, count: 0 };
    c.sumX += p.x;
    c.sumY += p.y;
    c.count++;
    cells.set(key, c);
  }
  const arr = Array.from(cells.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  if (arr.length === 0) return [];
  const maxCount = arr[0].count;
  return arr.map(c => ({
    x:       +(c.sumX / c.count).toFixed(4),
    y:       +(c.sumY / c.count).toFixed(4),
    density: +(c.count / maxCount).toFixed(3),
  }));
}
