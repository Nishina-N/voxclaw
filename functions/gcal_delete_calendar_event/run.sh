#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
body = {'eventId': args['event_id']}

subprocess.run([
    'curl', '-s', '-X', 'POST',
    'http://keybinder:3001/google/calendar/events/delete',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(body),
])
"
