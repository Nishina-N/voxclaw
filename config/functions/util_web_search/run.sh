#!/bin/bash
QUERY=$(python3 -c "import sys,json,os; from urllib.parse import quote; print(quote(json.loads(os.environ['SKILL_ARGS'])['query']))")

curl -sf "http://keybinder:3001/brave?q=${QUERY}" \
  || echo '{"error": "keybinder unavailable"}'
