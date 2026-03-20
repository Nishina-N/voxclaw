# gemiclaw 🐾

[🇯🇵 日本語](README.md) | 🇺🇸 English

**An autonomous agent built on Google Gemini API × Discord.** It features a three-layer architecture where the agent creates its own skills, maintains manuals, and runs autonomously via cron — all on Docker, extensible instantly without rebuilds.

> The background and design philosophy are covered in detail in the [Zenn article](https://zenn.dev/nishina__n/articles/69587684b36113).

---

## What It Does

- Mention the bot on Discord and Gemini responds
- Tell it "Create a skill that does X" and the agent adds the tool on its own
- Run scheduled tasks automatically via cron × manuals (e.g., daily stock market news posts)
- Use Google Drive, Calendar, Tasks, Sheets, web search, map image generation, and more

---

## Key Features

| Feature | Description |
|---|---|
| **Self-extension (dynamic skills)** | Agent creates skills in `config/skills/`. No rebuild needed — active from the next message |
| **Three-layer structure** | Skills (minimal units) → Manuals (how-to guides) → Cron (scheduled triggers) |
| **Key Binder** | API keys isolated in a separate container. The agent never touches credentials directly |
| **SQLite + polling** | Messages processed every 2 seconds. No messages lost after a crash |
| **Mutable / immutable separation** | Loop and connection layer baked into container image. Skills and config persisted via volume mounts |

---

## Quickstart

```bash
# 1. Clone
git clone https://github.com/qwibitai/gemiclaw.git
cd gemiclaw

# 2. Set environment variables
cp .env.example .env
# Open .env and fill in DISCORD_TOKEN and GEMINI_API_KEY

# 3. Configure Key Binder API keys
cp keybinder/secrets_for_skills.example.json keybinder/secrets_for_skills.json
# Fill in your API keys in keybinder/secrets_for_skills.json

# 4. Start
docker-compose up -d --build

# 5. Verify
docker-compose logs -f
```

Mention the bot on Discord to start chatting.

```
@gemiclaw Hello!
```

---

## Documentation

| Page | Contents |
|---|---|
| [Setup Guide](docs/setup.en.md) | Prerequisites, API key setup, Google API configuration, Docker startup |
| [Architecture](docs/architecture.en.md) | Design philosophy, component overview, data flow, mutable/immutable separation |
| [Skills Guide](docs/skills.en.md) | Skill list, how to create skills, Key Binder endpoint reference |
