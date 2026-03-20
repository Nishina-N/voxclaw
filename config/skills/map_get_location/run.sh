#!/bin/bash
python3 -c "
import json, os, urllib.request, urllib.parse, sys
try:
    args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
    query = args.get('query')
    url = 'https://nominatim.openstreetmap.org/search?q=' + urllib.parse.quote(query) + '&format=json&limit=1'
    req = urllib.request.Request(url, headers={'User-Agent': 'gemiclaw-agent/1.0'})
    with urllib.request.urlopen(req, timeout=10) as res:
        data = json.loads(res.read().decode())
        if data:
            item = data[0]
            print('Location: ' + item.get('display_name') + '\nLat: ' + item.get('lat') + '\nLon: ' + item.get('lon'))
        else:
            print('No results found.')
except Exception as e:
    print('Error: ' + str(e))
    sys.exit(1)
"
