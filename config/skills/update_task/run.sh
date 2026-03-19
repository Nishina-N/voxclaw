#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))

body = {'taskId': args['task_id']}
if 'title'       in args: body['title']      = args['title']
if 'notes'       in args: body['notes']      = args['notes']
if 'due'         in args: body['due']        = args['due']
if 'status'      in args: body['status']     = args['status']
if 'tasklist_id' in args: body['tasklistId'] = args['tasklist_id']

subprocess.run([
    'curl', '-s', '-X', 'POST',
    'http://keybinder:3001/google/tasks/update',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(body),
])
"
