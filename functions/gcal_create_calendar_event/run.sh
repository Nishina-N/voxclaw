#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
tz = args.get('timezone', 'Asia/Tokyo')

body = {
    'summary': args['summary'],
    'start': {'dateTime': args['start_datetime'], 'timeZone': tz},
    'end':   {'dateTime': args['end_datetime'],   'timeZone': tz},
}
if 'description' in args: body['description'] = args['description']
if 'location'    in args: body['location']    = args['location']

subprocess.run([
    'curl', '-s', '-X', 'POST',
    'http://keybinder:3001/google/calendar/events/create',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(body),
])
"
