# 釣りいち

GPS位置情報 × 釣り × ハクスラ（トレハン）のスマホブラウザゲーム。Three.js + Vite + TypeScript。

## 遊び方

1. **地図**: 現在地のまわりに釣りスポット（川・湖・池・海）が出現。黄色い点線の範囲（60m）に入ったスポットで釣りができる
2. **釣り**: タップでキャスト → ウキが沈んだら（HIT!）タップ → **押して巻く／離して緩める** でテンションを管理しながら巻き取る
   - テンション100% → ライン切れ／緩めすぎが続く → バラシ
3. **ハクスラ**: 釣った魚から装備（ロッド・リール・ライン・ルアー・お守り）がドロップ。レア度（ノーマル／マジック／レア／レジェンダリー）とランダムなオプション付き。不要品は分解してコインに
4. **図鑑**: 魚種ごとに昼／夜・場所で釣れるものが違う

スポットは位置から決定的に生成されるので、同じ場所なら誰でも同じスポットになる。各スポットの魚は5匹まで、3分で1匹回復。

## 開発

```bash
npm install
npm run dev
```

- 好きな場所から試すときは `?at=緯度,経度`（例: `?at=35.6084,139.6990`）
- PCや位置情報なしで試すときは `?sim` を付ける（例: `http://localhost:5173/?sim`）。十字キー／矢印キーで移動、スポットの「ワープ」でテスト移動
- スマホ実機でGPSを使うには **HTTPS** が必要（GitHub Pagesなど）。`main` へのpushで `.github/workflows/deploy.yml` がPagesにデプロイする（リポジトリ設定 → Pages → Source を「GitHub Actions」に）

## 3D魚モデル

海の魚（シーバス・マダイ・ブリ・アジなど20種）は **Fish Kit**（写真から作った3Dモデルと動き、CC0 1.0）を使っている。

- 本体: `src/vendor/fish-kit/fish-kit.js`（three.js r187 用。README・LICENSE も同じ場所）
- モデルと頭の写真: `public/fish-kit/`
- 魚種とキットの対応は `src/data/fish.ts` の `kitId`（イサキは28cm未満なら幼魚モデル `young`）
- 釣りの段階に合わせて動きを切り替える: 寄ってくる `turn` → 食いつき `bite` → ファイト `hooked`（終盤は `tired`）→ 抜き上げ `air`
- 釣り糸は `getMouth()` で魚の口につながる

川・湖・池の魚と、キットにない魚（カジキ等）は手続き生成モデル。

### 自前の GLB/GLTF に差し替える

`public/models/fish/` に GLB/GLTF を置き、`public/models/fish/manifest.json` に登録すると、その魚種は手続き生成モデルの代わりに表示される（コード変更不要）。

```json
{
  "models": {
    "koi":  { "url": "models/fish/koi.glb" },
    "madai": { "url": "models/fish/madai.glb", "forward": "-z", "scale": 1.0, "animation": "Swim" }
  }
}
```

- `forward`: モデルの頭が向いている軸（`+x` 既定 / `-x` / `+z` / `-z`）
- サイズは自動で正規化され、釣れた魚の体長に合わせて拡大縮小される
- アニメーションがあれば再生（`animation` で名前指定、省略時は最初のクリップ）
- 魚種IDの一覧は `src/data/fish.ts`
- 優先順位: manifest の GLB/GLTF → Fish Kit → 手続き生成

## 構成

| ファイル | 内容 |
| --- | --- |
| `src/geo.ts` | GPS監視・シミュレーション移動・スポット生成 |
| `src/loot.ts` | 魚の抽選・報酬・装備生成（アフィックス） |
| `src/data/fish.ts` / `src/data/gear.ts` | 魚種・装備・アフィックスのデータ |
| `src/state.ts` | セーブ（localStorage）・ステータス計算 |
| `src/fishing/FishingView.ts` | 3D釣りシーンとファイトのミニゲーム |
| `src/fishing/fishModels.ts` | 魚モデル読み込み（GLB / Fish Kit / 手続き生成） |
| `src/vendor/fish-kit/` | Fish Kit 本体（CC0） |
| `src/ui/*` | 地図・装備・図鑑の画面 |
