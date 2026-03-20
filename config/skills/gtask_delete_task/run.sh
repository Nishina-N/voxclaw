#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))

body = {'taskId': args['task_id']}
if 'tasklist_id' in args: body['tasklistId'] = args['tasklist_id']

subprocess.run([
    'curl', '-s', '-X', 'POST',
    'http://keybinder:3001/google/tasks/delete',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(body),
])
"
