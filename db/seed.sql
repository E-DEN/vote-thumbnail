-- Mock seed data for local development
-- Usage: sqlite3 db/vote ".read db/seed.sql"

-- ---------------------------------------------------------------------------
-- channels
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO channels (channel_id, handle, title, icon_url, last_checked, last_accessed) VALUES
  ('UC_mock_channel_A', '@MockChannelA', 'Mock Channel A', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg', datetime('now'), datetime('now')),
  ('UC_mock_channel_B', '@MockChannelB', 'Mock Channel B', 'https://i.ytimg.com/vi/dQw4w9WgXcQ/default.jpg', datetime('now'), datetime('now'));

-- ---------------------------------------------------------------------------
-- videos (channel A: 5本、RD がばらつくよう battles を調整)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO videos (video_id, channel_id, title, thumbnail_url, category, duration, view_count, published_at, rating, rd, volatility, wins, battles) VALUES
  ('vid_A_001', 'UC_mock_channel_A', 'Video A-1 (多対戦)',  'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', 'videos', 420, 120000, '2024-01-01T00:00:00', 1620, 72,  0.055, 18, 28),
  ('vid_A_002', 'UC_mock_channel_A', 'Video A-2 (中対戦)',  'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', 'videos', 380, 80000,  '2024-02-01T00:00:00', 1500, 145, 0.058, 8,  14),
  ('vid_A_003', 'UC_mock_channel_A', 'Video A-3 (少対戦)',  'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', 'videos', 600, 50000,  '2024-03-01T00:00:00', 1480, 280, 0.060, 2,  4),
  ('vid_A_004', 'UC_mock_channel_A', 'Video A-4 (未対戦)',  'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', 'videos', 300, 30000,  '2024-04-01T00:00:00', 1500, 350, 0.060, 0,  0),
  ('vid_A_005', 'UC_mock_channel_A', 'Short A-5',           'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', 'shorts', 58,  9000,   '2024-05-01T00:00:00', 1540, 110, 0.056, 12, 20);

-- ---------------------------------------------------------------------------
-- reactions (ピン差しサンプル: vid_A_001 に20件、vid_A_002 に8件)
-- session_id は架空のUUID、x/y は画像内の相対位置 (0.0–1.0)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO reactions (video_id, session_id, x, y, updated_at) VALUES
  -- vid_A_001: 顔周辺に集中 + 散らばり
  ('vid_A_001', 'sess-001', 0.48, 0.22, datetime('now', '-180 minutes')),
  ('vid_A_001', 'sess-002', 0.52, 0.20, datetime('now', '-170 minutes')),
  ('vid_A_001', 'sess-003', 0.50, 0.25, datetime('now', '-160 minutes')),
  ('vid_A_001', 'sess-004', 0.45, 0.18, datetime('now', '-150 minutes')),
  ('vid_A_001', 'sess-005', 0.55, 0.23, datetime('now', '-140 minutes')),
  ('vid_A_001', 'sess-006', 0.49, 0.21, datetime('now', '-130 minutes')),
  ('vid_A_001', 'sess-007', 0.51, 0.19, datetime('now', '-120 minutes')),
  ('vid_A_001', 'sess-008', 0.47, 0.24, datetime('now', '-110 minutes')),
  ('vid_A_001', 'sess-009', 0.53, 0.26, datetime('now', '-100 minutes')),
  ('vid_A_001', 'sess-010', 0.50, 0.22, datetime('now', '-90 minutes')),
  ('vid_A_001', 'sess-011', 0.30, 0.60, datetime('now', '-80 minutes')),
  ('vid_A_001', 'sess-012', 0.72, 0.55, datetime('now', '-70 minutes')),
  ('vid_A_001', 'sess-013', 0.25, 0.40, datetime('now', '-60 minutes')),
  ('vid_A_001', 'sess-014', 0.78, 0.35, datetime('now', '-50 minutes')),
  ('vid_A_001', 'sess-015', 0.50, 0.75, datetime('now', '-40 minutes')),
  ('vid_A_001', 'sess-016', 0.48, 0.77, datetime('now', '-30 minutes')),
  ('vid_A_001', 'sess-017', 0.52, 0.73, datetime('now', '-20 minutes')),
  ('vid_A_001', 'sess-018', 0.15, 0.85, datetime('now', '-15 minutes')),
  ('vid_A_001', 'sess-019', 0.85, 0.15, datetime('now', '-10 minutes')),
  ('vid_A_001', 'sess-020', 0.60, 0.45, datetime('now', '-5 minutes')),
  -- vid_A_002: 右下寄り
  ('vid_A_002', 'sess-101', 0.70, 0.65, datetime('now', '-120 minutes')),
  ('vid_A_002', 'sess-102', 0.68, 0.70, datetime('now', '-105 minutes')),
  ('vid_A_002', 'sess-103', 0.72, 0.68, datetime('now', '-90 minutes')),
  ('vid_A_002', 'sess-104', 0.65, 0.72, datetime('now', '-75 minutes')),
  ('vid_A_002', 'sess-105', 0.75, 0.60, datetime('now', '-60 minutes')),
  ('vid_A_002', 'sess-106', 0.40, 0.30, datetime('now', '-45 minutes')),
  ('vid_A_002', 'sess-107', 0.35, 0.28, datetime('now', '-30 minutes')),
  ('vid_A_002', 'sess-108', 0.50, 0.50, datetime('now', '-15 minutes'));

