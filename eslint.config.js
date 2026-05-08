// eslint.config.js — vote-thumbnail コードスタイルルール
// 使い方: npx eslint public/js/
export default [
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        localStorage: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        fetch: 'readonly',
        alert: 'readonly',
        confirm: 'readonly',
      },
    },
    rules: {
      // --- コメントスタイル ---
      // セクション区切りの形式: // --- 説明 ---
      'spaced-comment': ['error', 'always'],

      // --- 空行ルール ---
      // 連続空行は最大1行まで（2行以上禁止）
      'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 1, maxBOF: 0 }],

      // --- 変数宣言 ---
      // var 禁止（const / let のみ）
      'no-var': 'error',

      // 再代入のない変数は const に
      'prefer-const': ['warn', { destructuring: 'any' }],

      // --- 等値比較 ---
      // == 禁止・=== 必須（null チェックのみ例外）
      'eqeqeq': ['error', 'always', { null: 'ignore' }],

      // --- 未使用変数 ---
      // _ プレフィックスの引数は意図的なので警告対象外
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
];
