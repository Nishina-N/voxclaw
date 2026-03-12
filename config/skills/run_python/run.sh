#!/bin/bash
# 実行するPythonファイルを引数として受け取る
# SKILL_ARGS は JSON 文字列として渡される
FILE_PATH=$(python3 -c "import json,os; print(json.loads(os.environ['SKILL_ARGS'])['file_path'])")
if [ -f "$FILE_PATH" ]; then
    python3 "$FILE_PATH"
else
    echo "Error: File $FILE_PATH not found."
fi
