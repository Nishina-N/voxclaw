#!/bin/bash
python3 -c "
import json, os, subprocess, urllib.parse

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
spreadsheet_id = urllib.parse.quote(args['spreadsheet_id'], safe='')

subprocess.run(['curl', '-s', f'http://keybinder:3001/google/sheets/info?spreadsheetId={spreadsheet_id}'])
"
