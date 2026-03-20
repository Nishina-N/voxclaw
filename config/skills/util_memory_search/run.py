#!/usr/bin/env python3
"""
memory_search: SQLite FTS5 (BM25) による記憶ファイル全文検索
- 追加依存ゼロ（Python標準ライブラリのsqlite3を使用）
- /app/config/memory_index.db にインデックスを永続化
- 変更されたファイルのみ差分インデックス更新
"""
import sqlite3
import os
import json

MEMORY_DIR = '/app/memory'
INDEX_DB   = '/app/config/memory_index.db'


def get_db():
    conn = sqlite3.connect(INDEX_DB)
    conn.execute('''
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts
        USING fts5(filepath UNINDEXED, content, tokenize="unicode61 remove_diacritics 1")
    ''')
    conn.execute('''
        CREATE TABLE IF NOT EXISTS memory_meta (
            filepath TEXT PRIMARY KEY,
            mtime    REAL
        )
    ''')
    conn.commit()
    return conn


def update_index(conn):
    if not os.path.isdir(MEMORY_DIR):
        return

    md_files = {
        os.path.join(MEMORY_DIR, f)
        for f in os.listdir(MEMORY_DIR)
        if f.endswith('.md')
    }

    # 新規・更新ファイルを再インデックス
    for fpath in md_files:
        mtime = os.path.getmtime(fpath)
        row = conn.execute(
            'SELECT mtime FROM memory_meta WHERE filepath = ?', (fpath,)
        ).fetchone()
        if row is None or row[0] < mtime:
            try:
                with open(fpath, 'r', encoding='utf-8') as f:
                    content = f.read()
            except Exception:
                continue
            conn.execute('DELETE FROM memory_fts WHERE filepath = ?', (fpath,))
            conn.execute(
                'INSERT INTO memory_fts (filepath, content) VALUES (?, ?)',
                (fpath, content)
            )
            conn.execute(
                'INSERT OR REPLACE INTO memory_meta (filepath, mtime) VALUES (?, ?)',
                (fpath, mtime)
            )

    # 削除済みファイルをインデックスから除去
    indexed = [r[0] for r in conn.execute('SELECT filepath FROM memory_meta').fetchall()]
    for fpath in indexed:
        if fpath not in md_files:
            conn.execute('DELETE FROM memory_fts  WHERE filepath = ?', (fpath,))
            conn.execute('DELETE FROM memory_meta WHERE filepath = ?', (fpath,))

    conn.commit()


def search(conn, query, n=5):
    # 特殊文字をエスケープして安全なFTS5クエリを構築
    safe_query = query.replace('"', '""')
    safe_query = f'"{safe_query}"'  # フレーズ検索として扱う

    try:
        rows = conn.execute('''
            SELECT
                filepath,
                snippet(memory_fts, 1, ">>", "<<", "...", 25),
                bm25(memory_fts)
            FROM memory_fts
            WHERE content MATCH ?
            ORDER BY bm25(memory_fts)
            LIMIT ?
        ''', (safe_query, n)).fetchall()
    except sqlite3.OperationalError:
        # フレーズ検索が失敗した場合、単純なPREFIX検索にフォールバック
        words = query.split()
        safe_query = ' '.join(f'"{w}"' for w in words if w)
        rows = conn.execute('''
            SELECT
                filepath,
                snippet(memory_fts, 1, ">>", "<<", "...", 25),
                bm25(memory_fts)
            FROM memory_fts
            WHERE content MATCH ?
            ORDER BY bm25(memory_fts)
            LIMIT ?
        ''', (safe_query, n)).fetchall()

    return rows


def main():
    args  = json.loads(os.environ['SKILL_ARGS'])
    query = args.get('query', '').strip()
    n     = int(args.get('n', 5))

    if not query:
        print(json.dumps({"error": "query is required"}, ensure_ascii=False))
        return

    conn = get_db()
    update_index(conn)
    rows = search(conn, query, n)
    conn.close()

    if not rows:
        print(json.dumps({"results": [], "message": "該当する記憶が見つかりませんでした。"}, ensure_ascii=False))
        return

    results = []
    for filepath, snippet, score in rows:
        results.append({
            "file":    os.path.basename(filepath),
            "snippet": snippet,
            "score":   round(-score, 4)  # bm25()は負値を返すので反転
        })

    print(json.dumps({"results": results}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
