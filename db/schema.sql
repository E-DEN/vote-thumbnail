-- vote-thumbnail DB schema
-- SQLite (ローカル開発 / Cloudflare D1 共用)
-- 文字列の日時は ISO 8601 (UTC): datetime('now') -> "2026-05-08T00:00:00"
-- 注意: PRAGMA foreign_keys / journal_mode は D1 非対応のため省略

-- ---------------------------------------------------------------------------
-- channels
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS channels (
  channel_id    TEXT    PRIMARY KEY,
  handle        TEXT,                           -- @handle (@付きのまま保存)
  title         TEXT    NOT NULL DEFAULT '',
  icon_url      TEXT    NOT NULL DEFAULT '',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  last_checked  TEXT,                           -- 最後にYouTube APIで更新した日時
  last_accessed TEXT,                           -- 最後にユーザーがアクセスした日時 (inactive判定用)
  inactive      INTEGER NOT NULL DEFAULT 0      -- 1: 更新停止
);

-- ---------------------------------------------------------------------------
-- videos
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS videos (
  video_id      TEXT    PRIMARY KEY,
  channel_id    TEXT    NOT NULL REFERENCES channels(channel_id),
  title         TEXT    NOT NULL DEFAULT '',
  thumbnail_url TEXT    NOT NULL DEFAULT '',
  category      TEXT    NOT NULL DEFAULT 'videos', -- 'videos' | 'shorts' | 'live'
  duration      INTEGER NOT NULL DEFAULT 0,         -- 秒
  view_count    INTEGER NOT NULL DEFAULT 0,
  published_at  TEXT,
  -- Glicko-2
  rating        REAL    NOT NULL DEFAULT 1500,
  rd            REAL    NOT NULL DEFAULT 350,
  volatility    REAL    NOT NULL DEFAULT 0.06,
  wins          INTEGER NOT NULL DEFAULT 0,
  battles       INTEGER NOT NULL DEFAULT 0,
  rating_updated_at TEXT                            -- 最後にレーティングが更新された日時
);

CREATE INDEX IF NOT EXISTS idx_videos_channel        ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_channel_rating ON videos(channel_id, rating DESC);

-- ---------------------------------------------------------------------------
-- votes  (生投票ログ。レーティング再計算・分析用)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS votes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  channel_id  TEXT    NOT NULL REFERENCES channels(channel_id),
  winner_id   TEXT    NOT NULL REFERENCES videos(video_id),
  loser_id    TEXT    NOT NULL REFERENCES videos(video_id),
  ip_hash     TEXT    NOT NULL, -- sha256(ip + secret)  ※日付を含めない
  cookie_id   TEXT,             -- ランダムUUID (匿名Cookie)
  voted_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_votes_channel  ON votes(channel_id);
CREATE INDEX IF NOT EXISTS idx_votes_winner   ON votes(winner_id);
CREATE INDEX IF NOT EXISTS idx_votes_loser    ON votes(loser_id);
-- 重複チェック・集計用
CREATE INDEX IF NOT EXISTS idx_votes_ip_date  ON votes(ip_hash, voted_at);

-- ---------------------------------------------------------------------------
-- daily_votes  (日次重複判定用)
--
-- 仕様書の設計変更点:
--   旧: ip_hash TEXT PRIMARY KEY  (日付をハッシュに埋め込む方式)
--   新: (ip_hash, channel_id, vote_date) 複合PK + vote_date を独立カラムに
--   理由: 旧方式だと vote_date < X で古いレコードを削除できず、
--         cleanup cron が書けない。
--   ip_hash は sha256(ip + secret) のみ。日付は vote_date カラムで管理する。
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_votes (
  ip_hash     TEXT    NOT NULL, -- sha256(ip + secret)
  cookie_id   TEXT,             -- 匿名Cookie。NULLの場合はIPのみで判定
  channel_id  TEXT    NOT NULL REFERENCES channels(channel_id),
  vote_date   TEXT    NOT NULL, -- yyyy-mm-dd (UTC)
  count       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (ip_hash, channel_id, vote_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_votes_date ON daily_votes(vote_date);
-- cleanup cron: DELETE FROM daily_votes WHERE vote_date < date('now', '-2 days');

-- ---------------------------------------------------------------------------
-- reactions  (1 ユーザー 1 動画に付き 1 pin。UPSERT で更新)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reactions (
  video_id    TEXT    NOT NULL REFERENCES videos(video_id),
  session_id  TEXT    NOT NULL,  -- localStorage で生成した匿名 UUID
  x           REAL    NOT NULL,  -- 画像内相対 X 座標 (0.0–1.0)
  y           REAL    NOT NULL,  -- 画像内相対 Y 座標 (0.0–1.0)
  updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (video_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_reactions_video ON reactions(video_id);
