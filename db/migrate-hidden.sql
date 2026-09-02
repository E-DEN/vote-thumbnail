-- hidden をカテゴリから分離するマイグレーション
-- 既存の db/migrate.sql は過去の列追加を含むため再実行しない。

ALTER TABLE videos ADD COLUMN is_hidden INTEGER NOT NULL DEFAULT 0;
UPDATE videos SET category = 'live', is_hidden = 1 WHERE video_id = '2pESh9nH3vQ' AND category = 'hidden';
UPDATE videos SET category = 'videos', is_hidden = 1 WHERE category = 'hidden';
