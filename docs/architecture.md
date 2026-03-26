# アーキテクチャ

[🇺🇸 English](architecture.en.md) | [← README に戻る](../README.md)

## 目次

1. [設計思想](#1-設計思想)
2. [コンポーネント概要](#2-コンポーネント概要)
3. [データフロー](#3-データフロー)
4. [可変部 vs 非可変部](#4-可変部-vs-非可変部)
5. [ディレクトリ構成](#5-ディレクトリ構成)

---

## 1. 設計思想

voxclaw は3つの原則で設計されています。

**軽量** — 外部サービスに依存せず、Docker と Gemini API があれば動く。追加のオーケストレーションレイヤーは不要。

**セキュア** — エージェントがスキルスクリプトを自作できる設計上、APIキーへの直接アクセスは禁止。Key Binder コンテナがキーを隔離し、エージェントは結果だけを受け取る。

**人が読めるコード** — スキルは `run.sh`（または `.py`）として保存され、人間が確認・修正できる。エージェントのロジックはコンテナに封じ込め、設定・スキル・マニュアルは人間も読み書きできるファイルとして外部に置く。

---

## 2. コンポーネント概要

### voxclaw コンテナ（メインエージェント）

Discord からメッセージを受け取り、Gemini API に投げてツールを呼び出し、応答を返す。ポーリング・エージェントループ・スキルローダーがここに含まれる。

### keybinder コンテナ（APIキー隔離）

外部 API（Brave Search・Mapbox・Google APIs）へのプロキシサーバー。`secrets_for_skills.json` を自コンテナのみにマウントし、voxclaw コンテナからはキーが見えない。新しい外部 API を使うには、人間が `keybinder/server.ts` にエンドポイントを追加してリビルドする必要がある（意図的な制約）。

### スキル（`config/skills/`）

エージェントが自作するツール。`definition.json`（Gemini FunctionDeclaration）と `run.sh`（実行スクリプト）の2ファイルで構成。リビルド不要で次のメッセージから即有効になる。

### マニュアル（`config/manuals/`）

複数スキルの組み合わせ手順書（Markdown）。cron の `prompt` にパスを渡すことで定時タスクの手順書として機能する。

---

## 3. データフロー

```
Discord
  │ messageCreate → storeMessage()
  ▼
messages.db（SQLite）
  ▲
  │ getNewMentions() / getNewMessages()
  │ setInterval(2000ms)
  ▼
[ポーリングループ / index.ts]          [cron-runner.ts]
  │ channels.json で requireMention 判定  │ cron.json のスケジュールで発火
  └──────────────┬───────────────────────┘
                 ▼
        [processChannel()]
          getChannelHistory() → Gemini へ履歴付きで投げる
                 ▼
        [agent.ts — エージェントループ（最大20ラウンド）]
          config/skills/ をスキャンして動的スキルをロード
          │
          ├─ functionCall → executeTool()
          │   ├─ 組み込みツール（src/skills/）
          │   └─ 動的スキル（config/skills/<name>/run.sh）
          │       └─ 外部API呼び出し → http://keybinder:3001/...
          │   → 結果を Gemini へ返す → 繰り返す
          └─ テキスト応答 → Discord へ送信
```

### 三層構造の関係

```
スキル（config/skills/）        ← 最小機能単位。エージェントが自作。
  └─ マニュアル（config/manuals/） ← スキルの組み合わせ手順書。
       └─ cron（config/cron.json）  ← マニュアルを定時に起動するトリガー。
```

cron の `prompt` にマニュアルのパスを渡すことで、定時タスクの精度がマニュアルの品質に直結します。

```json
{
  "id": "daily_market_news",
  "cron": "0 23 * * *",
  "prompt": "マニュアル（/app/config/manuals/market_news_recipe.md）に従って米国株式市場ニュースを投稿してください。",
  "channelId": "チャンネルID",
  "enabled": true
}
```

---

## 4. 可変部 vs 非可変部

| 領域 | 書き込み権限 | 説明 |
|---|---|---|
| `src/` | ❌ なし | ループ・接続・ツールエンジン（コンテナに焼き込み） |
| `AGENTS.md` / `TOOLS.md` | 人間のみ | システムルール（読み取り専用マウント） |
| `config/` | ✅ エージェント・人間 | スキル・マニュアル・cron・チャンネル設定 |
| `SOUL.md` / `USER.md` / `IDENTITY.md` | ✅ エージェント・人間 | 人格・ユーザー情報 |
| `workspace/` | ✅ エージェント・人間 | 作業出力 |
| `memory/` | ✅ エージェント | 日次メモ・SQLite DB |
| `knowledge/` | 読み取り専用 | 参照ドキュメント |

この分離により、コアロジックはコンテナイメージとして安定し、ユーザーの設定・スキル・人格データはボリュームマウントで永続化されます。

---

## 5. ディレクトリ構成

```
voxclaw/
├── src/                      # ❌ 非可変（コンテナに焼き込み）
│   ├── index.ts              # エントリーポイント・ポーリングループ
│   ├── db.ts                 # SQLite層
│   ├── agent.ts              # Gemini API・エージェントループ
│   ├── cron-runner.ts        # cronスケジューラ
│   ├── skill-loader.ts       # 動的スキルのロード・実行
│   ├── channels/
│   │   ├── types.ts          # Channel インターフェース
│   │   └── discord.ts        # Discord実装
│   └── skills/               # 組み込みツール
│       ├── files.ts          # read_file / write_file / list_directory
│       ├── memory.ts         # read_memory / write_memory
│       └── pip.ts            # pip_install
│
├── keybinder/                # 🔑 APIキー隔離コンテナ（エージェントからアクセス不可）
│   ├── Dockerfile
│   ├── server.ts             # APIプロキシサーバー（:3001）
│   ├── secrets_for_skills.json       # 実際のAPIキー ※gitignore
│   └── secrets_for_skills.example.json
│
├── config/                   # ✅ 可変（エージェント・人間が読み書き可）
│   ├── channels.json         # チャンネル別設定（requireMention 等）
│   ├── cron.json             # 定期タスク定義
│   ├── skills/               # エージェントが自作した動的スキル
│   │   └── <skill-name>/
│   │       ├── definition.json   # Gemini FunctionDeclaration
│   │       └── run.sh            # 実行スクリプト（キーなし・keybinder呼び出し）
│   ├── manuals/              # スキルの組み合わせ手順書
│   │   └── <task>_recipe.md
│   └── pip_packages/         # pip_install で永続化されたパッケージ
│
├── memory/                   # ✅ 可変（SQLite DB・日次メモ）
├── workspace/                # ✅ 可変（エージェントの作業出力）
├── knowledge/                # 📖 読み取り専用（参照ドキュメント）
│
├── AGENTS.md                 # 行動ルール             ※読み取り専用
├── TOOLS.md                  # ツール仕様             ※読み取り専用
├── SOUL.md                   # キャラクター・口調     ✅ エージェントが書き換え可
├── USER.md                   # ユーザー情報           ✅ エージェントが書き換え可
├── IDENTITY.md               # 名前・プロフィール     ✅ エージェントが書き換え可
├── Dockerfile
└── docker-compose.yml
```
