# 韻律駆動型字幕の有効性評価：実験設計書（詳細版）

**プロジェクト名**: Prosodic Captioning — 音声韻律情報の字幕への視覚的マッピングによる理解支援とアクセシビリティ向上

**研究代表者**: [記入]
**所属**: [記入]
**作成日**: 2026年3月17日
**最終更新**: 2026年3月19日
**バージョン**: 2.0

---

## 0. 用語定義

| 用語 | 定義 |
|------|------|
| ACN | Auditory Contrast Network。~238パラメータの軽量モデルで、音声信号から各音節/単語の韻律的プロミネンスを推定する |
| プロミネンス | 発話中のある語が周囲と比較して知覚的に際立っている度合い。音響的にはF0・持続時間・強度の変動で実現される |
| Dynamik | Nishida et al. (IUI 2025) が提案した字幕システム。品詞に基づき機能語のフォントサイズを縮小し内容語を拡大する |
| 機能語 | 冠詞・前置詞・代名詞・接続詞・助動詞など文法的機能を担う語 |
| 内容語 | 名詞・動詞・形容詞・副詞など実質的意味を担う語 |
| DHH | Deaf and Hard of Hearing |
| NASA-TLX | NASA Task Load Index。6次元の主観的作業負荷評価尺度 |
| D_new | 韻律-統語乖離度。D_new = 1 − r_pb(is_content, prominence)。ACNプロミネンスと品詞分類の乖離を閾値非依存で定量化する指標 |

---

## 1. 研究目的と仮説

### 1.1 研究目的

Dynamikは「何が重要な語か」を品詞で決め、読解効率を最適化する。本研究の韻律字幕は「話者が何を重要だと思って発話したか」を音声韻律で決め、話者の伝達意図を保存する。

聴者にとっては音声から韻律を直接聞けるが、字幕を読む認知負荷によって韻律への注意が削がれる。韻律字幕は韻律情報を視覚チャネルに冗長に載せることで、非母語話者のパラ言語的理解を補助する。Deaf/HoHにとっては、韻律字幕でなければ到達できない情報がある。

これらを2つの実験で検証する：

- **実験A**: 非母語英語話者（聴者）を対象に、韻律字幕がパラ言語的情報（話者の強調・態度・修辞的意図）の伝達を改善するかを、読解効率を犠牲にしないことを確認しつつ検証する
- **実験B**: DHH参加者を対象に、韻律字幕が従来の字幕では伝達不可能だった音響的情報をどの程度伝達できるかを検証する

### 1.2 仮説

**実験A**

- **H1a（主仮説）**: Prosody条件は、Normal・Syntactic条件と比較して、話者態度推定（皮肉/ユーモア/真剣/中立）および強調語同定の正答率を有意に改善する
- H1b（副次的確認）: Prosody条件はSyntactic条件と比較してNASA-TLX・聴解クイズ正答率に有意な低下を示さない
- H1c: H1aの効果は、クリップの韻律-統語乖離度 D_new（連続変数）と正の交互作用を示す。すなわち、D_newが大きいクリップほどProsody条件の優位性が強くなる

**実験B**

- H2a: Prosody条件のDHH参加者は、Normal条件と比較して強調語同定精度が有意に高い
- H2b: Prosody条件のDHH参加者は、Normal条件およびSyntactic条件と比較して話者態度推定の正答率が有意に高い
- H2c: Prosody条件のDHH参加者は「字幕から話者の雰囲気が伝わった」と有意に高く評価する

---

## 2. 刺激素材

### 2.1 映像クリップの選定

TEDトークから6クリップを選定する。各クリップの韻律-統語乖離度 D_new は連続変数として報告し、カテゴリカルな高群/低群の事前分割は行わない。

#### 2.1.1 刺激クリップ一覧

| ID | 話者 | トーク名 | 年 | セグメント | 長さ | D_new | r_pb | 韻律的特徴 |
|---|---|---|---|---|---|---|---|---|
| H1 | Ken Robinson | Do Schools Kill Creativity? | 2006 | 小学校エピソード | ~90s | 0.774 | 0.226 | ユーモア・皮肉の交替、対比構文 |
| L3 | Al Gore | Averting the Climate Crisis | 2006 | 政策データ提示 | ~90s | 0.756 | 0.244 | 政策説明、修辞的強調 |
| H2 | Brené Brown | The Power of Vulnerability | 2010 | セラピスト会話 | ~90s | 0.750 | 0.250 | 感情的語り、引用会話 |
| L1 | Hans Rosling | The Best Stats You've Ever Seen | 2006 | データ説明 | ~90s | 0.748 | 0.252 | 数値・国名の列挙 |
| L2 | David Christian | History of Our World in 18 Min | 2011 | 宇宙の起源 | ~90s | 0.625 | 0.375 | 叙述的歴史説明 |
| H3 | Kelly McGonigal | How to Make Stress Your Friend | 2013 | 冒頭の告白 | ~90s | 0.580 | 0.420 | 品詞と韻律が一致 |

**D_new** = 1 − r_pb(is_content, prominence)。Point-biserial相関により、ACNプロミネンスと品詞ベースの内容語/機能語分類がどの程度乖離しているかを閾値非依存で定量化する。全クリップで p < .001。

#### 2.1.2 クリップ確定手順

1. TEDLIUMコーパス (release 3) から該当話者の音声を取得（16kHz wav）
2. 公式トランスクリプト + 強制アラインメント（Montreal Forced Aligner）で単語レベルのタイムスタンプを取得
3. ACNで各単語のプロミネンススコアを推定
4. spaCy `en_core_web_sm` で品詞タグ付け → 機能語/内容語の二値分類
5. 韻律-統語乖離度 D_new の算出: 各クリップについて point-biserial相関 r_pb(is_content, prominence) を計算し D_new = 1 − r_pb とする
6. D_new の変動範囲（0.58–0.77, range=0.19）が交互作用の検出に十分であることを確認
7. セグメント境界を韻律的に自然な位置（IPU: Inter-Pausal Unit 境界）に調整し、各60〜90秒に確定

#### 2.1.4 映像の準備

- 各クリップの映像は TED.com の埋め込みプレーヤーから取得し、解像度 960×540 で統一
- 元の字幕を非表示にし、実験条件に応じた字幕を jsPsych のオーバーレイとして表示
- 映像自体は改変しない（CC BY-NC-ND ライセンスの ND 条件に配慮）

### 2.2 字幕条件

#### 2.2.1 4条件の定義

**条件1: Normal**
- 全単語を 18pt で均一表示
- フォント: Noto Sans（Dynamik論文ではピンク文字・黒背景だが、本研究では白文字・半透明黒背景を採用。理由はDHH参加者にとっての一般的な字幕視聴環境との整合性）
- 字幕更新間隔: 0.5秒（Dynamikと同一）

**条件2: Syntactic（Dynamik再現）**
- spaCy `en_core_web_sm` で品詞タグ付け
- 内容語（NOUN, VERB, ADJ, ADV）: 18pt
- 機能語（DET, ADP, PRON, CONJ, AUX, PART）: 12pt
- Dynamikの実装を忠実に再現（原論文の定義に従う）

**条件3: Prosody**
- ACN推定のプロミネンススコア s ∈ [0, 1] を3段階にbin化
  - s < t_low: 12pt, font-weight: 300 (light)
  - t_low ≤ s < t_high: 15pt, font-weight: 400 (regular)
  - s ≥ t_high: 18pt, font-weight: 700 (bold)
- bin閾値 (t_low, t_high) はクリップごとに大津法（multi-Otsu, Otsu 1979）で自動決定。クラス間分散を最大化する閾値をデータ駆動で求めるため、恣意的パラメータ設定を排除。クリップ別正規化により話者のベースライン表現力の差を相殺し、全クリップで3段階の視覚的コントラストが同等に機能する

**条件4: Syntactic+Prosody**
- Syntactic条件のフィルタ（機能語を縮小）を適用した上で、内容語間でACNスコアに基づくグラデーションを追加
- 機能語: 一律12pt
- 内容語: ACNスコアに応じて 15pt / 18pt の2段階
- Dynamikの枠組みを韻律で拡張するという位置づけ

#### 2.2.2 字幕の表示仕様（全条件共通）

| パラメータ | 値 | 根拠 |
|---|---|---|
| フォント | Noto Sans | Web標準、多言語対応 |
| 文字色 | #FFFFFF (白) | WCAG AA準拠 |
| 背景 | rgba(0,0,0,0.75) | 半透明黒 |
| 最大行数 | 2行 | 字幕標準 |
| 表示位置 | 画面下部 10% | 標準的な字幕位置 |
| 更新間隔 | 500ms | Dynamikと同一 |
| 最大表示文字数 | 約42文字/行 | FCC字幕ガイドライン準拠 |

#### 2.2.3 字幕生成パイプライン

```
音声 (.wav, 16kHz)
  ↓
Montreal Forced Aligner → 単語レベルタイムスタンプ (.TextGrid)
  ↓
ACN → 単語ごとプロミネンススコア (.json)
  ↓
spaCy en_core_web_sm → 品詞タグ (.json)
  ↓
条件別マッピングスクリプト → 字幕データ (.json)
  {
    "start_time": 3.2,
    "end_time": 4.1,
    "words": [
      {"text": "I", "font_size": 12, "font_weight": 300, "condition": "prosody"},
      {"text": "have", "font_size": 12, "font_weight": 300, "condition": "prosody"},
      {"text": "a", "font_size": 12, "font_weight": 300, "condition": "prosody"},
      {"text": "confession", "font_size": 18, "font_weight": 700, "condition": "prosody"},
      ...
    ]
  }
  ↓
jsPsych プラグイン → 映像上にリアルタイムオーバーレイ
```

---

## 3. 実験A：聴者・非母語話者対象

### 3.1 実験デザイン

- **被験者内要因**: 字幕条件（4水準: Normal / Syntactic / Prosody / Syntactic+Prosody）
- **クリップレベル連続共変量**: 韻律-統語乖離度 D_new（0.58–0.77）
- **デザイン**: 4条件 × 6クリップ。各#### 主要分析

全従属変数について、線形混合効果モデル（LMM）または一般化線形混合効果モデル（GLMM）を適用する。

**H1a（主仮説）: 話者意図推定** (R lme4 記法):

```r
# 話者態度推定・強調語同定（主要指標、二値）
glmer(IntentCorrect ~ Condition + D_new + Condition:D_new +
      PreTestScore + Order +
      (1 | ParticipantID) + (1 | ClipID),
      family = binomial, data = df)
# 事後比較: Prosody vs Normal, Prosody vs Syntactic
# emmeans パッケージで Tukey HSD
```

**H1b（副次的確認）: NASA-TLX・聴解クイズ**:

```r
# NASA-TLX（副次的、非劣性の簡易確認）
lmer(NASA_Effort ~ Condition + D_new + Condition:D_new +
     PreTestScore + Order +
     (1 | ParticipantID) + (1 | ClipID),
     data = df)
# → Prosody vs Syntactic の差の95% CIを報告
# → CIが実質的差異のマージン（例: 2点）を超えなければ「実質的に同等」と記述
# → 正式な非劣性マージンの事前指定・検定は行わない

# 聴解クイズ正答率（副次的）
glmer(QuizCorrect ~ Condition + D_new + Condition:D_new +
      PreTestScore + Order +
      (1 | ParticipantID) + (1 | ClipID),
      family = binomial, data = df)
```

**H1c: D_new交互作用の解釈**:

```r
# Condition:D_new 交互作用が有意な場合:
# D_new の値を3点（min=0.58, median=0.75, max=0.77）に固定して
# 各点でのCondition間の推定周辺平均を報告
emtrends(model, pairwise ~ Condition, var = "D_new")
# 「D_newが0.1増加するごとに話者意図推定正答率の条件差がβ点変化する」
```

#### 検出力分析

Kafle & Huenerfauth (2019) のキーワードハイライト効果に基づき:

- 効果量 d = 0.4（中程度）を想定
- 主要指標: 話者意図推定正答率（二値 → GLMM）
- α = 0.05, 1-β = 0.80
- 4条件の被験者内比較、6測定/参加者
- 必要サンプルサイズ: N ≈ 44（G*Power, F test, repeated measures, within factors）
- 脱落・除外を見込んで N = 52 をリクルート、有効データ50名を目標

#### 副次的分析

- Pre-testスコアによる群分け（中央値分割: 英語力高群/低群）→ Condition × D_new × EnglishProficiency の3解析
- 条件選好と客観指標の相関（事後アンケートの好み vs 実際のパフォーマンス）
- 回答時間の分析（韻律字幕がreading time に与える影響）��件×6クリップで完全なバランスを取ることは不可能なため、上記は近似的なバランスである。最終的な統計分析では混合効果モデルでクリップとパターンをランダム効果として扱うことでこの不完全性に対処する。

### 3.3 参加者

- **人数**: 52名（パターンA〜D × 13名ずつ。脱落・除外を見込み50名の有効データを目標）
- **リクルート**: Prolific
- **選定基準**:
  - 英語が母語でないこと（Prolific国籍フィルタで英語圏5カ国を除外: UK, US, CA, AU, NZ）
  - 18歳以上
  - Prolific承認率 95%以上
  - 正常な聴力（自己申告）
  - 正常または矯正済みの視力（自己申告）
- **除外基準**:
  - Pre-test正答率 20%未満（英語力が実験遂行に不十分）
  - ダミー問題の全不正解（不誠実回答の疑い）
  - 実験所要時間が中央値の半分未満（rushing）
  - 映像再生エラー報告あり
- **報酬**: £6.50（推定所要時間40分、時給換算 £9.75/hr）。聴解クイズ正答率80%以上の参加者には£1のボーナス

### 3.4 手続き

```
[0:00] 1. ランディングページ（Prolific経由）
       - 実験概要の説明
       - 同意取得（チェックボックス）
       - 環境チェック: ヘッドフォン使用の確認、音声再生テスト

[0:02] 2. デモグラフィック質問紙
       - 性別
       - 年齢
       - 国籍
       - 母語
       - その他話せる言語
       - 英語テストスコア（TOEFL / TOEIC / IELTS、任意回答）
       - 字幕の日常的な使用頻度（5段階）

[0:04] 3. Pre-test（英語リスニング能力評価）
       - TOEFL iBT 公式ガイド第5版 Track 1 音声を使用
       - 10問の4択リスニング問題（5問は公式、5問はAI生成＋著者検証）
       - 制限時間: 10分
       - Pre-testスコアは事後の群分け変数として使用

[0:14] 4. 練習試行
       - 本番とは別のTEDクリップ（30秒）をNormal条件で視聴
       - 聴解クイズ1問 + NASA-TLX + 話者意図推定1問を体験
       - 「操作は理解できましたか？」の確認

[0:17] 5. 本試行（6クリップ × 各約3.5分 = 約21分）
       各クリップについて以下を実施:

       5a. 映像視聴（60〜90秒）
           - 割り当てられた字幕条件で視聴
           - 一時停止・巻き戻し不可
           - 映像の上にクリップ番号（"Clip 3 of 6"）を表示

       5b. 聴解クイズ（3問、制限時間なし）
           - 4択。選択肢順序はランダム化
           - 10問プールから3問をランダム抽出（うちダミー問題が少なくとも1問含まれない確率 < 0.05 となるよう設計）

       5c. 話者意図推定課題（3問、制限時間なし）
           - 強調語同定 × 1問:
             文を均一フォントで提示し、「話者がこの文で最も強調していた語を選んでください」（4択）
           - 話者態度推定 × 1問:
             「この部分での話者のトーンに最も近いものは？」（4択: 真剣 / ユーモア / 皮肉 / 中立）
           - 韻律構造知覚 × 1問:
             「この箇所の直後に話者は…」（4択: 長い休止を置いた / すぐ次の文に続けた / 声を大きくした / テンポを上げた）

       5d. 主観評価（10項目）
           - 理解度: "How well did you understand the content?" (1-7)
           - 可読性: "How readable was the subtitle?" (1-7)
           - エンゲージメント: "How engaged were you?" (1-7)
           - 韻律伝達 ★新規: "Did the subtitle help you notice the speaker's emphasis?" (1-7)
           - NASA-TLX 6項目 (1-21)
             Mental Demand / Physical Demand / Temporal Demand /
             Performance / Effort / Frustration

[0:38] 6. 事後アンケート
       - 条件間の違いに気づいたか？（Yes/No + 自由記述）
       - どの字幕スタイルが最も好ましかったか？（4択）
       - 各字幕スタイルの良かった点・悪かった点（自由記述、各条件について）
       - ヘッドフォンを使用したか？（確認）
       - 技術的な問題はあったか？（自由記述）

[0:42] 7. Prolific完了コード提示
       - 暗号化された完了コードを表示（Dynamik方式に従いXOR + Caesar暗号）
```

### 3.5 測定変数の一覧

#### 従属変数

| 変数名 | 型 | 範囲 | 取得タイミング |
|---|---|---|---|
| 聴解クイズ正答数 | 整数 | 0–3 / クリップ | 各クリップ後 |
| NASA-TLX Mental Demand | 整数 | 1–21 | 各クリップ後 |
| NASA-TLX Physical Demand | 整数 | 1–21 | 各クリップ後 |
| NASA-TLX Temporal Demand | 整数 | 1–21 | 各クリップ後 |
| NASA-TLX Performance | 整数 | 1–21 | 各クリップ後 |
| NASA-TLX Effort | 整数 | 1–21 | 各クリップ後 |
| NASA-TLX Frustration | 整数 | 1–21 | 各クリップ後 |
| 理解度自己評価 | 整数 | 1–7 | 各クリップ後 |
| 可読性自己評価 | 整数 | 1–7 | 各クリップ後 |
| エンゲージメント自己評価 | 整数 | 1–7 | 各クリップ後 |
| 韻律伝達自己評価 | 整数 | 1–7 | 各クリップ後 |
| 強調語同定正答 | 二値 | 0/1 | 各クリップ後 |
| 話者態度推定正答 | 二値 | 0/1 | 各クリップ後 |
| 韻律構造知覚正答 | 二値 | 0/1 | 各クリップ後 |
| 回答時間（各課題） | 連続 | ms | 各課題 |

#### 独立変数・共変量

| 変数名 | 型 | 水準 | 役割 |
|---|---|---|---|
| 字幕条件 | カテゴリカル | 4 (Normal / Syntactic / Prosody / Syn+Pro) | 被験者内要因 |
| D_new（韻律-統語乖離度） | 連続 (0.58–0.77) | — | クリップレベル共変量（Condition との交互作用） |
| Pre-testスコア | 連続 (0–10) | — | 共変量 / 群分け変数 |
| クリップID | カテゴリカル | 6 | ランダム効果 |
| パターンID | カテゴリカル | 4 (A–D) | ランダム効果 |
| 提示順序 | 整数 (1–6) | — | 共変量（順序効果の統制） |

### 3.6 分析計画

#### 主要分析

全従属変数について、線形混合効果モデル（LMM）または一般化線形混合効果モデル（GLMM）を適用する。

**モデル構造** (R lme4 記法):

```r
# NASA-TLX, 理解度等の連続変数
lmer(DV ~ Condition * D_new + PreTestScore + Order +
     (1 | ParticipantID) + (1 | ClipID),
     data = df)

# 聴解クイズ正答（二値）
glmer(Correct ~ Condition * D_new + PreTestScore + Order +
      (1 | ParticipantID) + (1 | ClipID),
      family = binomial, data = df)
```

**事後比較**: Tukey HSD（4条件間の全ペアワイズ比較）。Bonferroni補正はLMM内のpost-hoc比較で `emmeans` パッケージを使用。

**非劣性検定** (H1b): Prosody条件がSyntactic条件に対して事前に設定したマージン（δ = NASA-TLX 2点 or 聴解クイズ正答率5%ポイント）以内であることを、90% CIが非劣性マージンを超えないことで判定。

**交互作用の解釈** (H1d): Condition × D_new の交互作用項が有意な場合、D_new の値域における Prosody−Syntactic 条件差の傾きを `emtrends` パッケージで推定・視覚化する。「D_new が0.1増加するごとに話者意図推定正答率の条件差がβ点変化する」という定量的な主張が可能。

#### 検出力分析

Dynamikの先行データ（84名、3条件、NASA-TLX Effortでη²p ≈ 0.05）に基づき:

- 効果量 d = 0.3（小〜中）を想定
- α = 0.05, 1-β = 0.80
- 4条件の被験者内比較、6測定/参加者
- 必要サンプルサイズ: N ≈ 72（G*Power, F test, repeated measures, within factors）
- 脱落・除外を見込んで N = 84 をリクルート

#### 副次的分析

- Pre-testスコアによる群分け（中央値分割: 英語力高群/低群）→ Condition × Contrast × EnglishProficiency の3要因分析
- 条件選好と客観指標の相関（事後アンケートの好み vs 実際のパフォーマンス）
- 回答時間の分析（韻律字幕がreading time に与える影響）

---

## 4. 実験B：DHH参加者対象

### 4.1 実験デザイン

- **被験者内要因**: 字幕条件（3水準: Normal / Syntactic / Prosody）
  - Syntactic+Prosody条件は実験Bでは除外（条件数を抑え、参加者負担を軽減するため）
- **被験者内要因2**: 韻律コントラスト（2水準: 高群 / 低群）
- 実験Aと同一の6クリップを使用

### 4.2 条件割り当て

| パターン | H1 | H2 | H3 | L1 | L2 | L3 |
|---|---|---|---|---|---|---|
| A | Normal | Syntactic | Prosody | Normal | Syntactic | Prosody |
| B | Syntactic | Prosody | Normal | Syntactic | Prosody | Normal |
| C | Prosody | Normal | Syntactic | Prosody | Normal | Syntactic |

- 3条件×6クリップは完全にバランス可能
- 各パターンで各条件が高群1回・低群1回の計2回出現
- N = 30（各パターン10名）を目標

### 4.3 参加者

- **人数**: Phase 1: 30名（オンライン）、Phase 2: 8〜12名（対面インタビュー、Phase 1参加者から希望者を募集）
- **リクルート経路**:
  - Prolific: 聴覚障害のdemographic prescreeningフィルタを使用
  - Reddit: r/deaf, r/hardofhearing への募集投稿
  - Twitter/X: #DeafTwitter, #DeafCommunity ハッシュタグ
  - National Association of the Deaf (NAD) ニュースレター掲載依頼
  - 大学のDHHコミュニティ（筑波技術大学、Gallaudet University 等）への案内
  - 口コミ・スノーボールサンプリング
- **選定基準**:
  - 自身がDeafまたはHard of Hearingであると自認していること
  - 18歳以上
  - 英語の読み書きが可能であること（字幕を読む必要があるため）
  - 正常または矯正済みの視力（自己申告）
- **除外基準**:
  - 実験遂行に支障をきたす視覚障害がある場合
  - ダミー問題の全不正解
- **報酬**: $25（推定所要時間35分、時給換算 $42.86/hr）。DHH参加者のリクルート困難性と専門性を考慮し、通常より高めに設定（先行研究の相場: $40/50分 at Pataca et al. CHI 2023）
- **Phase 2追加報酬**: $30（45〜60分のインタビュー）

### 4.4 重要な変更点：音声なし条件

**実験Bでは、すべての映像を音声なしで提示する。**

これは、DHH参加者にとっての実際の字幕使用環境を再現するためである。映像（話者の表情・ジェスチャー）と字幕（条件により視覚的に異なる）のみが情報源となる。

この設計により、韻律字幕が音声なしの条件で韻律的情報をどの程度伝達できるかを直接的に測定できる。

### 4.5 手続き（Phase 1: オンライン）

```
[0:00] 1. ランディングページ
       - 実験概要の説明（平易な英語 + ASLビデオによる説明を併記）
       - 同意取得
       - 環境チェック: ブラウザ・画面サイズの確認（音声チェックは不要）

[0:02] 2. デモグラフィック質問紙
       - 性別
       - 年齢
       - 聴覚状態の詳細:
         * 自己同定（Deaf / deaf / Hard of Hearing / その他）
         * 聴力損失の程度（軽度 / 中等度 / 高度 / 重度 / 完全）
         * 発症時期（先天性 / 前言語期 / 後言語期）
         * 補聴機器の使用（補聴器 / 人工内耳 / なし / その他）
       - 主要なコミュニケーション手段（ASL / 口話 / 筆談 / その他）
       - 英語の読解力自己評価（1–7）
       - 字幕の日常的な使用頻度（5段階）
       - 字幕の好み（フォントサイズ・速度等）

[0:05] 3. 英語読解力Pre-test
       - リスニングではなく **読解** テスト（TOEFL Reading準拠）
       - 短い英文パッセージ（100語程度）を読み、5問の4択に回答
       - 制限時間: 5分

[0:10] 4. 練習試行
       - 本番とは別のTEDクリップ（30秒、音声なし）をNormal条件で視聴
       - 各質問タイプを1問ずつ体験

[0:12] 5. 本試行（6クリップ × 各約3分 = 約18分）
       各クリップについて:

       5a. 映像視聴（60〜90秒、音声なし）
           - 割り当てられた字幕条件で視聴
           - 一時停止・巻き戻し不可

       5b. 内容理解クイズ（2問、制限時間なし）
           - 実験Aと同じプールから2問（3問ではなく負担軽減のため2問）
           - 音声なし条件で答えられるよう、音声固有の情報を問わない問題を選定

       5c. 韻律情報知覚課題 ★本実験の中核（3問）
           - 強調語同定 × 1問:
             「この字幕の中で、話者が最も強く言いたかったと思う語を選んでください」
             (4択、聴者ground-truthとの一致率を算出)
           - 話者態度推定 × 1問:
             「この部分での話者の態度に最も近いのは？」
             (4択: 真剣 / ユーモア / 皮肉 / 中立)
           - 韻律的意味の推定 × 1問:
             「この文で、話者はおそらく…」
             (4択: 例「"confession" という語を特に際立たせて言った」
                   「すべての語を同じ強さで言った」
                   「文末に向かって声を上げた」
                   「早口で一気に言った」)

       5d. 主観評価（7項目）
           - 理解度 (1-7)
           - 可読性 (1-7)
           - 韻律伝達 ★: "この字幕から、話者の『言い方のニュアンス』がどの程度伝わりましたか？" (1-7)
           - 自然さ ★: "この字幕は自然に感じましたか、それとも気が散りましたか？" (1-7)
           - NASA-TLX から3項目のみ抽出: Mental Demand / Effort / Frustration
             （Physical Demand, Temporal Demand, Performanceは本実験の文脈で解釈が難しいため除外）

[0:30] 6. 事後アンケート
       - 条件間の違いに気づいたか？（Yes/No + 自由記述）
       - どの字幕スタイルが最も好ましかったか？（3択）
       - 自由記述: 「字幕のデザインについて、もっとこうしてほしいと思うことはありますか？」
       - Phase 2（対面インタビュー）への参加意向（Yes/No + 連絡先）

[0:35] 7. 完了コード提示・謝辞
```

### 4.6 手続き（Phase 2: 対面インタビュー）

Phase 1参加者のうち希望者8〜12名を対象。Zoomまたは対面で実施。ASL通訳者を手配（参加者の希望に応じて）。

```
[0:00] 1. 同意取得・録画確認

[0:03] 2. 字幕サンプルの再提示
       - 同一クリップの3条件（Normal / Syntactic / Prosody）を並べて提示
       - 各条件を15秒ずつ視聴してもらい、違いを確認

[0:08] 3. 半構造化インタビュー（35〜40分）
       以下のトピックについて、オープンエンドで対話:

       a) 日常の字幕体験
          - 普段どのような場面で字幕を使うか
          - 字幕で困ること、不満に感じること
          - 話者の「トーン」や「雰囲気」が伝わらなくて困った経験

       b) 韻律字幕（Prosody条件）への反応
          - フォントサイズの変化に気づいたか
          - サイズの変化は何を意味していると感じたか
          - 話者の意図が伝わりやすくなったか、それとも混乱したか

       c) Syntactic条件との比較
          - 機能語が小さい字幕と、韻律的に大きさが変わる字幕の違いをどう感じたか
          - どちらが好ましいか、なぜか

       d) 改善案
          - サイズ以外にどのような視覚的手がかりがほしいか
            （色・太さ・アニメーション・絵文字等、先行研究で提案されているもの）
          - 韻律情報の粒度（単語レベル vs フレーズレベル）についての好み
          - 理想的な字幕のデザインを自由に描写してもらう

[0:45] 4. 謝辞・フォローアップの確認
```

### 4.7 Phase 2の分析

- 録画・録音データをトランスクリプト化（ASL使用の場合はASL通訳者が英語テキストに変換）
- 反射的テーマ分析（Braun & Clarke, 2006）に基づきコーディング
- Pataca et al. (CHI 2023) のコーディングスキームを参照しつつ、韻律字幕固有のテーマを追加

### 4.8 分析計画（Phase 1）

**主要分析**:

```r
# 強調語同定（二値）
glmer(Correct ~ Condition * Contrast +
      (1 | ParticipantID) + (1 | ClipID),
      family = binomial, data = df)

# 話者態度推定（二値）
glmer(Correct ~ Condition * Contrast +
      (1 | ParticipantID) + (1 | ClipID),
      family = binomial, data = df)

# 主観的韻律伝達評価（順序）
clmm(ProsodyRating ~ Condition * Contrast +
     (1 | ParticipantID) + (1 | ClipID),
     data = df)
```

**検出力**: N=30、3条件の被験者内比較、効果量 d=0.5（中程度）を想定。DHH参加者を対象とした先行研究（Kafle & Huenerfauth, 2017, 2019）がN=30で有意差を検出しており、同規模で十分と判断。

---

## 5. 質問項目の作成手順

### 5.1 聴解クイズ

#### 5.1.1 作成プロセス

1. 各クリップのトランスクリプトを用いて、Claude Sonnet 4で各10問を生成
2. 著者2名が独立に以下を検証:
   - 正解の一意性（曖昧な問題の排除）
   - 不正解選択肢の妥当性（あり得そうだが間違い）
   - 選択肢の長さ・文体の均一性
   - 常識のみで答えられない（クリップ視聴が必要）
   - 音声固有の情報を問わない（実験Bでも使用可能にするため）
3. 各クリップから本番3問 + ダミー2問 = 5問を確定
4. パイロット参加者5名（聴者・非母語話者）で難易度チェック
   - 正答率が20%未満 or 95%以上の問題は差し替え

#### 5.1.2 生成プロンプト

```
You are an expert test designer for TOEFL iBT listening comprehension.

Based on the following speech excerpt from a TED Talk, create 10 multiple-choice 
questions (4 options each, one correct answer).

Requirements:
- 7 questions should be answerable based on the content (factual recall, inference, 
  main idea)
- 3 questions should be "dummy" questions whose answers are NOT contained in the 
  excerpt
- All answer options should be approximately equal in length
- Do NOT quote the excerpt verbatim in options; paraphrase instead
- Questions should be answerable from text alone (no audio-specific information)
- Difficulty: TOEFL iBT level
- Mark the correct answer and whether each question is "content" or "dummy"

Speech excerpt:
---
{transcript}
---

Speaker context: {speaker_name}, talking about {topic}, at TED {year}.
```

### 5.2 話者意図推定課題

#### 5.2.1 Ground-truth取得

1. 6クリップ × 各3文 = 18文を選定（ACNスコアのばらつきが大きい文を優先）
2. 聴者パイロット（10名、英語母語話者）に音声つきで以下を回答させる:
   a) 各文で最も強調されている語（自由回答）
   b) 話者のトーン（4AFC）
   c) 韻律構造の知覚（4AFC）
3. 聴者間一致率（Fleiss' κ）が 0.6 以上の項目のみを本番に採用
4. 一致率の低い項目は再選定・再調査

#### 5.2.2 強調語同定の選択肢設計

各文について4択を構成:
- 正解: 聴者パイロットで最も多く選ばれた語
- 誘導肢1: ACNスコアが2番目に高い語
- 誘導肢2: 品詞的には内容語だがACNスコアが低い語（Dynamikなら強調するがACNでは強調しない語）
- 誘導肢3: ランダムな語

誘導肢2の存在により、Syntactic条件の参加者がDynamikの見た目に引きずられて誤答するかどうかを間接的に測定できる。

#### 5.2.3 話者態度推定の選択肢設計

4択を以下のように構成:
- 正解: 聴者パイロットで最多の回答
- 近接誘導肢: 正解と近いが異なるカテゴリ（例: ユーモア vs 皮肉）
- 遠隔誘導肢: 明らかに異なるカテゴリ2つ

### 5.3 主観評価

#### NASA-TLX

Hart & Staveland (1988) の原版を使用。21段階（1-21）。各項目の表現はNASA公式のものをそのまま使用。ただし、日本語圏の参加者を含む場合は、三宅・神代 (1993) の日本語訳を併記。

#### 韻律伝達固有項目

以下の3項目を新規に追加。7段階リッカート（1: 全くそう思わない 〜 7: 非常にそう思う）:

1. "The subtitle helped me notice which words the speaker emphasized."
   （字幕が、話者がどの語を強調していたかに気づく助けになった）

2. "The subtitle conveyed the speaker's tone of voice or emotional state."
   （字幕が、話者の声のトーンや感情状態を伝えていた）

3. "The variation in subtitle appearance felt natural and easy to follow."
   （字幕の見た目の変化は自然で、追いやすいと感じた）

---

## 6. 技術的実装

### 6.1 プラットフォーム

- **実験フレームワーク**: jsPsych 7.x
- **フロントエンド**: Vue.js 3（Dynamik実験コードからフォーク: github.com/nawta/Dynamik_experiment）
- **ホスティング**: Firebase Hosting or GitHub Pages
- **データ保存**: Firebase Realtime Database（暗号化）
- **ビルドツール**: Webpack 5 + Webpack Obfuscator（完了コード・正解の秘匿）

### 6.2 カスタムjsPsychプラグイン

字幕オーバーレイ表示用のカスタムプラグインを開発:

```javascript
// plugin-prosodic-subtitle.js （概念設計）
class ProsodySubtitlePlugin {
  // パラメータ
  // - video_src: 映像URL
  // - subtitle_data: JSON（タイムスタンプ付き単語リスト + 条件別視覚パラメータ）
  // - condition: "normal" | "syntactic" | "prosody" | "syntactic_prosody"
  // - audio_enabled: true (実験A) | false (実験B)

  trial(display_element, trial) {
    // 1. <video> 要素を配置
    // 2. 字幕オーバーレイ用 <div> を配置
    // 3. requestAnimationFrame で 500ms ごとに字幕を更新
    // 4. 各単語を <span> で表示し、font-size と font-weight を条件に応じて設定
    // 5. 映像終了時にコールバック
  }
}
```

### 6.3 データ暗号化

Dynamik方式に従い、以下を暗号化してブラウザ上で秘匿:
- クイズの正解
- ダミー問題のフラグ
- Prolific完了コード
- 暗号方式: XOR暗号 + 文字列分割/結合 + Caesar暗号（多層化）

### 6.4 アクセシビリティ対応（実験B）

- 全テキストのWCAG AA準拠コントラスト比（4.5:1以上）
- タブナビゲーション対応
- スクリーンリーダー互換性（aria-label 付与）
- 必要に応じてASLビデオによるインストラクション
- 回答の入力にはクリック/タップのみ（タイピング不要）

---

## 7. パイロット実験

### 7.1 パイロット1: ACN出力検証（N=0、計算のみ）

- 6クリップ候補に対してACNを走らせ、プロミネンススコアを取得
- spaCy品詞タグとの乖離度を計算
- 乖離度に基づきクリップを最終選定
- 字幕4条件の視覚的プレビューを生成し、目視で自然さを確認

### 7.2 パイロット2: 聴者ground-truth取得（N=10）

- 英語母語話者10名（研究室内リクルート、無報酬または軽微な謝礼）
- 6クリップを音声つきで視聴
- 各クリップ3文 × 18文について強調語同定・話者態度推定に回答
- Fleiss' κ で聴者間一致率を計算
- 一致率 ≥ 0.6 の項目を本番採用

### 7.3 パイロット3: 実験フロー通し確認（N=5）

- 非母語英語話者5名（研究室内）
- 実験A全フローを通し実施
- フィードバック: 所要時間、疲労感、質問の分かりやすさ、技術的問題
- この結果に基づき、クイズ難易度・bin閾値・表示パラメータを最終調整

### 7.4 パイロット4: DHHアクセシビリティ確認（N=2〜3）

- DHHの知人またはコミュニティメンバーに依頼
- 実験Bのフローを通し実施
- インストラクションの分かりやすさ、文化的適切さ、技術的アクセシビリティを確認
- 報酬: $25

---



## 8. 投稿戦略

### 聴者実験単独で出す場合

- **投稿先: IUI 2027**（Dynamikと同じ会場）
- ストーリー: 韻律字幕は非母語話者のパラ言語的理解を補助する
- 主要Finding:
  1. 話者態度推定・強調語同定でProsody条件がNormal・Syntactic条件を有意に上回る
  2. この効果はD_new（韻律-統語乖離度）が高いクリップで強い
  3. NASA-TLXと聴解クイズでは条件間に有意差なし → 読解効率を犠牲にせずパラ言語的情報を追加

### 二段組（聴者+DHH）で出す場合

- **投稿先: CHI 2027 or ASSETS 2027**
- Study 1 = 実験A（聴者50名）
- Study 2 = 実験B（DHH 30名+インタビュー6名）

### 判断基準

- 実験Aの結果が出た時点で判断
- H1aが有意 → IUI 2027に実験A単独で投稿 + 実験BはASSETS 2027に別論文
- H1aが非有意 → 二段組にしてCHI 2027に投稿

---

## 9. 倫理的配慮

### 8.1 インフォームドコンセント

- 実験の目的、手続き、所要時間、報酬を明記
- データの匿名化と保管期間を説明
- いつでも中断可能であることを明記
- 実験Bでは ASL ビデオによるコンセント説明を併記

### 8.2 データ管理

- 個人識別情報（Prolific ID）とデータはリンク可能匿名化で管理
- Prolific IDは報酬支払い後に削除
- 実験データはFirebase上でAES-256暗号化
- 研究者のみアクセス可能
- Phase 2のインタビュー録画は参加者の同意を得た上で行い、分析完了後3年で削除

### 8.3 リスクと対処

- **リスク**: 特段の身体的・心理的リスクはない。映像視聴の疲労が想定される
- **対処**: クリップ間に必要に応じて休憩を取れるよう設計（"Press Space to continue" で参加者ペース）
- **DHH参加者への配慮**: 聴覚障害を「障害」として扱わず、Deaf Cultureの観点からDHHの多様性を尊重した用語・フレーミングを使用

### 8.4 申請先

- [所属機関の倫理審査委員会名を記入]
- オンライン実験（Prolific経由）であるため、参加者の身体的介入はなし
- 人を対象とした行動実験としてカテゴリB（低リスク）に該当すると想定

---

## 10. タイムライン

| 時期 | マイルストーン |
|---|---|
| 2026年6月 | ACNパイプライン構築完了、クリップ最終選定 |
| 2026年7月 | 質問項目作成、パイロット1・2実施 |
| 2026年8月 | jsPsych実装完了、パイロット3実施、倫理審査申請 |
| 2026年9月 | 倫理審査承認（想定）、パイロット4（DHH）実施 |
| 2026年10月 | 実験Aデータ収集（Prolific、1〜2週間） |
| 2026年11月 | 実験A分析、論文1ドラフト |
| 2026年12月 | 実験Bリクルート開始 |
| 2027年1月 | 論文1投稿（CHI 2027 LBW or IUI 2027） |
| 2027年2〜3月 | 実験B Phase 1 データ収集 |
| 2027年4月 | 実験B Phase 2 インタビュー |
| 2027年5月 | 実験B分析、論文2ドラフト |
| 2027年6月 | 論文2投稿（ASSETS 2027）or 二段組統合論文投稿 |

---

## 11. 予算見積もり

| 項目 | 単価 | 数量 | 合計 |
|---|---|---|---|
| **実験A** | | | |
| Prolific参加者報酬 | £6.50 | 55名（脱落込み） | £358 |
| ボーナス（80%正答者） | £1.00 | 推定20名 | £20 |
| Prolific手数料 (33%) | — | — | £125 |
| **小計 実験A** | | | **£503 (≈ ¥95,000)** |
| **実験B Phase 1** | | | |
| 参加者報酬 | $25 | 35名 | $875 |
| Prolific手数料 (33%) | — | — | $289 |
| **実験B Phase 2** | | | |
| インタビュー報酬 | $30 | 6名 | $180 |
| ASL通訳費（必要時） | $100/hr | 2時間 | $200 |
| **小計 実験B** | | | **$1,544 (≈ ¥225,000)** |
| **技術・その他** | | | |
| Firebase利用料 | — | — | ~¥5,000 |
| ドメイン・SSL | — | — | ~¥3,000 |
| パイロット謝礼 | ¥2,000 | 15名 | ¥30,000 |
| **合計** | | | **≈ ¥358,000** |

---

## 付録A: 字幕条件の視覚的イメージ

### Normal条件
```
I have a confession to make.
（全単語 18pt, font-weight: 400）
```

### Syntactic条件（Dynamik再現）
```
i have a CONFESSION to MAKE.
（機能語 12pt: i, have, a, to / 内容語 18pt: CONFESSION, MAKE）
```

### Prosody条件
```
i have a CONFESSION to MAKE.
（ACNスコア: I=0.3→12pt, have=0.2→12pt, a=0.1→12pt,
  confession=0.9→18pt bold, to=0.1→12pt, make=0.7→18pt）
```
※この例ではSyntactic条件と同一の出力になる。差が出るのは対比強勢等の場合:

```
I didn't say HE stole it.
Syntactic: i DIDN'T SAY he STOLE it.  （HE=代名詞→小）
Prosody:   i didn't SAY HE stole it.   （HE=対比強勢→大）
```

### Syntactic+Prosody条件
```
i have a CONFESSION to MAKE.
（機能語は一律 12pt、内容語間でACNスコアに応じ 15pt/18pt）
```

---

## 付録B: 事後アンケート全文

### 実験A用

Q1. Did you notice any differences between the subtitle styles across the video clips?
- Yes / No

Q2. [If Yes] Please describe what differences you noticed. (free text)

Q3. Which subtitle style did you prefer the most?
- Style A: All words same size
- Style B: Some words smaller, some larger (grammar-based)
- Style C: Some words smaller, some larger (emphasis-based)
- Style D: Combination of grammar and emphasis

Q4. For each subtitle style, please share what you liked or disliked about it.
- Style A: (free text)
- Style B: (free text)
- Style C: (free text)
- Style D: (free text)

Q5. Did you use headphones during the experiment?
- Yes / No

Q6. Did you experience any technical issues? (free text)

### 実験B用

Q1. Did you notice any differences between the subtitle styles across the video clips?
- Yes / No

Q2. [If Yes] Please describe what differences you noticed. (free text)

Q3. Which subtitle style gave you the best sense of *how* the speaker was talking (not just *what* they said)?
- Style A: All words same size
- Style B: Some words smaller, some larger (pattern 1)
- Style C: Some words smaller, some larger (pattern 2)

Q4. What would make subtitles better at conveying the speaker's tone, emphasis, or emotions? (free text)

Q5. Is there anything else you'd like to share about your experience with these subtitles? (free text)

Q6. Would you be interested in participating in a follow-up interview (approximately 45–60 minutes, $30 compensation)?
- Yes (please provide email or preferred contact) / No

---

## 付録C: Phase 2 インタビューガイド

### Part 1: 日常の字幕体験（10分）

1. 普段、字幕をどのような場面で使いますか？（仕事、教育、娯楽…）
2. 字幕で困ることや不満に感じることはありますか？
3. 字幕を見ていて、話者の「トーン」や「雰囲気」が分からなくて困った経験はありますか？
   - あれば、具体的なエピソードを教えてください
4. 理想的な字幕はどのようなものだと思いますか？

### Part 2: 韻律字幕への反応（15分）

[3条件の字幕を並べて再提示]

5. この3つの字幕の違いに気づきましたか？どのような違いですか？
6. 字幕Cの（フォントサイズが韻律に基づいて変化する）仕組みについてどう思いますか？
7. サイズの変化は何を表していると感じましたか？
8. 話者の言いたいことが伝わりやすくなりましたか？それとも逆に読みにくくなりましたか？
9. 字幕Bと字幕Cのどちらが好みですか？なぜですか？

### Part 3: デザイン改善（10分）

10. サイズの変化以外に、話者の「声の雰囲気」を伝えるためにどんな工夫があるとよいですか？
    - プローブ: 色の変化、太さの変化、アニメーション、絵文字…
11. 変化の粒度について: 単語ごとに変えるのと、フレーズ（数語のまとまり）ごとに変えるのでは、どちらが好ましいですか？
12. 最後に、字幕のデザインについて何か伝えたいことはありますか？