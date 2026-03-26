# Architecture

[🇯🇵 日本語](architecture.md) | [← Back to README](../README.en.md)

## Table of Contents

1. [Design Philosophy](#1-design-philosophy)
2. [Component Overview](#2-component-overview)
3. [Data Flow](#3-data-flow)
4. [Mutable vs. Immutable](#4-mutable-vs-immutable)
5. [Directory Structure](#5-directory-structure)

---

## 1. Design Philosophy

voxclaw is built around three principles.

**Lightweight** — No dependency on external orchestration services. All you need is Docker and a Gemini API key.

**Secure** — Because the agent can write its own skill scripts, direct access to API keys is prohibited. The Key Binder container holds all credentials; the agent only receives results.

**Human-readable code** — Skills are saved as `run.sh` (or `.py`) files that humans can inspect and modify. The agent's core logic is sealed in the container image; config, skills, and manuals live as readable files outside.

---

## 2. Component Overview

### voxclaw container (main agent)

Receives messages from Discord, sends them to the Gemini API, invokes tools, and returns responses. Contains the polling loop, agent loop, and skill loader.

### keybinder container (API key isolation)

A proxy server for external APIs (Brave Search, Mapbox, Google APIs). It mounts `secrets_for_skills.json` to itself only — the voxclaw container cannot read it. Adding support for a new external API requires a human to add an endpoint to `keybinder/server.ts` and rebuild (an intentional security constraint).

### Skills (`config/skills/`)

Tools created by the agent. Each skill is two files: `definition.json` (Gemini FunctionDeclaration) and `run.sh` (execution script). No rebuild needed — active from the next message.

### Manuals (`config/manuals/`)

Markdown how-to guides that combine multiple skills. When a manual path is passed in a cron `prompt`, scheduled task quality depends directly on manual quality.

---

## 3. Data Flow

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
          │       └─ External API call → http://keybinder:3001/...
          │   → Return result to Gemini → Repeat
          └─ Text response → Send to Discord
```

### Three-Layer Structure

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

## 4. Mutable vs. Immutable

| Area | Write access | Description |
|---|---|---|
| `src/` | ❌ None | Loop, connection & tool engine (baked into image) |
| `AGENTS.md` / `TOOLS.md` | Humans only | System rules (read-only mount) |
| `config/` | ✅ Agent & humans | Skills, manuals, cron, channel config |
| `SOUL.md` / `USER.md` / `IDENTITY.md` | ✅ Agent & humans | Personality & user info |
| `workspace/` | ✅ Agent & humans | Work output |
| `memory/` | ✅ Agent | Daily notes & SQLite DB |
| `knowledge/` | Read-only | Reference documents |

This separation keeps the core logic stable as a container image, while user config, skills, and personality data are persisted via volume mounts.

---

## 5. Directory Structure

```
voxclaw/
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
