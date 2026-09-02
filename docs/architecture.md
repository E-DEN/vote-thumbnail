# VT コードベース地図（リファクタリング用）

> Agent 向け: `public/js/app.js`（2,606 行）を全読みせず、まずこのファイルで位置を特定し、必要な範囲だけ `read_file` すること。
> 行番号は 2026-09-02 時点。抽出が進むごとに更新する。

## ファイル一覧

| パス | 行数 | 役割 | 状態 |
| --- | --- | --- | --- |
| `public/js/app.js` | 2,606 | PC ビュー全部 | **分割対象** |
| `public/js/youtube-api.js` | 164 | YouTube API クライアント・全動画 import | Phase 1 抽出済み |
| `public/js/sidebar-order.js` | 57 | サイドバー順序 LS・正規化 | Phase 1 抽出済み・共通 |
| `public/js/router.js` | 106 | ハッシュ管理・PC 画面切替 | Phase 1 抽出済み・共通 |
| `public/js/theme.js` | 24 | テーマ保存・DOM 反映 | Phase 1 抽出済み・共通 |
| `public/js/share.js` | 136 | PC 共有リンク生成・インポート | Phase 1 抽出済み |
| `public/js/settings.js` | 414 | PC 設定モーダル・データ入出力 | Phase 1 抽出済み |
| `public/js/list-view.js` | 337 | PC 一覧・ソート・無限スクロール | Phase 1 抽出済み |
| `public/js/ranking-view.js` | 156 | PC ランキング一覧・depth 表示 | Phase 1 抽出済み |
| `public/js/vote-view.js` | 216 | PC 投票カード・ペースゲージ・クリック委譲 | Phase 1 抽出済み |
| `public/js/sidebar-drag.js` | 583 | PC サイドバー D&D | Phase 1 抽出済み |
| `public/js/sidebar.js` | 1,058 | PC サイドバー描画・操作 | Phase 1 抽出済み |
| `public/js/video-meta.js` | 88 | PC メタHTML・レート順位マップ・概要欄 | Phase 1 抽出済み |
| `public/js/channel-add.js` | 231 | PC チャンネル追加・ウェルカムフォーム・URLデコードペースト | Phase 1 抽出済み |
| `public/js/state.js` | 49 | LS キー・`state` オブジェクト・カラーパレット | 共通 |
| `public/js/storage.js` | 70 | channels/videos の LS 保存、API→フロント変換、`filteredVideos` | 共通 |
| `public/js/channel.js` | 48 | APIキー・RSS Only 取得、`channelKeyFromInput` | 共通 |
| `public/js/rating.js` | 195 | Glicko-2・投票ペア管理 | 共通 |
| `public/js/format.js` | 96 | 数値/時間/概要欄フォーマット | 共通 |
| `public/js/reactions-utils.js` | 233 | ReactionPin の KDE・クラスタ・ピン DOM 生成 | 共通 |
| `public/js/i18n.js` / `lang.js` | 585 / 244 | 翻訳 | 共通 |
| `public/js/toast.js` | 405 | トースト | 共通 |
| `public/js/depth-gallery.js` | 658 | ランキング depth 表示（three.js 系） | PC 専用 |
| `public/mobile/js/app.js` | 2,836 | モバイル ビュー（reaction 以外） | 分割候補 |
| `public/mobile/js/reaction.js` | 1,320 | モバイル ReactionPin タブ | |
| `public/mobile/js/ui-helpers.js` | 31 | SVG 定数・メタ構築 | |
| `public/mobile/js/shared-state.js` | 5 | `_suppressHistory` | |
| `public/_worker.js` | 894 | Pages Worker（API） | 別レイヤ |

## `public/js/app.js` セクション別マップ

| 行 | セクション | 主な関数 | 抽出先案 |
| --- | --- | --- | --- |
| 71–157 | ReactionPin グローバル / 投票適用 | `applyPinPalette` `reactionsComputeKde` `applyVote` `_pollRefresh` `loadRating` | `reactions-view.js` / `vote.js` |
| 159–184 | チャンネル動画ロード / 空状態 | `loadChannelVideos`（未使用・削除候補） `_renderEmptyCat` | `channel-view.js` |
| 抽出済み | 投票ビュー | `configureVoteView` `updatePaceGauge` `renderVote` | `vote-view.js`（`_renderEmptyCat` と `applyVote` を注入） |
| 抽出済み | メタ・概要欄ヘルパー | `_rebuildRatingRankMap` `openVideoDesc` `closeVideoDesc` `_buildVideoMeta` `_buildPinDot` `_buildReactionsVideoMeta` | `video-meta.js`（`_reactionsMyPins` `_reactionsPinColor` の getter を注入） |
| 抽出済み | サイドバー描画 | `initSidebarUi` `buildChannelItem` `renderSidebar` ほか | `sidebar.js` |
| 191–247 | チャンネル選択 | `selectChannel` | `app.js` に残す（コア） |
| 250–817 | ReactionPin PC ビュー | `loadMyPins` `loadReactionSeeds` `postReaction` `renderReactionsHeatmap` `startReactionsLoop` `showMyReactionsPin` `openReactionsMode` `openModalReactions` `renderReactionsPlaylist` `openThumbModal` | **`reactions-view.js`**（判断保留） |
| 818–865 | list / ranking / vote / router / sidebar / share / channel-add 設定 | `configureListView` `configureRankingView` `configureVoteView` `configureRouter` `configureSidebar` `configureShare` `configureChannelAdd` | 各モジュール初期化 |
| 抽出済み | チャンネル追加 | `addChannelFromSidebarInput` `applyUrlDecodePaste` `initChannelAdd` | `channel-add.js`（`selectChannel` を注入） |
| 867–872 | テーマ設定 | `configureTheme` | `theme.js` 初期化 |
| 873–1513 | `init()` 本体（約 640 行） | イベント配線の塊 | 各モジュールの `initXxx()` に分配 |
| 1515 | チャンネル追加イベント配線 | `initChannelAdd()` | `channel-add.js` 初期化 |
| 1517–1524 | 設定モジュール初期化 | `initSettings` | `settings.js` 初期化 |
| 1525–1594 | タブ / カテゴリフィルタ / チュートリアル | | `router.js` / `vote-view.js` |
| 1595–end | サイドバーリサイズ | | `sidebar.js` |

## `public/mobile/js/app.js` セクション別マップ

| 行 | セクション | PC 対応物 |
| --- | --- | --- | --- |
| 36–107 | `selectChannel` `syncChannelMeta` | PC 257 |
| 108–468 | チャンネルパネル（`_makeChCard` `_makeFolderEl` `renderChannelPanel`） | PC sidebar.js 相当 |
| 469–690 | 共有インポート / 削除ポップアップ / フォルダ名ダイアログ | PC `_importFromShareCode` `_showShareImportPopup` `_showChDelPopup` |
| 691–1324 | D&D | PC `initSidebarDrag` |
| 1325–1517 | チャンネルメニュー・共有・リフレッシュ・削除・追加 | PC `share.js` / 3051–3198 |
| 1518–1584 | タブ切替 / 空状態 | PC `showView` |
| 1585–1897 | 一覧 / 投票 / ランキング | PC 各 view |
| 1898–2000 | 概要シート | PC `openVideoDesc` |
| 2001–2078 | テーマ設定 / 設定モーダル | PC `configureTheme` / 設定モーダル |
| 2079–end | 初期化 | PC `init()` |

## PC ↔ Mobile 重複ロジック（共通化候補・優先度順）

| # | ロジック | PC | Mobile | 備考 |
| --- | --- | --- | --- |
| 1 | **最多カテゴリ選択** | `loadChannelVideos` / `selectChannel` / `addChannelFromSidebarInput`（3 箇所コピペ） | `selectChannel` | 純関数 `pickDominantCategory(videos)` を `storage.js` へ |
| 2 | **ソート済みプール構築** | `_buildSortedPool` | `_buildListPool` / `_mRsBuildSortedPool` | 3 実装。`sortVideos(pool, key, dir)` を `storage.js` へ |
| 3 | サイドバー順序 LS | `sidebar-order.js` | `sidebar-order.js` | **共通化済み** |
| 4 | ハッシュ build/parse | `router.js` | `router.js` | **共通化済み**（形式差は別 export） |
| 5 | 共有リンク import 本体（fetch → ポップアップ → channels 更新 → refresh ループ） | `share.js` | `_mImportFromShareCode` | PC 抽出済み。Mobile 共通化は Phase 2 |
| 6 | チャンネル追加（入力解析 → POST → channels 更新 → 初回 import） | `channel-add.js` | `addChannel` | PC 抽出済み。Mobile 共通化は Phase 2 |
| 7 | `applyTheme` | `theme.js` | `theme.js` | **共通化済み** |
| 8 | ReactionPin 共通（KDE・クラスタ・パレット・ピン DOM） | `reactionsComputeKde` 等 | `mRsComputeKde` 等 | 既に `reactions-utils.js` があるので薄いラッパーを削除 |
| 9 | `loadMyPins` / `loadReactionSeeds` / `postReaction` | 325–366 | reaction.js 46 | API 呼び出しは `reactions-api.js` へ |
| 10 | 削除確認ポップアップ | `_showChDelPopup` | `_mShowDelPopup` | UI 差異あり。共通化しない（規約だけ揃える） |

**あえて共通化しないもの**: D&D 実装（PC マウス / Mobile タッチで挙動が別物）、サイドバー vs チャンネルパネルの DOM 構築、ランキング depth 表示。

## 非対称点（設計判断が必要）

- **全動画 import の実行場所**: PC の全件 import はクライアント側 `youtube-api.js`、Mobile と管理用 `db/full-refresh.mjs` はサーバー側 `/refresh` に委譲する。全件更新は Worker の判定ロジックに統一する。

### 管理者用全チャンネル更新

- `db/full-refresh.mjs` は D1 の `channels` から `inactive = 0` のチャンネルを取得し、各チャンネルの `/api/channels/:id/refresh` を順番に呼ぶ。
- SQL は生成しない。カテゴリ判定、削除・非公開動画の `is_hidden` 更新、動画メタデータ更新は Worker に任せる。
- 実行: `node db/full-refresh.mjs`。待ち時間は `REFRESH_INTERVAL_MS` で変更できる。

## リファクタリング手順（トークン節約前提）

- **Phase 1（機械的分割・低コストモデル可）**: 上表「抽出先案」の太字モジュールを 1 つずつ切り出す。**1 モジュール = 1 コミット**。関数本体は移動のみ、ロジック変更禁止。`import/export` を足して `eslint` が通ることを確認。
  - 推奨順: ~~`youtube-api.js`~~ → ~~`sidebar-order.js`~~ → ~~`router.js`~~ → ~~`theme.js`~~ → ~~`share.js`~~ → ~~`settings.js`~~ → ~~`list-view.js`~~ → ~~`ranking-view.js`~~ → ~~`vote-view.js`~~ → `reactions-view.js`（判断保留） → ~~`sidebar-drag.js`~~ → ~~`sidebar.js`~~ → ~~`video-meta.js`~~ → ~~`channel-add.js`~~
  - 各コミット後の確認: `npx eslint public/js` + ブラウザで該当画面を 1 回開く
- **Phase 2（判断あり・通常モデル）**: 重複表 #1〜#9 を共通化。Mobile 側も同時に差し替える。
- **Phase 3**: 規約を `CONTRIBUTING.md` に追記、`.github/copilot-instructions.md` に Agent ルール（この地図を先に読む・1 モジュール 1 コミット・コミットは指示があるまでしない 等）を記載。
- **Phase 4（保留）**: GF との思想比較。第三サービスが見えた時点で着手。

## 作業時の注意

- `reactions-view.js` は先頭のReaction状態群と後半のTransport IIFE・設定イベントが同じ可変状態を双方向更新する。単純移動では大量のsetterが必要なため、高級モデルで状態境界を設計してから抽出する。
  - 既知の潜在バグ（抽出前から存在）: `startReactionsLoop` から Transport IIFE 内の `_communityLimit` を参照している（フォールバック経路のため実質到達不能）。画像クリックハンドラから IIFE 内の `_mutedAll` に代入しており、`REACTIONS_MAX_PINS === 0` でピンを立てると ReferenceError になる。抽出時に状態境界と合わせて解消する。
- `init()`（873–1513）は DOM イベント配線の塊。モジュール抽出時は該当部分を `initXxx()` としてモジュール側に移し、`init()` から呼ぶ。
- 新規ファイルは **UTF-8 BOM なし・CRLF・末尾改行あり**。エディタのファイル作成ツールは BOM を付けることがあるので、コミット前に先頭バイトと末尾を確認する。
- `window.xxx = xxx` で公開している関数（例: `openModalReactions`）は `depth-gallery.js` 等から参照されている。抽出時は `window` 公開を維持する。
- PC/Mobile で同名関数（`selectChannel` `renderList` `applyTheme`）が別実装なので、共通化する際は名前衝突に注意。

## 動画の非表示状態

- 動画の分類（`videos` / `shorts` / `live`）と非表示状態（`is_hidden`）は別カラムで管理する。
- 削除・非公開動画はカテゴリを保持したまま `is_hidden = 1` とし、動画 API の返却対象から除外する。
- `db/migrate-hidden.sql` は既存の `category = 'hidden'` を `is_hidden` へ移行する専用 migration。過去の `db/migrate.sql` は再実行しない。
