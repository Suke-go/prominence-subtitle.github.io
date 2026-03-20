# EMS Control Experiment

EMS (Electrical Muscle Stimulation) × Speech Prominence 制御実験ディレクトリ。

## 概要

ACN prominence detection によりリアルタイムで検出した音声の卓越性に基づき、
EMS パルス信号を生成・出力する。

## 機能

- **リアルタイムモード**: マイク → syllable.wasm → ACN → EMS パルス
- **視聴モード**: 事前生成 EMS WAV の再生
- 波形可視化 (Canvas)、VAD、パラメータ調整 UI

## 起動

ルートディレクトリからサーバーを起動:
```
python -m http.server 8080
```
→ `http://localhost:8080/experiments/ems_control/`

## ファイル構成

```
ems_control/
├── index.html         ← メインページ
├── app.js             ← アプリケーションロジック
├── ems-processor.js   ← AudioWorklet (EMS信号生成)
├── style.css
├── prepare_ems.py     ← EMS WAV 生成スクリプト
├── media/             ← 事前生成 EMS WAV
└── media_src/         ← 元音声素材
```

## 依存 (共有アセット)

- `../../wasm/syllable.js` — WASM 音節検出
- `../../js/acn-*.js` — ACN モデル/ランタイム
