#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))

body = {'title': args['title']}
if 'notes' in args: body['notes'] = args['notes']
if 'due'   in args: body['due']   = args['due']

subprocess.run([
    'curl', '-s', '-X', 'POST',
    'http://localhost:3001/api/tasks',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(body),
])
"
