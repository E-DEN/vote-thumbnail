// worker/index.js
// Cloudflare Worker エントリーポイント
// ローカル開発: npx wrangler dev
// 本番デプロイ: npx wrangler deploy

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API ルーティング
    if (url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url, ctx);
    }

    // 静的ファイルは wrangler.toml の [assets] が配信する
    return new Response('Not Found', { status: 404 });
  },

  // Cron Trigger: アクティブチャンネルの RSS をポーリングして新着動画を追加
  // wrangler.toml の [triggers] crons で設定
  async scheduled(_event, env) {
    const { results } = await env.DB.prepare(
      "SELECT channel_id FROM channels WHERE inactive = 0 AND last_accessed > datetime('now', '-7 days')"
    ).all();
    for (const ch of results) {
      await fetchAndSaveRss(ch.channel_id, env).catch(() => {});
    }
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
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (method === 'OPTIONS') return new Response(null, { headers: cors });

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
      const handle = body?.handle?.trim();
      if (!handle) return err('handle は必須です');

      // @handle または channel_id (UCxxxx) を受け付ける
      let channelId = null;
      let channelHandle = handle.startsWith('@') ? handle : '@' + handle;

      // DB に既存チャンネルがあれば即返し
      const existing = await env.DB.prepare(
        'SELECT channel_id, handle, title, icon_url FROM channels WHERE handle = ? AND inactive = 0'
      ).bind(channelHandle).first();
      if (existing) return json({ ok: true, channel: existing, cached: true });

      // youtube.com/@handle をフェッチしてチャンネルIDを取得
      const pageRes = await fetch(`https://www.youtube.com/${channelHandle}`, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!pageRes.ok) return err('チャンネルが見つかりません', 404);
      const html = await pageRes.text();

      // channel_id を HTML から抽出 (UCで始まる24文字)
      const cidMatch = html.match(/"channelId":"(UC[\w-]{22})"/);
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

      // RSS から最新15件を即時取得（レスポンスを遅らせない範囲で実行）
      await fetchAndSaveRss(channelId, env);

      const channel = { channel_id: channelId, handle: channelHandle, title, icon_url: iconUrl };
      return json({ ok: true, channel, cached: false });
    }

    // --- GET /api/channels ---
    if (method === 'GET' && path === '/channels') {
      const rows = await env.DB.prepare(
        'SELECT channel_id, handle, title, icon_url FROM channels WHERE inactive = 0 ORDER BY title'
      ).all();
      return json(rows.results);
    }

    // --- GET /api/channels/:channelId/videos ---
    // category パラメータ省略時は全カテゴリを返す
    const mVideos = path.match(/^\/channels\/([\w.-]+)\/videos$/);
    if (method === 'GET' && mVideos) {
      const channelId = mVideos[1];
      const category  = url.searchParams.get('category');
      const videosSql = category
        ? 'SELECT video_id, title, thumbnail_url, category, duration, view_count, published_at, rating, rd, volatility, wins, battles FROM videos WHERE channel_id = ? AND category = ? ORDER BY rating DESC'
        : 'SELECT video_id, title, thumbnail_url, category, duration, view_count, published_at, rating, rd, volatility, wins, battles FROM videos WHERE channel_id = ? ORDER BY rating DESC';
      const videosStmt = category
        ? env.DB.prepare(videosSql).bind(channelId, category)
        : env.DB.prepare(videosSql).bind(channelId);
      const [rows] = await Promise.all([
        videosStmt.all(),
        // ユーザーがチャンネルを選んだ瞬間に last_accessed を更新 (cron の対象判定に使用)
        env.DB.prepare(
          "UPDATE channels SET last_accessed = datetime('now') WHERE channel_id = ?"
        ).bind(channelId).run(),
      ]);
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

    // --- GET /api/pins/:videoId/seeds ---
    const mPinSeeds = path.match(/^\/pins\/([\w-]{11})\/seeds$/);
    if (method === 'GET' && mPinSeeds) {
      const videoId = mPinSeeds[1];
      const rows = await env.DB.prepare(
        'SELECT x, y FROM reactions WHERE video_id = ?'
      ).bind(videoId).all();
      return json({ seeds: aggregateToSeeds(rows.results) });
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
  if (!res.ok) return;
  const xml = await res.text();

  // <entry> ブロックをすべて抽出
  const entries = [...xml.matchAll(/<entry>([\/\s\S]*?)<\/entry>/g)];
  const now = new Date().toISOString();

  for (const [, entry] of entries) {
    const videoIdMatch     = entry.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/);
    const titleMatch       = entry.match(/<title>([^<]*)<\/title>/);
    const publishedMatch   = entry.match(/<published>([^<]+)<\/published>/);
    const thumbnailMatch   = entry.match(/url="(https:\/\/i\.ytimg\.com\/vi\/[\w-]+\/[^"]+)"/);
    if (!videoIdMatch) continue;

    const videoId      = videoIdMatch[1];
    const title        = titleMatch      ? titleMatch[1]     : '';
    const publishedAt  = publishedMatch  ? publishedMatch[1] : null;
    const thumbnailUrl = thumbnailMatch  ? thumbnailMatch[1] : `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

    await env.DB.prepare(
      `INSERT INTO videos (video_id, channel_id, title, thumbnail_url, published_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(video_id) DO NOTHING`
    ).bind(videoId, channelId, title, thumbnailUrl, publishedAt).run();
  }

  // last_checked を更新
  await env.DB.prepare(
    "UPDATE channels SET last_checked = datetime('now') WHERE channel_id = ?"
  ).bind(channelId).run();
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
