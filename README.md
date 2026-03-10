# gemiclaw 🐾

gemiclawは、[`nanoclaw`](https://github.com/qwibitai/nanoclaw) の設計思想を汲んだ、Google Gemini API と Discord を連携させる最小構成AIエージェントです。

## 特徴

- **SQLite + ポーリング型アーキテクチャ**: nanoclaw と同様に、受信メッセージをまず SQLite に永続化し、ポーリングループ（2秒間隔）が未処理のメンションを拾って処理します。クラッシュしても再起動時に未処理メッセージを取りこぼしません。
- **会話履歴コンテキスト**: 直近24時間のチャンネル履歴を毎回 Gemini に渡すため、前の会話を踏まえた返答ができます。
- **安全なコード実行（Sandbox）**: Python / Node.js / bash のコードを一時 Docker コンテナで実行します。ホスト環境には影響しません。
- **ファイルベースのシステムプロンプト**: `.md` ファイルを編集するだけでキャラクターや動作ルールを変更できます。リビルド不要です。

---

## ディレクトリ構成

```
gemiclaw/
├── src/
│   ├── index.ts        # Discord接続・メッセージ受信・ポーリングループ
│   ├── db.ts           # SQLite層（メッセージ永続化・履歴取得）
│   ├── agent.ts        # Gemini API呼び出し・レスポンス生成
│   ├── memory.ts       # エージェントの手動メモ書き込み
│   ├── sandbox.ts      # Dockerサンドボックス実行
│   └── skills/         # ツール定義（Gemini Function Calling用）
├── memory/             # 実行時データ（Dockerボリューム）
│   ├── messages.db     # SQLite: 全メッセージ履歴・状態管理
│   └── YYYY-MM-DD.txt  # エージェントが書き込む手動メモ
├── workspace/          # エージェントがファイルを読み書きする領域
├── knowledge/          # エージェントが参照する外部ドキュメント
├── AGENTS.md           # 基本指示・ルール
├── SOUL.md             # キャラクター・口調
├── USER.md             # ユーザー情報
├── TOOLS.md            # ツール利用ガイド
├── IDENTITY.md         # 名前・プロフィール
├── Dockerfile
└── docker-compose.yml
```

---

## セットアップ

### 前提条件

- Docker Engine（Docker Desktop 等）
- Gemini API キー
- Discord Bot トークン（[Discord Developer Portal](https://discord.com/developers/applications) から取得）

### 1. 環境変数の設定

`.env.example` をコピーして `.env` を作成し、キーを設定します。

```bash
cp .env.example .env
```

```env
DISCORD_TOKEN=あなたのDiscord Botトークン
GEMINI_API_KEY=あなたのGemini APIキー
GEMINI_MODEL=gemini-2.5-flash   # 省略可能（デフォルト: gemini-2.5-flash）
```

### 2. Discord Bot の Privileged Intents を有効化

[Discord Developer Portal](https://discord.com/developers/applications) の対象アプリ → **Bot** ページ → **Privileged Gateway Intents** で以下をすべて ON にしてください。

- ✅ SERVER MEMBERS INTENT
- ✅ MESSAGE CONTENT INTENT（必須）

### 3. 起動

```bash
docker-compose up -d --build
```

ログの確認：

```bash
docker-compose logs -f
```

### 4. サンドボックス用イメージの事前取得（推奨）

初回実行を速くするため、サンドボックスで使用するイメージをあらかじめ pull しておきます。

```bash
docker pull python:3.11-slim
docker pull node:20-slim
docker pull ubuntu:22.04
```

---

## 使い方

Discord サーバー内でボットを**メンション**して話しかけます。

```
@gemiclaw 今日の天気を調べて
@gemiclaw 現在時刻を表示するPythonスクリプトを実行して
```

### プロンプトのカスタマイズ

プロジェクトルートの `.md` ファイルを編集するだけで反映されます。リビルドは不要です。

| ファイル | 内容 |
|---|---|
| `AGENTS.md` | 基本指示・行動ルール |
| `SOUL.md` | キャラクター・口調・振る舞い |
| `USER.md` | ユーザー自身の情報 |
| `TOOLS.md` | ツールの利用ガイド |
| `IDENTITY.md` | 名前・プロフィール |

---

## アーキテクチャ概要

```
Discord
  │
  │ messageCreate イベント
  ▼
[index.ts] ─── storeMessage() ──▶ messages.db（SQLite）
  │
  │ setInterval(2000ms)
  ▼
[ポーリングループ]
  │ getNewMentions()
  ▼
[チャンネルごとの処理キュー]
  │ getChannelHistory() + processMessage()
  ▼
[agent.ts] ──▶ Gemini API
  │
  ▼
Discord へ返信 + storeMessage()（ボット発言も保存）
```

メッセージの受信と処理を分離しているため、処理中に届いたメッセージは次のポーリングで確実に処理されます。
