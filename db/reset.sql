-- 全テーブルを削除する (FK依存の逆順)
-- Usage (ローカル): npx wrangler d1 execute vote-thumbnail --local --file db/reset.sql
-- Usage (リモート): npx wrangler d1 execute vote-thumbnail --remote --file db/reset.sql
-- 実行後に schema.sql を流してテーブルを再作成すること

DROP TABLE IF EXISTS reactions;
DROP TABLE IF EXISTS votes;
DROP TABLE IF EXISTS videos;
DROP TABLE IF EXISTS channels;
