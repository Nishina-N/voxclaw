#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
body = {'title': args['title']}
if 'sheets' in args:
    body['sheets'] = args['sheets']

subprocess.run([
    'curl', '-s', '-X', 'POST',
    'http://keybinder:3001/google/sheets/create',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(body),
])
"
