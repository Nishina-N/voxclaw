#!/bin/bash
python3 -c "
import os, json, urllib.request, urllib.parse
args = json.loads(os.environ['SKILL_ARGS'])
params = urllib.parse.urlencode(args)
url = 'http://keybinder:3001/google/drive/list?' + params
with urllib.request.urlopen(url) as response:
    print(response.read().decode())
"
