# Contributing to vote-thumbnail

## アーキテクチャ概要

```text
vote-thumbnail/
├── public/             # フロントエンド（ビルドステップなし）
│   ├── index.html
│   ├── help.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js      # エントリーポイント・初期化・ルーティング
│       ├── i18n.js     # 翻訳エンジン（registerLang / t / applyLang）
│       └── lang.js     # 言語切り替え UI・外部言語インポート
├── server/
│   └── index.js        # Cloudflare Worker エントリーポイント（API + Cron）
├── db/
│   ├── schema.sql      # テーブル定義
│   ├── seed.sql        # モックデータ（ローカル開発用）
│   ├── seed-reactions.mjs  # reactions ランダム生成スクリプト
│   └── reset.sql       # 全テーブル DELETE（ローカルリセット用）
└── docs/
    └── decisions.md    # 設計判断の記録（why だけを書く）
```

## インフラ構成

| 役割 | サービス | デプロイ方法 |
| --- | --- | --- |
| API サーバー | Cloudflare Workers | `main` ブランチへの push で自動デプロイ |
| データベース | Cloudflare D1（SQLite 互換） | `wrangler d1 execute` |
| レート制限 | Cloudflare KV | `wrangler kv` |
| 静的配信 | Workers Static Assets | Workers と同時デプロイ |

### ブランチ運用

- `develop` — 開発ブランチ
- `main` — 本番ブランチ（Workers Builds が自動ビルド）

```bash
git checkout main
git merge develop
git push origin main
git checkout develop
git push origin develop
```

---

## API エンドポイント

| メソッド | パス | 説明 |
| --- | --- | --- |
| `POST` | `/api/channels` | チャンネル登録（handle / 動画URL から解決） |
| `GET` | `/api/channels` | 登録チャンネル一覧 |
| `DELETE` | `/api/channels/:id` | チャンネル削除 |
| `GET` | `/api/videos` | 動画一覧（チャンネル・カテゴリ・ソート指定可） |
| `GET` | `/api/pair` | 投票用ペア取得 |
| `POST` | `/api/vote` | 投票送信 |
| `POST` | `/api/reactions` | リアクションピン記録 |
| `GET` | `/api/reactions/:videoId` | リアクション一覧取得 |

---

## ローカル開発

### 必要なもの

| ツール | バージョン | 用途 |
| --- | --- | --- |
| [Node.js](https://nodejs.org/) | v18 以上 | wrangler 実行環境 |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) | v4 以上 | Worker + D1 エミュレーション |
| VS Code [Live Server](https://marketplace.visualstudio.com/items?itemName=ritwickdey.LiveServer) 等 | - | フロントエンド配信 |

## 起動手順

```bash
npm install

# DB 初期化（初回のみ）
npm run db:init        # wrangler d1 execute ... --file=db/schema.sql
npm run db:seed        # wrangler d1 execute ... --file=db/seed.sql

# 開発サーバー（http://localhost:8787）
npm run dev
```

> ホットリロードが欲しい場合は `npm run dev:hot`（browser-sync 併用）。

### DB 操作

> wrangler dev を起動すると D1 のローカル SQLite が `.wrangler/state/v3/d1/` 以下に作成される。`seed-reactions.mjs` はこのパスを自動検出する。

```bash
# reactions ダミーデータ投入
node db/seed-reactions.mjs --channel UC... --count 30

# seed データのみ削除
node db/seed-reactions.mjs --channel UC... --clear-seed

# 全テーブル DELETE
sqlite3 .wrangler/state/v3/d1/<hash>/<db>.sqlite ".read db/reset.sql"
```

---

## 本番デプロイ

Cloudflare ダッシュボードで GitHub リポジトリを接続すると、`main` への push で Workers Builds が自動デプロイする。

```bash
# D1・KV 作成（初回のみ）
wrangler d1 create vote-thumbnail
wrangler kv namespace create RATE_LIMIT_KV

# wrangler.toml の database_id / KV id を更新後
wrangler secret put YOUTUBE_API_KEY
wrangler secret put ALLOWED_ORIGIN   # 本番ドメイン（例: https://example.com）
```

---

## コーディング規約

### JavaScript

- セクション区切り: `// --- 説明 ---`（ダッシュ3本・前後スペースあり）
- `//` の後にスペース1個
- 連続空行は最大1行（2行以上禁止）
- `var` 禁止（`const` / `let` のみ）
- ソースコードに絵文字禁止（i18n 文字列も含む）

### HTML

- セクション区切りコメント: `<!-- --- セクション名 --- -->`（JS と同様の3ダッシュスタイル）
- インラインコメント: `<!-- 説明 -->`（単一行）
- `title` 属性は必ず `data-i18n-title="キー名"` を使う。ハードコードは不可
  - JS が動的に `title` を変更する要素（`rsPlayBtn` / `rsTheaterBtn` 等）は `data-i18n-title` で初期値を与える

---

## 多言語対応（i18n）

新しいキーを追加する場合は **ビルトイン2言語すべて** に追加してください。

| ファイル | 対象言語 |
| --- | --- |
| `js/i18n.js` | `ja` / `en` |

外部言語 JSON をインポートする機能があるため、新キーを追加する際は外部言語ファイル作成者に周知することを推奨しますが、必須ではありません。

---
