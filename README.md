# gemiclaw 🐾

[`nanoclaw`](https://github.com/qwibitai/nanoclaw) の設計思想を汲んだ、Google Gemini API と Discord を連携させる最小構成AIエージェントです。

## 特徴

- **SQLite + ポーリング型アーキテクチャ**: 受信メッセージをまず SQLite に永続化し、ポーリングループ（2秒間隔）が処理します。クラッシュしても再起動時にメッセージを取りこぼしません。
- **会話履歴コンテキスト**: 直近24時間のチャンネル履歴を Gemini に渡すため、前の会話を踏まえた返答ができます。
- **Function Calling エージェントループ**: ファイル読み書き・ディレクトリ探索・メモ記録をツールとして実行します。テキストで描写するだけでなく、実際に動作します。
- **チャンネル別の応答設定**: `config/channels.json` を編集するだけで、チャンネルごとにメンション必須/不要を切り替えられます。リビルド不要です。
- **拡張可能なチャンネル抽象**: `Channel` インターフェースで Discord を抽象化しており、将来的に Telegram 等への対応が容易です。

---

## ディレクトリ構成

```
gemiclaw/
├── src/
│   ├── index.ts          # エントリーポイント・ポーリングループ
│   ├── db.ts             # SQLite層（メッセージ永続化・履歴取得）
│   ├── agent.ts          # Gemini API呼び出し・エージェントループ
│   ├── memory.ts         # 日次メモの読み書き
│   ├── channels/
│   │   ├── types.ts      # Channel インターフェース定義
│   │   └── discord.ts    # Discord実装
│   └── skills/           # Function Calling ツール定義と実装
│       ├── files.ts      # read_file / write_file / list_directory
│       └── memory.ts     # read_memory / write_memory
│
├── config/               # ボットの挙動設定（エージェントが読み書き可）
│   └── channels.json     # チャンネル別設定（requireMention 等）
│
├── memory/               # 永続データ（Dockerボリューム）
│   ├── messages.db       # SQLite: 全メッセージ履歴・状態管理
│   └── YYYY-MM-DD.txt    # エージェントが書き込む日次メモ
│
├── workspace/            # エージェントの作業出力領域
├── knowledge/            # 参照ドキュメント（読み取り専用）
│
├── AGENTS.md             # エージェントへの行動ルール
├── SOUL.md               # キャラクター・口調
├── USER.md               # ユーザー情報
├── TOOLS.md              # ツール仕様・可変/非可変の定義
├── IDENTITY.md           # 名前・プロフィール
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

```bash
cp .env.example .env
```

```env
DISCORD_TOKEN=あなたのDiscord Botトークン
GEMINI_API_KEY=あなたのGemini APIキー
GEMINI_MODEL=gemini-2.5-flash   # 省略可能（デフォルト: gemini-2.5-flash）
```

### 2. Discord Bot の Privileged Intents を有効化

[Discord Developer Portal](https://discord.com/developers/applications) の対象アプリ → **Bot** → **Privileged Gateway Intents** で以下を ON にしてください。

- ✅ SERVER MEMBERS INTENT
- ✅ MESSAGE CONTENT INTENT（必須）

### 3. 起動

```bash
docker-compose up -d --build
```

```bash
docker-compose logs -f  # ログ確認
```

---

## 使い方

### メンションして話しかける（デフォルト）

```
@gemiclaw /app/workspace の中身を見て
@gemiclaw 今日の作業メモを書いて
```

### メンションなしで返信するチャンネルを設定する

`config/channels.json` にチャンネルIDを追加するだけです。リビルド不要です。

```json
{
  "チャンネルID": {
    "name": "talk",
    "requireMention": false
  }
}
```

エージェント自身に `write_file` ツールで設定させることもできます。

---

## プロンプトのカスタマイズ

プロジェクトルートの `.md` ファイルを編集するだけで反映されます。リビルド不要です。

| ファイル | 内容 |
|---|---|
| `AGENTS.md` | 行動ルール・ファイルシステムの制約 |
| `SOUL.md` | キャラクター・口調・振る舞い |
| `USER.md` | ユーザー自身の情報 |
| `TOOLS.md` | ツール仕様・可変/非可変の定義 |
| `IDENTITY.md` | 名前・プロフィール |

---

## アーキテクチャ

```
Discord
  │
  │ messageCreate → storeMessage()
  ▼
messages.db（SQLite）
  ▲
  │ getNewMentions() または getNewMessages()
  │ setInterval(2000ms)
  │
[ポーリングループ / index.ts]
  │
  │ channels.json で requireMention を判定
  ▼
[processChannel()]
  │ getChannelHistory() → Gemini へ履歴付きで投げる
  ▼
[agent.ts — エージェントループ]
  │
  ├─ functionCall あり → executeTool() → 結果を Gemini へ返す → 繰り返す
  └─ テキスト応答 → Discord へ送信 + storeMessage()
```

### 可変部と非可変部

| 領域 | 可変 | 説明 |
|---|---|---|
| `src/` | ❌ | ポーリング・接続・ツールエンジン（コンテナに焼き込み） |
| `config/` | ✅ | チャンネル設定（エージェントが読み書き可） |
| `workspace/` | ✅ | エージェントの作業出力 |
| `memory/` | ✅ | 日次メモ・SQLite DB |
| `knowledge/` | 読み取り専用 | 参照ドキュメント |
| `*.md` プロンプト | ✅ | キャラクター・ルール（リビルド不要） |
