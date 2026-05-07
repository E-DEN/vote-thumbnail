# サムネランキング 設計・要件統合メモ

このドキュメントは要件定義と設計判断を一本化したもの。
別 AI セッションへの引き継ぎ用として、単なる仕様列挙ではなく判断理由を記述する。

---

## サービス概要

特定タレントの YouTube チャンネルのサムネを2択投票し、Glicko-2 レーティングで人気順にランキングするサービス。

- ログイン不要
- 不特定ユーザーが任意の YouTube チャンネル URL を入力
- 動画サムネを2択投票
- Glicko-2 レーティングでランキング化
- 最新動画サムネを定期反映
- 秒単位リアルタイムは不要（数時間遅延は許容）

---

## 主要課題

- YouTube API quota
- Bot / 荒らし
- DB 肥大化
- API 同期アクセス

---

## 技術スタック

| 役割 | 選択 |
|---|---|
| フロントエンド | HTML/JS（シンプル構成） |
| バックエンド/DB | Cloudflare Workers + D1 |
| 短期データ | Cloudflare KV |
| YouTube 取得 | YouTube Data API v3（サーバーサイド） |

---

## 機能要件

### 投票

- ランダムに2枚のサムネを表示、好きな方をクリックで投票
- 1日あたりの上限あり（IP 日次制限）
- ログイン不要

### ランキング

- 当日一定数以上の投票済み IP のみ閲覧可能

### サムネ取得

- YouTube Data API v3 で対象チャンネルの動画一覧を取得
- 初回 or 定期更新で DB に保存

---

## UX フロー

```text
1. トップ -> 「投票してランキングを見る」ボタン
2. 2択サムネ表示 -> クリックで投票
3. 投票完了 -> 「ランキングを見る」ボタン出現
4. ランキングページ（当日のみ有効）
```

---

## アーキテクチャ基本思想

特に重要なのは：

```text
ユーザーアクセス時に YouTube API を直接叩かない
```

理由：

- API quota 枯渇
- Bot による大量アクセス
- レスポンス悪化
- キャッシュ不能

が起きるため。

```text
user -> DB
           ↑
        worker
           ↑
        YouTube
```

の非同期構成を前提にしている。

この設計により：

- API 使用量を大幅削減
- DB キャッシュ中心化
- RSS 主軸化
- 個人運営でも成立可能

を狙う。

---

## YouTube API 方針

### 検索 API は使わない

`search.list` は 100 units 消費するため、公開サービスでは quota が即死する。

そのため：

- チャンネル検索 UI は作らない
- YouTube URL / @handle 入力のみ対応

にする。

例：

```text
https://www.youtube.com/@example
https://www.youtube.com/channel/UCxxxx
```

---

## チャンネル解決

### `/channel/UCxxxx`

そのまま channelId として使用。

API 不要。

---

### `@handle`

YouTube HTML から：

```html
"channelId":"UCxxxx"
```

を抽出。

API 消費なし。

DOM変更に備えて実装は抽象化しておく。

---

## 動画取得

### 基本方針

ユーザーアクセス時に YouTube API を叩かない。

```text
user -> DB
           ↑
        worker
           ↑
        YouTube
```

---

### 初回登録

1. channelId 解決
2. DB 確認
3. 未登録なら YouTube 取得
4. DB 保存
5. 更新キューへ登録

---

### 定期更新

バックグラウンド worker / cron で更新。

例：

| 状態 | 更新間隔 |
|---|---|
| 新規登録直後 | 10分 |
| アクティブ | 1時間 |
| 放置 | 24時間 |

---

## YouTube Data API 使用箇所

### 初回のみ

#### channels.list

uploads playlist ID を取得。

比較的軽量。

---

### 継続更新

#### playlistItems.list

最新動画一覧取得。

比較的軽量。

---

## RSS 活用

YouTube RSS:

```text
https://www.youtube.com/feeds/videos.xml?channel_id=UCxxxx
```

取得可能：

- 最新動画
- タイトル
- 公開日時
- videoId

quota 消費なし。

可能な限り RSS を主軸にする。

---

## サムネ URL

動画サムネは URL 規則があるため API 不要。

例：

```text
https://i.ytimg.com/vi/VIDEO_ID/maxresdefault.jpg
```

---

## キャッシュ戦略

### 基本思想

「閲覧要求」と「YouTube取得」を分離する。

NG:

```text
user -> youtube
```

OK:

```text
user -> DB
           ↑
        worker
           ↑
        youtube
```

---

### dedupe

同一チャンネル更新はまとめる。

例：

```text
最終更新5分以内ならfetch禁止
```

---

### inactive 化

長期間アクセスされていないチャンネルは更新停止。

例：

```text
90日アクセスなし -> inactive
```

---

## 荒らし対策

### 基本思想

完全防御ではなく：

```text
荒らしコストを上げる
```

を目的にする。

---

## IP 制限

### 生IPは保存しない

Workers で取得した IP をハッシュ化して保存。

例：

```text
sha256(ip + yyyy-mm-dd + secret)
```

保存されるのは hash のみ。

---

### 日替わり salt

日付を混ぜることで：

- 同日重複判定可能
- 日跨ぎ追跡不可

になる。

---

## Cookie 併用

IP のみだと：

- 同一Wi-Fi
- モバイル NAT

問題がある。

そのため匿名 Cookie を併用。

例：

```text
randomUUID()
```

---

## Turnstile

Cloudflare Turnstile を導入。

- 無料
- CAPTCHA感が薄い
- Cloudflare と相性が良い

初回登録時や連続アクセス時に使用。

---

## レートリミット方針

### 目的

本人認証ではなく：

```text
荒らしコストを上げる
```

ことが目的。

そのため、制限条件は可能な限り曖昧化する。

---

### 制限回数を表示しない

以下は避ける：

```text
あと3回投票できます
1分後に解除されます
```

理由：

- BOT が閾値探索しやすくなる
- VPN / サブ回線切替タイミングを最適化される
- 制限条件に合わせた自動化が容易になる

ため。

---

### 曖昧な UI を採用

数値ではなく：

- 活動量
- 投票ペース
- クールダウン
- 混雑状態

のような抽象表現を使う。

例：

```text
投票ペースが高くなっています
少し時間を空けてください
```

---

### ゲージ UI

具体回数は表示せず、バーや状態表示のみ。

例：

```text
██████░░░░
```

または：

```text
Stable
Busy
Cooling
```

など。

数値・割合・残り時間は表示しない。

---

### 内部実装方針

単純固定回数ではなく、sliding window / スコア方式を想定。

例：

| 行動 | 負荷 |
|---|---|
| 通常投票 | +1 |
| 高速連投 | +5 |
| 異常速度 | +20 |

時間経過で減衰。

これにより：

- BOT 最適化を難化
- 境界値探索を困難化
- 自動化コスト上昇

を狙う。

---

### 完全拒否だけでなく遅延も使う

必要に応じて：

- 数秒待機
- 応答遅延
- 一時 cooldown

を混ぜる。

人間には許容範囲でも、BOT 側にはコストになる。

---

### エラーメッセージは固定化

例：

```text
現在投票ペースが高いため、少し待ってから再試行してください
```

「あと◯秒」「残り◯回」などは表示しない。

---

## Rate Limit

Cloudflare 側で制限。

例：

```text
1分20req
```

---

## 危険ポイント

### 一番危険

無限チャンネル登録。

Bot により：

- RSS fetch
- API fetch
- DB 肥大化

が発生する。

---

## 対策

### 「登録」と「閲覧」を分離

#### 新規登録

- Turnstile 必須
- Rate limit 強め

#### 既存閲覧

軽量。

---

## 保存期間・TTL設計

### 基本思想

長期個人識別は目的ではない。

目的は：

```text
短期レート制限
短期荒らし対策
```

であるため、IP由来データは短期間のみ保持する。

---

### 推奨保持期間

| データ | 保持期間 |
|---|---|
| 日次投票判定 | 24〜48h |
| 短期レート制限 | 数分〜24h |
| cooldown | 数分〜数時間 |
| 一時BAN | 数日〜数週間 |

---

### 日替わりsalt

IP hash は：

```text
sha256(ip + yyyy-mm-dd + secret)
```

を想定。

これにより：

- 同日重複判定可能
- 翌日追跡不可
- 長期識別不能

となる。

---

## D1 と TTL

### D1 にはネイティブ TTL がない

D1 は SQLite 系のため：

```text
自動expire
```

機能は基本ない。

---

### D1 で TTL を行う場合

`expires_at` を持つ。

例：

```sql
CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER,
  expires_at TEXT
);
```

---

### cleanup cron

定期 worker で削除。

例：

```sql
DELETE FROM rate_limits
WHERE expires_at < CURRENT_TIMESTAMP
```

---

## KV 利用方針

短期データは KV を優先。

理由：

- ネイティブ TTL 対応
- 軽量 read
- レート制限と相性が良い
- cleanup 不要

---

### KV 使用候補

| 用途 | 理由 |
|---|---|
| ip_hash | 短命 |
| cooldown | 一時データ |
| rate_limit | TTL 向き |
| temporary flags | 一時用途 |
| anonymous session | 長期不要 |

---

### KV 例

```js
await env.RATE_LIMIT_KV.put(
  key,
  value,
  { expirationTtl: 86400 }
)
```

---

## Durable Objects 検討

Cloudflare Durable Objects も候補。

ただし今回は：

```text
リアルタイム同期
```

要求がそこまで強くないため、ややオーバー気味。

現時点では：

```text
D1 + KV
```

を優先。

---

## 評価アルゴリズム

### 比較検討

| | Elo | TrueSkill | Glicko-1 | Glicko-2 |
|---|---|---|---|---|
| 不確実性モデル | K係数で代替（手動ハック） | σ (Bayesian) | RD（自動） | RD + 安定性σ（自動） |
| 設計目的 | 1v1 | チーム戦向け | 1v1 | 1v1 |
| 実装コスト | 低 | 高 | 中 | 中 |
| ライセンス | 自由 | Microsoft特許あり | 自由 | 自由 |
| 低対戦数の扱い | Kファクターで近似 | 自動 | RDで自動 | RDで自動 |

### 採用: Glicko-2

Elo を採用しない理由：

- K係数（低対戦:K=64、高対戦:K=32）は不確実性の手動近似にすぎない
- 対戦数が少ないサムネの信頼度を「DB外の表示ロジック」で補う必要がある

TrueSkill を採用しない理由：

- 元々チーム戦向けの設計で2択投票には過剰
- Microsoft 特許が商用利用に制約を与えうる
- 実装コストが最も高い

Glicko-1 ではなく Glicko-2 を採用する理由：

- RD（レーティング偏差）が低対戦数サムネの信頼度を原理的に表現する
- 安定性パラメータ σ により、対戦相手によって評価がぶれるサムネを検出できる
- Glicko-1 との実装コスト差は小さく、精度向上のメリットが上回る
- サムネは静的オブジェクトなので σ は低い値に収束し、悪影響はない

### Glicko-2 パラメータ

| パラメータ | 初期値 | 説明 |
|---|---|---|
| rating (r) | 1500 | レーティング本体 |
| rd | 350 | レーティング偏差（不確実性）。対戦を重ねると低下 |
| volatility (σ) | 0.06 | 安定性。低いほど一貫した評価 |
| τ（システム定数） | 0.5 | σ の変化幅を制御。基本そのまま |

RD が高いサムネは信頼度が低い → ランキング表示時に視覚的に薄くする（要件通り）。

---

## 推奨役割分担

| 用途 | 保存先 |
|---|---|
| 動画情報 | D1 |
| channels | D1 |
| Glicko-2 レーティング | D1 |
| votes raw | D1 |
| ip_hash | KV |
| cooldown | KV |
| rate_limit | KV |
| 一時BAN | KV |

---

## DBメモ

### videos

```sql
CREATE TABLE videos (
  video_id      TEXT    PRIMARY KEY,
  channel_id    TEXT,
  title         TEXT,
  thumbnail_url TEXT,
  rating        REAL    DEFAULT 1500,
  rd            REAL    DEFAULT 350,
  volatility    REAL    DEFAULT 0.06,
  wins          INTEGER DEFAULT 0,
  battles       INTEGER DEFAULT 0,
  published_at  TEXT
);
```

`rd` が高いサムネは対戦数が少なく信頼度が低い。ランキング表示時に視覚的に薄くする等の判断に使う。

---

### channels

```sql
CREATE TABLE channels (
  channel_id   TEXT PRIMARY KEY,
  title        TEXT,
  icon_url     TEXT,
  last_checked TEXT,
  inactive     INTEGER DEFAULT 0
);
```

---

### daily_votes

```sql
CREATE TABLE daily_votes (
  ip_hash  TEXT PRIMARY KEY,
  voted_at TEXT
);
```

---

## 未決事項・懸念

- IP 制限はモバイル・同一ネットワークで精度が低い（軽い制限として割り切る）
- 同一チャンネルで同じ画像のサムネが複数ある場合 → 別エンティティとして扱う（Glicko-2 で自然分散）
- 投票者が少数の初期は Glicko-2 も収束しない → RD が高いまま表示されるため視覚的に信頼度が低い旨は伝わる
- 別リポジトリで開発するか未決定

---

## 全体結論

成立性は十分ある。

特に重要な設計判断：

- `search.list` を避ける
- URL入力限定
- ユーザーアクセス時に YouTube 取得しない
- RSS 主軸
- 非同期更新
- DB キャッシュ前提
- 生IPを保存しない
- レーティングは Glicko-2 採用（RD が信頼度を自動管理）
- レートリミットの制限値・残り回数は表示しない（数値が見えると閾値探索・スパム自動化の標的になるため）

この構成なら、個人〜中規模サービスとしてかなり現実的。
