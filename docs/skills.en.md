# Skills Guide

[🇯🇵 日本語](skills.md) | [← Back to README](../README.en.md)

## Table of Contents

1. [What Is a Skill?](#1-what-is-a-skill)
2. [Built-in Tools](#2-built-in-tools)
3. [Dynamic Skills (Agent-Created)](#3-dynamic-skills-agent-created)
4. [How to Create a Skill](#4-how-to-create-a-skill)
5. [Key Binder Endpoint Reference](#5-key-binder-endpoint-reference)

---

## 1. What Is a Skill?

A skill is the **minimal functional unit that Gemini can call as a tool**. The agent can create and add skills on its own — no rebuild needed, active from the next message.

Each skill lives in `config/functions/<skill-name>/` as two files:

| File | Purpose |
|---|---|
| `definition.json` | Gemini FunctionDeclaration (name, description, parameters) |
| `run.sh` | Execution script (bash / Python / Node.js supported) |

---

## 2. Built-in Tools

Tools baked into the container image (`src/skills/`):

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

Skills the agent has created in `config/functions/`:

### Search & Information

| Skill | Description |
|---|---|
| `util_web_search` | Search the web using Brave Search API and return results |
| `util_get_today_date` | Get the current date (UTC, YYYY-MM-DD format) |
| `util_memory_search` | Full-text search across `/app/memory/` using SQLite FTS5 |

### Maps & Location

| Skill | Description |
|---|---|
| `map_get_location` | Get latitude/longitude from a place name or address |
| `map_get_mapbox_map` | Fetch a map image via Mapbox API and save it to a local path |

### Python Execution

| Skill | Description |
|---|---|
| `util_run_python` | Execute an existing Python file on the server |
| `util_run_python_code` | Execute a Python code snippet in memory immediately |

### Discord

| Skill | Description |
|---|---|
| `util_send_image_to_discord` | Send an image file from a local path to a Discord channel |

### Google Calendar

| Skill | Description |
|---|---|
| `gcal_get_calendar_events` | Fetch Google Calendar events for a specified period |
| `gcal_create_calendar_event` | Add an event to Google Calendar |
| `gcal_update_calendar_event` | Update an existing Google Calendar event |
| `gcal_delete_calendar_event` | Delete a Google Calendar event |

### Google Sheets

| Skill | Description |
|---|---|
| `gsheet_create_spreadsheet` | Create a new Google Spreadsheet |
| `gsheet_get_spreadsheet_info` | Get spreadsheet title and sheet name list |
| `gsheet_read_spreadsheet` | Read cell values from a range (A1 notation) |
| `gsheet_write_spreadsheet` | Write data to a range (overwrites existing data) |
| `gsheet_append_spreadsheet` | Append rows after the last row with data |
| `gsheet_list_charts` | Get a list of charts in a spreadsheet (chartId, title, chartType) |
| `gsheet_add_chart` | Add a chart (BAR / LINE / COLUMN / PIE / SCATTER / AREA) |
| `gsheet_update_chart` | Update a chart spec (title, legend, axis, colors, etc.) |
| `gsheet_delete_chart` | Delete a chart |

### Google Tasks

| Skill | Description |
|---|---|
| `gtask_get_tasks` | Get a list of Google Tasks |
| `gtask_create_task` | Add a new task to Google Tasks |
| `gtask_update_task` | Update a task (mark complete, rename, change due date) |
| `gtask_delete_task` | Delete a Google Task |

### System Management

| Skill | Description |
|---|---|
| `util_update_functions_list` | Scan `config/functions/` and update `config/skills_list.md` |

---

## 4. How to Create a Skill

### Directory structure

```
/app/config/functions/
  <skill-name>/
    definition.json   ← Gemini FunctionDeclaration
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

Parameter types: `STRING`, `NUMBER`, `BOOLEAN`, `ARRAY`, `OBJECT`

### `run.sh` — receiving arguments

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
- Non-zero exit code is treated as an error.
- Timeout: 30 seconds.
- `PYTHONPATH` is automatically set to `/app/config/pip_packages/`, so packages installed via `pip_install` are importable with no extra setup.

### Using pip packages in a skill

```python
#!/usr/bin/env python3
# PYTHONPATH=/app/config/pip_packages is already set
import json, os, requests

args = json.loads(os.environ['SKILL_ARGS'])
response = requests.get(f"https://api.example.com?q={args['query']}")
print(response.text)
```

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

## 5. Key Binder Endpoint Reference

Skills that need external APIs must call the **Key Binder** (`http://keybinder:3001`) instead of holding API keys directly.

> Never put API keys in skill scripts. Always route through keybinder.

### Web Search

```bash
# GET /brave?q=<query>
curl "http://keybinder:3001/brave?q=today+news"
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

# Update an existing file
# POST /google/drive/update  body: { fileId, content, mimeType? }
curl -X POST http://keybinder:3001/google/drive/update \
  -H 'Content-Type: application/json' \
  -d '{"fileId": "abc123", "content": "Updated content"}'
```

### Google Calendar

```bash
# List events
# GET /google/calendar/events?calendarId=<>&timeMin=<ISO>&timeMax=<ISO>&maxResults=<n>
# calendarId defaults to "primary"
curl "http://keybinder:3001/google/calendar/events?timeMin=2026-03-01T00:00:00Z&maxResults=10"

# Create an event
# POST /google/calendar/events/create  body: { calendarId?, summary, start, end, description?, location? }
# start / end: { "dateTime": "2026-03-20T10:00:00+09:00", "timeZone": "Asia/Tokyo" }
curl -X POST http://keybinder:3001/google/calendar/events/create \
  -H 'Content-Type: application/json' \
  -d '{"summary": "MTG", "start": {"dateTime": "2026-03-20T10:00:00+09:00", "timeZone": "Asia/Tokyo"}, "end": {"dateTime": "2026-03-20T11:00:00+09:00", "timeZone": "Asia/Tokyo"}}'

# Update an event
# POST /google/calendar/events/update  body: { calendarId?, eventId, ...fields }
curl -X POST http://keybinder:3001/google/calendar/events/update \
  -H 'Content-Type: application/json' \
  -d '{"eventId": "evt123", "summary": "Updated MTG"}'

# Delete an event
# POST /google/calendar/events/delete  body: { calendarId?, eventId }
curl -X POST http://keybinder:3001/google/calendar/events/delete \
  -H 'Content-Type: application/json' \
  -d '{"eventId": "evt123"}'
# Returns: { "success": true }
```

### Google Sheets

```bash
# Create a new spreadsheet
# POST /google/sheets/create  body: { title, sheets? }
curl -X POST http://keybinder:3001/google/sheets/create \
  -H 'Content-Type: application/json' \
  -d '{"title": "Sales Report", "sheets": ["Jan", "Feb", "Mar"]}'
# Returns: { spreadsheetId, spreadsheetUrl, ... }

# Get spreadsheet info (title, sheet names)
# GET /google/sheets/info?spreadsheetId=<id>
curl "http://keybinder:3001/google/sheets/info?spreadsheetId=abc123"

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

# Append rows after the last row with data
# POST /google/sheets/append  body: { spreadsheetId, range, values, valueInputOption? }
curl -X POST http://keybinder:3001/google/sheets/append \
  -H 'Content-Type: application/json' \
  -d '{"spreadsheetId": "abc123", "range": "Sheet1", "values": [["Bob", 85]]}'

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
#
# Representative spec fields:
#   title                              Chart title
#   titleTextFormat.fontSize           Title font size
#   basicChart.legendPosition          BOTTOM_LEGEND / TOP_LEGEND / LEFT_LEGEND / RIGHT_LEGEND / NO_LEGEND
#   basicChart.axis[].title            Axis title
#   basicChart.stackedType             NOT_STACKED / STACKED / PERCENT_STACKED
#   basicChart.series[].color          Series color { red, green, blue }
#   basicChart.series[].dataLabel.type Data label: DATA / CUSTOM / NONE
#   pieChart.pieHole                   Donut ratio (0.0–1.0)
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

### Google Tasks

```bash
# List all task lists ("My Tasks" etc.)
# GET /google/tasks/lists
curl "http://keybinder:3001/google/tasks/lists"
# Returns: { items: [ { id, title, ... } ] }

# List tasks in a task list
# GET /google/tasks/list?tasklistId=<id>&showCompleted=<bool>&maxResults=<n>
# tasklistId defaults to "@default" (primary task list)
curl "http://keybinder:3001/google/tasks/list?showCompleted=false&maxResults=20"

# Create a task
# POST /google/tasks/create  body: { tasklistId?, title, notes?, due? }
#   due: RFC 3339 e.g. "2026-03-20T00:00:00.000Z"
curl -X POST http://keybinder:3001/google/tasks/create \
  -H 'Content-Type: application/json' \
  -d '{"title": "Submit report", "due": "2026-03-20T00:00:00.000Z"}'

# Update a task (rename, change due date, mark complete, etc.)
# POST /google/tasks/update  body: { tasklistId?, taskId, title?, notes?, due?, status? }
#   status: "needsAction" (incomplete) or "completed"
curl -X POST http://keybinder:3001/google/tasks/update \
  -H 'Content-Type: application/json' \
  -d '{"taskId": "abc123", "status": "completed"}'

# Delete a task
# POST /google/tasks/delete  body: { tasklistId?, taskId }
curl -X POST http://keybinder:3001/google/tasks/delete \
  -H 'Content-Type: application/json' \
  -d '{"taskId": "abc123"}'
# Returns: { "success": true }
```
