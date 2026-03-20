# Setup Guide

[🇯🇵 日本語](setup.md) | [← Back to README](../README.en.md)

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone the Repository](#2-clone-the-repository)
3. [Set Environment Variables](#3-set-environment-variables)
4. [Set Up Google APIs (Optional)](#4-set-up-google-apis-optional)
5. [Start with Docker](#5-start-with-docker)
6. [Verify It Works](#6-verify-it-works)

---

## 1. Prerequisites

Prepare the following in advance.

- **Docker Desktop** (Windows / Mac) or **Docker Engine** (Linux)
- **Gemini API key** — [How to get one](#getting-a-gemini-api-key)
- **Discord Bot token** — [How to get one](#creating-a-discord-bot-and-getting-the-token)

---

## 2. Clone the Repository

```bash
git clone https://github.com/qwibitai/gemiclaw.git
cd gemiclaw
```

---

## 3. Set Environment Variables

### 3-1. Create the .env file

```bash
cp .env.example .env
```

Open `.env` and fill in the following:

```env
DISCORD_TOKEN=your_discord_bot_token
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.1-flash-lite-preview  # Optional (default value)
```

### 3-2. Configure Key Binder API keys

Required if you want to use external APIs (Brave Search, Mapbox, etc.). You can start without them if not needed.

```bash
cp keybinder/secrets_for_skills.example.json keybinder/secrets_for_skills.json
```

Open `keybinder/secrets_for_skills.json` and fill in your keys:

```json
{
  "brave": { "api_key": "YOUR_BRAVE_API_KEY" },
  "mapbox": { "access_token": "YOUR_MAPBOX_TOKEN" }
}
```

---

## 4. Set Up Google APIs (Optional)

Only required if you want to use Drive, Calendar, Tasks, or Sheets integration. Skip this section if you don't need it.

### 4-1. Configure your Google Cloud project

1. Open [Google Cloud Console](https://console.cloud.google.com/) and sign in with your Google account.
2. Select a project (or create a new one).
3. Go to **APIs & Services → Library** and enable the following APIs:
   - Google Drive API
   - Google Calendar API
   - Google Tasks API
   - Google Sheets API

### 4-2. Create an OAuth2 Client ID

1. Go to **APIs & Services → Credentials**.
2. Click **Create credentials → OAuth client ID**.
3. Select **Desktop app** as the application type.
4. Enter a name (e.g. `gemiclaw`) and click **Create**.
5. Download the generated JSON file and save it as `keybinder/client_secret.json`.

> One `client_secret.json` covers all APIs — it represents your app, not any specific API. Which APIs you can access is controlled by scopes.

### 4-3. Add yourself as a test user

While the app is in testing mode (the default for personal use), only registered test users can authenticate.

1. Go to **APIs & Services → OAuth consent screen**.
2. Under the "Test users" section, click **+ ADD USERS**.
3. Add your Google account email address and save.

> Skipping this step will result in `Error 403: access_denied` during authentication.

### 4-4. Run the authentication script

```bash
pip install google-auth-oauthlib
cd keybinder
python3 setup_google_auth.py
```

A browser window will open. Sign in with your Google account and grant access. When complete, `keybinder/token.json` is saved automatically.

> `token.json` contains an `access_token` (expires in 1 hour) and a `refresh_token` (long-lived). The keybinder refreshes the token automatically — no need to re-run the script.

### 4-5. Adding new API scopes later

Add the new scope to the `SCOPES` list in `setup_google_auth.py`, delete `keybinder/token.json`, and re-run the script.

```bash
rm keybinder/token.json
cd keybinder && python3 setup_google_auth.py
```

> Both `client_secret.json` and `token.json` are listed in `.gitignore` and will never be committed to Git.

---

## 5. Start with Docker

```bash
docker-compose up -d --build
```

---

## 6. Verify It Works

```bash
docker-compose logs -f  # View logs (Ctrl+C to exit)
```

Mention the bot on Discord to start chatting.

```
@gemiclaw Hello!
```

---

## Appendix: How to Get API Keys

### Getting a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/) and sign in with your Google account.
2. Click **"Get API key"** in the left menu.
3. Press **"Create API key"** to generate a key.
4. Copy the key and paste it into `GEMINI_API_KEY=` in your `.env` file.

> **Free tier**: As of March 2026, `gemini-3.1-flash-light` is available on the free tier. Usage can be checked in the [Google AI Studio](https://aistudio.google.com/) dashboard.

---

### Creating a Discord Bot and Getting the Token

#### 1. Create an application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and log in with your Discord account.
2. Click **"New Application"** in the upper right.
3. Enter an application name (e.g. `gemiclaw`) and press **"Create"**.

#### 2. Add a Bot and get the token

1. Click **"Bot"** in the left menu.
2. Press **"Add Bot"** (or "Reset Token").
3. Click **"Copy"** under **"Token"** to copy the token and paste it into `DISCORD_TOKEN=` in your `.env` file.
   > ⚠️ The token is shown only once. If lost, regenerate it with "Reset Token".

#### 3. Enable Privileged Gateway Intents

At the bottom of the same **"Bot"** page, under **"Privileged Gateway Intents"**, turn the following **ON**:

- ✅ **SERVER MEMBERS INTENT**
- ✅ **MESSAGE CONTENT INTENT** (required to read message content)

#### 4. Invite the Bot to your server

1. Go to **"OAuth2" → "URL Generator"** in the left menu.
2. Check `bot` under **"Scopes"**.
3. Check the following under **"Bot Permissions"**:
   - ✅ Read Messages / View Channels
   - ✅ Send Messages
   - ✅ Read Message History
   - ✅ Attach Files (if using an image-sending skill)
4. Copy the generated URL at the bottom of the page and open it in your browser.
5. Select the server you want to invite the bot to and press **"Authorize"**.

#### 5. How to find a Channel ID

For use in `config/channels.json` and `config/cron.json`:

1. In Discord, go to **Settings → Advanced → Developer Mode** and turn it **ON**.
2. Right-click the target channel → select **"Copy ID"**.
