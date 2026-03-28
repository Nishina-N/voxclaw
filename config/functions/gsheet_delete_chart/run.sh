#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
body = {
    'spreadsheetId': args['spreadsheet_id'],
    'chartId':       args['chart_id'],
}

subprocess.run([
    'curl', '-s', '-X', 'DELETE',
    'http://keybinder:3001/google/sheets/charts/delete',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(body),
])
"
