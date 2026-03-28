#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
body = {
    'spreadsheetId': args['spreadsheet_id'],
    'range':         args['range'],
    'values':        args['values'],
}
if 'value_input_option' in args:
    body['valueInputOption'] = args['value_input_option']

subprocess.run([
    'curl', '-s', '-X', 'POST',
    'http://keybinder:3001/google/sheets/append',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(body),
])
"
