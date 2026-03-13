#!/bin/bash
# This script sends an image file to a specified Discord channel.
# It uses the DISCORD_TOKEN environment variable for authentication.
# Expected SKILL_ARGS: {"file_path": "path/to/image", "channel_id": "1234567890"}

python3 -c "
import json, os, requests
try:
    args = json.loads(os.environ.get('SKILL_ARGS', '{}'))
    file_path = args.get('file_path')
    channel_id = args.get('channel_id')
    token = os.environ.get('DISCORD_TOKEN')

    if not file_path or not channel_id or not token:
        print('Error: Missing configuration')
        exit(1)

    if not os.path.exists(file_path):
        print('Error: File not found')
        exit(1)

    url = f'https://discord.com/api/v10/channels/{channel_id}/messages'
    headers = {'Authorization': f'Bot {token}'}

    with open(file_path, 'rb') as f:
        files = {'file': (os.path.basename(file_path), f, 'image/png')}
        response = requests.post(url, headers=headers, files=files)

    if response.status_code == 200:
        print('Successfully sent')
    else:
        print(f'Failed: {response.status_code} {response.text}')
        exit(1)

except Exception as e:
    print(f'Critical error: {e}')
    exit(1)
"
