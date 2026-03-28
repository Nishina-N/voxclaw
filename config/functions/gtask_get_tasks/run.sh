#!/bin/bash
python3 -c "
import json, os, subprocess, urllib.parse

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
params = {}
params['showCompleted'] = 'true' if args.get('show_completed', False) else 'false'
if 'max_results'  in args: params['maxResults']  = args['max_results']
if 'tasklist_id'  in args: params['tasklistId']  = args['tasklist_id']

query_string = urllib.parse.urlencode(params)
url = f'http://keybinder:3001/google/tasks/list?{query_string}'

subprocess.run(['curl', '-s', url])
"
