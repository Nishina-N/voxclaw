# Voxclaw 🐾

🇺🇸 English | [🇯🇵 日本語](README.ja.md)

**A voice-first AI assistant PWA with real-time intent estimation.**
Speak naturally — Gemini infers your intent and fills the input box. Review, edit if needed, then execute. All in your browser.

> ⚠️ **Patent pending (2026):** *Method and System for Intent Estimation from Voice Input and Personally Adaptive Information Processing*

---

## How It Works

```
[Mic] ──► audio stream ──► Gemini Live API ──► intent text (editable)
                                                       │
                                              [User reviews / edits]
                                                       │
                                                   [Send] ──► skill execution ──► reply
```

1. **Speak** — tap the mic and talk naturally
2. **Review** — Gemini infers your intent and fills the text box in real time
3. **Edit** — refine the inferred text if needed
4. **Execute** — press send; voxclaw runs the appropriate skill and replies

The editable intent step is the core differentiator: you stay in control of what the AI actually does.

---

## Key Features

| Feature | Description |
|---|---|
| **Real-time intent estimation** | Voice is streamed to Gemini Live API; inferred intent appears as editable text before execution |
| **Dynamic skills** | Drop a JS file into `skills/` — active immediately, no rebuild needed |
| **Cron scheduling** | Schedule skills to run automatically via the in-app Cron tab |
| **Key Binder** | API keys isolated in a separate container; the skill engine never holds credentials directly |
| **PWA** | Installable on mobile/desktop; UI shell works offline |
| **JWT auth** | Password-protected single-user access with 7-day sessions |

---

## Tabs

| Tab | Description |
|---|---|
| **Chat** | Main interface — voice or text input, skill results displayed here |
| **Skills** | Browse all available skills and their descriptions |
| **Cron** | Configure scheduled skill execution (time, days, destination) |
| **Task** | *(Work in progress)* |
| **Settings** | Manage API keys (Brave Search, Mapbox) and Google auth |

---

## Quickstart

```bash
# 1. Clone
git clone https://github.com/Nishina-N/voxclaw
cd voxclaw

# 2. Set environment variables
cp .env.example .env
# Fill in: GEMINI_API_KEY, PWA_PASSWORD, JWT_SECRET

# 3. Configure API keys for skills (optional)
cp keybinder/secrets_for_skills.example.json keybinder/secrets_for_skills.json
# Add keys for Brave Search, Mapbox, Google, etc. as needed

# 4. Start
docker-compose up -d --build

# 5. Open
# Visit http://localhost:8080 and log in with your PWA_PASSWORD
```

---

## Architecture

```
Browser (PWA)
└─ voice-pwa/frontend/        Single-page app
     index.html               UI: chat / skills / cron / task / settings tabs
     app.js                   WebSocket client, audio capture, rendering

voice-pwa/backend/            Node.js + TypeScript WebSocket server
  ├─ Gemini Live API          Real-time audio → intent text
  └─ voxclaw-client           Forwards confirmed intent to the skill engine

voxclaw core (src/)           Skill execution engine
└─ skills/                    Skill definitions (JS, hot-reloadable)

keybinder/                    Isolated API key service (port 3001)
config/cron.json              Persisted cron schedule
media/                        Images and files returned by skills
```

---

## Adding Skills

Skills are plain JavaScript files in `skills/`. Each file exports a function the engine can call. Drop a new file in and it's available immediately — no server restart needed.

See [docs/skills.md](docs/skills.md) for the skill interface and examples.

---

## License

Source code is released under [MIT](LICENSE) for personal and research use.

> Commercial use of the voice → intent estimation → user editing → execution pipeline is subject to the pending patent. Please get in touch before building commercial products on this architecture.
