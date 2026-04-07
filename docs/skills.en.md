# Skills Guide

[🇯🇵 日本語](skills.md) | [← Back to README](../README.md)

## Table of Contents

1. [What Is a Skill?](#1-what-is-a-skill)
2. [Built-in Tools](#2-built-in-tools)
3. [Dynamic Skills (Agent-Created)](#3-dynamic-skills-agent-created)
4. [How to Create a Skill](#4-how-to-create-a-skill)
5. [Key Binder Endpoint Reference](#5-key-binder-endpoint-reference)

---

## 1. What Is a Skill?

A skill is the **minimal functional unit that Gemini can call as a tool**. The agent can create and add skills on its own — no rebuild needed, active from the next message.

Each skill lives in `functions/<skill-name>/` as two files:

| File | Purpose |
|---|---|
| `definition.json` | Gemini FunctionDeclaration (name, description, parameters) |
| `run.sh` | Execution script (bash / Python / Node.js supported) |

Skill combination manuals are stored as Markdown files in `skills/`. Pass the path to a cron `prompt` to use them as scheduled task instructions.

---

## 2. Built-in Tools

Tools baked into the container image (`src/functions/`):

| Tool | Description |
|---|---|
| `read_file` | Read a file at an absolute path |
| `write_file` | Write or overwrite a file (allowed paths only) |
| `list_directory` | List files and subdirectories at a path |
| `read_memory` | Read a daily memory log from `/app/memory/` |
| `write_memory` | Append a note to today's memory log in `/app/memory/` |
| `pip_install` | Install a Python package persistently to `/app/config/pip_packages/` |

---

## 3. Dynamic Skills (Agent-Created)

Skills the agent has created in `functions/`:

### Search & Information

| Skill | Description |
|---|---|
| `util_web_search` | Search the web via Brave Search API and return results |
| `util_get_today_date` | Get today's date (UTC, YYYY/MM/DD format) |
| `util_memory_search` | Full-text search of `/app/memory/` using SQLite FTS5 |

### Maps & Location

| Skill | Description |
|---|---|
| `map_get_location` | Get latitude/longitude from a place name or address |
| `map_get_mapbox_map` | Fetch a map image via Mapbox API and return the local path |

### Python Execution

| Skill | Description |
|---|---|
| `util_run_python` | Execute an existing Python file on the server |
| `util_run_python_code` | Execute a Python code snippet in memory |

### Local Tasks

| Skill | Description |
|---|---|
| `local_task_get_tasks` | Get the list of Voxclaw built-in tasks |
| `local_task_create_task` | Add a new Voxclaw built-in task |
| `local_task_update_task` | Update a task (mark complete, change title/due date) |
| `local_task_delete_task` | Delete a task |

### Google Calendar

| Skill | Description |
|---|---|
| `gcal_get_calendar_events` | Get Google Calendar events in a date range |
| `gcal_create_calendar_event` | Add a new event to Google Calendar |
| `gcal_update_calendar_event` | Update an existing Google Calendar event |
| `gcal_delete_calendar_event` | Delete a Google Calendar event |

### Google Sheets

| Skill | Description |
|---|---|
| `gsheet_create_spreadsheet` | Create a new Google Spreadsheet |
| `gsheet_get_spreadsheet_info` | Get spreadsheet title and sheet names |
| `gsheet_read_spreadsheet` | Read cell values in a range (A1 notation) |
| `gsheet_write_spreadsheet` | Write data to a range (overwrites existing data) |
| `gsheet_append_spreadsheet` | Append rows after the last row |
| `gsheet_list_charts` | List charts in a spreadsheet |
| `gsheet_add_chart` | Add a chart (BAR / LINE / COLUMN / PIE / SCATTER / AREA) |
| `gsheet_update_chart` | Update chart spec (title, legend, axes, colors, etc.) |
| `gsheet_delete_chart` | Delete a chart |

### Google Drive

| Skill | Description |
|---|---|
| `gdrv_list` | List files in Google Drive |
| `gdrv_read` | Read file contents from Google Drive |
| `gdrv_create` | Create a new file in Google Drive |
| `gdrv_update` | Update an existing Google Drive file |

### System

| Skill | Description |
|---|---|
| `util_update_functions_list` | Scan `functions/` and update the skill list in `skills/` |
| `util_send_image_to_discord` | Send an image file to a Discord channel |

---

## 4. How to Create a Skill

### Directory structure

```
functions/
  <skill-name>/
    definition.json   ← Gemini FunctionDeclaration
    run.sh            ← execution script (run.py / run.js also supported)
```

### `definition.json` format

```json
{
  "name": "skill_name",
  "description": "What this skill does. Be specific — Gemini uses this to decide when to call it.",
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

Parameter types: `STRING`, `NUMBER`, `BOOLEAN`, `ARRAY`, `OBJECT`

### `run.sh` — how to receive arguments

All arguments are passed as a JSON string in the `SKILL_ARGS` environment variable.

```bash
#!/bin/bash
VALUE=$(python3 -c "import json,os; print(json.loads(os.environ['SKILL_ARGS'])['param1'])")
echo "Result: $VALUE"
```

Python script:

```python
#!/usr/bin/env python3
import json, os
args = json.loads(os.environ['SKILL_ARGS'])
print(f"Result: {args['param1']}")
```

- **stdout output** becomes the tool's return value.
- A non-zero exit code is treated as an error.
- Timeout: 30 seconds.
- `PYTHONPATH` is automatically set to `/app/config/pip_packages/`, so packages installed with `pip_install` are available immediately.

### Example: Weather skill

`functions/get_weather/definition.json`
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

`functions/get_weather/run.sh`
```bash
#!/bin/bash
CITY=$(python3 -c "import json,os; print(json.loads(os.environ['SKILL_ARGS'])['city'])")
curl -s "wttr.in/${CITY}?format=3"
```

### Skill manuals (`skills/`)

Write multi-step instructions combining several skills as Markdown in `skills/<task>_recipe.md`. Pass the path to a cron `prompt` to use as a scheduled task manual:

```json
{
  "id": "daily_news",
  "cron": "0 8 * * 1-5",
  "prompt": "Follow the skill manual at /app/skills/market_news_recipe.md to summarize morning news.",
  "enabled": true
}
```

---

## 5. Key Binder Endpoint Reference

Skills that use external APIs call through **Key Binder** (`http://keybinder:3001`) instead of holding API keys directly.

> Never write API keys in skill scripts. Always go through keybinder.

### Web Search

```bash
# GET /brave?q=<query>
curl "http://keybinder:3001/brave?q=today's news"
# Returns: Brave Search API JSON
```

### Maps

```bash
# GET /mapbox/static?lat=<lat>&lon=<lon>&zoom=<zoom>&width=<w>&height=<h>
curl "http://keybinder:3001/mapbox/static?lat=35.68&lon=139.69&zoom=13"
# Returns: { "image_base64": "...", "content_type": "image/png" }
```

### Google Drive

```bash
# List files
curl "http://keybinder:3001/google/drive/list?pageSize=10"

# Read file contents
curl "http://keybinder:3001/google/drive/read?fileId=abc123"

# Create a file
curl -X POST http://keybinder:3001/google/drive/create \
  -H 'Content-Type: application/json' \
  -d '{"name": "memo.txt", "content": "Hello!"}'

# Update a file
curl -X POST http://keybinder:3001/google/drive/update \
  -H 'Content-Type: application/json' \
  -d '{"fileId": "abc123", "content": "Updated content"}'
```

### Google Calendar

```bash
# List events
curl "http://keybinder:3001/google/calendar/events?timeMin=2026-01-01T00:00:00Z&maxResults=10"

# Create an event
curl -X POST http://keybinder:3001/google/calendar/events/create \
  -H 'Content-Type: application/json' \
  -d '{"summary": "Meeting", "start": {"dateTime": "2026-04-10T10:00:00+09:00", "timeZone": "Asia/Tokyo"}, "end": {"dateTime": "2026-04-10T11:00:00+09:00", "timeZone": "Asia/Tokyo"}}'

# Update an event
curl -X POST http://keybinder:3001/google/calendar/events/update \
  -H 'Content-Type: application/json' \
  -d '{"eventId": "evt123", "summary": "Updated Meeting"}'

# Delete an event
curl -X POST http://keybinder:3001/google/calendar/events/delete \
  -H 'Content-Type: application/json' \
  -d '{"eventId": "evt123"}'
```

### Google Sheets

```bash
# Create a spreadsheet
curl -X POST http://keybinder:3001/google/sheets/create \
  -H 'Content-Type: application/json' \
  -d '{"title": "Sales Report", "sheets": ["Jan", "Feb"]}'

# Read cells
curl "http://keybinder:3001/google/sheets/read?spreadsheetId=abc123&range=Sheet1!A1:C10"

# Write cells
curl -X POST http://keybinder:3001/google/sheets/write \
  -H 'Content-Type: application/json' \
  -d '{"spreadsheetId": "abc123", "range": "Sheet1!A1", "values": [["Name", "Score"], ["Alice", 90]]}'

# Append rows
curl -X POST http://keybinder:3001/google/sheets/append \
  -H 'Content-Type: application/json' \
  -d '{"spreadsheetId": "abc123", "range": "Sheet1", "values": [["Bob", 85]]}'
```

### Google Tasks

```bash
# List task lists
curl "http://keybinder:3001/google/tasks/lists"

# List tasks
curl "http://keybinder:3001/google/tasks/list?showCompleted=false"

# Create a task
curl -X POST http://keybinder:3001/google/tasks/create \
  -H 'Content-Type: application/json' \
  -d '{"title": "Submit report", "due": "2026-04-20T00:00:00.000Z"}'

# Update a task (mark complete)
curl -X POST http://keybinder:3001/google/tasks/update \
  -H 'Content-Type: application/json' \
  -d '{"taskId": "abc123", "status": "completed"}'

# Delete a task
curl -X POST http://keybinder:3001/google/tasks/delete \
  -H 'Content-Type: application/json' \
  -d '{"taskId": "abc123"}'
```
