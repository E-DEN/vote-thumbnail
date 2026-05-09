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
  'welcome-title': 'チャンネルを選択してください',
  'welcome-sub':   '左のサイドバーからチャンネルを選ぶか、URLを入力して追加してください。',
  // 投票
  'vote-counter-pre':  'これまでの投票: ',
  'vote-counter-post': ' 回',
  'skip':              'スキップ',
  'no-videos-in-cat':  'このカテゴリには動画がありません。',
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
  // グループモーダル
  'group-modal-title':  'グループ管理',
  'group-name-ph':      'グループ名',
  'group-create':       '作成',
  'group-select':       '← グループを選択してください',
  'no-groups':          'グループはまだありません',
  'del-title':          '削除',
  'del-group-confirm':  '「{name}」を削除しますか？',
  'group-channels':     'グループ内のチャンネル',
  'add-channels-label': '追加できるチャンネル',
  'no-ch-in-group':     'まだチャンネルがありません',
  'remove-from-group':  'グループから削除',
  'all-added':          '全チャンネルが追加済みです',
  'add-ch-btn':         '＋ 追加',
  'url-add-ph':         'URLまたは@handleで新規登録（Enterで連続追加）',
  'register':           '登録',
  'group-exists':       '「{name}」は既に存在します',
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
  'welcome-title': 'Select a channel',
  'welcome-sub':   'Choose a channel from the sidebar, or paste a URL to add one.',
  // Vote
  'vote-counter-pre':  'Votes so far: ',
  'vote-counter-post': '',
  'skip':             'Skip',
  'no-videos-in-cat': 'No videos in this category.',
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
  // Group modal
  'group-modal-title':  'Manage groups',
  'group-name-ph':      'Group name',
  'group-create':       'Create',
  'group-select':       '← Select a group',
  'no-groups':          'No groups yet',
  'del-title':          'Delete',
  'del-group-confirm':  'Delete "{name}"?',
  'group-channels':     'Channels in group',
  'add-channels-label': 'Add channels',
  'no-ch-in-group':     'No channels yet',
  'remove-from-group':  'Remove from group',
  'all-added':          'All channels added',
  'add-ch-btn':         '+ Add',
  'url-add-ph':         'URL or @handle to register (Enter to add more)',
  'register':           'Add',
  'group-exists':       '"{name}" already exists',
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
