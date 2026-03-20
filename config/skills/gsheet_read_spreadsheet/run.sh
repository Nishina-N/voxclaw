#!/bin/bash
python3 -c "
import json, os, subprocess, urllib.parse

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
params = urllib.parse.urlencode({
    'spreadsheetId': args['spreadsheet_id'],
    'range': args['range'],
})

subprocess.run(['curl', '-s', f'http://keybinder:3001/google/sheets/read?{params}'])
"
