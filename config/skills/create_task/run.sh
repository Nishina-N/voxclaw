#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))

body = {'title': args['title']}
if 'notes'       in args: body['notes'] = args['notes']
if 'due'         in args: body['due']   = args['due']
if 'tasklist_id' in args: body['tasklistId'] = args['tasklist_id']

subprocess.run([
    'curl', '-s', '-X', 'POST',
    'http://keybinder:3001/google/tasks/create',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(body),
])
"
