#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
task_id = args['id']

body = {}
if 'title'  in args: body['title']  = args['title']
if 'notes'  in args: body['notes']  = args['notes']
if 'due'    in args: body['due']    = args['due']
if 'status' in args: body['status'] = args['status']

subprocess.run([
    'curl', '-s', '-X', 'PATCH',
    f'http://localhost:3001/api/tasks/{task_id}',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(body),
])
"
