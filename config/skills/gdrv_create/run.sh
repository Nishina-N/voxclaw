#!/bin/bash
python3 -c "import os, json, urllib.request; args = json.loads(os.environ['SKILL_ARGS']); req = urllib.request.Request('http://keybinder:3001/google/drive/create', data=json.dumps(args).encode(), headers={'Content-Type': 'application/json'}); print(urllib.request.urlopen(req).read().decode())"
