# gemiclaw 🐾

gemiclawは、[`openclaw`](https://github.com/openclaw/openclaw) や [`nanoclaw`](https://github.com/qwibitai/nanoclaw) の設計思想を汲んだ、Google Gemini APIとDiscordを連携させるための最小構成AIエージェントです。

最大の特徴として、「自分自身でコードを書いて、自分自身で安全に（Dockerコンテナ内で）実行・テストする」サンドボックス機能を備えています。

## 特徴
- **極小・軽量**: TypeScript (`tsx`使用)＋極力少ない外部依存で構成されています。
- **ファイルベースのシステムプロンプト**: `AGENTS.md`や`SOUL.md`を変更するだけで、AIの性格や動作ルールを簡単に変更できます。
- **自動メモリ記録機能**: 会話からの学びや重要なコンテキストを自動で `memory/` ディレクトリに保存・読み込みします。
- **安全なコード実行機能 (`Sandbox`)**: Python, Node, bashのスクリプトを、一時的なDockerコンテナ内で実行して結果をチャットに返します。ホスト環境を汚しません。

---

## セットアップ手順

### 前提条件
以下のソフトウェアがインストールされている必要があります。
- Node.js (v18以降を推奨)
- Docker Engine (Docker Desktopなど。サンドボックス機能に必須です)
- Gemini API キー
- Discord Bot トークン（[Discord Developer Portal](https://discord.com/developers/applications)から取得）

### 1. インストール
リポジトリをクローンまたはダウンロードし、依存関係をインストールします。

```bash
npm install
```

### 2. 環境変数の設定
プロジェクトルート直下にある `.env` ファイルに、必要なAPIキーを設定します。（`.env` ファイルがない場合は作成してください）

```env
DISCORD_TOKEN=あなたの_Discord_Botのトークン
GEMINI_API_KEY=あなたの_Gemini_APIのキー
GEMINI_MODEL=gemini-2.5-flash # （オプション）希望のモデルがあれば
```

### 3. Discord BotのPrivileged Intentsを有効化（必須）
このbotはメッセージ内容を読み取るために **Message Content Intent（Privileged Gateway Intent）** を必要とします。
[Discord Developer Portal](https://discord.com/developers/applications) の対象Appの **Bot** ページを開き、
「Privileged Gateway Intents」セクションで以下の **3つをすべてON** にして **Save Changes** を押してください。

- ✅ PRESENCE INTENT
- ✅ SERVER MEMBERS INTENT
- ✅ **MESSAGE CONTENT INTENT**（特に重要）

> **注意**: この設定をしないとbotは起動直後にクラッシュします。

---

### 5. 初期イメージのPull（推奨）
Dockerサンドボックスが素早く起動できるように、使用するベースイメージをあらかじめローカルに保存（Pull）しておきます。

```bash
docker pull python:3.11-slim
docker pull node:20-slim
docker pull ubuntu:22.04
```

### 6. 起動
以下のコマンドで、Docker Composeを使用してエージェント（gemiclaw本体）が起動します。

```bash
docker-compose up -d
```

このコマンドにより、gemiclaw自体が隔離された軽量なコンテナとして実行され、ホストのDocker Socketを通じて安全なサンドボックス（テスト用一時コンテナ）を生成できるようになります。

ログを確認する場合は以下のコマンドを使用します：
```bash
docker-compose logs -f
```

---

## 使い方

Discordサーバーに招待したbotに対して、**メンション**をつけて話しかけてください。
（例: `@gemiclaw こんにちは！今の時間を教えるPythonスクリプトを書いて実行してみて！`）

### カスタマイズ（プロンプトの調整）
以下のMarkdownファイルを編集することで、エージェントの挙動を直接制御できます。

- `AGENTS.md` : 基本的な指示事項、ルール
- `SOUL.md` : キャラクター性、口調、振る舞い
- `USER.md` : あなた（ユーザー）自身の情報
- `TOOLS.md` : ツールに関する事前知識
- `IDENTITY.md` : 名前やプロフィール設定
