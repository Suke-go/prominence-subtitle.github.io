# キネティック韻律文字 — 実装アーキテクチャ
*Prosody-to-kinetic-typography: system architecture*

Claim: 韻律の時間構造を文字の時間的変形へ規則的に翻訳する視覚言語を設計・自動生成し、文字に声の臨場感を与える。
このClaimを実装に落とすと、核心は **「韻律イベント → 文字形態素(時間的変形プリミティブ)」の翻訳規則を、データとして分離された文法(Grammar)に置く** ことにある。文法を差し替えるだけで実験条件・アブレーション・デザイン探索ができる構成にする。

---

## 0. 全体像(6層)

```
 L0 Audio capture        AudioWorklet 16 kHz mono (live) / 動画音声デコード (offline)
 L1 Acoustic front-end   F0, energy, band energy, spectral flux, ZCR, spectral tilt, syllable nuclei   [WASM/SIMD]
 L2 Prosodic event parser 連続特徴 → 離散韻律イベント列 {type, t, strength, params}             [JS/WASM, causal]
 L3 Grammar (視覚言語)    イベント → 文字形態素 + パラメータ写像。JSONで宣言的に記述。差し替え可能
 L4 Choreographer        イベント+語アライメント → 音節単位のキーフレーム列。衝突解決・予算・平衡不変条件
 L5 Renderer             時刻の決定的関数としてグリフ変形を描画(DOM/CSS → Canvas/WebGL)
 ── cross-cutting ──
 A  Text alignment       ASR語タイミング + 音節→書記素割当
 B  Speaker baseline     話者のF0/音量/テンポの走行中央値(「高い声・低い声」は常に相対)
 C  Telemetry            イベント・描画ログ(実験の操作チェック・再現性)
```

**同じL3〜L5を、オフライン(実験刺激・再現性)とライブ(マイク)の両方で使う。** L1〜L2はPython参照実装(オフライン・テスト用)とWASM実装(ライブ)の二重化、出力フォーマットを共通にして等価性テストを置く。

---

## 1. L1 音響フロントエンド(WASM/SIMD)

フレーム10ms・窓25〜50ms。すべて因果(look-ahead ≤ 200ms)。

| 特徴 | 計算 | 使う韻律次元 |
|---|---|---|
| F0(半音, 話者中央値基準) | YIN/pYIN軽量版 + 平滑化 | 音高軌道・音調型・声の高さ |
| エネルギー包絡(RMS) | 25ms窓 | プロミネンス・音量 |
| 帯域エネルギー(300–2000 Hz) | バンドパス+RMS | 音節核検出 |
| スペクトル流束(オンセット鋭さ) | フレーム間差分 | 破裂音性 → 動きの硬さ |
| ZCR / 高域比 | — | 摩擦音性 → 震え |
| スペクトル傾斜(H1–H2近似) | 低域/高域エネルギー比 | 声の太さ・暗さ(「バス」) |
| 音節核 | 帯域包絡のピーク(既存 syllable.wasm) | 音節単位・テンポ |
| ACN プロミネンス | 既存 acn-runtime / acn-model-acoustic-v1 | プロミネンス |

既存資産: `wasm/syllable.wasm`, `js/acn-runtime.js`, `js/acn-wasm-runtime.js`, `js/acn-features.js`, `js/worklets/`。
Python参照実装: `scratchpad/extract_f0.py`, `extract_syl.py`(本番では `tools/` へ移す)。

## 2. L2 韻律イベントパーサ(ToBI-lite)

連続特徴を**離散イベント+連続パラメータ**に変換する。視覚言語の「語彙」はここで決まる。

```ts
type ProsodicEvent =
  | { type:'PROM',   t, syl, strength:0..1, localZ }                 // 強調(ピッチアクセント)
  | { type:'BOUND',  t, kind:'rise'|'fall'|'level', slope, pauseMs } // 句末・音調型
  | { type:'REGISTER', t0,t1, pitch:'high'|'low'|'mid', depth }       // 声の高さの区間
  | { type:'VOICE',  t0,t1, quality:'dark'|'bright'|'breathy', depth } // 声の質(太い・明るい)
  | { type:'TEMPO',  t0,t1, rate, accel }                              // 速さ・加速
  | { type:'PAUSE',  t0,t1 }                                           // 間
  | { type:'ONSET',  t, sharp, noise, len }                            // 音節の音響的質(修飾用)
```

- PROM: ACN推定 + 局所z(近傍±1.5s)。強度は連続値、発火は閾値/上位K(L4の予算と分離)。
- BOUND: ポーズ(>250ms)または句末伸長 + 末尾200msのF0回帰 → rise/fall/level。
- REGISTER/VOICE/TEMPO: 走行中央値からの偏差が一定時間続いた区間として検出(ヒステリシス)。
- すべてに **confidence** を付け、低信頼は L3 で「無変形」に落とす(誤った表情は無表情より有害)。

## 3. L3 Grammar — 視覚言語の文法(JSON)

イベント → **文字形態素(temporal morpheme)** の写像。形態素は「時間を持つ変形プリミティブ」で、必ず平衡に戻る。

| 形態素 | 変形(時間関数) | 既定の対応イベント |
|---|---|---|
| `hop` | 予備動作→跳躍→着地→整定 | PROM |
| `swell` | weight/サイズの包絡(立ち上がり速・減衰緩・痕跡) | PROM(控えめ版) |
| `rise` / `sink` | 句末の文字が上へ伸び上がる / 沈む → 戻る | BOUND rise / fall |
| `bassify` | 沈む+太る+横に広がる(低く太い声) | VOICE dark, REGISTER low |
| `lift` | 細く上ずる(高い声) | REGISTER high |
| `breath` | 間の呼吸(ピル収縮・· · ·) | PAUSE |
| `rush` / `drag` | 文字の出現密度・字送りの緩急 | TEMPO |
| `shiver` | 微小振動 | ONSET noise(修飾) |
| `snap` | 立ち上がり時間の短縮 | ONSET sharp(修飾) |
| `stretch` | 横伸び | ONSET len(修飾) |

文法ファイルの形:

```json
{
  "name": "full-v1",
  "rules": [
    { "on": "PROM",  "if": "localZ > 0.6", "do": "hop",  "params": { "height": "9 + 16*strength", "dur": "0.55 / (1 + 0.35*sharp)" }, "priority": 3 },
    { "on": "BOUND", "if": "kind == 'rise'", "do": "rise", "params": { "amount": "4*slope" }, "priority": 2 },
    { "on": "VOICE", "if": "quality == 'dark' && depth > 0.5", "do": "bassify", "params": { "weight": "+200*depth", "sink": "3*depth" }, "priority": 1 },
    { "on": "PAUSE", "if": "dur > 0.6", "do": "breath" }
  ],
  "budget": { "moversPerChunk": 2, "maxEventsPerSec": 1.5 },
  "invariants": { "lineEquilibrium": true, "settleWithin": 0.6 }
}
```

**文法を差し替える=実験条件を作る**:
- `full-v1`: 全次元
- `static-equiv`: 同じイベントを静的変形(太字・サイズ)へ — 時間同型性の対照(P3)
- `shifted-150ms`: 全変形を+150ms遅延 — 同期の必要性(P3)
- `shuffled`: イベントを別の語へ割り当て — 装飾効果の対照
- `prom-only` / `bound-only` / `voice-only`: 次元アブレーション(P2 読解可能性)

## 4. L4 Choreographer

入力: イベント列 + 語アライメント + 音節→書記素割当。出力: 音節ラン(文字列の部分区間)ごとのキーフレーム列。

1. **割当**: 各イベントを担当する音節ラン(強勢音節、句末音節、区間内全音節)に結びつける。
2. **衝突解決**: 1音節ランに同時刻1形態素(priorityで勝者決定)。修飾(snap/shiver/stretch)は勝者形態素のパラメータに畳み込む。
3. **予算**: チャンク内 movers ≤ K、毎秒イベント数 ≤ N。**静止が既定**。
4. **不変条件**: 行の重心は水平(すべての変形は平均ゼロ・settleWithin以内に原点へ)。連続区間形態素(bassify等)は行全体に一様に掛けて平衡を保つ。
5. **レイテンシ補償**: ライブでは語オンセットが事後にしか分からないため、形態素は「イベント検出時刻から開始」し、予備動作を省く短縮版(≤120ms)に自動切替。
6. 出力は**時刻の純関数**(状態積分なし): `pose(run, t) → {tx, ty, sx, sy, rot, wght, alpha}`。シーク・巻き戻し・録画に対して決定的。

## 5. L5 Renderer

- プロトタイプ: DOM + CSS transform + 可変フォント(`font-variation-settings: "wght"`)。現行 Playground がこれ。
- 本実装: Canvas 2D または WebGL(MSDF)で **グリフ単位**の変形(文字ごとの伸び上がり、部分的な太さ変化)。DOMでは音節ラン単位が限界。
- 実験埋め込み: `experiments/subtitle_experiment/plugins/plugin-video-subtitle.js` に L4 の `pose()` を差し込む(オフライン事前計算のキーフレームJSONを読むだけ)。
- 視覚文法のデバッガ: 現行 Playground の X-ray を「イベントレーン表示(PROM/BOUND/VOICE/TEMPO)」に拡張し、どのイベントがどの形態素を発火したかを可視化 → 文法の編集UIを兼ねる(TextAlive的な authoring レイヤー)。

## 6. A/B/C 横断コンポーネント

- **A テキスト整列**: オフライン = whisper-timestamped(既存 step3)。ライブ = ストリーミングASR(Web Speech / whisper.cpp-wasm)の語タイミング + 音節核による書記素割当(既存 extract_syl の方式)。
- **B 話者ベースライン**: F0・RMS・音節率の指数移動中央値。REGISTER/VOICE/TEMPO はすべてこれとの差分。話者が変われば自動で追従。
- **C テレメトリ**: イベント列・発火した形態素・描画パラメータをフレーム時刻付きで記録。実験では操作チェック(「この条件で実際に何が何回動いたか」)と、動き密度と負荷の関係分析に使う。

## 7. 実験との接続

| 検証項目 | 実装上の操作 |
|---|---|
| P1 臨場感 | 文法 `full-v1` vs `static-equiv` vs `normal`、音声なし/ありの2水準 |
| P2 読解可能性 | `prom-only`/`bound-only`/`voice-only`:音声を消し、動きだけから音高方向・速さ・声の高低を当てる課題 |
| P3 時間同型性 | `shifted-150ms`, `shuffled`, `static-equiv` |
| P4 可読性コスト | 実験Aの指標(理解・可読性・NASA-TLX)をそのまま。movers K を振る |
| P5 自動生成妥当性 | 自動文法 vs 人手振り付け(TextAlive様式で作成)の比較 |

## 8. ビルド順序

1. **M1 オフライン骨格(2週)**: L2 パーサ(Python)で6クリップのイベント列を生成 → Grammar v0(JSON)→ L4/L5 を Playground から切り出してモジュール化 → 文法差し替えで条件刺激を出せる状態。
2. **M2 視覚言語の設計反復**: イベントレーン表示付き Playground で文法を詰める(ここで「臨場感」の質感を作る)。形態素の語彙を固定。
3. **M3 WASMフロントエンド**: L1 を SIMD 実装し Python 参照と等価性テスト。L2 を因果化。
4. **M4 ライブデモ**: マイク → 300ms 以内。レイテンシ補償版形態素。
5. **M5 実験B**: P1〜P3 を主、P4/P5 を従。

---

関連: [[kinetic_prosody_caption_design]](設計原理), [[motivational_design_survey_ja]](情動・エンゲージメント側の文法)
