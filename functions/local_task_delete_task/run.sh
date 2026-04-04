#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
task_id = args['id']

subprocess.run([
    'curl', '-s', '-X', 'DELETE',
    f'http://localhost:3001/api/tasks/{task_id}',
])
"
