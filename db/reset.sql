-- 全テーブルを削除する (FK依存の逆順)
-- Usage: sqlite3 db/vote ".read db/reset.sql"

DELETE FROM daily_votes;
DELETE FROM votes;
DELETE FROM videos;
DELETE FROM channels;
