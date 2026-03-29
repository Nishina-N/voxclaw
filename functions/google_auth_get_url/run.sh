#!/bin/bash
curl -sf "http://keybinder:3001/auth/google/url" \
  || echo '{"error": "keybinder unavailable"}'
