#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
body = {
    'spreadsheetId': args['spreadsheet_id'],
    'chartId':       args['chart_id'],
    'spec':          args['spec'],
}

subprocess.run([
    'curl', '-s', '-X', 'PUT',
    'http://keybinder:3001/google/sheets/charts/update',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(body),
])
"
