// state.js — 定数 + アプリケーション共有状態
// PC・モバイル両方から import して使用する

// --- localStorage キー ---
export const LS_CHANNELS       = 'thumb-ranking-channels';
export const LS_VIDEOS         = 'thumb-ranking-videos';
export const LS_RATING         = 'thumb-ranking-elo';
export const LS_CAT            = 'thumb-cat';
export const LS_VOTE_PAIR      = 'thumb-vote-pair';
export const LS_SORT           = 'thumb-sort';
// PC 専用（モバイルで参照しても harmless）
export const LS_SIDEBAR_ORDER  = 'thumb-sidebar-order';
export const LS_API_KEY        = 'yt-api-key';
export const LS_RSS_ONLY       = 'yt-rss-only';
export const LS_HEATMAP_VISIBLE = 'thumb-heatmap-visible';

// --- 共有状態オブジェクト ---
// ES module はシングルトン保証あり。全モジュールが同一オブジェクトを参照する。
// プリミティブ値の変更は state.xxx = newValue で行うこと。
export const state = {
  /** レーティングデータ { [videoId]: { rating, rd, volatility, wins, battles } } */
  ratingData:         {},
  /** 全投票回数（ローカル） */
  voteTotal:          0,
  /** チャンネル一覧 { [channelId]: { key, handle, displayName, avatar } } */
  channels:           {},
  /** 現在表示中のチャンネル ID */
  currentChannelKey:  null,
  /** 現在のチャンネルの全動画（フロントエンド形式） */
  allVideos:          [],
  /** 現在選択中のカテゴリ */
  currentCat:         localStorage.getItem(LS_CAT) || 'videos',
};

// --- フォルダカラーパレット（PC・モバイル共通） ---
export const WASHOKU_PALETTE = [
  { hue: null, name: '無垢', en: 'Muku' },
  { hue:   0, name: '茜',   en: 'Madder' },
  { hue:  15, name: '柿',   en: 'Persimmon' },
  { hue:  32, name: '山吹', en: 'Yamabuki' },
  { hue:  68, name: '萌黄', en: 'Moegi' },
  { hue: 105, name: '若竹', en: 'Wakatake' },
  { hue: 155, name: '木賊', en: 'Tokusa' },
  { hue: 185, name: '浅葱', en: 'Asagi' },
  { hue: 208, name: '縹',   en: 'Hanada' },
  { hue: 228, name: '瑠璃', en: 'Ruri' },
  { hue: 258, name: '桔梗', en: 'Kikyo' },
  { hue: 292, name: '牡丹', en: 'Botan' },
];
