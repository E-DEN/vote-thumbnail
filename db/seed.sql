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
-- votes (channel A の生投票ログ 10件)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO votes (channel_id, winner_id, loser_id, ip_hash, cookie_id, voted_at) VALUES
  ('UC_mock_channel_A', 'vid_A_001', 'vid_A_002', 'hash_ip_1', 'cookie-uuid-0001', datetime('now', '-10 minutes')),
  ('UC_mock_channel_A', 'vid_A_001', 'vid_A_003', 'hash_ip_2', 'cookie-uuid-0002', datetime('now', '-9 minutes')),
  ('UC_mock_channel_A', 'vid_A_002', 'vid_A_004', 'hash_ip_3', 'cookie-uuid-0003', datetime('now', '-8 minutes')),
  ('UC_mock_channel_A', 'vid_A_001', 'vid_A_004', 'hash_ip_4', 'cookie-uuid-0004', datetime('now', '-7 minutes')),
  ('UC_mock_channel_A', 'vid_A_005', 'vid_A_002', 'hash_ip_5', 'cookie-uuid-0005', datetime('now', '-6 minutes')),
  ('UC_mock_channel_A', 'vid_A_001', 'vid_A_005', 'hash_ip_1', 'cookie-uuid-0001', datetime('now', '-5 minutes')),
  ('UC_mock_channel_A', 'vid_A_003', 'vid_A_004', 'hash_ip_2', 'cookie-uuid-0002', datetime('now', '-4 minutes')),
  ('UC_mock_channel_A', 'vid_A_001', 'vid_A_002', 'hash_ip_6', 'cookie-uuid-0006', datetime('now', '-3 minutes')),
  ('UC_mock_channel_A', 'vid_A_005', 'vid_A_003', 'hash_ip_7', 'cookie-uuid-0007', datetime('now', '-2 minutes')),
  ('UC_mock_channel_A', 'vid_A_002', 'vid_A_003', 'hash_ip_8', 'cookie-uuid-0008', datetime('now', '-1 minutes'));

-- ---------------------------------------------------------------------------
-- daily_votes (重複チェック用)
-- ---------------------------------------------------------------------------
INSERT OR IGNORE INTO daily_votes (ip_hash, cookie_id, channel_id, vote_date, count) VALUES
  ('hash_ip_1', 'cookie-uuid-0001', 'UC_mock_channel_A', date('now'), 2),
  ('hash_ip_2', 'cookie-uuid-0002', 'UC_mock_channel_A', date('now'), 2),
  ('hash_ip_3', 'cookie-uuid-0003', 'UC_mock_channel_A', date('now'), 1),
  ('hash_ip_4', 'cookie-uuid-0004', 'UC_mock_channel_A', date('now'), 1),
  ('hash_ip_5', 'cookie-uuid-0005', 'UC_mock_channel_A', date('now'), 1),
  ('hash_ip_6', 'cookie-uuid-0006', 'UC_mock_channel_A', date('now'), 1),
  ('hash_ip_7', 'cookie-uuid-0007', 'UC_mock_channel_A', date('now'), 1),
  ('hash_ip_8', 'cookie-uuid-0008', 'UC_mock_channel_A', date('now'), 1);
