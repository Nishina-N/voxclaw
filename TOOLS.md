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

You can create new tools by adding a skill directory to `/app/config/functions/`. The new tool is available **immediately** on the next message — no restart required.

### Directory structure

```
/app/config/functions/
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

`/app/config/functions/get_weather/definition.json`
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

`/app/config/functions/get_weather/run.sh`
```bash
#!/bin/bash
CITY=$(python3 -c "import json,os; print(json.loads(os.environ['SKILL_ARGS'])['city'])")
curl -s "wttr.in/${CITY}?format=3"
```

---

## Key Binder — External API Proxy

Skills that need external APIs must call the **Key Binder** (`http://keybinder:3001`) instead of holding API keys directly. The keybinder holds all credentials; your skill only receives the result.

> Never put API keys in skill scripts. Always route through keybinder.

### Available endpoints

#### Web Search

```bash
# GET /brave?q=<query>
curl "http://keybinder:3001/brave?q=today+news"
# Returns: Brave Search API JSON
```

#### Maps

```bash
# GET /mapbox/static?lat=<lat>&lon=<lon>&zoom=<zoom>&width=<w>&height=<h>
curl "http://keybinder:3001/mapbox/static?lat=35.68&lon=139.69&zoom=13"
# Returns: { "image_base64": "...", "content_type": "image/png" }
```

#### Google Drive

```bash
# List files
# GET /google/drive/list?folderId=<id>&query=<q>&pageSize=<n>
curl "http://keybinder:3001/google/drive/list?pageSize=10"
# Returns: { "files": [ { id, name, mimeType, size, modifiedTime }, ... ] }

# Read file content (text files)
# GET /google/drive/read?fileId=<id>
curl "http://keybinder:3001/google/drive/read?fileId=abc123"
# Returns: { "content": "file text content here" }

# Create a new file
# POST /google/drive/create  body: { name, content, mimeType?, folderId? }
curl -X POST http://keybinder:3001/google/drive/create \
  -H 'Content-Type: application/json' \
  -d '{"name": "memo.txt", "content": "Hello!"}'
# Returns: Drive file metadata JSON

# Update an existing file
# POST /google/drive/update  body: { fileId, content, mimeType? }
curl -X POST http://keybinder:3001/google/drive/update \
  -H 'Content-Type: application/json' \
  -d '{"fileId": "abc123", "content": "Updated content"}'
# Returns: Drive file metadata JSON
```

#### Google Calendar

```bash
# List events
# GET /google/calendar/events?calendarId=<>&timeMin=<ISO>&timeMax=<ISO>&maxResults=<n>
# calendarId defaults to "primary"
curl "http://keybinder:3001/google/calendar/events?timeMin=2026-03-01T00:00:00Z&maxResults=10"
# Returns: Calendar events list JSON

# Create an event
# POST /google/calendar/events/create  body: { calendarId?, summary, start, end, description?, location? }
# start / end: { "dateTime": "2026-03-20T10:00:00+09:00", "timeZone": "Asia/Tokyo" }
curl -X POST http://keybinder:3001/google/calendar/events/create \
  -H 'Content-Type: application/json' \
  -d '{"summary": "MTG", "start": {"dateTime": "2026-03-20T10:00:00+09:00", "timeZone": "Asia/Tokyo"}, "end": {"dateTime": "2026-03-20T11:00:00+09:00", "timeZone": "Asia/Tokyo"}}'
# Returns: Created event JSON

# Update an event
# POST /google/calendar/events/update  body: { calendarId?, eventId, ...fields }
curl -X POST http://keybinder:3001/google/calendar/events/update \
  -H 'Content-Type: application/json' \
  -d '{"eventId": "evt123", "summary": "Updated MTG"}'
# Returns: Updated event JSON

# Delete an event
# POST /google/calendar/events/delete  body: { calendarId?, eventId }
curl -X POST http://keybinder:3001/google/calendar/events/delete \
  -H 'Content-Type: application/json' \
  -d '{"eventId": "evt123"}'
# Returns: { "success": true }
```

#### Google Sheets

```bash
# Create a new spreadsheet
# POST /google/sheets/create  body: { title, sheets? }
#   sheets: optional array of sheet names
curl -X POST http://keybinder:3001/google/sheets/create \
  -H 'Content-Type: application/json' \
  -d '{"title": "売上管理", "sheets": ["1月", "2月", "3月"]}'
# Returns: { spreadsheetId, spreadsheetUrl, ... }

# Get spreadsheet info (title, sheet names)
# GET /google/sheets/info?spreadsheetId=<id>
curl "http://keybinder:3001/google/sheets/info?spreadsheetId=abc123"
# Returns: { spreadsheetId, properties: { title }, sheets: [ { properties: { sheetId, title, ... } } ] }

# Read cell values (A1 notation)
# GET /google/sheets/read?spreadsheetId=<id>&range=<A1notation>
curl "http://keybinder:3001/google/sheets/read?spreadsheetId=abc123&range=Sheet1!A1:C10"
# Returns: { range, majorDimension, values: [[...], [...]] }

# Write values to a range (overwrites)
# POST /google/sheets/write  body: { spreadsheetId, range, values, valueInputOption? }
#   values: 2D array e.g. [["Name", "Score"], ["Alice", 90]]
#   valueInputOption: "USER_ENTERED" (default, parses formulas/dates) or "RAW"
curl -X POST http://keybinder:3001/google/sheets/write \
  -H 'Content-Type: application/json' \
  -d '{"spreadsheetId": "abc123", "range": "Sheet1!A1", "values": [["Name", "Score"], ["Alice", 90]]}'
# Returns: updated range info JSON

# Append rows after the last row with data
# POST /google/sheets/append  body: { spreadsheetId, range, values, valueInputOption? }
curl -X POST http://keybinder:3001/google/sheets/append \
  -H 'Content-Type: application/json' \
  -d '{"spreadsheetId": "abc123", "range": "Sheet1", "values": [["Bob", 85]]}'
# Returns: appended range info JSON

# Add a chart
# POST /google/sheets/charts/add
#   body: { spreadsheetId, chartType, title?, sourceRange, position? }
#   chartType: "BAR" | "LINE" | "COLUMN" | "PIE" | "SCATTER" | "AREA"
#   sourceRange: A1 notation e.g. "Sheet1!A1:B10" (first col = categories, rest = series)
#   position: EmbeddedObjectPosition (omit to create on a new sheet)
curl -X POST http://keybinder:3001/google/sheets/charts/add \
  -H 'Content-Type: application/json' \
  -d '{"spreadsheetId": "abc123", "chartType": "BAR", "title": "Sales", "sourceRange": "Sheet1!A1:B10"}'
# Returns: { "chartId": 123456789, ... }

# Update a chart spec (title, legend, axis, colors, etc.)
# PUT /google/sheets/charts/update
#   body: { spreadsheetId, chartId, spec, fields? }
#   spec: ChartSpec object — pass only the fields you want to change
#   fields: FieldMask (default "*" = full overwrite)
curl -X PUT http://keybinder:3001/google/sheets/charts/update \
  -H 'Content-Type: application/json' \
  -d '{"spreadsheetId": "abc123", "chartId": 123456789, "spec": {"title": "New Title"}, "fields": "title"}'
# Returns: batchUpdate response JSON

# Delete a chart
# DELETE /google/sheets/charts/delete  body: { spreadsheetId, chartId }
curl -X DELETE http://keybinder:3001/google/sheets/charts/delete \
  -H 'Content-Type: application/json' \
  -d '{"spreadsheetId": "abc123", "chartId": 123456789}'
# Returns: { "success": true }

# List all charts in a spreadsheet
# GET /google/sheets/charts/list?spreadsheetId=<id>
curl "http://keybinder:3001/google/sheets/charts/list?spreadsheetId=abc123"
# Returns: { "charts": [ { "chartId": 123456789, "title": "Sales", "chartType": "BAR", "sheetTitle": "Sheet1" }, ... ] }
```

#### Google Tasks

```bash
# List all task lists ("マイタスク" etc.)
# GET /google/tasks/lists
curl "http://keybinder:3001/google/tasks/lists"
# Returns: { items: [ { id, title, ... } ] }

# List tasks in a task list
# GET /google/tasks/list?tasklistId=<id>&showCompleted=<bool>&maxResults=<n>
# tasklistId defaults to "@default" (primary task list)
curl "http://keybinder:3001/google/tasks/list?showCompleted=false&maxResults=20"
# Returns: { items: [ { id, title, notes, due, status, ... } ] }

# Create a task
# POST /google/tasks/create  body: { tasklistId?, title, notes?, due? }
#   due: RFC 3339 e.g. "2026-03-20T00:00:00.000Z"
curl -X POST http://keybinder:3001/google/tasks/create \
  -H 'Content-Type: application/json' \
  -d '{"title": "レポートを提出する", "due": "2026-03-20T00:00:00.000Z"}'
# Returns: created task JSON

# Update a task (rename, change due date, mark complete, etc.)
# POST /google/tasks/update  body: { tasklistId?, taskId, title?, notes?, due?, status? }
#   status: "needsAction" (未完了) or "completed" (完了)
curl -X POST http://keybinder:3001/google/tasks/update \
  -H 'Content-Type: application/json' \
  -d '{"taskId": "abc123", "status": "completed"}'
# Returns: updated task JSON

# Delete a task
# POST /google/tasks/delete  body: { tasklistId?, taskId }
curl -X POST http://keybinder:3001/google/tasks/delete \
  -H 'Content-Type: application/json' \
  -d '{"taskId": "abc123"}'
# Returns: { "success": true }
```

---

## What You Cannot Change

The following are **non-variable** and cannot be modified by you:

- **Source code** (`/app/src/`) — defines the polling loop, Discord connection, tool engine
- **Polling interval** — fixed at 2 seconds
- **Security boundaries** — write access is restricted to `/app/workspace/`, `/app/config/`, `/app/SOUL.md`, `/app/USER.md`, `/app/IDENTITY.md`
- **System prompt files** (`AGENTS.md`, `TOOLS.md`) — read-only mounts, cannot be overwritten
