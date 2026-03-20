#!/bin/bash
python3 -c "
import json, os, subprocess

args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
tz = args.get('timezone', 'Asia/Tokyo')

body = {'eventId': args['event_id']}
if 'summary'     in args: body['summary']     = args['summary']
if 'description' in args: body['description'] = args['description']
if 'location'    in args: body['location']    = args['location']
if 'start_datetime' in args:
    body['start'] = {'dateTime': args['start_datetime'], 'timeZone': tz}
if 'end_datetime' in args:
    body['end'] = {'dateTime': args['end_datetime'], 'timeZone': tz}

subprocess.run([
    'curl', '-s', '-X', 'POST',
    'http://keybinder:3001/google/calendar/events/update',
    '-H', 'Content-Type: application/json',
    '-d', json.dumps(body),
])
"
