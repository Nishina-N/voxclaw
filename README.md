# gemiclaw 🐾

[Openclaw](https://github.com/openclawai/openclaw) と [Nanoclaw](https://github.com/qwibitai/nanoclaw) にインスパイアされた、**Google Gemini API × Discord の自律エージェント**です。Docker上で動作し、エージェントが自分でスキルを作り・マニュアルを育て・cronで自律動作する三層構造が特徴です。

>  制作背景や設計思想は [Zenn 記事](https://zenn.dev/nishina__n/articles/69587684b36113) で詳しく書いています。
---

## 特徴

- **自己拡張（動的スキル）**: エージェントが `config/skills/` にスキルを自作し、新しいツールを即座に獲得できます。リビルド不要。
- **自己更新（人格・ユーザー情報）**: `SOUL.md`・`USER.md`・`IDENTITY.md` をエージェントが直接書き換えられます。
- **スキル × マニュアル × cron の三層構造**: スキルは最小機能単位、マニュアルは組み合わせ手順書、cronがマニュアルを定時に起動するトリガーになります。
- **SQLite + ポーリング**: メッセージをSQLiteに永続化し2秒間隔で処理。クラッシュ後も取りこぼしなし。
- **可変部と非可変部の分離**: エージェントループ・接続部分はコンテナに焼き込み。設定・スキル・マニュアルはボリュームマウントで永続化。

---

## 三層構造

```
スキル（config/skills/）        ← 最小機能単位。エージェントが自作。
  └─ マニュアル（config/manuals/） ← スキルの組み合わせ手順書。
       └─ cron（config/cron.json）  ← マニュアルを定時に起動するトリガー。
```

cronの `prompt` にマニュアルのパスを渡すことで、定時タスクの精度がマニュアルの品質に直結します。

```json
{
  "id": "daily_market_news",
  "cron": "0 23 * * *",
  "prompt": "マニュアル（/app/config/manuals/market_news_recipe.md）に従って米国株式市場ニュースを投稿してください。",
  "channelId": "チャンネルID",
  "enabled": true
}
```

---

## ディレクトリ構成

```
gemiclaw/
├── src/                      # ❌ 非可変（コンテナに焼き込み）
│   ├── index.ts              # エントリーポイント・ポーリングループ
│   ├── db.ts                 # SQLite層
│   ├── agent.ts              # Gemini API・エージェントループ
│   ├── cron-runner.ts        # cronスケジューラ
│   ├── skill-loader.ts       # 動的スキルのロード・実行
│   ├── channels/
│   │   ├── types.ts          # Channel インターフェース
│   │   └── discord.ts        # Discord実装
│   └── skills/               # 組み込みツール
│       ├── files.ts          # read_file / write_file / list_directory
│       ├── memory.ts         # read_memory / write_memory
│       └── pip.ts            # pip_install
│
├── config/                   # ✅ 可変（エージェント・人間が読み書き可）
│   ├── channels.json         # チャンネル別設定（requireMention 等）
│   ├── cron.json             # 定期タスク定義
│   ├── skills/               # エージェントが自作した動的スキル
│   │   └── <skill-name>/
│   │       ├── definition.json   # Gemini FunctionDeclaration
│   │       └── run.sh            # 実行スクリプト
│   ├── manuals/              # スキルの組み合わせ手順書
│   │   └── <task>_recipe.md
│   └── pip_packages/         # pip_install で永続化されたパッケージ
│
├── memory/                   # ✅ 可変（SQLite DB・日次メモ）
├── workspace/                # ✅ 可変（エージェントの作業出力）
├── knowledge/                # 📖 読み取り専用（参照ドキュメント）
│
├── AGENTS.md                 # 行動ルール             ※読み取り専用
├── TOOLS.md                  # ツール仕様             ※読み取り専用
├── SOUL.md                   # キャラクター・口調     ✅ エージェントが書き換え可
├── USER.md                   # ユーザー情報           ✅ エージェントが書き換え可
├── IDENTITY.md               # 名前・プロフィール     ✅ エージェントが書き換え可
├── Dockerfile
└── docker-compose.yml
```

---

## セットアップ

### 前提条件

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)（Windows / Mac）または Docker Engine（Linux）
- Gemini API キー（[取得方法](#gemini-api-キーの取得)）
- Discord Bot トークン（[取得方法](#discord-bot-の作成とトークン取得)）

### 1. リポジトリをクローン

```bash
git clone https://github.com/qwibitai/gemiclaw.git
cd gemiclaw
```

### 2. 環境変数を設定

```bash
cp .env.example .env
```

`.env` を開いて以下を記入します。

```env
DISCORD_TOKEN=取得したDiscord Botトークン
GEMINI_API_KEY=取得したGemini APIキー
GEMINI_MODEL=gemini-3.1-flash-lite-preview  # 省略可能（デフォルト: gemini-3.1-flash-lite-preview）
```

### 3. 起動

```bash
docker-compose up -d --build
```

```bash
docker-compose logs -f  # ログ確認（Ctrl+C で抜ける）
```

---

## 使い方

### メンションして話しかける

```
@gemiclaw 今日の作業メモを書いて
@gemiclaw /app/workspace の中身を見せて
```

### メンションなしで返信するチャンネルを設定

`config/channels.json` を編集します。エージェント自身に設定させることもできます。

```json
{
  "チャンネルID": {
    "name": "talk",
    "requireMention": false
  }
}
```

### スキルを追加する

エージェントに「〇〇するスキルを作って」と話しかけるだけで、`config/skills/` に自動で追加されます。

### 定期タスクを設定する

`config/cron.json` を編集します（またはエージェントに設定させます）。

```json
[
  {
    "id": "任意のID",
    "cron": "0 9 * * 1-5",
    "prompt": "マニュアル（/app/config/manuals/xxxx.md）に従って実行してください。",
    "channelId": "送信先チャンネルID",
    "enabled": true
  }
]
```

---

## アーキテクチャ

```
Discord
  │ messageCreate → storeMessage()
  ▼
messages.db（SQLite）
  ▲
  │ getNewMentions() / getNewMessages()
  │ setInterval(2000ms)
  ▼
[ポーリングループ / index.ts]          [cron-runner.ts]
  │ channels.json で requireMention 判定  │ cron.json のスケジュールで発火
  └──────────────┬───────────────────────┘
                 ▼
        [processChannel()]
          getChannelHistory() → Gemini へ履歴付きで投げる
                 ▼
        [agent.ts — エージェントループ（最大20ラウンド）]
          config/skills/ をスキャンして動的スキルをロード
          │
          ├─ functionCall → executeTool()
          │   ├─ 組み込みツール（src/skills/）
          │   └─ 動的スキル（config/skills/<name>/run.sh）
          │   → 結果を Gemini へ返す → 繰り返す
          └─ テキスト応答 → Discord へ送信
```

---

## 可変部と非可変部

| 領域 | 書き込み権限 | 説明 |
|---|---|---|
| `src/` | ❌ なし | ループ・接続・ツールエンジン（コンテナに焼き込み） |
| `AGENTS.md` / `TOOLS.md` | 人間のみ | システムルール（読み取り専用マウント） |
| `config/` | ✅ エージェント・人間 | スキル・マニュアル・cron・チャンネル設定 |
| `SOUL.md` / `USER.md` / `IDENTITY.md` | ✅ エージェント・人間 | 人格・ユーザー情報 |
| `workspace/` | ✅ エージェント・人間 | 作業出力 |
| `memory/` | ✅ エージェント | 日次メモ・SQLite DB |
| `knowledge/` | 読み取り専用 | 参照ドキュメント |

---

---

## 補足：APIキーの取得方法

### Gemini API キーの取得

1. [Google AI Studio](https://aistudio.google.com/) にアクセスし、Googleアカウントでログインします。
2. 左側メニューの **「Get API key」** をクリックします。
3. **「Create API key」** ボタンを押すと API キーが発行されます。
4. 発行されたキーをコピーして `.env` の `GEMINI_API_KEY=` に貼り付けます。

> **無料枠について**: 2026/3時点では `gemini-3.1-flash-light` は無料枠で利用できます。使用量は [Google AI Studio](https://aistudio.google.com/) のダッシュボードで確認できます。

---

### Discord Bot の作成とトークン取得

#### 1. アプリケーションを作成する

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセスし、Discordアカウントでログインします。
2. 右上の **「New Application」** をクリックします。
3. アプリケーション名（例: `gemiclaw`）を入力して **「Create」** を押します。

#### 2. Bot を追加してトークンを取得する

1. 左メニューの **「Bot」** をクリックします。
2. **「Add Bot」**（または「Reset Token」）ボタンを押します。
3. **「Token」** の下にある **「Copy」** ボタンでトークンをコピーし、`.env` の `DISCORD_TOKEN=` に貼り付けます。
   > ⚠️ トークンは一度しか表示されません。紛失した場合は「Reset Token」で再発行してください。

#### 3. Privileged Gateway Intents を有効化する

同じ **「Bot」** ページの下部にある **「Privileged Gateway Intents」** で以下の2つを **ON** にします。

- ✅ **SERVER MEMBERS INTENT**
- ✅ **MESSAGE CONTENT INTENT**（メッセージ内容を読むために必須）

#### 4. Bot をサーバーに招待する

1. 左メニューの **「OAuth2」→「URL Generator」** をクリックします。
2. **「Scopes」** で `bot` にチェックを入れます。
3. **「Bot Permissions」** で以下にチェックを入れます。
   - ✅ Read Messages / View Channels
   - ✅ Send Messages
   - ✅ Read Message History
   - ✅ Attach Files（画像送信スキルを使う場合）
4. ページ下部に生成された URL をコピーしてブラウザで開きます。
5. 招待したいサーバーを選択して **「認証」** を押します。

#### 5. チャンネル ID を調べる方法

`config/channels.json` や `config/cron.json` に設定するチャンネル ID の調べ方です。

1. Discord の **設定 → 詳細設定 → 開発者モード** を ON にします。
2. 対象チャンネルを右クリック → **「IDをコピー」** を選択します。

これで `.env` の設定と `config/channels.json` の設定が揃います。
