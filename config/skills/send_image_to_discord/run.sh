#!/usr/bin/env python3
import json
import os
import requests

# 環境変数から直接DISCORD_TOKENを参照する
token = os.environ.get('DISCORD_TOKEN')
if not token:
    print("Error: DISCORD_TOKEN is not set as an environment variable")
    exit(1)

args = json.loads(os.environ['SKILL_ARGS'])
file_path = args['file_path']
channel_id = args['channel_id']

if not os.path.exists(file_path):
    print(f"Error: File not found at {file_path}")
    exit(1)

url = f"https://discord.com/api/v10/channels/{channel_id}/messages"
headers = {"Authorization": f"Bot {token}"}

# ファイルを送信する
with open(file_path, 'rb') as f:
    # 'file' というフィールド名でマルチパートフォーム送信を行う
    files = {'file': (os.path.basename(file_path), f, 'image/png')}
    response = requests.post(url, headers=headers, files=files)

if response.status_code == 200:
    print(f"Successfully sent image to channel {channel_id}")
else:
    print(f"Failed to send image. Status: {response.status_code}, Response: {response.text}")
