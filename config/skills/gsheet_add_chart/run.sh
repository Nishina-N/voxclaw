#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
body = {
    'spreadsheetId': args['spreadsheet_id'],
    'chartType':     args['chart_type'],
    'sourceRange':   args['source_range'],
}
if 'title' in args:
    body['title'] = args['title']
if 'position' in args:
    body['position'] = args['position']

subprocess.run([
    'curl', '-s', '-X', 'POST',
    'http://keybinder:3001/google/sheets/charts/add',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(body),
])
"
