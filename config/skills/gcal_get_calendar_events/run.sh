#!/bin/bash
# Pythonで環境変数から引数を取得し、curlでkeybinderを叩く
python3 -c "
import json, os, urllib.parse

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
params = {}
if 'timeMin' in args: params['timeMin'] = args['timeMin']
if 'timeMax' in args: params['timeMax'] = args['timeMax']
if 'maxResults' in args: params['maxResults'] = args['maxResults']

query_string = urllib.parse.urlencode(params)
url = f'http://keybinder:3001/google/calendar/events?{query_string}'

import subprocess
subprocess.run(['curl', '-s', url])
"
