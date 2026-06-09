// i18n 翻訳エンジン
// 組み込み言語: ja（日本語）、en（英語）
//
// 言語を追加するには、別スクリプトで registerLang('XX', '表示名', {...}) を呼び、
// index.html の app.js より前に読み込む。

const _I18N_DICTS  = {};
const _I18N_LABELS = {};

function registerLang(code, label, dict) {
  _I18N_DICTS[code]  = dict;
  _I18N_LABELS[code] = label;
}

function getRegisteredLangs() {
  return Object.keys(_I18N_DICTS).map(code => ({ code, label: _I18N_LABELS[code] || code }));
}

function unregisterLang(code) {
  delete _I18N_DICTS[code];
  delete _I18N_LABELS[code];
}

// var: app.js から単純代入で更新できるようにするため
var _lang = localStorage.getItem('thumb-lang') || 'ja';

// {key} プレースホルダーに vars を展開して返す
function t(key, vars) {
  let str = (_I18N_DICTS[_lang] || _I18N_DICTS['ja'] || {})[key] || key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      str = str.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
    }
  }
  return str;
}

// data-i18n* 属性を持つ全 DOM 要素に適用する
function applyLang(lang) {
  _lang = lang;
  localStorage.setItem('thumb-lang', lang);
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach(el => {
    el.textContent = t(el.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-ph]').forEach(el => {
    el.placeholder = t(el.dataset.i18nPh);
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    el.title = t(el.dataset.i18nTitle);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach(el => {
    el.setAttribute('aria-label', t(el.dataset.i18nAria));
  });
  const langLabel = document.getElementById('langLabel');
  if (langLabel) langLabel.textContent = _lang === 'ja' ? 'EN' : 'JA';
  // 設定モーダルの見出しを更新
  document.querySelectorAll('[data-i18n-href]').forEach(el => {
    el.href = t(el.dataset.i18nHref);
  });
  const modalHeading = document.getElementById('settingsModalHeading');
  if (modalHeading && modalHeading.dataset.tab) {
    modalHeading.textContent = t('settings-tab-' + modalHeading.dataset.tab);
  }
  // テーマボタンのタイトルを現在言語で更新
  const themeBtn = document.getElementById('themeBtn');
  if (themeBtn) {
    const isDark = document.documentElement.dataset.theme === 'dark';
    themeBtn.title = t(isDark ? 'app-theme-dark' : 'app-theme-light');
  }
  // ソートラベルをアクティブな項目と同期
  [['sortPopup', 'sortSplitLabel'], ['rsSortPopup', 'rsSortLabel']].forEach(([popupId, labelId]) => {
    const popup = document.getElementById(popupId);
    if (!popup) return;
    const active = popup.querySelector('[data-sort].active');
    const label = document.getElementById(labelId);
    if (active && label) label.textContent = active.textContent;
  });
}

// ── 組み込み: 日本語 ──────────────────────────────────────────
registerLang('ja', '日本語', {
  // アプリ
  'app-title': 'ラブ♥ねいる',
  // モード
  'app-theme-dark': 'ダークモード',
  'app-theme-light': 'ライトモード',
  // サイドバー
  'sidebar-search-ph': 'YouTube の @handle またはチャンネル／動画URL',
  'sidebar-search-add': '追加',
  'view-gallery-title': 'ギャラリー',
  'view-grid-title': 'グリッド',
  // モバイル専用
  'm-ch-panel-title': 'チャンネル',
  'm-ch-select': 'チャンネルを選択',
  'm-ch-select-prompt': 'チャンネルを選択してください',
  'm-ch-empty': 'チャンネルが未登録です。下の入力欄から追加してください。',
  'm-ch-add-ph': '@handle または URL',
  'm-ch-add-aria': '追加',
  'm-ch-refresh': '動画を再取得',
  'm-ch-delete': '削除',
  // チャンネルヘッダー
  'tab-vote': '投票',
  'tab-list': '一覧',
  'tab-rank': 'ランキング',
  'tab-react': 'ここ好き',
  'cat-videos': '動画',
  'cat-shorts': 'ショート',
  'cat-live': 'ライブ',
  'cat-empty': 'このカテゴリには動画がありません。',
  // ウェルカム
  'welcome-add': 'チャンネルを追加してはじめる',
  'welcome-help-link': '使い方ガイドを見る →',
  'welcome-vote': '投票',
  'welcome-vote-desc': 'サムネイルを見比べて\n好きな方に投票できます。\n結果はリアルタイムで集計。',
  'welcome-rank': 'ランキング',
  'welcome-rank-desc': '投票結果をもとに\nサムネイルの順位を閲覧できます。\nレーティングはGlicko-2で算出。',
  'welcome-pin': 'ここ好き',
  'welcome-pin-desc': '「ここ好き」な地点に\nピンを立てて投稿できます。\nみんなの人気エリアに注目。',
  // 共通
  'cancel': 'キャンセル',
  // 投票
  'vote-count-pre': 'これまでの投票: ',
  'vote-count-post': ' 回',
  'vote-tutorial': '好きなサムネイルをクリックして投票。結果はランキングに反映されます。',
  'vote-tutorial-ok': 'わかった',
  'vote-all-done': '全組み合わせの評価が確定しました。',
  'vote-need-more': '動画が2本以上必要です。',
  // 投票ペースゲージ
  'vote-pace-stable': '安定',
  'vote-pace-fast': '速い',
  'vote-pace-blazing': '猛速',
  // ランキング
  'rank-desc': 'レーティング（勝率ベース）の高い順に並んでいます。',
  'rank-rd-note': 'サムネが薄い場合、対戦数が少なくレーティングの信頼度が低いことを示します。',
  'rank-heading': 'ランキング',
  'rank-more': 'もっと見る（あと {n} 件）',
  'rank-wins-fmt': '{w}勝 / {b}戦',
  'rank-winrate-fmt': ' · {r}%',
  'rank-rating': 'レーティング',
  'rank-battles': '戦数',
  'rank-wins': '勝利',
  'rank-winrate': '勝率',
  'rank-position': '順位',
  // ステータス
  'status-invalid-url': 'URLの形式が不正です',
  'status-ch-fetching': 'チャンネル情報を取得中...',
  'status-error': 'エラー: {msg}',
  'status-fetching': '取得中...',
  'status-connection-err': '接続エラー',
  'status-invalid-input': '無効な入力です',
  'status-add-failed': '追加に失敗しました',
  'status-refresh-err': '再取得に失敗しました',
  'status-refresh-rss': 'RSS取得完了（DB更新{changed}件）',
  'status-refresh-api': '全件取得完了（{total}件）',
  'status-ch-added': '{name} を追加しました',
  'status-ch-refreshing': '{name} を更新中...',
  // トーストタイトル
  'toast-ok':      '完了',
  'toast-err':     'エラー',
  'toast-warn':    '注意',
  'toast-info':    '情報',
  'toast-loading': '処理中',
  // モーダル
  'modal-close': '閉じる',
  'yt-open': 'YouTube で見る',
  // リアクション
  'react-open': 'リアクション',
  'react-select-prompt': 'リストから動画を選んでください。',
  'react-pins': '好き',
  'react-heatmap': '人気',
  'react-you': 'あなた',
  'react-max-pins': 'ピン数',
  'react-pin-color': 'ピン色',
  'react-pin-opacity': 'ピン透過度',
  'react-transport': '再生',
  'react-play-title': '再生 / 一時停止',
  'react-stop-title': '停止',
  'react-mute-title': 'ミュート',
  'react-screenshot-title': 'スクリーンショット保存',
  'react-theater-open': 'シアターモード',
  'react-theater-close': 'プレイリストを表示',
  'react-fullscreen-title': 'フルスクリーン',
  // ソート
  'sort-views': '再生数',
  'sort-date': '投稿日',
  'sort-rating': '得票率',
  'sort-random': 'ランダム',
  // モバイル画面
  'm-vote-show-title': 'タイトルを表示',
  'm-video-yt-open': 'YouTubeで開く',
  'm-video-copy-url': 'URLをコピー',
  'm-video-open-channel': 'チャンネルを開く',
  'm-video-copy-ok': 'URLをコピーしました',
  'm-video-copy-err': 'コピーに失敗しました',
  'm-video-overview': '概要',
  'm-video-views': '視聴',
  'm-video-show-more': 'もっと見る',
  'm-video-date': '日付',
  'm-video-views-hdr': '視聴回数',
  'm-video-prev': '前の動画',
  'm-video-next': '次の動画',
  'm-display-settings': '表示設定',
  'm-back': '戻る',
  'm-video-no-desc': 'この動画には説明が追加されていません。',
  'm-date-year-fmt': '{y}年',
  'm-date-md-fmt': '{m}月{d}日',
  // 表示フォーマット
  'fmt-views-100m': '{n}億回視聴',
  'fmt-views-10k': '{n}万回視聴',
  'fmt-views-1k': '{n}千回視聴',
  'fmt-views-raw': '{n}回視聴',
  'fmt-views-short-100m': '{n}億',
  'fmt-views-short-10k': '{n}万',
  'fmt-views-short-raw': '{n}',
  'fmt-time-now': 'たった今',
  'fmt-time-min': '{n}分前',
  'fmt-time-hour': '{n}時間前',
  'fmt-time-day': '{n}日前',
  'fmt-time-week': '{n}週間前',
  'fmt-time-month': '{n}ヶ月前',
  'fmt-time-year': '{n}年前',
  'fmt-time-in-min': '{n}分後',
  'fmt-time-in-hour': '{n}時間後',
  'fmt-time-in-day': '{n}日後',
  'fmt-time-in-week': '{n}週間後',
  'fmt-time-in-month': '{n}ヶ月後',
  'fmt-live-scheduled': 'にライブ配信予定',
  // 言語インポート
  'lang-drop': 'JSONファイルをドロップ',
  'lang-drop-hint': 'またはクリックして選択',
  'lang-paste-label': 'または JSON テキストを貼り付け',
  'lang-paste-ph': '{"code":"ko","label":"한국어","dict":{...}}',
  'lang-apply': '適用',
  'lang-template-dl': 'テンプレートをDL',
  'lang-add': '＋ 追加',
  'lang-err': '言語ファイルの読み込みに失敗しました',
  // 設定モーダル
  'settings-open-title': '設定',
  'settings-title': '設定',
  'settings-tab-display': '表示',
  'settings-tab-lang': '言語',
  'settings-tab-apikey': 'APIキー',
  'settings-tab-data': 'データ',
  'settings-theme': 'テーマ',
  'settings-theme-dark': 'ダーク',
  'settings-theme-light': 'ライト',
  'settings-close': '閉じる',
  'apikey-label': 'YouTube APIキー',
  'apikey-save': '保存',
  'apikey-delete': '削除',
  'apikey-guide': 'API キーの発行方法',
  'apikey-guide-url': 'https://www.youtube.com/watch?v=9VJ_7tVEDUQ',
  'apikey-err-empty': 'APIキーを入力してください',
  'apikey-err-format': '形式が正しくありません（AIzaSy... で始まる39文字）',
  'apikey-saved': '保存しました',
  'apikey-err-details': 'APIキーが無効なため再生数・長さを取得できませんでした',
  'apikey-toggle-title': '表示切り替え',
  'settings-rss': 'RSSのみ取得（最新15件）',
  'settings-rss-desc': 'APIキーを無視してRSSだけで取得。',
  'settings-data': 'バックアップ',
  'settings-data-export': 'エクスポート',
  'settings-data-import': 'インポート',
  'settings-data-desc': 'サイドバーのチャンネル・フォルダ構成を JSON ファイルとして保存・復元します。',
  'settings-data-exported': 'エクスポートしました',
  'settings-data-imported': 'インポートしました',
  'settings-data-import-err': '読み込みに失敗しました（形式が正しくありません）',
  // プリセット
  'preset-load': '読込',
  'preset-share': 'コード共有',
  'preset-copy-title': 'コードをコピー',
  'preset-copied': 'コードをコピーしました',
  'preset-fetching': 'チャンネルを取得中...',
  'preset-imported': '取り込みました',
  'preset-import-err': 'コードが正しくありません',
  'preset-code-ph': '取込コード（vt~…）を貼り付け',
  // フォルダ
  'folder-new-name': 'フォルダ',
  'folder-new-dialog': '新規フォルダ',
  'folder-create': '作成',
  'folder-rename': 'フォルダ名を変更',
  'folder-refresh': '動画を再取得（フォルダ内全チャンネル）',
  'folder-delete': 'フォルダを削除',
  'folder-delete-confirm': '「{name}」を削除しますか？（チャンネルは残ります）',
  'folder-refresh-confirm': '「{name}」内の{count}件のチャンネルを再取得しますか？',
  'folder-refresh-ok': '再取得',
  'folder-delete-ok': '削除',
  'folder-color': 'フォルダの色',
  // チャンネル
  'ch-refresh-title': '動画を再取得',
  'ch-delete-title': '削除',
  'ch-delete-confirm': '「{name}」を削除しますか？',
  'ch-delete-ok': '削除',
  'ch-already-added': '「{name}」はすでに登録済みです',
  'ch-import-done': '{count} 件取得完了',
});

// ── 組み込み: 英語 ────────────────────────────────────────────
registerLang('en', 'English', {
  // App
  'app-title': 'Love♥Nail',
  // Mode
  'app-theme-dark': 'Dark mode',
  'app-theme-light': 'Light mode',
  // Sidebar
  'sidebar-search-ph': 'YouTube @handle or channel/video URL',
  'sidebar-search-add': 'Add',
  'view-gallery-title': 'Gallery',
  'view-grid-title': 'List',
  // Mobile-specific
  'm-ch-panel-title': 'Channels',
  'm-ch-select': 'Select Channel',
  'm-ch-select-prompt': 'Select a channel',
  'm-ch-empty': 'No channels registered. Add one below.',
  'm-ch-add-ph': '@handle or URL',
  'm-ch-add-aria': 'Add',
  'm-ch-refresh': 'Refresh videos',
  'm-ch-delete': 'Delete',
  // Channel header
  'tab-vote': 'Vote',
  'tab-list': 'Videos',
  'tab-rank': 'Ranking',
  'tab-react': 'Reactions',
  'cat-videos': 'Videos',
  'cat-shorts': 'Shorts',
  'cat-live': 'Live',
  'cat-empty': 'No videos in this category.',
  // Welcome
  'welcome-add': 'Add a channel to get started',
  'welcome-help-link': 'View usage guide →',
  'welcome-vote': 'Vote',
  'welcome-vote-desc': 'Compare thumbnails\nand vote for your favorite.\nResults tallied in real time.',
  'welcome-rank': 'Rankings',
  'welcome-rank-desc': 'Browse thumbnail rankings\nbased on vote results.\nRatings calculated with Glicko-2.',
  'welcome-pin': 'Favorites',
  'welcome-pin-desc': 'Drop a pin on your\nfavorite moment and share it.\nSee popular spots at a glance.',
  // 共通
  'cancel': 'Cancel',
  // Vote
  'vote-count-pre': 'Votes so far: ',
  'vote-count-post': '',
  'vote-tutorial': 'Click the thumbnail you prefer to vote. Results are reflected in the ranking.',
  'vote-tutorial-ok': 'Got it',
  'vote-all-done': 'All matchups have been rated',
  'vote-need-more': 'Need at least 2 videos',
  // Vote pace gauge
  'vote-pace-stable': 'Steady',
  'vote-pace-fast': 'Fast',
  'vote-pace-blazing': 'Blazing',
  // Ranking
  'rank-desc': 'Sorted by rating (win-rate based), highest first.',
  'rank-rd-note': 'Faded thumbnails have fewer battles and lower rating confidence.',
  'rank-heading': 'Ranking',
  'rank-more': 'Show more ({n} remaining)',
  'rank-wins-fmt': '{w}W / {b}',
  'rank-winrate-fmt': ' · {r}%',
  'rank-rating': 'Rating',
  'rank-battles': 'Battles',
  'rank-wins': 'Wins',
  'rank-winrate': 'Win rate',
  'rank-position': 'Rank',
  // Status
  'status-invalid-url': 'Invalid URL format',
  'status-ch-fetching': 'Fetching channel info...',
  'status-error': 'Error: {msg}',
  'status-fetching': 'Loading...',
  'status-connection-err': 'Connection error',
  'status-invalid-input': 'Invalid input',
  'status-add-failed': 'Failed to add',
  'status-refresh-err': 'Refresh failed',
  'status-refresh-rss': 'RSS fetch done ({changed} DB updates)',
  'status-refresh-api': 'Full fetch done ({total} videos)',
  'status-ch-added': '{name} added',
  'status-ch-refreshing': 'Updating {name}...',
  // Toast titles
  'toast-ok':      'Done',
  'toast-err':     'Error',
  'toast-warn':    'Warning',
  'toast-info':    'Info',
  'toast-loading': 'Processing',
  // Modal
  'modal-close': 'Close',
  'yt-open': 'Watch on YouTube',
  // Reaction
  'react-open': 'Reaction',
  'react-select-prompt': 'Select a video from the list.',
  'react-pins': 'Like',
  'react-heatmap': 'Popular',
  'react-you': 'You',
  'react-max-pins': 'Pin Count',
  'react-pin-color': 'Pin Color',
  'react-pin-opacity': 'Pin Opacity',
  'react-transport': 'Play',
  'react-play-title': 'Play / Pause',
  'react-stop-title': 'Stop',
  'react-mute-title': 'Mute',
  'react-screenshot-title': 'Save Screenshot',
  'react-theater-open': 'Theater Mode',
  'react-theater-close': 'Show Playlist',
  'react-fullscreen-title': 'Fullscreen',
  // Sort
  'sort-views': 'Most Viewed',
  'sort-date': 'Newest',
  'sort-rating': 'Top Rated',
  'sort-random': 'Random',
  // Mobile screens
  'm-vote-show-title': 'Show Title',
  'm-video-yt-open': 'Open in YouTube',
  'm-video-copy-url': 'Copy URL',
  'm-video-open-channel': 'Open Channel',
  'm-video-copy-ok': 'URL copied',
  'm-video-copy-err': 'Failed to copy',
  'm-video-overview': 'Description',
  'm-video-views': 'Views',
  'm-video-show-more': 'Show more',
  'm-video-date': 'Date',
  'm-video-views-hdr': 'Views',
  'm-video-prev': 'Previous',
  'm-video-next': 'Next',
  'm-display-settings': 'Display Settings',
  'm-back': 'Back',
  'm-video-no-desc': 'No description available.',
  'm-date-year-fmt': '{y}',
  'm-date-md-fmt': '{m}/{d}',
  // Format
  'fmt-views-100m': '{n}00M views',
  'fmt-views-10k': '{n}0K views',
  'fmt-views-1k': '{n}K views',
  'fmt-views-raw': '{n} views',
  'fmt-views-short-100m': '{n}00M',
  'fmt-views-short-10k': '{n}0K',
  'fmt-views-short-raw': '{n}',
  'fmt-time-now': 'just now',
  'fmt-time-min': '{n}m ago',
  'fmt-time-hour': '{n}h ago',
  'fmt-time-day': '{n}d ago',
  'fmt-time-week': '{n}w ago',
  'fmt-time-month': '{n}mo ago',
  'fmt-time-year': '{n}y ago',
  'fmt-time-in-min': 'in {n}m',
  'fmt-time-in-hour': 'in {n}h',
  'fmt-time-in-day': 'in {n}d',
  'fmt-time-in-week': 'in {n}w',
  'fmt-time-in-month': 'in {n}mo',
  'fmt-live-scheduled': 'live scheduled',
  // Language import
  'lang-drop': 'Drop JSON file here',
  'lang-drop-hint': 'or click to select',
  'lang-paste-label': 'or paste JSON text below',
  'lang-paste-ph': '{"code":"ko","label":"한국어","dict":{...}}',
  'lang-apply': 'Apply',
  'lang-template-dl': 'Download template',
  'lang-add': '+ Add',
  'lang-err': 'Failed to load language file',
  // Settings modal
  'settings-open-title': 'Settings',
  'settings-title': 'Settings',
  'settings-tab-display': 'Display',
  'settings-tab-lang': 'Language',
  'settings-tab-apikey': 'API Key',
  'settings-tab-data': 'Data',
  'settings-theme': 'Theme',
  'settings-theme-dark': 'Dark',
  'settings-theme-light': 'Light',
  'settings-close': 'Close',
  'apikey-label': 'YouTube API Key',
  'apikey-save': 'Save',
  'apikey-delete': 'Delete',
  'apikey-guide': 'How to issue an API key',
  'apikey-guide-url': 'https://www.youtube.com/watch?v=uz7dY8qTFJw',
  'apikey-err-empty': 'Please enter an API key',
  'apikey-err-format': 'Invalid format (39 characters starting with AIzaSy...)',
  'apikey-saved': 'Saved',
  'apikey-err-details': 'Invalid API key: could not fetch view count or duration',
  'apikey-toggle-title': 'Show / Hide',
  'settings-rss': 'RSS only (latest 15)',
  'settings-rss-desc': 'Fetch via RSS only, ignoring the API key.',
  'settings-data': 'Backup',
  'settings-data-export': 'Export',
  'settings-data-import': 'Import',
  'settings-data-desc': 'Save and restore your sidebar channel/folder structure as a JSON file.',
  'settings-data-exported': 'Exported',
  'settings-data-imported': 'Imported',
  'settings-data-import-err': 'Failed to load (invalid format)',
  // Preset
  'preset-load': 'Load',
  'preset-share': 'Code Sharing',
  'preset-copy-title': 'Copy as code',
  'preset-copied': 'Code copied',
  'preset-fetching': 'Fetching channels...',
  'preset-imported': 'Imported',
  'preset-import-err': 'Invalid code',
  'preset-code-ph': 'Paste import code (vt~…)',
  // Folder
  'folder-new-name': 'Folder',
  'folder-new-dialog': 'New Folder',
  'folder-create': 'Create',
  'folder-rename': 'Rename folder',
  'folder-refresh': 'Refresh all channels in folder',
  'folder-delete': 'Delete folder',
  'folder-delete-confirm': 'Delete folder "{name}"? (channels will remain)',
  'folder-refresh-confirm': 'Refresh {count} channel(s) in "{name}"?',
  'folder-refresh-ok': 'Refresh',
  'folder-delete-ok': 'Delete',
  'folder-color': 'Folder color',
  // Channel
  'ch-refresh-title': 'Refresh videos',
  'ch-delete-title': 'Delete',
  'ch-delete-confirm': 'Delete "{name}"?',
  'ch-delete-ok': 'Delete',
  'ch-already-added': '"{name}" is already registered',
  'ch-import-done': '{count} videos fetched',
});

// ── 外部言語: JSON インポート ───────────────────────────────────

// JSON テキストを解析して言語を登録し localStorage に永続化する
function loadLangJSON(jsonText) {
  const data = JSON.parse(jsonText.replace(/^\uFEFF/, ''));
  const { code, label, dict } = data;
  if (!code || !label || typeof dict !== 'object' || Array.isArray(dict)) {
    throw new Error('invalid lang JSON');
  }
  registerLang(code, label, dict);
  try {
    const saved = JSON.parse(localStorage.getItem('thumb-ext-langs') || '[]');
    const idx = saved.findIndex(x => x.code === code);
    if (idx >= 0) saved[idx] = { code, label, dict };
    else saved.push({ code, label, dict });
    localStorage.setItem('thumb-ext-langs', JSON.stringify(saved));
  } catch (e) {}
  return { code, label };
}

// 前回セッションで登録した外部言語を復元する
(function () {
  try {
    const saved = JSON.parse(localStorage.getItem('thumb-ext-langs') || '[]');
    saved.forEach(function (item) { registerLang(item.code, item.label, item.dict); });
  } catch (e) {}
})();

// 組み込み ja のキーをもとに空テンプレート JSON をダウンロードする
function downloadLangTemplate() {
  const keys = Object.keys(_I18N_DICTS['ja'] || {});
  const en = _I18N_DICTS['en'] || {};
  const dict = {};
  keys.forEach(function (k) { dict[k] = en[k] !== undefined ? en[k] : ''; });
  const template = {
    _instructions: {
      code:  'BCP-47 language code, e.g. "ko", "fr", "es"',
      label: 'Display name in native script, e.g. "한국어", "Fran\u00e7ais"',
      dict:  'Translate every value. Keep {placeholder} tokens as-is.',
      usage: 'Drop this file (or paste its content) into the language dialog.',
    },
    code:  'XX',
    label: 'Language Name',
    dict,
  };
  const json = '\uFEFF' + JSON.stringify(template, null, 2);
  const a = document.createElement('a');
  a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
  a.download = 'thumb-lang-template.json';
  a.click();
}
