#!/bin/bash
CODE=$(python3 -c "import os,json; print(json.loads(os.environ['SKILL_ARGS'])['code'])")
curl -sf -X POST "http://keybinder:3001/auth/google/exchange" \
  -H 'Content-Type: application/json' \
  -d "{\"code\": \"$CODE\"}" \
  || echo '{"error": "keybinder unavailable"}'
