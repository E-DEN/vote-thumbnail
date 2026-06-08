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
  banner_url    TEXT    NOT NULL DEFAULT '',    -- チャンネルバナー画像URL
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
  description   TEXT,                           -- 概要欄 (NULL=未取得, ''=説明なし)
  tags          TEXT,                           -- YouTube snippet.tags JSON配列 (NULL=未取得)
  published_at  TEXT,
  -- Glicko-2 (videos テーブルが正。votes からの再計算は順序依存のため不可)
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
-- reactions  (1 ユーザー 1 動画に付き 1 pin。UPSERT で更新)
--
-- session_id は localStorage で生成した匿名 UUID。
-- ブラウザデータ消去で再投稿可能だが、ハートマップの精度は許容範囲とする。
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
