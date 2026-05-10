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
    themeBtn.title = t(isDark ? 'mode-dark' : 'mode-light');
  }
}

// ── 組み込み: 日本語 ──────────────────────────────────────────
registerLang('ja', '日本語', {
  // アプリ
  'app-title':  'ラブ♥ねいる',
  // モード
  'mode-dark':  'ダークモード',
  'mode-light': 'ライトモード',
  // ヘッダー
  'lang-switch': '言語切り替え',
  // サイドバー
  'sidebar-logo':   'ラブ♥ねいる',
  'search-ph':      'URL / @handle を追加',
  'search-add':     '追加',
  'group-manage':   'グループ管理',
  'ungrouped':      'チャンネル',
  'ch-count-unit':  'チャンネル',
  // チャンネルヘッダー
  'tab-vote':    '投票',
  'tab-list':    '一覧',
  'tab-ranking': 'ランキング',
  'cat-videos':  '動画',
  'cat-shorts':  'ショート',
  'cat-live':    'ライブ',
  // ウェルカム
  'no-channel-selected': 'チャンネルを選択してください',
  'welcome-add-label': 'チャンネルを追加',
  'welcome-add-btn':   '追加',
  'welcome-opt':       '省略可',
  'welcome-save':      '保存',
  'welcome-api-note':  '過去動画すべてを取得するには YouTube API キーの設定が必要です。',
  'welcome-help-link': '使い方ガイドを見る',
  // 投票
  'vote-counter-pre':  'これまでの投票: ',
  'vote-counter-post': ' 回',
  'no-videos-in-cat':  'このカテゴリには動画がありません。',
  'ranking-settled':   'すべての組み合わせの評価が確定しました。',
  'tutorial-vote-text': '好きなサムネイルをクリックして投票。結果はランキングに反映されます。',
  'tutorial-got-it':    'わかった',
  // 投票ペースゲージ
  'pace-stable':  '安定',
  'pace-fast':    '速い',
  'pace-blazing': '猛速',
  // ランキング
  'ranking-h2':     'ランキング',
  'rank-subtitle':  '{count} 件 / {cat}',
  'more-btn':       'もっと見る（あと {n} 件）',
  'pts':            'pts',
  'wins-fmt':       '{w}勝 / {b}戦',
  'winrate-fmt':    ' · {r}%',
  'rating-label':   'レーティング',
  'battles-label':  '戦数',
  'wins-label':     '勝利',
  'winrate-label':  '勝率',
  'rank-label':     '順位',

  // ステータス
  'added-no-api':               '追加しました (APIキーなし)',
  'invalid-url':                'URLの形式が不正です',
  'fetching-channel':           'チャンネル情報を取得中...',
  'fetching-videos':            '動画ID取得中: {cur}/{total}',
  'fetching-details':           '動画詳細を取得中...',
  'fetching-details-progress':  '詳細取得中: {cur}/{total}',
  'error-msg':                  'エラー: {msg}',
  // モーダル
  'modal-close': '閉じる',
  'yt-btn':      'YouTube で見る',
  // リアクション
  'reactions-open':    'リアクション',
  'reactions-pins':    'Pins',
  'reactions-heatmap': 'Heatmap',
  'reactions-back':    '戻る',
  'reactions-color':   'カラー',
  'reactions-you':     'あなた',
  // ソート
  'sort-views':  '再生数',
  'sort-date':   '投稿日',
  'sort-rating': 'レーティング',
  'sort-random': 'ランダム',
  // 表示フォーマット
  'views-100m': '{n}億回視聴',
  'views-10k':  '{n}万回視聴',
  'views-1k':   '{n}千回視聴',
  'views-raw':  '{n}回視聴',
  'views-short-100m': '{n}億',
  'views-short-10k':  '{n}万',
  'views-short-raw':  '{n}',
  'time-now':   'たった今',
  'time-min':   '{n}分前',
  'time-hour':  '{n}時間前',
  'time-day':   '{n}日前',
  'time-week':  '{n}週間前',
  'time-month': '{n}ヶ月前',
  'time-year':  '{n}年前',
  // 言語インポート
  'lang-import-drop':  'JSONファイルをドロップ',
  'drop-hint':         'またはクリックして選択',
  'lang-import-or':    'または JSON テキストを貼り付け',
  'lang-import-ph':    '{"code":"ko","label":"한국어","dict":{...}}',
  'lang-import-apply': '適用',
  'lang-import-err':   '言語ファイルの読み込みに失敗しました',
  'lang-add':          '＋ 追加',
  'lang-cancel':       'キャンセル',
  'lang-template-dl':  'テンプレートをDL',
  // 設定モーダル
  'settings-title':          '設定',
  'settings-tab-display':    '表示',
  'settings-tab-lang':       '言語',
  'settings-tab-apikey':     'APIキー',
  'settings-tab-sidebar':    'データ',
  'settings-theme-label':    'テーマ',
  'settings-theme-dark':     'ダーク',
  'settings-theme-light':    'ライト',
  'settings-close':          '閉じる',
  'settings-apikey-label':   'YouTube APIキー',
  'settings-apikey-save':    '保存',
  'settings-apikey-delete':  '削除',
  'settings-apikey-guide':     'API キーの発行方法',
  'settings-apikey-guide-url': 'https://www.youtube.com/watch?v=9VJ_7tVEDUQ',
  'settings-apikey-err-empty':  'APIキーを入力してください',
  'settings-apikey-err-format': '形式が正しくありません（AIzaSy... で始まる39文字）',
  'settings-apikey-saved':   '保存しました',
  'err-refresh-failed':      '再取得に失敗しました',
  'err-apikey-invalid-details': 'APIキーが無効なため再生数・長さを取得できませんでした',
  'channel-already-added':   '「{name}」はすでに登録済みです',
  'settings-rssonly-label':  'RSSのみ取得（最新15件）',
  'settings-rssonly-desc':   'APIキーを無視してRSSだけで取得。',
  'settings-data-label':     'バックアップ',
  'settings-data-export':    'エクスポート',
  'settings-data-import':    'インポート',
  'settings-data-desc':      'サイドバーのチャンネル・フォルダ構成を JSON ファイルとして保存・復元します。',
  'settings-data-exported':  'エクスポートしました',
  'settings-data-imported':  'インポートしました',
  'settings-data-import-err': '読み込みに失敗しました（形式が正しくありません）',
});

// ── 組み込み: 英語 ────────────────────────────────────────────
registerLang('en', 'English', {
  // App
  'app-title':  'Love♥Nail',
  // Mode
  'mode-dark':  'Dark mode',
  'mode-light': 'Light mode',
  // Header
  'lang-switch': 'Switch language',
  // Sidebar
  'sidebar-logo':   'Love♥Nail',
  'search-ph':      'URL / @handle to add',
  'search-add':     'Add',
  'group-manage':   'Manage groups',
  'ungrouped':      'Channels',
  'ch-count-unit':  'channels',
  // Channel header
  'tab-vote':    'Vote',
  'tab-list':    'List',
  'tab-ranking': 'Ranking',
  'cat-videos':  'Videos',
  'cat-shorts':  'Shorts',
  'cat-live':    'Live',
  // Welcome
  'no-channel-selected': 'Select a channel',
  'welcome-add-label': 'Add channel',
  'welcome-add-btn':   'Add',
  'welcome-opt':       'optional',
  'welcome-save':      'Save',
  'welcome-api-note':  'A YouTube API key is required to fetch all past videos.',
  'welcome-help-link': 'View usage guide',
  // Vote
  'vote-counter-pre':  'Votes so far: ',
  'vote-counter-post': '',
  'no-videos-in-cat': 'No videos in this category.',
  'ranking-settled':  'All matchups have been settled.',
  'tutorial-vote-text': 'Click the thumbnail you prefer to vote. Results are reflected in the ranking.',
  'tutorial-got-it':    'Got it',
  // Vote pace gauge
  'pace-stable':  'Steady',
  'pace-fast':    'Fast',
  'pace-blazing': 'Blazing',
  // Ranking
  'ranking-h2':    'Ranking',
  'rank-subtitle': '{count} items / {cat}',
  'more-btn':      'Show more ({n} remaining)',
  'pts':           'pts',
  'wins-fmt':      '{w}W / {b}',
  'winrate-fmt':   ' · {r}%',
  'rating-label':  'Rating',
  'battles-label': 'Battles',
  'wins-label':    'Wins',
  'winrate-label': 'Win rate',
  'rank-label':    'Rank',
  // Status
  'added-no-api':               'Added (no API key)',
  'invalid-url':                'Invalid URL format',
  'fetching-channel':           'Fetching channel info...',
  'fetching-videos':            'Fetching video IDs: {cur}/{total}',
  'fetching-details':           'Fetching video details...',
  'fetching-details-progress':  'Fetching details: {cur}/{total}',
  'error-msg':                  'Error: {msg}',
  // Modal
  'modal-close': 'Close',
  'yt-btn':      'Watch on YouTube',
  // リアクション
  'reactions-open':    'Reaction',
  'reactions-pins':    'Pins',
  'reactions-heatmap': 'Heatmap',
  'reactions-back':    'Back',
  'reactions-color':   'Color',
  'reactions-you':     'You',
  // Sort
  'sort-views':  'Views',
  'sort-date':   'Date',
  'sort-rating': 'Rating',
  'sort-random': 'Random',
  // Format
  'views-100m': '{n}00M views',
  'views-10k':  '{n}0K views',
  'views-1k':   '{n}K views',
  'views-raw':  '{n} views',
  'views-short-100m': '{n}00M',
  'views-short-10k':  '{n}0K',
  'views-short-raw':  '{n}',
  'time-now':   'just now',
  'time-min':   '{n}m ago',
  'time-hour':  '{n}h ago',
  'time-day':   '{n}d ago',
  'time-week':  '{n}w ago',
  'time-month': '{n}mo ago',
  'time-year':  '{n}y ago',
  // Language import
  'lang-import-drop':  'Drop JSON file here',
  'drop-hint':         'or click to select',
  'lang-import-or':    'or paste JSON text below',
  'lang-import-ph':    '{"code":"ko","label":"한국어","dict":{...}}',
  'lang-import-apply': 'Apply',
  'lang-import-err':   'Failed to load language file',
  'lang-add':          '+ Add',
  'lang-cancel':       'Cancel',
  'lang-template-dl':  'Download template',
  // Settings modal
  'settings-title':          'Settings',
  'settings-tab-display':    'Display',
  'settings-tab-lang':       'Language',
  'settings-tab-apikey':     'API Key',
  'settings-tab-sidebar':    'Data',
  'settings-theme-label':    'Theme',
  'settings-theme-dark':     'Dark',
  'settings-theme-light':    'Light',
  'settings-close':          'Close',
  'settings-apikey-label':   'YouTube API Key',
  'settings-apikey-save':    'Save',
  'settings-apikey-delete':  'Delete',
  'settings-apikey-guide':     'How to issue an API key',
  'settings-apikey-guide-url': 'https://www.youtube.com/watch?v=uz7dY8qTFJw',
  'settings-apikey-err-empty':  'Please enter an API key',
  'settings-apikey-err-format': 'Invalid format (39 characters starting with AIzaSy...)',
  'settings-apikey-saved':   'Saved',
  'err-refresh-failed':      'Refresh failed',
  'err-apikey-invalid-details': 'Invalid API key: could not fetch view count or duration',
  'channel-already-added':   '"{name}" is already registered',
  'settings-rssonly-label':  'RSS only (latest 15)',
  'settings-rssonly-desc':   'Fetch via RSS only, ignoring the API key.',
  'settings-data-label':     'Backup',
  'settings-data-export':    'Export',
  'settings-data-import':    'Import',
  'settings-data-desc':      'Save and restore your sidebar channel/folder structure as a JSON file.',
  'settings-data-exported':  'Exported',
  'settings-data-imported':  'Imported',
  'settings-data-import-err': 'Failed to load (invalid format)',
});

// ── 外部言語: JSON インポート ───────────────────────────────────

// JSON テキストを解析して言語を登録し localStorage に永続化する
function loadLangJSON(jsonText) {
  const data = JSON.parse(jsonText);
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
  const json = JSON.stringify(template, null, 2);
  const a = document.createElement('a');
  a.href = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
  a.download = 'thumb-lang-template.json';
  a.click();
}
