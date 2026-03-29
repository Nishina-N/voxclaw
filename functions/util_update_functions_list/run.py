#!/usr/bin/env python3
import os
import json

SKILLS_DIR = "/app/functions"
OUTPUT_FILE = "/app/config/functions_list.md"

def update_skills_list():
    # スキルディレクトリ一覧を取得
    skills = [d for d in os.listdir(SKILLS_DIR) if os.path.isdir(os.path.join(SKILLS_DIR, d))]
    skills.sort()
    
    # ファイルに書き込み
    with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
        f.write("# スキル一覧\n\n")
        for skill in skills:
            # 各スキルの definition.json から説明を取得しようと試みる
            description = "説明なし"
            def_file = os.path.join(SKILLS_DIR, skill, "definition.json")
            if os.path.exists(def_file):
                try:
                    with open(def_file, "r", encoding="utf-8") as df:
                        data = json.load(df)
                        description = data.get("description", description)
                except:
                    pass
            f.write(f"* **{skill}**: {description}\n")

    print(f"Successfully updated {OUTPUT_FILE}")

if __name__ == "__main__":
    update_skills_list()
