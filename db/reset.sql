-- 全テーブルを削除する (FK依存の逆順)
-- Usage: sqlite3 db/vote ".read db/reset.sql"

DELETE FROM reactions;
DELETE FROM videos;
DELETE FROM channels;
