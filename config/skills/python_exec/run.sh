#!/bin/bash
# Get the code from the SKILL_ARGS environment variable
CODE=$(python3 -c "import sys,json,os; print(json.loads(os.environ['SKILL_ARGS'])['code'])")

# Execute the code
python3 -c "$CODE"
