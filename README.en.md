# gemiclaw 🐾

[🇯🇵 日本語](README.md) | 🇺🇸 English

Inspired by [Openclaw](https://github.com/openclawai/openclaw) and [Nanoclaw](https://github.com/qwibitai/nanoclaw), **gemiclaw** is an autonomous agent built on Google Gemini API × Discord. It runs on Docker and features a three-layer architecture where the agent creates its own skills, maintains manuals, and operates autonomously via cron.

> The background and design philosophy are covered in detail in the [Zenn article](https://zenn.dev/nishina__n/articles/69587684b36113).

---

## Features

- **Self-extension (dynamic skills)**: The agent creates skills under `config/skills/` on its own, gaining new tools immediately — no rebuild required.
- **Self-update (personality & user info)**: The agent can directly rewrite `SOUL.md`, `USER.md`, and `IDENTITY.md`.
- **Three-layer structure — Skills × Manuals × Cron**: Skills are minimal functional units; manuals describe how to combine them; cron triggers manuals on a schedule.
- **SQLite + polling**: Messages are persisted in SQLite and processed every 2 seconds. No messages are lost after a crash.
- **Mutable / immutable separation**: The agent loop and connection layer are baked into the container image. Config, skills, and manuals are persisted via volume mounts.
- **Key Binder for API key isolation**: Third-party API keys are managed in a separate container, so the agent can never access them directly.

---

## Three-Layer Structure

```
Skills (config/skills/)         ← Minimal functional units. Created by the agent.
  └─ Manuals (config/manuals/)  ← How-to guides combining multiple skills.
       └─ Cron (config/cron.json) ← Triggers that fire manuals on a schedule.
```

By passing a manual path in the cron `prompt`, scheduled task quality depends directly on the quality of the manual.

```json
{
  "id": "daily_market_news",
  "cron": "0 23 * * *",
  "prompt": "Follow the manual at /app/config/manuals/market_news_recipe.md and post US stock market news.",
  "channelId": "YOUR_CHANNEL_ID",
  "enabled": true
}
```

---

## Directory Structure

```
gemiclaw/
├── src/                      # ❌ Immutable (baked into container image)
│   ├── index.ts              # Entry point & polling loop
│   ├── db.ts                 # SQLite layer
│   ├── agent.ts              # Gemini API & agent loop
│   ├── cron-runner.ts        # Cron scheduler
│   ├── skill-loader.ts       # Dynamic skill loader & executor
│   ├── channels/
│   │   ├── types.ts          # Channel interface
│   │   └── discord.ts        # Discord implementation
│   └── skills/               # Built-in tools
│       ├── files.ts          # read_file / write_file / list_directory
│       ├── memory.ts         # read_memory / write_memory
│       └── pip.ts            # pip_install
│
├── keybinder/                # 🔑 API key isolation container (inaccessible to agent)
│   ├── Dockerfile
│   ├── package.json
│   ├── server.ts             # API proxy server (:3001)
│   ├── secrets_for_skills.json       # Actual API keys ※gitignored
│   └── secrets_for_skills.example.json
│
├── config/                   # ✅ Mutable (readable/writable by agent and humans)
│   ├── channels.json         # Per-channel settings (requireMention, etc.)
│   ├── cron.json             # Scheduled task definitions
│   ├── skills/               # Dynamic skills created by the agent
│   │   └── <skill-name>/
│   │       ├── definition.json   # Gemini FunctionDeclaration
│   │       └── run.sh            # Execution script (no keys; calls keybinder)
│   ├── manuals/              # How-to guides combining skills
│   │   └── <task>_recipe.md
│   └── pip_packages/         # Packages persisted by pip_install
│
├── memory/                   # ✅ Mutable (SQLite DB & daily notes)
├── workspace/                # ✅ Mutable (agent work output)
├── knowledge/                # 📖 Read-only (reference documents)
│
├── AGENTS.md                 # Behavioral rules           ※Read-only
├── TOOLS.md                  # Tool specifications        ※Read-only
├── SOUL.md                   # Character & tone           ✅ Agent-writable
├── USER.md                   # User information           ✅ Agent-writable
├── IDENTITY.md               # Name & profile             ✅ Agent-writable
├── Dockerfile
└── docker-compose.yml
```

---

## Key Binder: API Key Isolation

The agent can rewrite skill scripts under `config/skills/` on its own. If API keys exist somewhere the agent can read, they could be exfiltrated via a rewritten script through a prompt injection attack.

gemiclaw addresses this risk by introducing **Key Binder** (`keybinder/`).

```
[Without Key Binder]
Skill script → secrets_for_skills.json (agent-readable) → External API

[With Key Binder]
Skill script → http://keybinder:3001/brave?q=... → keybinder (holds keys) → External API
               ↑ Only the result is returned. Keys are never passed to the agent.
```

The keybinder container mounts `secrets_for_skills.json` **to itself only**, so it is neither readable as a file from the gemiclaw container nor present in Python's `os.environ`. Even if a skill script is rewritten, it can only get back the result of a keybinder request.

**Key Binder setup:**

```bash
cp keybinder/secrets_for_skills.example.json keybinder/secrets_for_skills.json
# Fill in your API keys in keybinder/secrets_for_skills.json
```

When the agent wants to create a skill using a new external API, a human must add the corresponding endpoint to `keybinder/server.ts` and rebuild. This is an intentional security constraint — it prevents the agent from autonomously using unknown APIs.

---

## Setup

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (Windows / Mac) or Docker Engine (Linux)
- Gemini API key ([how to get one](#getting-a-gemini-api-key))
- Discord Bot token ([how to get one](#creating-a-discord-bot-and-getting-the-token))

### 1. Clone the repository

```bash
git clone https://github.com/qwibitai/gemiclaw.git
cd gemiclaw
```

### 2. Set environment variables

```bash
cp .env.example .env
```

Open `.env` and fill in the following:

```env
DISCORD_TOKEN=your_discord_bot_token
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3.1-flash-lite-preview  # Optional (default: gemini-3.1-flash-lite-preview)
```

### 3. Configure Key Binder API keys

```bash
cp keybinder/secrets_for_skills.example.json keybinder/secrets_for_skills.json
```

Open `keybinder/secrets_for_skills.json` and fill in the keys for the APIs you use:

```json
{
  "brave": { "api_key": "YOUR_BRAVE_API_KEY" },
  "mapbox": { "access_token": "YOUR_MAPBOX_TOKEN" }
}
```

### 4. Start

```bash
docker-compose up -d --build
```

```bash
docker-compose logs -f  # View logs (Ctrl+C to exit)
```

---

## Usage

### Mention the bot to talk to it

```
@gemiclaw Write today's work memo
@gemiclaw Show me what's in /app/workspace
```

### Set a channel to respond without mentions

Edit `config/channels.json`. You can also ask the agent to configure it.

```json
{
  "CHANNEL_ID": {
    "name": "talk",
    "requireMention": false
  }
}
```

### Add a skill

Just tell the agent "Create a skill that does X" and it will be added automatically under `config/skills/`.

### Set up a scheduled task

Edit `config/cron.json` (or ask the agent to do it).

```json
[
  {
    "id": "any-id",
    "cron": "0 9 * * 1-5",
    "prompt": "Follow the manual at /app/config/manuals/xxxx.md and execute.",
    "channelId": "TARGET_CHANNEL_ID",
    "enabled": true
  }
]
```

---

## Architecture

```
Discord
  │ messageCreate → storeMessage()
  ▼
messages.db (SQLite)
  ▲
  │ getNewMentions() / getNewMessages()
  │ setInterval(2000ms)
  ▼
[Polling loop / index.ts]              [cron-runner.ts]
  │ requireMention check via channels.json  │ Fires on cron.json schedule
  └──────────────┬────────────────────────┘
                 ▼
        [processChannel()]
          getChannelHistory() → Send to Gemini with history
                 ▼
        [agent.ts — Agent loop (max 20 rounds)]
          Scans config/skills/ to load dynamic skills
          │
          ├─ functionCall → executeTool()
          │   ├─ Built-in tools (src/skills/)
          │   └─ Dynamic skills (config/skills/<name>/run.sh)
          │   → Return result to Gemini → Repeat
          └─ Text response → Send to Discord
```

---

## Mutable vs. Immutable

| Area | Write access | Description |
|---|---|---|
| `src/` | ❌ None | Loop, connection & tool engine (baked into image) |
| `AGENTS.md` / `TOOLS.md` | Humans only | System rules (read-only mount) |
| `config/` | ✅ Agent & humans | Skills, manuals, cron, channel config |
| `SOUL.md` / `USER.md` / `IDENTITY.md` | ✅ Agent & humans | Personality & user info |
| `workspace/` | ✅ Agent & humans | Work output |
| `memory/` | ✅ Agent | Daily notes & SQLite DB |
| `knowledge/` | Read-only | Reference documents |

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

You now have everything you need for `.env` and `config/channels.json`.
