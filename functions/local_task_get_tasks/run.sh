#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
status = args.get('status', '')

url = 'http://localhost:3001/api/tasks'
if status:
    url += '?status=' + status

subprocess.run(['curl', '-s', url])
"
