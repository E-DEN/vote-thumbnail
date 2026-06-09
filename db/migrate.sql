-- 既存DBへのマイグレーション
-- 新規セットアップでは schema.sql だけで OK。既存DBに列を追加する場合のみ実行する。
--
-- ローカル (SQLite):
--   sqlite3 .wrangler/state/v3/d1/<hash>/<db>.sqlite ".read db/migrate.sql"
--
-- Cloudflare D1 (リモート):
--   npx wrangler d1 execute vote-thumbnail --remote --file db/migrate.sql

ALTER TABLE channels ADD COLUMN banner_url TEXT NOT NULL DEFAULT '';
ALTER TABLE videos   ADD COLUMN description TEXT;
ALTER TABLE videos   ADD COLUMN description TEXT NOT NULL DEFAULT '';
ALTER TABLE videos   ADD COLUMN scheduled_at TEXT;
