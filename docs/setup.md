# セットアップガイド

[🇺🇸 English](setup.en.md) | [← README に戻る](../README.md)

## 目次

1. [前提条件](#1-前提条件)
2. [リポジトリをクローン](#2-リポジトリをクローン)
3. [環境変数を設定する](#3-環境変数を設定する)
4. [Google API を設定する（省略可）](#4-google-api-を設定する省略可)
5. [Docker で起動する](#5-docker-で起動する)
6. [動作確認](#6-動作確認)

---

## 1. 前提条件

以下を事前に用意してください。

- **Docker Desktop**（Windows / Mac）または **Docker Engine**（Linux）
- **Gemini API キー** — [取得方法はこちら](#gemini-api-キーの取得)
- **Discord Bot トークン** — [取得方法はこちら](#discord-bot-の作成とトークン取得)

---

## 2. リポジトリをクローン

```bash
git clone https://github.com/qwibitai/voxclaw.git
cd voxclaw
```

---

## 3. 環境変数を設定する

### 3-1. .env ファイルを作成する

```bash
cp .env.example .env
```

`.env` を開いて以下を記入します。

```env
DISCORD_TOKEN=取得したDiscord Botトークン
GEMINI_API_KEY=取得したGemini APIキー
GEMINI_MODEL=gemini-3.1-flash-lite-preview  # 省略可（デフォルト値）
```

### 3-2. Key Binder のAPIキーを設定する

外部 API（Brave Search・Mapbox など）を使う場合に必要です。使わない場合は空のまま起動できます。

```bash
cp keybinder/secrets_for_skills.example.json keybinder/secrets_for_skills.json
```

`keybinder/secrets_for_skills.json` を開いて記入します。

```json
{
  "brave": { "api_key": "YOUR_BRAVE_API_KEY" },
  "mapbox": { "access_token": "YOUR_MAPBOX_TOKEN" }
}
```

---

## 4. Google API を設定する（省略可）

Drive・Calendar・Tasks・Sheets 連携を使う場合のみ必要です。使わない場合はこの手順をスキップしてください。

### 4-1. Google Cloud プロジェクトの設定

1. [Google Cloud Console](https://console.cloud.google.com/) を開き、Google アカウントでログインします。
2. プロジェクトを選択（または新規作成）します。
3. **「APIとサービス」→「ライブラリ」** で以下の API を有効化します：
   - Google Drive API
   - Google Calendar API
   - Google Tasks API
   - Google Sheets API

### 4-2. OAuth2 クライアント ID を作成する

1. **「APIとサービス」→「認証情報」** を開きます。
2. **「認証情報を作成」→「OAuth クライアント ID」** をクリックします。
3. アプリケーションの種類で **「デスクトップアプリ」** を選択します。
4. 名前を入力（例: `voxclaw`）して **「作成」** を押します。
5. 生成された JSON をダウンロードし、`keybinder/client_secret.json` として保存します。

> `client_secret.json` は複数の API を追加しても1つで共通です。どの API にアクセスするかはスコープで制御されます。

### 4-3. テストユーザーに自分を追加する

アプリが本番公開されていない場合（通常はこちら）、認証できるのは登録済みのテストユーザーのみです。

1. **「APIとサービス」→「OAuth 同意画面」** を開きます。
2. 「テストユーザー」セクションの **「+ ADD USERS」** をクリックします。
3. 自分の Google アカウントのメールアドレスを追加して保存します。

> この手順を省略すると認証時に `Error 403: access_denied` が表示されます。

### 4-4. 認証スクリプトを実行する

```bash
pip install google-auth-oauthlib
cd keybinder
python3 setup_google_auth.py
```

ブラウザが開くので Google アカウントでログインして許可します。完了すると `keybinder/token.json` が自動で生成されます。

> `token.json` は1時間で期限切れになる `access_token` と、長期有効な `refresh_token` を含んでいます。keybinder が自動でリフレッシュするため、再実行は不要です。

### 4-5. 新しい API スコープを追加したいとき

`setup_google_auth.py` の `SCOPES` リストに追加して、`keybinder/token.json` を削除してから再実行してください。

```bash
rm keybinder/token.json
cd keybinder && python3 setup_google_auth.py
```

> `client_secret.json` と `token.json` は `.gitignore` に含まれており、Git にはコミットされません。

---

## 5. Docker で起動する

```bash
docker-compose up -d --build
```

---

## 6. 動作確認

```bash
docker-compose logs -f  # ログ確認（Ctrl+C で抜ける）
```

Discord でボットをメンションして話しかけてください。

```
@voxclaw こんにちは！
```

---

## 補足：APIキーの取得方法

### Gemini API キーの取得

1. [Google AI Studio](https://aistudio.google.com/) にアクセスし、Google アカウントでログインします。
2. 左側メニューの **「Get API key」** をクリックします。
3. **「Create API key」** ボタンを押すと API キーが発行されます。
4. 発行されたキーをコピーして `.env` の `GEMINI_API_KEY=` に貼り付けます。

> **無料枠について**: 2026/3時点では `gemini-3.1-flash-light` は無料枠で利用できます。使用量は [Google AI Studio](https://aistudio.google.com/) のダッシュボードで確認できます。

---

### Discord Bot の作成とトークン取得

#### 1. アプリケーションを作成する

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセスし、Discord アカウントでログインします。
2. 右上の **「New Application」** をクリックします。
3. アプリケーション名（例: `voxclaw`）を入力して **「Create」** を押します。

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
