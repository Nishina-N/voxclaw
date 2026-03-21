# スキルガイド

[🇺🇸 English](skills.en.md) | [← README に戻る](../README.md)

## 目次

1. [スキルとは](#1-スキルとは)
2. [組み込みツール一覧](#2-組み込みツール一覧)
3. [動的スキル一覧（エージェントが作成）](#3-動的スキル一覧エージェントが作成)
4. [スキルの作り方](#4-スキルの作り方)
5. [Key Binder エンドポイント一覧](#5-key-binder-エンドポイント一覧)

---

## 1. スキルとは

スキルは **Gemini がツールとして呼び出せる最小機能単位** です。エージェントが自分で作成・追加でき、リビルド不要で次のメッセージから即有効になります。

スキルは `config/skills/<skill-name>/` に2ファイルで構成されます。

| ファイル | 役割 |
|---|---|
| `definition.json` | Gemini FunctionDeclaration（名前・説明・パラメータ定義） |
| `run.sh` | 実際に実行されるスクリプト（bash / Python / Node.js 対応） |

---

## 2. 組み込みツール一覧

コンテナに焼き込まれた組み込みツールです（`src/skills/`）。

| ツール | 説明 |
|---|---|
| `read_file` | 絶対パスでファイルを読む |
| `write_file` | ファイルを書き込む（許可されたパスのみ） |
| `list_directory` | ディレクトリ内のファイル・サブディレクトリ一覧を取得 |
| `read_memory` | `/app/memory/` から日次メモログを読む |
| `write_memory` | `/app/memory/` の今日のメモに追記する |
| `pip_install` | Python パッケージを `/app/config/pip_packages/` に永続インストール |

---

## 3. 動的スキル一覧（エージェントが作成）

エージェントが `config/skills/` に自作したスキルです。

### 検索・情報取得

| スキル | 説明 |
|---|---|
| `util_web_search` | Brave Search API で Web 検索し結果を返す |
| `util_get_today_date` | 現在の日付（UTC基準、YYYY年MM月DD日）を取得 |
| `util_memory_search` | `/app/memory/` を SQLite FTS5 で全文検索する |

### マップ・位置情報

| スキル | 説明 |
|---|---|
| `map_get_location` | 場所名・住所から緯度・経度を取得する |
| `map_get_mapbox_map` | Mapbox API で地図画像を取得し、ローカルパスに保存して返す |

### Python 実行

| スキル | 説明 |
|---|---|
| `util_run_python` | サーバー内の既存 Python ファイルを実行する |
| `util_run_python_code` | メモリ上で Python コード断片を即時実行する |

### Discord

| スキル | 説明 |
|---|---|
| `util_send_image_to_discord` | 指定パスの画像ファイルを Discord チャンネルに送信する |

### Google カレンダー

| スキル | 説明 |
|---|---|
| `gcal_get_calendar_events` | 指定期間の Google カレンダー予定を取得する |
| `gcal_create_calendar_event` | Google カレンダーに予定を追加する |
| `gcal_update_calendar_event` | Google カレンダーの既存予定を更新する |
| `gcal_delete_calendar_event` | Google カレンダーの予定を削除する |

### Google スプレッドシート

| スキル | 説明 |
|---|---|
| `gsheet_create_spreadsheet` | Google スプレッドシートを新規作成する |
| `gsheet_get_spreadsheet_info` | スプレッドシートのタイトルとシート名一覧を取得する |
| `gsheet_read_spreadsheet` | 指定範囲のセル値を取得する（A1記法） |
| `gsheet_write_spreadsheet` | 指定範囲にデータを書き込む（既存データを上書き） |
| `gsheet_append_spreadsheet` | 最終行の後に新しい行を追加する |

### Google タスク

| スキル | 説明 |
|---|---|
| `gtask_get_tasks` | Google タスクの一覧を取得する |
| `gtask_create_task` | Google タスクに新しいタスクを追加する |
| `gtask_update_task` | Google タスクを更新する（完了マーク・タイトル変更・期限変更） |
| `gtask_delete_task` | Google タスクを削除する |

### システム管理

| スキル | 説明 |
|---|---|
| `util_update_skills_list` | `config/skills/` を走査して `config/skills_list.md` を更新する |

---

## 4. スキルの作り方

### ディレクトリ構成

```
/app/config/skills/
  <skill-name>/
    definition.json   ← Gemini FunctionDeclaration
    run.sh            ← 実行スクリプト（run.py / run.js も可）
```

### `definition.json` のフォーマット

```json
{
  "name": "skill_name",
  "description": "このスキルが何をするかの説明。Gemini がいつ使うかを判断するため、具体的に書く。",
  "parameters": {
    "type": "OBJECT",
    "properties": {
      "param1": {
        "type": "STRING",
        "description": "このパラメータの説明"
      }
    },
    "required": ["param1"]
  }
}
```

パラメータ型: `STRING`, `NUMBER`, `BOOLEAN`, `ARRAY`, `OBJECT`

### `run.sh` — 引数の受け取り方

すべての引数は `SKILL_ARGS` 環境変数に JSON 文字列として渡されます。

```bash
#!/bin/bash
VALUE=$(python3 -c "import json,os; print(json.loads(os.environ['SKILL_ARGS'])['param1'])")
echo "結果: $VALUE"
```

Python スクリプトの場合：

```python
#!/usr/bin/env python3
import json, os
args = json.loads(os.environ['SKILL_ARGS'])
print(f"結果: {args['param1']}")
```

- **stdout への出力** がツールの戻り値になります。
- 終了コードが非ゼロの場合はエラー扱いになります。
- タイムアウト: 30秒。
- `PYTHONPATH` は自動的に `/app/config/pip_packages/` に設定されるため、`pip_install` でインストールしたパッケージがそのまま使えます。

### pip パッケージをスキルで使う

```python
#!/usr/bin/env python3
# PYTHONPATH=/app/config/pip_packages は自動設定済み
import json, os, requests

args = json.loads(os.environ['SKILL_ARGS'])
response = requests.get(f"https://api.example.com?q={args['query']}")
print(response.text)
```

### 例：天気スキル

`/app/config/skills/get_weather/definition.json`
```json
{
  "name": "get_weather",
  "description": "都市の現在の天気を取得する。",
  "parameters": {
    "type": "OBJECT",
    "properties": {
      "city": { "type": "STRING", "description": "都市名" }
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

## 5. Key Binder エンドポイント一覧

外部 API を使うスキルは、APIキーを直接持たず **Key Binder**（`http://keybinder:3001`）経由で呼び出します。

> スキルスクリプトに API キーを書かないでください。必ず keybinder 経由でリクエストしてください。

### Web 検索

```bash
# GET /brave?q=<クエリ>
curl "http://keybinder:3001/brave?q=今日のニュース"
# 戻り値: Brave Search API の JSON
```

### マップ

```bash
# GET /mapbox/static?lat=<緯度>&lon=<経度>&zoom=<ズーム>&width=<幅>&height=<高さ>
curl "http://keybinder:3001/mapbox/static?lat=35.68&lon=139.69&zoom=13"
# 戻り値: { "image_base64": "...", "content_type": "image/png" }
```

### Google Drive

```bash
# ファイル一覧
# GET /google/drive/list?folderId=<id>&query=<q>&pageSize=<n>
curl "http://keybinder:3001/google/drive/list?pageSize=10"
# 戻り値: { "files": [ { id, name, mimeType, size, modifiedTime }, ... ] }

# ファイル内容を読む（テキストファイル）
# GET /google/drive/read?fileId=<id>
curl "http://keybinder:3001/google/drive/read?fileId=abc123"
# 戻り値: { "content": "ファイルのテキスト内容" }

# ファイルを新規作成
# POST /google/drive/create  body: { name, content, mimeType?, folderId? }
curl -X POST http://keybinder:3001/google/drive/create \
  -H 'Content-Type: application/json' \
  -d '{"name": "memo.txt", "content": "Hello!"}'

# ファイルを更新
# POST /google/drive/update  body: { fileId, content, mimeType? }
curl -X POST http://keybinder:3001/google/drive/update \
  -H 'Content-Type: application/json' \
  -d '{"fileId": "abc123", "content": "更新された内容"}'
```

### Google カレンダー

```bash
# 予定の一覧取得
# GET /google/calendar/events?calendarId=<>&timeMin=<ISO>&timeMax=<ISO>&maxResults=<n>
curl "http://keybinder:3001/google/calendar/events?timeMin=2026-03-01T00:00:00Z&maxResults=10"

# 予定を作成
# POST /google/calendar/events/create  body: { calendarId?, summary, start, end, description?, location? }
curl -X POST http://keybinder:3001/google/calendar/events/create \
  -H 'Content-Type: application/json' \
  -d '{"summary": "MTG", "start": {"dateTime": "2026-03-20T10:00:00+09:00", "timeZone": "Asia/Tokyo"}, "end": {"dateTime": "2026-03-20T11:00:00+09:00", "timeZone": "Asia/Tokyo"}}'

# 予定を更新
# POST /google/calendar/events/update  body: { calendarId?, eventId, ...fields }
curl -X POST http://keybinder:3001/google/calendar/events/update \
  -H 'Content-Type: application/json' \
  -d '{"eventId": "evt123", "summary": "変更後のMTG"}'

# 予定を削除
# POST /google/calendar/events/delete  body: { calendarId?, eventId }
curl -X POST http://keybinder:3001/google/calendar/events/delete \
  -H 'Content-Type: application/json' \
  -d '{"eventId": "evt123"}'
# 戻り値: { "success": true }
```

### Google スプレッドシート

```bash
# スプレッドシートを新規作成
# POST /google/sheets/create  body: { title, sheets? }
curl -X POST http://keybinder:3001/google/sheets/create \
  -H 'Content-Type: application/json' \
  -d '{"title": "売上管理", "sheets": ["1月", "2月", "3月"]}'
# 戻り値: { spreadsheetId, spreadsheetUrl, ... }

# スプレッドシート情報を取得（タイトル・シート名一覧）
# GET /google/sheets/info?spreadsheetId=<id>
curl "http://keybinder:3001/google/sheets/info?spreadsheetId=abc123"

# セル値を読む（A1記法）
# GET /google/sheets/read?spreadsheetId=<id>&range=<A1記法>
curl "http://keybinder:3001/google/sheets/read?spreadsheetId=abc123&range=Sheet1!A1:C10"
# 戻り値: { range, majorDimension, values: [[...], [...]] }

# セル値を書き込む（上書き）
# POST /google/sheets/write  body: { spreadsheetId, range, values, valueInputOption? }
curl -X POST http://keybinder:3001/google/sheets/write \
  -H 'Content-Type: application/json' \
  -d '{"spreadsheetId": "abc123", "range": "Sheet1!A1", "values": [["名前", "点数"], ["Alice", 90]]}'

# 最終行の後に行を追加
# POST /google/sheets/append  body: { spreadsheetId, range, values, valueInputOption? }
curl -X POST http://keybinder:3001/google/sheets/append \
  -H 'Content-Type: application/json' \
  -d '{"spreadsheetId": "abc123", "range": "Sheet1", "values": [["Bob", 85]]}'

# グラフを追加
# POST /google/sheets/charts/add
#   body: { spreadsheetId, chartType, title?, sourceRange, position? }
#   chartType: "BAR" | "LINE" | "COLUMN" | "PIE" | "SCATTER" | "AREA"
#   sourceRange: A1記法 例 "Sheet1!A1:B10"（1列目がカテゴリ、残りがシリーズ）
#   position: EmbeddedObjectPosition（省略時は新シートに作成）
curl -X POST http://keybinder:3001/google/sheets/charts/add \
  -H 'Content-Type: application/json' \
  -d '{"spreadsheetId": "abc123", "chartType": "BAR", "title": "売上", "sourceRange": "Sheet1!A1:B10"}'
# 戻り値: { "chartId": 123456789, ... }

# グラフを削除
# DELETE /google/sheets/charts/delete  body: { spreadsheetId, chartId }
curl -X DELETE http://keybinder:3001/google/sheets/charts/delete \
  -H 'Content-Type: application/json' \
  -d '{"spreadsheetId": "abc123", "chartId": 123456789}'
# 戻り値: { "success": true }

# スプレッドシート内のグラフ一覧を取得
# GET /google/sheets/charts/list?spreadsheetId=<id>
curl "http://keybinder:3001/google/sheets/charts/list?spreadsheetId=abc123"
# 戻り値: { "charts": [ { "chartId": 123456789, "title": "売上", "chartType": "BAR", "sheetTitle": "Sheet1" }, ... ] }
```

### Google タスク

```bash
# タスクリスト一覧（「マイタスク」等）
# GET /google/tasks/lists
curl "http://keybinder:3001/google/tasks/lists"
# 戻り値: { items: [ { id, title, ... } ] }

# タスクリスト内のタスクを取得
# GET /google/tasks/list?tasklistId=<id>&showCompleted=<bool>&maxResults=<n>
curl "http://keybinder:3001/google/tasks/list?showCompleted=false&maxResults=20"

# タスクを作成
# POST /google/tasks/create  body: { tasklistId?, title, notes?, due? }
curl -X POST http://keybinder:3001/google/tasks/create \
  -H 'Content-Type: application/json' \
  -d '{"title": "レポートを提出する", "due": "2026-03-20T00:00:00.000Z"}'

# タスクを更新（完了マーク・タイトル変更・期限変更）
# POST /google/tasks/update  body: { tasklistId?, taskId, title?, notes?, due?, status? }
#   status: "needsAction"（未完了）または "completed"（完了）
curl -X POST http://keybinder:3001/google/tasks/update \
  -H 'Content-Type: application/json' \
  -d '{"taskId": "abc123", "status": "completed"}'

# タスクを削除
# POST /google/tasks/delete  body: { tasklistId?, taskId }
curl -X POST http://keybinder:3001/google/tasks/delete \
  -H 'Content-Type: application/json' \
  -d '{"taskId": "abc123"}'
# 戻り値: { "success": true }
```
