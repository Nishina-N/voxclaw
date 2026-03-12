#!/bin/bash
# 修正したデバッグ用スクリプト
QUERY=$(python3 -c "import sys,json,os; from urllib.parse import quote; print(quote(json.loads(os.environ['SKILL_ARGS'])['query']))")
API_KEY=$(python3 -c "import json; print(json.load(open('/app/config/skills/web_search/secrets.json'))['BRAVE_API_KEY'])")

# URLエンコード確認
echo "Debug: Encoded Query is ${QUERY}"

# curlの出力とエラーをキャプチャしてファイルに出力しつつ、stdoutにも出す
# stderrをstdoutにマージして出力する
curl -v -H "Accept: application/json" -H "X-Subscription-Token: ${API_KEY}" \
  "https://api.search.brave.com/res/v1/web/search?q=${QUERY}" 2>&1
