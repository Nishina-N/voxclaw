#!/bin/bash
# 集中管理されたシークレットファイルからBrave APIキーを読み込む
QUERY=$(python3 -c "import sys,json,os; from urllib.parse import quote; print(quote(json.loads(os.environ['SKILL_ARGS'])['query']))")
API_KEY=$(python3 -c "import json; print(json.load(open('/app/config/secrets_for_skills.json'))['brave']['api_key'])")

# curlリクエスト実行（-f でエラー時に終了、-s で進捗非表示）
curl -s -H "Accept: application/json" -H "X-Subscription-Token: ${API_KEY}" \
  "https://api.search.brave.com/res/v1/web/search?q=${QUERY}"
