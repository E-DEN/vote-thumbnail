# Reaction Pin / Attention Map 設計書

## 概要

サムネイル画像に対して「どこへ惹かれたか」をユーザーが pin として置き、
その集積から Attention Heatmap を生成する機能。

2択投票・Glicko-2 ランキングが「どの画像が人気か」を測るのに対し、
本機能は「人間が画像のどこへ惹かれるか」を観測することを目的とする。

---

## 設計方針の経緯

当初は Attention Map として「クリック地点を直接ヒートマップ入力」する設計を検討した。
しかしいくつかの課題が見えたため、Reaction Pin 方式へ転換した。

**Attention Map (直接入力) の課題**

- 「分析ツール感」が強く、ユーザーに「どこ押せばいいか」が直感的に伝わらない
- クリックの意味が曖昧（熱量表現なのか正確な1点入力なのか）
- 誤クリック時に undo / 確認 UI が必要になり UX が重くなる
- 連打・BOT 対策が複雑化しやすい

**Reaction Pin の利点**

- 「好きな場所へ pin を置く」として直感的に理解できる
- 最新位置のみ保持（1人1pin）なので押し直しで自然に修正できる
- 1人1pin なのでスパム効率が低く、高度な対策が不要
- ヒートマップは pin の集積から自動生成できる（UX と統計生成が一致）

**結論**: ユーザー操作は Reaction Pin に統一し、Heatmap は閲覧専用の生成物として扱う。

---

## データモデル

### pin レコード（サーバー側 DB）

| フィールド | 型 | 説明 |
|-----------|-----|------|
| `video_id` | string | YouTube 動画 ID |
| `session_id` | string | 匿名セッション識別子（Cookie 等） |
| `x` | float 0.0–1.0 | 画像内相対 X 座標 |
| `y` | float 0.0–1.0 | 画像内相対 Y 座標 |
| `updated_at` | datetime | 最終更新日時（UPSERT） |

座標は画像サイズ非依存の相対座標とする。
PC・スマホ・レスポンシブ等の表示差異を吸収するため。

---

## ヒートマップ生成

### 密度ベース描画

固定スコア制は採用しない。
画像ごとにユーザー数・クリック総数が大きく異なるため、
その画像内での相対密度として描画する。

描画時には「その画像内で最も密集した場所」を 100% として正規化する。

### KDE アプローチ

各 pin を中心に Gaussian blur を重ねることで密度分布を生成する（KDE に近い考え方）。
「このピクセルを押した」ではなく「この周辺へ関心が集まった」という傾向を滑らかに表現する。

### diminishing returns（入力重み逓減）

将来的に1ユーザーの連続入力に重みを付ける場合は、
1回目 → 強い寄与・2回目 → やや弱い のように log / sqrt 的な圧縮を適用する。
現状の「1人1pin」設計ではこの処理は不要。

---

## アニメーション仕様

### 再生ロジック

- DB 登録順ではなく、density（集積密度）ベースでタイムラインを再構成する
- density の高いホットゾーンほど短い間隔で pin が出現する
- 全ホットゾーンが並列で独立して発火し、複数エリアが同時進行で見える
- 特定エリアへの過密集中時は全件を律儀に表示せず間引く（傾向を見せることが目的）

### pin の表示挙動

- 出現: scale 0.6 + opacity 0 → scale 1.0 + opacity 1（約 300ms）
- 滞在: ゆっくり上方向へ浮き上がる（約 20–24s）
- 消滅: opacity フェードアウト
- density が高い pin ほど表示サイズを大きくする（scale = 0.8 + density × 0.8）
- 同一座標付近の密集時はスキップ確率を上げて間引く（最大表示数 48 件を上限）

### リプレイ

- 再生終了後は一呼吸置いてから（約 1–2s）自動リプレイ
- リプレイ前に pins をリセット、タイムラインを再生成

### モード切り替え

- **Reaction Pins**: アニメーション pin 表示
- **Heatmap**: 全 pin を radial-gradient で重ねた静止ヒートマップ表示

---

## アルゴリズムメモ（実装用）

### weightedPick

density の合計を分母として乱数で選択する重み付きランダム。
density が高いシードほど選ばれやすい。

```js
function weightedPick(items) {
  const total = items.reduce((s, item) => s + item.density, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.density;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}
```

### compressTimeline

同一座標付近（距離 < 0.035）に既存 pin が多いほど skip 確率を上げて間引く。

```js
function compressTimeline(events) {
  const out = [];
  for (const ev of events) {
    const nearby = out.filter(e => {
      const dx = e.x - ev.x, dy = e.y - ev.y;
      return Math.sqrt(dx * dx + dy * dy) < 0.035;
    }).length;
    if (Math.random() >= Math.min(0.82, nearby * 0.08)) out.push(ev);
  }
  return out;
}
```

### densityDelay（クラスタごとの発火間隔）

density が高いほど短い間隔で発火する。べき乗カーブで優遇。

```js
function densityDelay(density) {
  // density: 0.0–1.0 → delay: 520ms–28ms
  return 520 - Math.pow(density, 0.42) * (520 - 28);
}
```

### randomGaussian（Box-Muller 法）

pin の散布にガウス分布を使用。seed 座標を中心にした自然な広がりを生成する。

```js
function randomGaussian() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
```

---

## 今後のアイデア（未確定）

- 他ユーザーの pin がアニメーションで登場する（マリメの死亡ピンのイメージ）
- density に応じてホットゾーンには pin が連続して素早く刺さる（表示速度を変えるのではなく発火頻度を変える）
- アニメーション終了後は一呼吸置いて自動リプレイ
- pin の登場順は DB 登録順ではなく density ベースで再構成
- 複数エリアに並行してリアクション表示（シリアルでなくパラレル）
- 密集エリアは全件表示せず傾向だけ見せる
- ヒートマップ表示への切り替えも可能
- 顔・文字・色・構図による視線誘導の分析への発展
