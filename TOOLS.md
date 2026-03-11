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

## What You Cannot Change

The following are **non-variable** and cannot be modified by you:

- **Source code** (`/app/src/`) — defines the polling loop, Discord connection, tool engine
- **Polling interval** — fixed at 2 seconds
- **Security boundaries** — write access is restricted to `/app/workspace/` and `/app/config/`
- **Prompt files** (`AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`) — read-only mounts
