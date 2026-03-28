#!/bin/bash
python3 -c "import os, json, urllib.request; args = json.loads(os.environ['SKILL_ARGS']); url = f'http://keybinder:3001/google/drive/read?fileId={args[\"fileId\"]}'; print(urllib.request.urlopen(url).read().decode())"
