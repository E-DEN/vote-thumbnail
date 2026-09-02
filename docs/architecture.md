# VT コードベース地図（リファクタリング用）

> Agent 向け: `public/js/app.js`（5,505 行）を全読みせず、まずこのファイルで位置を特定し、必要な範囲だけ `read_file` すること。
> 行番号は 2026-09-02 時点。抽出が進むごとに更新する。

## ファイル一覧

| パス | 行数 | 役割 | 状態 |
| --- | --- | --- | --- |
| `public/js/app.js` | 5,505 | PC ビュー全部 | **分割対象** |
| `public/js/youtube-api.js` | 164 | YouTube API クライアント・全動画 import | Phase 1 抽出済み |
| `public/js/sidebar-order.js` | 57 | サイドバー順序 LS・正規化 | Phase 1 抽出済み・共通 |
| `public/js/router.js` | 106 | ハッシュ管理・PC 画面切替 | Phase 1 抽出済み・共通 |
| `public/js/theme.js` | 24 | テーマ保存・DOM 反映 | Phase 1 抽出済み・共通 |
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
| 21–46 | APIキーエラー | `markApiKeyError` | `channel.js` |
| 47–135 | ReactionPin グローバル / 投票適用 | `applyPinPalette` `reactionsComputeKde` `applyVote` `_pollRefresh` `loadRating` | `reactions-view.js` / `vote.js` |
| 137–164 | チャンネル動画ロード / 空状態 | `loadChannelVideos` `_renderEmptyCat` | `channel-view.js` |
| 165–376 | 投票ビュー | `updatePaceGauge` `renderVote` | **`vote-view.js`** |
| 377–443 | メタ・概要欄ヘルパー | `_rebuildRatingRankMap` `openVideoDesc` `closeVideoDesc` `_buildVideoMeta` `_buildPinDot` `_buildReactionsVideoMeta` | `video-meta.js` |
| 444–731 | 一覧ビュー | `_updateSortUI` `renderList` `_buildSortedPool` `_appendGalleryPage` `_normalizeSortBtnWidths` `_renderGrid` `_appendGridPage` | **`list-view.js`** |
| 732–844 | ランキングビュー | `renderRankingItems` `renderRanking` `_renderRankingDepth` `getTopRankedVideo` | **`ranking-view.js`** |
| 845–1831 | サイドバー描画 | `_showShareImportPopup` `_showChDelPopup` `deleteChannel` `deleteFolder*` `_showCompactTooltip` `_showFolderColorPop` `_showCompactRename` `buildChannelItem` `buildFolderItem` `renderSidebar` | **`sidebar.js`**（約 1,000 行） |
| 1832–2403 | サイドバー D&D | `initSidebarDrag` | **`sidebar-drag.js`**（約 570 行） |
| 2404–2461 | チャンネル選択 | `selectChannel` | `app.js` に残す（コア） |
| 2463–3036 | ReactionPin PC ビュー | `loadMyPins` `loadReactionSeeds` `postReaction` `renderReactionsHeatmap` `startReactionsLoop` `showMyReactionsPin` `openReactionsMode` `openModalReactions` `renderReactionsPlaylist` `openThumbModal` | **`reactions-view.js`**（約 570 行） |
| 3041–3301 | 共有リンク・チャンネル追加 | `_postShareLink` `_shareChannelLink` `_shareFolderLink` `_importFromShareCode` `addChannelFromSidebarInput` | **`share.js`** / `channel-add.js` |
| 3302–3308 | テーマ設定 | `configureTheme` | `theme.js` 初期化 |
| 3309–3970 | `init()` 本体（660 行） | イベント配線の塊 | 各モジュールの `initXxx()` に分配 |
| 3971–4032 | URL デコードペースト / サイドバーイベント / ウェルカム | | `sidebar.js` / `channel-add.js` |
| 4033–4423 | 設定モーダル（390 行） | | **`settings.js`** |
| 4424–4493 | タブ / カテゴリフィルタ / チュートリアル | | `router.js` / `vote-view.js` |
| 4494–end | サイドバーリサイズ | | `sidebar.js` |

## `public/mobile/js/app.js` セクション別マップ

| 行 | セクション | PC 対応物 |
| --- | --- | --- | --- |
| 36–107 | `selectChannel` `syncChannelMeta` | PC 2405 |
| 108–468 | チャンネルパネル（`_makeChCard` `_makeFolderEl` `renderChannelPanel`） | PC sidebar.js 相当 |
| 469–690 | 共有インポート / 削除ポップアップ / フォルダ名ダイアログ | PC `_importFromShareCode` `_showShareImportPopup` `_showChDelPopup` |
| 691–1324 | D&D | PC `initSidebarDrag` |
| 1325–1517 | チャンネルメニュー・共有・リフレッシュ・削除・追加 | PC 3041–3301 |
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
| 5 | 共有リンク import 本体（fetch → ポップアップ → channels 更新 → refresh ループ） | `_importFromShareCode` | `_mImportFromShareCode` | UI ポップアップだけ差し替え可能にして本体を `share.js` へ |
| 6 | チャンネル追加（入力解析 → POST → channels 更新 → 初回 import） | `addChannelFromSidebarInput` | `addChannel` | 入力解析・POST 部分を `channel-add.js` へ |
| 7 | `applyTheme` | `theme.js` | `theme.js` | **共通化済み** |
| 8 | ReactionPin 共通（KDE・クラスタ・パレット・ピン DOM） | `reactionsComputeKde` 等 | `mRsComputeKde` 等 | 既に `reactions-utils.js` があるので薄いラッパーを削除 |
| 9 | `loadMyPins` / `loadReactionSeeds` / `postReaction` | 2475–2516 | reaction.js 46 | API 呼び出しは `reactions-api.js` へ |
| 10 | 削除確認ポップアップ | `_showChDelPopup` | `_mShowDelPopup` | UI 差異あり。共通化しない（規約だけ揃える） |

**あえて共通化しないもの**: D&D 実装（PC マウス / Mobile タッチで挙動が別物）、サイドバー vs チャンネルパネルの DOM 構築、ランキング depth 表示。

## 非対称点（設計判断が必要）

- **全動画 import の実行場所**: PC はクライアント側 `youtube-api.js` の `importAllChannelVideos`（YouTube API 直叩き → `/videos/batch`）、Mobile はサーバー側 `/refresh` に委譲。`_worker.js` に `fetchAllVideosViaApi` があるため **PC も `/refresh` に寄せてクライアント側 YouTube API クライアントを削除できる**可能性が高い。Phase 2 で検討。

## リファクタリング手順（トークン節約前提）

- **Phase 1（機械的分割・低コストモデル可）**: 上表「抽出先案」の太字モジュールを 1 つずつ切り出す。**1 モジュール = 1 コミット**。関数本体は移動のみ、ロジック変更禁止。`import/export` を足して `eslint` が通ることを確認。
  - 推奨順: ~~`youtube-api.js`~~ → ~~`sidebar-order.js`~~ → ~~`router.js`~~ → ~~`theme.js`~~ → `share.js` → `settings.js` → `list-view.js` → `ranking-view.js` → `vote-view.js` → `reactions-view.js` → `sidebar-drag.js` → `sidebar.js`
  - 各コミット後の確認: `npx eslint public/js` + ブラウザで該当画面を 1 回開く
- **Phase 2（判断あり・通常モデル）**: 重複表 #1〜#9 を共通化。Mobile 側も同時に差し替える。
- **Phase 3**: 規約を `CONTRIBUTING.md` に追記、`.github/copilot-instructions.md` に Agent ルール（この地図を先に読む・1 モジュール 1 コミット・コミットは指示があるまでしない 等）を記載。
- **Phase 4（保留）**: GF との思想比較。第三サービスが見えた時点で着手。

## 作業時の注意

- `init()`（3309–3970）は DOM イベント配線の塊。モジュール抽出時は該当部分を `initXxx()` としてモジュール側に移し、`init()` から呼ぶ。
- `window.xxx = xxx` で公開している関数（例: `openModalReactions`）は `depth-gallery.js` 等から参照されている。抽出時は `window` 公開を維持する。
- PC/Mobile で同名関数（`selectChannel` `renderList` `applyTheme`）が別実装なので、共通化する際は名前衝突に注意。
