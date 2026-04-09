# Setup Guide

[🇯🇵 日本語](setup.md) | [← Back to README](../README.md)

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Clone the Repository](#2-clone-the-repository)
3. [Set Environment Variables](#3-set-environment-variables)
4. [Start](#4-start)
5. [Verify It Works](#5-verify-it-works)
6. [Optional: Discord Integration](#6-optional-discord-integration)
7. [Optional: Google API Integration](#7-optional-google-api-integration)
8. [Optional: External Access (Tailscale / Cloudflare Tunnel)](#8-optional-external-access-tailscale--cloudflare-tunnel)
9. [Optional: API Keys for Skills](#9-optional-api-keys-for-skills)

---

## 1. Prerequisites

Prepare the following in advance.

- **Docker Desktop** (Windows / Mac) or **Docker Engine** (Linux)
- **Gemini API key** — [How to get one](#getting-a-gemini-api-key)

Discord and Google integrations are optional. The minimal setup does not require them.

---

## 2. Clone the Repository

```bash
git clone https://github.com/Nishina-N/voxclaw.git
cd voxclaw
```

---

## 3. Set Environment Variables

```bash
cp .env.example .env
```

Open `.env` and set at minimum these two values:

```env
GEMINI_API_KEY=your-gemini-api-key
PWA_PASSWORD=your-login-password
```

All other settings are optional and can be added later.

---

## 4. Start

```bash
docker compose up -d --build
```

The first run takes a few minutes to build the images.

---

## 5. Verify It Works

Open **http://localhost:3000** in your browser.

Log in with the `PWA_PASSWORD` you set, then try typing or speaking in the Chat tab.

```bash
# To check logs
docker compose logs -f
```

---

## 6. Optional: Discord Integration

Set this up if you want Voxclaw to work as a Discord bot.

### 6-1. Get a Bot Token

See [Creating a Discord Bot and Getting the Token](#creating-a-discord-bot-and-getting-the-token).

### 6-2. Add to .env

```env
DISCORD_TOKEN=your-bot-token
TALK_CHANNEL_ID=channel-id-for-unprompted-responses   # optional
```

If `TALK_CHANNEL_ID` is set, Voxclaw responds to all messages in that channel without needing an `@voxclaw` mention. Otherwise only `@voxclaw` mentions are processed.

### 6-3. Restart

```bash
docker compose up -d --build
```

---

## 7. Optional: Google API Integration

Required only if you want to use Google Calendar, Drive, Sheets, or Tasks.

### 7-1. Set Up a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/) and create or select a project.
2. Under **APIs & Services → Library**, enable the APIs you want to use:
   - Google Calendar API
   - Google Drive API
   - Google Sheets API
   - Google Tasks API

### 7-2. Create an OAuth2 Client ID

1. Go to **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type: **Web application**.
3. Add **`http://localhost:3000/auth/google/callback`** as an authorized redirect URI.
   > If using Cloudflare Tunnel or another domain, update `GOOGLE_OAUTH_REDIRECT_URI` in `.env` and register that URL here too.
4. Download the generated JSON and save it as **`keybinder/secrets/client_secret.json`**.

### 7-3. Add Yourself as a Test User

Go to **APIs & Services → OAuth consent screen → Test users** and add your Google account email.

> Skipping this step will result in `Error 403: access_denied` during authentication.

### 7-4. Complete Authentication

With Docker running, **send "Set up Google authentication" in the Voxclaw chat**. Click the link that appears and log in with your Google account.

> After authentication, `keybinder/secrets/token.json` is created automatically. The keybinder refreshes it automatically — no need to re-authenticate.

---

## 8. Optional: External Access (Tailscale / Cloudflare Tunnel)

Two options for accessing Voxclaw from outside your home network.

---

### 8-A. Tailscale (recommended for personal use — no domain required)

Tailscale is a WireGuard-based VPN. Install it on your server and phone to connect them on the same private network — no domain needed.

**Server setup:**

```bash
curl -fsSL https://tailscale.com/install.sh | sh
tailscale up
```

**Phone:** Install Tailscale from the App Store / Google Play and sign in with the same account.

**`.env` configuration:**

```env
AUTH_DISABLED=true   # VPN access only — JWT auth is not needed
```

**Accessing Voxclaw:**

Find your server's Tailscale IP (`100.x.x.x`) in the [Tailscale admin panel](https://login.tailscale.com/admin/machines) and open `http://100.x.x.x:3000` in your phone's browser.

> **HTTPS note:** Browsers require HTTPS for microphone access. Use Tailscale's MagicDNS + HTTPS certificate feature (`tailscale cert`) or set up a self-signed certificate.

---

### 8-B. Cloudflare Tunnel (public access via domain)

Use this if you have a domain and want to expose Voxclaw to the internet. Keep `AUTH_DISABLED=false` (default) so JWT authentication remains active.

#### 8-B-1. Create a Tunnel in Cloudflare

Go to [Cloudflare Zero Trust](https://one.dash.cloudflare.com/) → **Access → Tunnels**, create a new tunnel, and copy the token.

#### 8-B-2. Add to .env

```env
CLOUDFLARE_TUNNEL_TOKEN=your-tunnel-token
```

#### 8-B-3. Start with the tunnel profile

```bash
docker compose --profile tunnel up -d
```

---

## 9. Optional: API Keys for Skills

Required only if you want to use Brave Search (web search) or Mapbox (maps) skills.

```bash
cp keybinder/secrets/keys.example.json keybinder/secrets/keys.json
```

Edit `keybinder/secrets/keys.json` to add your API keys:

```json
{
  "brave": { "api_key": "YOUR_BRAVE_API_KEY" },
  "mapbox": { "access_token": "YOUR_MAPBOX_TOKEN" }
}
```

Then restart keybinder:

```bash
docker compose restart keybinder
```

---

## Appendix: Getting a Gemini API Key

1. Go to [Google AI Studio](https://aistudio.google.com/) and sign in with your Google account.
2. Click **"Get API key"** in the left menu.
3. Click **"Create API key"** and copy the generated key.
4. Paste it into `.env` as `GEMINI_API_KEY=`.

> **Free tier**: As of early 2026, Gemini 2.5 Flash models are available on the free tier. Monitor usage at [Google AI Studio](https://aistudio.google.com/).

---

## Appendix: Creating a Discord Bot and Getting the Token

### 1. Create an Application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and log in.
2. Click **"New Application"** in the top right.
3. Enter a name (e.g. `voxclaw`) and click **"Create"**.

### 2. Get the Bot Token

1. Click **"Bot"** in the left menu.
2. Click **"Reset Token"**, copy the token, and paste it into `.env` as `DISCORD_TOKEN=`.
   > ⚠️ The token is only shown once. If lost, regenerate it with "Reset Token".

### 3. Enable Privileged Gateway Intents

On the same **"Bot"** page, enable under **"Privileged Gateway Intents"**:

- ✅ **SERVER MEMBERS INTENT**
- ✅ **MESSAGE CONTENT INTENT** (required)

### 4. Invite the Bot to Your Server

1. Go to **OAuth2 → URL Generator** in the left menu.
2. Under **Scopes**, check `bot`.
3. Under **Bot Permissions**, check:
   - ✅ Read Messages / View Channels
   - ✅ Send Messages
   - ✅ Read Message History
   - ✅ Attach Files
4. Copy the generated URL, open it in your browser, and select your server.

### 5. Finding a Channel ID

Enable Developer Mode in Discord's **Settings → Advanced**, then right-click a channel and select **"Copy Channel ID"**.
