#!/bin/bash
CODE=$(python3 -c "import json,os; print(json.loads(os.environ['SKILL_ARGS'])['code'])")
python3 -c "$CODE"
