-- videos テーブルの列順を schema.sql に合わせて再構築する
-- 実行前に channels データが存在することを確認すること（videos は再取得可能）
--
-- ローカル:
--   npx wrangler d1 execute vote-thumbnail --local --file db/rebuild-videos.sql
-- リモート:
--   npx wrangler d1 execute vote-thumbnail --remote --file db/rebuild-videos.sql

PRAGMA foreign_keys = OFF;

CREATE TABLE videos_new (
  video_id      TEXT    PRIMARY KEY,
  channel_id    TEXT    NOT NULL REFERENCES channels(channel_id),
  title         TEXT    NOT NULL DEFAULT '',
  thumbnail_url TEXT    NOT NULL DEFAULT '',
  category      TEXT    NOT NULL DEFAULT 'videos',
  duration      INTEGER NOT NULL DEFAULT 0,
  view_count    INTEGER NOT NULL DEFAULT 0,
  description   TEXT,
  tags          TEXT,
  published_at  TEXT,
  scheduled_at  TEXT,
  rating        REAL    NOT NULL DEFAULT 1500,
  rd            REAL    NOT NULL DEFAULT 350,
  volatility    REAL    NOT NULL DEFAULT 0.06,
  wins          INTEGER NOT NULL DEFAULT 0,
  battles       INTEGER NOT NULL DEFAULT 0,
  rating_updated_at TEXT
);

INSERT INTO videos_new
  SELECT video_id, channel_id, title, thumbnail_url, category, duration, view_count,
         description, tags, published_at, scheduled_at,
         rating, rd, volatility, wins, battles, rating_updated_at
  FROM videos;

DROP TABLE videos;
ALTER TABLE videos_new RENAME TO videos;

CREATE INDEX IF NOT EXISTS idx_videos_channel        ON videos(channel_id);
CREATE INDEX IF NOT EXISTS idx_videos_channel_rating ON videos(channel_id, rating DESC);

PRAGMA foreign_keys = ON;
