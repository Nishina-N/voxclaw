# gemiclaw 🐾

🇯🇵 日本語 | [🇺🇸 English](README.en.md)

**Google Gemini API × Discord の自律エージェント。** エージェントが自分でスキルを作り・マニュアルを育て・cron で自律動作する三層構造が特徴です。Docker 上で動作し、リビルド不要で即座に拡張できます。軽量、セキュアかつ自己拡張可能であることを主眼に置いて開発しています。

> 制作背景と設計思想は [Zenn 記事](https://zenn.dev/nishina__n/articles/69587684b36113) で詳しく書いています。

---

## 何ができるか

- Discord でメンションして話しかけると Gemini が応答する
- 「〇〇するスキルを作って」と言うだけでエージェントが自分でツールを追加する
- cron × マニュアルで定時タスクを自動実行する（例: 毎日の株式市場ニュース投稿）
- Google Drive・Calendar・Tasks・Sheets・Web検索・地図画像生成などが使える

---

## 主要な特徴

| 特徴 | 説明 |
|---|---|
| **自己拡張（動的スキル）** | `config/skills/` にスキルを自作。リビルド不要で次のメッセージから即有効 |
| **三層構造** | スキル（最小機能）→ マニュアル（組み合わせ手順）→ cron（定時トリガー）|
| **Key Binder** | APIキーを別コンテナで隔離。エージェントがキーに直接触れない設計 |
| **SQLite + ポーリング** | 2秒間隔でメッセージを処理。クラッシュ後も取りこぼしなし |
| **可変 / 非可変の分離** | ループ・接続はコンテナに焼き込み。スキル・設定はボリュームマウントで永続化 |

---

## クイックスタート

```bash
# 1. クローン
git clone https://github.com/qwibitai/gemiclaw.git
cd gemiclaw

# 2. 環境変数を設定
cp .env.example .env
# .env を開いて DISCORD_TOKEN と GEMINI_API_KEY を記入

# 3. Key Binder のAPIキーを設定
cp keybinder/secrets_for_skills.example.json keybinder/secrets_for_skills.json
# keybinder/secrets_for_skills.json に使用するAPIキーを記入

# 4. 起動
docker-compose up -d --build

# 5. 動作確認
docker-compose logs -f
```

Discord でボットをメンションして話しかけてください。

```
@gemiclaw こんにちは！
```

---

## ドキュメント

| ページ | 内容 |
|---|---|
| [セットアップガイド](docs/setup.md) | 前提条件・各APIキーの取得・Google API設定・Docker起動手順 |
| [アーキテクチャ](docs/architecture.md) | 設計思想・コンポーネント構成・データフロー・可変/非可変の分離 |
| [スキルガイド](docs/skills.md) | スキル一覧・スキルの作り方・Key Binder エンドポイント仕様 |
