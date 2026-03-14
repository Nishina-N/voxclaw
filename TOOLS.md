# TOOLS

You have access to the following tools as Gemini function calls.

## Available Tools

| Tool | Description |
|---|---|
| `read_file` | Read a file at an absolute path |
| `write_file` | Write or overwrite a file (allowed paths only — see below) |
| `list_directory` | List files and subdirectories at a path |
| `read_memory` | Read a daily memory log from `/app/memory/` |
| `write_memory` | Append a note to today's memory log in `/app/memory/` |
| `pip_install` | Install a Python package persistently to `/app/config/pip_packages/` |

---

## Filesystem Layout

```
/app/
├── src/           # ❌ NON-VARIABLE — source code baked into the container image
│                  #    Never read or write here. Changes have no effect until rebuild.
│
├── config/        # ✅ VARIABLE — bot behavior settings
│   └── channels.json   # Per-channel config (requireMention, name, etc.)
│
├── workspace/     # ✅ VARIABLE — your working area for task output
│                  #    Create, edit, and delete files freely here.
│
├── memory/        # ✅ VARIABLE — persistent memory logs (managed via read/write_memory)
│
└── knowledge/     # 📖 READ-ONLY — reference documents provided by the user
                   #    Use read_file and list_directory to explore, but do not write.
```

---

## Your Current Channel

Each message you receive begins with a line like:

```
[Channel ID: 1480954792946962432]
```

This is the Discord channel ID where the current conversation is taking place. You can use this ID directly when editing `channels.json` to change the behavior of the channel you are currently in.

---

## Changing Bot Behavior

To change how the bot behaves on a specific Discord channel, edit `/app/config/channels.json`:

```json
{
  "CHANNEL_ID": {
    "name": "channel-name",
    "requireMention": false
  }
}
```

- `requireMention: true` (default) — only respond when @mentioned
- `requireMention: false` — respond to all messages in the channel

Use `write_file` with path `/app/config/channels.json` to apply changes. No restart needed.

---

## Scheduled Tasks (Cron)

You can register recurring tasks by editing `/app/config/cron.json`. Changes take effect immediately — no restart needed.

```json
[
  {
    "id": "daily_summary",
    "cron": "0 9 * * *",
    "prompt": "今日の日次サマリーを作成してください",
    "channelId": "CHANNEL_ID_HERE",
    "enabled": true
  }
]
```

| Field | Description |
|---|---|
| `id` | Unique name for the task (used in logs) |
| `cron` | 5-field cron expression in server local time |
| `prompt` | The message sent to you when the task fires |
| `channelId` | Channel to post the response (use `[Channel ID:]` from current context) |
| `enabled` | `true` to activate, `false` to pause (default: `true`) |

**Cron expression examples:**

| Expression | Meaning |
|---|---|
| `0 9 * * *` | Every day at 9:00 AM |
| `0 9 * * 1-5` | Weekdays at 9:00 AM |
| `*/30 * * * *` | Every 30 minutes |
| `0 0 1 * *` | First day of every month at midnight |

Use `write_file` with path `/app/config/cron.json` to add, edit, or remove tasks.

---

---

## Creating New Skills（自己拡張）

You can create new tools by adding a skill directory to `/app/config/skills/`. The new tool is available **immediately** on the next message — no restart required.

### Directory structure

```
/app/config/skills/
  <skill-name>/
    definition.json   ← Gemini FunctionDeclaration (name, description, parameters)
    run.sh            ← Execution script (run.py or run.js are also supported)
```

### `definition.json` format

```json
{
  "name": "skill_name",
  "description": "What this skill does. Be specific so Gemini knows when to use it.",
  "parameters": {
    "type": "OBJECT",
    "properties": {
      "param1": {
        "type": "STRING",
        "description": "Description of this parameter"
      }
    },
    "required": ["param1"]
  }
}
```

Parameter types: `STRING`, `NUMBER`, `BOOLEAN`, `ARRAY`, `OBJECT`.

### `run.sh` — receiving arguments

All arguments are passed as a JSON string in the `SKILL_ARGS` environment variable.

```bash
#!/bin/bash
# Parse a specific argument with python3
VALUE=$(python3 -c "import sys,json,os; print(json.loads(os.environ['SKILL_ARGS'])['param1'])")
echo "Result: $VALUE"
```

```python
#!/usr/bin/env python3
import json, os
args = json.loads(os.environ['SKILL_ARGS'])
print(f"Result: {args['param1']}")
```

- Write output to **stdout** — that becomes the tool's return value.
- Exit code non-zero is treated as an error.
- Timeout: 30 seconds.
- `PYTHONPATH` is automatically set to `/app/config/pip_packages/`, so packages installed via `pip_install` are importable with no extra setup.

### Using pip packages in a skill

If your skill requires a third-party Python library, first call `pip_install` to install it, then reference it in your script:

```python
#!/usr/bin/env python3
# PYTHONPATH=/app/config/pip_packages is already set — just import
import json, os, requests

args = json.loads(os.environ['SKILL_ARGS'])
response = requests.get(f"https://api.example.com?q={args['query']}")
print(response.text)
```

Installed packages persist across restarts in `/app/config/pip_packages/` (volume-mounted).

### Example: weather skill

`/app/config/skills/get_weather/definition.json`
```json
{
  "name": "get_weather",
  "description": "Get the current weather for a city.",
  "parameters": {
    "type": "OBJECT",
    "properties": {
      "city": { "type": "STRING", "description": "City name" }
    },
    "required": ["city"]
  }
}
```

`/app/config/skills/get_weather/run.sh`
```bash
#!/bin/bash
CITY=$(python3 -c "import json,os; print(json.loads(os.environ['SKILL_ARGS'])['city'])")
curl -s "wttr.in/${CITY}?format=3"
```

---

## What You Cannot Change

The following are **non-variable** and cannot be modified by you:

- **Source code** (`/app/src/`) — defines the polling loop, Discord connection, tool engine
- **Polling interval** — fixed at 2 seconds
- **Security boundaries** — write access is restricted to `/app/workspace/`, `/app/config/`, `/app/SOUL.md`, `/app/USER.md`, `/app/IDENTITY.md`
- **System prompt files** (`AGENTS.md`, `TOOLS.md`) — read-only mounts, cannot be overwritten
