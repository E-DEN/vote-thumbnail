-- 全テーブルを削除する (FK依存の逆順)
-- Usage: sqlite3 .wrangler/state/v3/d1/<hash>/<db>.sqlite ".read db/reset.sql"

DELETE FROM reactions;
DELETE FROM videos;
DELETE FROM channels;
