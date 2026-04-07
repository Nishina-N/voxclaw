# セットアップガイド

[🇺🇸 English](setup.en.md) | [← README に戻る](../README.ja.md)

## 目次

1. [前提条件](#1-前提条件)
2. [リポジトリをクローン](#2-リポジトリをクローン)
3. [環境変数を設定する](#3-環境変数を設定する)
4. [起動する](#4-起動する)
5. [動作確認](#5-動作確認)
6. [オプション：Discord 連携](#6-オプションdiscord-連携)
7. [オプション：Google API 連携](#7-オプションgoogle-api-連携)
8. [オプション：Cloudflare Tunnel（外部公開）](#8-オプションcloudflare-tunnel外部公開)
9. [オプション：スキル用 APIキー](#9-オプションスキル用-apiキー)

---

## 1. 前提条件

以下を事前に用意してください。

- **Docker Desktop**（Windows / Mac）または **Docker Engine**（Linux）
- **Gemini API キー** — [取得方法はこちら](#gemini-api-キーの取得)

Discord 連携・Google 連携はオプションです。最小構成では不要です。

---

## 2. リポジトリをクローン

```bash
git clone https://github.com/Nishina-N/voxclaw.git
cd voxclaw
```

---

## 3. 環境変数を設定する

```bash
cp .env.example .env
```

`.env` を開いて最低限以下の2項目を設定します。

```env
GEMINI_API_KEY=取得した Gemini API キー
PWA_PASSWORD=ログイン用パスワード（任意の文字列）
```

その他の設定項目はオプションです。後から追加・変更できます。

---

## 4. 起動する

```bash
docker compose up -d --build
```

初回はイメージのビルドに数分かかります。

---

## 5. 動作確認

ブラウザで **http://localhost:3000** を開きます。

設定した `PWA_PASSWORD` でログインし、Chat タブでテキスト入力または音声入力を試してください。

```bash
# ログを確認したい場合
docker compose logs -f
```

---

## 6. オプション：Discord 連携

Voxclaw を Discord Bot として動かす場合に設定します。

### 6-1. Bot トークンを取得する

[Discord Bot の作成とトークン取得](#discord-bot-の作成とトークン取得) を参照してください。

### 6-2. .env に追記する

```env
DISCORD_TOKEN=取得した Bot トークン
TALK_CHANNEL_ID=メンションなしで応答させるチャンネルの ID（省略可）
```

`TALK_CHANNEL_ID` を設定したチャンネルはメンション不要で全発言に反応します。未設定の場合は `@voxclaw` メンションのみ反応します。

### 6-3. 再起動する

```bash
docker compose up -d --build
```

---

## 7. オプション：Google API 連携

Google カレンダー・Drive・Sheets・Tasks を使う場合に必要です。

### 7-1. Google Cloud プロジェクトを設定する

1. [Google Cloud Console](https://console.cloud.google.com/) でプロジェクトを作成（または既存を選択）します。
2. **「APIとサービス」→「ライブラリ」** で使用する API を有効化します。
   - Google Calendar API
   - Google Drive API
   - Google Sheets API
   - Google Tasks API

### 7-2. OAuth2 クライアント ID を作成する

1. **「APIとサービス」→「認証情報」→「OAuth クライアント ID を作成」** を開きます。
2. アプリケーションの種類: **「ウェブアプリケーション」** を選択します。
3. 承認済みのリダイレクト URI に **`http://localhost:3000/auth/google/callback`** を追加します。
   > 外部公開（Cloudflare Tunnel等）を使う場合は `.env` の `GOOGLE_OAUTH_REDIRECT_URI` を変更し、こちらにも同じ URL を登録してください。
4. 作成した JSON をダウンロードし、**`keybinder/secrets/client_secret.json`** として保存します。

### 7-3. テストユーザーに自分を追加する

**「APIとサービス」→「OAuth 同意画面」→「テストユーザー」** に自分のメールアドレスを追加してください。

> この手順を省略すると認証時に `Error 403: access_denied` が表示されます。

### 7-4. 認証を完了する

Docker を起動した状態で、**Voxclaw のチャットに「Googleの認証をセットアップして」と送信**してください。表示されたリンクをクリックして Google アカウントでログインすれば完了です。

> 認証完了後は `keybinder/secrets/token.json` が自動生成されます。keybinder が自動でリフレッシュするため、再認証は不要です。

---

## 8. オプション：Cloudflare Tunnel（外部公開）

自宅サーバーをドメイン経由で外部公開する場合に使います。スマートフォンからアクセスするのに便利です。

### 8-1. Cloudflare でトンネルを作成する

[Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **「Access」→「Tunnels」** から新しいトンネルを作成し、トークンを取得します。

### 8-2. .env に追記する

```env
CLOUDFLARE_TUNNEL_TOKEN=取得したトンネルトークン
```

### 8-3. tunnel プロファイルで起動する

```bash
docker compose --profile tunnel up -d
```

---

## 9. オプション：スキル用 APIキー

Brave Search（Web 検索）や Mapbox（地図）スキルを使う場合に設定します。

```bash
cp keybinder/secrets/keys.example.json keybinder/secrets/keys.json
```

`keybinder/secrets/keys.json` を編集して API キーを設定します。

```json
{
  "brave": { "api_key": "YOUR_BRAVE_API_KEY" },
  "mapbox": { "access_token": "YOUR_MAPBOX_TOKEN" }
}
```

変更後は keybinder を再起動します。

```bash
docker compose restart keybinder
```

---

## 補足：Gemini API キーの取得

1. [Google AI Studio](https://aistudio.google.com/) にアクセスし、Google アカウントでログインします。
2. 左側メニューの **「Get API key」** をクリックします。
3. **「Create API key」** ボタンを押すと API キーが発行されます。
4. 発行されたキーを `.env` の `GEMINI_API_KEY=` に貼り付けます。

> **無料枠について**: 2026年時点では `gemini-2.5-flash` 系は無料枠で利用できます。使用量は [Google AI Studio](https://aistudio.google.com/) のダッシュボードで確認できます。

---

## 補足：Discord Bot の作成とトークン取得

### 1. アプリケーションを作成する

1. [Discord Developer Portal](https://discord.com/developers/applications) にアクセスし、ログインします。
2. 右上の **「New Application」** をクリックします。
3. アプリケーション名（例: `voxclaw`）を入力して **「Create」** を押します。

### 2. Bot トークンを取得する

1. 左メニューの **「Bot」** をクリックします。
2. **「Reset Token」** ボタンを押してトークンをコピーし、`.env` の `DISCORD_TOKEN=` に貼り付けます。
   > ⚠️ トークンは一度しか表示されません。紛失した場合は「Reset Token」で再発行してください。

### 3. Privileged Gateway Intents を有効化する

同じ **「Bot」** ページの **「Privileged Gateway Intents」** で以下を **ON** にします。

- ✅ **SERVER MEMBERS INTENT**
- ✅ **MESSAGE CONTENT INTENT**（必須）

### 4. Bot をサーバーに招待する

1. 左メニューの **「OAuth2」→「URL Generator」** を開きます。
2. **「Scopes」** で `bot` にチェックを入れます。
3. **「Bot Permissions」** で以下にチェックを入れます。
   - ✅ Read Messages / View Channels
   - ✅ Send Messages
   - ✅ Read Message History
   - ✅ Attach Files
4. 生成された URL をブラウザで開き、サーバーを選択して認証します。

### 5. チャンネル ID の取得方法

Discord の **設定 → 詳細設定 → 開発者モード** を ON にして、チャンネルを右クリック → **「IDをコピー」** を選択します。
